/**
 * ui/panel-data.js
 *
 * The Data panel: what was imported, how each column was typed, and the
 * controls for replacing or re-typing it.
 */

const PanelData = {

  id: 'data',
  label: 'Data',
  hint: 'The CSV, its columns and their types',

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
        // The same flow the top bar's New project runs, so there is one way to
        // clear a project and one place that offers to save it first.
        Controls.button('New project…', () => App.newProject(), { kind: 'danger' })
      ])
    ], { key: 'data.file' }));

    /* ---- Look ---- */

    panel.appendChild(Controls.section('Themes', [
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

    /* ---- Corrections ---- */

    const corrections = PanelData.corrections(spec);
    if (corrections) panel.appendChild(corrections);

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

    // "In the file", because the Columns tab counts the pipeline's columns and
    // a pivot makes those two numbers differ — five here and eight there, both
    // right, and nothing said why.
    panel.appendChild(Controls.section('Columns in the file (' + source.columns.length + ')',
      [Util.el('div.item-list', null, typeRows)],
      { key: 'data.columns', collapsed: true }));

    return panel;
  },

  /**
   * Every cell correction made in this project, or null if there are none.
   *
   * A correction is invisible once you have clicked away from the cell — the
   * table just shows the corrected value, which is the point. That makes this
   * list the only place the question "what does this table say that the file
   * does not" can be asked, and it belongs in the Data panel because that is
   * where the file is described.
   *
   * Stale ones are shown too, and shown as stale. A correction dropped silently
   * on import is the failure mode `from` exists to prevent, so it has to
   * surface where it can be read and retired.
   */
  corrections(spec) {
    const list = (Pipeline.find(spec, 'correct') || {}).edits || [];
    if (!list.length) return null;

    const model = App.model;
    const stale = new Set(((model && model.staleCorrections) || []).map((c) => c.id));
    const columns = App.workingColumnsById();

    const rows = list.map((correction) => {
      const column = columns[correction.colId];
      const where = (column ? Spec.columnTitle(spec, column) : correction.colId) +
        ', row ' + (correction.srcIndex + 1);

      const head = [
        Util.el('div.item-title', {
          text: '“' + Util.truncate(correction.from, 18) + '” → “' +
            Util.truncate(correction.to, 18) + '”'
        }),
        Controls.button('Remove', () => Store.update((draft) => {
          Corrections.remove(draft, correction.id);
        }, { label: 'Remove correction' }), { kind: 'ghost' })
      ];

      return Util.el('div.item', null, [
        Util.el('div.item-head', null, head),
        Util.el('div.item-sub', {
          text: stale.has(correction.id) ? where + '  ·  not applied' : where
        })
      ]);
    });

    const nodes = [
      Util.el('div.field-hint', {
        text: 'Edits made to individual cells. They live in the project, never in the ' +
          'imported file, and they reach the exports — including the R, as a ' +
          'dplyr::mutate() step.'
      }),
      Util.el('div.item-list', null, rows)
    ];

    if (stale.size) {
      nodes.push(Util.el('div.field-hint.is-warn', {
        text: stale.size + ' of these no longer match the value they were made against, ' +
          'so they are not being applied. That usually means the data was replaced.'
      }));
    }

    return Controls.section('Corrections (' + list.length + ')', nodes,
      { key: 'data.corrections' });
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
        () => App.loadSample('data/samples/gtcars.csv'), { block: true })
    ], { key: 'data.samples' });
  }
};
