/**
 * dates.js
 *
 * Reading a date column as ISO, before anything else runs.
 *
 * **A date column sorts, filters and groups by whatever its text spells**,
 * unless something reads it as a date first. `Compute.sortRows` does now, and
 * so does the emitted `arrange()` — but both work from one `strptime`-shaped
 * answer per column, and a column mixing `14/05/2013` with `2016-05-03` has no
 * such answer. Rewriting the values settles it at the source instead: after
 * this the column *is* ISO, and every reader downstream — this app's, R's, a
 * person's — agrees about it without being told anything.
 *
 * **It runs before the pipeline, and that is the whole design constraint.**
 * A pipeline step sees what the steps above it produced; this has to be true
 * of what *every* step reads, so it cannot be a step. `Spec.workingSource` is
 * the seam, and every caller of `Pipeline.run` goes through it.
 *
 * Two rules it shares with `Corrections.apply`, for the same reasons:
 *
 *   - **Never write through the input.** `source.rows` is shared by every
 *     entry in the undo history — that is what makes a 61-entry timeline cost
 *     0.8 MB instead of 158 — so touching it rewrites the past.
 *   - **Hand back the input itself when there is nothing to do**, because this
 *     is on the keystroke path: every panel that asks for the working columns
 *     comes through here.
 */

const Dates = {

  /** Single-slot memo: the rows, the columns that matter, and what was asked. */
  _memo: null,

  /** The column ids this spec asks to be normalised. */
  requested(spec) {
    return (spec && spec.dates && spec.dates.iso) || [];
  },

  /**
   * Can this column be normalised?
   *
   * Typed `date`, and nothing else. A spreadsheet-serial column is typed
   * `number` and carries dates too, but rewriting it would turn numbers into
   * strings behind the back of every format rule pointed at it — that column
   * wants a Date format, not this.
   */
  eligible(column) {
    return !!column && column.type === 'date';
  },

  /** Is this column being normalised right now? */
  isOn(spec, colId) {
    return Dates.requested(spec).indexOf(colId) >= 0;
  },

  /**
   * The source the pipeline should start from.
   *
   * `spec.source` itself when nothing is asked for, or nothing asked for can
   * be done — which is the common case and has to stay free.
   */
  source(spec) {
    const src = spec && spec.source;
    if (!src || !src.columns) return src;

    const byId = {};
    for (const col of src.columns) byId[col.id] = col;

    const ids = Dates.requested(spec).filter((id) => Dates.eligible(byId[id]));
    if (!ids.length) return src;

    // **Keyed on the rows, not on the source object.** `Store.draftOf` builds
    // a fresh `source` wrapper per edit so that a column's `type` can be
    // undone, so source identity now changes on every update and a memo keyed
    // on it would miss every time — recoercing the whole column per commit.
    // `source.rows` is still shared, and the columns are compared by the two
    // fields that decide what this writes.
    const key = ids.slice().sort().join(' ') + '\n' +
      src.columns.map((c) => c.id + ':' + c.type + ':' + (c.dateOrder || '')).join('|');
    const memo = Dates._memo;
    if (memo && memo.rows === src.rows && memo.key === key) return memo.out;

    const out = Dates.rewrite(src, ids);
    Dates._memo = { rows: src.rows, key: key, out: out };
    return out;
  },

  /**
   * The two decisions normalising makes about a column, made once for it.
   *
   * How to *read* the column comes off the column, because a day/month order
   * is a fact about the whole of it and no single value can say. How to
   * *write* it comes off the rows: **one shape for the whole column, decided
   * before anything is written.** A column where some values carry a clock and
   * some do not would otherwise come out half `2013-05-14` and half
   * `2013-05-14 09:05:00` — which still sorts correctly as text, but hands R a
   * column no single format reads, which is the problem this exists to solve.
   * Midnight is what a date with no time means.
   *
   * Scans the rows, so make one per column and not one per value.
   */
  plan(source, column) {
    return {
      opts: Formatters.dateOpts({}, { column: column }),
      withTime: Dates.anyTime(source.rows, column.id)
    };
  },

  /**
   * What a plan makes of one value, or null where it cannot read it.
   *
   * Null is also the answer for a missing value, so that "there is nothing to
   * write here" and "this is not a date" are one question with one answer:
   * every caller does the same thing with both, which is to leave the cell
   * alone. **A value it cannot read is left exactly as it was** — blanking it
   * would destroy data to tidy a column up, and leaving it visible is what
   * lets someone find the one row with a typo in it.
   */
  isoOf(plan, value) {
    if (Util.isMissing(value)) return null;
    const date = Util.toDate(value, plan.opts);
    if (date === null) return null;
    return Util.toIso(date, plan.withTime);
  },

  /**
   * Is `from` the pre-ISO spelling of `found`?
   *
   * Which is to say: did throwing this column's switch rewrite the value under
   * a cell correction, and so make its guard stop matching? A correction is
   * applied only while the cell still holds the value it was written against,
   * and normalising rewrites exactly that value — so the guard does what it is
   * for, and the panel has no way to tell that apart from the other reason a
   * guard fails, which is that the data was replaced.
   *
   * Answered against what the cell actually holds rather than inferred from
   * the switch being on, because both can be true at once: replace the data
   * *and* normalise, and only comparing settles which broke the correction.
   */
  rewrote(spec, colId, from, found) {
    if (found === undefined || !Dates.isOn(spec, colId)) return false;
    const src = spec && spec.source;
    const col = src && src.columns && src.columns.find((c) => c.id === colId);
    if (!Dates.eligible(col)) return false;
    const iso = Dates.isoOf(Dates.plan(src, col), from);
    return iso !== null && iso === String(found);
  },

  /**
   * A copy of `source` with `ids` rewritten as ISO.
   *
   * @param {Object} source
   * @param {Array<string>} ids - eligible column ids
   */
  rewrite(source, ids) {
    const targets = {};
    for (const col of source.columns) {
      if (ids.indexOf(col.id) < 0) continue;
      targets[col.id] = Dates.plan(source, col);
    }

    const rows = source.rows.map((row) => {
      let next = null;
      for (const id in targets) {
        const raw = row[id];
        const iso = Dates.isoOf(targets[id], raw);
        if (iso === null || iso === String(raw)) continue;
        if (!next) next = Object.assign({}, row);
        next[id] = iso;
      }
      return next || row;
    });

    const columns = source.columns.map((col) => {
      if (!targets[col.id]) return col;
      const next = Object.assign({}, col);
      // The three facts the importer recorded about how this column was
      // written are now wrong: it is ISO, whatever it used to be. Left in
      // place, `ExportRgt.sortCall` would hand R `format = "%d/%m/%Y"` for a
      // column of `2013-05-14` and get a column of NA back.
      delete next.dateOrder;
      delete next.dateSeparator;
      if (targets[col.id].withTime) next.dateClock = '%H:%M:%S';
      else delete next.dateClock;
      next.isoNormalised = true;
      return next;
    });

    return Object.assign({}, source, { columns: columns, rows: rows });
  },

  /** Does any value in this column carry a clock? */
  anyTime(rows, colId) {
    for (const row of rows) {
      const raw = row[colId];
      if (Util.isMissing(raw)) continue;
      if (Util.splitTime(String(raw).trim()).time) return true;
    }
    return false;
  },

  /**
   * How many values in a column this would not be able to read.
   *
   * The panel says so before the switch is thrown, because "three of these are
   * not dates" is the one thing worth knowing first — those rows keep their
   * text and stop sorting with the rest.
   */
  unreadable(spec, colId) {
    const src = spec && spec.source;
    const col = src && src.columns.find((c) => c.id === colId);
    if (!Dates.eligible(col)) return 0;

    const plan = Dates.plan(src, col);
    let count = 0;
    for (const row of src.rows) {
      const raw = row[colId];
      // A blank cell is not a value this cannot read — there is nothing there
      // to fail on, and counting it would tell someone three rows are wrong
      // when three rows are empty.
      if (Util.isMissing(raw)) continue;
      if (Dates.isoOf(plan, raw) === null) count += 1;
    }
    return count;
  }
};
