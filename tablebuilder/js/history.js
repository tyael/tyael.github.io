/**
 * history.js
 *
 * Names a change, by comparing the spec before it with the spec after.
 *
 * The alternative was a `label` on every one of the hundred-odd `Store.update`
 * calls, which would have been a hundred chances to forget one and a hundred
 * labels to keep true as the panels change. Deriving the name from the spec
 * itself means every action is named, including ones written later by someone
 * who never read this file. `Store.update` still takes an explicit
 * `opts.label` for the few cases that know better than a diff can — applying a
 * theme rewrites 154 options and is not "Options".
 *
 * Order matters: the first matching rule wins, so the specific entries sit
 * above the general ones.
 */

const History = {

  /** Deep-equal by serialisation. Specs are JSON by construction. */
  same(a, b) {
    return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  },

  /** Read a dotted path out of a spec. */
  at(spec, path) {
    let node = spec;
    for (const key of path.split('.')) {
      if (node === null || node === undefined) return undefined;
      node = node[key];
    }
    return node;
  },

  /**
   * Paths that name themselves, most specific first.
   *
   * `list: true` means the value is an array whose length change reads as
   * added/removed — "Add footnote" says more than "Footnotes".
   */
  RULES: [
    { path: 'parts.title', label: 'Title' },
    { path: 'parts.subtitle', label: 'Subtitle' },
    { path: 'parts.caption', label: 'Caption' },
    { path: 'parts.captionAlign', label: 'Caption alignment' },
    { path: 'parts.stubhead', label: 'Row-label header' },
    { path: 'parts.footnotes', label: 'footnote', list: true },
    { path: 'parts.sourceNotes', label: 'source note', list: true },

    { path: 'structure.rownameCol', label: 'Row labels' },
    { path: 'structure.groupnameCol', label: 'Row groups' },
    { path: 'structure.sort', label: 'sort key', list: true },
    { path: 'structure.spanners', label: 'column group', list: true },
    { path: 'structure.merges', label: 'column merge', list: true },
    { path: 'structure.hidden', label: 'Shown columns' },
    { path: 'structure.columnOrder', label: 'Column order' },
    { path: 'structure.labels', label: 'Column label' },
    { path: 'structure.widths', label: 'Column width' },
    { path: 'structure.align', label: 'Column alignment' },

    { path: 'format', label: 'number format', list: true },
    { path: 'dataColor', label: 'colour rule', list: true },
    { path: 'styleRules', label: 'style rule', list: true },
    { path: 'summaries', label: 'Totals' },
    { path: 'subs', label: 'Missing and zero values' },
    { path: 'reshape', label: 'Reshape' },
    { path: 'fonts', label: 'font', list: true },
    // Editing a cell passes its own label ("Edit Manufacturer"), which a diff
    // cannot reach — the column is an id inside the entry, not a path. This
    // catches the removals, which have nowhere else to name themselves.
    { path: 'corrections', label: 'cell correction', list: true },
    { path: 'source', label: 'Data' }
  ],

  /**
   * A short name for what changed between two specs.
   * @returns {string}
   */
  describe(previous, next) {
    if (!previous || !next) return 'Change';

    // Options first: it is the largest surface and the only one that can name
    // the exact thing that moved.
    const optionLabel = History.describeOptions(previous.options, next.options);
    if (optionLabel) return optionLabel;

    for (const rule of History.RULES) {
      const before = History.at(previous, rule.path);
      const after = History.at(next, rule.path);
      if (History.same(before, after)) continue;

      if (rule.list && Array.isArray(before) && Array.isArray(after)) {
        if (after.length > before.length) return 'Add ' + rule.label;
        if (after.length < before.length) return 'Remove ' + rule.label;
        return 'Edit ' + rule.label;
      }
      return rule.label;
    }

    return 'Edit';
  },

  /**
   * Name an options change, in the words the Options panel uses.
   *
   * One changed key is named exactly — "Body › Horizontal lines". More than
   * one is a bulk write (a theme, a reset), and naming the first would be
   * arbitrary, so it says how many.
   */
  describeOptions(before, after) {
    if (!before || !after) return null;

    const changed = [];
    const keys = new Set(Object.keys(before).concat(Object.keys(after)));
    for (const key of keys) {
      if (before[key] !== after[key]) changed.push(key);
      if (changed.length > 8) break;   // enough to know it is a bulk write
    }

    if (!changed.length) return null;
    if (changed.length === 1) return History.optionName(changed[0]);

    // The three parts of one border move together and are one decision.
    const borders = new Set(changed.map((key) => key.replace(/\.(style|width|color)$/, '')));
    if (borders.size === 1) return History.optionName(changed[0], true);

    return changed.length + ' options';
  },

  /** "Body › Horizontal lines" for an option key, or the raw key. */
  optionName(key, borderOnly) {
    if (typeof OptionsSchema === 'undefined') return key;
    const option = OptionsSchema.get(key);
    if (!option) return key;

    const group = OptionsSchema.groups.find((g) => g.id === option.group);
    const label = borderOnly && option.borderLabel ? option.borderLabel : option.label;
    return (group ? group.label + ' › ' : '') + label;
  }
};
