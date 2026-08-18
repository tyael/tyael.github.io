/**
 * ui/panel-reshape.js
 *
 * The Reshape panel: the long -> wide pivot that turns tidy data into a table
 * shape, and generates the spanner tree that goes with it.
 */

const PanelReshape = {

  id: 'reshape',
  label: 'Reshape',
  hint: 'Pivot the data between long and wide before tabulating',

  render(spec) {
    const panel = Util.el('div.panel');

    if (!Spec.hasData(spec)) {
      panel.appendChild(Controls.note('Import data first.'));
      return panel;
    }

    const source = spec.source;
    const columns = source.columns.map((c) => ({ id: c.id, label: c.name }));
    const reshape = spec.reshape;
    const on = reshape.mode === 'pivot';

    panel.appendChild(Controls.intro(
      'Tidy data has one observation per row. A table wants those keys spread across ' +
      'columns with spanners above them. Set that up here — the spanners come with it.'
    ));

    /* ---- Mode ---- */

    const modeSection = Controls.section('Pivot', [
      Controls.field('Enabled', Controls.checkbox('reshape.mode', on, (value) => {
        Store.update((draft) => {
          draft.reshape.mode = value ? 'pivot' : 'none';
          if (value && !draft.reshape.nameCols.length) {
            const guess = Reshape.suggest(draft.source);
            if (guess) Object.assign(draft.reshape, guess);
          }
          PanelReshape.resync(draft);
        });
      }), { hint: on ? null : 'Off — the table uses the file exactly as imported.' })
    ], { key: 'reshape.mode' });
    panel.appendChild(modeSection);

    if (!on) {
      const guess = Reshape.suggest(source);
      if (guess) {
        panel.appendChild(Controls.section('Suggestion', [
          Util.el('div.field-hint', {
            text: 'This file looks long: "' + (source.columns.find((c) => c.id === guess.nameCols[0]) || {}).name +
              '" repeats across rows, so its values could become column groups.'
          }),
          Controls.button('Apply this pivot', () => {
            Store.update((draft) => {
              Object.assign(draft.reshape, guess);
              PanelReshape.resync(draft);
            });
          }, { kind: 'primary', block: true })
        ], { key: 'reshape.suggest' }));
      }
      return panel;
    }

    /* ---- Role assignment ---- */

    panel.appendChild(Controls.section('Rows are identified by', [
      Controls.columnChips('reshape.idCols', columns, reshape.idCols, (value) => {
        Store.update((draft) => {
          draft.reshape.idCols = value;
          PanelReshape.resync(draft);
        });
      }, { ordered: true }),
      Util.el('div.field-hint', { text: 'One output row per distinct combination of these.' }),
      Util.el('div.field-hint', {
        text: 'The numbers are the order you picked them in, and it is the order they read ' +
          'down the stub: with two or more, 1 becomes the row group and the last the row label. ' +
          'Click a chip off and on again to move it to the end.'
      })
    ], { key: 'reshape.id' }));

    panel.appendChild(Controls.section('Spread across columns', [
      Controls.columnChips('reshape.nameCols', columns, reshape.nameCols, (value) => {
        Store.update((draft) => {
          draft.reshape.nameCols = value;
          PanelReshape.resync(draft);
        });
      }, { ordered: true }),
      Util.el('div.field-hint', {
        text: 'Values here become column groups. Pick more than one to nest spanners.'
      }),
      Util.el('div.field-hint', {
        text: 'The numbers are the order you picked them in, and it is the nesting: 1 is the ' +
          'outermost group and the last sits on the column labels. Click a chip off and on ' +
          'again to move it to the end.'
      })
    ], { key: 'reshape.name' }));

    panel.appendChild(Controls.section('Values come from', [
      Controls.columnChips('reshape.valueCols', columns, reshape.valueCols, (value) => {
        Store.update((draft) => {
          draft.reshape.valueCols = value;
          PanelReshape.resync(draft);
        });
      }, { ordered: true }),
      Util.el('div.field-hint', {
        text: 'With two or more, each group gets one column per value and the group becomes a ' +
          'spanner. They sit in the order you picked them.'
      })
    ], { key: 'reshape.value' }));

    /* ---- Options ---- */

    panel.appendChild(Controls.section('Options', [
      Controls.field('On collision', Controls.select('reshape.aggregate',
        Reshape.AGGREGATES.map((a) => ({ value: a.id, label: a.label })),
        reshape.aggregate,
        (value) => Store.update((draft) => { draft.reshape.aggregate = value; })),
      { hint: 'Used when several source rows land in the same cell.' }),

      Controls.field('Name separator', Controls.text('reshape.sep', reshape.nameSep,
        (value) => Store.update((draft) => {
          draft.reshape.nameSep = value;
        }, { coalesce: 'reshape.sep' })))
    ], { key: 'reshape.options' }));

    /* ---- Result ---- */

    const derived = Reshape.derive(source, reshape);
    const resultNodes = [
      Controls.field('Result', Util.el('span.mono.dim', {
        text: derived.rows.length + ' rows × ' + derived.columns.length + ' columns'
      })),
      Controls.field('Spanners', Util.el('span.mono.dim', {
        text: derived.spanners.length ? String(derived.spanners.length) : 'none'
      }))
    ];

    for (const warning of derived.warnings) {
      resultNodes.push(Util.el('div.field-hint', { text: '⚠ ' + warning }));
    }

    if (derived.spanners.length) {
      resultNodes.push(Controls.button('Rebuild spanners from this pivot', () => {
        Store.update((draft) => {
          const fresh = Reshape.derive(draft.source, draft.reshape);
          draft.structure.spanners = Util.clone(fresh.spanners);
        });
        Util.toast('Spanners rebuilt', 'ok');
      }, { block: true }));
      resultNodes.push(Util.el('div.field-hint', {
        text: 'Only needed if you have edited the spanners by hand and want to start again.'
      }));
    }

    panel.appendChild(Controls.section('Result', resultNodes, { key: 'reshape.result' }));

    return panel;
  },

  /**
   * After a pivot change the column set is different, so the structure section
   * has to be re-pointed at the new columns and the spanners regenerated.
   * Called inside a Store.update, on the draft.
   */
  resync(draft) {
    const derived = Reshape.derive(draft.source, draft.reshape);
    Spec.adoptColumns(draft, derived.columns);

    // Column order follows the derived order, which is already grouped sensibly.
    draft.structure.columnOrder = derived.columns.map((c) => c.id);

    // Pivoted columns get their short (innermost) label; the spanners carry the rest.
    for (const col of derived.columns) {
      if (col.shortName) draft.structure.labels[col.id] = col.shortName;
    }

    draft.structure.spanners = Util.clone(derived.spanners);

    // The id columns are what identifies a row, so they make the obvious stub.
    // With more than one, the outer column reads as a row group and the
    // innermost as the row label — country > city, not city > country.
    const idCols = draft.reshape.idCols;
    if (draft.reshape.mode === 'pivot' && idCols.length && !draft.structure.rownameCol) {
      draft.structure.rownameCol = idCols[idCols.length - 1];
      if (idCols.length > 1 && !draft.structure.groupnameCol) {
        draft.structure.groupnameCol = idCols[0];
      }
    }
  }
};
