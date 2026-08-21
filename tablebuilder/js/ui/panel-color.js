/**
 * ui/panel-color.js
 *
 * The Colour panel: gt's `data_color()`.
 *
 * A rule fits a colour scale to the values in a set of columns and paints each
 * cell accordingly: a continuous ramp, or one colour per category. The ramp
 * can be a named palette or two or three colours of your own; a category can
 * be given its own colour; and a rule can paint one column from another
 * column's values, which is gt's `target_columns`.
 *
 * **Everything here is a `data_color()` argument.** The palette goes out as
 * the vector gt is handed, the categories as `levels =` beside a matching
 * `palette =`, and the auto-contrast choice as `contrast_algo =` — the R
 * suite compares the two tables cell by cell, because every one of those can
 * emit R that renders happily while painting a different table.
 */

const PanelColor = {

  id: 'color',
  // Non-breaking space binds "by value": a line should not end on a
  // preposition, so the break falls after "Colour".
  label: 'Colour by\u00A0value',
  hint: 'Shade cells on a colour scale across the numbers in a column',

  METHODS: [
    { value: 'numeric', label: 'Continuous' },
    { value: 'factor', label: 'Categorical' }
  ],

  render(spec) {
    const panel = Util.el('div.panel');

    if (!Spec.hasData(spec)) {
      panel.appendChild(Controls.note('Import data first.'));
      return panel;
    }

    const columns = App.workingColumns();
    const byId = {};
    for (const col of columns) byId[col.id] = col;

    const list = Controls.itemList(spec.dataColor, (rule, index) =>
      PanelColor.ruleBody(rule, index, spec, columns, byId), {
      key: 'dataColor',
      collapsible: true,
      title: (rule) => Spec.colorRuleTitle(rule),
      subtitle: (rule) => (PanelColor.METHODS.find((m) => m.value === Spec.colorMethod(rule)) || {}).label +
        ' · ' + (rule.applyTo === 'text' ? 'text' : 'fill'),
      enabled: (rule) => Spec.isEnabled(rule),
      onToggle: (rule, index, on) => Store.update((draft) => { draft.dataColor[index].enabled = on; }),
      onRemove: (rule, index) => Store.update((draft) => { draft.dataColor.splice(index, 1); }),
      onReorder: (from, to) => Store.update((draft) => {
        draft.dataColor = Util.moveItem(draft.dataColor, from, to);
      })
    });

    const selected = Selection.selectedColumnIds();

    panel.appendChild(Controls.section('Colour rules', [
      Util.el('div.field-hint', {
        text: 'Cell colour driven by the value in the cell. Later rules win where they overlap.'
      }),
      list,
      Controls.actions([
        Controls.button(selected.length ? 'Add for selection (' + selected.length + ')' : 'Add rule',
          () => PanelColor.addRule(selected, columns, byId), { kind: 'primary' })
      ])
    ], { key: 'color.rules', action: Controls.collapseAll('dataColor', spec.dataColor) }));

    return panel;
  },

  ruleBody(rule, index, spec, columns, byId) {
    const body = Util.el('div');
    const update = (fn, coalesce) => Store.update((draft) => fn(draft.dataColor[index]), { coalesce: coalesce });

    // Blank means *nothing* here, and blank means *everything* in a style
    // rule's location — the same widget, the same None button, the opposite
    // meaning. Both are right: a colour rule with no column would have to fit
    // one scale across the whole table, and a style rule for a whole part is
    // the ordinary way to write one. So the labels say which is which.
    body.appendChild(Util.el('div.mini-label', { text: 'Columns (blank = none)' }));
    body.appendChild(Controls.field(null, Controls.columnChips('dc.cols.' + rule.id, columns, rule.columns,
      (value) => update((r) => { r.columns = value; })), { wide: true }));

    /*
     * Which values drive the colour, as against which cells get painted. gt
     * has this as `target_columns`, from the other end: it takes the values in
     * `columns` and paints `target_columns`. Saying it this way round keeps
     * `Columns` meaning what it has always meant here — the cells that change
     * colour — and makes the extra control the unusual one.
     */
    body.appendChild(Util.el('div.mini-label', { text: 'Colour by (blank = each column’s own values)' }));
    body.appendChild(Controls.field(null, Controls.columnChips('dc.from.' + rule.id, columns,
      rule.valuesFrom || [], (value) => update((r) => { r.valuesFrom = value; })), { wide: true }));

    body.appendChild(Controls.field('Scale', Controls.select('dc.method.' + rule.id,
      PanelColor.METHODS, Spec.colorMethod(rule),
      (value) => update((r) => { r.method = value; }))));

    body.appendChild(Controls.field('Palette',
      Controls.palettePicker('dc.palette.' + rule.id, rule.palette || 'Blues', (value) => {
        update((r) => {
          r.palette = value;
          if (value === 'custom') {
            // Seed the stops from whatever ramp was on screen, so switching to
            // custom starts where the eye already was rather than at white.
            const from = Spec.colorRamp(r);
            r.stops = Object.assign({
              low: Palettes.toCss(Palettes.sample(from, 0)),
              mid: Palettes.toCss(Palettes.sample(from, 0.5)),
              high: Palettes.toCss(Palettes.sample(from, 1))
            }, r.stops || {});
            return;
          }
          // A diverging palette is meaningless without a centre to diverge from.
          if (Palettes.isDiverging(value) && (r.midpoint === null || r.midpoint === undefined)) {
            r.midpoint = 0;
          } else if (!Palettes.isDiverging(value)) {
            r.midpoint = null;
          }
        });
      }, { custom: Spec.colorRamp(rule) }), { wide: true }));

    if (rule.palette === 'custom' && Spec.colorMethod(rule) === 'numeric') {
      const stops = rule.stops || {};
      const hasMid = rule.midpoint !== null && rule.midpoint !== undefined;
      const stop = (key, label) => Controls.field(label,
        Controls.color('dc.stop.' + key + '.' + rule.id, stops[key] || '#FFFFFF',
          (value) => update((r) => {
            r.stops = Object.assign({}, r.stops, { [key]: value });
          }, 'dc.stop.' + key + '.' + rule.id)));
      body.appendChild(stop('low', 'Low'));
      // The middle colour is what a neutral centre is *for*, so it appears
      // with the midpoint rather than as a control that quietly does nothing.
      if (hasMid) body.appendChild(stop('mid', 'Middle'));
      body.appendChild(stop('high', 'High'));
      if (!hasMid) {
        body.appendChild(Util.el('div.field-hint', {
          text: 'Set a midpoint below to add a third colour in the middle.'
        }));
      }
    }

    if (Spec.colorMethod(rule) === 'factor') {
      const levels = PanelColor.levelEditor(rule, spec, byId, update);
      if (levels) body.appendChild(levels);
    }

    if (Spec.colorMethod(rule) === 'numeric') {
      const domain = rule.domain || [];
      body.appendChild(Controls.field('Domain', [
        Controls.number('dc.domain0.' + rule.id, domain[0] === undefined ? null : domain[0],
          (value) => update((r) => { r.domain = [value, (r.domain || [])[1]]; }, 'dc.domain.' + rule.id),
          { nullable: true, step: 'any', placeholder: 'min' }),
        Controls.number('dc.domain1.' + rule.id, domain[1] === undefined ? null : domain[1],
          (value) => update((r) => { r.domain = [(r.domain || [])[0], value]; }, 'dc.domain.' + rule.id),
          { nullable: true, step: 'any', placeholder: 'max' })
      ], { hint: 'Leave blank to fit the data. Fix it to keep colours comparable across tables.' }));

      body.appendChild(Controls.field('Midpoint',
        Controls.number('dc.mid.' + rule.id, rule.midpoint === undefined ? null : rule.midpoint,
          (value) => update((r) => { r.midpoint = value; }, 'dc.mid.' + rule.id),
          { nullable: true, step: 'any', placeholder: 'none' }),
        { hint: 'Pins the palette’s neutral centre to this value — set it for diverging palettes.' }));
    }

    body.appendChild(Controls.field('Reverse', Controls.checkbox('dc.rev.' + rule.id, !!rule.reverse,
      (value) => update((r) => { r.reverse = value; }))));

    body.appendChild(Controls.field('Apply to', Controls.select('dc.apply.' + rule.id,
      [{ value: 'fill', label: 'Cell fill' }, { value: 'text', label: 'Text colour' }],
      rule.applyTo || 'fill', (value) => update((r) => { r.applyTo = value; }))));

    if ((rule.applyTo || 'fill') === 'fill') {
      body.appendChild(Controls.field('Auto-contrast text',
        Controls.checkbox('dc.auto.' + rule.id, rule.autocolorText !== false,
          (value) => update((r) => { r.autocolorText = value; })),
        { hint: 'Flips text between the table’s dark and light colours for legibility.' }));

      if (rule.autocolorText !== false) {
        body.appendChild(Controls.field('Contrast', Controls.select('dc.algo.' + rule.id,
          [{ value: 'apca', label: 'APCA (gt’s default)' }, { value: 'wcag', label: 'WCAG 2.1' }],
          Spec.colorContrast(rule, spec.options).algo,
          (value) => update((r) => { r.contrastAlgo = value; })),
        { hint: 'Which readability measure decides the flip. The two disagree on about a ' +
          'third of ordinary fills — mid greys, most saturated mid-tones, every teal.' }));

        const contrast = Spec.colorContrast(rule, spec.options);
        body.appendChild(Controls.field('Light text',
          Controls.color('dc.light.' + rule.id, rule.autocolorLight || '',
            (value) => update((r) => {
              if (value) r.autocolorLight = value;
              else delete r.autocolorLight;
            }, 'dc.light.' + rule.id),
            { nullable: true, placeholder: contrast.light })));
        body.appendChild(Controls.field('Dark text',
          Controls.color('dc.dark.' + rule.id, rule.autocolorDark || '',
            (value) => update((r) => {
              if (value) r.autocolorDark = value;
              else delete r.autocolorDark;
            }, 'dc.dark.' + rule.id),
            { nullable: true, placeholder: contrast.dark }),
          { hint: 'Blank uses the table’s own type colours.' }));
      }

      body.appendChild(Controls.field('Opacity',
        Controls.number('dc.alpha.' + rule.id, rule.alpha === undefined ? 1 : rule.alpha,
          (value) => update((r) => { r.alpha = Util.clamp(value, 0, 1); }, 'dc.alpha.' + rule.id),
          { min: 0, max: 1, step: 0.05 })));
    }

    body.appendChild(Controls.field('Missing values',
      Controls.color('dc.na.' + rule.id, rule.naColor || '',
        (value) => update((r) => {
          if (value) r.naColor = value;
          else delete r.naColor;
        }, 'dc.na.' + rule.id), { nullable: true, placeholder: 'leave uncoloured' }),
      { hint: 'gt’s na_color. Blank leaves an empty cell the table’s own background.' }));

    body.appendChild(Controls.field('Shared scale',
      Controls.checkbox('dc.shared.' + rule.id, rule.sharedDomain !== false,
        (value) => update((r) => { r.sharedDomain = value; })),
      { hint: 'On fits one scale across every listed column — right when they share units, wrong when they do not.' }));

    // Null when the rule names no column that still exists — deselecting them
    // all, or an import that took the column away. `appendChild(null)` throws
    // and the rail goes blank with nothing on screen to explain it.
    const legend = PanelColor.legend(rule, spec, byId);
    if (legend) body.appendChild(legend);

    return body;
  },

  /** How many categories are worth listing before the panel becomes a wall. */
  MAX_LEVELS: 24,

  /**
   * One swatch per category, in the order the palette is mapped onto them.
   *
   * The order is not cosmetic: gt takes `levels =` and a matching `palette =`
   * and pairs them positionally, so this list *is* the mapping. It comes from
   * the built model rather than being derived here, because `compute.js` has
   * already decided it and two producers of "which category is which colour"
   * is the fault this codebase keeps paying for.
   *
   * An untouched level shows what the palette gave it; picking a colour pins
   * that one and leaves the rest alone, so a rule can override one category
   * without restating the others.
   */
  levelEditor(rule, spec, byId, update) {
    const scale = PanelColor.scaleFor(rule, byId);
    const levels = scale && scale.levels;
    if (!levels || !levels.length) return null;

    const chosen = rule.levelColors || {};
    const wrap = Util.el('div', { style: { marginTop: '7px' } });
    wrap.appendChild(Util.el('div.mini-label', { text: 'Categories (' + levels.length + ')' }));

    for (const level of levels.slice(0, PanelColor.MAX_LEVELS)) {
      const current = scale.colorOf(level) || '#FFFFFF';
      wrap.appendChild(Controls.field(Util.truncate(String(level), 22),
        Controls.color('dc.level.' + Util.slug(String(level)) + '.' + rule.id,
          chosen[level] || current,
          (value) => update((r) => {
            r.levelColors = Object.assign({}, r.levelColors);
            if (value) r.levelColors[level] = value;
            else delete r.levelColors[level];
          }, 'dc.level.' + Util.slug(String(level)) + '.' + rule.id),
          { nullable: true, placeholder: current })));
    }

    if (levels.length > PanelColor.MAX_LEVELS) {
      wrap.appendChild(Util.el('div.field-hint', {
        text: (levels.length - PanelColor.MAX_LEVELS) + ' more take the palette in order.'
      }));
    }

    if (Object.keys(chosen).length) {
      wrap.appendChild(Controls.actions([
        Controls.button('Reset to the palette',
          () => update((r) => { delete r.levelColors; }), { kind: 'ghost' })
      ]));
    }

    return wrap;
  },

  /** A strip showing the scale as it will actually be applied. */
  /**
   * The scale a rule resolves to, built here rather than read off `App.model`.
   *
   * The panel is rebuilt on the keystroke and the render loop is coalesced
   * into an animation frame, so the model is a frame behind — a swatch list
   * taken from it would show the *previous* rule's categories. Building it
   * from the same inputs `compute.js` uses gives the same answer without the
   * lag: `Palettes.scale` is the one producer, this is a second caller.
   */
  scaleFor(rule, byId) {
    const columns = Spec.colorValueColumns(rule).filter((id) => byId[id]);
    if (!columns.length) return null;

    const values = [];
    for (const row of App.workingRows()) {
      for (const id of columns) values.push(row[id]);
    }

    return Palettes.scale({
      colors: Spec.colorRamp(rule),
      method: Spec.colorMethod(rule),
      values: values,
      domain: rule.domain && rule.domain.length === 2 ? rule.domain : null,
      reverse: !!rule.reverse,
      midpoint: rule.midpoint,
      levelColors: rule.levelColors || {},
      naColor: rule.naColor || null
    });
  },

  legend(rule, spec, byId) {
    if (!(rule.columns || []).filter((id) => byId[id]).length) return null;
    const scale = PanelColor.scaleFor(rule, byId);
    if (!scale) return null;

    const wrap = Util.el('div', { style: { marginTop: '7px' } });
    wrap.appendChild(Util.el('div.mini-label', { text: 'Scale' }));

    if (Spec.colorMethod(rule) === 'factor') {
      const chips = scale.levels.slice(0, 14).map((level) => Util.el('span.chip.chip-static', {
        text: Util.truncate(level, 12),
        style: { background: scale.of(level), color: Palettes.readableOn(scale.of(level), '#000', '#fff'), borderColor: 'transparent' }
      }));
      wrap.appendChild(Util.el('div.chip-set', null, chips));
      if (scale.levels.length > 14) {
        wrap.appendChild(Util.el('div.field-hint', { text: (scale.levels.length - 14) + ' more levels' }));
      }
      return wrap;
    }

    // Nothing numeric in the column means no domain to draw. The caller
    // already handles a null legend; a ramp labelled "NaN — NaN" would be
    // worse than saying so.
    if (!scale.breaks.length || !scale.breaks.every((n) => Number.isFinite(n))) {
      wrap.appendChild(Util.el('div.field-hint', {
        text: 'No numeric values in this column yet, so there is no scale to show.'
      }));
      return wrap;
    }

    const stops = [];
    for (let i = 0; i <= 24; i += 1) {
      const t = i / 24;
      const lo = scale.breaks[0];
      const hi = scale.breaks[scale.breaks.length - 1];
      const color = scale.of(lo + (hi - lo) * t);
      stops.push(color || 'transparent');
    }

    wrap.appendChild(Util.el('div', {
      style: {
        height: '13px', borderRadius: '2px', border: '1px solid var(--border-subtle)',
        background: 'linear-gradient(to right, ' + stops.join(', ') + ')'
      }
    }));

    const format = (n) => (Math.abs(n) >= 1000 || (n !== 0 && Math.abs(n) < 0.01))
      ? n.toExponential(1) : String(Math.round(n * 100) / 100);

    wrap.appendChild(Util.el('div', {
      style: { display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-dim)' }
    }, [
      Util.el('span', { text: format(scale.breaks[0]) }),
      Util.el('span', { text: format(scale.breaks[scale.breaks.length - 1]) })
    ]));

    return wrap;
  },

  addRule(selected, columns, byId) {
    const numeric = columns.filter((c) => byId[c.id] && byId[c.id].type === 'number');
    const target = selected.length ? selected : (numeric.length ? [numeric[0].id] : []);

    if (!target.length) {
      Util.toast('No columns available', 'error');
      return;
    }

    const allNumeric = target.every((id) => byId[id] && byId[id].type === 'number');

    Store.update((draft) => {
      draft.dataColor.push({
        id: Util.uid('dc'),
        enabled: true,
        columns: target,
        valuesFrom: [],
        palette: allNumeric ? 'Blues' : 'Tableau10',
        method: allNumeric ? 'numeric' : 'factor',
        stops: {},
        levelColors: {},
        domain: null,
        midpoint: null,
        naColor: null,
        reverse: false,
        applyTo: 'fill',
        autocolorText: true,
        // gt's own default, and the two algorithms disagree often enough that
        // starting anywhere else would mean the first export looked different
        // from the first preview.
        contrastAlgo: 'apca',
        alpha: 1,
        sharedDomain: true
      });
    });
  }
};
