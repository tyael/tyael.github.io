/**
 * ui/panel-structure.js
 *
 * The Structure panel: what the table's skeleton is made of — the stub, row
 * groups, column order and labels, spanners, sorting and column merges.
 *
 * This is gt's `gt(rowname_col=, groupname_col=)`, `cols_*()`, `tab_spanner()`
 * and `cols_merge*()` in one place.
 */

const PanelStructure = {

  id: 'structure',
  label: 'Structure',

  render(spec) {
    const panel = Util.el('div.panel');

    if (!Spec.hasData(spec)) {
      panel.appendChild(Controls.note('Import data first.'));
      return panel;
    }

    const columns = App.workingColumns();
    const byId = {};
    for (const col of columns) byId[col.id] = col;

    panel.appendChild(PanelStructure.stubSection(spec, columns));
    panel.appendChild(PanelStructure.columnsSection(spec, columns, byId));
    panel.appendChild(PanelStructure.spannersSection(spec, columns, byId));
    panel.appendChild(PanelStructure.sortSection(spec, columns));
    panel.appendChild(PanelStructure.mergeSection(spec, columns, byId));

    return panel;
  },

  /* ================================================================
     Stub and row groups
     ================================================================ */

  stubSection(spec, columns) {
    const st = spec.structure;
    const nodes = [];

    nodes.push(Controls.field('Row labels',
      Controls.columnSelect('st.rowname', columns, st.rownameCol, (value) => {
        Store.update((draft) => { draft.structure.rownameCol = value; });
      }),
      { hint: 'This column becomes the stub — the label column on the left.' }));

    nodes.push(Controls.field('Row groups',
      Controls.columnSelect('st.groupname', columns, st.groupnameCol, (value) => {
        Store.update((draft) => {
          draft.structure.groupnameCol = value;
          draft.structure.rowGroupOrder = [];
        });
      }),
      { hint: 'Rows sharing a value here are gathered under a group label.' }));

    if (st.groupnameCol) {
      nodes.push(Controls.field('Show as a column',
        Controls.checkbox('st.groupAsCol', spec.options['row_group.as_column'], (value) => {
          Store.update((draft) => { draft.options['row_group.as_column'] = value; });
        }),
        { hint: 'Off puts the group label on its own spanning row, as gt does by default.' }));

      nodes.push(Controls.field('Missing label',
        Controls.text('st.groupDefault', spec.options['row_group.default_label'], (value) => {
          Store.update((draft) => { draft.options['row_group.default_label'] = value; },
            { coalesce: 'group.default' });
        })));

      // Group ordering.
      const groups = App.groupLabels();
      if (groups.length > 1) {
        nodes.push(Util.el('div.mini-label', { text: 'Group order', style: { marginTop: '8px' } }));
        nodes.push(Controls.itemList(groups, () => null, {
          key: 'groupOrder',
          title: (label) => (label === '' ? '(no label)' : label),
          subtitle: (label) => App.groupCount(label) + ' rows',
          onReorder: (from, to) => {
            Store.update((draft) => {
              draft.structure.rowGroupOrder = Util.moveItem(groups, from, to);
            });
          }
        }));
        nodes.push(Controls.button('Reset order', () => {
          Store.update((draft) => { draft.structure.rowGroupOrder = []; });
        }, { kind: 'ghost' }));
      }
    }

    return Controls.section('Row labels & groups', nodes, { key: 'st.stub' });
  },

  /* ================================================================
     Columns
     ================================================================ */

  columnsSection(spec, columns, byId) {
    const st = spec.structure;
    const hidden = new Set(st.hidden);
    const ordered = st.columnOrder.filter((id) => byId[id]);

    const list = Controls.itemList(ordered, (colId) => {
      const col = byId[colId];
      const body = Util.el('div');

      body.appendChild(Controls.field('Label',
        Controls.text('col.label.' + colId, st.labels[colId] === undefined ? '' : st.labels[colId],
          (value) => Store.update((draft) => { draft.structure.labels[colId] = value; },
            { coalesce: 'col.label.' + colId }))));

      body.appendChild(Controls.field('Align',
        Controls.select('col.align.' + colId, ['auto', 'left', 'center', 'right'],
          st.align[colId] || 'auto',
          (value) => Store.update((draft) => { draft.structure.align[colId] = value; })),
        { hint: 'Auto right-aligns numbers, left-aligns everything else.' }));

      body.appendChild(Controls.field('Width',
        Controls.length('col.width.' + colId, st.widths[colId] || '',
          (value) => Store.update((draft) => {
            if (value) draft.structure.widths[colId] = value;
            else delete draft.structure.widths[colId];
          }, { coalesce: 'col.width.' + colId }), { placeholder: 'auto' })));

      return body;
    }, {
      key: 'columns',
      title: (colId) => (st.labels[colId] || byId[colId].label || colId),
      subtitle: (colId) => byId[colId].id + '  ·  ' + byId[colId].type +
        (colId === st.rownameCol ? '  ·  stub' : '') +
        (colId === st.groupnameCol ? '  ·  groups' : '') +
        (hidden.has(colId) ? '  ·  hidden' : ''),
      enabled: (colId) => !hidden.has(colId),
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
        text: 'Drag to reorder. The checkbox hides a column without removing it from the data.'
      }),
      list,
      Controls.actions([
        Controls.button('Show all', () => Store.update((draft) => { draft.structure.hidden = []; }), { kind: 'ghost' }),
        Controls.button('Reset labels', () => Store.update((draft) => {
          for (const col of columns) draft.structure.labels[col.id] = Util.humanise(col.label);
        }), { kind: 'ghost' })
      ])
    ], { key: 'st.columns' });
  },

  /* ================================================================
     Spanners
     ================================================================ */

  spannersSection(spec, columns, byId) {
    const st = spec.structure;
    const bodyColumns = columns.filter((c) =>
      c.id !== st.rownameCol && c.id !== st.groupnameCol && st.hidden.indexOf(c.id) < 0);

    const list = Controls.itemList(st.spanners, (spanner, index) => {
      const body = Util.el('div');

      body.appendChild(Controls.field('Label',
        Controls.text('sp.label.' + spanner.id, spanner.label, (value) => {
          Store.update((draft) => { draft.structure.spanners[index].label = value; },
            { coalesce: 'sp.label.' + spanner.id });
        })));

      body.appendChild(Controls.field('Level',
        Controls.number('sp.level.' + spanner.id, spanner.level || 1, (value) => {
          Store.update((draft) => { draft.structure.spanners[index].level = Math.max(1, value); });
        }, { min: 1, max: 5, step: 1 }),
        { hint: 'Level 1 sits directly above the column labels; higher levels stack above it.' }));

      body.appendChild(Controls.field(null,
        Controls.columnChips('sp.cols.' + spanner.id, bodyColumns, spanner.columns, (value) => {
          Store.update((draft) => { draft.structure.spanners[index].columns = value; });
        }), { wide: true }));

      return body;
    }, {
      key: 'spanners',
      title: (spanner) => spanner.label || '(unlabelled)',
      subtitle: (spanner) => 'level ' + (spanner.level || 1) + ' · ' +
        spanner.columns.length + ' column' + (spanner.columns.length === 1 ? '' : 's'),
      onRemove: (spanner, index) => {
        Store.update((draft) => { draft.structure.spanners.splice(index, 1); });
      },
      onReorder: (from, to) => {
        Store.update((draft) => {
          draft.structure.spanners = Util.moveItem(draft.structure.spanners, from, to);
        });
      }
    });

    const selectedCols = Selection.selectedColumnIds();

    return Controls.section('Column groups', [
      Util.el('div.field-hint', {
        text: 'A column group is a label sitting above a run of columns — gt calls it a spanner. ' +
          'Columns under one must be adjacent — reorder them above if the group looks broken up.'
      }),
      list,
      Controls.actions([
        Controls.button(selectedCols.length ? 'Add from selection (' + selectedCols.length + ')' : 'Add column group',
          () => PanelStructure.addSpanner(selectedCols, bodyColumns), { kind: 'primary' }),
        Controls.button('From delimiter…', () => PanelStructure.spannersFromDelimiter(bodyColumns),
          { title: 'Split column names on a delimiter, as gt’s tab_spanner_delim() does' })
      ])
    ], { key: 'st.spanners' });
  },

  addSpanner(selectedCols, bodyColumns) {
    const cols = selectedCols.length ? selectedCols : bodyColumns.slice(0, 2).map((c) => c.id);
    if (!cols.length) {
      Util.toast('No columns available to span', 'error');
      return;
    }
    Store.update((draft) => {
      draft.structure.spanners.push({
        id: Util.uid('sp'),
        label: 'Column group',
        columns: cols,
        level: 1
      });
    });
  },

  /** gt's `tab_spanner_delim()`: split column names and lift the prefix out. */
  spannersFromDelimiter(bodyColumns) {
    const delimiter = window.prompt('Split column labels on which delimiter?', '_');
    if (delimiter === null) return;
    if (!delimiter) { Util.toast('Delimiter cannot be empty', 'error'); return; }

    Store.update((draft) => {
      const groups = new Map();

      for (const col of bodyColumns) {
        const label = draft.structure.labels[col.id] || col.label || col.id;
        const index = label.indexOf(delimiter);
        if (index <= 0 || index >= label.length - 1) continue;

        const prefix = label.slice(0, index).trim();
        const suffix = label.slice(index + delimiter.length).trim();
        if (!groups.has(prefix)) groups.set(prefix, []);
        groups.get(prefix).push(col.id);
        draft.structure.labels[col.id] = suffix;
      }

      if (!groups.size) return false;

      for (const [label, cols] of groups) {
        if (cols.length < 1) continue;
        draft.structure.spanners.push({
          id: Util.uid('sp'), label: label, columns: cols, level: 1
        });
      }
      return undefined;
    });

    Util.toast('Spanners built from column names', 'ok');
  },

  /* ================================================================
     Sorting
     ================================================================ */

  sortSection(spec, columns) {
    const sort = spec.structure.sort;

    const list = Controls.itemList(sort, (entry, index) => Util.el('div', null, [
      Controls.field('Column', Controls.columnSelect('sort.col.' + index, columns, entry.col,
        (value) => Store.update((draft) => {
          if (value) draft.structure.sort[index].col = value;
          else draft.structure.sort.splice(index, 1);
        }))),
      Controls.field('Direction', Controls.select('sort.dir.' + index,
        [{ value: 'asc', label: 'Ascending' }, { value: 'desc', label: 'Descending' }],
        entry.dir, (value) => Store.update((draft) => { draft.structure.sort[index].dir = value; })))
    ]), {
      key: 'sort',
      title: (entry) => {
        const col = columns.find((c) => c.id === entry.col);
        return (col ? col.label : entry.col) + (entry.dir === 'desc' ? ' ↓' : ' ↑');
      },
      onRemove: (entry, index) => Store.update((draft) => { draft.structure.sort.splice(index, 1); }),
      onReorder: (from, to) => Store.update((draft) => {
        draft.structure.sort = Util.moveItem(draft.structure.sort, from, to);
      })
    });

    return Controls.section('Sorting', [
      list,
      Controls.button('Add sort key', () => {
        Store.update((draft) => {
          const used = new Set(draft.structure.sort.map((s) => s.col));
          const next = columns.find((c) => !used.has(c.id));
          if (!next) return false;
          draft.structure.sort.push({ col: next.id, dir: 'asc' });
          return undefined;
        });
      }, { block: true }),
      Util.el('div.field-hint', {
        text: 'Sorting happens before grouping, so rows stay inside their group either way.'
      })
    ], { key: 'st.sort', collapsed: true });
  },

  /* ================================================================
     Merges
     ================================================================ */

  mergeSection(spec, columns, byId) {
    const merges = spec.structure.merges;

    const TYPES = [
      { value: 'merge', label: 'Pattern' },
      { value: 'uncert', label: 'Value ± uncertainty' },
      { value: 'range', label: 'Range (a–b)' },
      { value: 'n_pct', label: 'Count (percent)' }
    ];

    const list = Controls.itemList(merges, (merge, index) => {
      const body = Util.el('div');

      body.appendChild(Controls.field('Kind', Controls.select('mg.type.' + merge.id, TYPES, merge.type,
        (value) => Store.update((draft) => { draft.structure.merges[index].type = value; }))));

      body.appendChild(Controls.field('Into', Controls.columnSelect('mg.target.' + merge.id, columns,
        merge.target, (value) => Store.update((draft) => { draft.structure.merges[index].target = value; })),
        { hint: 'The surviving column. The others are hidden.' }));

      body.appendChild(Controls.field(null, Controls.columnChips('mg.cols.' + merge.id,
        columns.filter((c) => c.id !== merge.target), merge.columns,
        (value) => Store.update((draft) => { draft.structure.merges[index].columns = value; })),
        { wide: true }));

      if (merge.type === 'merge') {
        body.appendChild(Controls.field('Pattern', Controls.text('mg.pattern.' + merge.id,
          merge.pattern || '', (value) => Store.update((draft) => {
            draft.structure.merges[index].pattern = value;
          }, { coalesce: 'mg.pattern.' + merge.id }), { placeholder: '{1} ({2})' }),
          { hint: '{1} is the target column, {2} onwards the others in order.' }));
      }

      if (merge.type === 'range') {
        body.appendChild(Controls.field('Separator', Controls.text('mg.sep.' + merge.id,
          merge.sep || '–', (value) => Store.update((draft) => {
            draft.structure.merges[index].sep = value;
          }, { coalesce: 'mg.sep.' + merge.id }))));
      }

      return body;
    }, {
      key: 'merges',
      title: (merge) => {
        const target = byId[merge.target];
        return (target ? target.label : merge.target) + ' ← ' + merge.columns.length + ' column(s)';
      },
      subtitle: (merge) => merge.type,
      onRemove: (merge, index) => Store.update((draft) => { draft.structure.merges.splice(index, 1); })
    });

    return Controls.section('Merge columns', [
      Util.el('div.field-hint', {
        text: 'Combine several columns into one cell — an estimate with its standard error, ' +
          'a count with its percentage, a min–max range.'
      }),
      list,
      Controls.button('Add merge', () => {
        Store.update((draft) => {
          const available = columns.filter((c) => c.id !== draft.structure.rownameCol);
          if (available.length < 2) return false;
          draft.structure.merges.push({
            id: Util.uid('mg'),
            type: 'merge',
            target: available[0].id,
            columns: [available[1].id],
            pattern: '{1} ({2})',
            sep: '–'
          });
          return undefined;
        });
      }, { block: true })
    ], { key: 'st.merges', collapsed: true });
  }
};
