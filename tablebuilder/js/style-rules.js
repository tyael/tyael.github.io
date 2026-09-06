/**
 * style-rules.js
 *
 * Location resolution and the style cascade — gt's `tab_style()` model.
 *
 * Styling here is rule-based rather than per-cell. A rule says "these locations
 * get this style", the rules are an ordered list, and later rules win on
 * overlap. That is what makes "every numeric cell under the 2024 spanner" a
 * thing you can express, edit later, reorder, and switch off — none of which
 * works if a click bakes a colour into a cell.
 *
 * Rules are compiled once per render into Sets and predicates, so the per-cell
 * cost during compute is a handful of Set lookups rather than a re-scan.
 */

const StyleRules = {

  /**
   * The locations a rule can target, mirroring gt's `cells_*()` helpers.
   *
   * `optionGroup` names this part's group in `options-schema.js`, so selecting
   * a cell can offer the defaults that actually govern it. `id` and `gt` are
   * persisted in saved projects and emitted into R code — never change those.
   */
  PARTS: [
    { id: 'body', label: 'Body cells', gt: 'cells_body', columns: true, rows: true, optionGroup: 'table_body' },
    { id: 'stub', label: 'Row labels', gt: 'cells_stub', columns: false, rows: true, optionGroup: 'stub' },
    // `header: true` is the three parts that live in the column-label header
    // block and so are not drawn at all under `column_labels.hidden` — which
    // takes the whole block, not just the label row. It is read through
    // `Spec.inHiddenHeader`, and it is deliberately *not* one of the flags
    // `Compute.locationKey` identifies a location by: adding it must not
    // change what a persisted footnote anchors to.
    { id: 'column_labels', label: 'Column labels', gt: 'cells_column_labels', columns: true, rows: false, header: true, optionGroup: 'column_labels' },
    { id: 'column_spanners', label: 'Column groups', gt: 'cells_column_spanners', columns: false, rows: false, spanners: true, header: true, optionGroup: 'column_labels' },
    { id: 'stubhead', label: 'Row-label header', gt: 'cells_stubhead', columns: false, rows: false, header: true, optionGroup: 'column_labels' },
    { id: 'row_groups', label: 'Row group labels', gt: 'cells_row_groups', columns: false, rows: false, groups: true, optionGroup: 'row_group' },
    { id: 'summary', label: 'Summary rows', gt: 'cells_summary', columns: true, rows: false, groups: true, optionGroup: 'summary_row' },
    { id: 'grand_summary', label: 'Grand summary', gt: 'cells_grand_summary', columns: true, rows: false, optionGroup: 'summary_row' },
    { id: 'title', label: 'Title', gt: 'cells_title(groups = "title")', columns: false, rows: false, optionGroup: 'heading' },
    { id: 'subtitle', label: 'Subtitle', gt: 'cells_title(groups = "subtitle")', columns: false, rows: false, optionGroup: 'heading' },
    { id: 'footnotes', label: 'Footnotes', gt: 'cells_footnotes', columns: false, rows: false, optionGroup: 'footnotes' },
    { id: 'source_notes', label: 'Source notes', gt: 'cells_source_notes', columns: false, rows: false, optionGroup: 'source_notes' }
  ],

  /**
   * Text properties a rule can offer, mirroring gt's `cell_text()`.
   *
   * **`stretch` is deliberately not here, and `toCss` still reads it.** A
   * browser synthesises bold and oblique but never a width: `font-stretch`
   * only ever *selects* a condensed or expanded face the family already has,
   * and none of the sixteen built-ins has one — `index.html` asks Google Fonts
   * for `:wght@…` and nothing else, so no `wdth` axis is served, and Google
   * ships condensed designs as separate families anyway. That is what the
   * separate `roboto-condensed` stack is for. Measured across every built-in
   * with the faces confirmed loaded, the control moved nothing at all.
   *
   * It stays in `toCss` and in `export-rgt.js` because it is not inert
   * everywhere: an uploaded variable font with a `wdth` axis answers it, and
   * so does gt in RStudio against a locally installed condensed face. A spec
   * or theme that already carries one keeps working — there is just no longer
   * a control that writes one.
   */
  TEXT_PROPS: [
    { key: 'color', label: 'Colour', type: 'color' },
    { key: 'font', label: 'Font', type: 'fonts' },
    { key: 'size', label: 'Size', type: 'len' },
    { key: 'weight', label: 'Weight', type: 'select', enum: OptionsSchema.FONT_WEIGHTS },
    { key: 'style', label: 'Style', type: 'select', enum: ['normal', 'italic', 'oblique'] },
    { key: 'align', label: 'Align', type: 'select', enum: ['left', 'center', 'right', 'justify'] },
    { key: 'vAlign', label: 'Vertical align', type: 'select', enum: ['top', 'middle', 'bottom'] },
    { key: 'transform', label: 'Transform', type: 'select', enum: ['none', 'uppercase', 'lowercase', 'capitalize'] },
    { key: 'decorate', label: 'Decoration', type: 'select', enum: ['none', 'underline', 'overline', 'line-through'] },
    { key: 'whitespace', label: 'Whitespace', type: 'select', enum: ['normal', 'nowrap', 'pre', 'pre-wrap'],
      hint: 'Only shows where something makes the text wrap — give the column a width under Structure first.' },
    { key: 'indent', label: 'Indent', type: 'len' }
  ],

  SIDES: ['top', 'right', 'bottom', 'left'],

  /* ---------- Referring to a column from a row expression ---------- */

  /**
   * Can this column id be a bare variable in a compiled row expression?
   *
   * Two ways it cannot: the slug is not a JS identifier (a header of "2024"
   * slugs to `2024`), or it collides with something already in the compiled
   * scope — `n`, `row`, `v`, `Math`, or a keyword. Both stay reachable through
   * `v['…']`.
   */
  bareName(colId) {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(colId) &&
      StyleRules.RESERVED.indexOf(colId) < 0;
  },

  /**
   * How a column is written inside a row expression.
   *
   * **The one place that decides.** `evalRowExpr` builds the scope, `seedExpr`
   * writes an expression into a new rule, and the Style rules panel lists what is
   * available — three producers of the same fact, and the panel's copy was
   * missing the reserved-word half. So a column called `n` was advertised as
   * being in scope by name when typing `n` actually gives you the row count.
   */
  ref(colId) {
    return StyleRules.bareName(colId)
      ? colId
      : "v['" + String(colId).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "']";
  },

  /** Words that cannot become a `var` in a compiled row expression. */
  RESERVED: ['var', 'let', 'const', 'if', 'else', 'for', 'while', 'do', 'function',
    'return', 'new', 'this', 'typeof', 'instanceof', 'in', 'of', 'class', 'null',
    'true', 'false', 'undefined', 'NaN', 'Infinity', 'v', 'row', 'n', 'Math', 'String',
    'Number', 'Boolean', 'Array', 'Object', 'Date', 'RegExp', 'JSON',
    // The neighbouring-cell helpers below. A column called `left` stays
    // reachable as `v['left']`, the same way a column called `n` does.
    'self', 'above', 'below', 'left', 'right'],

  /**
   * Reaching a cell other than the one being tested.
   *
   * `self()`, `above(k)`, `below(k)`, `left(k)` and `right(k)` are all relative
   * to **the cell the rule would style**, so `left() > 5` means "this cell's
   * left-hand neighbour is over 5" whichever column the rule covers. `k`
   * defaults to 1. Out of range — the top row, the first body column — is
   * `undefined`, so every comparison against it is false and the cell is not
   * selected. That is what `dplyr::lag()` does with the `NA` it produces at the
   * same boundary, and gt drops an `NA` row from a `rows =` predicate, so the
   * two agree without either being told about the other.
   *
   * Above and below are the **displayed** order — after the filter and the
   * sort, which is the order `dplyr::arrange()` puts the exported data in.
   * Left and right are the **body** columns in their displayed order; the stub
   * and the row-group column are not body cells and are not counted.
   */
  CELL_REFS: ['self', 'above', 'below', 'left', 'right'],

  /**
   * Does this expression reach for a neighbouring cell?
   *
   * It decides how the expression is evaluated, and the difference is not free:
   * a plain expression is a fact about a row and is evaluated once per row,
   * while one naming a neighbour is a fact about a *cell* and has to be
   * evaluated once per column as well.
   */
  usesCellRefs(expr) {
    return new RegExp('\\b(' + StyleRules.CELL_REFS.join('|') + ')\\s*\\(').test(String(expr));
  },

  /* ---------- Construction ---------- */

  /** A rule targeting nothing, with no style set. */
  emptyRule(label) {
    return {
      id: Util.uid('rule'),
      enabled: true,
      label: label || 'Style rule',
      locations: [],
      style: { text: {}, fill: {}, borders: {} }
    };
  },

  /** A location object for a part, with sensible empty targeting. */
  emptyLocation(part) {
    return {
      part: part || 'body',
      columns: [],         // empty means "every column"
      rows: { mode: 'all', indices: [], expr: '' },
      groups: [],          // empty means "every group"
      spanners: []         // empty means "every spanner"
    };
  },

  /** True when the style sets nothing at all. */
  isEmptyStyle(style) {
    if (!style) return true;
    const noText = !style.text || Object.keys(style.text).every((k) => !style.text[k]);
    const noFill = !style.fill || !style.fill.color;
    // A border of `none` counts as set: it is a rule saying "take the line off
    // these cells", which is a real instruction and must survive compile().
    // Inheriting is the absence of the side, not a style of 'none'.
    const noBorders = !style.borders || StyleRules.SIDES.every((s) => {
      const b = style.borders[s];
      return !b || !b.style;
    });
    return noText && noFill && noBorders;
  },

  /**
   * Human-readable summary of what a rule targets, e.g.
   * "Body · 3 columns · rows 4–9".
   */
  describe(rule, columnsById) {
    if (!rule.locations.length) return 'no locations';
    return rule.locations.map((loc) => {
      const part = StyleRules.PARTS.find((p) => p.id === loc.part);
      const bits = [part ? part.label : loc.part];

      if (loc.columns && loc.columns.length) {
        bits.push(loc.columns.length <= 3
          ? loc.columns.map((id) => (columnsById && columnsById[id] ? columnsById[id].label : id)).join(', ')
          : loc.columns.length + ' columns');
      }
      if (loc.rows && loc.rows.mode === 'index' && loc.rows.indices.length) {
        bits.push(loc.rows.indices.length + ' row' + (loc.rows.indices.length === 1 ? '' : 's'));
      } else if (loc.rows && loc.rows.mode === 'expr' && loc.rows.expr) {
        bits.push('where ' + Util.truncate(loc.rows.expr, 28));
      }
      if (loc.groups && loc.groups.length) bits.push(loc.groups.length + ' group(s)');
      return bits.join(' · ');
    }).join('  |  ');
  },

  /* ---------- Compilation ---------- */

  /**
   * Turn the spec's rules into a fast matcher.
   *
   * **The row-expression error is returned, not stashed.** It used to live in
   * `StyleRules._exprError`, a module-level flag set on failure and cleared
   * only by a later *successful* evaluation — so it belonged to no particular
   * compile and outlived everything:
   *
   *   - deleting the rule with the bad expression left the warning on screen,
   *     because with no rules left nothing ever evaluated to clear it;
   *   - so did merely disabling it, which `continue`s before the eval;
   *   - two rules reported whichever ran last, not whichever was broken;
   *   - and `Selection.paintRulePreview` compiles too, on *hover*, so running
   *     the pointer over a valid rule silently cleared a real error, while
   *     hovering a broken one raised a warning about a rule the render had
   *     nothing to do with.
   *
   * An error is a fact about one compile, so it comes back with that compile.
   *
   * @param {Array} rules - spec.styleRules
   * @param {Object} ctx  - {rows, columnsById} the working data, for row expressions
   * @returns {{rules: Array, error: ?string}} compiled rules in application
   *   order, and the first row-expression failure among them
   */
  compile(rules, ctx) {
    const out = [];
    let error = null;

    for (const rule of rules) {
      if (!Spec.isEnabled(rule) || StyleRules.isEmptyStyle(rule.style)) continue;

      const locations = rule.locations.map((loc) => {
        const columns = loc.columns && loc.columns.length ? new Set(loc.columns) : null;
        const groups = loc.groups && loc.groups.length ? new Set(loc.groups) : null;
        const spanners = loc.spanners && loc.spanners.length ? new Set(loc.spanners) : null;

        let rowSet = null;
        let rowsByCol = null;
        if (loc.rows && loc.rows.mode === 'index' && loc.rows.indices.length) {
          rowSet = new Set(loc.rows.indices);
        } else if (loc.rows && loc.rows.mode === 'expr' && loc.rows.expr) {
          // An expression naming a neighbouring cell is evaluated per column,
          // so it needs to know which columns this location covers — blank
          // means every body column, as it does everywhere else.
          const result = StyleRules.evalRowExpr(loc.rows.expr,
            Object.assign({}, ctx, { targetColumns: loc.columns || [] }));
          rowSet = result.rows;
          rowsByCol = result.rowsByCol || null;
          // The first failure is the one reported; naming the rule is what
          // makes the warning actionable when several are in play.
          if (result.error && !error) {
            error = (rule.label ? '“' + rule.label + '” — ' : '') + result.error;
          }
        }

        return {
          part: loc.part,
          columns: columns,
          groups: groups,
          spanners: spanners,
          rows: rowSet,
          rowsByCol: rowsByCol
        };
      });

      out.push({ id: rule.id, locations: locations, style: rule.style });
    }

    return { rules: out, error: error };
  },

  /**
   * Evaluate a row predicate against every working row, returning the set of
   * matching source indices.
   *
   * The expression is compiled with `new Function` and the row's columns in
   * scope, so `pop > 1e6 && region != "NT"` works. This is a local, offline
   * tool driven entirely by its own user — there is no untrusted input to
   * sandbox against — but it is still wrapped so a typo cannot break rendering.
   *
   * Pure: the failure comes back with the result rather than being left
   * somewhere for a later caller to find. See `compile`.
   *
   * **Two shapes come back.** A plain expression is a fact about a row, so it
   * returns `rows` — one set of source indices for the whole location. One
   * naming a neighbouring cell (`above()`, `left()`, …) is a fact about a
   * *cell*: the same expression is true in one column and false in the next, so
   * it returns `rowsByCol`, a set per column. `resolve` reads whichever it got.
   *
   * **`row` and `n` are about the table as it is drawn**, not about the file:
   * `row` is the 0-based position a reader could count to and `n` the number
   * of rows they can see, both after the filter and the sort. That is the same
   * order `above()` and `below()` step through, and the same order
   * `dplyr::arrange()` leaves the exported data in — so `export-rgt.js` can
   * write `row` as `seq_along(<column>) - 1` and mean it. Read as source
   * indices they were a fact about the file that gt has no way to ask for, and
   * a sort made the preview and the R disagree without either being wrong on
   * its own terms.
   *
   * @param {Object} ctx {rows, columnsById} for the plain case; also
   *   {sequence, count, bodyColumns, targetColumns} — `sequence` is
   *   `[{row, srcIndex}]` in displayed order, `count` the number of rows drawn
   *   before any preview truncation, `bodyColumns` the body column ids in
   *   displayed order, `targetColumns` the ones this location covers.
   * @returns {{rows: ?Set, rowsByCol: ?Object, error: ?string}}
   */
  evalRowExpr(expr, ctx) {
    const rows = (ctx && ctx.rows) || [];
    const set = new Set();

    // Only columns whose id is a usable JS identifier can be put in scope by
    // name. A CSV header of "2024" slugs to "2024", which is not one — those
    // stay reachable through `v['2024']`.
    const columnIds = Object.keys((ctx && ctx.columnsById) || {}).filter(StyleRules.bareName);
    if (!Object.keys((ctx && ctx.columnsById) || {}).length) return { rows: set, error: null };

    let fn;
    try {
      // eslint-disable-next-line no-new-func
      fn = new Function('v', 'row', 'n', 'self', 'above', 'below', 'left', 'right',
        (columnIds.length ? 'var ' + columnIds.map((id) => id + ' = v.' + id).join(', ') + ';' : '') +
        'return (' + expr + ');');
    } catch (err) {
      return { rows: set, error: 'Syntax error: ' + err.message };
    }

    // Values are handed over pre-coerced: numeric columns as numbers so that
    // `>` behaves, everything else as its string.
    const allIds = Object.keys(ctx.columnsById);
    const valueOf = (rowData, id) => {
      if (!rowData || !ctx.columnsById[id]) return undefined;
      const raw = rowData[id];
      return ctx.columnsById[id].type === 'number' ? Util.toNumber(raw) : raw;
    };
    const scopeFor = (rowData) => {
      const scope = {};
      for (const id of allIds) scope[id] = valueOf(rowData, id);
      return scope;
    };
    const none = () => undefined;

    // The displayed sequence, not the source order: "the row above" is the one
    // above it on the page, and `dplyr::arrange()` puts the exported data in
    // that same order so the R agrees. A row the filter removed is not in the
    // sequence and so is neither tested nor available as a neighbour, which is
    // right — it is not on the page to be next to anything. `ctx.rows` is
    // indexed by `srcIndex` and carries a placeholder where a filtered row
    // used to be, which is why it is not what gets walked.
    const sequence = (ctx.sequence || rows.map((row, i) => ({ row: row, srcIndex: i })));
    // Not `sequence.length`: the preview stops at `Compute.MAX_PREVIEW_ROWS`
    // and the export does not, so counting the sequence would make `n` mean
    // one thing on screen and another in the file that leaves the app.
    const count = ctx.count === undefined ? sequence.length : ctx.count;

    if (!StyleRules.usesCellRefs(expr)) {
      for (let p = 0; p < sequence.length; p += 1) {
        try {
          if (fn(scopeFor(sequence[p].row), p, count, none, none, none, none, none)) {
            set.add(sequence[p].srcIndex);
          }
        } catch (err) {
          return { rows: set, error: 'Evaluation error: ' + err.message };
        }
      }
      return { rows: set, error: null };
    }

    /* ---- Per cell, because the answer depends on which column is asked ---- */

    const bodyColumns = ctx.bodyColumns || allIds;
    const targets = (ctx.targetColumns && ctx.targetColumns.length) ? ctx.targetColumns : bodyColumns;

    const rowsByCol = {};
    for (const colId of targets) {
      const columnIndex = bodyColumns.indexOf(colId);
      const hits = new Set();

      for (let p = 0; p < sequence.length; p += 1) {
        const at = (offset) => (sequence[p + offset] ? sequence[p + offset].row : null);
        const sideways = (offset) => {
          if (columnIndex < 0) return undefined;
          const neighbour = bodyColumns[columnIndex + offset];
          return neighbour === undefined ? undefined : valueOf(sequence[p].row, neighbour);
        };
        const step = (k) => (k === undefined ? 1 : Math.trunc(Number(k)));

        try {
          const hit = fn(
            scopeFor(sequence[p].row), p, count,
            () => valueOf(sequence[p].row, colId),
            (k) => valueOf(at(-step(k)), colId),
            (k) => valueOf(at(step(k)), colId),
            (k) => sideways(-step(k)),
            (k) => sideways(step(k))
          );
          if (hit) hits.add(sequence[p].srcIndex);
        } catch (err) {
          return { rows: set, rowsByCol: null, error: 'Evaluation error: ' + err.message };
        }
      }

      rowsByCol[colId] = hits;
    }

    return { rows: null, rowsByCol: rowsByCol, error: null };
  },

  /* ---------- Matching ---------- */

  /**
   * Resolve the style for one target by merging every matching rule in order.
   *
   * @param {Array} compiled - output of compile()
   * @param {Object} target - {part, colId, srcIndex, groupId, spannerId}
   * @returns {Object|null} merged style, or null when nothing matched
   */
  resolve(compiled, target) {
    let merged = null;

    for (const rule of compiled) {
      let hit = false;
      for (const loc of rule.locations) {
        if (loc.part !== target.part) continue;
        if (loc.columns && (!target.colId || !loc.columns.has(target.colId))) continue;
        // A per-column row set: the expression named a neighbouring cell, so
        // whether it holds depends on which column is being asked about.
        if (loc.rowsByCol) {
          const set = loc.rowsByCol[target.colId];
          if (!set || target.srcIndex === undefined || !set.has(target.srcIndex)) continue;
        } else if (loc.rows && (target.srcIndex === undefined || !loc.rows.has(target.srcIndex))) continue;
        if (loc.groups && (!target.groupId || !loc.groups.has(target.groupId))) continue;
        if (loc.spanners && (!target.spannerId || !loc.spanners.has(target.spannerId))) continue;
        hit = true;
        break;
      }
      if (!hit) continue;
      merged = StyleRules.merge(merged, rule.style, rule.id);
    }

    return merged;
  },

  /**
   * Merge `next` over `base`, one property at a time. Returns a new object.
   *
   * `ruleId` is stamped onto each border side the rule sets, so a line can
   * later name the rule that drew it. It is recorded here, at the moment the
   * rule wins the side, rather than re-derived by matching again afterwards —
   * a second producer of the same fact is exactly how this codebase's
   * recurring bug class starts. Only sides a rule actually sets are stamped,
   * so a text-only rule is never credited with an edge.
   */
  merge(base, next, ruleId) {
    const out = {
      text: Object.assign({}, base && base.text),
      fill: Object.assign({}, base && base.fill),
      borders: Object.assign({}, base && base.borders)
    };


    if (next.text) {
      for (const key in next.text) {
        if (next.text[key]) out.text[key] = next.text[key];
      }
    }
    if (next.fill && next.fill.color) {
      out.fill = Object.assign({}, next.fill);
    }
    if (next.borders) {
      for (const side of StyleRules.SIDES) {
        const border = next.borders[side];
        if (border && border.style) {
          // The id rides on the copy `merge` was already making, so recording
          // which rule won a side costs no extra allocation. `resolve` runs
          // about 8,000 times on a full-size preview; a second object per
          // merge was measurably worse.
          out.borders[side] = Object.assign({}, border, { ruleId: ruleId });
        }
      }
    }

    return out;
  },

  /* ---------- Output ---------- */

  /**
   * Turn a resolved style into CSS declarations.
   * @returns {Object} property -> value, ready for Object.assign onto a style
   */
  toCss(style) {
    const css = {};
    if (!style) return css;

    const text = style.text || {};
    if (text.color) css.color = text.color;
    if (text.font) css.fontFamily = OptionsSchema.fontStack(text.font);
    if (text.size) css.fontSize = Util.cssLength(text.size);
    if (text.weight) css.fontWeight = text.weight;
    if (text.style) css.fontStyle = text.style;
    if (text.align) css.textAlign = text.align;
    if (text.vAlign) css.verticalAlign = text.vAlign;
    if (text.transform) css.textTransform = text.transform;
    if (text.decorate && text.decorate !== 'none') css.textDecoration = text.decorate;
    // No longer offered by the editor; still read, for the fonts that answer
    // it. See TEXT_PROPS.
    if (text.stretch) css.fontStretch = text.stretch;
    if (text.whitespace) css.whiteSpace = text.whitespace;
    if (text.indent) css.paddingLeft = Util.cssLength(text.indent);

    if (style.fill && style.fill.color) {
      css.backgroundColor = style.fill.alpha !== undefined && style.fill.alpha !== null &&
        style.fill.alpha < 1
        ? Palettes.withAlpha(style.fill.color, style.fill.alpha)
        : style.fill.color;
    }

    return css;
  },

  /**
   * The borders a resolved style contributes, as {side: {style, width, color}}.
   * Kept separate from toCss() because borders go through the edge grid rather
   * than straight onto the cell.
   */
  toBorders(style) {
    if (!style || !style.borders) return null;
    let any = false;
    const out = {};
    for (const side of StyleRules.SIDES) {
      const border = style.borders[side];
      if (border && border.style) {
        out[side] = {
          style: border.style,
          width: Util.cssLength(border.width, '1px'),
          color: border.color || '#000000'
        };
        any = true;
      }
    }
    return any ? out : null;
  },

  /** Build a rule that applies `style` to a concrete selection. */
  /**
   * @param {Array} selection
   * @param {Object} style
   * @param {string} label
   * @param {Array<number>} [dataRows] - every data row on screen, so a
   *   selection covering all of them can be written as "all rows" rather than
   *   frozen into the row numbers that happened to be visible.
   */
  fromSelection(selection, style, label, dataRows) {
    const rule = StyleRules.emptyRule(label);
    rule.style = style;
    rule.locations = selection.map((sel) => {
      const loc = StyleRules.emptyLocation(sel.part);
      if (sel.colId) loc.columns = [sel.colId];
      if (sel.srcIndex !== undefined && sel.srcIndex !== null) {
        loc.rows = { mode: 'index', indices: [sel.srcIndex], expr: '' };
      }
      if (sel.groupId) loc.groups = [sel.groupId];
      if (sel.spannerId) loc.spanners = [sel.spannerId];
      return loc;
    });
    return StyleRules.coalesce(rule, dataRows);
  },

  /**
   * The location for a quick body-scoped rule: a whole column, one row, or the
   * rows a `where` expression matches.
   *
   * Body only, deliberately. A column rule does not reach the column heading
   * and a row rule does not reach the row label, which is what
   * `cells_body(columns=)` and `cells_body(rows=)` mean in gt — the heading and
   * the stub are their own parts and are styled as such.
   *
   * @param {Object} scope - {kind:'column', colId} | {kind:'row', srcIndex}
   *   | {kind:'where', expr}
   */
  bodyScope(scope) {
    const loc = StyleRules.emptyLocation('body');
    if (!scope) return loc;

    if (scope.kind === 'column') {
      loc.columns = [scope.colId];
      loc.rows = { mode: 'all', indices: [], expr: '' };
    } else if (scope.kind === 'row') {
      loc.rows = { mode: 'index', indices: [scope.srcIndex], expr: '' };
    } else if (scope.kind === 'where') {
      loc.rows = { mode: 'expr', indices: [], expr: scope.expr || '' };
    }
    return loc;
  },

  /**
   * A row expression that matches the clicked cell's own value, as a starting
   * point for one the user then edits.
   *
   * `==` rather than a guessed `>=`: the operator and any round number are the
   * user's intent, not something a click can know, and an expression that is
   * exactly true of what was clicked is the one honest seed. It is not
   * necessarily unique to that row — which is why the button says how many
   * rows it currently matches.
   *
   * Falls back to `v['id']` when the column id is not a usable identifier,
   * matching what `evalRowExpr` actually puts in scope.
   */
  seedExpr(colId, value, type) {
    const ref = StyleRules.ref(colId);

    if (value === null || value === undefined || value === '') return ref + " == ''";
    if (type === 'number') {
      const n = Util.toNumber(value);
      if (n !== null && isFinite(n)) return ref + ' == ' + n;
    }
    return ref + ' == ' + JSON.stringify(String(value));
  },

  /**
   * Explicit row indices, or `all` when they cover every data row.
   *
   * A rule pinned to indices means "these particular rows": it will not cover
   * rows added by a later import, and when the preview is truncated it would
   * describe only the rows that happened to be on screen while the export
   * carries every one. A selection spanning the whole column meant the column.
   */
  rowsFor(indices, dataRows) {
    const sorted = indices.slice().sort((a, b) => a - b);
    if (dataRows && dataRows.length && sorted.length === dataRows.length) {
      const have = new Set(sorted);
      if (dataRows.every((i) => have.has(i))) {
        return { mode: 'all', indices: [], expr: '' };
      }
    }
    return { mode: 'index', indices: sorted, expr: '' };
  },

  /**
   * Collapse a rule's locations so a 40-cell selection becomes a handful of
   * locations rather than 40. Locations for the same part that differ only in
   * column or only in row are merged.
   */
  coalesce(rule, dataRows) {
    const byPart = Util.groupBy(rule.locations, (loc) => loc.part);
    const locations = [];

    for (const [part, locs] of byPart) {
      const columns = Util.unique(locs.reduce((acc, l) => acc.concat(l.columns || []), []));
      const groups = Util.unique(locs.reduce((acc, l) => acc.concat(l.groups || []), []));
      const spanners = Util.unique(locs.reduce((acc, l) => acc.concat(l.spanners || []), []));
      const indices = Util.unique(locs.reduce((acc, l) => acc.concat(
        l.rows && l.rows.mode === 'index' ? l.rows.indices : []), []));

      // Only safe to merge into one location when the selection is a full
      // rectangle: every column present for every row. Otherwise keep the
      // per-cell locations so we do not over-apply the style.
      const isRectangle = !columns.length || !indices.length ||
        locs.length === columns.length * indices.length;

      if (isRectangle) {
        const loc = StyleRules.emptyLocation(part);
        loc.columns = columns;
        loc.groups = groups;
        loc.spanners = spanners;
        if (indices.length) loc.rows = StyleRules.rowsFor(indices, dataRows);
        locations.push(loc);
      } else {
        locations.push.apply(locations, locs);
      }
    }

    rule.locations = locations;
    return rule;
  }
};
