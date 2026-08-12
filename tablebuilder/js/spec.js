/**
 * spec.js
 *
 * The TableSpec — the single piece of mutable state in the app — plus the
 * Store that owns it (undo/redo, subscribers, autosave).
 *
 * Everything the user does is a change to this plain JSON object. Rendering is
 * a pure function of it (see compute.js), so the spec is also the entire save
 * file and the source for every exporter.
 */

const Spec = {

  VERSION: 1,

  /** Storage key for the autosaved working spec. */
  STORAGE_KEY: 'table_builder.spec.v1',

  /**
   * A complete spec with no data in it.
   * Every section is always present so no consumer needs existence checks.
   */
  create() {
    return {
      version: Spec.VERSION,

      /* Parsed CSV, as imported. Never mutated by the editor. */
      source: {
        filename: '',
        delimiter: ',',
        columns: [],   // [{id, name, type: 'number'|'text'|'date'|'bool'}]
        rows: []       // [{colId: value}]
      },

      /* Optional long -> wide reshape applied before anything else. */
      reshape: {
        mode: 'none',      // 'none' | 'pivot'
        idCols: [],        // columns that identify a row
        nameCols: [],      // columns whose values become column groups (outer -> inner)
        valueCols: [],     // columns holding the values
        aggregate: 'first',// how to combine collisions
        nameSep: ' > '     // joins nameCols into a column id
      },

      /* Table shape. */
      structure: {
        rownameCol: null,       // gt rowname_col — becomes the stub
        groupnameCol: null,     // gt groupname_col — becomes row groups
        columnOrder: [],        // ids, in display order (cols_move)
        hidden: [],             // ids hidden from display (cols_hide)
        labels: {},             // id -> label (cols_label)
        align: {},              // id -> 'left'|'center'|'right'|'auto'
        widths: {},             // id -> CSS length (cols_width)
        spanners: [],           // [{id, label, columns:[colId], level:1}]
        rowGroupOrder: [],      // group labels, in display order
        stubIndent: {},         // rowIndex -> indent steps
        merges: [],             // [{id, type, target, columns, pattern, sep}]
        sort: []                // [{col, dir:'asc'|'desc'}]
      },

      /* Header/footer text parts. */
      parts: {
        title: '',
        subtitle: '',
        stubhead: '',
        caption: '',
        sourceNotes: [],   // [{id, text}]
        footnotes: []      // [{id, text, location}]
      },

      /* Value formatting. Later rules win on overlap. */
      format: [],          // [{id, type, columns, rows, opts}]
      subs: {
        missing: { enabled: true, text: '—' },
        zero: { enabled: false, text: '' }
      },

      /* Value-driven cell colouring. */
      dataColor: [],       // [{id, columns, method, palette, ...}]

      /* Aggregated rows. */
      summaries: {
        groups: [],        // [{id, fns, columns, labels, formatId}]
        grand: []          // [{id, fn, columns, label}]
      },

      /* Presentation rules, applied in order. */
      styleRules: [],      // [{id, enabled, label, locations, style}]

      /* The tab_options() surface. */
      options: OptionsSchema.defaults(),

      /* User-added fonts. Carried in the project so it stays self-contained
         and every exporter can reach the face. See fonts.js. */
      fonts: [],

      /* Bookkeeping. */
      meta: {
        name: 'Untitled table',
        theme: 'gt-default',
        created: new Date().toISOString(),
        modified: new Date().toISOString()
      }
    };
  },

  /**
   * A spec initialised from freshly parsed CSV data: all columns visible in
   * file order, labels humanised, numeric columns right-aligned.
   */
  fromSource(source) {
    const spec = Spec.create();
    spec.source = source;
    Spec.adoptColumns(spec, source.columns);
    spec.meta.name = (source.filename || 'table').replace(/\.[^.]+$/, '');
    return spec;
  },

  /**
   * Reset the structure section to match a set of columns, preserving any
   * settings whose column still exists. Used on import and after a reshape.
   */
  adoptColumns(spec, columns) {
    const ids = columns.map((c) => c.id);
    const known = new Set(ids);
    const st = spec.structure;

    // Keep the existing order for surviving columns, append anything new.
    const kept = st.columnOrder.filter((id) => known.has(id));
    for (const id of ids) if (!kept.includes(id)) kept.push(id);
    st.columnOrder = kept;

    st.hidden = st.hidden.filter((id) => known.has(id));
    if (st.rownameCol && !known.has(st.rownameCol)) st.rownameCol = null;
    if (st.groupnameCol && !known.has(st.groupnameCol)) st.groupnameCol = null;

    for (const key of ['labels', 'align', 'widths']) {
      const next = {};
      for (const id in st[key]) if (known.has(id)) next[id] = st[key][id];
      st[key] = next;
    }

    // Defaults for columns we have not seen before.
    for (const col of columns) {
      if (st.labels[col.id] === undefined) st.labels[col.id] = Util.humanise(col.name);
      if (st.align[col.id] === undefined) st.align[col.id] = 'auto';
    }

    st.spanners = st.spanners
      .map((sp) => Object.assign({}, sp, { columns: sp.columns.filter((id) => known.has(id)) }))
      .filter((sp) => sp.columns.length > 0);

    st.sort = st.sort.filter((s) => known.has(s.col));
    spec.format = spec.format.filter((f) => f.columns.some((id) => known.has(id)));
    spec.dataColor = spec.dataColor.filter((d) => d.columns.some((id) => known.has(id)));

    return spec;
  },

  /** Default alignment for a column: numbers right, everything else left. */
  defaultAlign(column) {
    if (!column) return 'left';
    return column.type === 'number' ? 'right' : 'left';
  },

  /**
   * Bring an older or partial spec up to the current shape. Missing sections
   * are filled from `create()` so hand-edited files still load.
   */
  migrate(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('Not a table spec.');
    const base = Spec.create();
    const out = Object.assign({}, base, obj);

    // Merge one level deep for the structured sections.
    for (const key of ['source', 'reshape', 'structure', 'parts', 'subs', 'summaries', 'meta']) {
      out[key] = Object.assign({}, base[key], obj[key] || {});
    }
    // Options: unknown keys are dropped, missing keys take their default.
    out.options = Object.assign({}, base.options, obj.options || {});

    for (const key of ['format', 'dataColor', 'styleRules', 'fonts']) {
      if (!Array.isArray(out[key])) out[key] = [];
    }
    if (!Array.isArray(out.summaries.groups)) out.summaries.groups = [];
    if (!Array.isArray(out.summaries.grand)) out.summaries.grand = [];
    if (!Array.isArray(out.parts.sourceNotes)) out.parts.sourceNotes = [];
    if (!Array.isArray(out.parts.footnotes)) out.parts.footnotes = [];

    out.version = Spec.VERSION;
    return out;
  },

  /** True when the spec has data to render. */
  hasData(spec) {
    return !!(spec && spec.source && spec.source.rows && spec.source.rows.length);
  }
};


/**
 * Store — owns the current spec, the undo stack, and change notification.
 */
const Store = {

  _spec: null,
  _undo: [],
  _redo: [],
  _subs: [],
  _lastCommit: { key: null, at: 0 },
  _muted: false,

  MAX_UNDO: 60,
  COALESCE_MS: 700,

  /** Start with a given spec (or an empty one). */
  init(spec) {
    Store._spec = spec || Spec.create();
    Store._undo = [];
    Store._redo = [];
    Store._lastCommit = { key: null, at: 0 };
    Store.emit('init');
  },

  /** The live spec. Treat as read-only; mutate through `update`. */
  get() {
    return Store._spec;
  },

  /**
   * Apply a mutation and notify.
   *
   * @param {Function} fn - receives a draft clone of the spec; mutate it in place
   * @param {Object} [opts]
   * @param {string} [opts.coalesce] - repeated updates with the same key inside
   *   COALESCE_MS collapse into one undo entry (for sliders and drags)
   * @param {string} [opts.reason] - change reason passed to subscribers
   */
  update(fn, opts) {
    opts = opts || {};
    const previous = Store._spec;
    const draft = Util.clone(previous);

    const result = fn(draft);
    if (result === false) return;               // mutation opted out
    const next = result && typeof result === 'object' ? result : draft;

    next.meta.modified = new Date().toISOString();

    const now = Date.now();
    const coalescing = opts.coalesce &&
      Store._lastCommit.key === opts.coalesce &&
      (now - Store._lastCommit.at) < Store.COALESCE_MS;

    if (!coalescing) {
      Store._undo.push(previous);
      if (Store._undo.length > Store.MAX_UNDO) Store._undo.shift();
    }
    Store._lastCommit = { key: opts.coalesce || null, at: now };
    Store._redo = [];
    Store._spec = next;

    Store.emit(opts.reason || 'update');
  },

  /** Replace the whole spec, clearing history (import / new file). */
  replace(spec, reason) {
    Store._spec = spec;
    Store._undo = [];
    Store._redo = [];
    Store._lastCommit = { key: null, at: 0 };
    Store.emit(reason || 'replace');
  },

  canUndo() { return Store._undo.length > 0; },
  canRedo() { return Store._redo.length > 0; },

  undo() {
    if (!Store._undo.length) return;
    Store._redo.push(Store._spec);
    Store._spec = Store._undo.pop();
    Store._lastCommit = { key: null, at: 0 };
    Store.emit('undo');
  },

  redo() {
    if (!Store._redo.length) return;
    Store._undo.push(Store._spec);
    Store._spec = Store._redo.pop();
    Store._lastCommit = { key: null, at: 0 };
    Store.emit('redo');
  },

  /** Subscribe to changes. Returns an unsubscribe function. */
  subscribe(fn) {
    Store._subs.push(fn);
    return () => {
      const idx = Store._subs.indexOf(fn);
      if (idx >= 0) Store._subs.splice(idx, 1);
    };
  },

  emit(reason) {
    if (Store._muted) return;
    for (const fn of Store._subs.slice()) {
      try {
        fn(Store._spec, reason);
      } catch (err) {
        console.error('Store subscriber failed:', err);
      }
    }
  },

  /* ---------- Autosave ---------- */

  /** Persist the working spec to localStorage (debounced by the caller). */
  save() {
    try {
      localStorage.setItem(Spec.STORAGE_KEY, JSON.stringify(Store._spec));
      return true;
    } catch (err) {
      // Quota exceeded on a very large CSV — not fatal, the session still works.
      console.warn('Autosave failed:', err);
      return false;
    }
  },

  /** Load the autosaved spec, or null if there isn't one. */
  loadSaved() {
    try {
      const raw = localStorage.getItem(Spec.STORAGE_KEY);
      if (!raw) return null;
      return Spec.migrate(JSON.parse(raw));
    } catch (err) {
      console.warn('Could not restore autosave:', err);
      return null;
    }
  },

  /** Forget the autosave. */
  clearSaved() {
    try { localStorage.removeItem(Spec.STORAGE_KEY); } catch (e) { /* ignore */ }
  }
};
