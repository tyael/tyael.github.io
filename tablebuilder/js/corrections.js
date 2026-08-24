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
   * A stale entry carries `found`, the value that was there instead — the only
   * thing that can tell *why* a guard failed apart, and the reason the Data
   * panel can say that normalising the column is what broke it rather than
   * guessing between that and the data having been replaced. Absent on the
   * entry for a row that is not there at all, which is a different failure.
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
      const found = row[correction.colId];
      if (!Corrections.matches(found, correction.from)) {
        stale.push(Object.assign({}, correction, { found: found }));
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
    // The pipeline as it stands *just before* corrections are applied — which
    // is what `from` was written against, and what "restore" restores to. A
    // correct step that has been dragged past a pivot or a filter therefore
    // compares against the data at its own position, not at the start.
    const at = Pipeline.indexOf(spec, 'correct');
    const before = Pipeline.run(Spec.workingSource(spec), spec.pipeline, at < 0 ? undefined : at);
    const item = before.items.find((entry) => entry.srcIndex === srcIndex);
    return item ? item.row[colId] : undefined;
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
    const original = Corrections.originalValue(draft, srcIndex, colId);
    const next = String(value === null || value === undefined ? '' : value);
    const step = Pipeline.find(draft, 'correct');
    const existing = step ? Corrections.find(step.edits, srcIndex, colId) : null;

    if (Corrections.matches(original, next)) {
      if (existing) {
        step.edits = step.edits.filter((c) => c !== existing);
        // A step holding nothing is noise in the pipeline, and the next
        // correction recreates it in the same place.
        if (!step.edits.length) Pipeline.remove(draft, 'correct');
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
    // `Pipeline.add` puts a new correct step immediately after the last pivot,
    // ahead of any filter or sort — see the note there.
    (step || Pipeline.set(draft, 'correct', {})).edits.push(correction);
    return correction;
  },

  /**
   * Rewrite a correction against the value its cell holds now.
   *
   * **This moves `from`, which `set` above is at pains never to do**, and the
   * difference is worth being clear about. `set` refuses because the value the
   * user last typed is not a fact about the file, and a guard that drifted onto
   * it would compare against something no import ever produced. Here the file's
   * own value is what changed — normalising the column rewrote `14/05/2013` to
   * `2013-05-14` underneath the correction — so `from` is moved to the value
   * the pipeline now delivers to that cell, and goes on describing the data
   * rather than the editing. Import over the top afterwards and the guard is
   * exactly as strong: it matches only a cell that genuinely holds that date.
   *
   * `originalValue` is what decides "the value now", the same as when a
   * correction is first written, so the two cannot come to disagree about it.
   *
   * `to` follows it into ISO where the column is being normalised. Left in the
   * old notation it would put `15/05/2013` back into a column that has just
   * been made uniform — one mixed-notation cell, which is the whole thing the
   * switch exists to prevent, reintroduced by the button offering to help.
   *
   * A rewrite that leaves nothing to do — a correction that only ever restated
   * a date in another notation, which normalising has now done for it — drops
   * the correction instead of storing a no-op, as `set` does.
   */
  rebase(draft, id) {
    const step = Pipeline.find(draft, 'correct');
    const correction = step && (step.edits || []).find((c) => c.id === id);
    if (!correction) return;

    const now = Corrections.originalValue(draft, correction.srcIndex, correction.colId);
    if (now === undefined) return;

    let to = correction.to;
    if (Dates.isOn(draft, correction.colId)) {
      const col = draft.source.columns.find((c) => c.id === correction.colId);
      const iso = Dates.eligible(col) && Dates.isoOf(Dates.plan(draft.source, col), to);
      if (iso) to = iso;
    }

    if (Corrections.matches(now, to)) { Corrections.remove(draft, id); return; }
    correction.from = String(now);
    correction.to = to;
  },

  /** Drop a correction by id. */
  remove(draft, id) {
    const step = Pipeline.find(draft, 'correct');
    if (!step) return;
    step.edits = step.edits.filter((c) => c.id !== id);
    if (!step.edits.length) Pipeline.remove(draft, 'correct');
  }
};
