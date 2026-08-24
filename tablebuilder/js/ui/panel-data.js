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
        { hint: 'Type decides default alignment and which formatters apply.' }),
        PanelData.isoField(spec, col)
      ].filter(Boolean))
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
   * The ISO switch for a date column, or null for a column it cannot apply to.
   *
   * Offered here rather than in Shape because it is not a step and cannot be
   * one: it runs *before* the pipeline, so that a sort, a filter and a pivot
   * all read the same normalised value. See `dates.js`.
   *
   * The hint shows the column's own first value becoming ISO, because "what
   * will this do to my data" is answerable exactly and a sentence about it is
   * not. And it counts what it will not be able to read first — those rows
   * keep their text and stop sorting with the others, which is worth knowing
   * before the switch is thrown rather than after.
   */
  isoField(spec, col) {
    if (!Dates.eligible(col)) return null;

    const on = Dates.isOn(spec, col.id);
    const unreadable = Dates.unreadable(spec, col.id);

    const bits = [];
    const example = PanelData.isoExample(spec, col);
    if (example) bits.push(example);
    bits.push('Runs before every step in Shape, so sorting and filtering follow the calendar.');
    if (unreadable) {
      bits.push(unreadable + ' value(s) here cannot be read as a date — those keep ' +
        'their text and will not sort with the rest.');
    }

    return Controls.field('Normalise to ISO',
      Controls.checkbox('iso.' + col.id, on, (next) => Store.update((draft) => {
        const list = Dates.requested(draft).filter((id) => id !== col.id);
        if (next) list.push(col.id);
        draft.dates.iso = list;
      }, { label: (next ? 'Normalise ' : 'Stop normalising ') + col.id })),
      { hint: bits.join(' ') });
  },

  /**
   * The column's own first readable value, and what it becomes.
   *
   * Through the same plan the rewrite itself works from, so the promise the
   * hint makes is the one that gets kept — including the clock, which is
   * decided for the whole column rather than for this value.
   */
  isoExample(spec, col) {
    const plan = Dates.plan(spec.source, col);

    for (const row of spec.source.rows) {
      const raw = row[col.id];
      const iso = Dates.isoOf(plan, raw);
      if (iso === null) continue;
      if (iso === String(raw)) return 'Already ISO.';
      return '“' + raw + '” becomes “' + iso + '”.';
    }
    return null;
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
    // By id rather than a set of them, because a stale entry carries what was
    // in the cell instead — which is what `Dates.rewrote` compares against.
    const stale = new Map();
    for (const entry of ((model && model.staleCorrections) || [])) stale.set(entry.id, entry);
    const columns = App.workingColumnsById();
    let byIso = 0;

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

      const entry = stale.get(correction.id);
      const nodes = [
        Util.el('div.item-head', null, head),
        Util.el('div.item-sub', {
          text: entry ? where + '  ·  not applied' : where
        })
      ];

      if (entry && Dates.rewrote(spec, correction.colId, correction.from, entry.found)) {
        byIso += 1;
        nodes.push(PanelData.isoStaleNote(correction, entry.found));
      }

      return Util.el('div.item', null, nodes);
    });

    const nodes = [
      Util.el('div.field-hint', {
        text: 'Edits made to individual cells. They live in the project, never in the ' +
          'imported file, and they reach the exports — including the R, as a ' +
          'dplyr::mutate() step.'
      }),
      Util.el('div.item-list', null, rows)
    ];

    // Only the ones with nothing better to say about them. A replaced import is
    // the usual cause and worth guessing at when nothing is known — but each
    // entry the ISO switch broke already carries a note naming the switch and
    // offering the two ways out, and restating the guess underneath it makes
    // the answer look like one more thing that might be wrong.
    const unexplained = stale.size - byIso;
    if (unexplained) {
      nodes.push(Util.el('div.field-hint.is-warn', {
        text: unexplained + ' of these no longer match the value they were made against, ' +
          'so they are not being applied. That usually means the data was replaced.'
      }));
    }

    return Controls.section('Corrections (' + list.length + ')', nodes,
      { key: 'data.corrections' });
  },

  /**
   * Why normalising a column stopped a correction applying, and the two ways
   * out of it.
   *
   * The behaviour was already right and already visible — the correction was
   * listed as stale, correctly — and what was missing was the connection
   * between the switch in this same panel and the corrections below it going
   * quiet. Read without it, corrections simply break.
   *
   * The guard is not the thing to soften. It is what stops a correction landing
   * on somebody else's row after an import over an existing project, so the
   * note says what it is for rather than apologising for it.
   *
   * Keeping ISO leads, because that is what the switch was thrown for. Turning
   * it off is the other answer and belongs here too — this is where the
   * consequence showed up, and the switch is a long way up a collapsed list.
   */
  isoStaleNote(correction, found) {
    return Util.el('div.item-body', null, [
      Util.el('div.field-hint.is-warn', {
        text: 'Normalise to ISO rewrote this cell to “' + Util.truncate(String(found), 24) +
          '”, so the value this correction was written against is no longer in it. ' +
          'A correction only applies while its cell still holds that value — which is ' +
          'what stops one landing on the wrong row when the data is replaced.'
      }),
      Controls.actions([
        Controls.button('Rewrite as ISO', () => Store.update((draft) => {
          Corrections.rebase(draft, correction.id);
        }, { label: 'Rewrite correction as ISO' })),
        Controls.button('Stop normalising', () => Store.update((draft) => {
          draft.dates.iso = Dates.requested(draft).filter((id) => id !== correction.colId);
        }, { label: 'Stop normalising ' + correction.colId }))
      ])
    ]);
  },

  /** Sample data buttons, shown when nothing is loaded. */
  samples() {
    const nodes = [];
    for (const sample of App.SAMPLES) {
      if (nodes.length) nodes.push(Util.el('div', { style: { height: '5px' } }));
      nodes.push(Controls.button(sample.label,
        () => App.loadSample(sample.path), { block: true }));
    }
    return Controls.section('Or load a sample', nodes, { key: 'data.samples' });
  }
};
