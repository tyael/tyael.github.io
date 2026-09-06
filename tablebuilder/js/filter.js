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
   * Text comparison is case-insensitive throughout, and **both sides of it are
   * folded in the R as well as in the test**. `tolower()` went around the
   * column alone, and the operand went over as the user typed it: a filter for
   * `HIGH` kept every `high` row in the preview and emitted
   * `tolower(note) == "HIGH"`, which is true of nothing. The table on screen
   * had rows in it and the exported one came out empty — the exact failure the
   * note above says is the worst this app can be. Every text operator now
   * writes its operand through `Filter.lower`, which is the same function the
   * test uses, rather than through a `toLowerCase` remembered per operator:
   * two of the eleven remembered it and the rest did not.
   */
  OPS: [
    { id: 'eq', label: 'is', arity: 1,
      test: (v, a, num) => (num ? Util.toNumber(v) === Util.toNumber(a) : Filter.lower(v) === Filter.lower(a)),
      r: (col, a, b, num) => (num ? col + ' == ' + a
        : 'tolower(' + col + ') == ' + Filter.rStr(Filter.lower(a))) },

    { id: 'ne', label: 'is not', arity: 1,
      test: (v, a, num) => (num ? Util.toNumber(v) !== Util.toNumber(a) : Filter.lower(v) !== Filter.lower(a)),
      r: (col, a, b, num) => (num ? col + ' != ' + a
        : 'tolower(' + col + ') != ' + Filter.rStr(Filter.lower(a))) },

    { id: 'contains', label: 'contains', arity: 1,
      test: (v, a) => Filter.lower(v).indexOf(Filter.lower(a)) >= 0,
      r: (col, a) => 'grepl(' + Filter.rStr(Filter.lower(a)) +
        ', tolower(' + col + '), fixed = TRUE)' },

    { id: 'not_contains', label: 'does not contain', arity: 1,
      test: (v, a) => Filter.lower(v).indexOf(Filter.lower(a)) < 0,
      r: (col, a) => '!grepl(' + Filter.rStr(Filter.lower(a)) +
        ', tolower(' + col + '), fixed = TRUE)' },

    { id: 'gt', label: 'is greater than', arity: 1,
      test: (v, a, num) => Filter.compare(v, a, num) > 0,
      r: (col, a, b, num) => Filter.rOrder('gt', '>', col, a, num) },

    { id: 'gte', label: 'is at least', arity: 1,
      test: (v, a, num) => Filter.compare(v, a, num) >= 0,
      r: (col, a, b, num) => Filter.rOrder('ge', '>=', col, a, num) },

    { id: 'lt', label: 'is less than', arity: 1,
      test: (v, a, num) => Filter.compare(v, a, num) < 0,
      r: (col, a, b, num) => Filter.rOrder('lt', '<', col, a, num) },

    { id: 'lte', label: 'is at most', arity: 1,
      test: (v, a, num) => Filter.compare(v, a, num) <= 0,
      r: (col, a, b, num) => Filter.rOrder('le', '<=', col, a, num) },

    { id: 'between', label: 'is between', arity: 2,
      test: (v, a, num, b) => Filter.compare(v, a, num) >= 0 && Filter.compare(v, b, num) <= 0,
      r: (col, a, b, num) => Filter.rOrder('ge', '>=', col, a, num) +
        ' & ' + Filter.rOrder('le', '<=', col, b, num) },

    { id: 'empty', label: 'is empty', arity: 0,
      test: (v) => Util.isMissing(v),
      r: (col) => 'is.na(' + col + ') | ' + col + ' == ""' },

    { id: 'not_empty', label: 'is not empty', arity: 0,
      test: (v) => !Util.isMissing(v),
      r: (col) => '!(is.na(' + col + ') | ' + col + ' == "")' }
  ],


  /** A new condition, defaulting to the first column. */
  newCondition(colId) {
    return { id: Util.uid('flt'), col: colId || null, op: 'eq', value: '', value2: '' };
  },

  get(id) {
    return Filter.OPS.find((op) => op.id === id) || Filter.OPS[0];
  },

  /**
   * A value as every text operator compares it: what it draws, trimmed and
   * case-folded.
   *
   * Through `Markup.toPlain`, so a cell showing CO₂ is found by searching
   * for `CO2` rather than for `CO_{2}` — nobody can see the second one. It
   * normalises the operand as well as the cell, which is what makes the two
   * ends of every comparison the same kind of thing.
   */
  lower(value) {
    return Markup.toPlain(value).trim().toLowerCase();
  },

  /** The column as the ordering operators compare it. */
  rSide(col, numeric) {
    return numeric ? col : 'tolower(' + col + ')';
  },

  /**
   * ICU's spelling of `Filter.COLLATE`, for the R.
   *
   * `numeric = TRUE` is `{numeric: true}` and `strength = 1L` is
   * `{sensitivity: 'base'}` — the same two settings, named the way the library
   * on that side names them. Written out at each use rather than assigned to a
   * variable at the top of the script: `dplyr::filter()` evaluates in a data
   * mask, so a column called `text_order` would be found in place of the
   * options and the comparison would fail on something nobody could see. A
   * function like `plain_text` is safe there — R skips non-function bindings
   * when it resolves a call — but a value is not.
   */
  R_COLLATOR: 'stringi::stri_opts_collator(numeric = TRUE, strength = 1L)',

  /**
   * One ordering comparison, as R.
   *
   * A number column compares with the operator itself. A text column cannot:
   * R's `>` on a character vector collates by the reader's locale, which reads
   * the digits in `Study 10` as characters and would put it before `Study 2`
   * — the order the preview stopped using. `stringi` is where R keeps the same
   * ICU collation the browser compares with, and it takes the two settings by
   * name.
   *
   * Fully qualified rather than added to the preamble, as `stringr::str_rank`
   * is: a table with no text ordering carries no dependency it does not use.
   * `stringi` is `stringr`'s own, so a script that can sort text can run this.
   */
  rOrder(name, symbol, col, value, numeric) {
    if (numeric) return Filter.rSide(col, true) + ' ' + symbol + ' ' + Filter.rOperand(value, true);
    return 'stringi::stri_cmp_' + name + '(' + Filter.rSide(col, false) + ', ' +
      Filter.rOperand(value, false) + ', opts_collator = ' + Filter.R_COLLATOR + ')';
  },

  /** The operand, folded the same way the cell it is compared against is. */
  rOperand(value, numeric) {
    return numeric ? value : Filter.rStr(Filter.lower(value));
  },

  /**
   * Ordering options: `Compute.sortRows`'s, because there is one right answer
   * to "which of these two comes first" and a table may not hold two.
   *
   * This used to be a bare `localeCompare`, and the table contradicted itself
   * in public: sorted ascending it drew Study 2 above Study 10, while "is at
   * least Study 10" *kept* Study 2 — the sort read the digits as a number and
   * the filter read them as characters. The kept rows were then not a suffix
   * of the sorted order, on screen, at the same time. `café` and `cafe` were
   * the same value to one and different to the other.
   */
  COLLATE: { numeric: true, sensitivity: 'base' },

  /**
   * Compare a cell against an operand, numerically when the column is numbers
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
    return Filter.lower(cell).localeCompare(Filter.lower(operand), undefined, Filter.COLLATE);
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

  /**
   * One condition's operator and values in words: *is between 5 and 10*.
   *
   * The column is deliberately not in here. Naming a column is
   * `Pipeline.name`'s job, and the version of this that did it read
   * `column.label` off `columnsById` — which hands back the *raw* columns,
   * carrying `name`. It would have rendered "undefined is greater than 5",
   * and never did only because nothing called it after the cutover.
   *
   * Both places that put a condition into words go through this, so a
   * two-value operator cannot lose its second value in one of them — the
   * Shape panel's own copy dropped `value2`, so *is between 5 and 10* read as
   * *is between 5*.
   */
  phrase(condition) {
    const op = Filter.get(condition.op);
    if (!op) return String(condition.op || '');
    if (op.arity === 0) return op.label;
    if (op.arity === 2) {
      return op.label + ' ' + condition.value + ' and ' + condition.value2;
    }
    return op.label + (condition.value ? ' ' + condition.value : '');
  }
};
