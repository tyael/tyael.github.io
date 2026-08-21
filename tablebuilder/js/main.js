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

  /** The surface behind the table: 'light', 'dark' or 'checker'. */
  canvasSurface: 'light',

  /**
   * Whether that surface is a sheet the size of the table, or the whole stage.
   *
   * View state, like `canvasSurface`, `selectMode` and `zoom`: not in the spec,
   * so it stays off the undo stack and out of a saved `.tablespec.json`. It
   * changes nothing about the table and nothing any exporter can see.
   */
  canvasFill: false,

  /**
   * The zoom track the +/− buttons step along, and the dropdown lists.
   *
   * Fit lands wherever the table happens to need, which is almost never a stop.
   * Stepping *to the next stop* rather than multiplying is what makes 100%
   * reachable from there: multiplying by a constant from 63% only ever visits
   * multiples of 63%.
   */
  ZOOM_STOPS: [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4],

  /* ================================================================
     Boot
     ================================================================ */

  init() {
    // Essentials first, then the advanced tier behind a disclosure. Each strip
    // sizes its own columns to how many tabs it holds, so the two tiers do not
    // have to stay the same length.
    //
    // Export is not here: it is the top bar's button and its menu. It is the
    // one thing you do *to* a finished table rather than *to* the design, and
    // putting it in the rail meant a top-right button whose whole effect
    // landed in the opposite corner of the screen.
    App.panels = [
      PanelData, PanelSteps, PanelStructure, PanelContent, PanelFormat,
      PanelColor, PanelStyle, PanelOptions
    ];
    App.essentialIds = ['data', 'steps', 'structure', 'content', 'format'];

    App.buildTabs();
    App.wireChrome();
    App.wireKeyboard();

    Store.subscribe(App.onChange);

    const restored = Store.loadSaved();
    if (restored && Spec.hasData(restored)) {
      Store.init(restored, 'Restored last session');
      Util.toast('Restored your last session', 'ok');
    } else {
      Store.init(Spec.create(), 'New project');
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

    // A render measures geometry back out of the table it has just laid out —
    // the column resize handles are placed from it — so a font that arrives
    // afterwards re-lays out the table and leaves those measurements describing
    // a width it no longer has. Asked *here* rather than above, because a
    // `<link>`-declared face is not fetched until the layout first asks for it:
    // at the top of this function the answer is "loaded" and a moment later,
    // once the preview is in the DOM, it is "loading". `Fonts.sync` cannot cover
    // it either — it reports only the faces this spec just registered, and the
    // built-in families come from `index.html`'s own <link>.
    //
    // Measured on an 8-column table, the fallback laid it out 16px wider than
    // Source Serif 4 did, which left every handle 2px per column to the right
    // of the line it controls: 17px out by the eighth column, 50px by the
    // twenty-fourth, for the whole life of the render.
    if (document.fonts && document.fonts.status === 'loading') {
      Fonts.ready().then(() => App.remeasure());
    }
  },

  /**
   * Measure the laid-out table again, without re-rendering it.
   *
   * The render loop is deliberately dumb — any change rebuilds everything — but
   * a font finishing its load is not a change to the spec, and re-entering the
   * render from here could not terminate on its own: every pass would find the
   * fonts settled or not by the same test that scheduled it. Re-measuring is
   * both narrower and certain to stop, because it renders nothing that could
   * ask for another font. The two things a render bakes measurements into are
   * the resize handles and the box the stage scrolls; `LineInfo` measures lazily
   * on hover and only needs its cache dropped.
   */
  remeasure() {
    const host = Util.qs('#preview-host');
    const table = host && Util.qs('.gt-table', host);
    if (!table || !App.model || !App.model.ok) return;
    Selection.attachResizers(host, table, App.model);
    LineInfo.invalidateCache();
    App.syncZoomBox();
  },

  renderPreview() {
    const host = Util.qs('#preview-host');
    const model = App.model;

    Util.clear(host);
    // Before the empty-state branch: the stage's surface is not a property of
    // the table, so it has to be right whether or not there is one.
    App.paintCanvasSurface();

    if (!model.ok) {
      host.appendChild(App.emptyState(model.error));
      App.setPreviewStyle('');
      App.paintZoom();
      App.syncZoomBox();
      return;
    }

    /*
     * Filling the stage paints the surface on `#stage-canvas` instead of on
     * the sheet, and that is the point rather than a detail: the sheet lives
     * inside the zoom transform, so a sheet stretched to the stage would
     * shrink with the zoom and stop filling it. The stage is outside the
     * transform and stays the size of the gap between the rails.
     *
     * The sheet then keeps its padding — the table still needs air around it —
     * but gives up its background, border and shadow, because a sheet edge
     * drawn on a surface that reaches the rails is the sheet the option was
     * asked to get rid of.
     */
    const filling = !!App.canvasFill;
    const surface = App.canvasSurface || 'light';
    const paper = Util.el('div.paper' + (filling ? '.is-flat' : '.surface-' + surface));
    const rendered = RenderHtml.render(model, { selectable: App.selectMode !== false, tableId: 'gt-preview' });

    App.setPreviewStyle(rendered.css);
    paper.appendChild(rendered.node);

    // The caption labels the figure rather than the table, so it renders below
    // it — the same node the standalone HTML export puts in its <figure>.
    const caption = RenderHtml.captionNode(model, rendered.id);
    if (caption) paper.appendChild(caption);

    // A filter that is on but forgotten is the easiest way to publish a table
    // that quietly omits half its data, so it is said on the table itself
    // rather than only in the panel that set it.
    if (model.filteredOut) {
      const notice = Util.el('div.preview-notice', {
        text: model.filteredOut.toLocaleString() + ' row' +
          (model.filteredOut === 1 ? '' : 's') + ' hidden by the filter. '
      });
      notice.appendChild(Controls.button('Show the filter', () => App.goToPanel('steps', 'steps.data'),
        { kind: 'ghost' }));
      paper.appendChild(notice);
    }

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

    // Before anything measures. Both the resize handles and `LineInfo` read
    // live rects and divide the zoom back out of them, so the transform they
    // are dividing by has to be the one on the element.
    App.paintZoom();

    Selection.attach(rendered.node);
    Selection.attachResizers(host, rendered.node, model);
    // `rendered.grid` is the same `Edges.build` result `RenderHtml.render`
    // already resolved to draw the table — passing it in is what stops
    // `LineInfo` resolving borders a second time on every render.
    LineInfo.attach(host, rendered.node, model, rendered.grid);

    App.syncZoomBox();
  },

  /**
   * A copy of the brand mark, for anywhere else that wants it.
   *
   * Cloned rather than rebuilt: the geometry is written once, inline in
   * `index.html`, so there is no second copy of it to fall out of step. The
   * favicon is the one unavoidable duplicate — a browser cannot read an inline
   * SVG for that — and a pipeline check holds the two together.
   */
  markSvg() {
    const source = Util.qs('.brand-mark');
    if (!source) return Util.el('span');
    const copy = source.cloneNode(true);
    copy.removeAttribute('class');
    copy.removeAttribute('aria-label');
    copy.setAttribute('aria-hidden', 'true');
    return copy;
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
    wrap.appendChild(Util.el('div.empty-mark', null, [App.markSvg()]));
    wrap.appendChild(Util.el('h2', { text: message || 'Nothing to show' }));

    if (!Spec.hasData(Store.get())) {
      wrap.appendChild(Util.el('p', { text: 'Import a CSV to begin, or load one of the samples.' }));
      const actions = Util.el('div.empty-actions');
      actions.appendChild(Controls.button('Import CSV', () => App.pickCsv(), { kind: 'primary' }));
      actions.appendChild(Controls.button('Paste a table', () => ImportPreview.awaitPaste()));
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

    // Drop any rule-hover preview before the nodes that own it are destroyed.
    // `Selection._previewRule` is set on a rule's `mouseenter` and cleared only
    // on its `mouseleave` — and a node removed from under the pointer never
    // fires `mouseleave`. So every rail rebuild leaked it, and `Selection.paint`
    // re-applied the green outline on every later repaint, for a rule the user
    // had just deleted. This is the one function that destroys those nodes, so
    // it is the one place the state can be retired. `previewRule(null)` also
    // strips the class from the live table, which matters because `_render`
    // repaints the preview *before* it rebuilds the rail.
    Selection.previewRule(null);

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

  /**
   * Switch the rail to a panel, optionally forcing one or more of its sections
   * open.
   *
   * The one place rail navigation happens, so a view that wants to send someone
   * elsewhere — the Inspector's link to the full option group — does not set
   * `App.activePanel` itself. `Controls.field`'s `requires` fix button predates
   * this and still does; converting it is a follow-up.
   *
   * @param {string} id - panel id
   * @param {string|Array<string>} [sectionKey] - one or more `Controls.section`
   *   keys to force open (the Inspector's link opens both a group and its
   *   "More" disclosure, so this takes an array as well as a single key)
   */
  /**
   * Make a panel the active one.
   *
   * **Choosing an advanced-tier panel opens that tier for good.** The strip is
   * shown while such a panel is active whether or not `moreOpen` is set — but
   * that is `forced`, not a record of anything, so clicking any essential tab
   * afterwards closed the disclosure and took the panel you had just been
   * using off the screen entirely. There was no way back except noticing the
   * More toggle, which is exactly what "I cannot click back into Colour by
   * value" was.
   *
   * Set here, in response to a choice, rather than computed during a render:
   * `onChange`'s note explains why deriving it per render would re-open the
   * tier on every keystroke and never let it be collapsed again.
   */
  setPanel(id) {
    App.activePanel = id;
    if (App.essentialIds.indexOf(id) < 0) App.moreOpen = true;
  },

  goToPanel(id, sectionKey) {
    App.setPanel(id);

    // A search query left over from a previous visit to Options can filter the
    // very group being navigated to out of the list entirely (`render` skips a
    // group with no visible rows), which would make the section-forcing below
    // silently do nothing. Landing here means the query is not what the caller
    // is trying to show.
    if (id === 'options' && typeof PanelOptions !== 'undefined') PanelOptions._query = '';

    if (sectionKey) {
      const keys = Array.isArray(sectionKey) ? sectionKey : [sectionKey];
      for (const key of keys) Controls.setSectionState('section.' + key, false);
    }
    App.renderRail();
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
        title: panel.hint || panel.label,
        dataset: { panel: panel.id },
        on: {
          click: () => {
            App.setPanel(panel.id);
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
    // Not the pipeline: Steps is an essential tab, so having steps is the
    // ordinary state of every table rather than a sign of advanced use.
    if (spec.dataColor && spec.dataColor.length) return true;

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
    // The history list has something to say only once something has been done.
    Util.qs('#btn-history').disabled = Store.entries().length < 2;

    const label = Spec.hasData(spec)
      ? spec.source.filename + '  ·  ' + spec.source.rows.length + '×' + spec.source.columns.length
      : 'no data';
    Util.qs('#file-label').textContent = label;

    App.updateSelectionChip();

    App.syncZoomUi();

    const right = Util.qs('#status-right');
    if (App.model && App.model.ok) {
      right.textContent = App.model.cols.length + ' cols · ' +
        App.model.totalRows.toLocaleString() + ' rows · ' +
        Util.plural(spec.styleRules.length, 'style rule');
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
    Util.qs('#btn-new').addEventListener('click', () => App.newProject());
    Util.qs('#btn-paste').addEventListener('click', () => ImportPreview.awaitPaste());
    const import2 = Util.qs('#btn-import-2');
    if (import2) import2.addEventListener('click', () => App.pickCsv());

    Util.qs('#btn-undo').addEventListener('click', () => Store.undo());
    Util.qs('#btn-redo').addEventListener('click', () => Store.redo());
    Util.qs('#btn-history').addEventListener('click', () => HistoryMenu.toggle());
    Util.qs('#btn-open-spec').addEventListener('click', () => Util.qs('#file-spec').click());
    Util.qs('#btn-save-spec').addEventListener('click', () => App.saveSpec());

    Util.qs('#btn-export').addEventListener('click', () => ExportMenu.toggle());

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

    Util.qs('#btn-zoom-in').addEventListener('click', () => App.zoomStep(1));
    Util.qs('#btn-zoom-out').addEventListener('click', () => App.zoomStep(-1));
    Util.qs('#btn-zoom-fit').addEventListener('click', () => App.zoomToFit());

    Util.qs('#zoom-select').addEventListener('change', (e) => {
      App.setZoom(parseFloat(e.target.value) / 100);
    });

    Util.qs('#canvas-surface').addEventListener('change', (e) => {
      App.canvasSurface = e.target.value;
      App.renderPreview();
    });

    Util.qs('#toggle-fill').addEventListener('change', (e) => {
      App.canvasFill = e.target.checked;
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

    /* ---- Paste a table anywhere ---- */

    // The counterpart to dropping a file anywhere. Guarded on a focused field,
    // or pasting into the title box would import the title; and on the modal,
    // which has its own paste target and would otherwise handle it twice.
    document.addEventListener('paste', (e) => {
      if (ImportPreview.isOpen()) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
      if (document.activeElement && document.activeElement.isContentEditable) return;

      const data = e.clipboardData;
      if (!data) return;
      const html = data.getData('text/html');
      const text = data.getData('text/plain');
      if (!(html && /<table/i.test(html)) && !(text && text.indexOf('\t') >= 0)) return;

      e.preventDefault();
      ImportPreview.fromClipboard(data);
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
        // Innermost surface first: the menu sits above the rail but below a
        // modal, and the modal is the only one of the three that can be open
        // while the menu is not.
        if (!Util.qs('#modal-backdrop').hidden) { App.closeModal(); return; }
        if (Popover.isOpen()) { Popover.dismiss(); return; }
        if (!inField) Selection.clear();
        return;
      }

      // Zoom, unmodified and outside any field. Deliberately not Ctrl +/−/0:
      // those are the browser's own zoom, and taking them would leave someone
      // who had zoomed the whole UI with no way back to 100%.
      if (inField || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '+' || e.key === '=') { e.preventDefault(); App.zoomStep(1); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); App.zoomStep(-1); }
      else if (e.key === '0') { e.preventDefault(); App.setZoom(1); }
    });
  },

  /* ================================================================
     Zoom
     ================================================================ */

  setZoom(value) {
    if (!isFinite(value)) return;
    const anchor = App.stageAnchor();
    App.zoom = Util.clamp(value, App.ZOOM_STOPS[0], App.ZOOM_STOPS[App.ZOOM_STOPS.length - 1]);
    App.paintZoom();
    App.syncZoomBox();
    App.scrollToAnchor(anchor);
    App.syncZoomUi();
    // The resize handles are not rebuilt here. Every figure they are positioned
    // with is in the table's own unscaled pixels, so the transform this just
    // changed is what rescales them — the same one that rescales the lines they
    // sit on. Rebuilding was only ever needed when they were written in screen
    // pixels, which is the bug that put them in the wrong place to begin with.
    //
    // This does not go through renderPreview, so LineInfo.attach's own hide()
    // never runs — without this, a card left open across a zoom keeps
    // describing an edge that has since moved.
    LineInfo.hide();
    // The zoom carried by the geometry LineInfo cached is now stale, even
    // though the underlying grid did not change.
    LineInfo.invalidateCache();
  },

  /**
   * Put the zoom on the preview: the transform that scales it, and the number
   * itself as `--stage-zoom`.
   *
   * The custom property is for anything inside the host that must *not* scale
   * with it — the column resize band, which has to stay the same size under the
   * pointer at every zoom. Declaring that in CSS against a number the host
   * carries costs nothing when the zoom changes; writing the size into each
   * handle would put us back to rebuilding the layer on every step.
   *
   * The one place either is written, so a render and a zoom step cannot disagree
   * about the scale the handles and `LineInfo` divide back out of their
   * measurements.
   */
  paintZoom() {
    const host = Util.qs('#preview-host');
    if (!host) return;
    host.style.transform = 'scale(' + App.zoom + ')';
    host.style.setProperty('--stage-zoom', String(App.zoom));
  },

  /**
   * Give the scaled preview a layout box the stage can scroll.
   *
   * The size is read off the host's own rect, which for a `scale` about the
   * top-left corner *is* the drawn size, subpixels included — deriving it as
   * `offsetWidth × zoom` would round the unscaled figure first and leave the
   * box a fraction short of the table at some zooms.
   *
   * Safe to read while the box still holds its previous size: `.preview-host`
   * is `width: max-content`, so its rect does not depend on the box's.
   */
  syncZoomBox() {
    const host = Util.qs('#preview-host');
    const box = Util.qs('#zoom-box');
    if (!host || !box) return;
    const rect = host.getBoundingClientRect();
    box.style.width = rect.width + 'px';
    box.style.height = rect.height + 'px';
  },

  /**
   * The point of the table at the centre of the stage, in unscaled px from the
   * preview's top-left corner.
   *
   * A zoom step that leaves the scroll offsets alone keeps you looking at the
   * same *pixel* of the stage rather than the same *cell*, which on a table too
   * wide to fit means every step slides the table sideways under you. That was
   * survivable while a wide table could not be scrolled at all; now that
   * scrolling is how you read one, it is the difference between zoom being
   * usable and zoom losing your place.
   */
  stageAnchor() {
    const scroll = Util.qs('#stage-scroll');
    const box = Util.qs('#zoom-box');
    if (!scroll || !box) return null;
    const boxRect = box.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    return {
      x: (scrollRect.left + scroll.clientWidth / 2 - boxRect.left) / App.zoom,
      y: (scrollRect.top + scroll.clientHeight / 2 - boxRect.top) / App.zoom
    };
  },

  /**
   * Scroll the stage so an anchor from `stageAnchor` is back at its centre.
   *
   * Written as a delta on the current offsets rather than an absolute position,
   * because the box's own place in the scroll content moves with it — the auto
   * margins that centre a table smaller than the stage give way as it grows.
   * The browser clamps the result, so a table that fits simply stays centred.
   */
  scrollToAnchor(anchor) {
    const scroll = Util.qs('#stage-scroll');
    const box = Util.qs('#zoom-box');
    if (!scroll || !box || !anchor) return;
    const boxRect = box.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    scroll.scrollLeft +=
      boxRect.left + anchor.x * App.zoom - (scrollRect.left + scroll.clientWidth / 2);
    scroll.scrollTop +=
      boxRect.top + anchor.y * App.zoom - (scrollRect.top + scroll.clientHeight / 2);
  },

  /**
   * Step to the next stop on the zoom track, in the given direction.
   *
   * Always lands *on* the track, so however far off it Fit left the zoom, one
   * press is enough to be back on stops the buttons and the dropdown agree
   * about.
   */
  zoomStep(direction) {
    const stops = App.ZOOM_STOPS;
    const epsilon = 0.001;

    if (direction > 0) {
      const next = stops.find((stop) => stop > App.zoom + epsilon);
      App.setZoom(next === undefined ? stops[stops.length - 1] : next);
    } else {
      const below = stops.filter((stop) => stop < App.zoom - epsilon);
      App.setZoom(below.length ? below[below.length - 1] : stops[0]);
    }
  },

  /**
   * Zoom so the whole sheet is on the stage.
   *
   * Measured on `#preview-host` — the sheet — and not on the `<table>` inside it.
   * The sheet adds 32px of margin either side, so fitting the table left exactly
   * that much overflowing at every zoom: 37px of horizontal scrolling
   * immediately after pressing the button whose one job is to remove it. That
   * was invisible while the overflow was unreachable, and is the one place
   * making the stage scroll honestly showed up as a regression.
   */
  zoomToFit() {
    const host = Util.qs('#preview-host');
    const scroll = Util.qs('#stage-scroll');
    if (!host || !scroll) return;

    const available = scroll.clientWidth - 72;   // .stage-scroll's own padding
    const natural = host.getBoundingClientRect().width / App.zoom;
    App.setZoom(natural > 0 ? Math.min(2, available / natural) : 1);
  },

  /**
   * Repaint the zoom dropdown and the step buttons from `App.zoom`.
   *
   * A zoom Fit landed between two stops gets an entry of its own at the top of
   * the list, so the readout never lies about where it is and every stop —
   * 100% above all — stays one click away. That entry disappears again as soon
   * as the zoom is back on the track.
   */
  syncZoomUi() {
    const select = Util.qs('#zoom-select');
    if (!select) return;

    const stops = App.ZOOM_STOPS;
    const percent = Math.round(App.zoom * 100);
    const onTrack = stops.some((stop) => Math.round(stop * 100) === percent);

    const wanted = stops.map((stop) => Math.round(stop * 100));
    if (!onTrack) wanted.unshift(percent);

    // Rebuild only when the list itself changed. `updateChrome` runs this on
    // every render, and replacing the options under an open dropdown would
    // shut it.
    const current = Util.qsa('option', select).map((option) => Number(option.value));
    if (current.join() !== wanted.join()) {
      Util.clear(select);
      for (const value of wanted) {
        select.appendChild(Util.el('option', { value: String(value), text: value + '%' }));
      }
    }
    select.value = String(percent);

    Util.qs('#btn-zoom-out').disabled = App.zoom <= stops[0] + 0.001;
    Util.qs('#btn-zoom-in').disabled = App.zoom >= stops[stops.length - 1] - 0.001;
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
      const grid = Csv.toGrid(text);
      ImportPreview.show(
        { rows: grid.rows, headerRows: 1, warnings: grid.warnings, caption: null },
        { filename: file.name, delimiter: grid.delimiter });
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
  adoptSource(source, opts) {
    opts = opts || {};
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
      // **The pipeline is kept.** Importing over an existing project keeps the
      // design, and the structural half is design: the pivot, the sort, the
      // filter, the row labels and groups all still describe what the user
      // wants doing to a file of this shape. Clearing it threw all of that
      // away — where the old flat spec had reset only the pivot — and a step
      // that no longer fits reports itself inert rather than going quiet, which
      // is a better answer than deleting it on the user's behalf.
      Spec.adoptColumns(spec);
    } else {
      spec = Spec.fromSource(source);
    }

    // Title, subtitle, caption and a source note, so an import lands as a
    // table that already looks like one — and so the parts that carry those
    // things are visible rather than waiting to be discovered. Nothing the
    // user has written is overwritten; see `Spec.applySuggestions`.
    Spec.applySuggestions(spec, source);

    // After `adoptColumns`, which resets the structure — a two-row header the
    // importer read as column groups would otherwise be thrown away here.
    if (opts.spanners && opts.spanners.length) {
      for (const spanner of opts.spanners) Pipeline.add(spec, 'spanner', spanner);
    }

    Store.replace(spec, 'replace', 'Imported ' + Spec.sourceLabel(source));

    if (source.warnings && source.warnings.length) {
      Util.toast(source.warnings[0], 'error', 5000);
    } else {
      Util.toast('Loaded ' + source.rows.length + ' rows — pick a look under Data › Look', 'ok');
    }

    App.setPanel('structure');
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
      Store.replace(spec, 'replace', 'Opened ' + file.name);
      Util.toast('Opened ' + file.name, 'ok');
    } catch (err) {
      console.error(err);
      Util.toast('That is not a valid project file: ' + err.message, 'error');
    }
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

  /** Put arbitrary content in the modal and show it. */
  showModal(title, nodes) {
    const body = Util.qs('#modal-body');
    Util.qs('#modal-title').textContent = title;
    Util.clear(body);
    Util.append(body, nodes);
    Util.qs('#modal-backdrop').hidden = false;
    const first = Util.qs('button', body);
    if (first) first.focus();
  },

  /**
   * Start again, with a chance to save first.
   *
   * Three ways out rather than a yes/no `confirm`: losing an afternoon's work
   * to a misread dialog is exactly what a Cancel and an explicit "save first"
   * are for. Nothing is cleared until the file has actually been written.
   */
  newProject() {
    if (!Spec.hasData(Store.get())) {
      App.startFresh();
      return;
    }

    App.showModal('Start a new project?', [
      Util.el('p.modal-text', {
        text: 'This clears the data, the design and the history. Save the project first ' +
          'if you want to come back to it — the file carries the data with it, so it ' +
          'reopens exactly as it is now.'
      }),
      // `Util.el` is (tag, attrs, children) — the array has to go third, or it
      // is read as attributes and every button silently vanishes.
      Util.el('div.row-actions', null, [
        Controls.button('Save project, then start', () => {
          App.saveSpec();
          App.closeModal();
          App.startFresh();
        }, { kind: 'primary' }),
        Controls.button('Start without saving', () => {
          App.closeModal();
          App.startFresh();
        }, { kind: 'danger' }),
        Controls.button('Cancel', () => App.closeModal(), { kind: 'ghost' })
      ])
    ]);
  },

  /** Clear everything back to an empty project. */
  startFresh() {
    Selection.clear();
    Store.replace(Spec.create(), 'replace', 'New project');
    App.setPanel('data');
    App.renderRail();
    Util.toast('New project — import a CSV to begin', 'ok');
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

  /**
   * The working columns, post-reshape, as `{id, label, name, type}`.
   *
   * `label` is what the editor calls the column and is never empty; `name` is
   * the raw header it arrived with, which only "Reset labels" has any business
   * with. Both come from `Spec`, so this cannot drift from what `compute.js`
   * draws — it did, and a column could read "Mfr" in the table and `mfr` here.
   */
  workingColumns() {
    const spec = Store.get();
    if (!Spec.hasData(spec)) return [];
    const derived = Pipeline.run(spec.source, spec.pipeline);
    // Titles for the set, not one at a time: a pivot names three columns
    // `employment`, and every picker in the app is built from this list.
    const titles = Spec.columnTitles(spec, derived.columns);
    return derived.columns.map((col) => ({
      id: col.id,
      label: titles[col.id],
      name: col.name,
      type: col.type
    }));
  },

  workingColumnsById() {
    const spec = Store.get();
    if (!Spec.hasData(spec)) return {};
    const derived = Pipeline.run(spec.source, spec.pipeline);
    const out = {};
    for (const col of derived.columns) out[col.id] = col;
    return out;
  },

  /**
   * The working rows with cell corrections applied — the same rows `compute.js`
   * builds the table from. A panel reading the uncorrected ones would seed a
   * `where` expression against a value the table no longer shows.
   */
  workingRows() {
    const spec = Store.get();
    if (!Spec.hasData(spec)) return [];
    // The pipeline's own output, corrections and all — one producer of "the
    // working data", so a panel seeding an expression sees what `compute`
    // matched against.
    return Pipeline.run(spec.source, spec.pipeline).items.map((item) => item.row);
  },

  /**
   * Put the canvas surface where it belongs for the current mode.
   *
   * One place, called from the render, because the surface is now drawn by one
   * of two elements and leaving the other one carrying a stale class shows two
   * surfaces at once — a dark stage behind a white sheet.
   */
  paintCanvasSurface() {
    const stage = document.getElementById('stage-canvas');
    if (!stage) return;
    for (const name of ['light', 'dark', 'checker']) {
      stage.classList.remove('surface-' + name);
    }
    stage.classList.toggle('is-filled', !!App.canvasFill);
    if (App.canvasFill) stage.classList.add('surface-' + (App.canvasSurface || 'light'));
  },

  /** Row-group labels in display order. */
  groupLabels() {
    if (App.model && App.model.groups) return App.model.groups.map((g) => g.id);
    return [];
  }
};

/* Coalesce renders into one per frame, and throttle autosave. */
App.render = Util.raf(App._render);
App.autosave = Util.debounce(() => Store.save(), 900);

document.addEventListener('DOMContentLoaded', () => App.init());
