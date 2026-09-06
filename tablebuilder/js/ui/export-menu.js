/**
 * ui/export-menu.js
 *
 * Export: the top bar's button, the menu it drops, and every exporter behind
 * it. Each exporter reads the same ResolvedModel, so what comes out matches
 * the preview by construction rather than by coincidence.
 *
 * This used to be a panel in the left rail, which made the top-right Export
 * button a control whose entire effect happened in the opposite corner of the
 * screen — and its caret promised a menu that did not exist. There is now one
 * surface instead of a button pointing at another one.
 *
 * The menu is not a plain list: the PNG row carries its own scale select and a
 * live pixel-size readout, which is why this builds fields rather than reusing
 * a generic menu-item helper.
 */

const ExportMenu = {

  /** Chosen PNG scale, kept across openings. */
  _pngScale: 3,

  /* ================================================================
     The menu
     ================================================================ */

  toggle() {
    const button = Util.qs('#btn-export');
    Popover.toggle(button, () => ExportMenu.body(Store.get()), { className: 'export-menu' });
  },

  body(spec) {
    const wrap = Util.el('div.export-menu-body');

    if (!Spec.hasData(spec)) {
      wrap.appendChild(Util.el('div.export-menu-note', { text: 'Import data first.' }));
      return wrap;
    }

    const name = Util.slug(spec.meta.name || 'table');
    const group = (label) => wrap.appendChild(Util.el('div.export-menu-group', { text: label }));

    /* ---- Images ---- */

    group('For a document');

    wrap.appendChild(Controls.button('Download SVG', Popover.act(() => ExportMenu.svg(name)),
      { kind: 'primary', block: true }));
    wrap.appendChild(Util.el('div.export-menu-hint', {
      text: 'True vector — real text and lines, editable in Illustrator or Inkscape, ' +
        'and safe to \\includegraphics.'
    }));

    wrap.appendChild(Controls.button('Download PNG', Popover.act(() => ExportMenu.png(name)),
      { block: true }));
    wrap.appendChild(Controls.field('Scale', Controls.select('export.scale',
      [{ value: '1', label: '1× (screen)' },
        { value: '2', label: '2× (retina)' },
        { value: '3', label: '3× (~288 dpi)' },
        { value: '4', label: '4× (~384 dpi)' },
        { value: '6', label: '6× (print)' }],
      String(ExportMenu._pngScale), (value) => {
        ExportMenu._pngScale = parseInt(value, 10);
        // Only the size readout depends on this, and the menu owns it — so
        // it is rewritten in place rather than rebuilding the menu, which
        // would drop the select the pointer is still inside.
        const hint = Util.qs('#png-size-hint');
        if (hint) hint.textContent = ExportMenu.sizeHint();
      })));
    wrap.appendChild(Util.el('div.export-menu-hint', {
      id: 'png-size-hint', text: ExportMenu.sizeHint()
    }));

    /* ---- HTML ---- */

    group('HTML');

    wrap.appendChild(Controls.button('Download standalone page',
      Popover.act(() => ExportMenu.html(name, true)), { block: true }));
    wrap.appendChild(Controls.button('Copy styled table',
      Popover.act(() => ExportMenu.copyFragment()), { block: true }));
    wrap.appendChild(Util.el('div.export-menu-hint', {
      text: 'Pastes as a finished table into a document or a rich editor, and as source ' +
        'into a code box. The standalone page opens on its own.'
    }));

    wrap.appendChild(Controls.button('Copy for WordPress',
      Popover.act(() => ExportMenu.copyWordPress()), { block: true }));
    wrap.appendChild(Util.el('div.export-menu-hint', {
      text: 'Pastes into a post as one Custom HTML block with the styling intact. ' +
        'WordPress’s own table block cannot hold this much of it, so the table arrives ' +
        'as HTML rather than as something you can go on editing in place.'
    }));

    /* ---- Code ---- */

    group('Code');

    wrap.appendChild(Controls.button('LaTeX (booktabs)…',
      Popover.act(() => ExportMenu.latex(name)), { block: true }));
    wrap.appendChild(Controls.button('R — gt pipeline…',
      Popover.act(() => ExportMenu.rgt(name)), { block: true }));
    wrap.appendChild(Util.el('div.export-menu-hint', {
      text: 'Both open in a window you can read and copy before saving.'
    }));

    /* ---- Data ---- */

    // The project file is not an export — it is the thing you are working on,
    // and it lives under Save project in the top bar. Only the table leaves
    // through this menu.
    group('Data');

    wrap.appendChild(Controls.button('Export table as CSV',
      Popover.act(() => ExportMenu.csv(name)), { block: true }));
    wrap.appendChild(Util.el('div.export-menu-hint', {
      text: 'The table as rendered: current sort, formatting, merges, renames, hidden ' +
        'columns and totals, not the file you imported.'
    }));

    return wrap;
  },

  /** Estimated PNG pixel size at the current scale. */
  sizeHint() {
    const table = Util.qs('#preview-host .gt-table');
    if (!table) return '';
    const rect = table.getBoundingClientRect();
    const zoom = App.zoom || 1;
    const w = Math.round((rect.width / zoom) * ExportMenu._pngScale);
    const h = Math.round((rect.height / zoom) * ExportMenu._pngScale);
    return 'about ' + w + ' × ' + h + ' px';
  },

  /* ================================================================
     Exporters
     ================================================================ */

  /** Build the model without the preview's row cap. */
  fullModel() {
    const model = Compute.run(Store.get(), { limitRows: false });
    if (!model.ok) {
      Util.toast(model.error || 'Nothing to export', 'error');
      return null;
    }
    return model;
  },

  html(name, standalone) {
    const model = ExportMenu.fullModel();
    if (!model) return;
    const content = standalone ? RenderHtml.toStandalone(model) : RenderHtml.toFragment(model);
    Util.download(name + '.html', content, 'text/html;charset=utf-8');
    Util.toast('HTML saved', 'ok');
  },

  /**
   * One copy, two flavours, because the two destinations want opposite things.
   *
   * Anything that pastes formatting reads the HTML flavour and has no
   * stylesheet to put a `<style>` in, so it gets the flattened table. Anything
   * that pastes text is a person about to read and edit HTML, so it gets the
   * `<style>` and the table — the same look, said once instead of on every
   * cell, and legible.
   */
  copyFragment() {
    const model = ExportMenu.fullModel();
    if (!model) return;
    Util.copyRich(RenderHtml.toInlineFragment(model), RenderHtml.toFragment(model)).then((ok) => {
      Util.toast(ok ? 'Table copied' : 'Copy failed', ok ? 'ok' : 'error');
    });
  },

  /**
   * The same table again, in the one form WordPress will keep.
   *
   * Both flavours carry the delimiters here, where the other copy gives each
   * flavour what its own kind of destination wants. Every place this is aimed
   * at reads block markup: the post canvas takes the HTML flavour, the Code
   * Editor takes the text one, and a Custom HTML box pasted into by hand gets
   * two comments it renders as nothing.
   */
  copyWordPress() {
    const model = ExportMenu.fullModel();
    if (!model) return;
    const block = RenderHtml.toWordPressBlock(model);
    Util.copyRich(block, block).then((ok) => {
      Util.toast(ok ? 'WordPress block copied' : 'Copy failed', ok ? 'ok' : 'error');
    });
  },

  async svg(name) {
    const model = ExportMenu.fullModel();
    if (!model) return;
    Util.status('Building SVG…');
    try {
      const svg = await RenderSvg.build(model);
      Util.download(name + '.svg', svg, 'image/svg+xml;charset=utf-8');
      Util.toast('SVG saved', 'ok');
    } catch (err) {
      console.error(err);
      Util.toast('SVG export failed: ' + err.message, 'error');
    } finally {
      Util.status('ready');
    }
  },

  async png(name) {
    const model = ExportMenu.fullModel();
    if (!model) return;
    Util.status('Rendering PNG…');
    try {
      const blob = await RenderPng.build(model, { scale: ExportMenu._pngScale });
      Util.download(name + '.png', blob);
      Util.toast('PNG saved', 'ok');
    } catch (err) {
      console.error(err);
      Util.toast('PNG export failed: ' + err.message, 'error');
    } finally {
      Util.status('ready');
    }
  },

  latex(name) {
    const model = ExportMenu.fullModel();
    if (!model) return;
    const code = ExportLatex.build(model);
    App.showCode('LaTeX (booktabs)', code, name + '.tex', 'text/x-tex');
  },

  rgt(name) {
    const model = ExportMenu.fullModel();
    if (!model) return;
    const code = ExportRgt.build(Store.get(), model);
    App.showCode('R — gt pipeline', code, name + '.R', 'text/x-r');
  },

  csv(name) {
    const model = ExportMenu.fullModel();
    if (!model) return;
    Util.download(name + '.csv', Csv.fromModel(model), 'text/csv;charset=utf-8');
    Util.toast('CSV saved — the table as rendered', 'ok');
  }
};
