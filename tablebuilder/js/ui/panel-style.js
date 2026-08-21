/**
 * ui/panel-style.js
 *
 * The Style rules panel: the ordered list of `tab_style()` rules.
 *
 * Styling a cell from the inspector appends a rule here rather than baking a
 * value into the cell, so every appearance decision stays visible, editable,
 * reorderable and reversible. Hovering a rule highlights the cells it hits.
 */

const PanelStyle = {

  id: 'style',
  label: 'Style rules',
  hint: 'Style rules aimed at cells you select',

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

    // Only the model has this. `spec.ruleError` was also read here and never
    // written anywhere — and would have thrown on the line below whenever
    // `App.model` was null.
    if (App.model && App.model.ruleError) {
      panel.appendChild(Util.el('div.field-hint', {
        style: { color: 'var(--danger)' },
        text: '⚠ Row expression: ' + App.model.ruleError
      }));
    }

    const list = Controls.itemList(spec.styleRules, (rule, index) =>
      PanelStyle.body(rule, index, columns, byId), {
      key: 'styleRules',
      // A rule's editor is three sections deep, so a list of them is long
      // before it is useful. The subtitle stays visible when collapsed, which
      // is what says which rule this is.
      collapsible: true,
      title: (rule) => rule.label || 'Style rule',
      subtitle: (rule) => StyleRules.describe(rule, byId),
      // A theme's rules and hand-written ones sat in one list looking
      // identical, and only one kind survives a change of theme. Without this
      // the list is eight rules, seven of which vanish on the next theme with
      // nothing having said they would — and an edit to one of them is thrown
      // away by an action taken somewhere else entirely.
      badge: (rule) => (rule.fromTheme ? {
        text: Themes.label(rule.fromTheme),
        title: 'This rule comes from the ' + Themes.label(rule.fromTheme) +
          ' theme. Changing theme replaces it, and any edit to it goes with it — ' +
          'copy it into a rule of your own to keep it.'
      } : null),
      enabled: (rule) => Spec.isEnabled(rule),
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
    ], { key: 'style.rules', action: Controls.collapseAll('styleRules', spec.styleRules) }));

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

  /**
   * Everything a row expression can name, complete and clickable.
   *
   * This used to be one line of text — `in scope: a, b, c…` — truncated at 90
   * characters, which on any real dataset trailed off before the column you
   * wanted. Worse, it listed only ids that are bare JS identifiers, so a column
   * needing `v['2024']` did not appear at all and there was nothing to say the
   * form existed. And its identifier test omitted the reserved words, so a
   * column called `n` was advertised as usable by name when typing `n` gives
   * you the row count instead.
   *
   * Every column is listed now, each in the exact form you would type — which
   * comes from `StyleRules.ref`, the same function `evalRowExpr` and `seedExpr`
   * use, so the list cannot advertise a name the compiler does not accept.
   * `row` and `n` are listed too: they are in scope and were only ever
   * mentioned in a sentence above.
   *
   * The box scrolls rather than growing, because this sits inside a rule item
   * inside a panel, and a fifty-column dataset would otherwise push the style
   * controls off the screen.
   */
  scopeList(columns, exprKey, onChange) {
    const TYPE_ABBR = { number: 'num', text: 'text', date: 'date', bool: 'bool' };

    /* Insert at the caret, or append when the field is not focused. */
    const insert = (token) => {
      const field = document.querySelector('[data-ctl="' + CSS.escape(exprKey) + '"]');
      if (!field) return;

      const focused = document.activeElement === field;
      const start = focused ? field.selectionStart : field.value.length;
      const end = focused ? field.selectionEnd : field.value.length;
      const next = field.value.slice(0, start) + token + field.value.slice(end);
      const caret = start + token.length;

      // Written into the live field *before* the store update, so the rebuild
      // that follows finds the caret where the user will expect it —
      // `rememberFocus` reads `selectionStart` off the focused control, and a
      // panel rebuild is exactly what happens next.
      field.value = next;
      field.focus();
      try { field.setSelectionRange(caret, caret); } catch (e) { /* not selectable */ }

      onChange(next);
    };

    const chip = (token, title, suffix) => Util.el('button.chip.scope-chip', {
      type: 'button',
      title: title,
      on: {
        // The chip must not steal focus, or the caret position it is about to
        // insert at is gone by the time the click lands.
        mousedown: (e) => e.preventDefault(),
        click: () => insert(token)
      }
    }, [
      Util.el('span', { text: token }),
      suffix ? Util.el('span.scope-chip-type', { text: suffix }) : null
    ]);

    const chips = columns.map((col) => {
      const token = StyleRules.ref(col.id);
      const type = TYPE_ABBR[col.type] || col.type || '';

      // Two different reasons a column cannot be written bare, and saying the
      // wrong one is worse than saying nothing: `n` *is* a valid JavaScript
      // name, it is just already taken by the row count.
      let note = col.label;
      if (StyleRules.RESERVED.indexOf(col.id) >= 0) {
        note = col.label + ' — “' + col.id + '” already means something else in an ' +
          'expression, so the column is reached through v[…]';
      } else if (!StyleRules.bareName(col.id)) {
        note = col.label + ' — “' + col.id + '” is not a name JavaScript can use, ' +
          'so the column is reached through v[…]';
      }
      return chip(token, note, type);
    });

    return Util.el('div.scope-box', null, [
      Util.el('div.scope-head', {
        text: 'In scope (' + columns.length + ' column' + (columns.length === 1 ? '' : 's') + ')'
      }),
      Util.el('div.chip-set.scope-chips', null, chips),
      // Outside the scrolling area: these are always in scope, so they should
      // not be something you have to scroll a long column list to find.
      Util.el('div.scope-foot', null, [
        Util.el('span.scope-foot-label', { text: 'also' }),
        chip('row', 'The 0-based index of the row', 'num'),
        chip('n', 'The number of rows', 'num')
      ]),
      Util.el('div.scope-foot', null, [
        Util.el('span.scope-foot-label', { text: 'nearby' }),
        chip('self()', 'The value in this cell', 'cell'),
        chip('above()', 'The cell one row up, in this column. above(2) for two up.', 'cell'),
        chip('below()', 'The cell one row down, in this column. below(2) for two down.', 'cell'),
        chip('left()', 'The cell one body column to the left, in this row. left(2) for two.', 'cell'),
        chip('right()', 'The cell one body column to the right, in this row. right(2) for two.', 'cell')
      ]),
      Util.el('div.field-hint', {
        text: 'Nearby cells are relative to the cell being styled, so left() means ' +
          '“my left-hand neighbour” whichever column the rule covers. Rows count in the ' +
          'order the table is sorted; columns count across the body only. Off the edge ' +
          'of the table is not a match.'
      })
    ]);
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
          text: 'A JavaScript condition over the row. Click a name below to insert it. ' +
            'Numeric columns arrive as numbers, so > and < compare as you would expect; ' +
            'everything else arrives as text.'
        }));

        nodes.push(PanelStyle.scopeList(columns,
          'loc.expr.' + rule.id + '.' + locIndex,
          (value) => Store.update((draft) => {
            draft.styleRules[ruleIndex].locations[locIndex].rows.expr = value;
          }, { coalesce: 'loc.expr.' + rule.id + '.' + locIndex })));
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
      const spanners = (App.model && App.model.spanners) || [];
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
        // Inheriting is the *absence* of the side. A style of 'none' is kept,
        // because it means something different: take the line off these cells.
        if (!value || !value.style || value.style === 'inherit') delete style.borders[side];
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

    // Every one of these is optional: a rule sets what it sets and the rest
    // comes from the part's own options. "inherit" is that state, and it is
    // the one a new rule starts in.
    const textFields = StyleRules.TEXT_PROPS.map((prop) =>
      Controls.field(prop.label,
        Controls.forParam(prop, text[prop.key], (value) => onSet('text', prop.key, value),
          keyPrefix + '.text', { unset: 'inherit' })));

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

      // 'inherit' and 'none' are different answers and both are needed: leave
      // the option's line alone, or take it off these cells. The dropdown used
      // to offer only the option list, where 'none' did the first and there
      // was no way to ask for the second.
      Controls.field('Style', Controls.select(keyPrefix + '.border.style',
        ['inherit'].concat(OptionsSchema.BORDER_STYLES), shown.style || 'inherit',
        (value) => {
          if (value === 'inherit') onSet('borders', state, null);
          else write({ style: value });
        })),

      Controls.field('Width', Controls.length(keyPrefix + '.border.width',
        shown.width || '1px', (value) => write({ width: value }))),

      Controls.field('Colour', Controls.color(keyPrefix + '.border.color',
        shown.color || '#000000', (value) => write({ color: value }))),

      Util.el('div.field-hint', {
        text: 'Borders set here beat the table-wide borders and lines under Table defaults. ' +
          '“inherit” leaves them alone; “none” takes the line off these cells.'
      })
    ], { key: keyPrefix + '.borders' });
  },

  _borderSide: 'all',
};
