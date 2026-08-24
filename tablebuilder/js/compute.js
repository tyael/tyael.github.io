/**
 * compute.js
 *
 * The one pure step between the spec and every renderer.
 *
 * `Compute.run(spec)` turns the TableSpec plus its source data into a
 * ResolvedModel: concrete grid columns, header levels with their spans and
 * rowspans, body rows with formatted text and resolved styles, summary rows,
 * assigned footnote marks. No DOM, no side effects.
 *
 * Everything downstream — the HTML preview, the HTML export, the SVG measurer,
 * the LaTeX writer, the R code writer — reads this model and nothing else. That
 * is what keeps the exports honest: they cannot drift from the preview because
 * they are not looking at the preview, they are looking at what produced it.
 */

const Compute = {

  /** Rows past this are dropped from the render with a notice. */
  MAX_PREVIEW_ROWS: 2000,

  /** Footnote mark sets, matching gt's `opt_footnote_marks()`. */
  MARK_SETS: {
    numbers: null,   // generated
    letters: 'abcdefghijklmnopqrstuvwxyz'.split(''),
    LETTERS: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
    standard: ['*', '†', '‡', '§'],
    extended: ['*', '†', '‡', '§', '‖', '¶']
  },

  /** Aggregations available to summary rows. */
  SUMMARY_FNS: [
    { id: 'sum', label: 'Sum', fn: (n) => n.reduce((a, b) => a + b, 0) },
    { id: 'mean', label: 'Mean', fn: (n) => n.reduce((a, b) => a + b, 0) / n.length },
    { id: 'median', label: 'Median', fn: (n) => {
      const s = n.slice().sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    } },
    { id: 'min', label: 'Min', fn: (n) => Math.min.apply(null, n) },
    { id: 'max', label: 'Max', fn: (n) => Math.max.apply(null, n) },
    { id: 'sd', label: 'SD', fn: (n) => {
      if (n.length < 2) return 0;
      const mean = n.reduce((a, b) => a + b, 0) / n.length;
      return Math.sqrt(n.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / (n.length - 1));
    } },
    { id: 'n', label: 'N', fn: (n) => n.length },
    { id: 'first', label: 'First', fn: (n) => n[0] },
    { id: 'last', label: 'Last', fn: (n) => n[n.length - 1] }
  ],

  /* ================================================================
     Entry point
     ================================================================ */

  /**
   * @param {Object} spec
   * @param {Object} [opts] - {limitRows: boolean} (off for exports)
   * @returns {Object} the ResolvedModel
   */
  run(spec, opts) {
    opts = opts || {};
    const limit = opts.limitRows !== false;

    /*
     * The skeleton is a *readable* model, not a bare `{ok: false}`.
     *
     * `run` returns this unchanged on its two failure paths — no data, and
     * every column hidden — and `App.model` is whatever it last returned, so
     * every view in the app can be holding one. Leaving `rows` and `cols` off
     * it made "did this resolve" and "is there anything to read" two different
     * questions, and six readers asked only the first: the inspector's colour
     * source and value copier, and `Selection.rangeFrom` and `bodyColumn`,
     * threw on `model.rows` or `model.cols` being undefined. A panel that
     * throws leaves the rail blank with nothing on screen to say why.
     *
     * Empty arrays make every one of them correct without a guard, and `ok`
     * and `error` still say the table did not resolve for anyone who needs to
     * ask. This is the same instinct as a step going inert rather than being
     * deleted: degrade to something that still answers.
     */
    const model = {
      ok: false,
      error: null,
      warnings: [],
      cols: [],
      rows: [],
      groups: [],
      columns: [],
      columnsById: {},
      header: { show: false, totalRows: 0, lead: [], levels: [] },
      footnotes: [],
      sourceNotes: [],
      // Empty rather than absent, for the same reason as `rows` and `cols`
      // above: the Style panel's hover preview and the Inspector both compile
      // against this, and a model that did not resolve is still one they can be
      // holding. An empty `columnsById` makes `evalRowExpr` answer "nothing
      // matches", which is the truth about a table that did not resolve.
      ruleContext: { rows: [], columnsById: {}, sequence: [], bodyColumns: [] },
      title: '',
      subtitle: '',
      totalRows: 0,
      truncated: false,
      options: spec.options,
      spec: spec
    };

    if (!Spec.hasData(spec)) {
      model.error = 'No data loaded.';
      return model;
    }

    /* ---- 1. The structural pipeline ---- */

    // Every structural operation, in the order the user put them in — see
    // `pipeline.js`. This used to be five fixed stages hard-coded here, in
    // whatever order the code was written in, with nothing on screen saying
    // there was an order at all.
    const shaped = Pipeline.run(Spec.workingSource(spec), spec.pipeline);
    model.warnings.push.apply(model.warnings, shaped.warnings);
    // Per step: whether it did nothing, and anything it could not do. The
    // Shape panel puts these on the step; the table-wide banner carries only
    // what the reader of the table needs to know.
    model.pipelineNotes = shaped.inert;
    for (let i = 0; i < shaped.inert.length; i += 1) {
      for (const note of shaped.inert[i].notes) {
        const step = spec.pipeline[i];
        const def = Pipeline.type(step && step.type);
        model.warnings.push('Step ' + (i + 1) + ', ' +
          (def ? def.label : 'unknown') + ', ' + note + '.');
      }
    }
    model.corrections = shaped.corrections;
    model.staleCorrections = shaped.staleCorrections;
    model.filteredOut = shaped.filteredOut;

    const working = { columns: shaped.columns, rows: shaped.items.map((item) => item.row) };
    // `rows` is the pipeline's data in source order, which is what a `where`
    // expression naming a column is evaluated over and what `srcIndex` indexes
    // into. `displayRows` is the same rows in the order they are drawn.
    const rows = [];
    for (const item of shaped.items) rows[item.srcIndex] = item.row;
    for (let i = 0; i < rows.length; i += 1) if (!rows[i]) rows[i] = {};

    const columnsById = {};
    for (const col of working.columns) columnsById[col.id] = col;
    model.columns = working.columns;
    model.columnsById = columnsById;

    let displayRows = shaped.items;
    // What the data stage started with, not what survived: the count under the
    // preview says how many a filter is holding back.
    model.sourceRows = shaped.sourceRows;

    model.totalRows = displayRows.length;
    model.truncated = false;
    if (limit && displayRows.length > Compute.MAX_PREVIEW_ROWS) {
      displayRows = displayRows.slice(0, Compute.MAX_PREVIEW_ROWS);
      model.truncated = true;
    }

    /* ---- 2. Column merges ---- */

    // A plan, not a change to the data: `byTarget` says how a cell renders and
    // `consumed` which columns stop being drawn. That is why a merge step can
    // sit anywhere in the table stage without disturbing the filter or sort.
    const merged = Compute.applyMerges(shaped.merges, columnsById);

    /* ---- 3. Grid columns ---- */

    const st = spec.structure;
    model.spanners = shaped.spanners;
    model.groupOrder = shaped.groupOrder;
    model.merges = shaped.merges;
    model.summaries = shaped.summaries;
    model.stubCol = shaped.stubCol;
    model.groupCol = shaped.groupCol;
    const stubColId = shaped.stubCol && columnsById[shaped.stubCol] ? shaped.stubCol : null;
    const groupColId = shaped.groupCol && columnsById[shaped.groupCol] ? shaped.groupCol : null;
    const groupAsColumn = groupColId && spec.options['row_group.as_column'];

    // **`columnOrder` is a preference over what the pipeline produced, not the
    // list of what exists.** It used to be the list, which meant every change
    // to the column set had to write it back — `PanelReshape.resync` existed to
    // do exactly that, and a pipeline step that changed columns without
    // resyncing would have emptied the table. Ordering by preference and
    // appending the rest is the same result when they agree and survivable when
    // they do not.
    const hidden = new Set(st.hidden);
    const ordered = Spec.orderColumns(st.columnOrder, working.columns.map((col) => col.id));
    const bodyColIds = ordered.filter((id) =>
      !hidden.has(id) && id !== stubColId && id !== groupColId && !merged.consumed.has(id));

    const cols = [];
    if (groupAsColumn) {
      cols.push({ kind: 'group', colId: groupColId, key: '__group__',
        label: st.labels[groupColId] || '', align: 'left', width: st.widths[groupColId] || null });
    }
    if (stubColId) {
      cols.push({ kind: 'stub', colId: stubColId, key: '__stub__',
        label: spec.parts.stubhead || '', align: Compute.alignOf(spec, columnsById[stubColId]),
        width: st.widths[stubColId] || null, type: columnsById[stubColId].type });
    }
    for (const id of bodyColIds) {
      cols.push({
        kind: 'body',
        colId: id,
        key: id,
        label: Spec.columnLabel(spec, columnsById[id]),
        align: Compute.alignOf(spec, columnsById[id]),
        width: st.widths[id] || null,
        type: columnsById[id].type
      });
    }

    model.cols = cols;
    model.bodyColIds = bodyColIds;
    model.stubColId = stubColId;
    model.groupColId = groupColId;
    model.groupAsColumn = !!groupAsColumn;

    if (!cols.length) {
      model.error = 'Every column is hidden — nothing to show.';
      return model;
    }

    /* ---- 5. Formatting and colouring plans ---- */

    const formatPlan = Compute.buildFormatPlan(spec, columnsById);
    // For `export-rgt.js`: an unset summary format follows the column being
    // totalled, and this is the one place that resolved which format that is.
    model.formatPlan = formatPlan;
    // A sort the export will not reproduce. It reads the plan, so it cannot be
    // a note the sort step makes as it runs — the plan is not resolved until
    // every step has finished changing the columns.
    Compute.warnMixedDateSort(spec, model, working);
    // Over the rows that survived the filter, not the whole source: a scale
    // fitted to rows nobody can see leaves the visible ones bunched at one end
    // of it. Summaries do the same by construction, since they are built from
    // `displayRows`.
    const colorPlan = Compute.buildColorPlan(spec,
      { columns: working.columns, rows: displayRows.map((item) => item.row) }, columnsById);

    /* ---- 6. Style rules ---- */

    /*
     * **The one context a style rule is ever compiled in.**
     *
     * `rows` is indexed by `srcIndex`, because that is what `StyleRules.resolve`
     * looks a matched row up by. `App.workingRows()` is the same rows in the
     * order they are *drawn*, and under a sort those are different arrays —
     * which is what the Style panel's hover preview used to build its own
     * context out of, so it lit up whichever row happened to be sitting at the
     * matched position. The rule itself was right; only the preview of it was
     * wrong, which is the hardest kind of wrong to believe.
     *
     * `sequence` and `bodyColumns` are for a `where` expression that names a
     * neighbouring cell: the rows in the order they are drawn, and the body
     * columns in the order they are drawn, because "above" and "left" are about
     * the page rather than about the file. Left out, `evalRowExpr` falls back to
     * treating the source order as the page order and every column as a body
     * column — wrong twice over, and silently.
     *
     * It rides on the model rather than being rebuilt by each caller because
     * the model is what the table on screen was rendered from: a preview
     * painted over those nodes has to answer the question the same way they
     * did, and recomputing from the spec is how it stops doing so.
     */
    model.ruleContext = {
      rows: rows,
      columnsById: columnsById,
      sequence: displayRows,
      bodyColumns: Compute.bodyColumnIds(model)
    };

    const compiled = StyleRules.compile(spec.styleRules, model.ruleContext);
    const compiledRules = compiled.rules;
    // Comes back from this compile, so it cannot describe a rule that is no
    // longer here — see the note on `StyleRules.compile`.
    model.ruleError = compiled.error;

    /* ---- 7. Footnote marks ---- */

    const footnotes = Compute.assignFootnoteMarks(spec);
    model.footnotes = footnotes.list;
    const footnoteIndex = footnotes.index;

    /* ---- 8. Header ---- */

    model.header = Compute.buildHeader(spec, model, compiledRules, footnoteIndex);

    /* ---- 9. Body ---- */

    const ctx = {
      spec: spec,
      model: model,
      columnsById: columnsById,
      formatPlan: formatPlan,
      colorPlan: colorPlan,
      merged: merged,
      rules: compiledRules,
      footnoteIndex: footnoteIndex,
      workingRows: rows
    };

    model.rows = Compute.buildBody(displayRows, ctx);

    // The hover preview in the Style rules panel compiles a rule on its own, outside
    // a render, and a `where` expression naming a neighbouring cell needs the
    // same sequence this render used or the outline would not match the paint.
    model.rowSequence = displayRows;

    // A footnote whose mark reaches no cell still prints in the footer, so the
    // reader is left hunting the table for a “1” that is not there. Nothing
    // said so, and every route to it is ordinary: delete the column group a
    // note was attached to, hide the column, restructure a pivot so the group
    // it named no longer exists, or add a note with nothing selected.
    //
    // Asked of the built model rather than of the spec, because "did this
    // anchor find a cell" is only answerable once the cells exist — and asking
    // the spec separately would be a second producer of the location matching
    // `marksFor` has just done.
    const placed = new Set();
    const collect = (cell) => {
      for (const mark of (cell && cell.marks) || []) placed.add(mark);
    };
    for (const level of model.header.levels) level.cells.forEach(collect);
    (model.header.lead || []).forEach(collect);
    for (const row of model.rows) {
      collect(row);
      (row.cells || []).forEach(collect);
    }

    const unplaced = model.footnotes.filter((note) => !placed.has(note.mark));
    if (unplaced.length) {
      model.warnings.push(unplaced.length + ' footnote(s) print a mark the table does not carry — ' +
        unplaced.map((note) => '“' + Util.truncate(Markup.toPlain(note.text), 28) + '”').join(', ') +
        '. Select a cell and re-attach them, or move them to Source notes.');
    }

    // What each colour rule resolved to, for `export-rgt.js`. A summary, not
    // the plan: the plan holds the scale functions and would let a renderer
    // reach behind the model, the way `model.styleRules` carries `{id, label}`
    // and not the spec's rules.
    model.colorScales = colorPlan.map((entry) => ({
      id: entry.id,
      shared: entry.shared,
      domains: entry.domains,
      // The categorical levels in the order the palette was mapped onto them,
      // and the colour each ended up with. Data, not the scale function — gt
      // maps `palette[i]` onto `levels[i]` positionally, so the exporter needs
      // the order this step chose and must not choose its own.
      levels: entry.levels || null,
      levelColors: entry.levels && entry.levelColorOf
        ? entry.levels.reduce((out, level) => {
          out[level] = entry.levelColorOf(level);
          return out;
        }, {})
        : null
    }));

    /* ---- 10. Header/footer text ---- */

    model.title = spec.parts.title || '';
    model.subtitle = spec.parts.subtitle || '';
    model.caption = spec.parts.caption || '';
    model.captionAlign = spec.parts.captionAlign || 'center';
    model.stubhead = spec.parts.stubhead || '';
    model.sourceNotes = spec.parts.sourceNotes.map((note) => ({
      id: note.id,
      text: note.text,
      style: StyleRules.resolve(compiledRules, { part: 'source_notes' })
    }));

    model.titleStyle = StyleRules.resolve(compiledRules, { part: 'title' });
    model.subtitleStyle = StyleRules.resolve(compiledRules, { part: 'subtitle' });
    model.footnotesStyle = StyleRules.resolve(compiledRules, { part: 'footnotes' });

    // Id and label only, so a line that a rule drew can be named without any
    // consumer reaching back into the spec. A reference would expose the
    // editable rules to renderers that have no business with them.
    model.styleRules = spec.styleRules.map((rule) => ({ id: rule.id, label: rule.label }));

    // Marks that sit on the title, subtitle or the notes themselves.
    model.titleMarks = Compute.marksFor(footnoteIndex, { part: 'title' });
    model.subtitleMarks = Compute.marksFor(footnoteIndex, { part: 'subtitle' });

    model.ok = true;
    return model;
  },

  /* ================================================================
     Columns
     ================================================================ */

  /** Resolve a column's alignment, falling back to the type default. */
  alignOf(spec, column) {
    if (!column) return 'left';
    const set = spec.structure.align[column.id];
    if (set && set !== 'auto') return set;
    return Spec.defaultAlign(column);
  },

  /**
   * Apply gt's `cols_merge*()` family.
   *
   * Merges produce a text value for the target column and mark the other
   * columns as consumed so they drop out of the display.
   */
  applyMerges(merges, columnsById) {
    const consumed = new Set();
    const byTarget = {};

    for (const merge of merges || []) {
      if (!columnsById[merge.target]) continue;
      const others = (merge.columns || []).filter((id) => id !== merge.target && columnsById[id]);
      if (!others.length) continue;

      byTarget[merge.target] = { merge: merge, others: others };
      for (const id of others) consumed.add(id);
    }

    return { consumed: consumed, byTarget: byTarget };
  },

  /**
   * The merged text for one cell, given already-formatted pieces.
   * @param {Object} entry - {merge, others}
   * @param {Function} textOf - colId -> formatted text
   */
  mergeText(entry, textOf) {
    const merge = entry.merge;
    const target = textOf(merge.target);
    const others = entry.others.map(textOf);

    switch (merge.type) {
      case 'uncert':
        // value ± uncertainty, or a range when two uncertainty columns are given
        return others.length > 1
          ? target + ' +' + others[0] + ' / −' + others[1]
          : target + ' ± ' + others[0];
      case 'range':
        return target + (merge.sep || '–') + others[0];
      case 'n_pct':
        return target + ' (' + others[0] + ')';
      default: {
        // Free-form pattern: {1} is the target, {2}.. are the others in order.
        const parts = [target].concat(others);
        const pattern = merge.pattern || parts.map((_, i) => '{' + (i + 1) + '}').join(' ');
        return pattern.replace(/\{(\d+)\}/g, (match, n) => {
          const value = parts[parseInt(n, 10) - 1];
          return value === undefined ? '' : value;
        });
      }
    }
  },

  /** Stable multi-key sort. */
  sortRows(displayRows, sort, columnsById) {
    if (!sort || !sort.length) return displayRows;

    const keys = sort.filter((s) => columnsById[s.col]);
    if (!keys.length) return displayRows;

    return displayRows.slice().sort((a, b) => {
      for (const key of keys) {
        const col = columnsById[key.col];
        const av = a.row[key.col];
        const bv = b.row[key.col];
        let cmp;

        if (col.type === 'number') {
          const na = Util.toNumber(av);
          const nb = Util.toNumber(bv);
          // Missing values always sort last, whichever direction is asked for.
          if (na === null && nb === null) cmp = 0;
          else if (na === null) return 1;
          else if (nb === null) return -1;
          else cmp = na - nb;
        } else if (col.type === 'date') {
          /*
           * **A date column sorted as text is not sorted.** There were two
           * branches here, `number` and everything else, and a date fell into
           * the text one — so `14/05/2013`, `03/05/2016`, `25/12/2011` came out
           * in that order reversed rather than in the order they happened, and
           * a day-first column came out in an order with no meaning at all.
           *
           * Read the same way every other date in the app is read: through
           * `Util.toDate`, with the column's own `dateOrder`, because one
           * `14/05/2013` in a column settles how every `3/05/2016` beside it
           * is read and the value alone cannot say.
           */
          const opts = Formatters.dateOpts({}, { column: col });
          const da = Util.toDate(av, opts);
          const db = Util.toDate(bv, opts);
          // Unreadable sorts with missing — last, whichever way round.
          if (da === null && db === null) cmp = 0;
          else if (da === null) return 1;
          else if (db === null) return -1;
          else cmp = da.getTime() - db.getTime();
        } else {
          // Missing last here too, whichever direction is asked for — the
          // numeric branch above has always said so and this one mapped a
          // blank to '', which sorts first ascending. Two column types, two
          // answers to the same question, and `dplyr::arrange()` gives the
          // numeric one, so the exported table disagreed with the preview
          // exactly where the preview disagreed with itself.
          const ma = Util.isMissing(av);
          const mb = Util.isMissing(bv);
          if (ma && mb) cmp = 0;
          else if (ma) return 1;
          else if (mb) return -1;
          else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
        }

        if (cmp !== 0) return key.dir === 'desc' ? -cmp : cmp;
      }
      // **Stable over the incoming order, not over `srcIndex`.** Those are the
      // same thing for one sort step, because the input is in source order —
      // and they part company the moment there are two. Breaking ties by
      // `srcIndex` throws the earlier sort away, while `dplyr::arrange()` is
      // stable and keeps it, so a second sort step meant one thing on screen
      // and another in the exported table. `Array.prototype.sort` has been
      // stable since ES2019, so returning 0 is the whole of it.
      return 0;
    });
  },

  /**
   * Say so when a sort will come out of the export in a different order.
   *
   * `sortRows` above reads every notation a column holds, through
   * `Util.toDate`. `dplyr::arrange()` gets one `strptime` format per column,
   * built by `ExportRgt.dateFormatArg` from the day/month order and separator
   * the importer recorded — and a column written two ways, `14/05/2013` beside
   * `2016-05-03`, has no single separator, so `Csv.inferDateSeparator` records
   * none. `ExportRgt.sortCall` then falls back to `stringr::str_rank()`, a rank
   * over characters, and the exported table comes out in an order the preview
   * never showed.
   *
   * **That fallback is deliberate and stays.** A format picked anyway would
   * turn most of the column into `NA`, and a silent re-ordering is worse than a
   * visible wrong one. What was missing is only that nothing on screen said the
   * two had parted company — while the fix, normalising the column to ISO, was
   * already built and one tab away.
   *
   * **A date format on the column settles it by itself**, which is why the plan
   * is consulted and not just the column. `ExportRgt.dateColumns` puts a
   * formatted column into the tibble as ISO, and `str_rank(numeric = TRUE)`
   * over ISO *is* chronological — checked by running it, not reasoned about.
   * Warning there would be crying wolf about a table that agrees.
   *
   * Both halves are the exporter's own predicates rather than a restatement of
   * them, so this cannot come to describe an export that no longer works that
   * way.
   */
  warnMixedDateSort(spec, model, working) {
    const asIso = ExportRgt.dateColumns(working, model);
    const said = new Set();
    // A `remove` step *below* the sort leaves a column the sort still ordered
    // by and the export still emits an `arrange()` for, so the row order parts
    // company over a column nobody can see. Falling back to the source is
    // exact rather than approximate: `dateOrder` is recorded by the importer
    // and only ever copied from there — a pivot's value columns are built with
    // a `type` and nothing else — so every column that can carry one is here.
    const source = Spec.workingSource(spec);
    const sourceById = {};
    for (const col of source.columns) sourceById[col.id] = col;

    (model.pipelineNotes || []).forEach((notes, index) => {
      const step = spec.pipeline[index];
      if (!step || step.type !== 'sort') return;
      // An inert step sorted nothing here and emits nothing there, so there is
      // no disagreement to report.
      if (notes.inert || !Spec.isEnabled(step)) return;

      for (const key of (step.keys || [])) {
        const column = model.columnsById[key.col] || sourceById[key.col];
        if (!column || said.has(key.col)) continue;
        if (asIso[key.col] || !ExportRgt.dateUnreadable(column)) continue;
        said.add(key.col);
        model.warnings.push('“' + Spec.columnTitle(spec, column) + '” is sorted by date here ' +
          'and by its text in the exported R — it is written in more than one date notation, ' +
          'and R needs a single one. Turn on “Normalise to ISO” for it in the Data tab and ' +
          'the two will agree.');
      }
    });
  },

  /* ================================================================
     Formatting
     ================================================================ */

  /**
   * Resolve which formatter applies to each column. Later rules in
   * `spec.format` win.
   *
   * **A number format applies to every row of its columns**, as a colour rule
   * does. Both used to carry a half-built row scope: `rule.rows` with
   * `mode: 'index'` filtered the preview, no control in either panel could set
   * it, and neither exporter emitted it — so the only way to reach it was to
   * hand-edit a saved project, and doing so produced a table whose R printed
   * different values.
   *
   * **This is the answer, not a gap.** gt has `rows =` on `data_color()` and on
   * the `fmt_*` family, and the app deliberately does not: a table that needs
   * two formats down one column is a job for gt directly, by hand. `rule.rows`
   * stays a dead field. Do not resurrect the branch.
   *
   * @returns {Object} colId -> {type, opts}
   */
  buildFormatPlan(spec, columnsById) {
    const plan = {};

    for (const rule of spec.format) {
      if (!Spec.isEnabled(rule)) continue;
      const entry = { type: rule.type, opts: Formatters.resolveOpts(rule.type, rule.opts) };
      for (const colId of (rule.columns || []).filter((id) => columnsById[id])) {
        plan[colId] = entry;
      }
    }

    return plan;
  },

  /** Format one raw value for a cell. Returns {text, isMarkup}. */
  formatValue(rawValue, colId, ctx) {
    const spec = ctx.spec;

    if (Util.isMissing(rawValue)) {
      if (spec.subs.missing.enabled) return { text: spec.subs.missing.text, isMarkup: true, missing: true };
      return { text: '', isMarkup: false, missing: true };
    }

    const def = ctx.formatPlan[colId] || null;

    if (spec.subs.zero.enabled && Util.toNumber(rawValue) === 0) {
      return { text: spec.subs.zero.text, isMarkup: true, zero: true };
    }

    if (!def) {
      const text = String(rawValue);
      return { text: text, isMarkup: Markup.hasMarkup(text) };
    }

    const formatted = Formatters.apply(def.type, rawValue, def.opts, {
      column: ctx.columnsById[colId]
    });

    if (formatted === null) {
      // The formatter could not handle this value (text in a numeric column,
      // say) — show it as-is rather than blanking it.
      const text = String(rawValue);
      return { text: text, isMarkup: Markup.hasMarkup(text) };
    }

    return { text: formatted, isMarkup: true };
  },

  /* ================================================================
     data_color
     ================================================================ */

  /**
   * The body columns, in the order they are drawn.
   *
   * What `left()` and `right()` count along. The stub and the row-group column
   * are not body cells, so they are not among them — a rule reaching left from
   * the first data column finds nothing rather than finding the row label.
   */
  bodyColumnIds(model) {
    return (model.cols || []).filter((col) => col.kind === 'body').map((col) => col.colId);
  },

  /**
   * Fit one colour scale per data_color rule, over the values it covers.
   *
   * A rule applies to every row of its columns — see the note on
   * `buildFormatPlan` for the row scope both of these used to half-carry.
   *
   * @returns {Array} [{columns:Set, scales, domains, applyTo, autocolorText, ...}]
   */
  buildColorPlan(spec, working, columnsById) {
    const plan = [];

    for (const rule of spec.dataColor) {
      if (!Spec.isEnabled(rule)) continue;
      const columns = (rule.columns || []).filter((id) => columnsById[id]);
      if (!columns.length) continue;

      // A shared domain fits one scale across every listed column; otherwise
      // each column gets its own, which is usually what you want when the
      // columns are in different units.
      // Which columns supply the values, as against which get painted. They
      // are the same list unless the rule says otherwise — gt's
      // `target_columns` seen from the other end.
      const valueColumns = Spec.colorValueColumns(rule).filter((id) => columnsById[id]);
      if (!valueColumns.length) continue;
      const paintedBy = {};
      for (let i = 0; i < columns.length; i += 1) {
        paintedBy[columns[i]] = valueColumns[Math.min(i, valueColumns.length - 1)];
      }

      const buildFor = (ids) => {
        const values = [];
        for (const row of working.rows) {
          for (const id of ids) values.push(row[id]);
        }
        return Palettes.scale({
          colors: Spec.colorRamp(rule),
          method: Spec.colorMethod(rule),
          values: values,
          domain: rule.domain && rule.domain.length === 2 ? rule.domain : null,
          reverse: !!rule.reverse,
          midpoint: rule.midpoint,
          levelColors: rule.levelColors || {},
          naColor: rule.naColor || null
        });
      };

      const scales = {};
      if (rule.sharedDomain !== false) {
        const shared = buildFor(valueColumns);
        for (const id of columns) scales[id] = shared;
      } else {
        for (const id of columns) scales[id] = buildFor([paintedBy[id]]);
      }

      // The range each scale was actually fitted over — after a shared domain
      // has widened it across several columns, after an explicit domain, and
      // after a midpoint has made it symmetric. `export-rgt.js` needs exactly
      // this number and must not re-derive it: gt fits its own domain per
      // column by default, so a scale the preview shared across two columns
      // reaches R as two different scales unless the number is written down.
      // Recorded where it is decided, like the rule id on a border.
      const domains = {};
      for (const id of columns) {
        const breaks = scales[id].breaks;
        domains[id] = breaks && breaks.length ? [breaks[0], breaks[breaks.length - 1]] : null;
      }

      // The levels each scale actually found, in the order the palette was
      // mapped onto them. `export-rgt.js` needs exactly this order to emit
      // `levels =` beside a matching `palette =` — gt maps the two
      // positionally, so re-deriving the order there would be a second
      // producer of the thing that decides which category is which colour.
      const levels = scales[columns[0]] && scales[columns[0]].levels;

      plan.push({
        id: rule.id,
        columns: new Set(columns),
        columnOrder: columns,
        valueColumns: valueColumns,
        paintedBy: paintedBy,
        scales: scales,
        domains: domains,
        levels: levels && levels.length ? levels.slice() : null,
        levelColorOf: scales[columns[0]] && scales[columns[0]].colorOf,
        shared: rule.sharedDomain !== false,
        applyTo: rule.applyTo || 'fill',
        autocolorText: rule.autocolorText !== false,
        contrast: Spec.colorContrast(rule, spec.options),
        alpha: rule.alpha === undefined ? 1 : rule.alpha
      });
    }

    return plan;
  },

  /** The colour contribution for one cell, or null. */
  colorFor(rawValue, colId, srcIndex, ctx, row) {
    let out = null;

    for (const entry of ctx.colorPlan) {
      if (!entry.columns.has(colId)) continue;

      // The value that drives the colour is not always the value in the cell:
      // a rule can paint one column from another's numbers.
      const from = entry.paintedBy[colId];
      const driving = (from === colId || !row) ? rawValue : row[from];
      const color = entry.scales[colId].of(driving);
      if (!color) continue;

      const shaded = entry.alpha < 1 ? Palettes.withAlpha(color, entry.alpha) : color;

      // Which rule won, recorded where it wins — the same reasoning that puts
      // `ruleId` on a border in `StyleRules.merge`, and it costs the same
      // nothing: the object is already being allocated. Re-matching the plan
      // when something asks would make a second producer of a fact this loop
      // has already decided, which is the fault this codebase keeps paying for.
      //
      // Per property, not per rule, because later rules win per property: with
      // a fill rule under a text-colour rule, the two halves of one cell's
      // colour come from two different rules.
      if (entry.applyTo === 'text') {
        out = Object.assign({}, out, { color: shaded, colorRule: entry.id });
      } else {
        const next = { fill: shaded, fillRule: entry.id };
        if (entry.autocolorText) {
          next.color = Palettes.readableOn(
            shaded, entry.contrast.dark, entry.contrast.light, entry.contrast.algo);
          next.colorRule = entry.id;
        }
        out = Object.assign({}, out, next);
      }
    }

    return out;
  },

  /* ================================================================
     Footnotes
     ================================================================ */

  /**
   * Assign marks to footnotes in reading order and index them by location.
   * @returns {{list, index}} index maps a location key to an array of marks
   */
  assignFootnoteMarks(spec) {
    const notes = spec.parts.footnotes || [];
    const list = [];
    const index = {};

    // Reading order: title, subtitle, stubhead, spanners, column labels, then
    // the body top-to-bottom, then the footer. Notes without a location keep
    // their authored order at the end.
    const partRank = {
      title: 0, subtitle: 1, stubhead: 2, column_spanners: 3, column_labels: 4,
      row_groups: 5, stub: 6, body: 6, summary: 7, grand_summary: 8, source_notes: 9
    };

    const ordered = notes.map((note, i) => ({ note: note, i: i })).sort((a, b) => {
      const la = a.note.location || {};
      const lb = b.note.location || {};
      const ra = partRank[la.part] === undefined ? 99 : partRank[la.part];
      const rb = partRank[lb.part] === undefined ? 99 : partRank[lb.part];
      if (ra !== rb) return ra - rb;
      const ia = la.srcIndex === undefined ? -1 : la.srcIndex;
      const ib = lb.srcIndex === undefined ? -1 : lb.srcIndex;
      if (ia !== ib) return ia - ib;
      return a.i - b.i;
    });

    // Identical footnote text reuses the same mark, as gt does.
    const marksByText = {};
    let counter = 0;

    for (const item of ordered) {
      const note = item.note;
      let mark;
      if (Object.prototype.hasOwnProperty.call(marksByText, note.text)) {
        mark = marksByText[note.text];
      } else {
        mark = Compute.markAt(counter, spec.options['footnotes.marks']);
        marksByText[note.text] = mark;
        counter += 1;
        list.push({ id: note.id, mark: mark, text: note.text });
      }

      if (note.location && note.location.part) {
        const key = Compute.locationKey(note.location);
        if (!index[key]) index[key] = [];
        if (index[key].indexOf(mark) < 0) index[key].push(mark);
      }
    }

    return { list: list, index: index };
  },

  /** The nth mark in a set, doubling the glyph once the set is exhausted. */
  markAt(n, setName) {
    if (!setName || setName === 'numbers') return String(n + 1);
    const set = Compute.MARK_SETS[setName];
    if (!set) return String(n + 1);
    const repeats = Math.floor(n / set.length) + 1;
    return set[n % set.length].repeat(repeats);
  },

  /**
   * Stable key for a footnote/selection location.
   *
   * Only the dimensions the part actually uses take part in the key, and
   * `StyleRules.PARTS` already declares which those are — `columns`, `rows`,
   * `groups`, `spanners`. Without that, the two sides that build these keys
   * disagree: `Selection` tags a body cell with the `groupId` of the row group
   * it happens to sit in, and `PanelContent.locationOf` copies it, while the
   * cell's own location here carries none. The keys never matched, so on any
   * grouped table a footnote reached the footer with no anchor in the cell.
   *
   * A body cell is identified by its column and row; the group is context, not
   * identity, and `srcIndex` already pins the row. A summary row is the other
   * way round — it has no row index and one per group, so `groups` is part of
   * its identity and `rows` is not. Deriving that from `PARTS` rather than
   * restating it is what stops the two sides drifting apart again.
   */
  locationKey(loc) {
    const part = StyleRules.PARTS.find((p) => p.id === loc.part);
    // An unknown part keeps every field, which is the old behaviour.
    const uses = (dimension) => !part || !!part[dimension];
    return [
      loc.part,
      uses('columns') ? (loc.colId || '') : '',
      uses('rows')
        ? (loc.srcIndex === undefined || loc.srcIndex === null ? '' : loc.srcIndex)
        : '',
      uses('groups') ? (loc.groupId || '') : '',
      uses('spanners') ? (loc.spannerId || '') : ''
    ].join('|');
  },

  /** Marks attached to a location, or an empty array. */
  marksFor(index, loc) {
    return index[Compute.locationKey(loc)] || [];
  },


  /* ================================================================
     Header
     ================================================================ */

  /**
   * Build the header rows.
   *
   * Spanner levels run bottom-up in the spec (level 1 sits directly above the
   * column labels), so they are emitted top-down here. A column with no spanner
   * above it gets its label in the topmost row with a rowspan reaching down to
   * the label row — the same thing gt does, and it reads much better than a
   * stack of empty cells.
   */
  buildHeader(spec, model, rules, footnoteIndex) {
    const cols = model.cols;
    const bodyCols = cols.filter((c) => c.kind === 'body');
    const spanners = (model.spanners || []).filter((sp) => sp.columns.length);

    // Body columns sit to the right of the stub and group columns. Every header
    // cell records the grid column it truly occupies, because the label row
    // contains only the columns no spanner claimed — so its cells are not
    // contiguous from the left, and a running counter would misplace them.
    const leadCount = (model.groupAsColumn ? 1 : 0) + (model.stubColId ? 1 : 0);

    const maxLevel = spanners.reduce((max, sp) => Math.max(max, sp.level || 1), 0);
    const totalRows = maxLevel + 1;

    // colId -> level -> spanner. Two column groups can claim one column at one
    // level, and the later one silently took it — no mark on screen, nothing in
    // the panel, and R that gt rejects outright, since `tab_spanner()` refuses
    // to overwrite a spanner unless it is told to. Trivially reachable: the
    // Shape panel lets any group name any columns at any level.
    const at = {};
    const overlaps = [];
    for (const sp of spanners) {
      for (const colId of sp.columns) {
        if (!at[colId]) at[colId] = {};
        const level = sp.level || 1;
        const held = at[colId][level];
        if (held && held !== sp) overlaps.push([held.label, sp.label]);
        at[colId][level] = sp;
      }
    }
    for (const pair of Util.unique(overlaps.map((p) => p.join('\u0001')))) {
      const pair2 = pair.split('\u0001');
      model.warnings.push('Column groups “' + pair2[0] + '” and “' + pair2[1] +
        '” cover the same column at the same level — “' + pair2[1] + '” wins. ' +
        'Move one to another level, or give it different columns.');
    }

    const emitted = new Set();
    const levels = [];

    for (let level = maxLevel; level >= 1; level -= 1) {
      const rowIndex = maxLevel - level;
      const cells = [];
      let i = 0;

      while (i < bodyCols.length) {
        const col = bodyCols[i];

        // Already placed at a higher level, where it was given a rowspan
        // reaching down to the label row. That cell occupies this row's grid
        // column too, so there is nothing here to emit and nothing to leave
        // blank. Without the guard the label went in again at every level
        // below the one that placed it, and each extra cell pushed its row a
        // column wider than the table — a spanner row visibly hanging off
        // the right-hand end of the body. It takes two spanner levels to show,
        // which is why a single name column never did.
        if (emitted.has(col.colId)) { i += 1; continue; }

        const spanner = at[col.colId] && at[col.colId][level];

        if (spanner) {
          // Consume every consecutive column carrying this same spanner.
          let span = 1;
          while (i + span < bodyCols.length &&
                 at[bodyCols[i + span].colId] &&
                 at[bodyCols[i + span].colId][level] === spanner) {
            span += 1;
          }
          const loc = { part: 'column_spanners', spannerId: spanner.id };
          cells.push({
            kind: 'spanner',
            id: spanner.id,
            label: spanner.label,
            span: span,
            rowspan: 1,
            gridCol: leadCount + i,
            colIds: bodyCols.slice(i, i + span).map((c) => c.colId),
            align: 'center',
            style: StyleRules.resolve(rules, loc),
            marks: Compute.marksFor(footnoteIndex, loc)
          });
          i += span;
          continue;
        }

        // No spanner here. If the column has one at a lower level, leave a gap;
        // otherwise drop its label in now and let it span down to the label row.
        const hasLower = at[col.colId] && Object.keys(at[col.colId]).some((l) => +l < level);

        if (hasLower) {
          let span = 1;
          while (i + span < bodyCols.length) {
            const next = bodyCols[i + span];
            const nextSpanner = at[next.colId] && at[next.colId][level];
            const nextLower = at[next.colId] && Object.keys(at[next.colId]).some((l) => +l < level);
            if (nextSpanner || !nextLower) break;
            span += 1;
          }
          cells.push({ kind: 'blank', span: span, rowspan: 1, gridCol: leadCount + i, label: '', colIds: [] });
          i += span;
        } else {
          cells.push(Compute.labelCell(col, totalRows - rowIndex, leadCount + i, rules, footnoteIndex, spec));
          emitted.add(col.colId);
          i += 1;
        }
      }

      // One group drawn as two cells means its columns are not next to each
      // other. The preview can only draw it in pieces; gt moves the columns
      // together instead (`tab_spanner(gather = TRUE)`), so this is also the
      // one arrangement where the exported table is laid out differently from
      // the one on screen.
      const drawn = {};
      for (const cell of cells) {
        if (cell.kind === 'spanner') drawn[cell.id] = (drawn[cell.id] || 0) + 1;
      }
      for (const id in drawn) {
        if (drawn[id] < 2) continue;
        const sp = spanners.find((x) => x.id === id);
        model.warnings.push('Column group “' + (sp ? sp.label : id) + '” covers columns that are ' +
          'not next to each other, so it is drawn in ' + drawn[id] + ' pieces. ' +
          'The R export moves them together instead. Reorder the columns to match.');
      }

      levels.push({ level: level, cells: cells });
    }

    // The column-label row itself: only the columns no spanner claimed, which
    // is why each carries its own grid column rather than sitting in sequence.
    const labelCells = [];
    bodyCols.forEach((col, i) => {
      if (emitted.has(col.colId)) return;
      labelCells.push(Compute.labelCell(col, 1, leadCount + i, rules, footnoteIndex, spec));
    });
    levels.push({ level: 0, cells: labelCells });

    // The stub and group columns get one cell spanning the whole header block,
    // placed in the top row.
    const lead = [];
    const stubheadLoc = { part: 'stubhead' };

    if (model.groupAsColumn) {
      // With no stub column this is the only header cell over the stub area, so
      // it is what the stubhead labels. When a stub column follows, the label
      // belongs to that cell instead and this one stays blank.
      const labelsStub = !model.stubColId;
      lead.push({
        kind: 'stubhead',
        label: labelsStub ? (spec.parts.stubhead || '') : '',
        span: 1,
        rowspan: totalRows,
        gridCol: lead.length,
        colIds: [],
        align: 'left',
        style: labelsStub ? StyleRules.resolve(rules, stubheadLoc) : null,
        marks: labelsStub ? Compute.marksFor(footnoteIndex, stubheadLoc) : []
      });
    }
    if (model.stubColId) {
      lead.push({
        kind: 'stubhead',
        label: spec.parts.stubhead || '',
        span: 1,
        rowspan: totalRows,
        gridCol: lead.length,
        colIds: [],
        align: 'left',
        style: StyleRules.resolve(rules, stubheadLoc),
        marks: Compute.marksFor(footnoteIndex, stubheadLoc)
      });
    }

    return {
      show: !spec.options['column_labels.hidden'],
      totalRows: totalRows,
      spannerLevels: maxLevel,
      lead: lead,
      levels: levels
    };
  },

  /** One column-label cell. */
  labelCell(col, rowspan, gridCol, rules, footnoteIndex, spec) {
    const loc = { part: 'column_labels', colId: col.colId };
    return {
      kind: 'label',
      colId: col.colId,
      label: col.label,
      span: 1,
      rowspan: rowspan,
      gridCol: gridCol,
      colIds: [col.colId],
      align: col.align,
      style: StyleRules.resolve(rules, loc),
      marks: Compute.marksFor(footnoteIndex, loc)
    };
  },

  /* ================================================================
     Body
     ================================================================ */

  /**
   * Build the body rows: group label rows, data rows, summary rows and the
   * grand summary, in display order.
   */
  buildBody(displayRows, ctx) {
    const spec = ctx.spec;
    const model = ctx.model;
    const groupColId = model.groupColId;
    const out = [];

    /* ---- Partition into groups ---- */

    let groups;
    if (groupColId) {
      const defaultLabel = spec.options['row_group.default_label'] || '';
      const byLabel = new Map();

      for (const item of displayRows) {
        const raw = item.row[groupColId];
        const label = Util.isMissing(raw) ? defaultLabel : String(raw);
        if (!byLabel.has(label)) byLabel.set(label, []);
        byLabel.get(label).push(item);
      }

      const order = model.groupOrder || [];
      const seen = Array.from(byLabel.keys());
      const ordered = order.filter((label) => byLabel.has(label))
        .concat(seen.filter((label) => order.indexOf(label) < 0));

      groups = ordered.map((label) => ({ label: label, id: label, items: byLabel.get(label) }));
    } else {
      groups = [{ label: null, id: null, items: displayRows }];
    }

    model.groups = groups.map((g) => ({ id: g.id, label: g.label, count: g.items.length }));

    /* ---- Emit ---- */

    let stripeIndex = 0;

    for (const group of groups) {
      if (group.label !== null && !model.groupAsColumn) {
        const loc = { part: 'row_groups', groupId: group.id };
        out.push({
          kind: 'group',
          groupId: group.id,
          groupLabel: group.label,
          span: model.cols.length,
          style: StyleRules.resolve(ctx.rules, loc),
          marks: Compute.marksFor(ctx.footnoteIndex, loc),
          cells: []
        });
      }

      let labelCell = null;
      group.items.forEach((item, indexInGroup) => {
        const dataRow = Compute.buildDataRow(item, group, indexInGroup, stripeIndex, ctx);
        if (indexInGroup === 0) labelCell = dataRow.cells.find((c) => c.kind === 'group-col');
        out.push(dataRow);
        stripeIndex += 1;
      });

      // Group summaries.
      let summaryCount = 0;
      for (const summary of model.summaries.groups) {
        const rows = Compute.summaryRows(summary, group.items, 'summary', ctx, group);
        out.push.apply(out, rows);
        summaryCount += rows.length;
      }

      // A group's summary rows are part of its block — `edges.js` already draws
      // the group's top and bottom border around them, keyed on `groupId` — so
      // with `row_group.as_column` the label spans down over them. It cannot be
      // counted in `buildDataRow`, which does not know what follows the group.
      if (labelCell && labelCell.rowspan) labelCell.rowspan += summaryCount;
    }

    // Grand summaries, over every displayed row.
    for (const summary of model.summaries.grand) {
      const rows = Compute.summaryRows(summary, displayRows, 'grand_summary', ctx, null);
      out.push.apply(out, rows);
    }

    return out;
  },

  /** One data row. */
  buildDataRow(item, group, indexInGroup, stripeIndex, ctx) {
    const spec = ctx.spec;
    const model = ctx.model;
    const row = item.row;
    const srcIndex = item.srcIndex;
    const cells = [];

    const textOf = (colId) => Compute.formatValue(row[colId], colId, ctx).text;

    for (const col of model.cols) {
      if (col.kind === 'group') {
        // Only the first row of a group carries the label, and it spans down.
        cells.push({
          kind: 'group-col',
          colId: col.colId,
          text: indexInGroup === 0 ? String(group.label === null ? '' : group.label) : null,
          rowspan: indexInGroup === 0 ? group.items.length : 0,
          align: 'left',
          style: indexInGroup === 0
            ? StyleRules.resolve(ctx.rules, { part: 'row_groups', groupId: group.id })
            : null,
          marks: []
        });
        continue;
      }

      const part = col.kind === 'stub' ? 'stub' : 'body';
      const loc = { part: part, colId: col.kind === 'stub' ? undefined : col.colId, srcIndex: srcIndex };

      const mergeEntry = ctx.merged.byTarget[col.colId];
      let formatted;
      if (mergeEntry) {
        formatted = { text: Compute.mergeText(mergeEntry, textOf), isMarkup: true };
      } else {
        formatted = Compute.formatValue(row[col.colId], col.colId, ctx);
      }

      const color = col.kind === 'body'
        ? Compute.colorFor(row[col.colId], col.colId, srcIndex, ctx, row)
        : null;

      cells.push({
        kind: col.kind === 'stub' ? 'stub' : 'body',
        colId: col.colId,
        text: formatted.text,
        raw: row[col.colId],
        missing: !!formatted.missing,
        isMarkup: formatted.isMarkup,
        align: col.align,
        // Clamped to gt's own range: `tab_stub_indent()` takes 0 to 5 and
        // errors outside it, so a preview that went further would draw a table
        // that cannot be exported.
        indent: col.kind === 'stub'
          ? Util.clamp(Math.round((spec.structure.stubIndent || {})[srcIndex] || 0), 0, 5)
          : 0,
        style: StyleRules.resolve(ctx.rules, loc),
        color: color,
        marks: Compute.marksFor(ctx.footnoteIndex, loc)
      });
    }

    const stripeOn = spec.options['row.striping.include_table_body'];

    return {
      kind: 'data',
      srcIndex: srcIndex,
      groupId: group.id,
      groupLabel: group.label,
      indexInGroup: indexInGroup,
      isFirstInGroup: indexInGroup === 0,
      isLastInGroup: indexInGroup === group.items.length - 1,
      stripe: !!stripeOn && (stripeIndex % 2 === 1),
      cells: cells
    };
  },

  /**
   * Build the rows for one summary definition. A definition with several
   * functions produces several rows, as gt does.
   */
  summaryRows(summary, items, part, ctx, group) {
    const model = ctx.model;
    const fns = (summary.fns && summary.fns.length ? summary.fns : ['sum']);
    const columns = new Set((summary.columns || []).filter((id) => ctx.columnsById[id]));
    const out = [];

    for (const fnId of fns) {
      const def = Compute.SUMMARY_FNS.find((f) => f.id === fnId);
      if (!def) continue;

      const label = (summary.labels && summary.labels[fnId]) || def.label;
      const cells = [];

      // A summary row has no row index and there is one per group, so the
      // group is part of what identifies it — `StyleRules.PARTS` says as much
      // for `summary` (`groups: true`), and `locationKey` honours that. A
      // grand summary spans every group and carries none.
      const summaryLoc = (colId) => ({
        part: part,
        colId: colId,
        groupId: group ? group.id : undefined
      });

      for (const col of model.cols) {
        if (col.kind === 'group') {
          // A group summary sits inside its group's block, so the label above
          // it spans down over this slot and the cell is absorbed. A grand
          // summary belongs to no group and nothing spans over it, so it takes
          // a blank cell of its own — a row one cell short does not leave a
          // gap, it draws every value one column to the left.
          cells.push({
            kind: 'group-col',
            colId: col.colId,
            text: null,
            rowspan: group ? 0 : 1,
            style: null,
            marks: []
          });
          continue;
        }

        if (col.kind === 'stub') {
          // The label cell is where someone footnotes the summary itself
          // ("Mean¹"), so it takes marks like any other cell — it used to
          // hardcode an empty list, which meant a footnote attached here
          // reached the footer and was anchored nowhere.
          cells.push({
            kind: part === 'grand_summary' ? 'grand-stub' : 'summary-stub',
            colId: col.colId,
            text: label,
            isMarkup: true,
            align: 'left',
            style: StyleRules.resolve(ctx.rules, { part: part }),
            marks: Compute.marksFor(ctx.footnoteIndex, summaryLoc(col.colId))
          });
          continue;
        }

        let text = '';
        let raw = null;
        if (columns.has(col.colId)) {
          const nums = items
            .map((item) => Util.toNumber(item.row[col.colId]))
            .filter((n) => n !== null);
          if (nums.length) {
            raw = def.fn(nums);
            // **Unset means "as the column is formatted".** A total showing
            // 11,654,700.00 beneath a column of 4,182,000 is in a different
            // unit from the thing it totals; two decimals was only ever a
            // guess at what a number wants. A count is the exception — it is a
            // number of rows, not a quantity in the column's units.
            const columnFormat = ctx.formatPlan[col.colId];
            const inherit = fnId !== 'n' && !summary.format && columnFormat;
            const formatType = summary.format || (inherit ? columnFormat.type : 'number');
            const formatOpts = summary.formatOpts ||
              (inherit ? columnFormat.opts : { decimals: fnId === 'n' ? 0 : 2 });
            const formatted = Formatters.apply(formatType, raw, formatOpts, {});
            text = formatted === null ? String(raw) : formatted;
          }
        }

        const loc = summaryLoc(col.colId);
        cells.push({
          kind: part === 'grand_summary' ? 'grand' : 'summary',
          colId: col.colId,
          text: text,
          raw: raw,
          isMarkup: true,
          align: col.align,
          style: StyleRules.resolve(ctx.rules, loc),
          marks: Compute.marksFor(ctx.footnoteIndex, loc)
        });
      }

      // With no stub there is nowhere to put the label, so it goes in the first
      // column instead — otherwise the row is unreadable.
      if (!model.stubColId && cells.length) {
        const first = cells.find((c) => c.kind !== 'group-col');
        if (first && !first.text) first.text = label;
      }

      out.push({
        kind: part === 'grand_summary' ? 'grand' : 'summary',
        summaryId: summary.id,
        fn: fnId,
        label: label,
        groupId: group ? group.id : null,
        cells: cells
      });
    }

    return out;
  }
};
