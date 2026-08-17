/**
 * measure.js
 *
 * Reads real geometry back out of a rendered table.
 *
 * Writing an independent text-layout engine for the SVG exporter would be a
 * large amount of work and would drift from the preview the first time a
 * font fell back or a label wrapped. So instead the table is rendered into a
 * hidden host, and this module measures what the browser actually did:
 *
 *   - `getBoundingClientRect()` per cell for the box
 *   - `Range.getClientRects()` per text run for each *line* of wrapped text
 *   - `getComputedStyle()` for font, colour, alignment and padding
 *   - a canvas `measureText()` probe for the baseline offset of each font+size
 *
 * The result is a flat list of positioned boxes and text runs in table-local
 * coordinates, which render-svg.js turns into primitives. Borders do not come
 * from here — they come from the edge grid (see edges.js).
 */

const Measure = {

  /** Cached ascent per `font` shorthand, so we probe each font once. */
  _ascents: {},

  /**
   * Render a model off-screen and measure it.
   *
   * @param {Object} model
   * @returns {Object} {width, height, cells, runs, colEdges, rowEdges, background}
   */
  run(model) {
    const host = Measure.createHost();

    try {
      const rendered = RenderHtml.render(model, { selectable: false, tableId: 'gt-measure' });

      const style = Util.el('style', { text: rendered.css });
      host.appendChild(style);
      host.appendChild(rendered.node);

      // Force layout before reading anything back.
      const table = rendered.node;
      const tableRect = table.getBoundingClientRect();

      const origin = { x: tableRect.left, y: tableRect.top };
      const result = {
        width: tableRect.width,
        height: tableRect.height,
        background: Measure.resolvedBackground(table),
        tableBorders: Measure.tableBorders(table),
        cells: [],
        runs: [],
        colEdges: [],
        rowEdges: [],
        grid: rendered.grid
      };

      Measure.collectCells(table, origin, result);
      Measure.collectGridLines(table, origin, rendered.grid, result);

      return result;
    } finally {
      host.remove();
    }
  },

  /**
   * An off-screen host that still lays out properly.
   *
   * `display: none` would give every rect a width of zero, and moving the node
   * far off-screen with a transform can change subpixel rounding. Absolute
   * positioning well outside the viewport keeps layout identical to the
   * preview while staying invisible.
   */
  createHost() {
    const host = Util.el('div', {
      style: {
        position: 'absolute',
        left: '-100000px',
        top: '0',
        width: 'auto',
        visibility: 'hidden',
        pointerEvents: 'none'
      }
    });
    document.body.appendChild(host);
    return host;
  },

  /** The table's own background, resolved to something paintable. */
  resolvedBackground(table) {
    const computed = getComputedStyle(table);
    const parsed = Palettes.parse(computed.backgroundColor);
    return parsed && parsed.a > 0 ? Palettes.toCss(parsed) : null;
  },

  /** The four borders on the table element itself, outside the edge grid. */
  tableBorders(table) {
    const computed = getComputedStyle(table);
    const out = {};
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const width = parseFloat(computed['border' + side + 'Width']) || 0;
      const style = computed['border' + side + 'Style'];
      if (!width || style === 'none' || style === 'hidden') continue;
      out[side.toLowerCase()] = {
        width: width,
        style: style,
        color: computed['border' + side + 'Color']
      };
    }
    return out;
  },

  /* ================================================================
     Cells and text
     ================================================================ */

  collectCells(table, origin, result) {
    for (const node of Util.qsa('th, td', table)) {
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;

      const computed = getComputedStyle(node);
      const background = Palettes.parse(computed.backgroundColor);

      result.cells.push({
        x: rect.left - origin.x,
        y: rect.top - origin.y,
        width: rect.width,
        height: rect.height,
        fill: background && background.a > 0 ? Palettes.toCss(background) : null
      });

      Measure.collectRuns(node, origin, result);
    }
  },

  /**
   * Break a cell's text into positioned runs.
   *
   * Walking text nodes rather than reading `textContent` is what makes
   * superscripts, bold spans and wrapped lines come out at their true
   * positions and sizes: each run carries the computed style of the element it
   * actually sits in.
   */
  collectRuns(cell, origin, result) {
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, null);
    let textNode = walker.nextNode();

    while (textNode) {
      const text = textNode.nodeValue;
      if (text && text.trim()) {
        const parent = textNode.parentElement;
        const computed = getComputedStyle(parent);

        const range = document.createRange();
        range.selectNodeContents(textNode);
        const rects = range.getClientRects();

        // One rect per visual line — this is how wrapped text keeps working.
        const lines = Measure.splitByLine(text, rects, textNode);

        for (const line of lines) {
          if (!line.text.trim()) continue;
          result.runs.push({
            text: line.text,
            x: line.rect.left - origin.x,
            y: line.rect.top - origin.y,
            width: line.rect.width,
            height: line.rect.height,
            baseline: line.rect.top - origin.y + Measure.ascent(computed),
            fontFamily: computed.fontFamily,
            fontSize: parseFloat(computed.fontSize),
            fontWeight: computed.fontWeight,
            fontStyle: computed.fontStyle,
            fontStretch: computed.fontStretch,
            letterSpacing: computed.letterSpacing === 'normal' ? 0 : parseFloat(computed.letterSpacing) || 0,
            color: computed.color,
            decoration: Measure.decorationOf(computed),
            transform: computed.textTransform
          });
        }

        range.detach && range.detach();
      }
      textNode = walker.nextNode();
    }
  },

  /**
   * Map the rects a Range produced back onto the substrings that made them.
   *
   * A text node that wraps produces several rects but only one string, so the
   * text has to be re-split. Character-level ranges give an exact answer and
   * are only needed when a run actually wrapped, which is rare.
   */
  splitByLine(text, rects, textNode) {
    if (rects.length === 0) return [];
    if (rects.length === 1) return [{ text: text, rect: rects[0] }];

    const lines = [];
    const range = document.createRange();
    let start = 0;
    let currentTop = null;

    for (let i = 0; i <= text.length; i += 1) {
      let top = null;
      if (i < text.length) {
        range.setStart(textNode, i);
        range.setEnd(textNode, i + 1);
        const charRects = range.getClientRects();
        if (charRects.length) top = Math.round(charRects[0].top * 10) / 10;
      }

      if (currentTop === null) {
        currentTop = top;
        continue;
      }

      if (top === null || Math.abs(top - currentTop) > 0.6) {
        range.setStart(textNode, start);
        range.setEnd(textNode, i);
        const lineRects = range.getClientRects();
        if (lineRects.length) {
          lines.push({ text: text.slice(start, i), rect: lineRects[0] });
        }
        start = i;
        currentTop = top;
      }
    }

    return lines.length ? lines : [{ text: text, rect: rects[0] }];
  },

  decorationOf(computed) {
    const line = computed.textDecorationLine || computed.textDecoration || '';
    if (!line || line.indexOf('none') === 0) return null;
    if (line.indexOf('underline') >= 0) return 'underline';
    if (line.indexOf('line-through') >= 0) return 'line-through';
    if (line.indexOf('overline') >= 0) return 'overline';
    return null;
  },

  /**
   * The distance from the top of a line box to the text baseline.
   *
   * SVG positions text by its baseline; the DOM gives line-box tops. Canvas
   * `measureText` reports real font metrics for the exact family and size, so
   * the two line up rather than relying on a fudge factor.
   */
  ascent(computed) {
    const font = computed.fontStyle + ' ' + computed.fontWeight + ' ' +
      computed.fontSize + '/' + computed.lineHeight + ' ' + computed.fontFamily;

    if (Measure._ascents[font] !== undefined) return Measure._ascents[font];

    const size = parseFloat(computed.fontSize) || 16;
    const lineHeight = computed.lineHeight === 'normal'
      ? size * 1.2
      : (parseFloat(computed.lineHeight) || size * 1.2);

    let ascent;
    try {
      const ctx = Measure.context();
      ctx.font = computed.fontStyle + ' ' + computed.fontWeight + ' ' +
        computed.fontSize + ' ' + computed.fontFamily;
      const metrics = ctx.measureText('Hxg');
      const fontAscent = metrics.fontBoundingBoxAscent;
      const fontDescent = metrics.fontBoundingBoxDescent;

      if (isFinite(fontAscent) && isFinite(fontDescent)) {
        // The glyph box is centred inside the line box; half-leading sits above.
        const leading = lineHeight - (fontAscent + fontDescent);
        ascent = leading / 2 + fontAscent;
      } else {
        ascent = lineHeight / 2 + size * 0.36;
      }
    } catch (err) {
      ascent = lineHeight / 2 + size * 0.36;
    }

    Measure._ascents[font] = ascent;
    return ascent;
  },

  _ctx: null,

  context() {
    if (!Measure._ctx) {
      Measure._ctx = document.createElement('canvas').getContext('2d');
    }
    return Measure._ctx;
  },

  /* ================================================================
     Grid geometry
     ================================================================ */

  /**
   * The x position of every column boundary and the y of every row boundary,
   * so the edge grid can be drawn as long straight lines.
   *
   * @param {HTMLTableElement} table
   * @param {{x: number, y: number}} origin - what the positions are measured from
   * @param {?Object} grid - from Edges.build, for the alignment check only; a
   *   caller with no grid to check against may pass null
   * @param {Object} result - written into
   */
  collectGridLines(table, origin, grid, result) {
    // Column boundaries come from the <col> elements, which have the real
    // resolved widths even under `table-layout: fixed`.
    const cols = Util.qsa('col', table);
    const tableRect = table.getBoundingClientRect();
    const computed = getComputedStyle(table);

    let x = tableRect.left - origin.x + (parseFloat(computed.borderLeftWidth) || 0);
    result.colEdges.push(x);
    for (const col of cols) {
      x += col.getBoundingClientRect().width;
      result.colEdges.push(x);
    }

    // Row boundaries come from the rendered rows, in grid order.
    const rows = Util.qsa('tr', table);
    let y = null;
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (y === null) {
        y = rect.top - origin.y;
        result.rowEdges.push(y);
      }
      y = rect.bottom - origin.y;
      result.rowEdges.push(y);
    }

    if (!result.rowEdges.length) {
      result.rowEdges.push(0, tableRect.height);
    }

    // A defensive alignment check: the edge grid and the DOM must agree on how
    // many rows there are, or the SVG would draw its lines in the wrong places.
    result.rowMismatch = grid ? (result.rowEdges.length - 1) !== grid.nRows : false;
    result.colMismatch = grid ? (result.colEdges.length - 1) !== grid.nCols : false;
  },

  /**
   * The same boundaries, in the table's own unscaled pixels and measured from
   * its top-left corner.
   *
   * `collectGridLines` reads live rects. The SVG exporter measures an off-screen
   * host at zoom 1, so for it the two are the same thing — but everything on the
   * stage reads a table carrying `#preview-host`'s zoom `transform`, and needs
   * the numbers back in the coordinate space the table itself is laid out in.
   * The division happens here rather than at each caller so that hit-testing a
   * line and placing the handle that drags it cannot disagree about where the
   * boundary is.
   *
   * @param {HTMLTableElement} table
   * @param {?Object} grid - from Edges.build; only the mismatch flags use it
   * @param {number} [zoom=1] - the scale the table is currently drawn at
   * @returns {{colEdges: number[], rowEdges: number[], rowMismatch: boolean, colMismatch: boolean}}
   */
  gridGeometry(table, grid, zoom) {
    const rect = table.getBoundingClientRect();
    const scale = zoom || 1;
    const raw = { colEdges: [], rowEdges: [] };

    Measure.collectGridLines(table, { x: rect.left, y: rect.top }, grid, raw);

    return {
      colEdges: raw.colEdges.map((x) => x / scale),
      rowEdges: raw.rowEdges.map((y) => y / scale),
      rowMismatch: raw.rowMismatch,
      colMismatch: raw.colMismatch
    };
  }
};
