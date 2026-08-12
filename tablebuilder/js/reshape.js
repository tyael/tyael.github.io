/**
 * reshape.js
 *
 * The long -> wide pivot that turns tidy data into a table shape.
 *
 * Tidy data has one observation per row (`region, year, metric, value`), but a
 * publication table wants those keys spread across columns with spanners above
 * them. This module does that spread and, importantly, hands back the spanner
 * tree it implies so the user does not have to rebuild it by hand.
 *
 * The pivot is non-destructive: `spec.source` always holds the file as imported
 * and `spec.reshape` describes the transform, so it stays editable. Results are
 * memoised because compute() runs on every keystroke.
 */

const Reshape = {

  /** Aggregations offered when several rows collapse into one cell. */
  AGGREGATES: [
    { id: 'first', label: 'First' },
    { id: 'last', label: 'Last' },
    { id: 'sum', label: 'Sum' },
    { id: 'mean', label: 'Mean' },
    { id: 'median', label: 'Median' },
    { id: 'min', label: 'Min' },
    { id: 'max', label: 'Max' },
    { id: 'count', label: 'Count' },
    { id: 'concat', label: 'Join with ", "' }
  ],

  _cache: { key: null, value: null },

  /**
   * Derive the working columns and rows for a spec.
   * @returns {{columns, rows, spanners, pivoted:boolean, warnings:string[]}}
   */
  derive(source, reshape) {
    if (!reshape || reshape.mode !== 'pivot' || !reshape.nameCols.length || !reshape.valueCols.length) {
      return {
        columns: source.columns,
        rows: source.rows,
        spanners: [],
        pivoted: false,
        warnings: []
      };
    }

    const key = Reshape._cacheKey(source, reshape);
    if (Reshape._cache.key === key) return Reshape._cache.value;

    const value = Reshape.pivot(source, reshape);
    Reshape._cache = { key: key, value: value };
    return value;
  },

  /** Cheap identity for the memo: the reshape config plus the data's size. */
  _cacheKey(source, reshape) {
    return JSON.stringify(reshape) + '|' + source.filename + '|' +
      source.rows.length + '|' + source.columns.length;
  },

  /**
   * Spread `nameCols` across columns.
   *
   * Column ids are built from the name-column values joined by `nameSep`, with
   * the value column appended when more than one is being spread. Spanners are
   * emitted for every level above the innermost, outermost first.
   */
  pivot(source, reshape) {
    const warnings = [];
    const sep = reshape.nameSep || ' > ';
    const idCols = reshape.idCols.filter((id) => source.columns.some((c) => c.id === id));
    const nameCols = reshape.nameCols.filter((id) => source.columns.some((c) => c.id === id));
    const valueCols = reshape.valueCols.filter((id) => source.columns.some((c) => c.id === id));
    const byId = {};
    for (const col of source.columns) byId[col.id] = col;

    /* ---- 1. Bucket source rows by their id-column values ----
       Composite keys join their parts with U+0001 so that data containing the
       display separator can never collide with a different key. */

    const rowKeyOf = (row) => idCols.map((id) => String(row[id])).join('\\u0001');
    const buckets = new Map();
    for (const row of source.rows) {
      const key = rowKeyOf(row);
      if (!buckets.has(key)) buckets.set(key, { idValues: row, cells: new Map() });
      const bucket = buckets.get(key);

      const nameKey = nameCols.map((id) => String(row[id])).join('\\u0001');
      for (const valueCol of valueCols) {
        const cellKey = nameKey + '\\u0001' + valueCol;
        if (!bucket.cells.has(cellKey)) bucket.cells.set(cellKey, []);
        bucket.cells.get(cellKey).push(row[valueCol]);
      }
    }

    /* ---- 2. Work out the full column set, in first-seen order ---- */

    const nameTuples = [];
    const seenTuple = new Set();
    for (const row of source.rows) {
      const tuple = nameCols.map((id) => String(row[id]));
      const key = tuple.join('\\u0001');
      if (!seenTuple.has(key)) {
        seenTuple.add(key);
        nameTuples.push(tuple);
      }
    }
    nameTuples.sort(Reshape._tupleComparator);

    const multiValue = valueCols.length > 1;
    const columns = [];
    const derivedInfo = [];   // parallel to the pivoted columns: {tuple, valueCol}

    // Id columns keep their identity and lead the table.
    for (const id of idCols) {
      columns.push(Object.assign({}, byId[id]));
    }

    const usedIds = new Set(columns.map((c) => c.id));
    for (const tuple of nameTuples) {
      for (const valueCol of valueCols) {
        const labelParts = tuple.slice();
        if (multiValue) labelParts.push(byId[valueCol].name);

        let colId = Util.slug(labelParts.join('_'));
        if (usedIds.has(colId)) {
          let n = 2;
          while (usedIds.has(colId + '_' + n)) n += 1;
          colId = colId + '_' + n;
        }
        usedIds.add(colId);

        columns.push({
          id: colId,
          name: labelParts.join(sep),
          // The innermost label is what shows in the column-label row; the
          // outer levels become spanners.
          shortName: multiValue ? byId[valueCol].name : tuple[tuple.length - 1],
          index: columns.length,
          type: byId[valueCol].type
        });
        derivedInfo.push({ colId: colId, tuple: tuple, valueCol: valueCol });
      }
    }

    /* ---- 3. Fill the rows ---- */

    const aggregate = Reshape.aggregator(reshape.aggregate || 'first');
    let collisions = 0;

    const rows = [];
    for (const bucket of buckets.values()) {
      const row = {};
      for (const id of idCols) row[id] = bucket.idValues[id];

      for (const info of derivedInfo) {
        const cellKey = info.tuple.join('\\u0001') + '\\u0001' + info.valueCol;
        const values = bucket.cells.get(cellKey);
        if (!values || !values.length) {
          row[info.colId] = '';
        } else {
          if (values.length > 1) collisions += 1;
          row[info.colId] = aggregate(values);
        }
      }
      rows.push(row);
    }

    if (collisions && (reshape.aggregate || 'first') === 'first') {
      warnings.push(collisions + ' cell(s) had more than one value; only the first was kept. ' +
        'Choose an aggregation if that is not what you want.');
    }

    /* ---- 4. Re-infer types on the pivoted columns ---- */

    for (const col of columns) {
      if (idCols.indexOf(col.id) < 0) col.type = Csv.inferType(rows, col.id);
    }

    /* ---- 5. Emit the spanner tree ---- */

    const spanners = Reshape.buildSpanners(nameCols, derivedInfo, multiValue, sep);

    return { columns: columns, rows: rows, spanners: spanners, pivoted: true, warnings: warnings };
  },

  /**
   * Build one spanner per distinct prefix of the name-column tuple.
   *
   * Level 1 is the innermost spanner (immediately above the column labels), so
   * with nameCols = [year, quarter] and two value columns you get quarters at
   * level 1 and years at level 2.
   */
  buildSpanners(nameCols, derivedInfo, multiValue, sep) {
    const spanners = [];
    // With a single name column and a single value column the tuple value is
    // already the column label, so there is nothing left to span.
    const deepest = multiValue ? nameCols.length : nameCols.length - 1;

    for (let depth = 1; depth <= deepest; depth += 1) {
      const level = deepest - depth + 1;
      const groups = new Map();

      for (const info of derivedInfo) {
        const prefix = info.tuple.slice(0, depth);
        const key = prefix.join('\\u0001');
        if (!groups.has(key)) groups.set(key, { label: prefix[prefix.length - 1], columns: [] });
        groups.get(key).columns.push(info.colId);
      }

      for (const group of groups.values()) {
        if (group.columns.length < 1) continue;
        spanners.push({
          id: Util.uid('sp'),
          label: group.label,
          columns: group.columns,
          level: level
        });
      }
    }

    return spanners;
  },

  /** Sort tuples numerically where both sides are numbers, else lexically. */
  _tupleComparator(a, b) {
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
      const na = Util.toNumber(a[i]);
      const nb = Util.toNumber(b[i]);
      if (na !== null && nb !== null) {
        if (na !== nb) return na - nb;
      } else if (a[i] !== b[i]) {
        return a[i] < b[i] ? -1 : 1;
      }
    }
    return 0;
  },

  /** Return the aggregation function for an id. */
  aggregator(id) {
    const nums = (values) => values.map(Util.toNumber).filter((n) => n !== null);

    switch (id) {
      case 'last': return (v) => v[v.length - 1];
      case 'sum': return (v) => { const n = nums(v); return n.length ? n.reduce((a, b) => a + b, 0) : ''; };
      case 'mean': return (v) => { const n = nums(v); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : ''; };
      case 'median': return (v) => {
        const n = nums(v).sort((a, b) => a - b);
        if (!n.length) return '';
        const mid = Math.floor(n.length / 2);
        return n.length % 2 ? n[mid] : (n[mid - 1] + n[mid]) / 2;
      };
      case 'min': return (v) => { const n = nums(v); return n.length ? Math.min.apply(null, n) : ''; };
      case 'max': return (v) => { const n = nums(v); return n.length ? Math.max.apply(null, n) : ''; };
      case 'count': return (v) => v.filter((x) => !Util.isMissing(x)).length;
      case 'concat': return (v) => Util.unique(v.filter((x) => !Util.isMissing(x))).join(', ');
      default: return (v) => v[0];
    }
  },

  /**
   * Guess a sensible pivot for a freshly imported file: the last text column
   * that repeats becomes the name column, the last numeric column the value.
   * Only ever used to pre-fill the panel.
   */
  suggest(source) {
    const cardinality = {};
    for (const col of source.columns) {
      cardinality[col.id] = Util.unique(source.rows.map((r) => r[col.id])).length;
    }

    const textCols = source.columns.filter((c) => c.type !== 'number');
    const numCols = source.columns.filter((c) => c.type === 'number');
    if (textCols.length < 2 || !numCols.length) return null;

    // A good name column repeats a lot: few distinct values, many rows.
    const candidates = textCols
      .filter((c) => cardinality[c.id] > 1 && cardinality[c.id] <= Math.max(12, source.rows.length / 3))
      .sort((a, b) => cardinality[a.id] - cardinality[b.id]);
    if (!candidates.length) return null;

    const nameCol = candidates[0];
    const idCols = textCols.filter((c) => c.id !== nameCol.id).map((c) => c.id);
    if (!idCols.length) return null;

    return {
      mode: 'pivot',
      idCols: idCols,
      nameCols: [nameCol.id],
      valueCols: [numCols[numCols.length - 1].id],
      aggregate: 'first',
      nameSep: ' > '
    };
  }
};
