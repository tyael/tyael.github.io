/**
 * ui/panel-summaries.js
 *
 * The Summaries panel: gt's `summary_rows()` and `grand_summary_rows()`.
 *
 * A group summary appends its rows to the bottom of every row group; a grand
 * summary appends to the bottom of the table. One definition can carry several
 * functions, which produces one row each — a Mean row and an SD row under the
 * same block, the way results tables are usually laid out.
 */

const PanelSummaries = {

  id: 'summaries',
  label: 'Totals',

  render(spec) {
    const panel = Util.el('div.panel');

    if (!Spec.hasData(spec)) {
      panel.appendChild(Controls.note('Import data first.'));
      return panel;
    }

    const columns = App.workingColumns();
    const byId = {};
    for (const col of columns) byId[col.id] = col;
    const numeric = columns.filter((c) => byId[c.id] && byId[c.id].type === 'number');

    panel.appendChild(PanelSummaries.section(spec, 'groups', 'Group summaries', columns, byId, numeric));
    panel.appendChild(PanelSummaries.section(spec, 'grand', 'Grand summary', columns, byId, numeric));

    return panel;
  },

  section(spec, kind, title, columns, byId, numeric) {
    const items = spec.summaries[kind];
    const isGroup = kind === 'groups';

    const list = Controls.itemList(items, (summary, index) =>
      PanelSummaries.body(summary, index, kind, columns, byId), {
      key: 'summary.' + kind,
      title: (summary) => (summary.fns || []).map((id) => {
        const fn = Compute.SUMMARY_FNS.find((f) => f.id === id);
        return fn ? fn.label : id;
      }).join(', ') || 'no functions',
      subtitle: (summary) => (summary.columns || []).length + ' column(s)',
      onRemove: (summary, index) => Store.update((draft) => { draft.summaries[kind].splice(index, 1); }),
      onReorder: (from, to) => Store.update((draft) => {
        draft.summaries[kind] = Util.moveItem(draft.summaries[kind], from, to);
      })
    });

    const nodes = [];

    if (isGroup && !spec.structure.groupnameCol) {
      nodes.push(Util.el('div.field-hint', {
        text: 'No row-group column is set, so these would have nothing to summarise. ' +
          'Set one under Structure, or use the grand summary below.'
      }));
    }

    nodes.push(list);
    nodes.push(Controls.button('Add ' + (isGroup ? 'group summary' : 'grand summary'), () => {
      Store.update((draft) => {
        if (!numeric.length) return false;
        draft.summaries[kind].push({
          id: Util.uid('sum'),
          fns: ['sum'],
          columns: numeric.map((c) => c.id),
          labels: {},
          format: 'number',
          formatOpts: { decimals: 2, useSeparator: true }
        });
        return undefined;
      });
      if (!numeric.length) Util.toast('No numeric columns to summarise', 'error');
    }, { block: true, kind: 'primary' }));

    return Controls.section(title, nodes, { key: 'sum.' + kind });
  },

  body(summary, index, kind, columns, byId) {
    const body = Util.el('div');
    const update = (fn, coalesce) => Store.update((draft) => fn(draft.summaries[kind][index]),
      { coalesce: coalesce });

    /* ---- Functions ---- */

    const chosen = new Set(summary.fns || []);
    const chips = Compute.SUMMARY_FNS.map((fn) => Util.el('span.chip' + (chosen.has(fn.id) ? '.is-on' : ''), {
      text: fn.label,
      on: {
        click: () => update((s) => {
          const next = new Set(s.fns || []);
          if (next.has(fn.id)) next.delete(fn.id);
          else next.add(fn.id);
          s.fns = Compute.SUMMARY_FNS.filter((f) => next.has(f.id)).map((f) => f.id);
        })
      }
    }));

    body.appendChild(Controls.field(null, Util.el('div.chip-set', null, chips), { wide: true }));

    /* ---- Row labels ---- */

    for (const fnId of (summary.fns || [])) {
      const fn = Compute.SUMMARY_FNS.find((f) => f.id === fnId);
      body.appendChild(Controls.field('“' + (fn ? fn.label : fnId) + '” label',
        Controls.text('sum.label.' + summary.id + '.' + fnId,
          (summary.labels && summary.labels[fnId]) || '',
          (value) => update((s) => {
            if (!s.labels) s.labels = {};
            s.labels[fnId] = value;
          }, 'sum.label.' + summary.id + '.' + fnId),
          { placeholder: fn ? fn.label : fnId })));
    }

    /* ---- Columns ---- */

    body.appendChild(Util.el('div.mini-label', { text: 'Summarise these columns' }));
    body.appendChild(Controls.columnChips('sum.cols.' + summary.id,
      columns.filter((c) => byId[c.id] && byId[c.id].type === 'number'),
      summary.columns,
      (value) => update((s) => { s.columns = value; })));

    /* ---- Number format ---- */

    const format = summary.format || 'number';
    body.appendChild(Controls.field('Format', Controls.select('sum.fmt.' + summary.id,
      Formatters.types.filter((f) => f.numeric || f.type === 'passthrough')
        .map((f) => ({ value: f.type, label: f.label })),
      format, (value) => update((s) => {
        s.format = value;
        s.formatOpts = Formatters.defaults(value);
      }))));

    const def = Formatters.get(format);
    if (def) {
      const opts = Formatters.resolveOpts(format, summary.formatOpts);
      for (const param of def.params) {
        body.appendChild(Controls.field(param.label,
          Controls.forParam(param, opts[param.key], (value) => {
            update((s) => {
              if (!s.formatOpts) s.formatOpts = {};
              s.formatOpts[param.key] = value;
            }, 'sum.' + summary.id + '.' + param.key);
          }, 'sum.' + summary.id)));
      }
    }

    return body;
  }
};
