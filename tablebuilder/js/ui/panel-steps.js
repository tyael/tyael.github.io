/**
 * ui/panel-steps.js
 *
 * The Shape panel: the structural pipeline, as a list you can reorder.
 *
 * This replaced Reshape, Sort & filter, and the structural half of Structure.
 * Those three wrote the same spec with an order baked invisibly into
 * `Compute.run`; here the order is the list, and dragging a step changes what
 * the table is.
 *
 * **Two stages, and no dragging between them.** `pipeline.js` explains why:
 * gt must emit every data verb before `gt()`, so a list that let a column group
 * sit above a pivot would be inert on screen and live in the export. Each stage
 * is its own `Controls.itemList`, which is also what makes the boundary
 * impossible to cross by accident — there is no drop target on the other side.
 *
 * The file, the const and the panel id stay `steps`, because an id is what
 * the rail and `App.goToPanel` are written against.
 *
 * Every step editor here came from the panel that used to own it, so the
 * controls, their `data-ctl` keys and their coalesce keys are unchanged; what
 * moved is where the value lands.
 */

const PanelSteps = {

  id: 'steps',
  label: 'Shape',
  hint: 'Everything that decides what the table is, in the order it happens',

  render(spec) {
    const panel = Util.el('div.panel');

    if (!Spec.hasData(spec)) {
      panel.appendChild(Controls.note('Import data first.'));
      return panel;
    }

    panel.appendChild(Controls.intro(
      'Each step takes the table the one above it produced. Drag to reorder. ' +
      'Everything here changes what the table *is*; how it looks is Columns, ' +
      'Style rules and Table defaults.'
    ));

    for (const stage of Pipeline.STAGES) {
      panel.appendChild(PanelSteps.stageSection(spec, stage));
    }

    return panel;
  },

  /* ---------------------------------------------------------------- */

  /**
   * "This file looks long — want to pivot it?"
   *
   * The Reshape panel offered this and it went with the panel. It is the one
   * thing in the structural surface aimed at somebody who has not worked out
   * what they want yet: a long file drawn as-is is a wall of repeated keys, and
   * nothing else on screen says the app can do anything about that.
   */
  suggestion(spec, stage) {
    if (stage.id !== 'data') return null;
    if (Pipeline.find(spec, 'pivot')) return null;

    const guess = Reshape.suggest(spec.source);
    if (!guess) return null;

    const named = (spec.source.columns.find((c) => c.id === guess.nameCols[0]) || {}).name;
    return Util.el('div.suggestion', null, [
      Util.el('div.field-hint', {
        text: 'This file looks long: “' + named + '” repeats across rows, so its values ' +
          'could become column groups.'
      }),
      Controls.button('Add a pivot for it', () => {
        Store.update((draft) => { Pipeline.add(draft, 'pivot', guess); }, { label: 'Add step' });
      }, { kind: 'primary', block: true })
    ]);
  },

  /**
   * The columns a step can name: the ones that exist where it sits.
   *
   * **Not `App.workingColumns()`**, which is the pipeline's *output*. A pivot's
   * pickers have to offer the long file's columns, not the wide ones it is
   * about to produce — and a step below a Remove must not offer what that
   * Remove took away. Running the pipeline up to the step is the only answer
   * that stays true as the list is reordered.
   */
  columnsAt(spec, index) {
    const state = Pipeline.run(Spec.workingSource(spec), spec.pipeline, index);
    // Added to rather than rebuilt, for the reason in `App.workingColumns`.
    const columns = state.columns.map((col) =>
      Object.assign({}, col, { label: Spec.columnTitle(spec, col) }));
    const byId = {};
    for (const col of columns) byId[col.id] = col;
    return { columns: columns, byId: byId };
  },

  stageSection(spec, stage) {
    const entries = Pipeline.ofStage(spec.pipeline, stage.id);
    const notes = (App.model && App.model.pipelineNotes) || [];

    // For the titles and subtitles only — each step's editor takes the columns
    // as of its own position, below.
    const outer = PanelSteps.columnsAt(spec, (spec.pipeline || []).length);

    const list = Controls.itemList(entries, (entry) =>
      PanelSteps.body(spec, entry.step, entry.index,
        PanelSteps.columnsAt(spec, entry.index)), {
      key: 'pipeline.' + stage.id,
      collapsible: true,
      title: (entry) => {
        const def = Pipeline.type(entry.step.type);
        return (entry.index + 1) + '. ' + (def ? def.label : entry.step.type);
      },
      subtitle: (entry) => {
        const def = Pipeline.type(entry.step.type);
        return def ? def.describe(entry.step, PanelSteps.columnsAt(spec, entry.index)) : '';
      },
      // What this step could not do, from the render that just happened. A
      // step is not broken for naming a column an earlier step removed — drag
      // it back above and it comes alive — so this is a remark on the step,
      // not an error on the table.
      badge: (entry) => {
        const note = notes[entry.index];
        if (!note || !note.notes.length) return null;
        return {
          text: note.inert ? 'does nothing' : 'partly applied',
          title: note.notes.join('. ') + '.'
        };
      },
      enabled: (entry) => Spec.isEnabled(entry.step),
      onToggle: (entry, i, on) => Store.update((draft) => {
        draft.pipeline[entry.index].enabled = on;
      }, { label: on ? 'Enable step' : 'Disable step' }),
      onRemove: (entry) => Store.update((draft) => {
        draft.pipeline.splice(entry.index, 1);
      }, { label: 'Remove step' }),
      // `from` and `to` are positions within the stage; the spec's list is
      // flat, so both are mapped back through the entries before the move.
      onReorder: (from, to) => Store.update((draft) => {
        const flatFrom = entries[from] && entries[from].index;
        const flatTo = entries[to] && entries[to].index;
        if (flatFrom === undefined || flatTo === undefined) return;
        draft.pipeline = Util.moveItem(draft.pipeline, flatFrom, flatTo);
      }, { label: 'Reorder steps' }),
      emptyText: 'no steps yet'
    });

    if (!outer.columns.length) return Controls.note('No columns left.');

    const add = Pipeline.typesFor(stage.id).map((def) =>
      Controls.button(def.label, () => {
        Store.update((draft) => { Pipeline.add(draft, def.id); }, { label: 'Add step' });
      }, { title: def.hint })
    );

    return Controls.section(stage.label + ' (' + entries.length + ')', [
      Util.el('div.field-hint', { text: stage.hint }),
      list,
      // Labelled, because the buttons carry the step's own name — `Pivot`
      // reads as a command to pivot rather than as "add a pivot step", and
      // prefixing every one with "Add" would only make them wider.
      Util.el('div.mini-label', { text: 'Add a step' }),
      Controls.actions(add, { grid: true }),
      PanelSteps.suggestion(spec, stage)
    ].filter(Boolean), {
      key: 'steps.' + stage.id,
      action: Controls.collapseAll('pipeline.' + stage.id, entries)
    });
  },

  /* ---------------------------------------------------------------- */

  /**
   * The shape the table has after a step has run: rows × columns.
   *
   * The Reshape panel had this as a Result section and the filter had its own
   * row count, and both went with those panels. A step whose effect you cannot
   * see is a step you will forget you left on — which was the stated reason for
   * the filter's count, and it applies to every step now that they can be
   * reordered under each other.
   */
  shapeAfter(spec, index) {
    const before = Pipeline.run(Spec.workingSource(spec), spec.pipeline, index);
    const after = Pipeline.run(Spec.workingSource(spec), spec.pipeline, index + 1);
    const bits = [after.items.length.toLocaleString() + ' row' +
      (after.items.length === 1 ? '' : 's') + ' × ' +
      after.columns.length + ' column' + (after.columns.length === 1 ? '' : 's')];

    const lostRows = before.items.length - after.items.length;
    if (lostRows > 0) bits.push(lostRows.toLocaleString() + ' row(s) dropped here');
    const lostCols = before.columns.length - after.columns.length;
    if (lostCols > 0) bits.push(lostCols + ' column(s) dropped here');
    return bits.join(' · ');
  },

  /** The editor for one step, dispatched on its type. */
  body(spec, step, index, ctx) {
    const wrap = Util.el('div');
    const update = (fn, coalesce) =>
      Store.update((draft) => fn(draft.pipeline[index]), { coalesce: coalesce, label: 'Edit step' });

    const def = Pipeline.type(step.type);
    if (def && def.hint) wrap.appendChild(Util.el('div.field-hint', { text: def.hint }));

    const build = PanelSteps.EDITORS[step.type];
    if (build) build(wrap, step, index, ctx, update, spec);

    if (Spec.isEnabled(step)) {
      wrap.appendChild(Controls.field('After this',
        Util.el('span.mono.dim', { text: PanelSteps.shapeAfter(spec, index) })));
    }

    return wrap;
  },

  EDITORS: {

    pivot(wrap, step, index, ctx, update) {
      const chips = (key, label, value, hint) => {
        wrap.appendChild(Util.el('div.mini-label', { text: label }));
        wrap.appendChild(Controls.field(null, Controls.columnChips(
          'st.' + key + '.' + step.id, ctx.columns, value,
          (next) => update((s) => { s[key] = next; }), { ordered: true }), { wide: true }));
        if (hint) wrap.appendChild(Util.el('div.field-hint', { text: hint }));
      };

      chips('idCols', 'Rows are identified by', step.idCols,
        'One output row per distinct combination of these.');
      chips('nameCols', 'Spread across columns', step.nameCols,
        'Values here become column groups. The numbers are the nesting: 1 is the ' +
        'outermost, the last sits on the column labels.');
      chips('valueCols', 'Values come from', step.valueCols,
        'With two or more, each group gets one column per value.');

      wrap.appendChild(Controls.field('Collisions', Controls.select('st.agg.' + step.id,
        Reshape.AGGREGATES, step.aggregate || 'first',
        (value) => update((s) => { s.aggregate = value; }))));
      wrap.appendChild(Controls.field('Name separator', Controls.text('st.sep.' + step.id,
        step.nameSep, (value) => update((s) => { s.nameSep = value; }, 'st.sep.' + step.id))));
    },

    remove(wrap, step, index, ctx, update) {
      wrap.appendChild(Util.el('div.mini-label', { text: 'Columns (blank = none)' }));
      wrap.appendChild(Controls.field(null, Controls.columnChips('st.rm.' + step.id,
        ctx.columns, step.columns,
        (value) => update((s) => { s.columns = value; })), { wide: true }));
      wrap.appendChild(Util.el('div.field-hint', {
        text: 'Gone from the data for every step below this one, and from every rule and ' +
          'expression. To keep the values but take the column off the page, hide it in Structure.'
      }));
    },

    correct(wrap, step, index, ctx, update, spec) {
      const edits = step.edits || [];
      if (!edits.length) {
        wrap.appendChild(Controls.note('No corrections yet. Click a cell and edit its Value.'));
        return;
      }
      wrap.appendChild(Controls.itemList(edits, () => null, {
        key: 'st.edits.' + step.id,
        title: (edit) => Spec.columnTitle(spec, ctx.byId[edit.colId] || { id: edit.colId }) +
          ', row ' + (edit.srcIndex + 1),
        subtitle: (edit) => JSON.stringify(edit.from) + ' → ' + JSON.stringify(edit.to),
        onRemove: (edit) => Store.update((draft) => { Corrections.remove(draft, edit.id); },
          { label: 'Remove correction' })
      }));
    },

    filter(wrap, step, index, ctx, update) {
      wrap.appendChild(Controls.field('Match', Controls.select('flt.match',
        [{ value: 'all', label: 'All conditions' }, { value: 'any', label: 'Any condition' }],
        step.match || 'all', (value) => update((s) => { s.match = value; }))));

      wrap.appendChild(Controls.itemList(step.conditions || [], (condition, i) => {
        const body = Util.el('div');
        const op = Filter.get(condition.op);
        body.appendChild(Controls.field('Column', Controls.columnSelect(
          'flt.col.' + condition.id, ctx.columns, condition.col,
          (value) => update((s) => { s.conditions[i].col = value; }))));
        body.appendChild(Controls.field('Is', Controls.select('flt.op.' + condition.id,
          Filter.OPS.map((o) => ({ value: o.id, label: o.label })), condition.op,
          (value) => update((s) => { s.conditions[i].op = value; }))));
        if (op && op.arity >= 1) {
          body.appendChild(Controls.field('Value', Controls.text('flt.v.' + condition.id,
            condition.value, (value) => update((s) => { s.conditions[i].value = value; },
              'flt.v.' + condition.id))));
        }
        if (op && op.arity >= 2) {
          body.appendChild(Controls.field('And', Controls.text('flt.v2.' + condition.id,
            condition.value2, (value) => update((s) => { s.conditions[i].value2 = value; },
              'flt.v2.' + condition.id))));
        }
        return body;
      }, {
        key: 'st.cond.' + step.id,
        collapsible: true,
        title: (condition) => Pipeline.name(condition.col, ctx),
        subtitle: (condition) => Filter.phrase(condition),
        onRemove: (condition, i) => update((s) => { s.conditions.splice(i, 1); }),
        onReorder: (from, to) => update((s) => { s.conditions = Util.moveItem(s.conditions, from, to); }),
        emptyText: 'no conditions — the step does nothing'
      }));

      wrap.appendChild(Controls.actions([
        Controls.button('Add condition', () => update((s) => {
          s.conditions.push(Filter.newCondition(ctx.columns));
        }), { kind: 'primary' })
      ]));
    },

    sort(wrap, step, index, ctx, update) {
      wrap.appendChild(Util.el('div.field-hint', {
        text: 'Keys apply top to bottom, each breaking only the ties the ones above it left.'
      }));
      wrap.appendChild(Controls.itemList(step.keys || [], (key, i) => {
        const body = Util.el('div');
        body.appendChild(Controls.field('Column', Controls.columnSelect('sort.col.' + i,
          ctx.columns, key.col, (value) => update((s) => {
            if (!value) s.keys.splice(i, 1);
            else s.keys[i].col = value;
          }))));
        body.appendChild(Controls.field('Direction', Controls.select('sort.dir.' + i,
          [{ value: 'asc', label: 'Ascending' }, { value: 'desc', label: 'Descending' }],
          key.dir, (value) => update((s) => { s.keys[i].dir = value; }))));
        return body;
      }, {
        key: 'st.keys.' + step.id,
        title: (key) => Pipeline.name(key.col, ctx),
        subtitle: (key) => (key.dir === 'desc' ? 'descending' : 'ascending'),
        onRemove: (key, i) => update((s) => { s.keys.splice(i, 1); }),
        onReorder: (from, to) => update((s) => { s.keys = Util.moveItem(s.keys, from, to); }),
        emptyText: 'no sort keys — the step does nothing'
      }));

      wrap.appendChild(Controls.actions([
        Controls.button('Add sort key', () => update((s) => {
          const used = new Set((s.keys || []).map((k) => k.col));
          const next = ctx.columns.find((col) => !used.has(col.id));
          if (next) s.keys.push({ col: next.id, dir: 'asc' });
        }), { kind: 'primary' })
      ]));
    },

    stub(wrap, step, index, ctx, update) {
      wrap.appendChild(Controls.field('Column', Controls.columnSelect('st.stub.' + step.id,
        ctx.columns, step.col, (value) => update((s) => { s.col = value; }))));
    },

    groups(wrap, step, index, ctx, update, spec) {
      wrap.appendChild(Controls.field('Column', Controls.columnSelect('st.grp.' + step.id,
        ctx.columns, step.col, (value) => update((s) => { s.col = value; s.order = []; }))));

      // These two are `spec.options`, not step params — gt has them as
      // `tab_options()` arguments and they are flagged structural there, so a
      // theme cannot reset them. They lived in the Structure panel's row-groups
      // section, and were lost with it: a table could be grouped with no way
      // left to show the groups as a column.
      const option = (key) => (value) => Store.update((draft) => { draft.options[key] = value; },
        { coalesce: 'opt.' + key });

      wrap.appendChild(Controls.field('Show as a column',
        Controls.checkbox('st.groupAsCol', !!spec.options['row_group.as_column'],
          option('row_group.as_column')),
        { hint: 'Off draws each group as a label row spanning the table; on gives it a ' +
          'column of its own down the left.' }));

      wrap.appendChild(Controls.field('Label for blanks',
        Controls.text('st.groupDefault', spec.options['row_group.default_label'],
          option('row_group.default_label')),
        { hint: 'What rows with no value in this column are grouped under.' }));

      const labels = App.groupLabels();
      if (labels.length > 1) {
        wrap.appendChild(Util.el('div.mini-label', { text: 'Group order' }));
        wrap.appendChild(Controls.itemList(labels, () => null, {
          key: 'st.gorder.' + step.id,
          title: (label) => label || '(blank)',
          onReorder: (from, to) => update((s) => {
            s.order = Util.moveItem(labels.slice(), from, to);
          })
        }));
        wrap.appendChild(Controls.actions([
          Controls.button('Reset order', () => update((s) => { s.order = []; }), { kind: 'ghost' })
        ]));
      }
    },

    merge(wrap, step, index, ctx, update) {
      // `mergeType`, not `type` — a step's own `type` says which kind of step
      // it is, and a merge's kind used to be called `type` too. One of them had
      // to move, and the step's is the one every other type shares.
      wrap.appendChild(Controls.field('Kind', Controls.select('st.mt.' + step.id, [
        { value: 'merge', label: 'Pattern' },
        { value: 'uncert', label: 'Value ± uncertainty' },
        { value: 'range', label: 'Range' },
        { value: 'n_pct', label: 'N (percent)' }
      ], step.mergeType || 'merge', (value) => update((s) => { s.mergeType = value; }))));

      wrap.appendChild(Controls.field('Into', Controls.columnSelect('st.mtar.' + step.id,
        ctx.columns, step.target, (value) => update((s) => { s.target = value; })),
      { hint: 'The column the merged text lands in. The others stop being drawn.' }));

      wrap.appendChild(Util.el('div.mini-label', { text: 'From (in order)' }));
      wrap.appendChild(Controls.field(null, Controls.columnChips('st.mcols.' + step.id,
        ctx.columns, step.columns, (value) => update((s) => { s.columns = value; }),
        { ordered: true }), { wide: true }));

      if ((step.mergeType || 'merge') === 'merge') {
        wrap.appendChild(Controls.field('Pattern', Controls.text('st.mpat.' + step.id,
          step.pattern, (value) => update((s) => { s.pattern = value; }, 'st.mpat.' + step.id)),
        { hint: '{1} is the target, {2} the first of the others, and so on.' }));
      }
      if (step.mergeType === 'range') {
        wrap.appendChild(Controls.field('Separator', Controls.text('st.msep.' + step.id,
          step.sep, (value) => update((s) => { s.sep = value; }, 'st.msep.' + step.id))));
      }
    },

    summary(wrap, step, index, ctx, update) {
      // Lifted from the Totals panel, which is where it was until totals
      // became a step. The control keys are unchanged so a saved collapse or a
      // caret mid-edit still finds its field.
      wrap.appendChild(Controls.field('Over', Controls.select('sum.scope.' + step.id, [
        { value: 'grand', label: 'The whole table' },
        { value: 'groups', label: 'Each row group' }
      ], step.scope || 'grand', (value) => update((s) => { s.scope = value; })),
      { hint: 'Per group needs a Row groups step above this one.' }));

      const chosen = new Set(step.fns || []);
      const chips = Compute.SUMMARY_FNS.map((fn) =>
        Util.el('span.chip' + (chosen.has(fn.id) ? '.is-on' : ''), {
          text: fn.label,
          on: {
            click: () => update((s) => {
              const next = new Set(s.fns || []);
              if (next.has(fn.id)) next.delete(fn.id);
              else next.add(fn.id);
              // Back into the canonical order, so two summaries with the same
              // functions read the same way whatever order they were picked.
              s.fns = Compute.SUMMARY_FNS.filter((f) => next.has(f.id)).map((f) => f.id);
            })
          }
        }));
      wrap.appendChild(Controls.field(null, Util.el('div.chip-set', null, chips), { wide: true }));

      for (const fnId of (step.fns || [])) {
        const fn = Compute.SUMMARY_FNS.find((f) => f.id === fnId);
        wrap.appendChild(Controls.field('“' + (fn ? fn.label : fnId) + '” label',
          Controls.text('sum.label.' + step.id + '.' + fnId,
            (step.labels && step.labels[fnId]) || '',
            (value) => update((s) => {
              if (!s.labels) s.labels = {};
              s.labels[fnId] = value;
            }, 'sum.label.' + step.id + '.' + fnId),
            { placeholder: fn ? fn.label : fnId })));
      }

      wrap.appendChild(Util.el('div.mini-label', { text: 'Summarise these columns' }));
      wrap.appendChild(Controls.field(null, Controls.columnChips('sum.cols.' + step.id,
        ctx.columns.filter((col) => col.type === 'number'), step.columns,
        (value) => update((s) => { s.columns = value; })), { wide: true }));

      const format = step.format || 'number';
      wrap.appendChild(Controls.field('Format', Controls.select('sum.fmt.' + step.id,
        Formatters.types.filter((f) => f.numeric || f.type === 'passthrough')
          .map((f) => ({ value: f.type, label: f.label })),
        format, (value) => update((s) => {
          s.format = value;
          s.formatOpts = Formatters.defaults(value);
        }))));

      const def = Formatters.get(format);
      if (def) {
        const opts = Formatters.resolveOpts(format, step.formatOpts);
        for (const param of def.params) {
          wrap.appendChild(Controls.field(param.label,
            Controls.forParam(param, opts[param.key], (value) => {
              update((s) => {
                if (!s.formatOpts) s.formatOpts = {};
                s.formatOpts[param.key] = value;
              }, 'sum.' + step.id + '.' + param.key);
            })));
        }
      }
    },

    spanner(wrap, step, index, ctx, update) {
      wrap.appendChild(Controls.field('Label', Controls.text('st.splabel.' + step.id,
        step.label, (value) => update((s) => { s.label = value; }, 'st.splabel.' + step.id))));
      wrap.appendChild(Controls.field('Level', Controls.number('st.splevel.' + step.id,
        Pipeline.spannerLevel(step.level),
        (value) => update((s) => { s.level = Pipeline.spannerLevel(value); }),
        { min: 1, max: Pipeline.MAX_SPANNER_LEVEL, step: 1 }),
      { hint: 'Level 1 sits directly on the column labels; higher levels stack above it.' }));
      wrap.appendChild(Util.el('div.mini-label', { text: 'Columns (blank = none)' }));
      wrap.appendChild(Controls.field(null, Controls.columnChips('st.spcols.' + step.id,
        ctx.columns, step.columns,
        (value) => update((s) => { s.columns = value; })), { wide: true }));
    }
  }
};
