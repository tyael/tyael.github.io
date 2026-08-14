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
    { id: 'column_labels', label: 'Column labels', gt: 'cells_column_labels', columns: true, rows: false, optionGroup: 'column_labels' },
    { id: 'column_spanners', label: 'Column groups', gt: 'cells_column_spanners', columns: false, rows: false, spanners: true, optionGroup: 'column_labels' },
    { id: 'stubhead', label: 'Row-label header', gt: 'cells_stubhead', columns: false, rows: false, optionGroup: 'column_labels' },
    { id: 'row_groups', label: 'Row group labels', gt: 'cells_row_groups', columns: false, rows: false, groups: true, optionGroup: 'row_group' },
    { id: 'summary', label: 'Summary rows', gt: 'cells_summary', columns: true, rows: false, groups: true, optionGroup: 'summary_row' },
    { id: 'grand_summary', label: 'Grand summary', gt: 'cells_grand_summary', columns: true, rows: false, optionGroup: 'summary_row' },
    { id: 'title', label: 'Title', gt: 'cells_title(groups = "title")', columns: false, rows: false, optionGroup: 'heading' },
    { id: 'subtitle', label: 'Subtitle', gt: 'cells_title(groups = "subtitle")', columns: false, rows: false, optionGroup: 'heading' },
    { id: 'footnotes', label: 'Footnotes', gt: 'cells_footnotes', columns: false, rows: false, optionGroup: 'footnotes' },
    { id: 'source_notes', label: 'Source notes', gt: 'cells_source_notes', columns: false, rows: false, optionGroup: 'source_notes' }
  ],

  /** Text properties a rule can set, mirroring gt's `cell_text()`. */
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
    { key: 'stretch', label: 'Stretch', type: 'select',
      enum: ['normal', 'condensed', 'semi-condensed', 'extra-condensed', 'expanded', 'semi-expanded'] },
    { key: 'whitespace', label: 'Whitespace', type: 'select', enum: ['normal', 'nowrap', 'pre', 'pre-wrap'] },
    { key: 'indent', label: 'Indent', type: 'len' }
  ],

  SIDES: ['top', 'right', 'bottom', 'left'],

  /** Words that cannot become a `var` in a compiled row expression. */
  RESERVED: ['var', 'let', 'const', 'if', 'else', 'for', 'while', 'do', 'function',
    'return', 'new', 'this', 'typeof', 'instanceof', 'in', 'of', 'class', 'null',
    'true', 'false', 'undefined', 'NaN', 'Infinity', 'v', 'row', 'n', 'Math', 'String',
    'Number', 'Boolean', 'Array', 'Object', 'Date', 'RegExp', 'JSON'],

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
    const noBorders = !style.borders || StyleRules.SIDES.every((s) => {
      const b = style.borders[s];
      return !b || !b.style || b.style === 'none';
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
   * @param {Array} rules - spec.styleRules
   * @param {Object} ctx  - {rows, columnsById} the working data, for row expressions
   * @returns {Array} compiled rules, in application order
   */
  compile(rules, ctx) {
    const out = [];

    for (const rule of rules) {
      if (!rule.enabled || StyleRules.isEmptyStyle(rule.style)) continue;

      const locations = rule.locations.map((loc) => {
        const columns = loc.columns && loc.columns.length ? new Set(loc.columns) : null;
        const groups = loc.groups && loc.groups.length ? new Set(loc.groups) : null;
        const spanners = loc.spanners && loc.spanners.length ? new Set(loc.spanners) : null;

        let rowSet = null;
        if (loc.rows && loc.rows.mode === 'index' && loc.rows.indices.length) {
          rowSet = new Set(loc.rows.indices);
        } else if (loc.rows && loc.rows.mode === 'expr' && loc.rows.expr) {
          rowSet = StyleRules.evalRowExpr(loc.rows.expr, ctx);
        }

        return {
          part: loc.part,
          columns: columns,
          groups: groups,
          spanners: spanners,
          rows: rowSet
        };
      });

      out.push({ id: rule.id, locations: locations, style: rule.style });
    }

    return out;
  },

  /**
   * Evaluate a row predicate against every working row, returning the set of
   * matching source indices.
   *
   * The expression is compiled with `new Function` and the row's columns in
   * scope, so `pop > 1e6 && region != "NT"` works. This is a local, offline
   * tool driven entirely by its own user — there is no untrusted input to
   * sandbox against — but it is still wrapped so a typo cannot break rendering.
   */
  evalRowExpr(expr, ctx) {
    const rows = (ctx && ctx.rows) || [];
    const set = new Set();

    // Only columns whose id is a usable JS identifier can be put in scope by
    // name. A CSV header of "2024" slugs to "2024", which is not one — those
    // stay reachable through `v['2024']`.
    const columnIds = Object.keys((ctx && ctx.columnsById) || {})
      .filter((id) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(id) && StyleRules.RESERVED.indexOf(id) < 0);
    if (!Object.keys((ctx && ctx.columnsById) || {}).length) return set;

    let fn;
    try {
      // eslint-disable-next-line no-new-func
      fn = new Function('v', 'row', 'n',
        (columnIds.length ? 'var ' + columnIds.map((id) => id + ' = v.' + id).join(', ') + ';' : '') +
        'return (' + expr + ');');
    } catch (err) {
      StyleRules._exprError = 'Syntax error: ' + err.message;
      return set;
    }

    // Values are handed over pre-coerced: numeric columns as numbers so that
    // `>` behaves, everything else as its string.
    const allIds = Object.keys(ctx.columnsById);
    for (let i = 0; i < rows.length; i += 1) {
      const scope = {};
      for (const id of allIds) {
        const raw = rows[i][id];
        const col = ctx.columnsById[id];
        scope[id] = col && col.type === 'number' ? Util.toNumber(raw) : raw;
      }
      try {
        if (fn(scope, i, rows.length)) set.add(i);
      } catch (err) {
        StyleRules._exprError = 'Evaluation error: ' + err.message;
        return set;
      }
    }

    StyleRules._exprError = null;
    return set;
  },

  /** The last row-expression error, for the panel to surface. */
  lastExprError() {
    return StyleRules._exprError || null;
  },

  _exprError: null,

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
        if (loc.rows && (target.srcIndex === undefined || !loc.rows.has(target.srcIndex))) continue;
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
