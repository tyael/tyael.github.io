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

    const table = result.data.filter((row) => row.some((cell) => cell !== ''));
    if (!table.length) throw new Error('That file has no rows.');

    const header = table[0];
    const body = table.slice(1);
    if (!body.length) throw new Error('That file has a header but no data rows.');

    const columns = Csv.buildColumns(header, warnings);
    const rows = Csv.buildRows(columns, body, warnings);

    for (const col of columns) {
      col.type = Csv.inferType(rows, col.id);
    }

    return {
      filename: filename || 'data.csv',
      delimiter: result.meta && result.meta.delimiter ? result.meta.delimiter : ',',
      columns: columns,
      rows: rows,
      warnings: warnings
    };
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
   * Recognise unambiguous date shapes only. Deliberately conservative: passing
   * arbitrary strings to `Date.parse` turns things like "March" or "12" into
   * dates and would mis-type ordinary text columns.
   */
  isDateish(value) {
    const str = String(value).trim();
    if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/.test(str) &&
        !/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(str) &&
        !/^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/.test(str)) {
      return false;
    }
    const parsed = Date.parse(str);
    return !isNaN(parsed);
  },

  /** Serialise a resolved table back out as CSV (used by the export panel). */
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
