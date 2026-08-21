/**
 * ui/panel-structure.js
 *
 * The Columns panel: how each column looks — its label, alignment, width,
 * order, and whether it is drawn at all.
 *
 * This is gt's `cols_label()`, `cols_align()`, `cols_width()`,
 * `cols_move_to_start()` and `cols_hide()`.
 *
 * **Everything here is display only.** Hiding a column leaves its values in the
 * data, so a `where` expression still reaches them and so does gt's own
 * `rows =` predicate — `cols_hide()` hides the column, it does not drop it. To
 * take a column out of the data, add a Remove step. The pivot, filter, sort,
 * row labels, row groups, merges and column groups that used to live here are
 * all steps now, because they are all things that change what the table *is*.
 */

const PanelStructure = {

  id: 'structure',
  label: 'Columns',
  hint: 'How each column looks: label, alignment, width, order, hidden',

  render(spec) {
    const panel = Util.el('div.panel');

    if (!Spec.hasData(spec)) {
      panel.appendChild(Controls.note('Import data first.'));
      return panel;
    }

    const columns = App.workingColumns();
    const byId = {};
    for (const col of columns) byId[col.id] = col;

    panel.appendChild(PanelStructure.columnsSection(spec, columns, byId));

    return panel;
  },

  /* ================================================================
     Columns
     ================================================================ */

  /**
   * The step that has taken this column for itself, if one has.
   *
   * A stub or row-group column is consumed by `gt()` and stops being an
   * ordinary column, and two things in the list have to say so: the sub-line
   * that tags it, and the disabled checkbox that explains itself. They were
   * two producers of that one fact, and when these moved into the pipeline
   * only the checkbox was brought across — leaving the sub-line comparing
   * against `structure.rownameCol`, a key that no longer exists, so the tag
   * silently stopped appearing. The step type carries its own name, so the
   * sentence and the tag cannot disagree about what took the column either.
   */
  consumedBy(spec, colId) {
    for (const id of ['stub', 'groups']) {
      const step = Pipeline.find(spec, id);
      if (step && Spec.isEnabled(step) && colId === step.col) return Pipeline.type(id);
    }
    return null;
  },

  columnsSection(spec, columns, byId) {
    const st = spec.structure;
    const hidden = new Set(st.hidden);
    // Every column the pipeline produced, in the preferred order — not the
    // preference filtered by what exists, which showed two columns of a
    // pivoted table's eleven because `columnOrder` still held the pre-pivot
    // ids. `compute.js` orders the same way, through the same function.
    const ordered = Spec.orderColumns(st.columnOrder, columns.map((col) => col.id));

    const list = Controls.itemList(ordered, (colId) => {
      const col = byId[colId];
      const body = Util.el('div');

      body.appendChild(Controls.field('Label',
        Controls.text('col.label.' + colId, st.labels[colId] === undefined ? '' : st.labels[colId],
          (value) => Store.update((draft) => { draft.structure.labels[colId] = value; },
            { coalesce: 'col.label.' + colId }),
          { placeholder: Spec.columnLabel(spec, col) || '(blank heading)' })));

      body.appendChild(Controls.field('Align',
        Controls.select('col.align.' + colId, ['auto', 'left', 'center', 'right'],
          st.align[colId] || 'auto',
          (value) => Store.update((draft) => { draft.structure.align[colId] = value; }))));

      body.appendChild(Controls.field('Width',
        Controls.length('col.width.' + colId, st.widths[colId] || '',
          (value) => Store.update((draft) => {
            if (value) draft.structure.widths[colId] = value;
            else delete draft.structure.widths[colId];
          }, { coalesce: 'col.width.' + colId }), { placeholder: 'auto' })));

      return body;
    }, {
      key: 'columns',
      // One item per column, so this is the longest list in the app on any
      // real dataset — and reordering, hiding and renaming all happen from the
      // collapsed row.
      collapsible: true,
      // `byId[colId].label` is already `Spec.columnTitle` — it never comes back
      // empty, and re-deriving it from `st.labels` here is what let this panel
      // show a column's id while the table drew its humanised name.
      title: (colId) => byId[colId].label,
      subtitle: (colId) => {
        const taken = PanelStructure.consumedBy(spec, colId);
        return byId[colId].id + '  ·  ' + byId[colId].type +
          (taken ? '  ·  ' + taken.label.toLowerCase() : '') +
          (hidden.has(colId) ? '  ·  hidden' : '');
      },
      enabled: (colId) => !hidden.has(colId),
      // A column taken for the row labels or the row groups is consumed by
      // `gt()` itself and is no longer an ordinary column: `compute.js` draws
      // it whatever `hidden` says, and `export-rgt.js` deliberately leaves it
      // out of `cols_hide()`. The checkbox was still offered and did nothing.
      // From the spec, not `App.model`: the rail can be rebuilt before the
      // render loop has recomputed the model, and a notice that lags one edit
      // behind is the stale-state trap this codebase keeps paying for.
      toggleInert: (colId) => {
        const taken = PanelStructure.consumedBy(spec, colId);
        if (!taken) return null;
        return {
          because: 'A ' + taken.label + ' step has taken this column, so it is always shown.',
          fix: { label: 'Go to Shape', panel: 'steps', section: 'steps.table' }
        };
      },
      onToggle: (colId, index, on) => {
        Store.update((draft) => {
          const next = new Set(draft.structure.hidden);
          if (on) next.delete(colId);
          else next.add(colId);
          draft.structure.hidden = Array.from(next);
        });
      },
      onReorder: (from, to) => {
        Store.update((draft) => {
          draft.structure.columnOrder = Util.moveItem(ordered, from, to);
        });
      }
    });

    return Controls.section('Columns (' + ordered.length + ')', [
      Util.el('div.field-hint', {
        text: 'Drag to reorder. Unticking a column takes it off the page without taking it ' +
          'out of the data, so rules and expressions can still reach its values. ' +
          'Auto alignment right-aligns numbers and left-aligns everything else.'
      }),
      list,
      Controls.actions([
        Controls.button('Show all', () => Store.update((draft) => { draft.structure.hidden = []; }), { kind: 'ghost' }),
        // From the raw header the column arrived with, not from its current
        // label — humanising the label leaves a rename in place and only
        // re-cases it, so "Reset" reset nothing on an already-renamed column.
        Controls.button('Reset labels', () => Store.update((draft) => {
          for (const col of columns) draft.structure.labels[col.id] = Util.humanise(col.name);
        }), { kind: 'ghost' })
      ])
    ], { key: 'st.columns', action: Controls.collapseAll('columns', ordered) });
  }
};
