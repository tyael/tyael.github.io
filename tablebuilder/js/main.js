/**
 * main.js
 *
 * The app controller: boot, the render loop, file handling and chrome.
 *
 * The render loop is deliberately dumb — any change to the spec recomputes the
 * model and rebuilds the preview and the panels from scratch. There is no
 * diffing anywhere. It stays fast because compute() is pure and the tables are
 * small, and it stays correct because there is only ever one path from state to
 * pixels.
 */

const App = {

  /** The panels in the left rail, in tab order. */
  panels: null,

  activePanel: 'data',
  essentialIds: null,
  moreOpen: false,
  model: null,
  zoom: 1,

  /* ================================================================
     Boot
     ================================================================ */

  init() {
    // Essentials first — they fill the rail's five-column grid exactly — then
    // the advanced tier behind a disclosure.
    App.panels = [
      PanelData, PanelStructure, PanelContent, PanelFormat, PanelExport,
      PanelReshape, PanelColor, PanelSummaries, PanelStyle, PanelOptions
    ];
    App.essentialIds = ['data', 'structure', 'content', 'format', 'export'];

    App.buildTabs();
    App.wireChrome();
    App.wireKeyboard();

    Store.subscribe(App.onChange);

    const restored = Store.loadSaved();
    if (restored && Spec.hasData(restored)) {
      Store.init(restored);
      Util.toast('Restored your last session', 'ok');
    } else {
      Store.init(Spec.create());
    }
  },

  /**
   * Every selection change lands here — the counterpart to `onChange`.
   *
   * There are two sources of mutable state, and only the spec drives the render
   * loop: selecting a cell changes no spec, so `_render` never runs. This is
   * the whole update path for the other one.
   *
   * **Anything that reads `Selection` must be refreshed from this function.**
   * Three separate bugs came from views that read the selection and were left
   * out of the update path — the highlight (b107764), the toolbar chip, and the
   * footnote buttons — each fixed in a different file. `Selection` deliberately
   * has no subscriber list now, so this is the only place to add to.
   */
  onSelectionChange() {
    // The table's DOM does not change, only which cells carry the highlight —
    // so this repaints rather than re-rendering the preview.
    Selection.paint(Selection.liveTable());

    App.renderRail();
    App.renderInspector();
    App.updateSelectionChip();
  },

  /** Every spec change lands here. */
  onChange(spec, reason) {
    App.render();
    App.autosave();

    // Import and undo can invalidate a selection that pointed at a column or
    // row which no longer exists.
    if (reason === 'replace' || reason === 'init') {
      Selection.clear();

      // A spec opened or restored with an advanced-tier feature already in use
      // should not land with its own configuration hidden — but this is a
      // one-shot nudge into the user's own preference, not a per-render force:
      // an Inspector edit that appends a style rule on every later keystroke
      // must not re-open a tier the user just collapsed. See `updateTabs`.
      if (App.moreTierUsed(spec)) App.moreOpen = true;
    }
  },

  autosave: null,   // assigned below, needs Util.debounce at call time

  /* ================================================================
     Rendering
     ================================================================ */

  render: null,     // assigned below (rAF-coalesced)

  _render() {
    const spec = Store.get();

    // Make sure any font the spec references is in the document before the
    // preview is laid out — otherwise the first paint uses fallback metrics.
    if (Fonts.sync(spec)) {
      Fonts.ready().then(() => App.render());
    }

    App.model = Compute.run(spec);
    App.renderPreview();
    App.renderPanels();
    App.updateChrome();
  },

  renderPreview() {
    const host = Util.qs('#preview-host');
    const model = App.model;

    Util.clear(host);

    if (!model.ok) {
      host.appendChild(App.emptyState(model.error));
      App.setPreviewStyle('');
      return;
    }

    const paper = Util.el('div.paper' + (App.canvasDark ? '.is-dark' : ''));
    const rendered = RenderHtml.render(model, { selectable: App.selectMode !== false, tableId: 'gt-preview' });

    App.setPreviewStyle(rendered.css);
    paper.appendChild(rendered.node);

    // The caption labels the figure rather than the table, so it renders below
    // it — the same node the standalone HTML export puts in its <figure>.
    const caption = RenderHtml.captionNode(model, rendered.id);
    if (caption) paper.appendChild(caption);

    if (model.truncated) {
      paper.appendChild(Util.el('div.preview-notice', {
        text: 'Showing the first ' + Compute.MAX_PREVIEW_ROWS.toLocaleString() + ' of ' +
          model.totalRows.toLocaleString() + ' rows. Exports include every row.'
      }));
    }

    for (const warning of model.warnings) {
      paper.appendChild(Util.el('div.preview-notice', { text: warning }));
    }

    host.appendChild(paper);

    Selection.attach(rendered.node);
    Selection.attachResizers(host, rendered.node, model);

    host.style.transform = 'scale(' + App.zoom + ')';
  },

  /** The generated table CSS lives in one stylesheet in the document head. */
  setPreviewStyle(css) {
    let node = document.getElementById('preview-style');
    if (!node) {
      node = Util.el('style', { id: 'preview-style' });
      document.head.appendChild(node);
    }
    node.textContent = css;
  },

  emptyState(message) {
    const wrap = Util.el('div.empty-state');
    wrap.appendChild(Util.el('div.empty-mark', { text: '▦' }));
    wrap.appendChild(Util.el('h2', { text: message || 'Nothing to show' }));

    if (!Spec.hasData(Store.get())) {
      wrap.appendChild(Util.el('p', { text: 'Import a CSV to begin, or load one of the samples.' }));
      const actions = Util.el('div.empty-actions');
      actions.appendChild(Controls.button('Import CSV', () => App.pickCsv(), { kind: 'primary' }));
      for (const sample of [
        { path: 'data/samples/long.csv', label: 'Sample: long / tidy' },
        { path: 'data/samples/wide.csv', label: 'Sample: wide' },
        { path: 'data/samples/gtcars.csv', label: 'Sample: gtcars' }
      ]) {
        actions.appendChild(Controls.button(sample.label, () => App.loadSample(sample.path)));
      }
      wrap.appendChild(actions);
    }

    return wrap;
  },

  renderPanels() {
    App.renderRail();
    App.renderInspector();
  },

  renderRail() {
    const host = Util.qs('#rail-body');
    Controls.rememberFocus(host);
    Util.clear(host);

    const panel = App.panels.find((p) => p.id === App.activePanel) || App.panels[0];
    host.appendChild(panel.render(Store.get()));

    Controls.restoreFocus(host);
    App.updateTabs();
  },

  renderInspector() {
    const host = Util.qs('#inspector-body');
    Controls.rememberFocus(host);
    Util.clear(host);
    host.appendChild(Inspector.render(Store.get()));
    Controls.restoreFocus(host);
  },

  /* ================================================================
     Chrome
     ================================================================ */

  buildTabs() {
    const essentials = Util.qs('#rail-tabs');
    const more = Util.qs('#rail-tabs-more');
    Util.clear(essentials);
    Util.clear(more);

    for (const panel of App.panels) {
      const host = App.essentialIds.indexOf(panel.id) >= 0 ? essentials : more;
      host.appendChild(Util.el('button.rail-tab', {
        text: panel.label,
        title: panel.label,
        dataset: { panel: panel.id },
        on: {
          click: () => {
            App.activePanel = panel.id;
            App.renderRail();
          }
        }
      }));
    }

    const toggle = Util.qs('#rail-more-toggle');
    if (!toggle.dataset.wired) {
      toggle.dataset.wired = '1';
      toggle.addEventListener('click', () => {
        App.moreOpen = !App.moreOpen;
        App.updateTabs();
      });
    }
  },

  /** True when the spec uses anything that lives in the advanced tier. */
  moreTierUsed(spec) {
    if (!spec) return false;
    if (spec.reshape && spec.reshape.mode !== 'none') return true;
    if (spec.dataColor && spec.dataColor.length) return true;
    if (spec.summaries &&
      ((spec.summaries.groups || []).length || (spec.summaries.grand || []).length)) return true;
    if (spec.styleRules && spec.styleRules.length) return true;
    return false;
  },

  updateTabs() {
    for (const tab of Util.qsa('.rail-tab')) {
      tab.classList.toggle('is-active', tab.dataset.panel === App.activePanel);
    }

    // The only structurally necessary force: the active panel must never sit
    // behind a closed disclosure. Whether a spec's own advanced-tier usage
    // opens the group lives in `App.moreOpen` instead (see `onChange`'s
    // one-shot check) — computing it fresh from `moreTierUsed` on every render
    // would re-open the tier on every Inspector edit and never let the user
    // collapse it again. `moreOpen` stays the user's own preference throughout.
    const forced = App.essentialIds.indexOf(App.activePanel) < 0;
    const open = App.moreOpen || forced;

    Util.qs('#rail-tabs-more').classList.toggle('is-hidden', !open);
    const toggle = Util.qs('#rail-more-toggle');
    toggle.textContent = open ? 'More ▴' : 'More ▾';
  },

  updateChrome() {
    const spec = Store.get();

    Util.qs('#btn-undo').disabled = !Store.canUndo();
    Util.qs('#btn-redo').disabled = !Store.canRedo();

    const label = Spec.hasData(spec)
      ? spec.source.filename + '  ·  ' + spec.source.rows.length + '×' + spec.source.columns.length
      : 'no data';
    Util.qs('#file-label').textContent = label;

    App.updateSelectionChip();

    Util.qs('#zoom-value').textContent = Math.round(App.zoom * 100) + '%';

    const right = Util.qs('#status-right');
    if (App.model && App.model.ok) {
      right.textContent = App.model.cols.length + ' cols · ' +
        App.model.totalRows.toLocaleString() + ' rows · ' +
        spec.styleRules.length + ' style rules';
    } else {
      right.textContent = '';
    }
  },

  /**
   * The chip is repainted from Selection, not only from a render: selecting a
   * cell changes no spec, so `_render` never runs and the chip would otherwise
   * keep showing the previous selection.
   */
  updateSelectionChip() {
    const chip = Util.qs('#selection-chip');
    if (!chip) return;
    Util.clear(chip);

    const plain = Selection.describePlain();
    chip.appendChild(plain
      ? Util.el('span.chip.chip-static', {
        text: Util.truncate(plain, 52),
        title: Selection.describe() || plain
      })
      : Util.el('span.chip.chip-empty', { text: 'nothing selected' }));
  },

  wireChrome() {
    Util.qs('#btn-import').addEventListener('click', () => App.pickCsv());
    const import2 = Util.qs('#btn-import-2');
    if (import2) import2.addEventListener('click', () => App.pickCsv());

    Util.qs('#btn-undo').addEventListener('click', () => Store.undo());
    Util.qs('#btn-redo').addEventListener('click', () => Store.redo());
    Util.qs('#btn-open-spec').addEventListener('click', () => Util.qs('#file-spec').click());
    Util.qs('#btn-save-spec').addEventListener('click', () => App.saveSpec());

    Util.qs('#btn-export').addEventListener('click', () => {
      App.activePanel = 'export';
      App.renderRail();
    });

    Util.qs('#file-csv').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) App.importCsv(file);
      e.target.value = '';
    });

    Util.qs('#file-spec').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) App.openSpec(file);
      e.target.value = '';
    });

    for (const button of Util.qsa('[data-sample]')) {
      button.addEventListener('click', () => App.loadSample(button.dataset.sample));
    }

    /* ---- Stage toolbar ---- */

    Util.qs('#btn-zoom-in').addEventListener('click', () => App.setZoom(App.zoom * 1.15));
    Util.qs('#btn-zoom-out').addEventListener('click', () => App.setZoom(App.zoom / 1.15));
    Util.qs('#btn-zoom-fit').addEventListener('click', () => App.zoomToFit());

    Util.qs('#toggle-canvas-dark').addEventListener('change', (e) => {
      App.canvasDark = e.target.checked;
      App.renderPreview();
    });

    Util.qs('#toggle-select').addEventListener('change', (e) => {
      App.selectMode = e.target.checked;
      if (!App.selectMode) Selection.clear();
      App.renderPreview();
    });

    // Clicking the canvas around the table clears the selection. The table's
    // own handler only sees clicks that land inside it, so without this a
    // selection made in the table can never be dismissed by clicking away.
    Util.qs('#stage-canvas').addEventListener('click', (e) => {
      if (e.target.closest('.gt-cell') || e.target.closest('.col-resizer')) return;
      if (e.shiftKey || e.metaKey || e.ctrlKey) return;
      Selection.clear();
    });

    /* ---- Modal ---- */

    Util.qs('#modal-close').addEventListener('click', () => App.closeModal());
    Util.qs('#modal-backdrop').addEventListener('click', (e) => {
      if (e.target.id === 'modal-backdrop') App.closeModal();
    });

    /* ---- Drag and drop a CSV anywhere ---- */

    document.addEventListener('dragover', (e) => { e.preventDefault(); });
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      if (/\.json$/i.test(file.name)) App.openSpec(file);
      else App.importCsv(file);
    });
  },

  wireKeyboard() {
    document.addEventListener('keydown', (e) => {
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) Store.redo();
        else Store.undo();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        App.saveSpec();
        return;
      }

      if (e.key === 'Escape') {
        if (!Util.qs('#modal-backdrop').hidden) { App.closeModal(); return; }
        if (!inField) Selection.clear();
      }
    });
  },

  /* ================================================================
     Zoom
     ================================================================ */

  setZoom(value) {
    App.zoom = Util.clamp(value, 0.25, 4);
    Util.qs('#preview-host').style.transform = 'scale(' + App.zoom + ')';
    Util.qs('#zoom-value').textContent = Math.round(App.zoom * 100) + '%';
    // Resize handles are positioned in unscaled pixels, so they need rebuilding.
    const table = Util.qs('#preview-host .gt-table');
    if (table) Selection.attachResizers(Util.qs('#preview-host'), table, App.model);
  },

  zoomToFit() {
    const table = Util.qs('#preview-host .gt-table');
    const scroll = Util.qs('#stage-scroll');
    if (!table || !scroll) return;

    const available = scroll.clientWidth - 72;
    const natural = table.getBoundingClientRect().width / App.zoom;
    App.setZoom(natural > 0 ? Math.min(2, available / natural) : 1);
  },

  /* ================================================================
     Files
     ================================================================ */

  pickCsv() {
    Util.qs('#file-csv').click();
  },

  async importCsv(file) {
    try {
      Util.status('Parsing ' + file.name + '…');
      const text = await Util.readFile(file);
      App.adoptSource(Csv.parse(text, file.name));
    } catch (err) {
      console.error(err);
      Util.toast('Could not read that file: ' + err.message, 'error');
    } finally {
      Util.status('ready');
    }
  },

  async loadSample(path) {
    try {
      Util.status('Loading ' + path + '…');
      const response = await fetch(path);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const text = await response.text();
      App.adoptSource(Csv.parse(text, path.split('/').pop()));
    } catch (err) {
      console.error(err);
      Util.toast('Could not load the sample — samples need the page served over http. ' +
        'Use Import CSV instead.', 'error');
    } finally {
      Util.status('ready');
    }
  },

  /** Replace the data, keeping settings that still make sense. */
  adoptSource(source) {
    const current = Store.get();
    const hadData = Spec.hasData(current);

    if (hadData && !window.confirm(
      'Replace the current data with ' + source.filename + '?\n\n' +
      'Settings that still apply to the new columns are kept.')) {
      return;
    }

    let spec;
    if (hadData) {
      spec = Util.clone(current);
      spec.source = source;
      spec.reshape = Spec.create().reshape;
      Spec.adoptColumns(spec, source.columns);
      spec.structure.columnOrder = source.columns.map((c) => c.id);
    } else {
      spec = Spec.fromSource(source);
    }

    Store.replace(spec, 'replace');

    if (source.warnings && source.warnings.length) {
      Util.toast(source.warnings[0], 'error', 5000);
    } else {
      Util.toast('Loaded ' + source.rows.length + ' rows — pick a look under Data › Look', 'ok');
    }

    App.activePanel = 'structure';
    App.renderRail();
  },

  saveSpec() {
    const spec = Store.get();
    const name = Util.slug(spec.meta.name || 'table');
    Util.download(name + '.tablespec.json', JSON.stringify(spec, null, 2),
      'application/json;charset=utf-8');
    Util.toast('Project saved', 'ok');
  },

  async openSpec(file) {
    try {
      const text = await Util.readFile(file);
      const spec = Spec.migrate(JSON.parse(text));
      Store.replace(spec, 'replace');
      Util.toast('Opened ' + file.name, 'ok');
    } catch (err) {
      console.error(err);
      Util.toast('That is not a valid project file: ' + err.message, 'error');
    }
  },

  reset() {
    if (!window.confirm('Discard this table and start over?')) return;
    Store.clearSaved();
    Store.replace(Spec.create(), 'replace');
    App.activePanel = 'data';
    App.renderRail();
  },

  /* ================================================================
     Modal
     ================================================================ */

  /** Show an arbitrary node in the modal. */
  showModal(title, node) {
    const body = Util.qs('#modal-body');
    Util.qs('#modal-title').textContent = title;
    Util.clear(body);
    body.appendChild(node);
    Util.qs('#modal-backdrop').hidden = false;
  },

  showCode(title, code, filename, mime) {
    const body = Util.qs('#modal-body');
    Util.qs('#modal-title').textContent = title;
    Util.clear(body);

    body.appendChild(Util.el('div.row-actions', { style: { marginBottom: '10px' } }, [
      Controls.button('Copy', () => {
        Util.copy(code).then((ok) => Util.toast(ok ? 'Copied' : 'Copy failed', ok ? 'ok' : 'error'));
      }, { kind: 'primary' }),
      Controls.button('Download ' + filename, () => {
        Util.download(filename, code, mime);
      })
    ]));

    body.appendChild(Util.el('pre.code-block', { text: code }));
    Util.qs('#modal-backdrop').hidden = false;
  },

  closeModal() {
    Util.qs('#modal-backdrop').hidden = true;
  },

  /* ================================================================
     Shared lookups for the panels
     ================================================================ */

  /** The working columns, post-reshape, as {id, label, type}. */
  workingColumns() {
    const spec = Store.get();
    if (!Spec.hasData(spec)) return [];
    const derived = Reshape.derive(spec.source, spec.reshape);
    return derived.columns.map((col) => ({
      id: col.id,
      label: spec.structure.labels[col.id] || col.shortName || col.name,
      type: col.type
    }));
  },

  workingColumnsById() {
    const spec = Store.get();
    if (!Spec.hasData(spec)) return {};
    const derived = Reshape.derive(spec.source, spec.reshape);
    const out = {};
    for (const col of derived.columns) out[col.id] = col;
    return out;
  },

  workingRows() {
    const spec = Store.get();
    if (!Spec.hasData(spec)) return [];
    return Reshape.derive(spec.source, spec.reshape).rows;
  },

  /** Row-group labels in display order. */
  groupLabels() {
    if (App.model && App.model.groups) return App.model.groups.map((g) => g.id);
    return [];
  },

  groupCount(label) {
    if (!App.model || !App.model.groups) return 0;
    const group = App.model.groups.find((g) => g.id === label);
    return group ? group.count : 0;
  }
};

/* Coalesce renders into one per frame, and throttle autosave. */
App.render = Util.raf(App._render);
App.autosave = Util.debounce(() => Store.save(), 900);

document.addEventListener('DOMContentLoaded', () => App.init());
