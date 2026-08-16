/**
 * ui/line-info.js
 *
 * What a line in the table is, and what controls it.
 *
 * Every border is resolved from an option, or from a style rule that beat one,
 * and until now nothing closed the loop back: a user who wanted the rule under
 * their column labels gone had to guess which of nine option groups drew it.
 *
 * The provenance itself comes from `edges.js`, which records it on the same
 * pass that builds the grid. This file only turns a cursor position into an
 * edge, and an edge into a sentence.
 *
 * There are deliberately no DOM hit targets. One node per edge would be about
 * 16,000 elements on a 2,000-row preview, and any interactive layer over the
 * table risks swallowing the clicks that drive selection and column resizing.
 * Hit-testing measured geometry costs nothing and cannot regress either.
 */

const LineInfo = {

  /** How close the cursor must be to a line, in unscaled px. */
  THRESHOLD: 4,

  /* ================================================================
     Geometry
     ================================================================ */

  /**
   * Pixel positions of every grid line, relative to the table's top-left and
   * in unscaled px.
   *
   * `Measure.collectGridLines` already derives these for the SVG exporter —
   * from the `<col>` elements, which carry the real resolved widths even under
   * `table-layout: fixed`. Reusing it keeps one geometry model.
   *
   * @param {HTMLTableElement} table
   * @param {Object} grid - from Edges.build
   * @returns {{colEdges: number[], rowEdges: number[]}}
   */
  geometry(table, grid) {
    const rect = table.getBoundingClientRect();
    const zoom = (typeof App !== 'undefined' && App.zoom) || 1;
    const result = { colEdges: [], rowEdges: [] };

    Measure.collectGridLines(table, { x: rect.left, y: rect.top }, grid, result);

    // collectGridLines reads live rects, which carry the stage's zoom.
    return {
      colEdges: result.colEdges.map((x) => x / zoom),
      rowEdges: result.rowEdges.map((y) => y / zoom),
      // Carried through so `edgeAt` can decline rather than name the wrong
      // line — see the comment there.
      rowMismatch: result.rowMismatch,
      colMismatch: result.colMismatch
    };
  },

  /**
   * The edge nearest a point, or null.
   *
   * A vertical hit wins a tie, because the column boundaries are also the
   * resize handles and that is the gesture already living there.
   *
   * @param {{x: number, y: number}} point - unscaled px from the table's origin
   * @param {Object} geo - from LineInfo.geometry
   * @param {Object} grid - from Edges.build
   * @returns {?{axis: string, r: number, c: number, src: ?Object, gridRow: ?Object, gridRowCount: number}}
   */
  edgeAt(point, geo, grid) {
    // `collectGridLines` computes this precisely because a grid/DOM
    // disagreement means the measured positions are not where the grid
    // thinks the rows and columns are — naming a line at that point would
    // name the wrong one. Declining is the honest answer.
    if (geo.rowMismatch || geo.colMismatch) return null;

    const near = (values, target) => {
      let best = -1;
      let bestDistance = LineInfo.THRESHOLD;
      for (let i = 0; i < values.length; i += 1) {
        const d = Math.abs(values[i] - target);
        if (d <= bestDistance) { bestDistance = d; best = i; }
      }
      return best;
    };

    const inRange = (values, target) =>
      values.length > 1 && target >= values[0] - LineInfo.THRESHOLD &&
      target <= values[values.length - 1] + LineInfo.THRESHOLD;

    if (!inRange(geo.colEdges, point.x) || !inRange(geo.rowEdges, point.y)) return null;

    const c = near(geo.colEdges, point.x);
    if (c >= 0) {
      // Which grid row is the cursor inside?
      let r = -1;
      for (let i = 0; i < geo.rowEdges.length - 1; i += 1) {
        if (point.y >= geo.rowEdges[i] && point.y <= geo.rowEdges[i + 1]) { r = i; break; }
      }
      if (r >= 0 && r < grid.nRows && c <= grid.nCols) {
        return { axis: 'v', r: r, c: c, src: grid.vSrc[r][c] };
      }
    }

    const r = near(geo.rowEdges, point.y);
    if (r >= 0) {
      let c2 = -1;
      for (let i = 0; i < geo.colEdges.length - 1; i += 1) {
        if (point.x >= geo.colEdges[i] && point.x <= geo.colEdges[i + 1]) { c2 = i; break; }
      }
      if (c2 >= 0 && c2 < grid.nCols && r <= grid.nRows) {
        // The grid row that sits above this edge, in `Edges.gridRows`' own
        // vocabulary — not `model.rows`, which holds body rows only and is a
        // different length and order (see `where()`).
        return {
          axis: 'h', r: r, c: c2, src: grid.hSrc[r][c2],
          gridRow: r > 0 ? grid.gridRows[r - 1] : null,
          gridRowCount: grid.nRows
        };
      }
    }

    return null;
  },

  /* ================================================================
     Naming
     ================================================================ */

  /**
   * Turn an edge into the sentences the card shows.
   *
   * Plain-language names come from `options-schema.js` — the composite border
   * rows the options triage introduced already read as "Bottom border" inside
   * a group called "Column labels", which is exactly what belongs here. Nothing
   * is written per option, so there is no second table to drift.
   *
   * @returns {{title, detail, values, controlledBy, noControl, overrides, panel, sectionKey, tier}}
   */
  describe(hit, model) {
    const src = hit.src;
    const drawn = !!(src && src.drawn);

    const out = {
      title: drawn
        ? (hit.axis === 'v' ? 'Vertical line' : 'Horizontal line')
        : 'No line here',
      detail: LineInfo.where(hit, model),
      values: drawn ? src.style + '  ·  ' + src.width + 'px  ·  ' + src.color :
        (src && src.style && src.style !== 'none' && src.style !== 'hidden')
          ? 'width is 0px, style is “' + src.style + '”' : 'style is “none”',
      controlledBy: null,
      noControl: false,
      overrides: null,
      panel: null,
      sectionKey: null,
      tier: null
    };

    if (!src) {
      // A full sentence, not a label — `show()` prefixes named sources with
      // "from ", which would read as "from nothing sets this edge" here.
      // `noControl` tells `show()` to render this on its own instead.
      out.noControl = true;
      return out;
    }

    const named = LineInfo.nameSource(src.source, model);
    out.controlledBy = named.label;
    out.panel = named.panel;
    out.sectionKey = named.sectionKey;
    out.tier = named.tier;
    out.action = named.action || null;

    if (src.overrides && src.overrides.length) {
      out.overrides = src.overrides.map((beaten) => LineInfo.nameSource(beaten.source, model).label);
    }

    return out;
  },

  /**
   * An option key or a rule, as a label plus where to go to change it.
   *
   * A style rule is named from the id `StyleRules.merge` stamps onto the side
   * it wins, so this stays a lookup. Deriving it here instead — re-running the
   * match against the compiled rules — would make this a second producer of a
   * fact the cascade already decided, which is the shape of the bug class this
   * codebase keeps paying for.
   *
   * An option's `sectionKey` is an array — the group's own section plus its
   * "More" disclosure — for anything above the basic tier, because that is
   * where `PanelOptions.render` actually puts the row: basic rows sit loose
   * in the group, everything else is nested one disclosure deeper. A single
   * key opened only the outer group, which for 14 of the 17 border options
   * this card can name lands on a group that does not visibly contain the
   * row it claims to. `App.goToPanel` already accepts an array (see
   * `Inspector.partDefaults`, which has taken this form since the triage).
   */
  nameSource(source, model) {
    if (!source) return { label: 'nothing', panel: null, sectionKey: null, tier: null };

    if (source.kind === 'rule') {
      // `StyleRules.merge` stamped the winning rule per border side as it
      // resolved the cascade, so this is a lookup. An unnamed rule (one saved
      // before the stamp existed, or with its label cleared) still reads
      // sensibly rather than showing a raw id.
      const rules = (model && model.styleRules) || [];
      const rule = source.ruleId ? rules.find((r) => r.id === source.ruleId) : null;
      const label = rule && rule.label ? 'rule “' + rule.label + '”' : 'a style rule';
      return {
        label: label,
        panel: 'style',
        sectionKey: 'style.rules',
        tier: null,
        action: rule && rule.label ? 'Edit this rule →' : 'Open style rules →'
      };
    }

    for (const group of OptionsSchema.groups) {
      for (const row of OptionsSchema.rows(group.id)) {
        if (row.id !== source.key) continue;
        const sectionKey = row.tier === 'basic'
          ? 'opt.' + group.id
          : ['opt.' + group.id, 'opt.more.' + group.id];
        return {
          label: group.label + ' › ' + row.label,
          panel: 'options',
          sectionKey: sectionKey,
          tier: row.tier
        };
      }
    }

    return { label: source.key, panel: 'options', sectionKey: null, tier: null };
  },

  /** Plain-language name for a grid row, keyed by the `kind` `Edges.gridRows` gives it. */
  ROW_KIND_NAMES: {
    title: 'the title',
    subtitle: 'the subtitle',
    column_labels: 'the column labels',
    spanner: 'the column group headers',
    group: 'the row-group label',
    summary: 'the summary row',
    grand: 'the grand summary row',
    footnote: 'the footnotes',
    source_note: 'the source note'
  },

  /**
   * Where the line sits, in the table's own vocabulary.
   *
   * For a horizontal edge this reads off `hit.gridRow` / `hit.gridRowCount`,
   * which `edgeAt` carried from `grid.gridRows` — `Edges.gridRows(model)`'s
   * own list of title/subtitle/header/body/footnote/source-note rows, in grid
   * order. `model.rows` holds body rows only, a different length and order,
   * so indexing it with `hit.r` (a `grid.gridRows` index) named the wrong row.
   *
   * A data row names its own row number rather than "the row above" — the
   * commonest interior line in the table is one data row to the next, so
   * that filler is what most hovers would have read.
   */
  where(hit, model) {
    if (hit.axis === 'v') {
      const left = model.cols[hit.c - 1];
      const right = model.cols[hit.c];
      const nameOf = (col) => (col ? (col.label || col.colId || 'the row labels') : null);
      if (left && right) return 'between ' + nameOf(left) + ' and ' + nameOf(right);
      if (right) return 'left of ' + nameOf(right);
      if (left) return 'right of ' + nameOf(left);
      return '';
    }

    if (!hit.gridRow) return 'along the top of the table';
    if (hit.r >= hit.gridRowCount) return 'along the bottom of the table';

    const row = hit.gridRow;
    if (row.kind === 'data' && row.ref && row.ref.srcIndex !== undefined && row.ref.srcIndex !== null) {
      return 'below row ' + (row.ref.srcIndex + 1);
    }
    return 'below ' + (LineInfo.ROW_KIND_NAMES[row.kind] || ('the ' + row.kind + ' row'));
  },

  /* ================================================================
     The card
     ================================================================ */

  _node: null,

  /**
   * Grace period (ms) between a `mousemove` that finds no edge and the card
   * actually hiding. The card renders ~14px from the pointer (see `show()`),
   * so a real hand crossing that gap generates several `mousemove` events
   * over bare table with no edge under them before ever reaching the card —
   * each one otherwise an immediate `hide()`. 120ms comfortably covers that
   * crossing without making the card feel sticky once the pointer genuinely
   * moves on elsewhere.
   */
  HIDE_DELAY: 120,

  _hideTimer: null,

  /** Cancel a pending grace-period hide, if one is armed. Idempotent. */
  _cancelHideTimer() {
    if (LineInfo._hideTimer) {
      clearTimeout(LineInfo._hideTimer);
      LineInfo._hideTimer = null;
    }
  },

  /**
   * Arm the grace-period hide, replacing any timer already pending — so a
   * run of no-edge `mousemove`s during a transit keeps resetting the clock
   * rather than piling up timers, and the card survives as long as they
   * keep arriving within `HIDE_DELAY` of each other.
   */
  _scheduleHide() {
    LineInfo._cancelHideTimer();
    LineInfo._hideTimer = setTimeout(() => {
      LineInfo._hideTimer = null;
      LineInfo.hide();
    }, LineInfo.HIDE_DELAY);
  },

  /**
   * The grid and hit-testing geometry for the table currently on screen.
   *
   * Every `mousemove` used to rebuild both from scratch — `Edges.build` plus
   * `Measure.collectGridLines`'s one `getBoundingClientRect()` per row —
   * measured at 6.22ms per call on a 2,000-row model, purely to answer "is
   * the cursor near a line" for a pointer that spends most of its time
   * nowhere near one. `attach()` primes `grid` for free from what
   * `RenderHtml.render` already resolved; `geo` is filled in lazily by the
   * first `mousemove` that needs it, so a render nobody hovers never pays
   * for the row measurement at all.
   */
  _cache: { table: null, grid: null, geo: null },

  /**
   * Drop the cached grid and geometry. A new render replaces the table node
   * `geo` was measured from, and a zoom change rescales every rect
   * `collectGridLines` reads — `attach()` and `App.setZoom` call this
   * alongside the `hide()` they already call, so the next hover measures
   * fresh instead of reusing numbers that no longer describe what's on
   * screen.
   */
  invalidateCache() {
    LineInfo._cache = { table: null, grid: null, geo: null };
  },

  /**
   * Watch the preview for a cursor near a line. Called once per render.
   *
   * The listener lives on the host that already exists, and the card is the
   * only node added — so no new element sits over the table, and selection,
   * the resize handles and click-to-clear all behave exactly as before.
   *
   * The card itself is appended to `document.body`, not `host` — `host`
   * carries a zoom `transform`, which would become the containing block for
   * the card's `position: fixed` and break its positioning. That puts the
   * card and `host` in different DOM branches, so a `mousemove` over the
   * card never bubbles to `host`, and moving the pointer off the table
   * toward the card fires `mouseleave` on `host` before the pointer ever
   * reaches the card. See `show()` for how the card stays open across that
   * gap, and `_scheduleHide` for the gap on the `mousemove` side of it.
   *
   * @param {HTMLElement} host - `#preview-host`
   * @param {HTMLElement} table - the rendered `<table>`, only checked for presence
   * @param {Object} model - the resolved model
   * @param {Object} [grid] - from `Edges.build`; `RenderHtml.render` already
   *   resolved one for this exact model, so passing it in here is what stops
   *   this file resolving borders a second time on every render just to
   *   discard the result. Rebuilt only if omitted.
   */
  attach(host, table, model, grid) {
    LineInfo.hide();
    LineInfo.invalidateCache();
    if (!host || !table || !model || !model.ok) return;

    LineInfo._cache.grid = grid || Edges.build(model);

    if (host.dataset.lineInfo !== '1') {
      host.dataset.lineInfo = '1';
      host.addEventListener('mousemove', (e) => {
        const live = Util.qs('.gt-table', host);
        if (!live || !App.model || !App.model.ok) { LineInfo.hide(); return; }

        const cache = LineInfo._cache;
        // `grid` depends only on `App.model`, not on the live DOM, and
        // `attach()` already primes it fresh on every render — so the only
        // reason to rebuild it here is a cache `invalidateCache()` missed
        // (defensive, should not happen in practice). `geo` is the one that
        // genuinely needs the live table: if the node is not the one it was
        // measured from — a render this file was not told about, or simply
        // the first move after one, when the cache starts empty — rebuild
        // once rather than trust stale geometry.
        if (!cache.grid) cache.grid = Edges.build(App.model);
        if (cache.table !== live || !cache.geo) cache.geo = LineInfo.geometry(live, cache.grid);
        cache.table = live;

        const rect = live.getBoundingClientRect();
        const zoom = App.zoom || 1;
        const point = {
          x: (e.clientX - rect.left) / zoom,
          y: (e.clientY - rect.top) / zoom
        };

        const hit = LineInfo.edgeAt(point, cache.geo, cache.grid);
        // No edge under the cursor here — this fires repeatedly for a
        // pointer crossing bare table between a line and the card that
        // named it, so hide on a delay rather than on the spot; a hit
        // found here or a card entered directly cancels it (see below).
        if (!hit) { LineInfo._scheduleHide(); return; }

        LineInfo.show(LineInfo.describe(hit, App.model), hit, e.clientX, e.clientY);
      });

      // The pointer leaving `host` toward the card is not "leaving the
      // line" — it is `relatedTarget`, the element the pointer is entering.
      host.addEventListener('mouseleave', (e) => {
        if (LineInfo._node && e.relatedTarget && LineInfo._node.contains(e.relatedTarget)) return;

        // `relatedTarget` is null only when the pointer leaves the window
        // itself — a real exit, hidden on the spot. Anything else is a
        // transit, exactly like the no-edge `mousemove` case above, and
        // gets the same grace period rather than an immediate hide.
        //
        // At zoom 1 the pointer never reaches here on its way to the card:
        // `.paper`'s padding (28px/32px) exceeds the card's ~14px offset, so
        // the crossing happens inside `host` and is caught by the
        // `mousemove` branch above instead. `#preview-host` is scaled by
        // `App.zoom`, so that padding shrinks with it — below roughly 0.45
        // it no longer covers the gap, `relatedTarget` becomes some element
        // of `.stage-scroll` rather than the card, and this branch is what
        // keeps the card alive across it. `App.zoomToFit` routinely lands in
        // that range on a wide table.
        if (e.relatedTarget) { LineInfo._scheduleHide(); return; }
        LineInfo.hide();
      });
    }
  },

  show(info, hit, clientX, clientY) {
    LineInfo.hide();

    const card = Util.el('div.line-card');
    card.appendChild(Util.el('div.line-card-title', { text: info.title }));
    if (info.detail) card.appendChild(Util.el('div.line-card-detail', { text: info.detail }));
    card.appendChild(Util.el('div.line-card-values', { text: info.values }));

    if (info.controlledBy) {
      card.appendChild(Util.el('div.line-card-source', { text: 'from ' + info.controlledBy }));
    } else if (info.noControl) {
      // A full sentence on its own, not a label for "from " to prefix —
      // "from nothing sets this edge" was two clauses stitched together.
      card.appendChild(Util.el('div.line-card-source', { text: 'nothing sets this edge' }));
    }
    if (info.overrides && info.overrides.length) {
      for (const label of info.overrides) {
        card.appendChild(Util.el('div.line-card-source', { text: 'overriding ' + label }));
      }
    }

    if (info.panel) {
      card.appendChild(Controls.button(
        info.action || (info.panel === 'style' ? 'Open style rules →' : 'Edit this option →'),
        () => {
          // The row for an expert-tier option is not in the DOM at all until
          // the toggle is on — `PanelOptions.rowVisible` drops it outright —
          // so the jump has to turn the toggle on itself, not merely open the
          // group and "More" disclosure that would otherwise contain nothing.
          if (info.tier === 'expert') PanelOptions.setShowExpert(true);
          App.goToPanel(info.panel, info.sectionKey);
          LineInfo.hide();
        },
        { kind: 'ghost', block: true }));
    }

    if (hit.axis === 'v') {
      card.appendChild(Util.el('div.line-card-hint', { text: 'drag to resize the column' }));
    }

    // Offset from the pointer so the card is never under it.
    card.style.left = (clientX + 14) + 'px';
    card.style.top = (clientY + 14) + 'px';

    // The card lives outside `host`, so `host`'s own `mouseleave` cannot
    // dismiss it while the pointer is over it (see `attach()`). This is what
    // does dismiss it — moving off the card in any direction, including back
    // toward the table, where the next `mousemove` on `host` re-shows it.
    // This is a deliberate exit, so it hides immediately — no grace period.
    card.addEventListener('mouseleave', () => LineInfo.hide());

    // Reaching the card cancels any grace-period timer armed by the
    // no-edge `mousemove`s crossing the table on the way here — entering
    // the card keeps it up indefinitely, not just until the timer fires.
    card.addEventListener('mouseenter', () => LineInfo._cancelHideTimer());

    document.body.appendChild(card);
    LineInfo._node = card;

    // Nudge back inside the viewport if the card would overflow.
    const rect = card.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      card.style.left = Math.max(0, clientX - rect.width - 14) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      card.style.top = Math.max(0, clientY - rect.height - 14) + 'px';
    }
  },

  hide() {
    // Every path to the card going away — a real exit, a new render, a
    // zoom change, `show()` replacing it for a different edge — runs
    // through here, so this is the one place that has to clear a pending
    // grace-period timer. Leaving one armed against a card that no longer
    // exists would just fire hide() again harmlessly, but leaving one armed
    // against a *different* card `show()` puts up right after would hide
    // that new one out from under the pointer.
    LineInfo._cancelHideTimer();
    if (LineInfo._node) {
      LineInfo._node.remove();
      LineInfo._node = null;
    }
  }
};
