/**
 * ui/panel-color.js
 *
 * The Colour panel: gt's `data_color()`.
 *
 * A rule fits a colour scale to the values in a set of columns and paints each
 * cell accordingly — continuous ramps, equal-width bins, quantiles, or one
 * colour per category. Text can be auto-flipped to whichever of the light and
 * dark table colours reads better on the fill.
 */

const PanelColor = {

  id: 'color',
  label: 'Colour',

  METHODS: [
    { value: 'numeric', label: 'Continuous' },
    { value: 'bin', label: 'Equal bins' },
    { value: 'quantile', label: 'Quantiles' },
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
      title: (rule) => (rule.palette || 'Blues') + ' → ' + rule.columns.length +
        ' column' + (rule.columns.length === 1 ? '' : 's'),
      subtitle: (rule) => (PanelColor.METHODS.find((m) => m.value === rule.method) || {}).label +
        ' · ' + (rule.applyTo === 'text' ? 'text' : 'fill'),
      enabled: (rule) => rule.enabled !== false,
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
    ], { key: 'color.rules' }));

    return panel;
  },

  ruleBody(rule, index, spec, columns, byId) {
    const body = Util.el('div');
    const update = (fn, coalesce) => Store.update((draft) => fn(draft.dataColor[index]), { coalesce: coalesce });

    body.appendChild(Controls.field(null, Controls.columnChips('dc.cols.' + rule.id, columns, rule.columns,
      (value) => update((r) => { r.columns = value; })), { wide: true }));

    body.appendChild(Controls.field('Palette',
      Controls.palettePicker('dc.palette.' + rule.id, rule.palette || 'Blues', (value) => {
        update((r) => {
          r.palette = value;
          // A diverging palette is meaningless without a centre to diverge from.
          if (Palettes.isDiverging(value) && (r.midpoint === null || r.midpoint === undefined)) {
            r.midpoint = 0;
          } else if (!Palettes.isDiverging(value)) {
            r.midpoint = null;
          }
        });
      }), { wide: true }));

    body.appendChild(Controls.field('Method', Controls.select('dc.method.' + rule.id,
      PanelColor.METHODS, rule.method || 'numeric',
      (value) => update((r) => { r.method = value; }))));

    if (rule.method === 'bin' || rule.method === 'quantile') {
      body.appendChild(Controls.field('Bins', Controls.number('dc.bins.' + rule.id, rule.bins || 5,
        (value) => update((r) => { r.bins = Util.clamp(value, 2, 24); }), { min: 2, max: 24, step: 1 })));
    }

    if (rule.method === 'numeric') {
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

      body.appendChild(Controls.field('Opacity',
        Controls.number('dc.alpha.' + rule.id, rule.alpha === undefined ? 1 : rule.alpha,
          (value) => update((r) => { r.alpha = Util.clamp(value, 0, 1); }, 'dc.alpha.' + rule.id),
          { min: 0, max: 1, step: 0.05 })));
    }

    body.appendChild(Controls.field('Shared scale',
      Controls.checkbox('dc.shared.' + rule.id, rule.sharedDomain !== false,
        (value) => update((r) => { r.sharedDomain = value; })),
      { hint: 'On fits one scale across every listed column — right when they share units, wrong when they do not.' }));

    body.appendChild(PanelColor.legend(rule, spec, byId));

    return body;
  },

  /** A strip showing the scale as it will actually be applied. */
  legend(rule, spec, byId) {
    const columns = (rule.columns || []).filter((id) => byId[id]);
    if (!columns.length) return null;

    const working = Reshape.derive(spec.source, spec.reshape);
    const values = [];
    for (const row of working.rows) {
      for (const id of columns) values.push(row[id]);
    }

    const scale = Palettes.scale({
      colors: Palettes.byName(rule.palette || 'Blues'),
      method: rule.method || 'numeric',
      values: values,
      domain: rule.domain && rule.domain.length === 2 ? rule.domain : null,
      bins: rule.bins,
      reverse: !!rule.reverse,
      midpoint: rule.midpoint
    });

    const wrap = Util.el('div', { style: { marginTop: '7px' } });
    wrap.appendChild(Util.el('div.mini-label', { text: 'Scale' }));

    if (rule.method === 'factor') {
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
        palette: allNumeric ? 'Blues' : 'Tableau10',
        method: allNumeric ? 'numeric' : 'factor',
        bins: 5,
        domain: null,
        midpoint: null,
        reverse: false,
        applyTo: 'fill',
        autocolorText: true,
        alpha: 1,
        sharedDomain: true
      });
    });
  }
};
