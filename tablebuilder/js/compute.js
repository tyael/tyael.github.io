/**
 * compute.js
 *
 * The one pure step between the spec and every renderer.
 *
 * `Compute.run(spec)` turns the TableSpec plus its source data into a
 * ResolvedModel: concrete grid columns, header levels with their spans and
 * rowspans, body rows with formatted text and resolved styles, summary rows,
 * assigned footnote marks. No DOM, no side effects.
 *
 * Everything downstream — the HTML preview, the HTML export, the SVG measurer,
 * the LaTeX writer, the R code writer — reads this model and nothing else. That
 * is what keeps the exports honest: they cannot drift from the preview because
 * they are not looking at the preview, they are looking at what produced it.
 */

const Compute = {

  /** Rows past this are dropped from the render with a notice. */
  MAX_PREVIEW_ROWS: 2000,

  /** Footnote mark sets, matching gt's `opt_footnote_marks()`. */
  MARK_SETS: {
    numbers: null,   // generated
    letters: 'abcdefghijklmnopqrstuvwxyz'.split(''),
    LETTERS: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
    standard: ['*', '†', '‡', '§'],
    extended: ['*', '†', '‡', '§', '‖', '¶']
  },

  /** Aggregations available to summary rows. */
  SUMMARY_FNS: [
    { id: 'sum', label: 'Sum', fn: (n) => n.reduce((a, b) => a + b, 0) },
    { id: 'mean', label: 'Mean', fn: (n) => n.reduce((a, b) => a + b, 0) / n.length },
    { id: 'median', label: 'Median', fn: (n) => {
      const s = n.slice().sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    } },
    { id: 'min', label: 'Min', fn: (n) => Math.min.apply(null, n) },
    { id: 'max', label: 'Max', fn: (n) => Math.max.apply(null, n) },
    { id: 'sd', label: 'SD', fn: (n) => {
      if (n.length < 2) return 0;
      const mean = n.reduce((a, b) => a + b, 0) / n.length;
      return Math.sqrt(n.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / (n.length - 1));
    } },
    { id: 'n', label: 'N', fn: (n) => n.length },
    { id: 'first', label: 'First', fn: (n) => n[0] },
    { id: 'last', label: 'Last', fn: (n) => n[n.length - 1] }
  ],

  /* ================================================================
     Entry point
     ================================================================ */

  /**
   * @param {Object} spec
   * @param {Object} [opts] - {limitRows: boolean} (off for exports)
   * @returns {Object} the ResolvedModel
   */
  run(spec, opts) {
    opts = opts || {};
    const limit = opts.limitRows !== false;

    const model = {
      ok: false,
      error: null,
      warnings: [],
      options: spec.options,
      spec: spec
    };

    if (!Spec.hasData(spec)) {
      model.error = 'No data loaded.';
      return model;
    }

    /* ---- 1. Working data (post-reshape) ---- */

    const working = Reshape.derive(spec.source, spec.reshape);
    model.warnings.push.apply(model.warnings, working.warnings);

    // Cell corrections sit between the pivot and everything else: filtering,
    // sorting, grouping, summaries, colour scales and `where` expressions all
    // read `rows` below, so a corrected value is what every one of them sees.
    // Applying them any later would leave the table sorting by a typo it no
    // longer shows.
    const corrected = Corrections.apply(working.rows, spec.corrections);
    const rows = corrected.rows;
    model.corrections = corrected.applied;
    model.staleCorrections = corrected.stale;
    if (corrected.stale.length) {
      model.warnings.push(corrected.stale.length + ' cell correction(s) no longer match the ' +
        'data they were made against, and were not applied.');
    }

    const columnsById = {};
    for (const col of working.columns) columnsById[col.id] = col;
    model.columns = working.columns;
    model.columnsById = columnsById;

    /* ---- 2. Column merges ---- */

    const merged = Compute.applyMerges(spec, working, columnsById);

    /* ---- 3. Row order ---- */

    let displayRows = rows.map((row, i) => ({ row: row, srcIndex: i }));

    // Filter first: sorting rows that are about to be dropped is wasted work,
    // and every count below should describe what is actually shown. `apply`
    // does not renumber `srcIndex` — style rules and footnotes are pinned to
    // it, so renumbering would move all of them to different rows.
    const filtered = Filter.apply(displayRows, spec.structure.filter, columnsById);
    displayRows = filtered.rows;
    model.filteredOut = filtered.removed;
    model.sourceRows = rows.length;

    displayRows = Compute.sortRows(displayRows, spec.structure.sort, columnsById);

    model.totalRows = displayRows.length;
    model.truncated = false;
    if (limit && displayRows.length > Compute.MAX_PREVIEW_ROWS) {
      displayRows = displayRows.slice(0, Compute.MAX_PREVIEW_ROWS);
      model.truncated = true;
    }

    /* ---- 4. Grid columns ---- */

    const st = spec.structure;
    const stubColId = st.rownameCol && columnsById[st.rownameCol] ? st.rownameCol : null;
    const groupColId = st.groupnameCol && columnsById[st.groupnameCol] ? st.groupnameCol : null;
    const groupAsColumn = groupColId && spec.options['row_group.as_column'];

    const hidden = new Set(st.hidden);
    const bodyColIds = st.columnOrder.filter((id) =>
      columnsById[id] && !hidden.has(id) && id !== stubColId && id !== groupColId &&
      !merged.consumed.has(id));

    const cols = [];
    if (groupAsColumn) {
      cols.push({ kind: 'group', colId: groupColId, key: '__group__',
        label: st.labels[groupColId] || '', align: 'left', width: st.widths[groupColId] || null });
    }
    if (stubColId) {
      cols.push({ kind: 'stub', colId: stubColId, key: '__stub__',
        label: spec.parts.stubhead || '', align: Compute.alignOf(spec, columnsById[stubColId]),
        width: st.widths[stubColId] || null, type: columnsById[stubColId].type });
    }
    for (const id of bodyColIds) {
      cols.push({
        kind: 'body',
        colId: id,
        key: id,
        label: Spec.columnLabel(spec, columnsById[id]),
        align: Compute.alignOf(spec, columnsById[id]),
        width: st.widths[id] || null,
        type: columnsById[id].type
      });
    }

    model.cols = cols;
    model.bodyColIds = bodyColIds;
    model.stubColId = stubColId;
    model.groupColId = groupColId;
    model.groupAsColumn = !!groupAsColumn;

    if (!cols.length) {
      model.error = 'Every column is hidden — nothing to show.';
      return model;
    }

    /* ---- 5. Formatting and colouring plans ---- */

    const formatPlan = Compute.buildFormatPlan(spec, columnsById);
    // Over the rows that survived the filter, not the whole source: a scale
    // fitted to rows nobody can see leaves the visible ones bunched at one end
    // of it. Summaries do the same by construction, since they are built from
    // `displayRows`.
    const colorPlan = Compute.buildColorPlan(spec,
      { columns: working.columns, rows: displayRows.map((item) => item.row) }, columnsById);

    /* ---- 6. Style rules ---- */

    const compiled = StyleRules.compile(spec.styleRules, {
      rows: rows,
      columnsById: columnsById
    });
    const compiledRules = compiled.rules;
    // Comes back from this compile, so it cannot describe a rule that is no
    // longer here — see the note on `StyleRules.compile`.
    model.ruleError = compiled.error;

    /* ---- 7. Footnote marks ---- */

    const footnotes = Compute.assignFootnoteMarks(spec);
    model.footnotes = footnotes.list;
    const footnoteIndex = footnotes.index;

    /* ---- 8. Header ---- */

    model.header = Compute.buildHeader(spec, model, compiledRules, footnoteIndex);

    /* ---- 9. Body ---- */

    const ctx = {
      spec: spec,
      model: model,
      columnsById: columnsById,
      formatPlan: formatPlan,
      colorPlan: colorPlan,
      merged: merged,
      rules: compiledRules,
      footnoteIndex: footnoteIndex,
      workingRows: rows
    };

    model.rows = Compute.buildBody(displayRows, ctx);

    /* ---- 10. Header/footer text ---- */

    model.title = spec.parts.title || '';
    model.subtitle = spec.parts.subtitle || '';
    model.caption = spec.parts.caption || '';
    model.captionAlign = spec.parts.captionAlign || 'center';
    model.stubhead = spec.parts.stubhead || '';
    model.sourceNotes = spec.parts.sourceNotes.map((note) => ({
      id: note.id,
      text: note.text,
      style: StyleRules.resolve(compiledRules, { part: 'source_notes' })
    }));

    model.titleStyle = StyleRules.resolve(compiledRules, { part: 'title' });
    model.subtitleStyle = StyleRules.resolve(compiledRules, { part: 'subtitle' });
    model.footnotesStyle = StyleRules.resolve(compiledRules, { part: 'footnotes' });

    // Id and label only, so a line that a rule drew can be named without any
    // consumer reaching back into the spec. A reference would expose the
    // editable rules to renderers that have no business with them.
    model.styleRules = spec.styleRules.map((rule) => ({ id: rule.id, label: rule.label }));

    // Marks that sit on the title, subtitle or the notes themselves.
    model.titleMarks = Compute.marksFor(footnoteIndex, { part: 'title' });
    model.subtitleMarks = Compute.marksFor(footnoteIndex, { part: 'subtitle' });

    model.ok = true;
    return model;
  },

  /* ================================================================
     Columns
     ================================================================ */

  /** Resolve a column's alignment, falling back to the type default. */
  alignOf(spec, column) {
    if (!column) return 'left';
    const set = spec.structure.align[column.id];
    if (set && set !== 'auto') return set;
    return Spec.defaultAlign(column);
  },

  /**
   * Apply gt's `cols_merge*()` family.
   *
   * Merges produce a text value for the target column and mark the other
   * columns as consumed so they drop out of the display.
   */
  applyMerges(spec, working, columnsById) {
    const consumed = new Set();
    const byTarget = {};

    for (const merge of spec.structure.merges) {
      if (!columnsById[merge.target]) continue;
      const others = (merge.columns || []).filter((id) => id !== merge.target && columnsById[id]);
      if (!others.length) continue;

      byTarget[merge.target] = { merge: merge, others: others };
      for (const id of others) consumed.add(id);
    }

    return { consumed: consumed, byTarget: byTarget };
  },

  /**
   * The merged text for one cell, given already-formatted pieces.
   * @param {Object} entry - {merge, others}
   * @param {Function} textOf - colId -> formatted text
   */
  mergeText(entry, textOf) {
    const merge = entry.merge;
    const target = textOf(merge.target);
    const others = entry.others.map(textOf);

    switch (merge.type) {
      case 'uncert':
        // value ± uncertainty, or a range when two uncertainty columns are given
        return others.length > 1
          ? target + ' +' + others[0] + ' / −' + others[1]
          : target + ' ± ' + others[0];
      case 'range':
        return target + (merge.sep || '–') + others[0];
      case 'n_pct':
        return target + ' (' + others[0] + ')';
      default: {
        // Free-form pattern: {1} is the target, {2}.. are the others in order.
        const parts = [target].concat(others);
        const pattern = merge.pattern || parts.map((_, i) => '{' + (i + 1) + '}').join(' ');
        return pattern.replace(/\{(\d+)\}/g, (match, n) => {
          const value = parts[parseInt(n, 10) - 1];
          return value === undefined ? '' : value;
        });
      }
    }
  },

  /** Stable multi-key sort. */
  sortRows(displayRows, sort, columnsById) {
    if (!sort || !sort.length) return displayRows;

    const keys = sort.filter((s) => columnsById[s.col]);
    if (!keys.length) return displayRows;

    return displayRows.slice().sort((a, b) => {
      for (const key of keys) {
        const col = columnsById[key.col];
        const av = a.row[key.col];
        const bv = b.row[key.col];
        let cmp;

        if (col.type === 'number') {
          const na = Util.toNumber(av);
          const nb = Util.toNumber(bv);
          // Missing values always sort last, whichever direction is asked for.
          if (na === null && nb === null) cmp = 0;
          else if (na === null) return 1;
          else if (nb === null) return -1;
          else cmp = na - nb;
        } else {
          const sa = String(av === null || av === undefined ? '' : av);
          const sb = String(bv === null || bv === undefined ? '' : bv);
          cmp = sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
        }

        if (cmp !== 0) return key.dir === 'desc' ? -cmp : cmp;
      }
      return a.srcIndex - b.srcIndex;
    });
  },

  /* ================================================================
     Formatting
     ================================================================ */

  /**
   * Resolve which formatter applies to each column, and any row-specific
   * overrides. Later rules in `spec.format` win.
   * @returns {Object} colId -> {def, rowOverrides: Map(srcIndex -> def)}
   */
  buildFormatPlan(spec, columnsById) {
    const plan = {};

    for (const rule of spec.format) {
      if (rule.enabled === false) continue;
      const columns = (rule.columns || []).filter((id) => columnsById[id]);
      const entry = { type: rule.type, opts: Formatters.resolveOpts(rule.type, rule.opts) };

      for (const colId of columns) {
        if (!plan[colId]) plan[colId] = { def: null, rowOverrides: null };
        const targetsAllRows = !rule.rows || rule.rows.mode === 'all';

        if (targetsAllRows) {
          plan[colId].def = entry;
        } else {
          if (!plan[colId].rowOverrides) plan[colId].rowOverrides = new Map();
          const indices = rule.rows.mode === 'index' ? rule.rows.indices : [];
          for (const index of indices) plan[colId].rowOverrides.set(index, entry);
        }
      }
    }

    return plan;
  },

  /** Format one raw value for a cell. Returns {text, isMarkup}. */
  formatValue(rawValue, colId, srcIndex, ctx) {
    const spec = ctx.spec;

    if (Util.isMissing(rawValue)) {
      if (spec.subs.missing.enabled) return { text: spec.subs.missing.text, isMarkup: true, missing: true };
      return { text: '', isMarkup: false, missing: true };
    }

    const entry = ctx.formatPlan[colId];
    let def = entry ? entry.def : null;
    if (entry && entry.rowOverrides && entry.rowOverrides.has(srcIndex)) {
      def = entry.rowOverrides.get(srcIndex);
    }

    if (spec.subs.zero.enabled && Util.toNumber(rawValue) === 0) {
      return { text: spec.subs.zero.text, isMarkup: true, zero: true };
    }

    if (!def) {
      const text = String(rawValue);
      return { text: text, isMarkup: Markup.hasMarkup(text) };
    }

    const formatted = Formatters.apply(def.type, rawValue, def.opts, {
      column: ctx.columnsById[colId]
    });

    if (formatted === null) {
      // The formatter could not handle this value (text in a numeric column,
      // say) — show it as-is rather than blanking it.
      const text = String(rawValue);
      return { text: text, isMarkup: Markup.hasMarkup(text) };
    }

    return { text: formatted, isMarkup: true };
  },

  /* ================================================================
     data_color
     ================================================================ */

  /**
   * Fit one colour scale per data_color rule, over the values it covers.
   * @returns {Array} [{columns:Set, scale, applyTo, autocolorText, ...}]
   */
  buildColorPlan(spec, working, columnsById) {
    const plan = [];

    for (const rule of spec.dataColor) {
      if (rule.enabled === false) continue;
      const columns = (rule.columns || []).filter((id) => columnsById[id]);
      if (!columns.length) continue;

      // A shared domain fits one scale across every listed column; otherwise
      // each column gets its own, which is usually what you want when the
      // columns are in different units.
      const buildFor = (ids) => {
        const values = [];
        for (const row of working.rows) {
          for (const id of ids) values.push(row[id]);
        }
        return Palettes.scale({
          colors: Palettes.byName(rule.palette || 'Blues'),
          method: rule.method || 'numeric',
          values: values,
          domain: rule.domain && rule.domain.length === 2 ? rule.domain : null,
          bins: rule.bins,
          reverse: !!rule.reverse,
          midpoint: rule.midpoint
        });
      };

      const scales = {};
      if (rule.sharedDomain !== false) {
        const shared = buildFor(columns);
        for (const id of columns) scales[id] = shared;
      } else {
        for (const id of columns) scales[id] = buildFor([id]);
      }

      plan.push({
        id: rule.id,
        columns: new Set(columns),
        scales: scales,
        applyTo: rule.applyTo || 'fill',
        autocolorText: rule.autocolorText !== false,
        alpha: rule.alpha === undefined ? 1 : rule.alpha,
        rows: rule.rows && rule.rows.mode === 'index' ? new Set(rule.rows.indices) : null
      });
    }

    return plan;
  },

  /** The colour contribution for one cell, or null. */
  colorFor(rawValue, colId, srcIndex, ctx) {
    let out = null;

    for (const entry of ctx.colorPlan) {
      if (!entry.columns.has(colId)) continue;
      if (entry.rows && !entry.rows.has(srcIndex)) continue;

      const color = entry.scales[colId].of(rawValue);
      if (!color) continue;

      const shaded = entry.alpha < 1 ? Palettes.withAlpha(color, entry.alpha) : color;

      if (entry.applyTo === 'text') {
        out = Object.assign({}, out, { color: shaded });
      } else {
        const next = { fill: shaded };
        if (entry.autocolorText) {
          next.color = Palettes.readableOn(
            shaded,
            ctx.spec.options['table.font.color'],
            ctx.spec.options['table.font.color.light']
          );
        }
        out = Object.assign({}, out, next);
      }
    }

    return out;
  },

  /* ================================================================
     Footnotes
     ================================================================ */

  /**
   * Assign marks to footnotes in reading order and index them by location.
   * @returns {{list, index}} index maps a location key to an array of marks
   */
  assignFootnoteMarks(spec) {
    const notes = spec.parts.footnotes || [];
    const list = [];
    const index = {};

    // Reading order: title, subtitle, stubhead, spanners, column labels, then
    // the body top-to-bottom, then the footer. Notes without a location keep
    // their authored order at the end.
    const partRank = {
      title: 0, subtitle: 1, stubhead: 2, column_spanners: 3, column_labels: 4,
      row_groups: 5, stub: 6, body: 6, summary: 7, grand_summary: 8, source_notes: 9
    };

    const ordered = notes.map((note, i) => ({ note: note, i: i })).sort((a, b) => {
      const la = a.note.location || {};
      const lb = b.note.location || {};
      const ra = partRank[la.part] === undefined ? 99 : partRank[la.part];
      const rb = partRank[lb.part] === undefined ? 99 : partRank[lb.part];
      if (ra !== rb) return ra - rb;
      const ia = la.srcIndex === undefined ? -1 : la.srcIndex;
      const ib = lb.srcIndex === undefined ? -1 : lb.srcIndex;
      if (ia !== ib) return ia - ib;
      return a.i - b.i;
    });

    // Identical footnote text reuses the same mark, as gt does.
    const marksByText = {};
    let counter = 0;

    for (const item of ordered) {
      const note = item.note;
      let mark;
      if (Object.prototype.hasOwnProperty.call(marksByText, note.text)) {
        mark = marksByText[note.text];
      } else {
        mark = Compute.markAt(counter, spec.options['footnotes.marks']);
        marksByText[note.text] = mark;
        counter += 1;
        list.push({ id: note.id, mark: mark, text: note.text });
      }

      if (note.location && note.location.part) {
        const key = Compute.locationKey(note.location);
        if (!index[key]) index[key] = [];
        if (index[key].indexOf(mark) < 0) index[key].push(mark);
      }
    }

    return { list: list, index: index };
  },

  /** The nth mark in a set, doubling the glyph once the set is exhausted. */
  markAt(n, setName) {
    if (!setName || setName === 'numbers') return String(n + 1);
    const set = Compute.MARK_SETS[setName];
    if (!set) return String(n + 1);
    const repeats = Math.floor(n / set.length) + 1;
    return set[n % set.length].repeat(repeats);
  },

  /**
   * Stable key for a footnote/selection location.
   *
   * Only the dimensions the part actually uses take part in the key, and
   * `StyleRules.PARTS` already declares which those are — `columns`, `rows`,
   * `groups`, `spanners`. Without that, the two sides that build these keys
   * disagree: `Selection` tags a body cell with the `groupId` of the row group
   * it happens to sit in, and `PanelContent.locationOf` copies it, while the
   * cell's own location here carries none. The keys never matched, so on any
   * grouped table a footnote reached the footer with no anchor in the cell.
   *
   * A body cell is identified by its column and row; the group is context, not
   * identity, and `srcIndex` already pins the row. A summary row is the other
   * way round — it has no row index and one per group, so `groups` is part of
   * its identity and `rows` is not. Deriving that from `PARTS` rather than
   * restating it is what stops the two sides drifting apart again.
   */
  locationKey(loc) {
    const part = StyleRules.PARTS.find((p) => p.id === loc.part);
    // An unknown part keeps every field, which is the old behaviour.
    const uses = (dimension) => !part || !!part[dimension];
    return [
      loc.part,
      uses('columns') ? (loc.colId || '') : '',
      uses('rows')
        ? (loc.srcIndex === undefined || loc.srcIndex === null ? '' : loc.srcIndex)
        : '',
      uses('groups') ? (loc.groupId || '') : '',
      uses('spanners') ? (loc.spannerId || '') : ''
    ].join('|');
  },

  /** Marks attached to a location, or an empty array. */
  marksFor(index, loc) {
    return index[Compute.locationKey(loc)] || [];
  },

  /** Render a mark list into this app's markup, honouring the footnote spec. */
  markupForMarks(marks, spec) {
    if (!marks.length) return '';
    const flags = spec.options['footnotes.spec_ref'] || '^i';
    return marks.map((mark) => Markup.applyFootnoteSpec(mark, flags)).join(',');
  },

  /* ================================================================
     Header
     ================================================================ */

  /**
   * Build the header rows.
   *
   * Spanner levels run bottom-up in the spec (level 1 sits directly above the
   * column labels), so they are emitted top-down here. A column with no spanner
   * above it gets its label in the topmost row with a rowspan reaching down to
   * the label row — the same thing gt does, and it reads much better than a
   * stack of empty cells.
   */
  buildHeader(spec, model, rules, footnoteIndex) {
    const cols = model.cols;
    const bodyCols = cols.filter((c) => c.kind === 'body');
    const spanners = (spec.structure.spanners || []).filter((sp) => sp.columns.length);

    // Body columns sit to the right of the stub and group columns. Every header
    // cell records the grid column it truly occupies, because the label row
    // contains only the columns no spanner claimed — so its cells are not
    // contiguous from the left, and a running counter would misplace them.
    const leadCount = (model.groupAsColumn ? 1 : 0) + (model.stubColId ? 1 : 0);

    const maxLevel = spanners.reduce((max, sp) => Math.max(max, sp.level || 1), 0);
    const totalRows = maxLevel + 1;

    // colId -> level -> spanner
    const at = {};
    for (const sp of spanners) {
      for (const colId of sp.columns) {
        if (!at[colId]) at[colId] = {};
        at[colId][sp.level || 1] = sp;
      }
    }

    const emitted = new Set();
    const levels = [];

    for (let level = maxLevel; level >= 1; level -= 1) {
      const rowIndex = maxLevel - level;
      const cells = [];
      let i = 0;

      while (i < bodyCols.length) {
        const col = bodyCols[i];
        const spanner = at[col.colId] && at[col.colId][level];

        if (spanner) {
          // Consume every consecutive column carrying this same spanner.
          let span = 1;
          while (i + span < bodyCols.length &&
                 at[bodyCols[i + span].colId] &&
                 at[bodyCols[i + span].colId][level] === spanner) {
            span += 1;
          }
          const loc = { part: 'column_spanners', spannerId: spanner.id };
          cells.push({
            kind: 'spanner',
            id: spanner.id,
            label: spanner.label,
            span: span,
            rowspan: 1,
            gridCol: leadCount + i,
            colIds: bodyCols.slice(i, i + span).map((c) => c.colId),
            align: 'center',
            style: StyleRules.resolve(rules, loc),
            marks: Compute.marksFor(footnoteIndex, loc)
          });
          i += span;
          continue;
        }

        // No spanner here. If the column has one at a lower level, leave a gap;
        // otherwise drop its label in now and let it span down to the label row.
        const hasLower = at[col.colId] && Object.keys(at[col.colId]).some((l) => +l < level);

        if (hasLower) {
          let span = 1;
          while (i + span < bodyCols.length) {
            const next = bodyCols[i + span];
            const nextSpanner = at[next.colId] && at[next.colId][level];
            const nextLower = at[next.colId] && Object.keys(at[next.colId]).some((l) => +l < level);
            if (nextSpanner || !nextLower) break;
            span += 1;
          }
          cells.push({ kind: 'blank', span: span, rowspan: 1, gridCol: leadCount + i, label: '', colIds: [] });
          i += span;
        } else {
          cells.push(Compute.labelCell(col, totalRows - rowIndex, leadCount + i, rules, footnoteIndex, spec));
          emitted.add(col.colId);
          i += 1;
        }
      }

      levels.push({ level: level, cells: cells });
    }

    // The column-label row itself: only the columns no spanner claimed, which
    // is why each carries its own grid column rather than sitting in sequence.
    const labelCells = [];
    bodyCols.forEach((col, i) => {
      if (emitted.has(col.colId)) return;
      labelCells.push(Compute.labelCell(col, 1, leadCount + i, rules, footnoteIndex, spec));
    });
    levels.push({ level: 0, cells: labelCells });

    // The stub and group columns get one cell spanning the whole header block,
    // placed in the top row.
    const lead = [];
    const stubheadLoc = { part: 'stubhead' };

    if (model.groupAsColumn) {
      // With no stub column this is the only header cell over the stub area, so
      // it is what the stubhead labels. When a stub column follows, the label
      // belongs to that cell instead and this one stays blank.
      const labelsStub = !model.stubColId;
      lead.push({
        kind: 'stubhead',
        label: labelsStub ? (spec.parts.stubhead || '') : '',
        span: 1,
        rowspan: totalRows,
        gridCol: lead.length,
        colIds: [],
        align: 'left',
        style: labelsStub ? StyleRules.resolve(rules, stubheadLoc) : null,
        marks: labelsStub ? Compute.marksFor(footnoteIndex, stubheadLoc) : []
      });
    }
    if (model.stubColId) {
      lead.push({
        kind: 'stubhead',
        label: spec.parts.stubhead || '',
        span: 1,
        rowspan: totalRows,
        gridCol: lead.length,
        colIds: [],
        align: 'left',
        style: StyleRules.resolve(rules, stubheadLoc),
        marks: Compute.marksFor(footnoteIndex, stubheadLoc)
      });
    }

    return {
      show: !spec.options['column_labels.hidden'],
      totalRows: totalRows,
      spannerLevels: maxLevel,
      lead: lead,
      levels: levels
    };
  },

  /** One column-label cell. */
  labelCell(col, rowspan, gridCol, rules, footnoteIndex, spec) {
    const loc = { part: 'column_labels', colId: col.colId };
    return {
      kind: 'label',
      colId: col.colId,
      label: col.label,
      span: 1,
      rowspan: rowspan,
      gridCol: gridCol,
      colIds: [col.colId],
      align: col.align,
      style: StyleRules.resolve(rules, loc),
      marks: Compute.marksFor(footnoteIndex, loc)
    };
  },

  /* ================================================================
     Body
     ================================================================ */

  /**
   * Build the body rows: group label rows, data rows, summary rows and the
   * grand summary, in display order.
   */
  buildBody(displayRows, ctx) {
    const spec = ctx.spec;
    const model = ctx.model;
    const groupColId = model.groupColId;
    const out = [];

    /* ---- Partition into groups ---- */

    let groups;
    if (groupColId) {
      const defaultLabel = spec.options['row_group.default_label'] || '';
      const byLabel = new Map();

      for (const item of displayRows) {
        const raw = item.row[groupColId];
        const label = Util.isMissing(raw) ? defaultLabel : String(raw);
        if (!byLabel.has(label)) byLabel.set(label, []);
        byLabel.get(label).push(item);
      }

      const order = spec.structure.rowGroupOrder || [];
      const seen = Array.from(byLabel.keys());
      const ordered = order.filter((label) => byLabel.has(label))
        .concat(seen.filter((label) => order.indexOf(label) < 0));

      groups = ordered.map((label) => ({ label: label, id: label, items: byLabel.get(label) }));
    } else {
      groups = [{ label: null, id: null, items: displayRows }];
    }

    model.groups = groups.map((g) => ({ id: g.id, label: g.label, count: g.items.length }));

    /* ---- Emit ---- */

    let stripeIndex = 0;

    for (const group of groups) {
      if (group.label !== null && !model.groupAsColumn) {
        const loc = { part: 'row_groups', groupId: group.id };
        out.push({
          kind: 'group',
          groupId: group.id,
          groupLabel: group.label,
          span: model.cols.length,
          style: StyleRules.resolve(ctx.rules, loc),
          marks: Compute.marksFor(ctx.footnoteIndex, loc),
          cells: []
        });
      }

      group.items.forEach((item, indexInGroup) => {
        out.push(Compute.buildDataRow(item, group, indexInGroup, stripeIndex, ctx));
        stripeIndex += 1;
      });

      // Group summaries.
      for (const summary of spec.summaries.groups) {
        const rows = Compute.summaryRows(summary, group.items, 'summary', ctx, group);
        out.push.apply(out, rows);
      }
    }

    // Grand summaries, over every displayed row.
    for (const summary of spec.summaries.grand) {
      const rows = Compute.summaryRows(summary, displayRows, 'grand_summary', ctx, null);
      out.push.apply(out, rows);
    }

    return out;
  },

  /** One data row. */
  buildDataRow(item, group, indexInGroup, stripeIndex, ctx) {
    const spec = ctx.spec;
    const model = ctx.model;
    const row = item.row;
    const srcIndex = item.srcIndex;
    const cells = [];

    const textOf = (colId) => Compute.formatValue(row[colId], colId, srcIndex, ctx).text;

    for (const col of model.cols) {
      if (col.kind === 'group') {
        // Only the first row of a group carries the label, and it spans down.
        cells.push({
          kind: 'group-col',
          colId: col.colId,
          text: indexInGroup === 0 ? String(group.label === null ? '' : group.label) : null,
          rowspan: indexInGroup === 0 ? group.items.length : 0,
          align: 'left',
          style: indexInGroup === 0
            ? StyleRules.resolve(ctx.rules, { part: 'row_groups', groupId: group.id })
            : null,
          marks: []
        });
        continue;
      }

      const part = col.kind === 'stub' ? 'stub' : 'body';
      const loc = { part: part, colId: col.kind === 'stub' ? undefined : col.colId, srcIndex: srcIndex };

      const mergeEntry = ctx.merged.byTarget[col.colId];
      let formatted;
      if (mergeEntry) {
        formatted = { text: Compute.mergeText(mergeEntry, textOf), isMarkup: true };
      } else {
        formatted = Compute.formatValue(row[col.colId], col.colId, srcIndex, ctx);
      }

      const color = col.kind === 'body' ? Compute.colorFor(row[col.colId], col.colId, srcIndex, ctx) : null;

      cells.push({
        kind: col.kind === 'stub' ? 'stub' : 'body',
        colId: col.colId,
        text: formatted.text,
        raw: row[col.colId],
        missing: !!formatted.missing,
        isMarkup: formatted.isMarkup,
        align: col.align,
        indent: col.kind === 'stub' ? (spec.structure.stubIndent[srcIndex] || 0) : 0,
        style: StyleRules.resolve(ctx.rules, loc),
        color: color,
        marks: Compute.marksFor(ctx.footnoteIndex, loc)
      });
    }

    const stripeOn = spec.options['row.striping.include_table_body'];

    return {
      kind: 'data',
      srcIndex: srcIndex,
      groupId: group.id,
      groupLabel: group.label,
      indexInGroup: indexInGroup,
      isFirstInGroup: indexInGroup === 0,
      isLastInGroup: indexInGroup === group.items.length - 1,
      stripe: !!stripeOn && (stripeIndex % 2 === 1),
      cells: cells
    };
  },

  /**
   * Build the rows for one summary definition. A definition with several
   * functions produces several rows, as gt does.
   */
  summaryRows(summary, items, part, ctx, group) {
    const model = ctx.model;
    const fns = (summary.fns && summary.fns.length ? summary.fns : ['sum']);
    const columns = new Set((summary.columns || []).filter((id) => ctx.columnsById[id]));
    const out = [];

    for (const fnId of fns) {
      const def = Compute.SUMMARY_FNS.find((f) => f.id === fnId);
      if (!def) continue;

      const label = (summary.labels && summary.labels[fnId]) || def.label;
      const cells = [];

      // A summary row has no row index and there is one per group, so the
      // group is part of what identifies it — `StyleRules.PARTS` says as much
      // for `summary` (`groups: true`), and `locationKey` honours that. A
      // grand summary spans every group and carries none.
      const summaryLoc = (colId) => ({
        part: part,
        colId: colId,
        groupId: group ? group.id : undefined
      });

      for (const col of model.cols) {
        if (col.kind === 'group') {
          cells.push({ kind: 'group-col', colId: col.colId, text: null, rowspan: 0, style: null, marks: [] });
          continue;
        }

        if (col.kind === 'stub') {
          // The label cell is where someone footnotes the summary itself
          // ("Mean¹"), so it takes marks like any other cell — it used to
          // hardcode an empty list, which meant a footnote attached here
          // reached the footer and was anchored nowhere.
          cells.push({
            kind: part === 'grand_summary' ? 'grand-stub' : 'summary-stub',
            colId: col.colId,
            text: label,
            isMarkup: true,
            align: 'left',
            style: StyleRules.resolve(ctx.rules, { part: part }),
            marks: Compute.marksFor(ctx.footnoteIndex, summaryLoc(col.colId))
          });
          continue;
        }

        let text = '';
        let raw = null;
        if (columns.has(col.colId)) {
          const nums = items
            .map((item) => Util.toNumber(item.row[col.colId]))
            .filter((n) => n !== null);
          if (nums.length) {
            raw = def.fn(nums);
            const formatType = summary.format || 'number';
            const formatOpts = summary.formatOpts || { decimals: fnId === 'n' ? 0 : 2 };
            const formatted = Formatters.apply(formatType, raw, formatOpts, {});
            text = formatted === null ? String(raw) : formatted;
          }
        }

        const loc = summaryLoc(col.colId);
        cells.push({
          kind: part === 'grand_summary' ? 'grand' : 'summary',
          colId: col.colId,
          text: text,
          raw: raw,
          isMarkup: true,
          align: col.align,
          style: StyleRules.resolve(ctx.rules, loc),
          marks: Compute.marksFor(ctx.footnoteIndex, loc)
        });
      }

      // With no stub there is nowhere to put the label, so it goes in the first
      // column instead — otherwise the row is unreadable.
      if (!model.stubColId && cells.length) {
        const first = cells.find((c) => c.kind !== 'group-col');
        if (first && !first.text) first.text = label;
      }

      out.push({
        kind: part === 'grand_summary' ? 'grand' : 'summary',
        summaryId: summary.id,
        fn: fnId,
        label: label,
        groupId: group ? group.id : null,
        cells: cells
      });
    }

    return out;
  }
};
