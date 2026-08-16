/**
 * corrections.js
 *
 * Per-cell value corrections — fixing a typo without going back out to the CSV.
 *
 * A correction is `{id, srcIndex, colId, from, to}` and lives in
 * `spec.corrections`, never in `spec.source`. The source stays the file as
 * imported, which is the invariant that lets a re-import be reasoned about at
 * all. This is the same shape `structure.labels` already uses for a column
 * rename: an override keyed by id, rather than a rewrite of the thing it
 * overrides.
 *
 * **`from` is the guard, and it is the whole design.** Importing new data over
 * an existing project keeps the design and swaps `spec.source` wholesale (see
 * `App.importSource`), so a correction keyed on position alone would silently
 * land on whatever row happens to sit at that index in the new file — the same
 * failure as the style rules that were once pinned to whatever row numbers were
 * on screen at the time. A correction is applied only while its cell still
 * holds the value it was written against; when it does not, it is reported as
 * stale and not applied. That is the `meta.auto` discipline from
 * `Spec.applySuggestions` — replace only what still holds what you last wrote —
 * and it makes a re-import say something rather than quietly corrupt a cell.
 *
 * Corrections are applied to the *working* rows, after the pivot and before
 * everything else, so a corrected value is what gets filtered, sorted, grouped,
 * totalled and matched by a `where` expression. Anything less and the table
 * would sort by a typo it no longer shows.
 */

const Corrections = {

  /**
   * Overlay corrections onto a set of working rows.
   *
   * Returns the **same array reference** when there is nothing to apply, which
   * is the overwhelmingly common case — `Compute.run` is on the keystroke path
   * and should not pay for a feature the table is not using.
   *
   * Never mutates its input. `Reshape.derive` hands back `source.rows` itself
   * when there is no pivot, and memoises the pivoted result when there is, so
   * writing through either would corrupt the source or poison the memo.
   *
   * @param {Array<Object>} rows - working rows
   * @param {Array<Object>} corrections - `spec.corrections`
   * @returns {{rows, applied, stale}}
   */
  apply(rows, corrections) {
    if (!rows || !corrections || !corrections.length) {
      return { rows: rows || [], applied: [], stale: [] };
    }

    const applied = [];
    const stale = [];
    let out = rows;
    // One copy per touched row, not per correction, so several corrections in
    // the same row do not each clone it.
    const copies = new Map();

    for (const correction of corrections) {
      if (!Corrections.wellFormed(correction)) continue;

      const row = rows[correction.srcIndex];
      if (!row || !(correction.colId in row)) { stale.push(correction); continue; }
      if (!Corrections.matches(row[correction.colId], correction.from)) {
        stale.push(correction);
        continue;
      }

      let copy = copies.get(correction.srcIndex);
      if (!copy) {
        copy = Object.assign({}, row);
        copies.set(correction.srcIndex, copy);
        if (out === rows) out = rows.slice();
        out[correction.srcIndex] = copy;
      }
      copy[correction.colId] = correction.to;
      applied.push(correction);
    }

    return { rows: out, applied: applied, stale: stale };
  },

  /** A correction that could address a cell at all. */
  wellFormed(correction) {
    return !!correction &&
      typeof correction.colId === 'string' && correction.colId !== '' &&
      typeof correction.srcIndex === 'number' && correction.srcIndex >= 0;
  },

  /**
   * Value equality for the guard. Everything in a source row is a string by
   * construction (`Csv.buildRows` stringifies), but a hand-edited project file
   * or a pivot aggregate can hold a number, and a guard that fails on `3` vs
   * `'3'` would drop a correction that is perfectly valid.
   */
  matches(a, b) {
    const norm = (v) => String(v === null || v === undefined ? '' : v);
    return norm(a) === norm(b);
  },

  /** The correction on one cell, if there is one. */
  find(corrections, srcIndex, colId) {
    if (!corrections) return null;
    return corrections.find((c) =>
      c && c.srcIndex === srcIndex && c.colId === colId) || null;
  },

  /**
   * The value a cell held before any correction — what `from` is written
   * against, and what "restore" restores to.
   */
  originalValue(spec, srcIndex, colId) {
    if (!Spec.hasData(spec)) return undefined;
    const working = Reshape.derive(spec.source, spec.reshape);
    const row = working.rows[srcIndex];
    return row ? row[colId] : undefined;
  },

  /**
   * Record a correction on a spec draft, from inside `Store.update`.
   *
   * Editing a cell a second time amends the existing correction and **leaves
   * `from` alone**: the guard has to keep describing the imported data, not
   * whatever the previous keystroke left behind, or a re-import would compare
   * against a value that never came from a file.
   *
   * Typing the original value back removes the correction rather than storing a
   * no-op. A list of corrections that change nothing is a list that has to be
   * explained; this is the same instinct as `PanelStyle.applyProperty` deleting
   * a key for `inherit` rather than writing a neutral value over it.
   *
   * @returns {Object|null} the correction now on the cell, or null if there is none
   */
  set(draft, srcIndex, colId, value) {
    if (!Array.isArray(draft.corrections)) draft.corrections = [];

    const original = Corrections.originalValue(draft, srcIndex, colId);
    const next = String(value === null || value === undefined ? '' : value);
    const existing = Corrections.find(draft.corrections, srcIndex, colId);

    if (Corrections.matches(original, next)) {
      if (existing) {
        draft.corrections = draft.corrections.filter((c) => c !== existing);
      }
      return null;
    }

    if (existing) {
      existing.to = next;
      return existing;
    }

    const correction = {
      id: Util.uid('corr'),
      srcIndex: srcIndex,
      colId: colId,
      from: String(original === null || original === undefined ? '' : original),
      to: next
    };
    draft.corrections.push(correction);
    return correction;
  },

  /** Drop a correction by id. */
  remove(draft, id) {
    if (!Array.isArray(draft.corrections)) return;
    draft.corrections = draft.corrections.filter((c) => c.id !== id);
  }
};
