/**
 * ui/panel-style.js
 *
 * The Style panel: the ordered list of `tab_style()` rules.
 *
 * Styling a cell from the inspector appends a rule here rather than baking a
 * value into the cell, so every appearance decision stays visible, editable,
 * reorderable and reversible. Hovering a rule highlights the cells it hits.
 */

const PanelStyle = {

  id: 'style',
  label: 'Style',

  render(spec) {
    const panel = Util.el('div.panel');

    if (!Spec.hasData(spec)) {
      panel.appendChild(Controls.note('Import data first.'));
      return panel;
    }

    const columns = App.workingColumns();
    const byId = {};
    for (const col of columns) byId[col.id] = col;

    panel.appendChild(Controls.intro(
      'Rules apply top to bottom — a later rule overrides an earlier one where they overlap. ' +
      'Select cells in the table and style them from the inspector to add one.'
    ));

    if (spec.ruleError || (App.model && App.model.ruleError)) {
      panel.appendChild(Util.el('div.field-hint', {
        style: { color: 'var(--danger)' },
        text: '⚠ Row expression: ' + (App.model.ruleError || spec.ruleError)
      }));
    }

    const list = Controls.itemList(spec.styleRules, (rule, index) =>
      PanelStyle.body(rule, index, columns, byId), {
      key: 'styleRules',
      title: (rule) => rule.label || 'Style rule',
      subtitle: (rule) => StyleRules.describe(rule, byId),
      enabled: (rule) => rule.enabled !== false,
      onToggle: (rule, index, on) => Store.update((draft) => { draft.styleRules[index].enabled = on; }),
      onRemove: (rule, index) => Store.update((draft) => { draft.styleRules.splice(index, 1); }),
      onReorder: (from, to) => Store.update((draft) => {
        draft.styleRules = Util.moveItem(draft.styleRules, from, to);
      })
    });

    // Hovering a rule flashes the cells it targets in the preview.
    for (const item of Util.qsa('.item', list)) {
      const index = parseInt(item.dataset.index, 10);
      item.addEventListener('mouseenter', () => Selection.previewRule(spec.styleRules[index]));
      item.addEventListener('mouseleave', () => Selection.previewRule(null));
    }

    panel.appendChild(Controls.section('Style rules (' + spec.styleRules.length + ')', [
      list,
      Controls.actions([
        Controls.button('Add empty rule', () => {
          Store.update((draft) => {
            const rule = StyleRules.emptyRule('Style rule');
            rule.locations = [StyleRules.emptyLocation('body')];
            draft.styleRules.push(rule);
          });
        }, { kind: 'primary' }),
        spec.styleRules.length ? Controls.button('Clear all', () => {
          if (!window.confirm('Remove all ' + spec.styleRules.length + ' style rules?')) return;
          Store.update((draft) => { draft.styleRules = []; });
        }, { kind: 'danger' }) : null
      ].filter(Boolean))
    ], { key: 'style.rules' }));

    return panel;
  },

  /* ================================================================
     One rule
     ================================================================ */

  body(rule, index, columns, byId) {
    const body = Util.el('div');
    const update = (fn, coalesce) => Store.update((draft) => fn(draft.styleRules[index]),
      { coalesce: coalesce });

    body.appendChild(Controls.field('Name', Controls.text('sr.label.' + rule.id, rule.label,
      (value) => update((r) => { r.label = value; }, 'sr.label.' + rule.id))));

    /* ---- Locations ---- */

    body.appendChild(Util.el('div.mini-label', { text: 'Applies to', style: { marginTop: '8px' } }));

    rule.locations.forEach((loc, locIndex) => {
      body.appendChild(PanelStyle.locationEditor(rule, index, loc, locIndex, columns, byId));
    });

    body.appendChild(Controls.actions([
      Controls.button('Add location', () => update((r) => {
        r.locations.push(StyleRules.emptyLocation('body'));
      }), { kind: 'ghost' }),
      Selection.current().length ? Controls.button('Use selection', () => {
        const built = StyleRules.fromSelection(Selection.current(), rule.style, rule.label,
          Selection.dataRowIndices());
        update((r) => { r.locations = built.locations; });
      }, { kind: 'ghost' }) : null
    ].filter(Boolean)));

    /* ---- Style ---- */

    body.appendChild(Util.el('div.mini-label', { text: 'Style', style: { marginTop: '10px' } }));
    body.appendChild(PanelStyle.styleEditor(rule.style, (section, key, value) => {
      update((r) => { PanelStyle.applyProperty(r.style, section, key, value); },
        'sr.style.' + rule.id + '.' + section + '.' + key);
    }, 'sr.' + rule.id));

    return body;
  },

  locationEditor(rule, ruleIndex, loc, locIndex, columns, byId) {
    const update = (fn) => Store.update((draft) => fn(draft.styleRules[ruleIndex].locations[locIndex]));
    const part = StyleRules.PARTS.find((p) => p.id === loc.part) || StyleRules.PARTS[0];

    const nodes = [];

    nodes.push(Controls.field('Part', [
      Controls.select('loc.part.' + rule.id + '.' + locIndex,
        StyleRules.PARTS.map((p) => ({ value: p.id, label: p.label })), loc.part,
        (value) => update((l) => { l.part = value; })),
      Util.el('button.btn.btn-mini.btn-ghost', {
        text: '✕',
        title: 'Remove this location',
        on: {
          click: () => Store.update((draft) => {
            draft.styleRules[ruleIndex].locations.splice(locIndex, 1);
          })
        }
      })
    ]));

    if (part.columns) {
      nodes.push(Util.el('div.mini-label', { text: 'Columns (blank = all)' }));
      nodes.push(Controls.columnChips('loc.cols.' + rule.id + '.' + locIndex, columns, loc.columns,
        (value) => update((l) => { l.columns = value; })));
    }

    if (part.rows) {
      const mode = (loc.rows && loc.rows.mode) || 'all';
      nodes.push(Controls.field('Rows', Controls.select('loc.rowmode.' + rule.id + '.' + locIndex,
        [{ value: 'all', label: 'All rows' },
          { value: 'index', label: 'Specific rows' },
          { value: 'expr', label: 'Where…' }],
        mode, (value) => update((l) => { l.rows = { mode: value, indices: (l.rows && l.rows.indices) || [], expr: (l.rows && l.rows.expr) || '' }; }))));

      if (mode === 'index') {
        nodes.push(Controls.field(null, Util.el('div', null, [
          Util.el('div.item-sub', {
            text: (loc.rows.indices.length || 'no') + ' row(s): ' +
              Util.truncate(loc.rows.indices.map((i) => i + 1).join(', '), 40)
          }),
          Selection.current().length ? Controls.button('Set from selection', () => {
            const indices = Util.unique(Selection.current()
              .map((s) => s.srcIndex)
              .filter((i) => i !== undefined && i !== null)).sort((a, b) => a - b);
            update((l) => { l.rows = { mode: 'index', indices: indices, expr: l.rows.expr || '' }; });
          }, { kind: 'ghost' }) : null
        ]), { wide: true }));
      }

      if (mode === 'expr') {
        nodes.push(Controls.field(null, Controls.text('loc.expr.' + rule.id + '.' + locIndex,
          loc.rows.expr, (value) => Store.update((draft) => {
            draft.styleRules[ruleIndex].locations[locIndex].rows.expr = value;
          }, { coalesce: 'loc.expr.' + rule.id + '.' + locIndex }),
          { placeholder: 'population > 1e6 && state != "NT"' }), { wide: true }));

        nodes.push(Util.el('div.field-hint', {
          text: 'A JavaScript condition over the row. Column ids are in scope by name; ' +
            'use v["2024"] for ids that are not valid identifiers. `row` is the 0-based index, `n` the row count.'
        }));

        const validIds = columns.filter((c) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(c.id));
        if (validIds.length) {
          nodes.push(Util.el('div.item-sub', {
            text: 'in scope: ' + Util.truncate(validIds.map((c) => c.id).join(', '), 90)
          }));
        }
      }
    }

    if (part.groups) {
      const groups = App.groupLabels();
      if (groups.length) {
        nodes.push(Util.el('div.mini-label', { text: 'Groups (blank = all)' }));
        nodes.push(Controls.columnChips('loc.groups.' + rule.id + '.' + locIndex,
          groups.map((g) => ({ id: g, label: g === '' ? '(no label)' : g })), loc.groups,
          (value) => update((l) => { l.groups = value; })));
      }
    }

    if (part.spanners) {
      const spanners = Store.get().structure.spanners;
      if (spanners.length) {
        nodes.push(Util.el('div.mini-label', { text: 'Column groups (blank = all)' }));
        nodes.push(Controls.columnChips('loc.spanners.' + rule.id + '.' + locIndex,
          spanners.map((sp) => ({ id: sp.id, label: sp.label || '(unlabelled)' })), loc.spanners,
          (value) => update((l) => { l.spanners = value; })));
      }
    }

    return Util.el('div', {
      style: {
        border: '1px dashed var(--border-subtle)', borderRadius: '3px',
        padding: '6px', marginBottom: '6px'
      }
    }, nodes);
  },

  /**
   * Write one property into a style object. Shared by the inspector and the
   * style panel; it lives here now that the inspector no longer edits cells.
   */
  applyProperty(style, section, key, value) {
    if (!style.text) style.text = {};
    if (!style.fill) style.fill = {};
    if (!style.borders) style.borders = {};

    if (section === 'borders') {
      // `key` is a side, or 'all' to set every side at once.
      const sides = key === 'all' ? StyleRules.SIDES : [key];
      for (const side of sides) {
        if (!value || value.style === 'none') delete style.borders[side];
        else style.borders[side] = Object.assign({}, style.borders[side], value);
      }
    } else if (section === 'fill') {
      style.fill = Object.assign({}, style.fill, value);
      if (!style.fill.color) style.fill = {};
    } else {
      if (value === '' || value === null || value === undefined) delete style.text[key];
      else style.text[key] = value;
    }
  },

  /**
   * Build the Text / Fill / Borders editor.
   *
   * @param {Object} style - the style to display
   * @param {Function} onSet - (section, key, value) => void
   * @param {string} keyPrefix - namespace for control focus keys
   */
  styleEditor(style, onSet, keyPrefix) {
    const wrap = Util.el('div');
    const text = (style && style.text) || {};
    const fill = (style && style.fill) || {};
    const borders = (style && style.borders) || {};

    /* ---- Text ---- */

    const textFields = StyleRules.TEXT_PROPS.map((prop) =>
      Controls.field(prop.label,
        Controls.forParam(prop, text[prop.key], (value) => onSet('text', prop.key, value),
          keyPrefix + '.text')));

    wrap.appendChild(Controls.section('Text', textFields, { key: keyPrefix + '.text' }));

    /* ---- Fill ---- */

    wrap.appendChild(Controls.section('Fill', [
      Controls.field('Colour', Controls.color(keyPrefix + '.fill.color', fill.color || '',
        (value) => onSet('fill', 'color', { color: value, alpha: fill.alpha }),
        { nullable: true })),
      Controls.field('Opacity', Controls.number(keyPrefix + '.fill.alpha',
        fill.alpha === undefined ? 1 : fill.alpha,
        (value) => onSet('fill', 'alpha', { color: fill.color, alpha: Util.clamp(value, 0, 1) }),
        { min: 0, max: 1, step: 0.05 }))
    ], { key: keyPrefix + '.fill' }));

    /* ---- Borders ---- */

    wrap.appendChild(PanelStyle.borderEditor(borders, onSet, keyPrefix));

    return wrap;
  },

  borderEditor(borders, onSet, keyPrefix) {
    // The editor writes one side at a time, or all four together. Whichever
    // side is being shown, its current values pre-fill the controls.
    const state = PanelStyle._borderSide || 'all';
    const shown = state === 'all'
      ? (borders.top || borders.right || borders.bottom || borders.left || {})
      : (borders[state] || {});

    const sideButtons = ['all'].concat(StyleRules.SIDES).map((side) =>
      Util.el('span.chip' + (state === side ? '.is-on' : ''), {
        text: side === 'all' ? 'All' : side.charAt(0).toUpperCase() + side.slice(1),
        on: {
          click: () => {
            PanelStyle._borderSide = side;
            App.renderPanels();
          }
        }
      }));

    const write = (patch) => {
      const next = Object.assign({
        style: shown.style || 'solid',
        width: shown.width || '1px',
        color: shown.color || '#000000'
      }, patch);
      onSet('borders', state, next);
    };

    return Controls.section('Borders', [
      Util.el('div.chip-set', null, sideButtons),
      Util.el('div', { style: { height: '7px' } }),

      Controls.field('Style', Controls.select(keyPrefix + '.border.style',
        OptionsSchema.BORDER_STYLES, shown.style || 'none',
        (value) => {
          if (value === 'none') onSet('borders', state, null);
          else write({ style: value });
        })),

      Controls.field('Width', Controls.length(keyPrefix + '.border.width',
        shown.width || '1px', (value) => write({ width: value }))),

      Controls.field('Colour', Controls.color(keyPrefix + '.border.color',
        shown.color || '#000000', (value) => write({ color: value }))),

      Util.el('div.field-hint', {
        text: 'Borders set here beat the table-wide rules and lines under Options.'
      })
    ], { key: keyPrefix + '.borders' });
  },

  _borderSide: 'all',
};
