/**
 * ui/panel-sort.js
 *
 * Sort & filter: which data rows appear, and in what order.
 *
 * This was a collapsed section inside Structure, which is about *which* rows
 * and columns there are and where they sit. What order they come out in is a
 * different question, and it was the fifth of five sections in a panel that
 * already had plenty to say.
 *
 * `structure.sort` still lives under `spec.structure` — the spec shape is not
 * a copy of the rail's layout, and moving a key would break every saved
 * `.tablespec.json` for no gain.
 */

const PanelSort = {

  id: 'sort',
  label: 'Sort & filter',
  hint: 'Which rows appear, and the order they come out in',

  render(spec) {
    const panel = Util.el('div.panel');

    if (!Spec.hasData(spec)) {
      panel.appendChild(Controls.note('Import data first.'));
      return panel;
    }

    const columns = App.workingColumns();
    // Filter above sort: it decides which rows there are, and sorting is the
    // order of whatever survives.
    panel.appendChild(PanelSort.filterSection(spec, columns));
    panel.appendChild(PanelSort.keysSection(spec, columns));
    return panel;
  },

  /* ================================================================
     Filter
     ================================================================ */

  filterSection(spec, columns) {
    const filter = spec.structure.filter || Filter.empty();
    const byId = {};
    for (const col of columns) byId[col.id] = col;

    const update = (fn, coalesce) => Store.update((draft) => {
      if (!draft.structure.filter) draft.structure.filter = Filter.empty();
      return fn(draft.structure.filter) === false ? false : undefined;
    }, { coalesce: coalesce, label: 'Filter rows' });

    const list = Controls.itemList(filter.conditions, (condition, index) => {
      const body = Util.el('div');
      const op = Filter.get(condition.op);
      const column = byId[condition.col];
      const numeric = !!(column && column.type === 'number');

      body.appendChild(Controls.field('Column', Controls.columnSelect(
        'flt.col.' + condition.id, columns, condition.col,
        (value) => update((f) => { f.conditions[index].col = value; }))));

      body.appendChild(Controls.field('Condition', Controls.select(
        'flt.op.' + condition.id,
        Filter.OPS.map((o) => ({ value: o.id, label: o.label })), condition.op,
        (value) => update((f) => { f.conditions[index].op = value; }))));

      // `is empty` needs no operand, `is between` needs two. Rendering boxes
      // that do nothing is how a control teaches the wrong thing.
      if (op.arity >= 1) {
        body.appendChild(Controls.field(op.arity === 2 ? 'From' : 'Value',
          Controls.text('flt.v.' + condition.id, condition.value,
            (value) => update((f) => { f.conditions[index].value = value; },
              'flt.v.' + condition.id),
            { placeholder: numeric ? 'a number' : 'text' })));
      }
      if (op.arity >= 2) {
        body.appendChild(Controls.field('To', Controls.text('flt.v2.' + condition.id,
          condition.value2, (value) => update((f) => { f.conditions[index].value2 = value; },
            'flt.v2.' + condition.id), { placeholder: numeric ? 'a number' : 'text' })));
      }

      if (!Filter.usable(condition, byId)) {
        body.appendChild(Util.el('div.field-hint', {
          text: 'Not applied yet — this condition still needs a column and a value.'
        }));
      }

      return body;
    }, {
      key: 'filter',
      collapsible: true,
      title: (condition) => Filter.describe(condition, byId),
      subtitle: (condition) => (Filter.usable(condition, byId) ? '' : 'incomplete'),
      onRemove: (condition, index) => update((f) => { f.conditions.splice(index, 1); }),
      onReorder: (from, to) => update((f) => { f.conditions = Util.moveItem(f.conditions, from, to); }),
      emptyText: 'no filter — every row is shown'
    });

    const active = Filter.active(filter, byId).length;
    const nodes = [];

    if (filter.conditions.length > 1) {
      nodes.push(Controls.field('Match', Controls.select('flt.match',
        [{ value: 'all', label: 'All of these' }, { value: 'any', label: 'Any of these' }],
        filter.match === 'any' ? 'any' : 'all',
        (value) => update((f) => { f.match = value; }))));
    }

    nodes.push(list);

    nodes.push(Controls.button('Add condition', () => update((f) => {
      f.conditions.push(Filter.newCondition(columns.length ? columns[0].id : null));
    }), { block: true }));

    // What the filter is doing right now, in rows. A filter you cannot see the
    // effect of is a filter you will forget you left on.
    const model = App.model;
    if (model && model.ok && active) {
      nodes.push(Util.el('div.field-hint', {
        text: 'Showing ' + model.totalRows.toLocaleString() + ' of ' +
          (model.sourceRows || model.totalRows).toLocaleString() + ' rows. ' +
          'Totals, colour scales and exports all follow the filter.'
      }));
    } else {
      nodes.push(Util.el('div.field-hint', {
        text: 'Rows that fail the filter are left out of the table, and out of any ' +
          'totals and exports with it.'
      }));
    }

    return Controls.section('Filter (' + active + ')', nodes, {
      key: 'sort.filter',
      action: Controls.collapseAll('filter', filter.conditions)
    });
  },

  keysSection(spec, columns) {
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

    return Controls.section('Sort keys (' + sort.length + ')', [
      Util.el('div.field-hint', {
        text: 'Keys apply top to bottom: the first orders the rows, and each one after it ' +
          'only breaks the ties the ones above left. Drag to reorder them.'
      }),
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
    ], { key: 'sort.keys' });
  }
};
