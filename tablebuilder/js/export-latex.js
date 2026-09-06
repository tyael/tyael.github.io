/**
 * export-latex.js
 *
 * Booktabs LaTeX from the ResolvedModel.
 *
 * The output targets the convention journals actually expect: `\toprule`,
 * `\midrule`, `\bottomrule`, `\cmidrule(lr){}` under spanners, and no vertical
 * rules at all. LaTeX has no rowspan without the `multirow` package, so a
 * column label that spans header rows in HTML is emitted on the bottom header
 * row instead — which is what a hand-written booktabs table does anyway.
 */

const ExportLatex = {

  /**
   * @param {Object} model
   * @param {Object} [opts] - {environment, placement, siunitx}
   * @returns {string}
   */
  build(model, opts) {
    opts = opts || {};
    const environment = opts.environment || 'table';
    const placement = opts.placement || '!ht';

    const cols = model.cols;
    const nCols = cols.length;
    const out = [];

    /* ---- Preamble note ---- */

    out.push('% Requires: \\usepackage{booktabs}');
    if (model.footnotes.length || model.sourceNotes.length) {
      out.push('% Notes below the table use \\footnotesize; for numbered notes tied to');
      out.push('% the table body, consider \\usepackage{threeparttable}.');
    }
    out.push('');

    /* ---- Environment ---- */

    out.push('\\begin{' + environment + '}[' + placement + ']');
    out.push('\\centering');

    // A float has one caption slot. An explicit caption is the more specific
    // thing to put in it, so it wins; the title and subtitle then render as
    // heading rows inside the tabular rather than being dropped. With no
    // caption the title takes the slot, which is what gt does.
    let headingRows = [];
    if (model.caption) {
      out.push('\\caption{' + Markup.toLatex(model.caption) + '}');
      headingRows = ExportLatex.headingRows(model, nCols);
    } else if (model.title || model.subtitle) {
      const caption = Markup.toLatex(model.title) +
        (model.title && model.subtitle ? '. ' : '') +
        (model.subtitle ? Markup.toLatex(model.subtitle) : '');
      out.push('\\caption{' + caption + '}');
    }

    out.push('\\begin{tabular}{' + ExportLatex.columnSpec(cols) + '}');
    out.push('\\toprule');

    if (headingRows.length) {
      out.push.apply(out, headingRows);
      out.push('\\midrule');
    }

    /* ---- Header ---- */

    if (model.header.show) {
      out.push.apply(out, ExportLatex.header(model, nCols));
      out.push('\\midrule');
    }

    /* ---- Body ---- */

    out.push.apply(out, ExportLatex.body(model, nCols));

    out.push('\\bottomrule');
    out.push('\\end{tabular}');

    /* ---- Notes ---- */

    const notes = ExportLatex.notes(model);
    if (notes.length) {
      out.push('');
      out.push('\\begin{minipage}{\\linewidth}');
      out.push('\\footnotesize');
      out.push.apply(out, notes);
      out.push('\\end{minipage}');
    }

    out.push('\\end{' + environment + '}');
    out.push('');

    // Asked of the finished text rather than of the model, because a link can
    // arrive in a cell, a label, a spanner, a title, a caption, a footnote or a
    // source note, and a list of those places here would be a second answer to
    // the question `Markup.toLatex` has already settled. A `\href` with no
    // hyperref loaded is an undefined control sequence, which stops the build.
    if (out.some((line) => line.indexOf('\\href{') >= 0)) {
      out.splice(1, 0, '% Requires: \\usepackage{hyperref}');
    }

    return out.join('\n');
  },

  /**
   * Title and subtitle as full-width rows, mirroring the band rows the HTML
   * renderer puts above the column labels. Only used when a caption has taken
   * the float's `\caption{}`.
   */
  headingRows(model, nCols) {
    const out = [];
    const row = (body) => '\\multicolumn{' + nCols + '}{c}{' + body + '} \\\\';

    if (model.title) {
      out.push(row('\\textbf{' + ExportLatex.cellText(model.title, model.titleMarks, model) + '}'));
    }
    if (model.subtitle) {
      out.push(row(ExportLatex.cellText(model.subtitle, model.subtitleMarks, model)));
    }
    return out;
  },

  /** `lrrr` — one letter per column, from the resolved alignments. */
  columnSpec(cols) {
    return cols.map((col) => {
      switch (col.align) {
        case 'right': return 'r';
        case 'center': return 'c';
        default: return 'l';
      }
    }).join('');
  },

  /* ================================================================
     Header
     ================================================================ */

  header(model, nCols) {
    const totalRows = model.header.totalRows;

    // matrix[r][c] holds {text, span, align} or null when covered by a span.
    const matrix = [];
    for (let r = 0; r < totalRows; r += 1) matrix.push(new Array(nCols).fill(undefined));

    const place = (r, c, cell) => {
      if (r < 0 || r >= totalRows || c < 0 || c >= nCols) return;
      matrix[r][c] = cell;
      for (let i = c + 1; i < c + (cell.span || 1); i += 1) matrix[r][i] = null;
    };

    // Stub and group header cells: pushed to the bottom header row, since
    // LaTeX cannot span rows without `multirow`.
    for (const lead of model.header.lead) {
      place(totalRows - 1, lead.gridCol, { text: lead.label, span: 1, align: 'l', marks: lead.marks });
    }

    const cmidrules = [];

    model.header.levels.forEach((level, levelIndex) => {
      for (const cell of level.cells) {
        if (cell.kind === 'blank') continue;

        const c = cell.gridCol;
        const span = cell.span || 1;

        // A label with a rowspan drops to the bottom row.
        const rowspan = cell.rowspan || 1;
        const targetRow = rowspan > 1 ? totalRows - 1 : levelIndex;

        place(targetRow, c, {
          text: cell.label,
          span: span,
          align: cell.kind === 'spanner' ? 'c' : ExportLatex.alignLetter(cell.align),
          marks: cell.marks
        });

        if (cell.kind === 'spanner' && cell.label) {
          cmidrules.push({ row: levelIndex, from: c + 1, to: c + span });
        }
      }
    });

    /* ---- Emit ---- */

    const out = [];
    for (let r = 0; r < totalRows; r += 1) {
      const parts = [];
      for (let c = 0; c < nCols; c += 1) {
        const cell = matrix[r][c];
        if (cell === null) continue;                 // covered by a \multicolumn
        if (cell === undefined) { parts.push(''); continue; }

        const text = ExportLatex.cellText(cell.text, cell.marks, model);
        parts.push(cell.span > 1
          ? '\\multicolumn{' + cell.span + '}{' + cell.align + '}{' + text + '}'
          : text);
      }
      out.push(parts.join(' & ') + ' \\\\');

      const rules = cmidrules.filter((rule) => rule.row === r);
      if (rules.length) {
        out.push(rules.map((rule) => '\\cmidrule(lr){' + rule.from + '-' + rule.to + '}').join(' '));
      }
    }

    return out;
  },

  alignLetter(align) {
    if (align === 'right') return 'r';
    if (align === 'center') return 'c';
    return 'l';
  },

  /* ================================================================
     Body
     ================================================================ */

  body(model, nCols) {
    const out = [];
    let previousKind = null;

    model.rows.forEach((row, index) => {
      if (row.kind === 'group') {
        if (index > 0) out.push('\\addlinespace');
        out.push('\\multicolumn{' + nCols + '}{l}{\\textit{' +
          ExportLatex.cellText(row.groupLabel, row.marks, model) + '}} \\\\');
        previousKind = 'group';
        return;
      }

      if ((row.kind === 'summary' || row.kind === 'grand') && previousKind !== row.kind) {
        out.push(row.kind === 'grand' ? '\\midrule' : '\\cmidrule(lr){1-' + nCols + '}');
      }

      const parts = [];
      for (const cell of row.cells) {
        // A group column absorbed by a rowspan above contributes an empty slot.
        if (cell.kind === 'group-col' && !cell.rowspan) { parts.push(''); continue; }

        let text = ExportLatex.cellText(cell.text, cell.marks, model);

        // Style rules that set bold or italic are worth carrying over; the rest
        // of the CSS surface has no faithful LaTeX equivalent.
        if (cell.style && cell.style.text) {
          if (/bold|[6-9]00/.test(String(cell.style.text.weight || ''))) text = '\\textbf{' + text + '}';
          if (cell.style.text.style === 'italic') text = '\\textit{' + text + '}';
        }

        const indent = cell.indent ? '\\hspace{' + (cell.indent * 1) + 'em}' : '';
        parts.push(indent + text);
      }

      out.push(parts.join(' & ') + ' \\\\');
      previousKind = row.kind;
    });

    return out;
  },

  /** Cell text plus any footnote marks, escaped for LaTeX. */
  cellText(text, marks, model) {
    let out = (text === null || text === undefined) ? '' : Markup.toLatex(text);
    if (marks && marks.length) {
      out += '\\textsuperscript{' + marks.map((m) => Markup.escapeLatex(m)).join(',') + '}';
    }
    return out;
  },

  notes(model) {
    const out = [];

    for (const note of model.footnotes) {
      out.push('\\textsuperscript{' + Markup.escapeLatex(note.mark) + '}~' +
        Markup.toLatex(note.text) + ' \\par');
    }
    for (const note of model.sourceNotes) {
      out.push(Markup.toLatex(note.text) + ' \\par');
    }

    return out;
  }
};
