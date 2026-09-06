/**
 * ui/import-preview.js
 *
 * The one door every import comes through: show what was found, ask what
 * cannot be guessed, then commit.
 *
 * Always asked: **how many rows are header**. No format answers it reliably
 * — a CSV has no way to say, a pasted spreadsheet range usually has no header
 * at all, and an HTML table that marks none still often has one. Guessing it
 * silently eats a row of data or invents a header out of one. So it is asked,
 * with the answer visible in the preview before anything is committed.
 *
 * Asked only when it matters: whether to **keep hyperlinks**. Kept is the
 * default — a pasted link becomes `[label](url)` markup, editable later,
 * rather than being silently read down to its label — but it is shown as a
 * choice rather than applied quietly, and a table with no link in it is never
 * asked at all.
 *
 * Two states, one modal: waiting for a paste, and previewing a grid.
 */

const ImportPreview = {

  /** Body rows shown in the preview. Enough to judge by, not enough to scroll. */
  MAX_ROWS: 8,

  /** {grid, headerRows, meta} while the modal is open, else null. */
  _state: null,

  isOpen() {
    return !!ImportPreview._state;
  },

  close() {
    ImportPreview._state = null;
    App.closeModal();
  },

  /* ================================================================
     Getting something to preview
     ================================================================ */

  /**
   * Open with a paste target focused and waiting.
   *
   * The clipboard is read from a `paste` event rather than
   * `navigator.clipboard.read()`: the event needs no permission, no prompt and
   * no gesture beyond the one the user is already making, and it hands over
   * every flavour at once — which is the whole point, since the HTML flavour
   * is what carries the structure.
   */
  awaitPaste() {
    ImportPreview._state = { grid: null, headerRows: 1, meta: null };

    const target = Util.el('textarea.paste-target', {
      placeholder: 'Press Ctrl+V (⌘V on a Mac) to paste a table here',
      rows: 4,
      on: {
        paste: (e) => {
          e.preventDefault();
          ImportPreview.fromClipboard(e.clipboardData);
        }
      }
    });

    App.showModal('Paste a table', [
      Util.el('p.modal-text', {
        text: 'Copy a table from a spreadsheet, a web page or a document, then paste it ' +
          'here. A copied table brings its column groups and merged cells with it; ' +
          'plain text is read as tab-separated.'
      }),
      target,
      Util.el('div.row-actions', null, [
        Controls.button('Cancel', () => ImportPreview.close(), { kind: 'ghost' })
      ])
    ]);
    target.focus();
  },

  /**
   * Read a clipboard payload and preview whatever is in it.
   *
   * HTML wins when it holds a table, because it is the only flavour that knows
   * about headers and merged cells. Plain text is read as tab-separated, which
   * is what every spreadsheet puts there.
   */
  fromClipboard(data) {
    if (!data) return;
    const html = data.getData('text/html');
    const text = data.getData('text/plain');

    try {
      if (html && /<table/i.test(html)) {
        const grid = ImportHtml.parse(html, { keepLinks: true });
        ImportPreview.show(grid, {
          filename: 'pasted-table',
          origin: { kind: 'clipboard', label: 'pasted table', title: grid.caption || null },
          html: html
        });
        return;
      }

      if (!text || !text.trim()) throw new Error('There was nothing on the clipboard.');

      const grid = Csv.toGrid(text, { delimiter: '\t' });
      ImportPreview.show({
        rows: grid.rows,
        headerRows: 1,
        warnings: grid.warnings,
        caption: null
      }, {
        filename: 'pasted-table',
        delimiter: grid.delimiter,
        origin: { kind: 'clipboard', label: 'pasted table' }
      });
    } catch (err) {
      console.error(err);
      Util.toast(err.message, 'error');
    }
  },

  /** Open with a grid already in hand — a file, or a finished paste. */
  show(grid, meta) {
    ImportPreview._state = {
      grid: grid,
      headerRows: grid.headerRows === undefined ? 1 : grid.headerRows,
      keepLinks: true,
      meta: meta || {}
    };
    ImportPreview.render();
  },

  /**
   * Re-read the pasted HTML with hyperlinks kept or stripped.
   *
   * A cell's markup is decided while `ImportHtml.parse` walks the DOM, not
   * afterwards — there is no cheap way to add or remove `[label](url)` from
   * already-flattened text — so flipping the choice re-parses the source
   * rather than editing the grid in place. `meta.html` is only set for a
   * clipboard paste, which is the one path that can carry a link at all.
   */
  setKeepLinks(keepLinks) {
    const state = ImportPreview._state;
    if (!state || !state.meta || !state.meta.html) return;
    try {
      const grid = ImportHtml.parse(state.meta.html, { keepLinks: keepLinks });
      state.grid = grid;
      state.keepLinks = keepLinks;
      ImportPreview.render();
    } catch (err) {
      console.error(err);
      Util.toast(err.message, 'error');
    }
  },

  /* ================================================================
     The preview
     ================================================================ */

  render() {
    const state = ImportPreview._state;
    if (!state || !state.grid) return;

    const rows = state.grid.rows;
    const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const nodes = [];

    for (const warning of (state.grid.warnings || [])) {
      nodes.push(Util.el('div.import-warning', { text: warning }));
    }

    nodes.push(Util.el('div.import-summary', {
      text: rows.length.toLocaleString() + ' row' + (rows.length === 1 ? '' : 's') +
        ' × ' + width + ' column' + (width === 1 ? '' : 's') + ' found' +
        (state.meta.origin && state.meta.origin.title
          ? ' — “' + Util.truncate(state.meta.origin.title, 60) + '”'
          : '')
    }));

    /* ---- The one question ---- */

    // Capped at what leaves data behind, so the control cannot be put into a
    // state that `Csv.fromTable` will refuse.
    const maxHeader = Math.min(3, Math.max(0, rows.length - 1));
    const choices = [{ value: '0', label: 'No header — name them for me' }];
    for (let n = 1; n <= maxHeader; n += 1) {
      choices.push({ value: String(n), label: n === 1 ? 'The first row' : 'The first ' + n + ' rows' });
    }

    nodes.push(Controls.field('Header', Controls.select('import.headerRows', choices,
      String(state.headerRows), (value) => {
        ImportPreview._state.headerRows = parseInt(value, 10) || 0;
        ImportPreview.render();
      }), {
      hint: state.headerRows > 1
        ? 'The last header row names the columns; the rows above it become column groups.'
        : (state.headerRows === 0
          ? 'Every row is data. The columns are named Column 1, Column 2 … and can be renamed under Structure.'
          : 'The first row names the columns.')
    }));

    if (state.grid.hasLinks) {
      nodes.push(Controls.field('Keep hyperlinks', Controls.checkbox('import.keepLinks',
        state.keepLinks, (value) => ImportPreview.setKeepLinks(value)), {
        hint: state.keepLinks
          ? 'Links stay live and editable — open a cell’s amendment popover to change the text or address.'
          : 'The link text is kept; the addresses are dropped.'
      }));
    }

    nodes.push(ImportPreview.gridTable(rows, state.headerRows, width));

    nodes.push(Util.el('div.row-actions', null, [
      Controls.button('Import', () => ImportPreview.apply(), { kind: 'primary' }),
      Controls.button('Cancel', () => ImportPreview.close(), { kind: 'ghost' })
    ]));

    App.showModal('Import table', nodes);
  },

  /**
   * The grid as it will be read: header rows marked, generated names shown
   * where there is no header, and the body truncated.
   */
  gridTable(rows, headerRows, width) {
    const table = Util.el('table.import-grid');
    const shown = Math.min(rows.length, headerRows + ImportPreview.MAX_ROWS);

    if (headerRows === 0) {
      const tr = Util.el('tr.is-generated');
      for (const name of Csv.generatedNames(width)) {
        tr.appendChild(Util.el('th', { text: name }));
      }
      table.appendChild(tr);
    }

    for (let r = 0; r < shown; r += 1) {
      const isHeader = r < headerRows;
      const tr = Util.el('tr' + (isHeader ? '.is-header' : ''));
      for (let c = 0; c < width; c += 1) {
        const text = rows[r][c] === undefined ? '' : String(rows[r][c]);
        tr.appendChild(Util.el(isHeader ? 'th' : 'td', {
          text: Util.truncate(text, 24),
          title: text
        }));
      }
      table.appendChild(tr);
    }

    const wrap = Util.el('div.import-grid-wrap', null, [table]);
    if (rows.length > shown) {
      wrap.appendChild(Util.el('div.import-summary', {
        text: '… and ' + (rows.length - shown).toLocaleString() + ' more row(s). All of them import.'
      }));
    }
    return wrap;
  },

  /* ================================================================
     Committing
     ================================================================ */

  apply() {
    const state = ImportPreview._state;
    if (!state || !state.grid) return;

    let built;
    try {
      built = Csv.fromTable(state.grid.rows, {
        headerRows: state.headerRows,
        filename: state.meta.filename,
        delimiter: state.meta.delimiter,
        origin: state.meta.origin,
        warnings: state.grid.warnings
      });
    } catch (err) {
      Util.toast(err.message, 'error');
      return;
    }

    // Closed before adopting: `adoptSource` may confirm over the top, and a
    // dialog behind a dialog cannot be reasoned about.
    ImportPreview.close();
    App.adoptSource(built.source, { spanners: built.spanners });
  }
};
