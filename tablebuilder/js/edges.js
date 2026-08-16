/**
 * edges.js
 *
 * The explicit border grid.
 *
 * Borders are the one thing that cannot be recovered from the rendered DOM:
 * `getComputedStyle` reports the *specified* border, not the one
 * `border-collapse: collapse` actually painted, so an SVG exporter reading the
 * DOM would guess wrong on every shared edge. Instead the whole table is
 * modelled as a grid of lines up front:
 *
 *   h[r][c]  the horizontal edge directly above grid row r, in column c
 *   v[r][c]  the vertical edge directly left of column c, in grid row r
 *
 * Each edge is resolved once, from the options and the style rules, with a
 * documented precedence. The HTML renderer then draws with
 * `border-collapse: separate` and a strict ownership rule — every cell paints
 * its own top and left, the last row and column paint the outer two — so no
 * edge is ever painted twice. The SVG renderer draws the same h/v arrays as
 * line segments. They cannot disagree, because they are the same numbers.
 */

const Edges = {

  /** Higher wins when two sources claim the same edge. */
  PRIORITY: { line: 1, structural: 2, rule: 3 },

  /** Tie-break between equal-priority, equal-width edges. */
  STYLE_RANK: { none: 0, hidden: 0, dotted: 1, dashed: 2, solid: 3, double: 4 },

  /**
   * Build the grid.
   * @param {Object} model - a ResolvedModel from compute.js
   * @returns {Object} {gridRows, nRows, nCols, h, v}
   */
  build(model) {
    const opt = model.options;
    const nCols = model.cols.length;
    const gridRows = Edges.gridRows(model);
    const nRows = gridRows.length;

    // h has one more row than the grid; v has one more column.
    const h = [];
    for (let r = 0; r <= nRows; r += 1) h.push(new Array(nCols).fill(null));
    const v = [];
    for (let r = 0; r < nRows; r += 1) v.push(new Array(nCols + 1).fill(null));

    // Provenance runs alongside the drawing grid, written by the same setters,
    // so there is exactly one precedence path. Recomputing it separately would
    // recreate the two-producers-disagreeing bug class this codebase keeps
    // paying for.
    const hSrc = [];
    for (let r = 0; r <= nRows; r += 1) hSrc.push(new Array(nCols).fill(null));
    const vSrc = [];
    for (let r = 0; r < nRows; r += 1) vSrc.push(new Array(nCols + 1).fill(null));

    const grid = {
      gridRows: gridRows, nRows: nRows, nCols: nCols,
      h: h, v: v, hSrc: hSrc, vSrc: vSrc
    };

    Edges.applyStructural(grid, model, opt);
    Edges.applyLines(grid, model, opt);
    Edges.applyRules(grid, model);

    return grid;
  },

  /**
   * Flatten the model into the sequence of grid rows, in visual order.
   * Every renderer walks this same list, so row indices always line up.
   */
  gridRows(model) {
    const rows = [];
    const opt = model.options;

    if (model.title) rows.push({ kind: 'title', full: true });
    if (model.subtitle) rows.push({ kind: 'subtitle', full: true });

    if (model.header.show) {
      model.header.levels.forEach((level, i) => {
        rows.push({
          kind: level.level === 0 ? 'column_labels' : 'spanner',
          level: level.level,
          levelIndex: i,
          isFirstHeader: i === 0,
          isLastHeader: i === model.header.levels.length - 1,
          ref: level
        });
      });
    }

    model.rows.forEach((row, i) => {
      rows.push({
        kind: row.kind,          // 'group' | 'data' | 'summary' | 'grand'
        bodyIndex: i,
        ref: row,
        full: row.kind === 'group'
      });
    });

    const notes = model.footnotes || [];
    if (notes.length) {
      if (opt['footnotes.multiline']) {
        notes.forEach((note, i) => rows.push({ kind: 'footnote', full: true, noteIndex: i, ref: note }));
      } else {
        rows.push({ kind: 'footnote', full: true, noteIndex: 0, all: true });
      }
    }

    const sources = model.sourceNotes || [];
    if (sources.length) {
      if (opt['source_notes.multiline']) {
        sources.forEach((note, i) => rows.push({ kind: 'source_note', full: true, noteIndex: i, ref: note }));
      } else {
        rows.push({ kind: 'source_note', full: true, noteIndex: 0, all: true });
      }
    }

    return rows;
  },

  /* ================================================================
     Sources
     ================================================================ */

  /**
   * Structural boundaries: the rules that separate one part of the table from
   * another. These are what carry a booktabs look.
   */
  applyStructural(grid, model, opt) {
    const rows = grid.gridRows;
    const nCols = grid.nCols;
    const all = { from: 0, to: nCols };

    const firstIndexOf = (pred) => rows.findIndex(pred);
    const lastIndexOf = (pred) => {
      for (let i = rows.length - 1; i >= 0; i -= 1) if (pred(rows[i])) return i;
      return -1;
    };

    const isHeader = (r) => r.kind === 'spanner' || r.kind === 'column_labels';
    const isBody = (r) => r.kind === 'data' || r.kind === 'group' ||
      r.kind === 'summary' || r.kind === 'grand';
    const isFooter = (r) => r.kind === 'footnote' || r.kind === 'source_note';

    /* ---- Heading ---- */

    const firstHeader = firstIndexOf(isHeader);
    const firstBody = firstIndexOf(isBody);
    const headingEnd = firstHeader >= 0 ? firstHeader : firstBody;

    if ((model.title || model.subtitle) && headingEnd > 0) {
      Edges.setH(grid, headingEnd, all, Edges.edge(opt, 'heading.border.bottom', 'structural'));
    }

    /* ---- Column labels ---- */

    if (firstHeader >= 0) {
      Edges.setH(grid, firstHeader, all, Edges.edge(opt, 'column_labels.border.top', 'structural'));

      const lastHeader = lastIndexOf(isHeader);
      Edges.setH(grid, lastHeader + 1, all, Edges.edge(opt, 'column_labels.border.bottom', 'structural'));

      // Spanner underlines: the rule sits only under the columns a spanner
      // actually covers, which is what makes nested headers readable.
      if (opt['column_labels.spanner.underline']) {
        const spannerEdge = Edges.edge(opt, 'column_labels.spanner.border.bottom', 'structural');
        for (let i = 0; i < rows.length; i += 1) {
          if (rows[i].kind !== 'spanner') continue;
          for (const cell of rows[i].ref.cells) {
            if (cell.kind !== 'spanner') continue;
            const range = Edges.rangeOfCell(model, cell);
            if (range) Edges.setH(grid, i + 1, range, spannerEdge);
          }
        }
      }
    }

    /* ---- Body ---- */

    if (firstBody >= 0) {
      Edges.setH(grid, firstBody, all, Edges.edge(opt, 'table_body.border.top', 'structural'));

      const lastBody = lastIndexOf(isBody);
      Edges.setH(grid, lastBody + 1, all, Edges.edge(opt, 'table_body.border.bottom', 'structural'));

      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        if (row.kind === 'group') {
          Edges.setH(grid, i, all, Edges.edge(opt, 'row_group.border.top', 'structural'));
          Edges.setH(grid, i + 1, all, Edges.edge(opt, 'row_group.border.bottom', 'structural'));
        } else if (row.kind === 'summary') {
          // gt draws the summary rule above the block, not between its rows.
          const previous = rows[i - 1];
          if (!previous || previous.kind !== 'summary') {
            Edges.setH(grid, i, all, Edges.edge(opt, 'summary_row.border', 'structural'));
          }
        } else if (row.kind === 'grand') {
          const previous = rows[i - 1];
          if (!previous || previous.kind !== 'grand') {
            Edges.setH(grid, i, all, Edges.edge(opt, 'grand_summary_row.border', 'structural'));
          }
        }
      }
    }

    /* ---- Footer ---- */

    const firstFooter = firstIndexOf(isFooter);
    if (firstFooter >= 0) {
      const lastNote = lastIndexOf((r) => r.kind === 'footnote');
      if (lastNote >= 0) {
        Edges.setH(grid, lastNote + 1, all, Edges.edge(opt, 'footnotes.border.bottom', 'structural'));
      }
      const lastSource = lastIndexOf((r) => r.kind === 'source_note');
      if (lastSource >= 0) {
        Edges.setH(grid, lastSource + 1, all, Edges.edge(opt, 'source_notes.border.bottom', 'structural'));
      }
    }

    /* ---- The outermost top and bottom ---- */

    // Through the grid, like everything else. Painted on the element they were
    // a *second* mechanism: the table's bottom border and the body's bottom
    // border both drew, one on the element and one on the cells, and stacked
    // into a line twice as thick instead of one winning. Here they resolve
    // against every other claim on the same edge by the ordinary rules.
    Edges.setH(grid, 0, all, Edges.edge(opt, 'table.border.top', 'structural'));
    Edges.setH(grid, grid.nRows, all, Edges.edge(opt, 'table.border.bottom', 'structural'));

    /* ---- Left and right edges, per band ---- */

    // A top or bottom edge belongs to one place: the table has one of each.
    // The sides run the whole height and therefore pass through the heading,
    // the labels, the body and the footer — so they are drawn per band rather
    // than as one border around the element, and each band can say whether it
    // is enclosed.
    //
    // This is what `heading.border.lr`, `column_labels.border.lr`,
    // `footnotes.border.lr` and `source_notes.border.lr` are for. They have
    // been in the schema and in the Options panel since the beginning and drew
    // nothing at all.
    const sides = {
      table: [Edges.edge(opt, 'table.border.left', 'structural'),
        Edges.edge(opt, 'table.border.right', 'structural')],
      heading: [Edges.edge(opt, 'heading.border.lr', 'structural'),
        Edges.edge(opt, 'heading.border.lr', 'structural')],
      labels: [Edges.edge(opt, 'column_labels.border.lr', 'structural'),
        Edges.edge(opt, 'column_labels.border.lr', 'structural')],
      footnote: [Edges.edge(opt, 'footnotes.border.lr', 'structural'),
        Edges.edge(opt, 'footnotes.border.lr', 'structural')],
      source: [Edges.edge(opt, 'source_notes.border.lr', 'structural'),
        Edges.edge(opt, 'source_notes.border.lr', 'structural')]
    };

    for (let r = 0; r < grid.nRows; r += 1) {
      const row = rows[r];
      const bands = [];

      // The table's own sides enclose the table proper — the column labels and
      // the body. The heading and the footer are their own blocks above and
      // below it, which is the arrangement the `.lr` options describe.
      if (isHeader(row) || isBody(row)) bands.push(sides.table);
      if (isHeader(row)) bands.push(sides.labels);
      if (row.kind === 'title' || row.kind === 'subtitle') bands.push(sides.heading);
      if (row.kind === 'footnote') bands.push(sides.footnote);
      if (row.kind === 'source_note') bands.push(sides.source);

      for (const band of bands) {
        Edges.setV(grid, r, 0, band[0]);
        Edges.setV(grid, r, nCols, band[1]);
      }
    }

    /* ---- The stub's right-hand rule ---- */

    const stubIndex = model.cols.findIndex((c) => c.kind === 'stub');
    if (stubIndex >= 0) {
      const edge = Edges.edge(opt, 'stub.border', 'structural');
      for (let r = 0; r < grid.nRows; r += 1) {
        if (rows[r].full) continue;   // heading, group and footer rows span across it
        Edges.setV(grid, r, stubIndex + 1, edge);
      }
    }

    const groupIndex = model.cols.findIndex((c) => c.kind === 'group');
    if (groupIndex >= 0) {
      const edge = Edges.edge(opt, 'stub_row_group.border', 'structural');
      for (let r = 0; r < grid.nRows; r += 1) {
        if (rows[r].full) continue;
        Edges.setV(grid, r, groupIndex + 1, edge);
      }
    }
  },

  /** The repeating interior rules: body hlines/vlines and header vlines. */
  applyLines(grid, model, opt) {
    const rows = grid.gridRows;
    const nCols = grid.nCols;
    const all = { from: 0, to: nCols };

    const hline = Edges.edge(opt, 'table_body.hlines', 'line');
    const vlineBody = Edges.edge(opt, 'table_body.vlines', 'line');
    const vlineHead = Edges.edge(opt, 'column_labels.vlines', 'line');

    for (let r = 0; r < grid.nRows; r += 1) {
      const row = rows[r];
      const previous = rows[r - 1];

      if (row.kind === 'data' && previous &&
          (previous.kind === 'data' || previous.kind === 'group')) {
        Edges.setH(grid, r, all, hline);
      }

      if (row.full) continue;

      const vline = (row.kind === 'spanner' || row.kind === 'column_labels') ? vlineHead : vlineBody;
      for (let c = 1; c < nCols; c += 1) Edges.setV(grid, r, c, vline);
    }
  },

  /** Borders set by style rules — these outrank everything else. */
  applyRules(grid, model) {
    const rows = grid.gridRows;

    for (let r = 0; r < grid.nRows; r += 1) {
      const row = rows[r];
      if (!row.ref) continue;

      const isHeader = row.kind === 'spanner' || row.kind === 'column_labels';
      const cells = row.ref.cells || [];

      let c = 0;
      for (const cell of cells) {
        // Header cells know their own grid column (the label row is not
        // contiguous); body cells sit one per column, in order.
        if (isHeader) c = cell.gridCol;
        const span = cell.span || 1;
        const borders = StyleRules.toBorders(cell.style);
        const range = { from: c, to: c + span };

        if (borders) {
          const rowspan = cell.rowspan === undefined ? 1 : Math.max(1, cell.rowspan);
          if (borders.top) Edges.setH(grid, r, range, Edges.fromBorder(borders.top, 'rule', Edges.ruleForSide(cell.style, 'top')));
          if (borders.bottom) Edges.setH(grid, r + rowspan, range, Edges.fromBorder(borders.bottom, 'rule', Edges.ruleForSide(cell.style, 'bottom')));
          for (let rr = r; rr < Math.min(grid.nRows, r + rowspan); rr += 1) {
            if (borders.left) Edges.setV(grid, rr, c, Edges.fromBorder(borders.left, 'rule', Edges.ruleForSide(cell.style, 'left')));
            if (borders.right) Edges.setV(grid, rr, c + span, Edges.fromBorder(borders.right, 'rule', Edges.ruleForSide(cell.style, 'right')));
          }
        }

        c += span;
      }

      // Style rules on the leading stub/group header cells, which live outside
      // the per-level `cells` list.
      if (isHeader && row.isFirstHeader) {
        for (const cell of model.header.lead) {
          const borders = StyleRules.toBorders(cell.style);
          if (!borders) continue;
          const i = cell.gridCol;
          const range = { from: i, to: i + 1 };
          if (borders.top) Edges.setH(grid, r, range, Edges.fromBorder(borders.top, 'rule', Edges.ruleForSide(cell.style, 'top')));
          if (borders.left) Edges.setV(grid, r, i, Edges.fromBorder(borders.left, 'rule', Edges.ruleForSide(cell.style, 'left')));
          if (borders.right) Edges.setV(grid, r, i + 1, Edges.fromBorder(borders.right, 'rule', Edges.ruleForSide(cell.style, 'right')));
        }
      }
    }
  },

  /* ================================================================
     Primitives
     ================================================================ */

  /**
   * One border option as an edge candidate.
   *
   * Always returns a record, even when the option draws nothing. That is what
   * lets the editor answer "why is there no line here?" — the candidate is
   * kept with `drawn: false` and the setters record it as provenance without
   * ever writing it into the drawing grid.
   */
  edge(opt, prefix, priority) {
    const style = opt[prefix + '.style'];
    const width = Util.cssNumber(opt[prefix + '.width']);
    const drawn = !!style && style !== 'none' && style !== 'hidden' && !!width;
    return {
      style: style || 'none',
      width: width || 0,
      color: opt[prefix + '.color'] || '#000000',
      priority: Edges.PRIORITY[priority] || 1,
      source: { kind: 'option', key: prefix },
      drawn: drawn
    };
  },

  /**
   * Convert a style rule's border object into an edge candidate.
   *
   * The rule cannot be named: `StyleRules.resolve` merges every matching rule
   * into one style object and discards which one contributed which property.
   * Naming it would need per-property provenance on `compute.js`'s hot path.
   */
  fromBorder(border, priority, ruleId) {
    if (!border) return null;
    const drawn = !!border.style && border.style !== 'none' && border.style !== 'hidden';
    return {
      style: border.style || 'none',
      width: drawn ? (Util.cssNumber(border.width) || 1) : 0,
      color: border.color || '#000000',
      priority: Edges.PRIORITY[priority] || 3,
      source: { kind: 'rule', ruleId: ruleId || null },
      drawn: drawn
    };
  },

  /**
   * The rule that set one side of a cell's border, or null.
   *
   * `StyleRules.merge` stamps this as it resolves the cascade, so this is a
   * lookup rather than a second round of matching.
   */
  ruleForSide(style, side) {
    const border = style && style.borders && style.borders[side];
    return (border && border.ruleId) || null;
  },

  /** The grid column range a header cell covers. */
  rangeOfCell(model, cell) {
    if (!cell.colIds || !cell.colIds.length) return null;
    const indexOf = (colId) => model.cols.findIndex((c) => c.kind === 'body' && c.colId === colId);
    const indices = cell.colIds.map(indexOf).filter((i) => i >= 0);
    if (!indices.length) return null;
    return { from: Math.min.apply(null, indices), to: Math.max.apply(null, indices) + 1 };
  },

  /** Write a horizontal edge, keeping the stronger one. */
  /**
   * Does this candidate take an existing line *off* the grid?
   *
   * Only a style rule can, and only over an option. A rule that says `none` is
   * the one way to remove a line from particular cells without switching the
   * option off for the whole table — before this, an undrawn candidate simply
   * never reached the grid, so the option's line stayed and the rule looked
   * like it had done nothing.
   */
  suppresses(current, edge) {
    return !!current && !edge.drawn &&
      edge.source.kind === 'rule' && current.source.kind !== 'rule';
  },

  setH(grid, r, range, edge) {
    if (!edge || r < 0 || r > grid.nRows) return;
    for (let c = Math.max(0, range.from); c < Math.min(grid.nCols, range.to); c += 1) {
      // Only drawn candidates reach the drawing grid, so `h` keeps its exact
      // meaning: null is "no line here". Provenance takes every candidate.
      if (edge.drawn) grid.h[r][c] = Edges.stronger(grid.h[r][c], edge);
      else if (Edges.suppresses(grid.h[r][c], edge)) grid.h[r][c] = null;
      grid.hSrc[r][c] = Edges.strongerSource(grid.hSrc[r][c], edge);
    }
  },

  /** Write a vertical edge, keeping the stronger one. */
  setV(grid, r, c, edge) {
    if (!edge || r < 0 || r >= grid.nRows || c < 0 || c > grid.nCols) return;
    if (edge.drawn) grid.v[r][c] = Edges.stronger(grid.v[r][c], edge);
    else if (Edges.suppresses(grid.v[r][c], edge)) grid.v[r][c] = null;
    grid.vSrc[r][c] = Edges.strongerSource(grid.vSrc[r][c], edge);
  },

  /**
   * Resolve a clash: higher priority wins, then the wider line, then the
   * heavier style. This is the whole border precedence, in one place.
   */
  stronger(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.priority !== b.priority) return a.priority > b.priority ? a : b;
    if (a.width !== b.width) return a.width > b.width ? a : b;
    const ra = Edges.STYLE_RANK[a.style] || 0;
    const rb = Edges.STYLE_RANK[b.style] || 0;
    return rb > ra ? b : a;
  },

  /**
   * The same clash, for provenance: a drawn candidate always beats an undrawn
   * one, two drawn ones resolve exactly as `stronger` does, and two undrawn
   * ones by priority.
   *
   * Every source ever beaten at this edge is kept on the winner as
   * `overrides` — an array, de-duplicated by source (an option's key, or
   * `'rule'` for a style rule, which cannot be told apart from one another
   * anyway), first-beaten first. An ordinary grouped table's header/body
   * boundary is not a two-source clash: column labels' bottom border, the
   * body's top border and the row group's top border all claim that row at
   * the same 'structural' priority, so `setH`/`setV` call `strongerSource`
   * three times over for the one cell. A single `overrides` slot kept only
   * whichever of the three was beaten most recently — the middle one was
   * beaten, then evicted from the record the moment a third arrived, so the
   * card silently dropped a real contributor instead of naming it. Carrying
   * both the winner's and the loser's own prior `overrides` forward (each
   * candidate is only ever a fresh, override-free record from `edge()` or
   * `fromBorder()`, or something this function already flattened) is what
   * keeps that history intact regardless of how many sources contest the
   * cell, while the de-dup keeps the list bounded by the number of distinct
   * sources rather than the number of calls.
   */
  strongerSource(a, b) {
    if (!a) return b;
    if (!b) return a;

    let winner;
    let loser;
    if (a.drawn !== b.drawn) {
      // A style rule wins whether or not it draws: "no border on these cells"
      // is as much a decision as a border is, and it is the only way to take a
      // line off a table without turning the option off everywhere. Between
      // two options the drawn one still wins — several options claim the
      // header/body boundary and the one asking for a line means it.
      const drawnOne = a.drawn ? a : b;
      const blankOne = a.drawn ? b : a;
      const suppresses = blankOne.source.kind === 'rule' && drawnOne.source.kind !== 'rule';
      winner = suppresses ? blankOne : drawnOne;
      loser = suppresses ? drawnOne : blankOne;
    } else if (a.drawn) {
      winner = Edges.stronger(a, b);
      loser = winner === a ? b : a;
    } else {
      winner = b.priority > a.priority ? b : a;
      loser = winner === a ? b : a;
    }

    const keyOf = (src) => (src.source.kind === 'rule' ? 'rule' : 'option:' + src.source.key);
    const winnerKey = keyOf(winner);

    const seen = new Set();
    const overrides = [];
    const add = (src) => {
      const key = keyOf(src);
      if (key === winnerKey || seen.has(key)) return;
      seen.add(key);
      const clean = Object.assign({}, src);
      delete clean.overrides;
      overrides.push(clean);
    };

    for (const src of (winner.overrides || [])) add(src);
    for (const src of (loser.overrides || [])) add(src);
    add(loser);

    return Object.assign({}, winner, { overrides: overrides });
  },

  /** An edge as a CSS `border-*` shorthand value. */
  toCss(edge) {
    if (!edge) return '0 none transparent';
    return edge.width + 'px ' + edge.style + ' ' + edge.color;
  },

  /**
   * The four border declarations for a cell, under the ownership rule: paint
   * your own top and left; the last row and column also paint the outer edges.
   *
   * @param {Object} grid
   * @param {number} r - grid row
   * @param {number} c - grid column (leftmost, for spanning cells)
   * @param {number} span
   * @param {number} rowspan
   */
  cssForCell(grid, r, c, span, rowspan) {
    const cols = Math.max(1, span || 1);
    const rowsSpanned = Math.max(1, rowspan || 1);

    // A spanning cell takes the strongest edge along the run it covers; the
    // interior edges it swallowed are not drawn by anyone.
    let top = null;
    for (let i = c; i < Math.min(grid.nCols, c + cols); i += 1) {
      top = Edges.stronger(top, grid.h[r] ? grid.h[r][i] : null);
    }
    let left = null;
    for (let i = r; i < Math.min(grid.nRows, r + rowsSpanned); i += 1) {
      left = Edges.stronger(left, grid.v[i] ? grid.v[i][c] : null);
    }

    const css = {
      borderTop: Edges.toCss(top),
      borderLeft: Edges.toCss(left),
      borderBottom: '0 none transparent',
      borderRight: '0 none transparent'
    };

    if (r + rowsSpanned >= grid.nRows) {
      let bottom = null;
      for (let i = c; i < Math.min(grid.nCols, c + cols); i += 1) {
        bottom = Edges.stronger(bottom, grid.h[grid.nRows] ? grid.h[grid.nRows][i] : null);
      }
      css.borderBottom = Edges.toCss(bottom);
    }

    if (c + cols >= grid.nCols) {
      let right = null;
      for (let i = r; i < Math.min(grid.nRows, r + rowsSpanned); i += 1) {
        right = Edges.stronger(right, grid.v[i] ? grid.v[i][grid.nCols] : null);
      }
      css.borderRight = Edges.toCss(right);
    }

    return css;
  },

  /**
   * Collapse the grid into drawable line segments, merging runs that share a
   * style. Used by the SVG exporter, which wants a handful of long lines rather
   * than one stroke per cell edge.
   *
   * @returns {{horizontal: Array, vertical: Array}} segments as
   *   {r, from, to, edge} / {c, from, to, edge} in grid coordinates
   */
  segments(grid) {
    const horizontal = [];
    const vertical = [];

    for (let r = 0; r <= grid.nRows; r += 1) {
      let start = -1;
      let current = null;
      for (let c = 0; c <= grid.nCols; c += 1) {
        const edge = c < grid.nCols ? grid.h[r][c] : null;
        const same = edge && current && edge.style === current.style &&
          edge.width === current.width && edge.color === current.color;
        if (!same) {
          if (current) horizontal.push({ r: r, from: start, to: c, edge: current });
          current = edge;
          start = c;
        }
      }
    }

    for (let c = 0; c <= grid.nCols; c += 1) {
      let start = -1;
      let current = null;
      for (let r = 0; r <= grid.nRows; r += 1) {
        const edge = r < grid.nRows ? grid.v[r][c] : null;
        const same = edge && current && edge.style === current.style &&
          edge.width === current.width && edge.color === current.color;
        if (!same) {
          if (current) vertical.push({ c: c, from: start, to: r, edge: current });
          current = edge;
          start = r;
        }
      }
    }

    return { horizontal: horizontal, vertical: vertical };
  }
};
