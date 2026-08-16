/**
 * filter.js
 *
 * Which rows appear in the table.
 *
 * A filter is a list of conditions on columns, combined with all/any. That
 * shape rather than a free expression because filtering is the most ordinary
 * thing anyone will want to do to a table, and "p value is less than 0.05"
 * should not require knowing how to write it in JavaScript. (Style rules keep
 * their `where` expression: they are a different, later, more advanced job.)
 *
 * **Each operator declares its test and its R form together.** The preview
 * evaluates the test; `export-rgt.js` emits the R. Two lists would drift, and a
 * filter that silently means something different in the exported code than in
 * the table on screen is the worst kind of wrong this app can be.
 */

const Filter = {

  /**
   * The operators, in menu order.
   *
   *   arity   how many values the condition needs
   *   test    (cell, a, b, numeric) -> boolean, for the preview
   *   r       (col, a, b, numeric) -> R source, for the export
   *
   * Text comparison is case-insensitive throughout, and `tolower()` goes into
   * the R so both agree. Someone filtering for "north" means the rows that say
   * "North", and a filter that is quietly case-sensitive reads as a filter
   * that is quietly broken.
   */
  OPS: [
    { id: 'eq', label: 'is', arity: 1,
      test: (v, a, num) => (num ? Util.toNumber(v) === Util.toNumber(a) : Filter.lower(v) === Filter.lower(a)),
      r: (col, a, b, num) => (num ? col + ' == ' + a : 'tolower(' + col + ') == ' + Filter.rStr(a)) },

    { id: 'ne', label: 'is not', arity: 1,
      test: (v, a, num) => (num ? Util.toNumber(v) !== Util.toNumber(a) : Filter.lower(v) !== Filter.lower(a)),
      r: (col, a, b, num) => (num ? col + ' != ' + a : 'tolower(' + col + ') != ' + Filter.rStr(a)) },

    { id: 'contains', label: 'contains', arity: 1,
      test: (v, a) => Filter.lower(v).indexOf(Filter.lower(a)) >= 0,
      r: (col, a) => 'grepl(' + Filter.rStr(String(a).toLowerCase()) + ', tolower(' + col + '), fixed = TRUE)' },

    { id: 'not_contains', label: 'does not contain', arity: 1,
      test: (v, a) => Filter.lower(v).indexOf(Filter.lower(a)) < 0,
      r: (col, a) => '!grepl(' + Filter.rStr(String(a).toLowerCase()) + ', tolower(' + col + '), fixed = TRUE)' },

    { id: 'gt', label: 'is greater than', arity: 1,
      test: (v, a, num) => Filter.compare(v, a, num) > 0,
      r: (col, a, b, num) => col + ' > ' + (num ? a : Filter.rStr(a)) },

    { id: 'gte', label: 'is at least', arity: 1,
      test: (v, a, num) => Filter.compare(v, a, num) >= 0,
      r: (col, a, b, num) => col + ' >= ' + (num ? a : Filter.rStr(a)) },

    { id: 'lt', label: 'is less than', arity: 1,
      test: (v, a, num) => Filter.compare(v, a, num) < 0,
      r: (col, a, b, num) => col + ' < ' + (num ? a : Filter.rStr(a)) },

    { id: 'lte', label: 'is at most', arity: 1,
      test: (v, a, num) => Filter.compare(v, a, num) <= 0,
      r: (col, a, b, num) => col + ' <= ' + (num ? a : Filter.rStr(a)) },

    { id: 'between', label: 'is between', arity: 2,
      test: (v, a, num, b) => Filter.compare(v, a, num) >= 0 && Filter.compare(v, b, num) <= 0,
      r: (col, a, b, num) => col + ' >= ' + (num ? a : Filter.rStr(a)) +
        ' & ' + col + ' <= ' + (num ? b : Filter.rStr(b)) },

    { id: 'empty', label: 'is empty', arity: 0,
      test: (v) => Util.isMissing(v),
      r: (col) => 'is.na(' + col + ') | ' + col + ' == ""' },

    { id: 'not_empty', label: 'is not empty', arity: 0,
      test: (v) => !Util.isMissing(v),
      r: (col) => '!(is.na(' + col + ') | ' + col + ' == "")' }
  ],

  /** A filter that keeps everything. */
  empty() {
    return { match: 'all', conditions: [] };
  },

  /** A new condition, defaulting to the first column. */
  newCondition(colId) {
    return { id: Util.uid('flt'), col: colId || null, op: 'eq', value: '', value2: '' };
  },

  get(id) {
    return Filter.OPS.find((op) => op.id === id) || Filter.OPS[0];
  },

  lower(value) {
    return String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  },

  /**
   * Compare a cell against a operand, numerically when both look like numbers
   * and as text otherwise — so `>` on a number column does what it should, and
   * on a text column still orders sensibly rather than throwing.
   */
  compare(cell, operand, numeric) {
    if (numeric) {
      const a = Util.toNumber(cell);
      const b = Util.toNumber(operand);
      if (a === null || b === null) return NaN;
      return a < b ? -1 : (a > b ? 1 : 0);
    }
    return Filter.lower(cell).localeCompare(Filter.lower(operand));
  },

  /** An R string literal. */
  rStr(value) {
    return '"' + String(value === null || value === undefined ? '' : value)
      .replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  },

  /** True when a condition is complete enough to mean anything. */
  usable(condition, columnsById) {
    if (!condition || !condition.col) return false;
    if (columnsById && !columnsById[condition.col]) return false;
    const op = Filter.get(condition.op);
    if (op.arity >= 1 && String(condition.value).trim() === '') return false;
    if (op.arity >= 2 && String(condition.value2).trim() === '') return false;
    return true;
  },

  /** The conditions that will actually be applied. */
  active(filter, columnsById) {
    if (!filter || !filter.conditions) return [];
    return filter.conditions.filter((c) => Filter.usable(c, columnsById));
  },

  /**
   * Test one row.
   *
   * A missing value fails every condition except `is empty` — the least
   * surprising rule, and the one that keeps "is not X" from quietly keeping
   * rows that have no value at all.
   */
  rowPasses(row, conditions, columnsById, match) {
    const results = conditions.map((condition) => {
      const op = Filter.get(condition.op);
      const cell = row[condition.col];
      const column = columnsById[condition.col];
      const numeric = !!(column && column.type === 'number');

      if (op.arity > 0 && Util.isMissing(cell)) return false;
      const passed = op.test(cell, condition.value, numeric, condition.value2);
      return passed === true;
    });

    if (!results.length) return true;
    return match === 'any' ? results.some(Boolean) : results.every(Boolean);
  },

  /**
   * Apply a filter to rows already paired with their source index.
   *
   * **`srcIndex` is never renumbered.** It identifies a row in the working
   * data, and style rules, footnote anchors and quick style rules are all
   * pinned to it — renumbering on filter would silently move every one of them
   * to a different row.
   *
   * @param {Array} displayRows - [{row, srcIndex}]
   * @returns {{rows, removed}}
   */
  apply(displayRows, filter, columnsById) {
    const conditions = Filter.active(filter, columnsById);
    if (!conditions.length) return { rows: displayRows, removed: 0 };

    const match = (filter && filter.match) === 'any' ? 'any' : 'all';
    const kept = displayRows.filter((item) =>
      Filter.rowPasses(item.row, conditions, columnsById, match));

    return { rows: kept, removed: displayRows.length - kept.length };
  },

  /** One condition in words, for a list item's title. */
  describe(condition, columnsById) {
    const column = columnsById && columnsById[condition.col];
    const name = column ? column.label : (condition.col || 'a column');
    const op = Filter.get(condition.op);
    if (op.arity === 0) return name + ' ' + op.label;
    if (op.arity === 2) return name + ' ' + op.label + ' ' + condition.value + ' and ' + condition.value2;
    return name + ' ' + op.label + ' ' + condition.value;
  }
};
