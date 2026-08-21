/**
 * ui/selection.js
 *
 * Direct manipulation over the preview: click a cell, a column label, a
 * spanner, a group label or the title to select it.
 *
 * Selection is stored logically — part, column id, source row index — not as
 * DOM nodes. The preview is rebuilt from scratch on every spec change, so node
 * references would go stale instantly; logical descriptors survive, and are
 * re-applied to the fresh DOM after each render.
 */

const Selection = {

  /** [{part, colId, srcIndex, groupId, spannerId}] */
  items: [],
  anchor: null,
  _previewRule: null,

  /* ================================================================
     State
     ================================================================ */

  current() {
    return Selection.items;
  },

  /** Distinct column ids in the selection, in table order. */
  selectedColumnIds() {
    // Through `Spec.orderColumns`, because `columnOrder` is a preference and
    // never mentions a pivot's output — sorting by `indexOf` alone gives every
    // pivot-derived column the same rank of -1, so a selection across them came
    // back in whatever order it was clicked.
    const ids = Util.unique(Selection.items.map((s) => s.colId).filter(Boolean));
    const order = Spec.orderColumns(Store.get().structure.columnOrder,
      (App.model && App.model.columns ? App.model.columns.map((col) => col.id) : ids));
    return ids.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
  },

  /** Distinct source row indices in the selection. */
  selectedRowIndices() {
    return Util.unique(Selection.items
      .map((s) => s.srcIndex)
      .filter((i) => i !== undefined && i !== null)).sort((a, b) => a - b);
  },

  /** Every data row on screen, in order. Summary and group rows are not data. */
  dataRowIndices() {
    const model = App.model;
    if (!model || !model.rows) return [];
    return model.rows.filter((r) => r.kind === 'data').map((r) => r.srcIndex);
  },

  /**
   * Descriptors for one whole column of body cells.
   *
   * Without this a whole column is only reachable by clicking its first cell
   * and shift-clicking its last — which means scrolling the table, and on a
   * truncated preview silently stops at the last row on screen.
   */
  bodyColumn(colId) {
    const model = App.model;
    if (!model || !colId) return [];

    // A stub location carries no column: `compute.js` resolves stub cells with
    // `colId: undefined`, `render-html.js` withholds their `data-col`, and
    // `rangeFrom` below already builds them that way. Putting one on anyway
    // matches no DOM node and no style rule — the selection looks right and
    // then silently does nothing.
    const isStub = model.stubColId === colId;
    return Selection.dataRowIndices().map((srcIndex) => (isStub
      ? { part: 'stub', srcIndex: srcIndex }
      : { part: 'body', colId: colId, srcIndex: srcIndex }));
  },

  /** The single part every selected item shares, or null when mixed. */
  commonPart() {
    if (!Selection.items.length) return null;
    const part = Selection.items[0].part;
    return Selection.items.every((s) => s.part === part) ? part : null;
  },

  set(items) {
    Selection.items = items;
    Selection.emit();
  },

  clear() {
    Selection.items = [];
    Selection.anchor = null;
    Selection.emit();
  },

  /**
   * A selection changed.
   *
   * Selecting a cell changes no spec, so the spec render loop never runs and
   * nothing here updates by itself. There is deliberately no subscriber list:
   * every selection-dependent view is refreshed by `App.onSelectionChange`, so
   * there is exactly one place to look and exactly one place to add to.
   */
  emit() {
    App.onSelectionChange();
  },

  /** The table currently in the preview, or null. */
  liveTable() {
    return Util.qs('#preview-host .gt-table');
  },

  /* ================================================================
     Wiring
     ================================================================ */

  /**
   * Attach handlers to a freshly rendered table and restore the visual state
   * of whatever was already selected.
   */
  attach(table) {
    if (!table) return;

    table.addEventListener('click', (e) => {
      const cell = e.target.closest('.gt-cell');
      if (!cell) {
        if (!e.shiftKey && !e.metaKey && !e.ctrlKey) Selection.clear();
        return;
      }
      e.preventDefault();
      Selection.handleClick(cell, e);
    });

    Selection.paint(table);
  },

  handleClick(cell, e) {
    const item = Selection.descriptorOf(cell);
    if (!item) return;

    const additive = e.metaKey || e.ctrlKey;
    const ranged = e.shiftKey && Selection.anchor;

    // Alt-click a column heading to take the column under it. The heading
    // itself stays plain-clickable, since it is styled separately from the
    // body cells beneath it.
    if (e.altKey) {
      const colId = item.part === 'column_labels' ? item.colId
        : (item.part === 'stubhead' ? (App.model && App.model.stubColId) : null);
      const column = colId ? Selection.bodyColumn(colId) : [];
      if (column.length) {
        Selection.anchor = column[0];
        Selection.set(column);
        return;
      }
    }

    if (ranged) {
      Selection.set(Selection.rangeFrom(Selection.anchor, item));
      return;
    }

    if (additive) {
      const key = Compute.locationKey(item);
      const existing = Selection.items.findIndex((s) => Compute.locationKey(s) === key);
      const next = Selection.items.slice();
      if (existing >= 0) next.splice(existing, 1);
      else next.push(item);
      Selection.anchor = item;
      Selection.set(next);
      return;
    }

    Selection.anchor = item;
    Selection.set([item]);
  },

  /** Read a cell's data attributes back into a logical descriptor. */
  descriptorOf(cell) {
    const data = cell.dataset;
    if (!data.part) return null;

    const item = { part: data.part };
    if (data.col) item.colId = data.col;
    if (data.row !== undefined && data.row !== '') item.srcIndex = parseInt(data.row, 10);
    if (data.group) item.groupId = data.group;
    if (data.spanner) item.spannerId = data.spanner;
    return item;
  },

  /**
   * The rectangle between two body cells: every column between their columns,
   * every row between their rows. Outside the body a range is meaningless, so
   * it falls back to the two endpoints.
   */
  rangeFrom(anchor, target) {
    if (anchor.part !== target.part) return [target];

    const model = App.model;
    if (!model) return [target];

    const bodyLike = anchor.part === 'body' || anchor.part === 'stub';
    if (!bodyLike) {
      // Column labels: select the run of columns between the two.
      if (anchor.part === 'column_labels' && anchor.colId && target.colId) {
        const order = model.cols.filter((c) => c.kind === 'body').map((c) => c.colId);
        const a = order.indexOf(anchor.colId);
        const b = order.indexOf(target.colId);
        if (a < 0 || b < 0) return [target];
        return order.slice(Math.min(a, b), Math.max(a, b) + 1)
          .map((colId) => ({ part: 'column_labels', colId: colId }));
      }
      return [anchor, target];
    }

    const order = model.cols.filter((c) => c.kind === 'body').map((c) => c.colId);
    const rows = model.rows.filter((r) => r.kind === 'data').map((r) => r.srcIndex);

    const rowA = rows.indexOf(anchor.srcIndex);
    const rowB = rows.indexOf(target.srcIndex);
    if (rowA < 0 || rowB < 0) return [target];
    const rowSlice = rows.slice(Math.min(rowA, rowB), Math.max(rowA, rowB) + 1);

    // A range that starts or ends in the stub covers the stub for those rows.
    if (anchor.part === 'stub' || !anchor.colId || !target.colId) {
      return rowSlice.map((srcIndex) => ({ part: 'stub', srcIndex: srcIndex }));
    }

    const colA = order.indexOf(anchor.colId);
    const colB = order.indexOf(target.colId);
    if (colA < 0 || colB < 0) return [target];
    const colSlice = order.slice(Math.min(colA, colB), Math.max(colA, colB) + 1);

    const out = [];
    for (const srcIndex of rowSlice) {
      for (const colId of colSlice) {
        out.push({ part: 'body', colId: colId, srcIndex: srcIndex });
      }
    }
    return out;
  },

  /* ================================================================
     Painting
     ================================================================ */

  /** Re-apply selection classes to a freshly rendered table. */
  paint(table) {
    if (!table) return;

    for (const cell of Util.qsa('.is-selected, .is-selected-anchor, .is-rule-preview', table)) {
      cell.classList.remove('is-selected', 'is-selected-anchor', 'is-rule-preview');
    }

    const anchorKey = Selection.anchor ? Compute.locationKey(Selection.anchor) : null;

    // Selecting a whole column is 2000 items on a capped preview, and this runs
    // again on every preview rebuild — so with a column selected it would be
    // paid on every keystroke. One walk of the table beats one querySelector
    // per item; `nodeFor` still covers the parts that sit outside a data row.
    const inRows = Selection.items.length > 1 ? Selection.indexRowCells(table) : null;

    for (const item of Selection.items) {
      let node = null;
      if (inRows && item.srcIndex !== undefined && item.srcIndex !== null) {
        node = inRows.get(Selection.rowCellKey(item.part, item.colId, item.srcIndex)) || null;
      }
      if (!node) node = Selection.nodeFor(table, item);
      if (!node) continue;
      node.classList.add(Compute.locationKey(item) === anchorKey ? 'is-selected-anchor' : 'is-selected');
    }

    if (Selection._previewRule) Selection.paintRulePreview(table, Selection._previewRule);
  },

  /** Every cell that sits in a data row, keyed the way `nodeFor` matches them. */
  indexRowCells(table) {
    const index = new Map();
    for (const node of Util.qsa('.gt-cell[data-row]', table)) {
      index.set(Selection.rowCellKey(node.dataset.part, node.dataset.col, node.dataset.row), node);
    }
    return index;
  },

  rowCellKey(part, colId, srcIndex) {
    return part + '|' + (colId === undefined || colId === null ? '' : colId) + '|' + srcIndex;
  },

  /** Find the DOM cell matching a logical descriptor. */
  nodeFor(table, item) {
    const bits = ['[data-part="' + item.part + '"]'];
    if (item.colId) bits.push('[data-col="' + CSS.escape(item.colId) + '"]');
    else bits.push(':not([data-col])');
    if (item.srcIndex !== undefined && item.srcIndex !== null) bits.push('[data-row="' + item.srcIndex + '"]');
    if (item.spannerId) bits.push('[data-spanner="' + CSS.escape(item.spannerId) + '"]');
    if (item.groupId && !item.colId) bits.push('[data-group="' + CSS.escape(item.groupId) + '"]');

    try {
      return table.querySelector(bits.join(''));
    } catch (err) {
      return null;
    }
  },

  /* ================================================================
     Rule preview
     ================================================================ */

  /** Flash the cells a rule targets. Pass null to clear. */
  previewRule(rule) {
    Selection._previewRule = rule;
    const table = Selection.liveTable();
    if (!table) return;

    for (const cell of Util.qsa('.is-rule-preview', table)) cell.classList.remove('is-rule-preview');
    if (rule) Selection.paintRulePreview(table, rule);
  },

  paintRulePreview(table, rule) {
    if (!rule || !rule.locations) return;

    // The error this may produce is deliberately dropped: hovering a rule is
    // not editing it, and the render's own compile is what the warning in the
    // Style panel reports on.
    const compiled = StyleRules.compile([Object.assign({}, rule, {
      enabled: true,
      style: { text: { color: '#000' } }   // force a non-empty style so it compiles
    })], {
      rows: App.workingRows(),
      columnsById: App.workingColumnsById()
    });
    if (!compiled.rules.length) return;

    for (const cell of Util.qsa('.gt-cell', table)) {
      const item = Selection.descriptorOf(cell);
      if (!item) continue;
      if (StyleRules.resolve(compiled.rules, item)) cell.classList.add('is-rule-preview');
    }
  },

  /* ================================================================
     Description
     ================================================================ */

  /** A gt-flavoured description of the selection, shown in the toolbar chip. */
  describe() {
    const items = Selection.items;
    if (!items.length) return null;

    const part = Selection.commonPart();
    if (!part) return items.length + ' cells selected';

    const meta = StyleRules.PARTS.find((p) => p.id === part);
    const gt = meta ? meta.gt : part;

    const cols = Selection.selectedColumnIds();
    const rows = Selection.selectedRowIndices();
    const args = [];

    if (cols.length) {
      args.push('columns = ' + (cols.length <= 3 ? cols.join(', ') : cols.length + ' cols'));
    }
    if (rows.length) {
      args.push('rows = ' + (rows.length <= 3
        ? rows.map((r) => r + 1).join(', ')
        : (rows[0] + 1) + ':' + (rows[rows.length - 1] + 1)));
    }

    if (part === 'column_spanners') {
      const ids = Util.unique(items.map((s) => s.spannerId).filter(Boolean));
      const spanners = (App.model && App.model.spanners) || [];
      const labels = ids.map((id) => (spanners.find((sp) => sp.id === id) || {}).label).filter(Boolean);
      if (labels.length) args.push('spanners = ' + labels.join(', '));
    }

    if (part === 'row_groups') {
      const ids = Util.unique(items.map((s) => s.groupId).filter(Boolean));
      if (ids.length) args.push('groups = ' + ids.slice(0, 3).join(', '));
    }

    const base = gt.indexOf('(') >= 0 ? gt : gt + '(' + args.join(', ') + ')';
    return items.length + ' × ' + base;
  },

  /**
   * What to call a column in the selection chip and summary.
   *
   * Goes through `Spec.columnTitle` rather than reading `model.cols` for the
   * label, because a hidden column can still be part of a selection descriptor
   * while having no entry in `model.cols` at all — and because the label a
   * chip shows and the label the table draws must not be decided twice.
   * `describe()` keeps the raw id: that one is gt code, where the id is the
   * name.
   */
  columnLabel(colId) {
    const model = App.model;
    if (!model || !model.columnsById || !model.columnsById[colId]) return colId;
    // Against the whole set, so the chip and the Location line do not read
    // `employment` for three different columns.
    return Spec.columnTitles(Store.get(), model.columns)[colId] || colId;
  },

  /**
   * The selection in plain language: `1 cell · Body cells · Lower CI · row 2`.
   * `describe()` remains the gt form, shown as a tooltip.
   */
  describePlain() {
    const items = Selection.items;
    if (!items.length) return null;

    const count = items.length === 1 ? '1 cell' : items.length + ' cells';
    const part = Selection.commonPart();
    if (!part) return count;

    const meta = StyleRules.PARTS.find((p) => p.id === part);
    const bits = [meta ? meta.label : part];

    const cols = Selection.selectedColumnIds();
    if (cols.length && cols.length <= 3) {
      bits.push(cols.map(Selection.columnLabel).join(', '));
    } else if (cols.length) {
      bits.push(cols.length + ' columns');
    }

    const rows = Selection.selectedRowIndices();
    if (rows.length === 1) {
      bits.push('row ' + (rows[0] + 1));
    } else if (rows.length && rows.length <= 3) {
      bits.push('rows ' + rows.map((r) => r + 1).join(', '));
    } else if (rows.length) {
      bits.push('rows ' + (rows[0] + 1) + '–' + (rows[rows.length - 1] + 1));
    }

    return count + ' · ' + bits.join(' · ');
  },

  /* ================================================================
     Column resizing
     ================================================================ */

  /**
   * Overlay drag handles on the column boundaries so widths can be set by
   * dragging rather than typing a number into the structure panel.
   *
   * **Everything here is in unscaled px.** The layer is a child of
   * `#preview-host`, which carries the stage's zoom as a `transform`, so a
   * handle written in the table's own pixels is scaled onto the line it belongs
   * to by the same transform that drew the line. Measuring
   * `getBoundingClientRect()` and writing the result straight back scaled it
   * twice: on a 24-column table at the 0.52 Fit lands on, the handles sat 26px
   * left of the first boundary and 471px left of the last. Wide tables are the
   * ones you have to zoom to see at all, which is why that is where it showed.
   *
   * The boundaries come from `Measure.gridGeometry` — the same measurement
   * `LineInfo` hit-tests to name a line and offer "drag to resize the column".
   * A handle and that card describing different lines is the two-producers
   * failure this codebase keeps paying for, so there is one producer. No grid
   * is passed: the handles key on the DOM's own columns and have nothing to
   * check an edge grid against.
   */
  attachResizers(host, table, model) {
    const existing = Util.qs('.resize-layer', host);
    if (existing) existing.remove();
    if (!model || !model.cols.length) return;

    const zoom = (typeof App !== 'undefined' && App.zoom) || 1;
    const geo = Measure.gridGeometry(table, null, zoom);
    if (geo.colEdges.length < 2) return;

    const hostRect = host.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const originX = (tableRect.left - hostRect.left) / zoom;
    const originY = (tableRect.top - hostRect.top) / zoom;
    const height = tableRect.height / zoom;

    const layer = Util.el('div.resize-layer');
    for (let i = 0; i < model.cols.length; i += 1) {
      const modelCol = model.cols[i];
      const edge = geo.colEdges[i + 1];
      if (!modelCol || !modelCol.colId || edge === undefined) continue;

      const handle = Util.el('div.col-resizer', {
        style: {
          left: (originX + edge) + 'px',
          top: originY + 'px',
          height: height + 'px'
        },
        title: 'Drag to set the width of “' + (modelCol.label || modelCol.colId) + '”'
      });

      Selection.wireResizer(handle, modelCol.colId, edge - geo.colEdges[i]);
      layer.appendChild(handle);
    }

    host.appendChild(layer);
  },

  /**
   * Turn a handle into a drag that writes a column width.
   *
   * `structure.widths` is a CSS length on the table, so both the width the drag
   * starts from and the distance the pointer travels have to be in the table's
   * pixels rather than the screen's. `startWidth` arrives unscaled from
   * `attachResizers`; the pointer delta is divided here, at mousedown, because
   * the zoom can have changed since the handle was built. Taking the screen
   * numbers instead snapped the column to `zoom ×` its width on the very first
   * mousemove — halving it at the zoom Fit usually lands on — and then tracked
   * the pointer at the wrong speed.
   */
  wireResizer(handle, colId, startWidth) {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const zoom = (typeof App !== 'undefined' && App.zoom) || 1;
      handle.classList.add('is-dragging');

      const onMove = (move) => {
        const width = Math.max(24,
          Math.round(startWidth + (move.clientX - startX) / zoom));
        Store.update((draft) => {
          draft.structure.widths[colId] = width + 'px';
        }, { coalesce: 'resize.' + colId });
      };

      const onUp = () => {
        handle.classList.remove('is-dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
};
