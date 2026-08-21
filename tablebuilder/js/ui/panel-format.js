/**
 * ui/panel-format.js
 *
 * The Format panel: gt's `fmt_*()` family, plus missing/zero substitution.
 *
 * Each rule targets a set of columns with one formatter. The formatter's own
 * controls are generated from its declared parameters in formatters.js, so this
 * panel needs no per-formatter markup.
 */

const PanelFormat = {

  id: 'format',
  label: 'Number format',
  hint: 'How numbers, dates and missing values are printed',

  render(spec) {
    const panel = Util.el('div.panel');

    if (!Spec.hasData(spec)) {
      panel.appendChild(Controls.note('Import data first.'));
      return panel;
    }

    const columns = App.workingColumns();
    const byId = {};
    for (const col of columns) byId[col.id] = col;

    panel.appendChild(PanelFormat.rulesSection(spec, columns, byId));
    panel.appendChild(PanelFormat.substitutionSection(spec));

    return panel;
  },

  rulesSection(spec, columns, byId) {
    const list = Controls.itemList(spec.format, (rule, index) => {
      const def = Formatters.get(rule.type);
      const body = Util.el('div');

      body.appendChild(Controls.field('Formatter', Controls.select('fmt.type.' + rule.id,
        Formatters.types.map((f) => ({ value: f.type, label: f.label })), rule.type,
        (value) => Store.update((draft) => {
          draft.format[index].type = value;
          draft.format[index].opts = Formatters.defaults(value);
        }))));

      // Blank means nothing here, and means every column in a style rule's
      // location. Same widget, same None button, opposite meaning — see the
      // note in `panel-color.js`.
      body.appendChild(Util.el('div.mini-label', { text: 'Columns (blank = none)' }));
      body.appendChild(Controls.field(null, Controls.columnChips('fmt.cols.' + rule.id,
        columns, rule.columns,
        (value) => Store.update((draft) => { draft.format[index].columns = value; })),
        { wide: true }));

      if (def && def.hint) body.appendChild(Util.el('div.field-hint', { text: def.hint }));

      if (def) {
        const opts = Formatters.resolveOpts(rule.type, rule.opts);
        for (const param of def.params) {
          body.appendChild(Controls.field(param.label,
            Controls.forParam(param, opts[param.key], (value) => {
              Store.update((draft) => {
                if (!draft.format[index].opts) draft.format[index].opts = {};
                draft.format[index].opts[param.key] = value;
              }, { coalesce: 'fmt.' + rule.id + '.' + param.key });
            }, 'fmt.' + rule.id),
            { hint: param.hint }));
        }

        // There is nothing to preview for a rule with no columns yet, or one
        // whose column holds nothing but missing values — both return null,
        // and `appendChild(null)` throws, which takes the whole rail down.
        const sample = PanelFormat.samplePreview(rule, columns, byId);
        if (sample) body.appendChild(sample);
      }

      return body;
    }, {
      key: 'format',
      collapsible: true,
      title: (rule) => {
        const def = Formatters.get(rule.type);
        return (def ? def.label : rule.type) + ' → ' + rule.columns.length +
          ' column' + (rule.columns.length === 1 ? '' : 's');
      },
      subtitle: (rule) => rule.columns
        .map((id) => (byId[id] ? byId[id].label : id)).join(', ') || 'no columns',
      enabled: (rule) => Spec.isEnabled(rule),
      onToggle: (rule, index, on) => Store.update((draft) => { draft.format[index].enabled = on; }),
      onRemove: (rule, index) => Store.update((draft) => { draft.format.splice(index, 1); }),
      onReorder: (from, to) => Store.update((draft) => {
        draft.format = Util.moveItem(draft.format, from, to);
      })
    });

    const selected = Selection.selectedColumnIds();

    return Controls.section('Format rules', [
      Util.el('div.field-hint', {
        text: 'Later rules win where they overlap. Values a formatter cannot handle are left as they are, ' +
          'so a stray "n/a" in a numeric column survives.'
      }),
      list,
      Controls.actions([
        Controls.button(selected.length ? 'Add for selection (' + selected.length + ')' : 'Add rule',
          () => PanelFormat.addRule(selected, columns, byId), { kind: 'primary' }),
        Controls.button('Auto-format numbers', () => PanelFormat.autoFormat(columns),
          { title: 'One suggested rule per numeric column, based on its values' })
      ])
    ], { key: 'fmt.rules', action: Controls.collapseAll('format', spec.format) });
  },

  addRule(selected, columns, byId) {
    const target = selected.length ? selected : (columns.length ? [columns[0].id] : []);
    if (!target.length) return;

    const spec = Store.get();
    const working = { rows: App.workingRows() };
    const values = working.rows.map((row) => row[target[0]]);
    const type = Formatters.suggest(byId[target[0]], values);

    Store.update((draft) => {
      draft.format.push({
        id: Util.uid('fmt'),
        enabled: true,
        type: type,
        columns: target,
        rows: { mode: 'all', indices: [], expr: '' },
        opts: Formatters.defaults(type)
      });
    });
  },

  autoFormat(columns) {
    // `columns` is `App.workingColumns()` — the pipeline's output, carrying the
    // type each column was inferred as. Looking the type up a second way is
    // what broke this: it went through the reshaped source, whose columns a
    // pivot's output is never among, and which the pipeline no longer hands
    // back at all.
    const rows = App.workingRows();

    // Columns sharing a suggested formatter are grouped into one rule rather
    // than producing a wall of near-identical entries.
    const buckets = new Map();
    for (const col of columns) {
      if (col.type !== 'number') continue;
      const values = rows.map((row) => row[col.id]);
      const type = Formatters.suggest(col, values);
      if (!buckets.has(type)) buckets.set(type, []);
      buckets.get(type).push(col.id);
    }

    if (!buckets.size) {
      Util.toast('No numeric columns to format', 'error');
      return;
    }

    Store.update((draft) => {
      for (const [type, ids] of buckets) {
        draft.format.push({
          id: Util.uid('fmt'),
          enabled: true,
          type: type,
          columns: ids,
          rows: { mode: 'all', indices: [], expr: '' },
          opts: Formatters.defaults(type)
        });
      }
    });
    Util.toast(buckets.size + ' rule(s) added', 'ok');
  },

  /** Show the rule applied to a few real values from the first column. */
  samplePreview(rule, columns, byId) {
    if (!rule.columns.length) return null;
    const spec = Store.get();
    const working = { rows: App.workingRows() };
    const colId = rule.columns[0];

    const samples = working.rows
      .map((row) => row[colId])
      .filter((v) => !Util.isMissing(v))
      .slice(0, 3);

    if (!samples.length) return null;

    const opts = Formatters.resolveOpts(rule.type, rule.opts);
    const lines = samples.map((value) => {
      const formatted = Formatters.apply(rule.type, value, opts, { column: byId[colId] });
      return String(value) + '  →  ' + (formatted === null ? String(value) + '  (unchanged)' : formatted);
    });

    return Util.el('div', { style: { marginTop: '6px' } }, [
      Util.el('div.mini-label', { text: 'Preview' }),
      Util.el('div.item-sub', {
        style: { whiteSpace: 'pre', lineHeight: '1.6', color: 'var(--text-mid)' },
        text: lines.join('\n')
      })
    ]);
  },

  substitutionSection(spec) {
    return Controls.section('Missing & zero values', [
      Controls.field('Replace missing', Controls.checkbox('subs.missing.on', spec.subs.missing.enabled,
        (value) => Store.update((draft) => { draft.subs.missing.enabled = value; }))),

      Controls.field('With', Controls.text('subs.missing.text', spec.subs.missing.text,
        (value) => Store.update((draft) => { draft.subs.missing.text = value; },
          { coalesce: 'subs.missing' })),
        { hint: 'Empty cells, NA, N/A, NaN and null all count as missing.' }),

      Controls.field('Replace zeros', Controls.checkbox('subs.zero.on', spec.subs.zero.enabled,
        (value) => Store.update((draft) => { draft.subs.zero.enabled = value; }))),

      Controls.field('With', Controls.text('subs.zero.text', spec.subs.zero.text,
        (value) => Store.update((draft) => { draft.subs.zero.text = value; },
          { coalesce: 'subs.zero' }), { placeholder: '(blank)' }))
    ], { key: 'fmt.subs' });
  }
};
