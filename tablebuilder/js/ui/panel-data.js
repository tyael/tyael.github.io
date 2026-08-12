/**
 * ui/panel-data.js
 *
 * The Data panel: what was imported, how each column was typed, and the
 * controls for replacing or re-typing it.
 */

const PanelData = {

  id: 'data',
  label: 'Data',

  render(spec) {
    const panel = Util.el('div.panel');
    const source = spec.source;

    if (!Spec.hasData(spec)) {
      panel.appendChild(Controls.intro('Import a CSV or TSV to begin. Everything else in the app works off that one file.'));
      panel.appendChild(Controls.button('Import CSV…', () => App.pickCsv(), { kind: 'primary', block: true }));
      panel.appendChild(Util.el('div', { style: { height: '10px' } }));
      panel.appendChild(PanelData.samples());
      return panel;
    }

    /* ---- Summary ---- */

    panel.appendChild(Controls.section('File', [
      Controls.field('Name', Util.el('span.mono.dim', { text: Util.truncate(source.filename, 30) })),
      Controls.field('Rows', Util.el('span.mono.dim', { text: String(source.rows.length) })),
      Controls.field('Columns', Util.el('span.mono.dim', { text: String(source.columns.length) })),
      Controls.field('Delimiter', Util.el('span.mono.dim', {
        text: source.delimiter === '\t' ? '\\t (tab)' : source.delimiter
      })),
      Controls.field('Table name', Controls.text('meta.name', spec.meta.name,
        (value) => Store.update((draft) => { draft.meta.name = value; }, { coalesce: 'meta.name' }))),
      Controls.actions([
        Controls.button('Replace data…', () => App.pickCsv()),
        Controls.button('Start over', () => App.reset(), { kind: 'danger' })
      ])
    ], { key: 'data.file' }));

    /* ---- Look ---- */

    panel.appendChild(Controls.section('Look', [
      Util.el('div.field-hint', {
        text: 'A starting point you can keep editing. Applying one replaces any option changes you have made.'
      }),
      ThemePicker.render(spec)
    ], { key: 'data.theme' }));

    /* ---- Warnings ---- */

    if (source.warnings && source.warnings.length) {
      panel.appendChild(Controls.section('Import notes', source.warnings.map((w) =>
        Util.el('div.field-hint', { text: '• ' + w })
      ), { key: 'data.warnings' }));
    }

    /* ---- Column types ---- */

    const typeRows = source.columns.map((col) => Util.el('div.item', null, [
      Util.el('div.item-head', null, [
        Util.el('div.item-title', { text: col.name, title: col.name }),
        Util.el('span.type-badge.type-' + col.type, { text: col.type })
      ]),
      Util.el('div.item-sub', { text: col.id }),
      Util.el('div.item-body', null, [
        Controls.field('Type', Controls.select('type.' + col.id,
          ['number', 'text', 'date', 'bool'], col.type,
          (value) => Store.update((draft) => {
            const target = draft.source.columns.find((c) => c.id === col.id);
            if (target) target.type = value;
          })),
        { hint: 'Type decides default alignment and which formatters apply.' })
      ])
    ]));

    panel.appendChild(Controls.section('Columns (' + source.columns.length + ')',
      [Util.el('div.item-list', null, typeRows)],
      { key: 'data.columns', collapsed: true }));

    /* ---- Preview ---- */

    panel.appendChild(Controls.section('First rows', [PanelData.preview(source)],
      { key: 'data.preview', collapsed: true }));

    return panel;
  },

  /** A raw look at the imported data, before any table shaping. */
  preview(source) {
    const wrap = Util.el('div', {
      style: { overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '3px' }
    });
    const table = Util.el('table', {
      style: { borderCollapse: 'collapse', fontSize: '10.5px', fontFamily: 'var(--font-mono)', width: '100%' }
    });

    const headRow = Util.el('tr');
    for (const col of source.columns.slice(0, 8)) {
      headRow.appendChild(Util.el('th', {
        text: Util.truncate(col.name, 12),
        style: {
          padding: '3px 5px', textAlign: 'left', color: 'var(--text-mid)',
          borderBottom: '1px solid var(--border-medium)', whiteSpace: 'nowrap'
        }
      }));
    }
    table.appendChild(Util.el('thead', null, [headRow]));

    const body = Util.el('tbody');
    for (const row of source.rows.slice(0, 8)) {
      const tr = Util.el('tr');
      for (const col of source.columns.slice(0, 8)) {
        tr.appendChild(Util.el('td', {
          text: Util.truncate(String(row[col.id] === undefined ? '' : row[col.id]), 14),
          style: {
            padding: '2px 5px', color: 'var(--text-dim)',
            borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap'
          }
        }));
      }
      body.appendChild(tr);
    }
    table.appendChild(body);
    wrap.appendChild(table);

    const notes = [];
    if (source.columns.length > 8) notes.push((source.columns.length - 8) + ' more columns');
    if (source.rows.length > 8) notes.push((source.rows.length - 8) + ' more rows');

    return Util.el('div', null, [
      wrap,
      notes.length ? Util.el('div.field-hint', { text: notes.join(' · ') + ' not shown' }) : null
    ]);
  },

  /** Sample data buttons, shown when nothing is loaded. */
  samples() {
    return Controls.section('Or load a sample', [
      Controls.button('Long / tidy (region × year × metric)',
        () => App.loadSample('data/samples/long.csv'), { block: true }),
      Util.el('div', { style: { height: '5px' } }),
      Controls.button('Wide (already table-shaped)',
        () => App.loadSample('data/samples/wide.csv'), { block: true }),
      Util.el('div', { style: { height: '5px' } }),
      Controls.button('gtcars (gt’s own example)',
        () => App.loadSample('data/samples/gtcars.csv'), { block: true }),
      Util.el('div.field-hint', {
        text: 'Samples load over http. Opening index.html straight from disk blocks the fetch — use the Import button instead.'
      })
    ], { key: 'data.samples' });
  }
};
