/**
 * ui/panel-export.js
 *
 * The Export panel. Every exporter reads the same ResolvedModel, so what comes
 * out matches the preview by construction rather than by coincidence.
 */

const PanelExport = {

  id: 'export',
  label: 'Export',

  _pngScale: 3,

  render(spec) {
    const panel = Util.el('div.panel');

    if (!Spec.hasData(spec)) {
      panel.appendChild(Controls.note('Import data first.'));
      return panel;
    }

    const name = Util.slug(spec.meta.name || 'table');

    /* ---- Images and markup ---- */

    panel.appendChild(Controls.section('For a document', [
      Util.el('div.field-hint', {
        text: 'SVG is true vector — real text and lines, editable in Illustrator or Inkscape, ' +
          'and safe to \\includegraphics. PNG is rendered from that same SVG.'
      }),

      Controls.button('Download SVG', () => PanelExport.svg(name), { kind: 'primary', block: true }),
      Util.el('div', { style: { height: '6px' } }),

      Controls.field('PNG scale', Controls.select('export.scale',
        [{ value: '1', label: '1× (screen)' },
          { value: '2', label: '2× (retina)' },
          { value: '3', label: '3× (~288 dpi)' },
          { value: '4', label: '4× (~384 dpi)' },
          { value: '6', label: '6× (print)' }],
        String(PanelExport._pngScale), (value) => {
          PanelExport._pngScale = parseInt(value, 10);
          App.renderRail();
        })),

      Controls.button('Download PNG', () => PanelExport.png(name), { block: true }),
      Util.el('div.field-hint', { id: 'png-size-hint', text: PanelExport.sizeHint() })
    ], { key: 'ex.image' }));

    /* ---- HTML ---- */

    panel.appendChild(Controls.section('HTML', [
      Controls.button('Download standalone page', () => PanelExport.html(name, true), { block: true }),
      Util.el('div', { style: { height: '6px' } }),
      Controls.button('Copy fragment (style + table)', () => PanelExport.copyFragment(), { block: true }),
      Util.el('div.field-hint', {
        text: 'The fragment pastes into an existing page; the standalone page opens on its own.'
      })
    ], { key: 'ex.html' }));

    /* ---- Code ---- */

    panel.appendChild(Controls.section('Code', [
      Controls.button('LaTeX (booktabs)', () => PanelExport.latex(name), { block: true }),
      Util.el('div', { style: { height: '6px' } }),
      Controls.button('R — gt pipeline', () => PanelExport.rgt(name), { block: true }),
      Util.el('div.field-hint', {
        text: 'Both open in a window you can read and copy before saving.'
      })
    ], { key: 'ex.code' }));

    /* ---- Data and project ---- */

    panel.appendChild(Controls.section('Data & project', [
      Controls.button('Save project (.tablespec.json)', () => App.saveSpec(), { block: true }),
      Util.el('div', { style: { height: '6px' } }),
      Controls.button('Export table as CSV', () => PanelExport.csv(name), { block: true }),
      Util.el('div.field-hint', {
        text: 'The project file carries the data with it, so it reopens exactly as you left it.'
      })
    ], { key: 'ex.data' }));

    return panel;
  },

  /** Estimated PNG pixel size at the current scale. */
  sizeHint() {
    const table = Util.qs('#preview-host .gt-table');
    if (!table) return '';
    const rect = table.getBoundingClientRect();
    const zoom = App.zoom || 1;
    const w = Math.round((rect.width / zoom) * PanelExport._pngScale);
    const h = Math.round((rect.height / zoom) * PanelExport._pngScale);
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
    const model = PanelExport.fullModel();
    if (!model) return;
    const content = standalone ? RenderHtml.toStandalone(model) : RenderHtml.toFragment(model);
    Util.download(name + '.html', content, 'text/html;charset=utf-8');
    Util.toast('HTML saved', 'ok');
  },

  copyFragment() {
    const model = PanelExport.fullModel();
    if (!model) return;
    Util.copy(RenderHtml.toFragment(model)).then((ok) => {
      Util.toast(ok ? 'HTML fragment copied' : 'Copy failed', ok ? 'ok' : 'error');
    });
  },

  async svg(name) {
    const model = PanelExport.fullModel();
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
    const model = PanelExport.fullModel();
    if (!model) return;
    Util.status('Rendering PNG…');
    try {
      const blob = await RenderPng.build(model, { scale: PanelExport._pngScale });
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
    const model = PanelExport.fullModel();
    if (!model) return;
    const code = ExportLatex.build(model);
    App.showCode('LaTeX (booktabs)', code, name + '.tex', 'text/x-tex');
  },

  rgt(name) {
    const model = PanelExport.fullModel();
    if (!model) return;
    const code = ExportRgt.build(Store.get(), model);
    App.showCode('R — gt pipeline', code, name + '.R', 'text/x-r');
  },

  csv(name) {
    const model = PanelExport.fullModel();
    if (!model) return;

    const columns = model.cols.map((col) => ({
      id: col.colId,
      label: col.kind === 'stub' ? (model.stubhead || col.colId) : col.label
    }));

    const rows = model.rows
      .filter((row) => row.kind === 'data')
      .map((row) => {
        const out = {};
        for (const cell of row.cells) {
          if (cell.colId) out[cell.colId] = Markup.toPlain(cell.text === null ? '' : cell.text);
        }
        return out;
      });

    Util.download(name + '.csv', Csv.toCsv(columns, rows), 'text/csv;charset=utf-8');
    Util.toast('CSV saved', 'ok');
  }
};
