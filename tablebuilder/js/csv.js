/**
 * csv.js
 *
 * CSV/TSV import: parse with PapaParse, assign stable column ids, and infer a
 * type per column. Produces the `source` section of a TableSpec.
 *
 * Column ids are slugs of the header, deduplicated. The original header is kept
 * as `name` so exports and the UI can show what was actually in the file, while
 * everything internal refers to the id.
 */

const Csv = {

  /** A column is treated as numeric when at least this share of non-missing values parse. */
  TYPE_THRESHOLD: 0.85,

  /** Rows beyond this are still kept, but the preview warns and samples for inference. */
  INFER_SAMPLE: 500,

  /**
   * Parse CSV/TSV text into a `source` object.
   * @param {string} text
   * @param {string} filename
   * @param {Object} [opts] - {delimiter} to force a delimiter
   * @returns {{filename, delimiter, columns, rows, warnings}}
   */
  parse(text, filename, opts) {
    opts = opts || {};
    const grid = Csv.toGrid(text, opts);
    return Csv.fromTable(grid.rows, {
      headerRows: opts.headerRows === undefined ? 1 : opts.headerRows,
      filename: filename || 'data.csv',
      delimiter: grid.delimiter,
      warnings: grid.warnings
    }).source;
  },

  /**
   * Delimited text into a grid of strings — the parsing half only.
   *
   * Separate from `fromTable` so the import preview can show what was found
   * and ask about the header before anything is committed to a source.
   *
   * @returns {{rows, delimiter, warnings}}
   */
  toGrid(text, opts) {
    opts = opts || {};

    const result = Papa.parse(text, {
      header: false,
      skipEmptyLines: 'greedy',
      delimiter: opts.delimiter || '',      // '' lets Papa sniff it
      dynamicTyping: false,                 // we do our own inference
      transform: (value) => value.trim()
    });

    const warnings = [];
    if (result.errors && result.errors.length) {
      // Papa reports one error per bad row; summarise rather than flooding.
      const kinds = Util.unique(result.errors.map((e) => e.code || e.type));
      warnings.push(result.errors.length + ' parse issue(s): ' + kinds.join(', '));
    }

    return {
      rows: result.data,
      delimiter: result.meta && result.meta.delimiter ? result.meta.delimiter : ',',
      warnings: warnings
    };
  },

  /**
   * A grid of text into a `source`, plus any spanners its header implies.
   *
   * **Every importer ends here.** CSV, TSV and a pasted HTML table differ in
   * how they get to a rectangle of strings and in nothing after it, so column
   * ids, ragged-row repair, type inference and header handling live in one
   * place rather than once per format.
   *
   * @param {Array<Array>} grid - rows of cell text, ragged is fine
   * @param {Object} [opts]
   * @param {number} [opts.headerRows=1] - 0 means "no header, name the columns"
   * @param {Object} [opts.origin] - {kind, label} for a non-file source
   * @returns {{source, spanners}}
   */
  fromTable(grid, opts) {
    opts = opts || {};
    const warnings = (opts.warnings || []).slice();

    const table = (grid || [])
      .map((row) => (row || []).map((cell) =>
        String(cell === null || cell === undefined ? '' : cell).trim()))
      .filter((row) => row.some((cell) => cell !== ''));
    if (!table.length) throw new Error('There are no rows here.');

    // Ragged input is padded to the widest row rather than to the header's
    // width: a header narrower than its data would otherwise silently drop
    // columns, which a paste from a spreadsheet range does routinely.
    const width = table.reduce((max, row) => Math.max(max, row.length), 0);
    for (const row of table) {
      while (row.length < width) row.push('');
    }

    // Consuming every row as a header leaves nothing to show, and quietly
    // demoting one to data would hide the mistake. The way out is to say there
    // is no header — which the import preview offers — not to guess.
    const headerRows = opts.headerRows === undefined ? 1 : Math.max(0, Math.round(opts.headerRows));
    if (headerRows >= table.length) {
      throw new Error(headerRows === 1
        ? 'That has a header but no data rows.'
        : 'All ' + table.length + ' row(s) would be header. Reduce the header rows.');
    }

    const labels = headerRows > 0
      ? table[headerRows - 1]
      : Csv.generatedNames(width);
    const body = table.slice(headerRows);

    const columns = Csv.buildColumns(labels, warnings);
    const rows = Csv.buildRows(columns, body, warnings);
    for (const col of columns) {
      col.type = Csv.inferType(rows, col.id);
      // Recorded here because this is the only place that sees the whole
      // column at once, and one `14/05/2013` in it settles how every other
      // value is read. See `Csv.inferDateOrder`.
      const order = Csv.inferDateOrder(rows, col.id);
      if (order) col.dateOrder = order;
      const sep = Csv.inferDateSeparator(rows, col.id);
      if (sep) col.dateSeparator = sep;
      const clock = Csv.inferDateClock(rows, col.id);
      if (clock) col.dateClock = clock;
    }

    const spanners = Csv.spannersFrom(table.slice(0, Math.max(0, headerRows - 1)), columns);

    const source = {
      filename: opts.filename || 'data.csv',
      delimiter: opts.delimiter || ',',
      columns: columns,
      rows: rows,
      warnings: warnings
    };
    if (opts.origin) source.origin = opts.origin;

    return { source: source, spanners: spanners };
  },

  /** Placeholder column names, for a grid with no header row of its own. */
  generatedNames(width) {
    const names = [];
    for (let i = 0; i < width; i += 1) names.push('Column ' + (i + 1));
    return names;
  },

  /**
   * Spanners implied by the header rows above the labels.
   *
   * A run of the same text across adjacent columns is a column group: that is
   * what a `colspan` becomes once the grid is expanded, and what a
   * two-row CSV header means when someone types the group once and leaves the
   * rest blank... except they usually repeat it, which is the case this reads.
   *
   * Runs of one are ignored. A single cell above one column is far more often
   * a stray note than a group of one, and gt draws nothing useful for it.
   *
   * Level 1 sits directly above the labels (see `Compute.buildHeader`), so the
   * rows are numbered upward from the bottom.
   */
  spannersFrom(headerRows, columns) {
    const out = [];

    headerRows.forEach((row, index) => {
      const level = headerRows.length - index;
      let start = 0;
      while (start < columns.length) {
        const text = (row[start] || '').trim();
        let end = start;
        while (end + 1 < columns.length && (row[end + 1] || '').trim() === text) end += 1;

        if (text && end > start) {
          out.push({
            id: Util.uid('sp'),
            label: text,
            columns: columns.slice(start, end + 1).map((c) => c.id),
            level: level
          });
        }
        start = end + 1;
      }
    });

    return out;
  },

  /** Turn a header row into column descriptors with unique ids. */
  buildColumns(header, warnings) {
    const used = new Set();
    let blanks = 0;
    let dupes = 0;

    const columns = header.map((raw, index) => {
      let name = String(raw === null || raw === undefined ? '' : raw).trim();
      if (!name) {
        name = 'column_' + (index + 1);
        blanks += 1;
      }

      let id = Util.slug(name);
      if (used.has(id)) {
        dupes += 1;
        let n = 2;
        while (used.has(id + '_' + n)) n += 1;
        id = id + '_' + n;
      }
      used.add(id);

      return { id: id, name: name, index: index, type: 'text' };
    });

    if (blanks) warnings.push(blanks + ' column(s) had no header and were auto-named.');
    if (dupes) warnings.push(dupes + ' duplicate column name(s) were given a numeric suffix.');

    return columns;
  },

  /** Map raw rows onto column ids, padding or trimming ragged rows. */
  buildRows(columns, body, warnings) {
    let ragged = 0;
    const rows = body.map((cells) => {
      if (cells.length !== columns.length) ragged += 1;
      const row = {};
      for (let i = 0; i < columns.length; i += 1) {
        const value = cells[i];
        row[columns[i].id] = value === undefined ? '' : value;
      }
      return row;
    });
    if (ragged) {
      warnings.push(ragged + ' row(s) did not match the header width and were padded or trimmed.');
    }
    return rows;
  },

  /**
   * Infer a column type by sampling values.
   * Order matters: bool before number so 0/1 columns stay numeric only when
   * they are not clearly boolean, and date before text.
   */
  inferType(rows, colId) {
    const sample = rows.length > Csv.INFER_SAMPLE ? rows.slice(0, Csv.INFER_SAMPLE) : rows;
    let seen = 0;
    let numbers = 0;
    let dates = 0;
    let bools = 0;

    for (const row of sample) {
      const value = row[colId];
      if (Util.isMissing(value)) continue;
      seen += 1;
      if (Util.toNumber(value) !== null) numbers += 1;
      if (Csv.isBoolish(value)) bools += 1;
      if (Csv.isDateish(value)) dates += 1;
    }

    if (!seen) return 'text';
    const share = (n) => n / seen;

    if (share(bools) >= Csv.TYPE_THRESHOLD) return 'bool';
    if (share(numbers) >= Csv.TYPE_THRESHOLD) return 'number';
    if (share(dates) >= Csv.TYPE_THRESHOLD) return 'date';
    return 'text';
  },

  /** Recognise the usual boolean spellings. Bare 0/1 does not count. */
  isBoolish(value) {
    const str = String(value).trim().toLowerCase();
    return str === 'true' || str === 'false' || str === 'yes' || str === 'no' ||
      str === 't' || str === 'f';
  },

  /**
   * Recognise unambiguous date shapes only, by asking whether one parses.
   *
   * **Recognising and parsing must be the same question.** They were two, and
   * they disagreed: this accepted `14/05/2013` on a regex while
   * `Formatters.parseDate` handed it to `new Date`, which reads a slashed date
   * month-first and called it invalid. So the column typed as dates and then
   * the Date format did nothing to it — and `import-html.js`, which asks this
   * before deciding whether to take a cell's underlying value, swapped it for
   * its spreadsheet serial number.
   *
   * `Util.toDate` is deliberately narrow about what a date looks like — it
   * takes no bare number and no bare month name — which is what makes it safe
   * to ask here, where a wrong yes mis-types a whole column.
   */
  isDateish(value) {
    return Util.toDate(value) !== null;
  },

  /**
   * Which way round a column writes `3/05/2016`, where the column says.
   *
   * `d/m/y` and `m/d/y` are both in the wild and no single value distinguishes
   * them — but a column usually contains one that does. One `14/05/2013`
   * anywhere in a column of publication dates makes every `3/05/2016` beside it
   * the third of May, and there is nothing to ask the user.
   *
   * Recorded on the column rather than worked out per value, so the whole
   * column reads one way. Per value, the same column had `14/05/2013` in May
   * and `3/05/2016` in March.
   *
   * A column that says nothing gets no answer rather than a guess; the Date
   * format offers the setting for those.
   *
   * @returns {'dmy'|'mdy'|null}
   */
  inferDateOrder(rows, colId) {
    const sample = rows.length > Csv.INFER_SAMPLE ? rows.slice(0, Csv.INFER_SAMPLE) : rows;
    let dayFirst = 0;
    let monthFirst = 0;

    for (const row of sample) {
      const value = row[colId];
      if (Util.isMissing(value)) continue;
      // The *date* part: a value carrying a clock is still a value that says
      // which number is the day. Matching the whole string meant a column of
      // `14/05/2013 09:05` reported no order at all, so `Util.toDate` fell
      // back to month-first and read every `3/05/2016` beside it as March.
      const match = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}$/
        .exec(Util.splitTime(String(value).trim()).date.trim());
      if (!match) continue;
      const first = Number(match[1]);
      const second = Number(match[2]);
      if (first > 12 && second <= 12) dayFirst += 1;
      else if (second > 12 && first <= 12) monthFirst += 1;
    }

    // A column holding both is not a column with an order; it is a column with
    // a problem, and guessing would settle half of it wrongly and say nothing.
    if (dayFirst && !monthFirst) return 'dmy';
    if (monthFirst && !dayFirst) return 'mdy';
    return null;
  },

  /**
   * Which character a column's dates are written with, or null.
   *
   * `14/05/2013` and `14-05-2013` are both day-first, and nothing that reads
   * them here has to care — `Util.toDate` takes either. **R does.**
   * `as.Date(x, format = "%d/%m/%Y")` returns `NA` for the dashed one, and a
   * column of `NA` sorts as one block, so the exported table came out in a
   * different order from the preview. Recorded beside `dateOrder`, in the one
   * place that sees the whole column at once, and for the same reason.
   *
   * Null where the column is ISO or says nothing consistent: `as.Date` reads
   * ISO with no format at all, which is also the shorter thing to emit.
   *
   * @returns {'/'|'-'|'.'|null}
   */
  inferDateSeparator(rows, colId) {
    const sample = rows.length > Csv.INFER_SAMPLE ? rows.slice(0, Csv.INFER_SAMPLE) : rows;
    const seen = {};

    for (const row of sample) {
      const value = row[colId];
      if (Util.isMissing(value)) continue;
      const match = /^\d{1,2}([-/.])\d{1,2}\1\d{2,4}$/
        .exec(Util.splitTime(String(value).trim()).date.trim());
      if (match) seen[match[1]] = (seen[match[1]] || 0) + 1;
    }

    const found = Object.keys(seen);
    // Two separators in one column is not a separator, the same way two
    // day/month orders in one column is not an order.
    return found.length === 1 ? found[0] : null;
  },

  /**
   * The clock shape a column's values carry, as an `strptime` fragment, or null.
   *
   * The third fact R needs and nothing here does. `Util.toDate` reads
   * `09:05`, `09:05:30` and `9:05 pm` without being told which; `as.Date` and
   * `as.POSIXct` want one format, and one that stops short of the clock throws
   * the time away — so two rows on the same day tie in the exported table and
   * are ordered in the preview.
   *
   * Only the two unambiguous shapes, and only when the column is all one of
   * them: an am/pm or offset-bearing column returns null and the exporter
   * falls back rather than emitting a format that quietly mis-parses.
   *
   * @returns {'%H:%M'|'%H:%M:%S'|null}
   */
  inferDateClock(rows, colId) {
    const sample = rows.length > Csv.INFER_SAMPLE ? rows.slice(0, Csv.INFER_SAMPLE) : rows;
    const seen = {};

    for (const row of sample) {
      const value = row[colId];
      if (Util.isMissing(value)) continue;
      const split = Util.splitTime(String(value).trim());
      if (!split.time || !split.date) continue;
      const clock = /^\s*\d{1,2}:\d{2}:\d{2}\s*$/.test(String(value).slice(split.date.length))
        ? '%H:%M:%S'
        : (/^\s*\d{1,2}:\d{2}\s*$/.test(String(value).slice(split.date.length)) ? '%H:%M' : 'other');
      seen[clock] = (seen[clock] || 0) + 1;
    }

    const found = Object.keys(seen);
    if (found.length !== 1 || found[0] === 'other') return null;
    return found[0];
  },

  /** Serialise a resolved table back out as CSV (used by the export panel). */
  /**
   * The table as rendered, as CSV.
   *
   * Not the imported data — the `ResolvedModel`, so every column rename,
   * reorder, hide and merge, every sort, and every `fmt_*` result is already
   * in it. What you get is what is on screen, one row per rendered row.
   *
   * Two things a CSV has no way to show are folded into columns instead of
   * being dropped: a row group becomes one, and the stub's header takes the
   * stubhead. A group that renders as a spanning label row has no column at
   * all and is given one; a group shown as a column already has one, but
   * names itself only on the group's first row and is filled down — a CSV has
   * no rowspan either. Group and summary rows are kept — a subtotal is part
   * of what is rendered — with a label column saying which is which when
   * there is anything but plain data rows.
   *
   * Lives here rather than in the export menu so it can be tested without a
   * DOM, and because turning things into CSV is this file's whole job.
   */
  fromModel(model) {
    const GROUP = '__group__';
    const KIND = '__kind__';

    const asColumn = model.cols.some((col) => col.kind === 'group');
    const grouped = model.rows.some((row) => row.kind === 'group');
    const extraRows = model.rows.some((row) => row.kind === 'summary' || row.kind === 'grand');

    const columns = [];
    // A group that renders as its own spanning row has no column in the model,
    // so it would vanish from a CSV. Give it one, ahead of everything else.
    if (grouped && !asColumn) columns.push({ id: GROUP, label: 'Group' });
    if (extraRows) columns.push({ id: KIND, label: 'Row type' });

    for (const col of model.cols) {
      columns.push({
        id: col.colId,
        label: col.kind === 'stub' ? (model.stubhead || col.label || col.colId) : col.label
      });
    }

    // `model.groups` is the one place that knows a group's name, so neither
    // form reads it off a rendered cell: a spanning label row carries
    // `groupLabel` and no cells at all, and the column form carries the text
    // on only the first row of the group. Keying by id also gets summary rows
    // their group, and does not depend on row order.
    const groupLabels = {};
    for (const group of model.groups || []) {
      if (group.id === null || group.id === undefined) continue;
      const label = group.label;
      groupLabels[group.id] = Markup.toPlain(
        label === null || label === undefined ? '' : String(label));
    }

    const rows = [];

    for (const row of model.rows) {
      if (row.kind === 'group') continue;

      const out = {};
      if (grouped && !asColumn) out[GROUP] = groupLabels[row.groupId] || '';
      if (extraRows) out[KIND] = row.kind === 'data' ? '' : row.kind;

      for (let i = 0; i < row.cells.length; i += 1) {
        const cell = row.cells[i];
        // A stub cell carries no `colId`, deliberately: `compute.js` resolves
        // one with `colId: undefined` so that a style rule targeting the stub
        // means *the row labels* rather than the column they were taken from.
        // So it is matched by position instead. Keying on `cell.colId` alone
        // silently emitted an empty row-label column.
        const col = cell.colId
          ? model.cols.find((c) => c.colId === cell.colId)
          : model.cols[i];
        if (!col) continue;
        const text = cell.text !== undefined && cell.text !== null ? cell.text : cell.label;
        out[col.colId] = Markup.toPlain(text === null || text === undefined ? '' : text);
      }

      // A group's name belongs on every row of the group, and a CSV has no
      // rowspan to carry it down: as a column only the first row of the group
      // holds the text, the rest being absorbed by the label's span. Written
      // after the cells, so it replaces the blank rather than racing it. A
      // grand summary is in no group and keeps its blank.
      if (asColumn) out[model.groupColId] = groupLabels[row.groupId] || '';

      rows.push(out);
    }

    return Csv.toCsv(columns, rows);
  },

  toCsv(columns, rows) {
    const escape = (value) => {
      const str = value === null || value === undefined ? '' : String(value);
      return /[",\n\r]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
    };
    const lines = [columns.map((c) => escape(c.label || c.name || c.id)).join(',')];
    for (const row of rows) {
      lines.push(columns.map((c) => escape(row[c.id])).join(','));
    }
    return lines.join('\r\n');
  }
};
