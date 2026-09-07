/**
 * render-svg.js
 *
 * True-vector SVG export.
 *
 * Every fill is a `<rect>`, every rule a `<line>`, every piece of text a
 * `<text>` at its measured baseline. There is no `<foreignObject>` anywhere:
 * that would look right in a browser and render blank in Illustrator, Inkscape,
 * rsvg and every LaTeX pipeline, which is exactly where these tables need to
 * work.
 *
 * Geometry comes from measure.js (what the browser actually laid out) and the
 * line grid comes from edges.js (what the border model actually says), so the
 * SVG cannot drift from the preview.
 *
 * Web fonts are embedded as base64 `@font-face` rules. Without that the file
 * would fall back to a system face the moment it left this machine — and the
 * PNG exporter, which rasterises this same SVG through an `<img>`, would never
 * load the font at all.
 */

const RenderSvg = {

  /**
   * @param {Object} model
   * @param {Object} [opts] - {embedFonts: boolean, padding: number}
   * @returns {Promise<string>} the SVG document
   */
  async build(model, opts) {
    opts = opts || {};
    const padding = opts.padding === undefined ? 0 : opts.padding;

    // Measuring before a webfont has arrived would capture fallback metrics and
    // bake the wrong geometry into the SVG.
    await Fonts.ready();

    const measured = Measure.run(model);
    const grid = measured.grid;

    if (measured.rowMismatch || measured.colMismatch) {
      // Not fatal — the fills and text are measured directly and stay correct;
      // only the rules could land badly, so say so rather than failing silently.
      console.warn('SVG export: edge grid and rendered rows disagree',
        { rows: measured.rowEdges.length - 1, gridRows: grid.nRows,
          cols: measured.colEdges.length - 1, gridCols: grid.nCols });
    }

    const width = measured.width + padding * 2;
    const height = measured.height + padding * 2;

    const body = [];

    /* ---- Background ---- */

    if (measured.background) {
      body.push(RenderSvg.rect(0, 0, width, height, measured.background));
    }

    /* ---- Cell fills ---- */

    for (const cell of measured.cells) {
      if (!cell.fill) continue;
      body.push(RenderSvg.rect(cell.x + padding, cell.y + padding, cell.width, cell.height, cell.fill));
    }

    /* ---- Rules from the edge grid ---- */

    body.push.apply(body, RenderSvg.gridLines(grid, measured, padding));

    /* ---- The table's own outer border ---- */

    body.push.apply(body, RenderSvg.outerBorder(measured, padding));

    /* ---- Text ---- */

    for (const run of measured.runs) {
      body.push(RenderSvg.text(run, padding));
      const decoration = RenderSvg.decorationLine(run, padding);
      if (decoration) body.push(decoration);
    }

    /* ---- Fonts ---- */

    let fontCss = '';
    if (opts.embedFonts !== false) {
      fontCss = await RenderSvg.fontFaces(model);
    }

    const title = Markup.toPlain(model.title || model.spec.meta.name || 'Table');

    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"\n' +
      '     width="' + RenderSvg.n(width) + '" height="' + RenderSvg.n(height) + '"\n' +
      '     viewBox="0 0 ' + RenderSvg.n(width) + ' ' + RenderSvg.n(height) + '">\n' +
      '  <title>' + Util.escapeXml(title) + '</title>\n' +
      (fontCss ? '  <defs><style type="text/css"><![CDATA[\n' + fontCss + '\n  ]]></style></defs>\n' : '') +
      '  <g shape-rendering="crispEdges">\n' +
      body.filter((n) => n && n.indexOf('<text') !== 0).map((n) => '    ' + n).join('\n') + '\n' +
      '  </g>\n' +
      '  <g>\n' +
      body.filter((n) => n && n.indexOf('<text') === 0).map((n) => '    ' + n).join('\n') + '\n' +
      '  </g>\n' +
      '</svg>\n';
  },

  /* ================================================================
     Primitives
     ================================================================ */

  /** Round to 3dp — enough precision, far smaller files. */
  n(value) {
    return Math.round(value * 1000) / 1000;
  },

  rect(x, y, width, height, fill) {
    return '<rect x="' + RenderSvg.n(x) + '" y="' + RenderSvg.n(y) +
      '" width="' + RenderSvg.n(width) + '" height="' + RenderSvg.n(height) +
      '" fill="' + Util.escapeXml(fill) + '"/>';
  },

  /**
   * A rule. `double` is drawn as two thin lines with a gap, matching how CSS
   * renders it, because a single thick line reads completely differently.
   */
  line(x1, y1, x2, y2, edge) {
    const color = Util.escapeXml(edge.color);
    const horizontal = Math.abs(y2 - y1) < 0.01;

    if (edge.style === 'double') {
      const thin = Math.max(0.5, edge.width / 3);
      const offset = edge.width / 2 - thin / 2;
      const shift = (dx, dy) => RenderSvg.strokeLine(x1 + dx, y1 + dy, x2 + dx, y2 + dy, color, thin, null);
      return horizontal
        ? shift(0, -offset) + '\n    ' + shift(0, offset)
        : shift(-offset, 0) + '\n    ' + shift(offset, 0);
    }

    let dash = null;
    if (edge.style === 'dashed') dash = (edge.width * 3) + ',' + (edge.width * 2);
    else if (edge.style === 'dotted') dash = edge.width + ',' + edge.width;

    return RenderSvg.strokeLine(x1, y1, x2, y2, color, edge.width, dash);
  },

  strokeLine(x1, y1, x2, y2, color, width, dash) {
    return '<line x1="' + RenderSvg.n(x1) + '" y1="' + RenderSvg.n(y1) +
      '" x2="' + RenderSvg.n(x2) + '" y2="' + RenderSvg.n(y2) +
      '" stroke="' + color + '" stroke-width="' + RenderSvg.n(width) + '"' +
      (dash ? ' stroke-dasharray="' + dash + '"' : '') +
      ' stroke-linecap="butt"/>';
  },

  /**
   * One text run, anchored at its measured left edge and baseline.
   *
   * Because the run's own box was measured, no alignment logic is needed here —
   * centred, right-aligned and justified text all arrive pre-positioned.
   */
  text(run, padding) {
    const attrs = [
      'x="' + RenderSvg.n(run.x + padding) + '"',
      'y="' + RenderSvg.n(run.baseline + padding) + '"',
      'font-family="' + Util.escapeXml(run.fontFamily) + '"',
      'font-size="' + RenderSvg.n(run.fontSize) + '"',
      'fill="' + Util.escapeXml(run.color) + '"'
    ];

    if (run.fontWeight && run.fontWeight !== '400' && run.fontWeight !== 'normal') {
      attrs.push('font-weight="' + Util.escapeXml(run.fontWeight) + '"');
    }
    if (run.fontStyle && run.fontStyle !== 'normal') {
      attrs.push('font-style="' + Util.escapeXml(run.fontStyle) + '"');
    }
    if (run.fontStretch && run.fontStretch !== 'normal' && run.fontStretch !== '100%') {
      attrs.push('font-stretch="' + Util.escapeXml(run.fontStretch) + '"');
    }
    if (run.letterSpacing) {
      attrs.push('letter-spacing="' + RenderSvg.n(run.letterSpacing) + '"');
    }

    // `xml:space` keeps meaningful leading and trailing spaces (footnote marks
    // sitting against their text, for one).
    return '<text ' + attrs.join(' ') + ' xml:space="preserve">' +
      Util.escapeXml(RenderSvg.cased(run)) + '</text>';
  },

  /**
   * The run's text as the browser drew it, with `text-transform` applied.
   *
   * SVG has no `text-transform`, so the case has to be in the characters. The
   * run was measured *after* the transform — the rect a range reports is the
   * width of the uppercase text — so emitting the untransformed string put
   * lowercase glyphs into a box cut for capitals: every uppercase column label
   * in the app came out of the SVG and the PNG in the case it was typed in,
   * loose in its column, while the preview and the HTML export showed capitals.
   *
   * `capitalize` follows CSS in acting on the first letter of each word rather
   * than on the first letter of the run.
   */
  cased(run) {
    const text = String(run.text);
    if (run.transform === 'uppercase') return text.toUpperCase();
    if (run.transform === 'lowercase') return text.toLowerCase();
    if (run.transform === 'capitalize') {
      return text.replace(/(^|\s)(\S)/g, (all, space, first) => space + first.toUpperCase());
    }
    return text;
  },

  /** Underline, overline or strike-through as a real line. */
  decorationLine(run, padding) {
    if (!run.decoration) return null;
    const thickness = Math.max(0.5, run.fontSize / 16);
    let y;

    if (run.decoration === 'underline') y = run.baseline + run.fontSize * 0.12;
    else if (run.decoration === 'overline') y = run.baseline - run.fontSize * 0.92;
    else y = run.baseline - run.fontSize * 0.28;

    return RenderSvg.strokeLine(
      run.x + padding, y + padding,
      run.x + run.width + padding, y + padding,
      run.color, thickness, null
    );
  },

  /* ================================================================
     Lines
     ================================================================ */

  /**
   * Draw the edge grid, mapping grid coordinates to measured pixels.
   *
   * CSS paints a border *inside* the cell box, so a rule sitting on grid row r
   * occupies the first `width` pixels below that boundary — except the final
   * row and column, whose borders sit inside the last cell and so run upwards
   * and leftwards. Centring the stroke correctly is what makes the SVG land on
   * the same pixels as the preview.
   */
  gridLines(grid, measured, padding) {
    const out = [];
    const segments = Edges.segments(grid);
    const colEdges = measured.colEdges;
    const rowEdges = measured.rowEdges;

    const colAt = (c) => colEdges[Math.min(c, colEdges.length - 1)];
    const rowAt = (r) => rowEdges[Math.min(r, rowEdges.length - 1)];

    for (const segment of segments.horizontal) {
      const isLast = segment.r >= grid.nRows;
      const y = rowAt(segment.r) + (isLast ? -segment.edge.width / 2 : segment.edge.width / 2);
      out.push(RenderSvg.line(
        colAt(segment.from) + padding, y + padding,
        colAt(segment.to) + padding, y + padding,
        segment.edge
      ));
    }

    for (const segment of segments.vertical) {
      const isLast = segment.c >= grid.nCols;
      const x = colAt(segment.c) + (isLast ? -segment.edge.width / 2 : segment.edge.width / 2);
      out.push(RenderSvg.line(
        x + padding, rowAt(segment.from) + padding,
        x + padding, rowAt(segment.to) + padding,
        segment.edge
      ));
    }

    return out;
  },

  /** The table element's own border, which sits outside the cell grid. */
  outerBorder(measured, padding) {
    const out = [];
    const borders = measured.tableBorders;
    const w = measured.width;
    const h = measured.height;

    if (borders.top) {
      const y = borders.top.width / 2;
      out.push(RenderSvg.line(padding, y + padding, w + padding, y + padding, borders.top));
    }
    if (borders.bottom) {
      const y = h - borders.bottom.width / 2;
      out.push(RenderSvg.line(padding, y + padding, w + padding, y + padding, borders.bottom));
    }
    if (borders.left) {
      const x = borders.left.width / 2;
      out.push(RenderSvg.line(x + padding, padding, x + padding, h + padding, borders.left));
    }
    if (borders.right) {
      const x = w - borders.right.width / 2;
      out.push(RenderSvg.line(x + padding, padding, x + padding, h + padding, borders.right));
    }

    return out;
  },

  /* ================================================================
     Font embedding
     ================================================================ */

  /**
   * Build `@font-face` rules with the font binary inlined as a data URI.
   *
   * Uploaded fonts already carry their bytes; Google families are fetched and
   * encoded (Google serves both the stylesheet and the files with permissive
   * CORS, so this works straight from the browser). A font the user named but
   * did not supply — an installed system face — has nothing to inline, and the
   * SVG simply references it by name.
   *
   * Best-effort: if the network is unavailable the SVG still exports.
   */
  async fontFaces(model) {
    const ids = Fonts.usedIds(model.spec);
    if (!ids.length) return '';

    const blocks = [];
    for (const id of ids) {
      try {
        const css = await Fonts.faceCss(id);
        if (css) blocks.push(css);
      } catch (err) {
        console.warn('Could not embed font "' + Fonts.label(id) + '":', err.message);
      }
    }
    return blocks.join('\n');
  }
};
