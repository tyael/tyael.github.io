/**
 * render-html.js
 *
 * Renders a ResolvedModel to a real DOM table, and serialises that same table
 * to a standalone HTML file.
 *
 * The preview and the export run through this one function. The only
 * difference is a `selectable` flag that adds `data-*` hooks and editor-only
 * classes, both of which are stripped during serialisation — so what you see
 * really is what you get.
 *
 * Layout uses `border-collapse: separate; border-spacing: 0`, with borders
 * assigned by edges.js under a strict ownership rule. That is deliberate:
 * `collapse` would make the painted borders unrecoverable for the SVG
 * exporter (see the note at the top of edges.js).
 */

const RenderHtml = {

  /**
   * @param {Object} model - from Compute.run()
   * @param {Object} [opts] - {selectable, tableId}
   * @returns {{node: HTMLElement, table: HTMLElement, css: string, grid: Object, id: string}}
   */
  render(model, opts) {
    opts = opts || {};
    const id = opts.tableId || 'gt_table';
    const grid = Edges.build(model);
    const opt = model.options;

    const table = Util.el('table.gt-table', { id: id });
    if (opts.selectable) table.classList.add('is-selectable');

    /* ---- Column widths ---- */

    const colgroup = Util.el('colgroup');
    for (const col of model.cols) {
      const node = Util.el('col');
      if (col.width) node.style.width = Util.cssLength(col.width);
      colgroup.appendChild(node);
    }
    table.appendChild(colgroup);

    /* ---- Walk the grid rows in order ---- */

    const thead = Util.el('thead');
    const tbody = Util.el('tbody');
    const tfoot = Util.el('tfoot');

    // Cells absorbed by a rowspan above them must not be emitted again.
    const occupied = {};
    const isOccupied = (r, c) => !!occupied[r + ':' + c];
    const occupy = (r, c, rowspan, span) => {
      for (let rr = r; rr < r + rowspan; rr += 1) {
        for (let cc = c; cc < c + span; cc += 1) occupied[rr + ':' + cc] = true;
      }
    };

    grid.gridRows.forEach((gridRow, r) => {
      const tr = RenderHtml.renderRow(gridRow, r, model, grid, opts, isOccupied, occupy);
      if (!tr) return;

      if (gridRow.kind === 'title' || gridRow.kind === 'subtitle' ||
          gridRow.kind === 'spanner' || gridRow.kind === 'column_labels') {
        thead.appendChild(tr);
      } else if (gridRow.kind === 'footnote' || gridRow.kind === 'source_note') {
        tfoot.appendChild(tr);
      } else {
        tbody.appendChild(tr);
      }
    });

    if (thead.childNodes.length) table.appendChild(thead);
    table.appendChild(tbody);
    if (tfoot.childNodes.length) table.appendChild(tfoot);

    const css = RenderHtml.buildCss(model, id, opt);

    return { node: table, table: table, css: css, grid: grid, id: id };
  },

  /* ================================================================
     Rows
     ================================================================ */

  renderRow(gridRow, r, model, grid, opts, isOccupied, occupy) {
    switch (gridRow.kind) {
      case 'title':
        return RenderHtml.bandRow(model, grid, r, 'gt-title', model.title,
          model.titleStyle, model.titleMarks, 'title', opts);

      case 'subtitle':
        return RenderHtml.bandRow(model, grid, r, 'gt-subtitle', model.subtitle,
          model.subtitleStyle, model.subtitleMarks, 'subtitle', opts);

      case 'spanner':
      case 'column_labels':
        return RenderHtml.headerRow(gridRow, r, model, grid, opts, isOccupied, occupy);

      case 'group':
        return RenderHtml.groupRow(gridRow, r, model, grid, opts);

      case 'data':
      case 'summary':
      case 'grand':
        return RenderHtml.bodyRow(gridRow, r, model, grid, opts, isOccupied, occupy);

      case 'footnote':
        return RenderHtml.footnoteRow(gridRow, r, model, grid, opts);

      case 'source_note':
        return RenderHtml.sourceRow(gridRow, r, model, grid, opts);

      default:
        return null;
    }
  },

  /** A single cell spanning the full width: title, subtitle, notes. */
  bandRow(model, grid, r, className, text, style, marks, part, opts) {
    const tr = Util.el('tr.gt-band-row');
    const cell = Util.el('td.' + className, { colspan: grid.nCols });

    Object.assign(cell.style, Edges.cssForCell(grid, r, 0, grid.nCols, 1));
    Object.assign(cell.style, StyleRules.toCss(style));

    RenderHtml.fillText(cell, text, marks, model);

    if (opts.selectable) {
      cell.classList.add('gt-cell');
      cell.dataset.part = part;
    }

    tr.appendChild(cell);
    return tr;
  },

  headerRow(gridRow, r, model, grid, opts, isOccupied, occupy) {
    const tr = Util.el('tr.gt-header-row');

    // The stub/group header cells lead the first header row and span the whole
    // header block downwards.
    if (gridRow.isFirstHeader) {
      for (const lead of model.header.lead) {
        const c = lead.gridCol;
        const cell = RenderHtml.cellNode('th', 'gt-stubhead', lead, model, grid, r, c, 1, lead.rowspan, opts);
        cell.dataset.part = 'stubhead';
        occupy(r, c, lead.rowspan, 1);
        tr.appendChild(cell);
      }
    }

    for (const cell of gridRow.ref.cells) {
      // Cells carry their true grid column: the label row holds only the
      // columns no spanner claimed, so they are not contiguous from the left.
      const c = cell.gridCol;
      const span = cell.span || 1;

      if (cell.kind === 'blank') {
        const node = Util.el('th.gt-col-blank', { colspan: span });
        Object.assign(node.style, Edges.cssForCell(grid, r, c, span, 1));
        tr.appendChild(node);
        continue;
      }

      const className = cell.kind === 'spanner' ? 'gt-spanner' : 'gt-col-label';
      const node = RenderHtml.cellNode('th', className, cell, model, grid, r, c, span, cell.rowspan || 1, opts);

      if (opts.selectable) {
        node.dataset.part = cell.kind === 'spanner' ? 'column_spanners' : 'column_labels';
        if (cell.kind === 'spanner') node.dataset.spanner = cell.id;
        else node.dataset.col = cell.colId;
      }

      occupy(r, c, cell.rowspan || 1, span);
      tr.appendChild(node);
    }

    return tr;
  },

  groupRow(gridRow, r, model, grid, opts) {
    const row = gridRow.ref;
    const tr = Util.el('tr.gt-group-row');
    const cell = Util.el('th.gt-group-label', { colspan: grid.nCols, scope: 'colgroup' });

    Object.assign(cell.style, Edges.cssForCell(grid, r, 0, grid.nCols, 1));
    Object.assign(cell.style, StyleRules.toCss(row.style));

    RenderHtml.fillText(cell, row.groupLabel, row.marks, model);

    if (opts.selectable) {
      cell.classList.add('gt-cell');
      cell.dataset.part = 'row_groups';
      cell.dataset.group = row.groupId;
    }

    tr.appendChild(cell);
    return tr;
  },

  bodyRow(gridRow, r, model, grid, opts, isOccupied, occupy) {
    const row = gridRow.ref;
    const classes = ['gt-body-row'];
    if (row.kind === 'summary') classes.push('gt-summary-row');
    if (row.kind === 'grand') classes.push('gt-grand-row');
    if (row.stripe) classes.push('gt-striped');

    const tr = Util.el('tr.' + classes.join('.'));
    let c = 0;

    for (const cell of row.cells) {
      // A group column cell with rowspan 0 was absorbed by the one above it.
      if (cell.kind === 'group-col' && !cell.rowspan) { c += 1; continue; }
      if (isOccupied(r, c)) { c += 1; continue; }

      const isStub = cell.kind === 'stub' || cell.kind === 'summary-stub' ||
        cell.kind === 'grand-stub' || cell.kind === 'group-col';
      const tag = isStub ? 'th' : 'td';

      let className;
      switch (cell.kind) {
        case 'stub': className = 'gt-stub'; break;
        case 'group-col': className = 'gt-group-col'; break;
        case 'summary-stub': className = 'gt-stub gt-summary-stub'; break;
        case 'grand-stub': className = 'gt-stub gt-grand-stub'; break;
        case 'summary': className = 'gt-summary-cell'; break;
        case 'grand': className = 'gt-grand-cell'; break;
        default: className = 'gt-cell-body';
      }

      const rowspan = cell.rowspan || 1;
      const node = RenderHtml.cellNode(tag, className, cell, model, grid, r, c, 1, rowspan, opts);

      if (cell.indent) {
        const step = Util.cssNumber(model.options['stub.indent_length']) || 5;
        node.style.paddingLeft = (Util.cssNumber(model.options['data_row.padding.horizontal']) || 5) +
          cell.indent * step + 'px';
      }

      if (opts.selectable) {
        node.dataset.part = cell.kind === 'stub' ? 'stub'
          : (cell.kind === 'summary' || cell.kind === 'summary-stub') ? 'summary'
          : (cell.kind === 'grand' || cell.kind === 'grand-stub') ? 'grand_summary'
          : (cell.kind === 'group-col') ? 'row_groups' : 'body';
        if (cell.colId && cell.kind !== 'stub' && cell.kind !== 'group-col') node.dataset.col = cell.colId;
        if (row.srcIndex !== undefined) node.dataset.row = row.srcIndex;
        if (row.groupId) node.dataset.group = row.groupId;
      }

      if (rowspan > 1) occupy(r, c, rowspan, 1);
      tr.appendChild(node);
      c += 1;
    }

    return tr;
  },

  footnoteRow(gridRow, r, model, grid, opts) {
    const tr = Util.el('tr.gt-footnote-row');
    const cell = Util.el('td.gt-footnote', { colspan: grid.nCols });

    Object.assign(cell.style, Edges.cssForCell(grid, r, 0, grid.nCols, 1));
    Object.assign(cell.style, StyleRules.toCss(model.footnotesStyle));

    const notes = gridRow.all ? model.footnotes : [gridRow.ref];
    const sep = model.options['footnotes.sep'] || ' ';
    const flags = model.options['footnotes.spec_ftr'] || '^i';

    notes.forEach((note, i) => {
      if (i > 0) cell.appendChild(document.createTextNode(sep));
      cell.appendChild(Markup.toDom(Markup.applyFootnoteSpec(note.mark, flags)));
      cell.appendChild(document.createTextNode(' '));
      cell.appendChild(Markup.toDom(note.text));
    });

    if (opts.selectable) {
      cell.classList.add('gt-cell');
      cell.dataset.part = 'footnotes';
    }

    tr.appendChild(cell);
    return tr;
  },

  sourceRow(gridRow, r, model, grid, opts) {
    const tr = Util.el('tr.gt-source-row');
    const cell = Util.el('td.gt-source-note', { colspan: grid.nCols });

    Object.assign(cell.style, Edges.cssForCell(grid, r, 0, grid.nCols, 1));

    const notes = gridRow.all ? model.sourceNotes : [gridRow.ref];
    const sep = model.options['source_notes.sep'] || ' ';

    notes.forEach((note, i) => {
      if (i > 0) cell.appendChild(document.createTextNode(sep));
      Object.assign(cell.style, StyleRules.toCss(note.style));
      cell.appendChild(Markup.toDom(note.text));
    });

    if (opts.selectable) {
      cell.classList.add('gt-cell');
      cell.dataset.part = 'source_notes';
    }

    tr.appendChild(cell);
    return tr;
  },

  /* ================================================================
     Cells
     ================================================================ */

  /** Build one cell node with its borders, alignment, styles and content. */
  cellNode(tag, className, cell, model, grid, r, c, span, rowspan, opts) {
    const node = Util.el(tag + '.' + className.split(' ').join('.'));
    if (span > 1) node.setAttribute('colspan', span);
    if (rowspan > 1) node.setAttribute('rowspan', rowspan);

    Object.assign(node.style, Edges.cssForCell(grid, r, c, span, rowspan));

    if (cell.align) node.style.textAlign = cell.align;

    // Value-driven colour sits under any explicit style rule.
    if (cell.color) {
      if (cell.color.fill) node.style.backgroundColor = cell.color.fill;
      if (cell.color.color) node.style.color = cell.color.color;
    }

    Object.assign(node.style, StyleRules.toCss(cell.style));

    if (opts.selectable) node.classList.add('gt-cell');

    // Body cells carry `text`; header cells (labels, spanners, the stubhead)
    // carry `label`.
    RenderHtml.fillText(node, cell.text !== undefined ? cell.text : cell.label, cell.marks, model);
    return node;
  },

  /** Put text (with markup) and any footnote marks into a cell. */
  fillText(node, text, marks, model) {
    if (text !== null && text !== undefined && text !== '') {
      node.appendChild(Markup.toDom(text));
    }
    if (marks && marks.length) {
      const flags = model.options['footnotes.spec_ref'] || '^i';
      const markup = marks.map((mark) => Markup.applyFootnoteSpec(mark, flags)).join(',');
      node.appendChild(Markup.toDom(markup));
    }
  },

  /**
   * The figure caption, or null when there is none.
   *
   * A caption is not table content — it labels the figure the table sits in,
   * which is why it ends up in `<figcaption>` here, in `\caption{}` in LaTeX
   * and in `tab_caption()` in R, and why the table-only artifacts (the HTML
   * fragment, SVG and PNG) leave it out. The preview shows this same node so
   * that typing a caption is visible somewhere.
   */
  captionNode(model, id) {
    if (!model.caption) return null;
    const node = Util.el('figcaption.gt-caption', { id: id + '-caption' });
    node.appendChild(Markup.toDom(model.caption));
    return node;
  },

  /* ================================================================
     Stylesheet
     ================================================================ */

  /**
   * Build the scoped stylesheet for a table. Everything that is uniform across
   * a part lives here; only per-cell values (borders, colours, rule styles) are
   * inline, which keeps the exported HTML legible.
   */
  buildCss(model, id, opt) {
    const sel = '#' + id;
    const out = [];
    const rule = (selector, decls) => {
      const body = Object.keys(decls)
        .filter((k) => decls[k] !== null && decls[k] !== undefined && decls[k] !== '')
        .map((k) => '  ' + k + ': ' + decls[k] + ';')
        .join('\n');
      if (body) out.push(selector + ' {\n' + body + '\n}');
    };

    const pad = (v, h) => (Util.cssLength(opt[v], '0') + ' ' + Util.cssLength(opt[h], '0'));
    const border = (prefix) => {
      const style = opt[prefix + '.style'];
      if (!style || style === 'none' || style === 'hidden') return null;
      return Util.cssLength(opt[prefix + '.width'], '1px') + ' ' + style + ' ' + opt[prefix + '.color'];
    };

    /* ---- The table itself ---- */

    const margins = {};
    if (opt['table.align'] === 'left') {
      margins['margin-left'] = '0';
      margins['margin-right'] = 'auto';
    } else if (opt['table.align'] === 'right') {
      margins['margin-left'] = 'auto';
      margins['margin-right'] = '0';
    } else {
      margins['margin-left'] = Util.cssLength(opt['table.margin.left'], 'auto');
      margins['margin-right'] = Util.cssLength(opt['table.margin.right'], 'auto');
    }

    rule(sel, Object.assign({
      'border-collapse': 'separate',
      'border-spacing': '0',
      'table-layout': opt['table.layout'] === 'auto' ? 'auto' : 'fixed',
      'width': opt['table.width'] === 'auto' ? 'auto' : Util.cssLength(opt['table.width']),
      'background-color': opt['table.background.color'] || 'transparent',
      'font-family': OptionsSchema.fontStack(opt['table.font.names']),
      'font-size': Util.cssLength(opt['table.font.size'], '16px'),
      'font-weight': opt['table.font.weight'],
      'font-style': opt['table.font.style'],
      'color': opt['table.font.color'],
      // No border on the element at all. Every edge of this table is drawn by
      // `edges.js` so that all of them resolve through one precedence path —
      // an element border is a second mechanism, and two mechanisms drawing
      // the same edge stack rather than one winning.
      'border-top': null,
      'border-bottom': null,
      'border-left': null,
      'border-right': null,
      '-webkit-font-smoothing': 'antialiased',
      'text-rendering': 'optimizeLegibility'
    }, margins));

    // Every cell starts from a clean slate; borders arrive inline.
    // `box-sizing` is set explicitly rather than inherited: the editor's own
    // reset would otherwise make the preview lay out differently from the
    // exported file, which has no reset of its own.
    rule(sel + ' th, ' + sel + ' td', {
      'box-sizing': 'border-box',
      'margin': '0',
      'vertical-align': 'middle',
      'overflow': 'visible',
      'font-weight': 'inherit',
      'text-align': 'left'
    });

    /* ---- Heading ---- */

    rule(sel + ' .gt-title', {
      'font-size': opt['heading.title.font.size'],
      'font-weight': opt['heading.title.font.weight'],
      'text-align': opt['heading.align'],
      'padding': pad('heading.padding', 'heading.padding.horizontal'),
      'background-color': opt['heading.background.color'] || null
    });

    rule(sel + ' .gt-subtitle', {
      'font-size': opt['heading.subtitle.font.size'],
      'font-weight': opt['heading.subtitle.font.weight'],
      'text-align': opt['heading.align'],
      'padding': pad('heading.padding', 'heading.padding.horizontal'),
      'background-color': opt['heading.background.color'] || null
    });

    /* ---- Column labels and spanners ---- */

    rule(sel + ' .gt-col-label, ' + sel + ' .gt-spanner, ' + sel + ' .gt-stubhead, ' + sel + ' .gt-col-blank', {
      'font-size': opt['column_labels.font.size'],
      'font-weight': opt['column_labels.font.weight'],
      'text-transform': opt['column_labels.text_transform'],
      'padding': pad('column_labels.padding', 'column_labels.padding.horizontal'),
      'background-color': opt['column_labels.background.color'] || null,
      'vertical-align': 'bottom'
    });

    rule(sel + ' .gt-spanner', { 'text-align': 'center' });

    /* ---- Row groups ---- */

    rule(sel + ' .gt-group-label, ' + sel + ' .gt-group-col', {
      'font-size': opt['row_group.font.size'],
      'font-weight': opt['row_group.font.weight'],
      'font-style': opt['row_group.font.style'],
      'text-transform': opt['row_group.text_transform'],
      'padding': pad('row_group.padding', 'row_group.padding.horizontal'),
      'background-color': opt['row_group.background.color'] || null,
      'text-align': 'left'
    });

    rule(sel + ' .gt-group-col', {
      'font-size': opt['stub_row_group.font.size'],
      'font-weight': opt['stub_row_group.font.weight'],
      'text-transform': opt['stub_row_group.text_transform'],
      'vertical-align': 'top'
    });

    /* ---- Body ---- */

    rule(sel + ' .gt-cell-body, ' + sel + ' .gt-stub', {
      'padding': pad('data_row.padding', 'data_row.padding.horizontal')
    });

    rule(sel + ' .gt-stub', {
      'font-size': opt['stub.font.size'],
      'font-weight': opt['stub.font.weight'],
      'text-transform': opt['stub.text_transform'],
      'background-color': opt['stub.background.color'] || null,
      'text-align': 'left'
    });

    /* ---- Summaries ---- */

    rule(sel + ' .gt-summary-cell, ' + sel + ' .gt-summary-stub', {
      'padding': pad('summary_row.padding', 'summary_row.padding.horizontal'),
      'text-transform': opt['summary_row.text_transform'],
      'background-color': opt['summary_row.background.color'] || null
    });

    rule(sel + ' .gt-grand-cell, ' + sel + ' .gt-grand-stub', {
      'padding': pad('grand_summary_row.padding', 'grand_summary_row.padding.horizontal'),
      'text-transform': opt['grand_summary_row.text_transform'],
      'background-color': opt['grand_summary_row.background.color'] || null
    });

    /* ---- Footer ---- */

    rule(sel + ' .gt-footnote', {
      'font-size': opt['footnotes.font.size'],
      'padding': pad('footnotes.padding', 'footnotes.padding.horizontal'),
      'background-color': opt['footnotes.background.color'] || null,
      'text-align': 'left'
    });

    rule(sel + ' .gt-source-note', {
      'font-size': opt['source_notes.font.size'],
      'padding': pad('source_notes.padding', 'source_notes.padding.horizontal'),
      'background-color': opt['source_notes.background.color'] || null,
      'text-align': 'left'
    });

    /* ---- Caption ---- */

    // The caption belongs to the figure, not the table, so it sits outside the
    // table element and cannot inherit its font. It is styled by id rather than
    // by `sel + ' …'` for the same reason.
    // Its alignment is its own (`parts.captionAlign`). It used to be derived
    // from `table.align` — where the *table* sits on the page — which is a
    // third, unrelated thing, and left the caption with no control of its own.
    rule(sel + '-caption', {
      'font-family': OptionsSchema.fontStack(opt['table.font.names']),
      'font-size': Util.cssLength(opt['table.font.size'], '16px'),
      'color': opt['table.font.color'],
      'margin-top': '10px',
      'text-align': model.captionAlign || 'center'
    });

    /* ---- Striping ---- */

    if (opt['row.striping.include_table_body']) {
      rule(sel + ' .gt-striped .gt-cell-body', {
        'background-color': opt['row.striping.background_color']
      });
      if (opt['row.striping.include_stub']) {
        rule(sel + ' .gt-striped .gt-stub', {
          'background-color': opt['row.striping.background_color']
        });
      }
    }

    /* ---- Inline markup ---- */

    rule(sel + ' sup, ' + sel + ' sub', {
      'font-size': '0.72em',
      'line-height': '0'
    });
    rule(sel + ' sup', { 'vertical-align': 'super' });
    rule(sel + ' sub', { 'vertical-align': 'sub' });
    rule(sel + ' code', { 'font-family': OptionsSchema.fontStack('system-mono'), 'font-size': '0.92em' });

    return out.join('\n\n');
  },

  /* ================================================================
     Export
     ================================================================ */

  /**
   * Serialise the table as a standalone HTML document.
   *
   * Editor-only attributes and classes are stripped from a clone, so the export
   * is exactly the table with none of the app's fingerprints on it.
   */
  toStandalone(model, opts) {
    opts = opts || {};
    const rendered = RenderHtml.render(model, { selectable: false, tableId: opts.tableId || 'gt-table' });
    const clean = RenderHtml.strip(rendered.table);
    const caption = RenderHtml.captionNode(model, rendered.id);

    // Google families come in by <link>; uploaded fonts are inlined as
    // @font-face so the file carries its own typeface anywhere it goes.
    const resources = opts.embedFontLink === false
      ? { links: '', faces: '' }
      : Fonts.htmlResources(model.spec);

    const title = Util.escapeHtml(model.title || model.spec.meta.name || 'Table');
    const bodyBackground = opts.transparent ? 'transparent' : '#ffffff';

    return '<!DOCTYPE html>\n' +
      '<html lang="en">\n' +
      '<head>\n' +
      '  <meta charset="UTF-8">\n' +
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '  <title>' + title + '</title>\n' +
      resources.links +
      '  <style>\n' +
      (resources.faces ? resources.faces + '\n' : '') +
      '    body { margin: 0; padding: 32px; background: ' + bodyBackground + '; }\n' +
      '    figure { margin: 0; }\n' +
      RenderHtml.indent(rendered.css, 4) + '\n' +
      '  </style>\n' +
      '</head>\n' +
      '<body>\n' +
      '<figure>\n' +
      RenderHtml.indent(clean.outerHTML, 2) + '\n' +
      (caption ? RenderHtml.indent(caption.outerHTML, 2) + '\n' : '') +
      '</figure>\n' +
      '</body>\n' +
      '</html>\n';
  },

  /** Just the `<style>` plus `<table>`, for pasting into an existing page. */
  toFragment(model, opts) {
    opts = opts || {};
    const rendered = RenderHtml.render(model, { selectable: false, tableId: opts.tableId || 'gt-table' });
    const clean = RenderHtml.strip(rendered.table);
    return '<style>\n' + rendered.css + '\n</style>\n' + clean.outerHTML + '\n';
  },

  /** Remove editor-only classes and data attributes from a clone. */
  strip(table) {
    const clone = table.cloneNode(true);
    clone.classList.remove('is-selectable', 'is-footnote-mode');

    const nodes = [clone].concat(Util.qsa('*', clone));
    for (const node of nodes) {
      node.classList.remove('gt-cell', 'is-selected', 'is-selected-anchor', 'is-rule-preview');
      if (!node.classList.length) node.removeAttribute('class');
      for (const key of Object.keys(node.dataset || {})) delete node.dataset[key];
    }
    return clone;
  },

  /** Indent a block of text by n spaces. */
  indent(text, n) {
    const prefix = ' '.repeat(n);
    return text.split('\n').map((line) => (line ? prefix + line : line)).join('\n');
  }
};
