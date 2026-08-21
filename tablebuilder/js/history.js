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

    // Above the structural block: a pipeline edit may also touch the aesthetic
    // keys, and these are first-match-wins. `describeStep` names which step,
    // so this label is only the fallback for a reorder.
    { path: 'pipeline', label: 'step', list: true },
    { path: 'structure.hidden', label: 'Shown columns' },
    { path: 'structure.columnOrder', label: 'Column order' },
    { path: 'structure.labels', label: 'Column label' },
    { path: 'structure.widths', label: 'Column width' },
    { path: 'structure.align', label: 'Column alignment' },

    { path: 'format', label: 'number format', list: true },
    { path: 'dataColor', label: 'colour rule', list: true },
    { path: 'styleRules', label: 'style rule', list: true },
    { path: 'subs', label: 'Missing and zero values' },
    { path: 'fonts', label: 'font', list: true },
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

      if (rule.path === 'pipeline') {
        const step = History.describeStep(before, after);
        if (step) return step;
      }

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
   * Name a pipeline change by the step that changed, not by the list.
   *
   * Nine step types share one path, so without this every structural edit in
   * the app reads "Edit step". The name comes from the type's own `label`, so
   * the history menu and the Shape panel cannot call the same step two
   * different things.
   *
   * This is what the `summaries` and `corrections` rules used to do. Both were
   * folded into the pipeline and neither was removed with the fold, so both
   * were reading a key `Spec.migratePipeline` deletes — `History.at` returned
   * `undefined` on either side of every diff and the rules never fired again.
   *
   * @returns {string|null} null when the list changed but no step did, which
   *   is a reorder — the caller's own label covers it.
   */
  describeStep(before, after) {
    const from = Array.isArray(before) ? before : [];
    const to = Array.isArray(after) ? after : [];
    const name = (step) => {
      const def = Pipeline.type(step.type);
      return def ? def.label : 'step';
    };

    const fromIds = new Set(from.map((step) => step.id));
    const toIds = new Set(to.map((step) => step.id));

    const added = to.find((step) => !fromIds.has(step.id));
    if (added) return 'Add step: ' + name(added);
    const removed = from.find((step) => !toIds.has(step.id));
    if (removed) return 'Remove step: ' + name(removed);

    const byId = {};
    for (const step of from) byId[step.id] = step;
    const edited = to.find((step) => !History.same(byId[step.id], step));
    return edited ? 'Edit step: ' + name(edited) : null;
  },

  /**
   * Name an options change, in the words the Table defaults panel uses.
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
