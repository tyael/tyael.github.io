/**
 * pipeline.js
 *
 * The structural pipeline: an ordered list of steps that turns the imported
 * file into the table the aesthetic layer decorates.
 *
 * Structural operations used to be scattered across three panels with their
 * order baked invisibly into `Compute.run` — a pivot always before a filter,
 * always before a sort, because that is the order the code happened to be
 * written in. Nothing on screen said there was an order, and nothing could
 * change it. Here the order *is* the list.
 *
 * **Each step declares its data transform and its R form together**, the way
 * `Filter.OPS` does for filter operators. That is the only thing keeping the
 * preview and the exported R from meaning different things, and this codebase
 * has paid for the alternative repeatedly.
 *
 * ## Two stages, and why the boundary is fixed
 *
 * `data` steps are dplyr/tidyr verbs and run before `gt()`; `table` steps are
 * gt verbs and run after it. gt has no way to interleave them — every data
 * verb must precede `gt()` — so a list allowing a spanner before a pivot would
 * be inert on screen and live in the export. Steps reorder freely within a
 * stage and never across, which makes the order on screen the order gt runs.
 *
 * ## Row identity
 *
 * Style rules, footnote anchors and cell corrections are all pinned to
 * `srcIndex`, so it has to survive the pipeline. Every step preserves it
 * except `pivot`, which builds a genuinely new set of rows and therefore
 * renumbers — the same reindexing that changing a pivot has always caused.
 * `filter` in particular removes items without renumbering the survivors.
 */

const Pipeline = {

  /** Stage ids, outermost first. The order of this list is the pipeline's. */
  STAGES: [
    { id: 'data', label: 'Shape the data',
      hint: 'Runs before gt(): dplyr and tidyr verbs over the imported file.' },
    { id: 'table', label: 'Shape the table',
      hint: 'Runs after gt(): what the rows and columns become on the page.' }
  ],

  /**
   * Every step type.
   *
   * `apply(state, step, ctx)` mutates nothing — it returns the next state.
   * `describe(step, ctx)` is the one-line subtitle in the Shape panel, and is
   * also what the history list and the inert notice quote, so it has to read
   * as a description of the step rather than of its type.
   */
  TYPES: [
    {
      id: 'pivot',
      stage: 'data',
      label: 'Pivot',
      hint: 'Spread one column’s values across new columns — long to wide.',
      create: () => ({ idCols: [], nameCols: [], valueCols: [], aggregate: 'first', nameSep: ' > ' }),
      /** The only step that renumbers: it builds a new set of rows. */
      apply(state, step, ctx) {
        const derived = Reshape.derive(
          { columns: state.columns, rows: state.items.map((item) => item.row) },
          { mode: 'pivot', idCols: step.idCols, nameCols: step.nameCols,
            valueCols: step.valueCols, aggregate: step.aggregate, nameSep: step.nameSep });

        if (derived.tooWide) {
          // Named separately from "nothing to spread": this pivot is configured
          // and would work, it is just asking for a table nothing can draw. The
          // note says the number, because the fix is to pick a different column
          // and the number is what tells you which one is wrong.
          return Pipeline.inert(state, ctx,
            'would make ' + derived.tooWide.toLocaleString() + ' columns, past the ' +
            Reshape.MAX_DERIVED_COLUMNS.toLocaleString() + ' a table can hold — ' +
            'the column it spreads has too many distinct values');
        }
        if (!derived.pivoted) {
          return Pipeline.inert(state, ctx,
            'names nothing to spread across columns, or nothing to take values from');
        }

        return Object.assign({}, state, {
          columns: derived.columns,
          items: derived.rows.map((row, i) => ({ row: row, srcIndex: i })),
          sourceRows: derived.rows.length,
          spanners: state.spanners.concat(derived.spanners),
          warnings: state.warnings.concat(derived.warnings)
        });
      },
      /**
       * `tidyr::pivot_wider()`, and the rename that makes its column names
       * ours.
       *
       * The exported data used to be the *pivoted result*, inlined, with the
       * tidyr written above it as a comment — because gt references our column
       * ids in every later call and plain `pivot_wider()` names them
       * differently. Two costs: the R did not contain the pivot as a step, and
       * above `MAX_INLINE_ROWS` the exporter emitted `readr::read_csv()`
       * naming the *derived* columns, so for a pivoted table over the
       * threshold the script asked for a wide file that never existed.
       *
       * `names_glue` gets within a `tolower` of our ids, and the rename closes
       * the gap by reproducing `Util.slug` — which is idempotent over ids that
       * are already slugs, so it can be applied to every column. `pivot_wider`
       * groups its output by value where we interleave by tuple; that does not
       * matter, because `cols_move_to_start()` restates the whole visible
       * order downstream.
       */
      r(step, ctx) {
        const names = (step.nameCols || []).filter((id) => ctx.byId[id]);
        const values = (step.valueCols || []).filter((id) => ctx.byId[id]);
        const ids = (step.idCols || []).filter((id) => ctx.byId[id]);
        if (!names.length || !values.length) return null;

        const args = [];
        if (ids.length) args.push('id_cols = ' + ExportRgt.columnVector(ids));
        args.push('names_from = ' + ExportRgt.columnVector(names));
        args.push('values_from = ' + ExportRgt.columnVector(values));

        // With one value column our ids are the tuple alone — no `{.value}`
        // suffix — which is what `Reshape.pivot` does with `multiValue`.
        const glue = names.map((id) => '{' + id + '}')
          .concat(values.length > 1 ? ['{.value}'] : []).join('_');
        args.push('names_glue = ' + ExportRgt.str(glue));

        const fn = Pipeline.VALUES_FN[step.aggregate || 'first'];
        if (fn) args.push('values_fn = ' + fn);

        return 'tidyr::pivot_wider(' + args.join(', ') + ') |>\n  ' + Pipeline.SLUG_RENAME;
      },
      describe(step, ctx) {
        if (!step.nameCols.length || !step.valueCols.length) return 'not yet configured';
        return Pipeline.names(step.nameCols, ctx) + ' → columns, values from ' +
          Pipeline.names(step.valueCols, ctx);
      }
    },

    {
      id: 'remove',
      stage: 'data',
      label: 'Remove columns',
      // The idiom of "pivot on everything else" does not do this: `Reshape.derive`
      // returns the source untouched when there is nothing to spread, so it
      // removes nothing and says nothing. And a pivot would collapse duplicate
      // id tuples, which is a different operation wearing the same clothes.
      hint: 'Drop columns from the data entirely. To keep a column’s values ' +
        'available to rules and expressions but off the page, hide it in Structure instead.',
      create: () => ({ columns: [] }),
      apply(state, step, ctx) {
        const drop = new Set((step.columns || []).filter((id) => Pipeline.hasColumn(state, id)));
        if (!drop.size) return Pipeline.inert(state, ctx, 'names no column that is still here');

        return Object.assign({}, state, {
          columns: state.columns.filter((col) => !drop.has(col.id)),
          items: state.items.map((item) => {
            const row = {};
            for (const id in item.row) if (!drop.has(id)) row[id] = item.row[id];
            return { row: row, srcIndex: item.srcIndex };
          })
        });
      },
      r(step, ctx) {
        const cols = (step.columns || []).filter((id) => ctx.byId[id]);
        if (!cols.length) return null;
        return 'dplyr::select(' + cols.map((id) => '-' + ExportRgt.symbol(id)).join(', ') + ')';
      },
      describe(step, ctx) {
        return step.columns && step.columns.length
          ? Pipeline.names(step.columns, ctx)
          : 'no columns chosen';
      }
    },

    {
      id: 'correct',
      stage: 'data',
      label: 'Correct values',
      hint: 'Per-cell fixes, each guarded by the value it was written against.',
      create: () => ({ edits: [] }),
      apply(state, step, ctx) {
        if (!step.edits || !step.edits.length) return Pipeline.inert(state, ctx, 'holds no corrections');

        // **An edit names a row by `srcIndex`, and `Corrections.apply` indexes
        // the array it is handed.** Those agreed for as long as corrections
        // always ran first; in a pipeline a filter may already have removed
        // rows, so the edits are re-keyed to the row's position *here* before
        // being applied, and the position is recorded because that is what
        // `dplyr::row_number()` will be when the R runs at this same point.
        const positionOf = new Map();
        state.items.forEach((item, i) => positionOf.set(item.srcIndex, i));

        // **Reordering is what breaks a correction, and each way needs saying.**
        // Dragged after a filter that removed its row, or after a pivot that
        // renumbered every row, an edit names a row this step cannot see. After
        // a `remove`, it names a column that is gone. Neither is repairable
        // here and neither is an error — drag the step back above and the edit
        // comes alive again — but going quiet would leave a table that shows
        // the typo and a panel that claims it was corrected.
        const here = [];
        let noRow = 0;
        let noColumn = 0;
        for (const edit of step.edits) {
          if (!Pipeline.hasColumn(state, edit.colId)) { noColumn += 1; continue; }
          const at = positionOf.get(edit.srcIndex);
          if (at === undefined) { noRow += 1; continue; }
          here.push(Object.assign({}, edit, { srcIndex: at, _srcIndex: edit.srcIndex }));
        }
        if (noColumn) ctx.note(noColumn + ' correction(s) name a column that is no longer here');
        if (noRow) ctx.note(noRow + ' correction(s) name a row this step cannot see');
        if (!here.length) return Pipeline.inert(state, ctx, 'has no correction it can still apply');

        const result = Corrections.apply(state.items.map((item) => item.row), here);
        const applied = result.applied.map((edit) => Object.assign({}, edit, {
          rRow: edit.srcIndex + 1,
          srcIndex: edit._srcIndex
        }));

        const next = Object.assign({}, state, {
          items: state.items.map((item, i) => ({ row: result.rows[i], srcIndex: item.srcIndex })),
          corrections: state.corrections.concat(applied)
        });
        if (result.stale.length) {
          ctx.note(result.stale.length + ' correction(s) no longer match the value they were ' +
            'written against');
          next.staleCorrections = state.staleCorrections.concat(
            result.stale.map((edit) => Object.assign({}, edit, { srcIndex: edit._srcIndex })));
        }
        return next;
      },
      r(step, ctx) {
        // Only what was actually applied, and at the row number it landed on
        // *here* — a stale correction changed nothing in the preview and must
        // change nothing in the export, and a filter earlier in the pipeline
        // moves every later row number.
        return ExportRgt.correctionCall(ctx.applied, ctx.byId);
      },
      describe(step) {
        const n = (step.edits || []).length;
        return n ? n + ' cell' + (n === 1 ? '' : 's') : 'no corrections yet';
      }
    },

    {
      id: 'filter',
      stage: 'data',
      label: 'Filter rows',
      hint: 'Keep only the rows that match.',
      create: () => ({ match: 'all', conditions: [] }),
      apply(state, step, ctx) {
        if (!Filter.active(step, ctx.columnsById(state)).length) {
          return Pipeline.inert(state, ctx, 'has no condition that can be applied yet');
        }
        const result = Filter.apply(state.items, step, ctx.columnsById(state));
        return Object.assign({}, state, {
          items: result.rows,
          filteredOut: state.filteredOut + result.removed
        });
      },
      r(step, ctx) {
        return ExportRgt.filterCall(step, ctx.byId, ctx.markupCols);
      },
      describe(step, ctx) {
        const active = Filter.active(step, ctx.byId);
        if (!active.length) return 'no conditions';
        // One condition can be said outright, and a subtitle is the only thing
        // telling one Filter rows step from another.
        if (active.length === 1) {
          return Pipeline.name(active[0].col, ctx) + ' ' + Filter.phrase(active[0]);
        }
        return active.length + ' conditions, match ' + (step.match === 'any' ? 'any' : 'all');
      }
    },

    {
      id: 'sort',
      stage: 'data',
      label: 'Sort rows',
      hint: 'Keys apply top to bottom, each breaking only the ties the ones above it left.',
      create: () => ({ keys: [] }),
      apply(state, step, ctx) {
        const keys = (step.keys || []).filter((key) => Pipeline.hasColumn(state, key.col));
        if (!keys.length) return Pipeline.inert(state, ctx, 'names no column that is still here');
        return Object.assign({}, state, {
          items: Compute.sortRows(state.items, keys, ctx.columnsById(state))
        });
      },
      r(step, ctx) {
        return ExportRgt.sortCall(step.keys, ctx.byId, ctx.markupCols);
      },
      describe(step, ctx) {
        const keys = step.keys || [];
        if (!keys.length) return 'no sort keys';
        return keys.map((key) => Pipeline.name(key.col, ctx) + (key.dir === 'desc' ? ' ↓' : ' ↑'))
          .join(', ');
      }
    },

    {
      id: 'stub',
      stage: 'table',
      label: 'Row labels',
      hint: 'gt’s rowname_col — the column that labels each row instead of being one.',
      create: () => ({ col: null }),
      apply(state, step, ctx) {
        if (!Pipeline.hasColumn(state, step.col)) {
          return Pipeline.inert(state, ctx, 'names no column that is still here');
        }
        return Object.assign({}, state, { stubCol: step.col });
      },
      describe(step, ctx) { return step.col ? Pipeline.name(step.col, ctx) : 'no column chosen'; }
    },

    {
      id: 'groups',
      stage: 'table',
      label: 'Row groups',
      hint: 'gt’s groupname_col — the column whose values break the body into sections.',
      create: () => ({ col: null, order: [] }),
      apply(state, step, ctx) {
        if (!Pipeline.hasColumn(state, step.col)) {
          return Pipeline.inert(state, ctx, 'names no column that is still here');
        }
        return Object.assign({}, state, {
          groupCol: step.col,
          groupOrder: (step.order || []).slice()
        });
      },
      describe(step, ctx) { return step.col ? Pipeline.name(step.col, ctx) : 'no column chosen'; }
    },

    {
      id: 'merge',
      stage: 'table',
      label: 'Merge columns',
      hint: 'Combine several columns into one cell — an estimate with its interval, say.',
      create: () => ({ mergeType: 'merge', target: null, columns: [], pattern: '{1} ({2})', sep: '–' }),
      apply(state, step, ctx) {
        if (!Pipeline.hasColumn(state, step.target)) {
          return Pipeline.inert(state, ctx, 'names no target column that is still here');
        }
        const others = (step.columns || [])
          .filter((id) => id !== step.target && Pipeline.hasColumn(state, id));
        if (!others.length) return Pipeline.inert(state, ctx, 'names no other column that is still here');
        // Handed on with `type` set from `mergeType`, because that is the key
        // `Compute.applyMerges` and `export-rgt.js` have always read — the
        // rename is only to free `type` for the step itself.
        return Object.assign({}, state, {
          merges: state.merges.concat([Object.assign({}, step, {
            columns: others, type: step.mergeType || 'merge'
          })])
        });
      },
      describe(step, ctx) {
        if (!step.target) return 'no target column';
        return Pipeline.name(step.target, ctx) + ' ← ' +
          ((step.columns || []).length ? Pipeline.names(step.columns, ctx) : 'nothing chosen');
      }
    },

    {
      id: 'summary',
      stage: 'table',
      label: 'Totals',
      hint: 'A row of totals — per group, or one over the whole table.',
      // `format: null` means "whatever the columns being totalled are
      // formatted as". A total that shows 11,654,700.00 under a column of
      // 4,182,000 is a total in a different unit from the thing it totals, and
      // two decimals was only ever a guess at what a number wants.
      create: () => ({ scope: 'grand', fns: ['sum'], columns: [], labels: {},
        format: null, formatOpts: null }),
      apply(state, step, ctx) {
        const columns = (step.columns || []).filter((id) => Pipeline.hasColumn(state, id));
        if (!columns.length) return Pipeline.inert(state, ctx, 'names no column that is still here');
        if (!(step.fns || []).length) return Pipeline.inert(state, ctx, 'computes nothing');

        // A group summary with nothing grouping the rows has nowhere to go.
        // The step above it decides that, which is exactly the kind of thing
        // the order is supposed to make visible.
        if (step.scope === 'groups' && !state.groupCol) {
          return Pipeline.inert(state, ctx, 'summarises groups, and nothing above it groups the rows');
        }
        if (columns.length < (step.columns || []).length) {
          ctx.note((step.columns.length - columns.length) + ' of its columns are no longer here');
        }

        const which = step.scope === 'groups' ? 'groups' : 'grand';
        const summaries = Object.assign({}, state.summaries);
        summaries[which] = summaries[which].concat([Object.assign({}, step, { columns: columns })]);
        return Object.assign({}, state, { summaries: summaries });
      },
      r(step, ctx) {
        const cols = (step.columns || []).filter((id) => ctx.byId[id]);
        if (!cols.length || !(step.fns || []).length) return null;
        return ExportRgt.summaryCall(step,
          step.scope === 'groups' ? 'summary_rows' : 'grand_summary_rows',
          ctx.byId, ctx.formatPlan);
      },
      describe(step, ctx) {
        const fns = (step.fns || []).length ? step.fns.join(', ') : 'nothing';
        const where = step.scope === 'groups' ? 'per group' : 'whole table';
        return fns + ' of ' +
          ((step.columns || []).length ? Pipeline.names(step.columns, ctx) : 'no columns') +
          ' · ' + where;
      }
    },

    {
      id: 'spanner',
      stage: 'table',
      label: 'Column group',
      hint: 'gt’s tab_spanner — a heading spanning several columns.',
      create: () => ({ label: 'Group', columns: [], level: 1 }),
      apply(state, step, ctx) {
        const columns = (step.columns || []).filter((id) => Pipeline.hasColumn(state, id));
        if (!columns.length) return Pipeline.inert(state, ctx, 'covers no column that is still here');
        if (columns.length < (step.columns || []).length) {
          ctx.note((step.columns.length - columns.length) + ' of its columns are no longer here');
        }
        return Object.assign({}, state, {
          spanners: state.spanners.concat([{
            id: step.id, label: step.label, columns: columns,
            level: Pipeline.spannerLevel(step.level)
          }])
        });
      },
      describe(step, ctx) {
        const n = (step.columns || []).length;
        return '“' + (step.label || '') + '” over ' + (n ? Pipeline.names(step.columns, ctx) : 'nothing') +
          ' · level ' + Pipeline.spannerLevel(step.level);
      }
    }
  ],

  /* ---------------------------------------------------------------- */

  /**
   * `Util.slug`, as R.
   *
   * trim, lowercase, every run of non-alphanumerics to `_`, then strip the
   * ends. Applied to every column after a pivot: our other ids are already
   * slugs and this is idempotent over them, so it needs no column list.
   */
  SLUG_RENAME: 'dplyr::rename_with(~ gsub("^_+|_+$", "", ' +
    'gsub("[^a-z0-9]+", "_", tolower(trimws(.x)))))',

  /**
   * `values_fn` for each way of combining collisions.
   *
   * `first`/`last` are gt-free base R. The numeric ones drop `NA` the way
   * `Reshape.aggregator` filters non-numbers out before reducing. `concat`
   * matches `Util.unique(...).join(', ')`.
   */
  VALUES_FN: {
    first: 'dplyr::first',
    last: 'dplyr::last',
    sum: '~ sum(as.numeric(.x), na.rm = TRUE)',
    mean: '~ mean(as.numeric(.x), na.rm = TRUE)',
    median: '~ stats::median(as.numeric(.x), na.rm = TRUE)',
    min: '~ min(as.numeric(.x), na.rm = TRUE)',
    max: '~ max(as.numeric(.x), na.rm = TRUE)',
    count: '~ sum(!is.na(.x))',
    concat: '~ paste(unique(.x[!is.na(.x)]), collapse = ", ")'
  },

  /** The definition for a step type, or null. */
  type(id) {
    return Pipeline.TYPES.find((t) => t.id === id) || null;
  },

  /** Every type belonging to one stage, in declaration order. */
  typesFor(stage) {
    return Pipeline.TYPES.filter((t) => t.stage === stage);
  },

  /** A new step of `type`, ready to push onto `spec.pipeline`. */
  create(typeId) {
    const def = Pipeline.type(typeId);
    if (!def) return null;
    return Object.assign({ id: Util.uid('step'), type: typeId, enabled: true }, def.create());
  },

  /* ---------- Authoring ---------- */

  /**
   * The first step of a type, or null.
   *
   * Six of the nine types are single-instance in practice — a table has one
   * pivot, one filter, one sort, one stub, one group column, one set of
   * corrections — while merges and spanners are lists. Nothing *enforces* the
   * distinction, because a second sort step after a filter is a coherent thing
   * to want; `find` simply answers the common question.
   */
  find(spec, type) {
    return (spec.pipeline || []).find((step) => step.type === type) || null;
  },

  /** `find`, but as an index into `spec.pipeline`. */
  indexOf(spec, type) {
    return (spec.pipeline || []).findIndex((step) => step.type === type);
  },

  /**
   * Create-or-update the step of a type, and return it.
   *
   * New steps are appended at the end of their own stage, so a pivot added to
   * a table that already has a sort lands before it — which is the order that
   * makes sense and the order the old fixed sequence used.
   */
  set(spec, type, params) {
    const found = Pipeline.find(spec, type);
    if (found) return Object.assign(found, params || {});
    return Pipeline.add(spec, type, params);
  },

  /** Append a step at the end of its stage. */
  add(spec, type, params) {
    const step = Pipeline.create(type);
    if (!step) return null;
    Object.assign(step, params || {});
    if (!Array.isArray(spec.pipeline)) spec.pipeline = [];

    const stage = Pipeline.type(type).stage;
    let at = spec.pipeline.length;
    if (stage === 'data') {
      // Before the first table step, since the stages do not interleave.
      const firstTable = spec.pipeline.findIndex((other) => {
        const def = Pipeline.type(other.type);
        return def && def.stage === 'table';
      });
      if (firstTable >= 0) at = firstTable;
    }

    // A correction lands as early as it can: immediately after the last pivot,
    // ahead of any filter or sort. Later would leave the table sorting and
    // filtering on a typo it no longer shows — which is where corrections have
    // always run, and the reason is worth keeping as the default. It is a step
    // like any other, so it can be dragged past them deliberately.
    if (type === 'correct') at = Math.min(at, Pipeline.afterLastPivot(spec.pipeline));
    spec.pipeline.splice(at, 0, step);
    return step;
  },

  /** Drop every step of a type. */
  remove(spec, type) {
    spec.pipeline = (spec.pipeline || []).filter((step) => step.type !== type);
  },

  /* ---------------------------------------------------------------- */

  /**
   * Record that a step could do nothing at all, and carry on.
   *
   * A step whose columns have gone is not an error — it is a step waiting for
   * data that fits it, which is the ordinary state of a half-built pipeline and
   * of one whose earlier steps have just been reordered. The Shape panel puts
   * the reason on the step, so the list explains itself rather than the table
   * quietly being wrong.
   */
  inert(state, ctx, why) {
    ctx.note(why, true);
    return state;
  },

  hasColumn(state, id) {
    return !!id && state.columns.some((col) => col.id === id);
  },

  /**
   * A column group's level: a whole number, at least 1.
   *
   * **It has to be an integer, and nothing was making it one.** The level
   * decides how many header rows there are — `compute.js` takes
   * `max(level) + 1` — and `export-latex.js` then indexes a matrix by
   * `totalRows - 1`. A level of `3.14159`, which the Level box accepts because
   * `step` is a display hint and not a constraint, makes that index `3.14159`:
   * inside the bounds check, and not an array index at all, so the LaTeX
   * export threw on `matrix[r]` being undefined.
   *
   * Three places worked the level out and none of them rounded, which is why
   * clamping at the one that writes it would not have been enough — a level
   * from an older project or a hand-edited file has to be read safely too.
   *
   * **And it needs a ceiling as much as a floor.** `1e308` is a perfectly
   * finite integer, and `compute.js` turns the highest level into that many
   * header rows: `export-latex.js` then allocates one array per row, which is
   * not a slow export but an unbounded one. A fuzz run hung a batch for eight
   * minutes on it and took the tab out of memory. The Level box already
   * advertised 1–5, but `min` and `max` on a number input are hints and not
   * constraints — the same way `step` is, which is what let a fractional level
   * through in the first place. The constant is shared with the control so the
   * two cannot disagree about what the box promises.
   */
  MAX_SPANNER_LEVEL: 5,

  spannerLevel(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return 1;
    return Math.min(Pipeline.MAX_SPANNER_LEVEL, Math.max(1, n));
  },

  /** A column's display name, for a step's subtitle. */
  name(id, ctx) {
    const byId = (ctx && ctx.byId) || {};
    return (byId[id] && (byId[id].label || byId[id].name)) || id;
  },

  names(ids, ctx) {
    const list = (ids || []).map((id) => Pipeline.name(id, ctx));
    return list.length <= 3 ? list.join(', ') : list.length + ' columns';
  },

  /* ---------------------------------------------------------------- */

  /**
   * Run the pipeline over a source, returning the table's structure.
   *
   * `inert` collects one entry per step that could do nothing, indexed the same
   * way `spec.pipeline` is, so the panel can put each reason on its own step.
   *
   * @param {Object} source  spec.source
   * @param {Array} steps    spec.pipeline
   * @returns {Object} {columns, items, stubCol, groupCol, groupOrder, spanners,
   *   merges, corrections, staleCorrections, filteredOut, warnings, inert}
   */
  run(source, steps, upTo) {
    let state = {
      columns: source.columns,
      items: source.rows.map((row, i) => ({ row: row, srcIndex: i })),
      stubCol: null,
      groupCol: null,
      groupOrder: [],
      spanners: [],
      merges: [],
      summaries: { groups: [], grand: [] },
      corrections: [],
      staleCorrections: [],
      filteredOut: 0,
      // How many rows the data stage started with — the count a filter is
      // measured against. A pivot resets it, because it builds a new set of
      // rows; a filter leaves it alone, which is the whole point of it.
      sourceRows: source.rows.length,
      warnings: [],
      inert: []       // per step: {inert, notes[]} — see the loop below
    };

    // Rebuilt after every step, because a step may have changed the columns.
    const ctx = {
      byId: {},
      columnsById(current) {
        const out = {};
        for (const col of current.columns) out[col.id] = col;
        return out;
      }
    };

    const perStep = [];
    const list = upTo === undefined ? (steps || []) : (steps || []).slice(0, upTo);

    for (const step of list) {
      const def = Pipeline.type(step.type);
      if (!def) { perStep.push({ inert: true, notes: ['is of a kind this version does not know'] }); continue; }
      if (!Spec.isEnabled(step)) { perStep.push({ inert: false, notes: [] }); continue; }

      // A fresh collector per step, so a note belongs to the step that made it
      // rather than to whatever ran last — the ambient-error trap
      // `StyleRules.compile` was fixed out of.
      const notes = [];
      let inert = false;
      ctx.note = (text, isInert) => { notes.push(text); if (isInert) inert = true; };
      ctx.byId = ctx.columnsById(state);

      state = def.apply(state, step, ctx);
      perStep.push({ inert: inert, notes: notes });
    }

    state.inert = perStep;
    return state;
  },

  /**
   * Where the exported R stops inlining data and starts emitting verbs: the
   * start, always.
   *
   * The `data` block is the file as imported and every step is emitted as code.
   * It used to inline up to and including the last pivot, because a pivot's
   * column ids could not be reproduced in R — see the pivot's `r()` for how
   * that was closed. Kept as a function because it is still the one place that
   * decides, and a future step might need to inline again.
   */
  inlineSplit() {
    return 0;
  },

  /**
   * The index just past the last enabled pivot — where a new correction lands.
   *
   * A correction is written against the value a cell shows, and after a pivot
   * that is a different cell from before it, so it belongs below. Ahead of any
   * filter or sort, though: later would leave the table sorting on a typo it no
   * longer shows.
   */
  afterLastPivot(steps) {
    let at = 0;
    (steps || []).forEach((step, index) => {
      if (step.type === 'pivot' && Spec.isEnabled(step)) at = index + 1;
    });
    return at;
  },

  /**
   * The steps of one stage, with their index in `spec.pipeline`.
   *
   * The panel renders per stage but every mutation addresses the flat list, so
   * the index has to travel with the step. Reordering inside a stage is a swap
   * of two flat indices, which is why the stage split costs the drag machinery
   * nothing.
   */
  ofStage(steps, stage) {
    const out = [];
    (steps || []).forEach((step, index) => {
      const def = Pipeline.type(step.type);
      if (def && def.stage === stage) out.push({ step: step, index: index });
    });
    return out;
  }
};
