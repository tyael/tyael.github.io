/**
 * import-html.js
 *
 * A copied HTML table into the rectangle of strings `Csv.fromTable` wants.
 *
 * Worth doing rather than falling back to the plain-text flavour, because the
 * HTML carries what tab-separated text physically cannot: which rows are
 * header, how cells are merged, and — from a spreadsheet — the underlying
 * value behind a formatted one.
 *
 * Two halves, deliberately:
 *
 *   `read`   walks a DOM table into raw cells with their spans. Needs a
 *            document, so it is exercised by the browser suite.
 *   `expand` turns those into a dense grid and decides which rows are header.
 *            Pure, and where every judgement call lives, so it is exercised by
 *            the DOM-free suite.
 */

const ImportHtml = {

  /**
   * Parse an HTML string and return the grid of its best table.
   * @param {{keepLinks?: boolean}} [opts] `keepLinks` writes a cell's anchors
   *   into it as `[label](url)` markup instead of dropping them to label text.
   * @returns {{rows: Array<Array<string>>, headerRows, caption, warnings, tables, hasLinks}}
   */
  parse(html, opts) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const tables = Util.qsa('table', doc);
    if (!tables.length) throw new Error('There is no table in what you pasted.');

    const table = ImportHtml.pick(tables);
    const out = ImportHtml.expand(ImportHtml.read(table, opts));
    out.caption = ImportHtml.captionOf(table);
    out.tables = tables.length;
    out.hasLinks = ImportHtml.hasLinks(table);
    return out;
  },

  /**
   * Whether the table carries a link `keepLinks` could actually keep.
   *
   * A relative `href` cannot be resolved into an address — a `DOMParser`
   * document has no base URI to resolve it against — so it is not counted
   * here, and `textOf` leaves such a link as its label text regardless of
   * `keepLinks`. This is what decides whether the import dialog offers the
   * choice at all.
   */
  hasLinks(table) {
    return Util.qsa('a[href]', table)
      .some((a) => Markup.LINK_URL.test(a.getAttribute('href') || ''));
  },

  /**
   * The table that is most likely the one the user meant.
   *
   * Innermost first: a page that wraps its content in layout tables gives the
   * outer one a higher cell count than the real table inside it, so "biggest"
   * on its own picks the wrapper and returns the whole page as one row.
   */
  pick(tables) {
    const leaves = tables.filter((t) => !t.querySelector('table'));
    const pool = leaves.length ? leaves : tables;
    return pool.reduce((best, t) => {
      const size = t.querySelectorAll('td, th').length;
      return size > best.size ? { table: t, size: size } : best;
    }, { table: pool[0], size: -1 }).table;
  },

  /** A `<caption>`, as a possible title. */
  captionOf(table) {
    const caption = table.querySelector('caption');
    return caption ? ImportHtml.textOf(caption) : null;
  },

  /**
   * Cell text, with the things that are whitespace to a reader treated as
   * whitespace: `<br>` becomes a space rather than closing up the words
   * either side of it, and a non-breaking space becomes an ordinary one so it
   * does not survive into a column id or defeat a number parse.
   *
   * With `opts.keepLinks`, an anchor becomes `[label](url)` — this markup's
   * own link construct — rather than being read down to its label text.
   * `Markup.linkMarkup` both builds and validates it, so a label that cannot
   * round-trip (an unmatched `]`, most likely) falls back to plain text the
   * same way an unusable `href` does, rather than writing something broken
   * into the cell.
   */
  textOf(el, opts) {
    const copy = el.cloneNode(true);
    for (const br of Util.qsa('br', copy)) {
      br.parentNode.replaceChild(copy.ownerDocument.createTextNode(' '), br);
    }
    if (opts && opts.keepLinks) {
      for (const a of Util.qsa('a[href]', copy)) {
        const url = a.getAttribute('href');
        const label = a.textContent;
        const markup = url && Markup.LINK_URL.test(url) ? Markup.linkMarkup(label, url) : null;
        a.parentNode.replaceChild(copy.ownerDocument.createTextNode(markup || label), a);
      }
    }
    return String(copy.textContent || '')
      .replace(/ /g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  /**
   * The underlying value behind a displayed one, where the source left it.
   *
   * Excel writes `x:num="1234.5678"` beside a displayed `1,234.57`, and Google
   * Sheets writes `data-sheets-value='{"1":3,"3":1234.5}'`. Taking it keeps the
   * precision the display rounded away, and keeps a value that arithmetic can
   * be done on rather than one that has to be un-formatted first.
   *
   * **A date is the exception.** A spreadsheet's underlying value for a date is
   * a serial number, so 1/1/2024 would import as 45292 — losing the very thing
   * that makes it a date. Where the display reads as a date, the display wins.
   *
   * **And the value may not show fewer decimals than the display did**, which
   * is what `atLeastAsPrecise` is for. Taking the value is meant to add
   * precision, never to remove it.
   */
  valueOf(el, text) {
    if (Csv.isDateish(text)) return text;

    if (el.hasAttribute && el.hasAttribute('x:num')) {
      const raw = el.getAttribute('x:num');
      if (raw !== '' && raw !== null && isFinite(parseFloat(raw))) {
        return ImportHtml.atLeastAsPrecise(parseFloat(raw), text);
      }
    }

    const sheets = el.getAttribute && el.getAttribute('data-sheets-value');
    if (sheets) {
      try {
        const parsed = JSON.parse(sheets);
        if (parsed && typeof parsed['3'] === 'number' && isFinite(parsed['3'])) {
          return ImportHtml.atLeastAsPrecise(parsed['3'], text);
        }
      } catch (e) { /* not ours to interpret */ }
    }

    return text;
  },

  /**
   * The underlying value, written to at least as many decimals as the display.
   *
   * **A spreadsheet's number format is a statement about precision.** A column
   * of "% of GDP" formatted `0.0` says one decimal, and the cell holding
   * exactly 10 shows `10.0`. Excel then writes `x:num="10"` beside it, and
   * taking that alone put a bare `10` in a column where every other cell had a
   * decimal — the whole point of preferring the underlying value being to
   * *keep* precision the display lost. A table of Australian budget
   * projections came in with 132 of its cells silently rounded that way.
   *
   * So the value still wins on digits it actually has: where the display
   * rounded `1,234.57` off a stored `1234.5678`, the stored digits stay. This
   * only ever pads back the zeros the display was already showing.
   */
  atLeastAsPrecise(num, text) {
    const shown = ImportHtml.decimalsIn(text);
    return shown > ImportHtml.decimalsIn(String(num))
      ? num.toFixed(Math.min(shown, 20))
      : String(num);
  },

  /**
   * Digits after the decimal point in a number as written, else 0.
   *
   * Tolerant of what a display carries around a number — a currency symbol, an
   * opening parenthesis, thousands separators — because the question is only
   * how many decimals were on show.
   */
  decimalsIn(text) {
    const match = /^[^\d]*[\d,\s]*\.(\d+)/.exec(String(text));
    return match ? match[1].length : 0;
  },

  /**
   * Walk a table element into raw rows of cells, spans intact.
   * @returns {Array<Array<{text, header, colspan, rowspan}>>}
   */
  read(table, opts) {
    const span = (el, name) => {
      const n = parseInt(el.getAttribute(name), 10);
      // A colspan of 1000 is legal HTML and would build a grid nothing can
      // hold; the cap is well past any real table.
      return isFinite(n) && n > 0 ? Math.min(n, 200) : 1;
    };

    return Util.qsa('tr', table).map((tr) => {
      const inHead = !!(tr.parentNode && tr.parentNode.tagName === 'THEAD');
      return Util.qsa('td, th', tr)
        // A cell belonging to a nested table is not this table's cell.
        .filter((cell) => cell.closest('table') === table)
        .map((cell) => {
          const text = ImportHtml.textOf(cell, opts);
          return {
            text: ImportHtml.valueOf(cell, text),
            header: inHead || cell.tagName === 'TH',
            colspan: span(cell, 'colspan'),
            rowspan: span(cell, 'rowspan')
          };
        });
    }).filter((row) => row.length);
  },

  /**
   * Raw rows into a dense rectangle, and a guess at how many rows are header.
   *
   * **A merged cell repeats into everything it covers.** Leaving holes would
   * make the grid ragged, and every consumer downstream — sorting, summaries,
   * the whole compute step — needs a value per column per row. Repeating is
   * also what the data means: a cell spanning three rows is a label for all
   * three. It is counted and warned about, because it is a real change to
   * what was copied.
   */
  expand(raw) {
    const grid = [];
    const at = (r, c) => (grid[r] ? grid[r][c] : undefined);
    let merged = 0;

    raw.forEach((cells, r) => {
      if (!grid[r]) grid[r] = [];
      let c = 0;

      for (const cell of cells) {
        while (at(r, c) !== undefined) c += 1;
        if (cell.rowspan > 1 || cell.colspan > 1) merged += 1;

        for (let dr = 0; dr < cell.rowspan; dr += 1) {
          const row = r + dr;
          if (!grid[row]) grid[row] = [];
          for (let dc = 0; dc < cell.colspan; dc += 1) {
            grid[row][c + dc] = { text: cell.text, header: cell.header };
          }
        }
        c += cell.colspan;
      }
    });

    const width = grid.reduce((max, row) => Math.max(max, row.length), 0);
    const rows = grid.map((row) => {
      const out = [];
      for (let c = 0; c < width; c += 1) out.push(row[c] ? row[c].text : '');
      return out;
    });

    // Leading rows made entirely of header cells. A table that marks nothing
    // as a header gets 1, matching what every other importer assumes — and the
    // preview is where that is confirmed rather than taken on trust.
    let headerRows = 0;
    for (const row of grid) {
      const filled = row.filter((cell) => cell && cell.text !== '');
      if (!filled.length || !filled.every((cell) => cell.header)) break;
      headerRows += 1;
    }
    if (!headerRows) headerRows = 1;

    const warnings = [];
    if (merged) {
      warnings.push(merged + ' merged cell(s) were repeated across every cell they covered.');
    }

    return { rows: rows, headerRows: headerRows, warnings: warnings, caption: null };
  }
};
