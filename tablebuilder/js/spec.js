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

      /* Per-cell value fixes, applied over the working rows. Sparse, and each
         guarded by the value it was written against — see corrections.js. The
         source above stays the file as imported. */
      corrections: [],   // [{id, srcIndex, colId, from, to}]

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
        sort: [],               // [{col, dir:'asc'|'desc'}]
        filter: {               // which rows appear at all — see filter.js
          match: 'all',         // 'all' | 'any'
          conditions: []        // [{id, col, op, value, value2}]
        }
      },

      /* Header/footer text parts. */
      parts: {
        title: '',
        subtitle: '',
        stubhead: '',
        caption: '',
        // The caption labels the figure, not the table, so its alignment is
        // its own — not `heading.align` (the title block) and not
        // `table.align` (where the table sits on the page), which it used to
        // borrow. It lives here rather than in `spec.options` because gt has
        // no caption styling: `export-rgt.js` emits every changed option as a
        // `tab_options()` argument, so an option gt does not have would
        // produce R that does not run.
        captionAlign: 'center',
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
        // What `Spec.applySuggestions` last wrote into `parts`, so a later
        // import can tell its own suggestion from something the user typed.
        auto: {},
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
   * Where the data came from, in words — the thing a source note names.
   *
   * A source carries `origin: {kind, label}` when an importer knows better
   * than a filename; a pasted table or a fetched URL would set one. CSV import
   * does not, so this falls back to the filename. **This is the one place that
   * decides what "the source" is called**, so a new importer adds its origin
   * and every derived string follows.
   */
  sourceLabel(source) {
    if (!source) return '';
    if (source.origin && source.origin.label) return String(source.origin.label);
    return String(source.filename || '');
  },

  /**
   * A first pass at the prose for a freshly imported table.
   *
   * Pure, and derived only from the source, so the same import always suggests
   * the same thing — which is what lets `applySuggestions` tell an untouched
   * suggestion from something the user wrote.
   */
  suggestParts(source) {
    const label = Spec.sourceLabel(source);

    // A source that came with a title of its own — an HTML table's `<caption>`
    // — has already said what it is called, better than a filename can.
    const given = source && source.origin && source.origin.title;
    const stem = label.replace(/\.[^.]+$/, '').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
    const title = given ? String(given)
      : (stem ? stem.charAt(0).toUpperCase() + stem.slice(1) : 'Untitled table');

    const rows = (source && source.rows) ? source.rows.length : 0;
    const cols = (source && source.columns) ? source.columns.length : 0;
    const plural = (n, word) => n.toLocaleString() + ' ' + word + (n === 1 ? '' : 's');

    return {
      // The title is safe unescaped — deriving it replaced every `_`, `-` and
      // `.` with a space already. The source note keeps the name verbatim, so
      // it has to be escaped: `field_survey.csv` is a subscript otherwise.
      title: title,
      // The shape of the data rather than filler: it reads like a real
      // subtitle, it is true, and it tells you what the parser actually found.
      subtitle: plural(rows, 'row') + ' × ' + plural(cols, 'column'),
      caption: 'Made with Table Builder',
      sourceNote: label ? 'Source: ' + Markup.escape(label) : ''
    };
  },

  /**
   * Fill in the prose for an import, without ever overwriting the user's own.
   *
   * A part is replaced only when it is empty or still holds the suggestion
   * from last time — recorded in `meta.auto`. So loading a sample and then
   * importing your own file re-derives the title and the source note, while
   * anything you have typed survives untouched.
   *
   * A spec saved before `meta.auto` existed has none, so nothing matches and
   * every part is treated as authored. That is the safe way round.
   */
  applySuggestions(spec, source) {
    const next = Spec.suggestParts(source);
    const auto = spec.meta.auto || {};
    const untouched = (value, was) => !value || (was !== undefined && value === was);

    for (const key of ['title', 'subtitle', 'caption']) {
      if (untouched(spec.parts[key], auto[key])) spec.parts[key] = next[key];
    }

    if (next.sourceNote) {
      const existing = auto.sourceNoteId
        ? spec.parts.sourceNotes.find((note) => note.id === auto.sourceNoteId)
        : null;

      if (existing) {
        if (untouched(existing.text, auto.sourceNote)) existing.text = next.sourceNote;
      } else if (!spec.parts.sourceNotes.length) {
        // Only ever *added* to a table with no source notes at all. Appending
        // to someone's existing list would put a second, unasked-for note
        // under their table on every import.
        const note = { id: Util.uid('sn'), text: next.sourceNote };
        spec.parts.sourceNotes.push(note);
        auto.sourceNoteId = note.id;
      }
    }

    spec.meta.auto = Object.assign({}, auto, {
      title: next.title, subtitle: next.subtitle,
      caption: next.caption, sourceNote: next.sourceNote
    });

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

    // A correction naming a column that no longer exists can never apply and
    // can never be explained. One naming a column that *does* still exist is
    // kept: its `from` guard decides whether it still means anything, which is
    // a question only the new data can answer.
    if (Array.isArray(spec.corrections)) {
      spec.corrections = spec.corrections.filter((c) => c && known.has(c.colId));
    }

    return spec;
  },

  /* ================================================================
     Naming a column
     ================================================================ */

  /**
   * The label the table draws over a column.
   *
   * `adoptColumns` pre-fills `structure.labels` with the humanised header on
   * import, so the fallback here is reached only by a column that arrived
   * without one — a pivot-derived column, or a hand-edited project file. An
   * explicit `''` is a decision and comes back as-is: clearing a column label
   * is how you ask for a blank heading.
   *
   * **This and `columnTitle` are the only two places a column's display name is
   * decided.** There were four, and they disagreed. `compute.js` humanised the
   * raw header, `App.workingColumns` did not, `Selection.columnLabel` fell back
   * to the id, and the Structure panel fell back to the id too — via a `.label`
   * that did not exist on the object it was reading. So a column could be "Mfr"
   * in the table and `mfr` in the rail at the same moment, and a cleared label
   * showed as blank in one place and as the id in three others.
   */
  columnLabel(spec, column) {
    if (!column) return '';
    const label = spec.structure.labels[column.id];
    if (label !== undefined) return label;
    return column.shortName || Util.humanise(column.name || column.id);
  },

  /**
   * What the *editor* calls a column: pickers, chips, the selection summary,
   * button text, prose. Never empty — a column whose label has been cleared
   * still has to be pickable out of a list, so it falls back to its id.
   *
   * The split is the point. `columnLabel` answers "what does the table say",
   * `columnTitle` answers "what do we call this when talking about it". The
   * raw id is a third thing again and belongs only where the user has to type
   * it: a `where` expression, the emitted R, and the Data panel's description
   * of the file it parsed.
   */
  columnTitle(spec, column) {
    if (!column) return '';
    return Spec.columnLabel(spec, column) || column.id;
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

    for (const key of ['format', 'dataColor', 'styleRules', 'fonts', 'corrections']) {
      if (!Array.isArray(out[key])) out[key] = [];
    }
    if (!Array.isArray(out.summaries.groups)) out.summaries.groups = [];
    if (!Array.isArray(out.summaries.grand)) out.summaries.grand = [];
    if (!Array.isArray(out.parts.sourceNotes)) out.parts.sourceNotes = [];
    if (!Array.isArray(out.parts.footnotes)) out.parts.footnotes = [];

    // A spec saved before the caption had an alignment of its own inherits the
    // one it was actually drawn with — `table.align`, which the caption's CSS
    // used to derive from — so reopening a project does not move its caption.
    if (!obj.parts || obj.parts.captionAlign === undefined) {
      const tableAlign = out.options['table.align'];
      out.parts.captionAlign = tableAlign === 'right' ? 'right'
        : (tableAlign === 'center' ? 'center' : 'left');
    }

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
/**
 * Store — owns the current spec, the history, and change notification.
 *
 * History is one timeline of states with a cursor into it, rather than the two
 * stacks it used to be. Undo moves the cursor back, redo moves it forward, and
 * a new action drops everything after it. That is the same behaviour two
 * stacks gave, and it also *is* the list the history menu shows: with two
 * stacks the actions were split across both and neither knew its own order.
 *
 * `_history[0]` is where the session started — an import, an opened project or
 * an empty one — so the cursor sitting at 0 means "nothing done yet".
 */
const Store = {

  _history: [],
  _cursor: 0,
  _subs: [],
  _lastCommit: { key: null, at: 0 },
  _muted: false,

  MAX_UNDO: 60,
  COALESCE_MS: 700,

  /** Start with a given spec (or an empty one). */
  init(spec, label) {
    Store._history = [{ spec: spec || Spec.create(), label: label || 'Opened', at: Date.now() }];
    Store._cursor = 0;
    Store._lastCommit = { key: null, at: 0 };
    Store.emit('init');
  },

  /** The live spec. Treat as read-only; mutate through `update`. */
  get() {
    const entry = Store._history[Store._cursor];
    return entry ? entry.spec : null;
  },

  /**
   * Apply a mutation and notify.
   *
   * @param {Function} fn - receives a draft clone of the spec; mutate it in place
   * @param {Object} [opts]
   * @param {string} [opts.coalesce] - repeated updates with the same key inside
   *   COALESCE_MS collapse into one undo entry (for sliders and drags)
   * @param {string} [opts.reason] - change reason passed to subscribers
   * @param {string} [opts.label] - what to call this in the history list;
   *   derived from the change itself when absent
   */
  update(fn, opts) {
    opts = opts || {};
    const previous = Store.get();
    const draft = Util.clone(previous);

    const result = fn(draft);
    if (result === false) return;               // mutation opted out
    const next = result && typeof result === 'object' ? result : draft;

    next.meta.modified = new Date().toISOString();

    const now = Date.now();
    const coalescing = opts.coalesce &&
      Store._lastCommit.key === opts.coalesce &&
      (now - Store._lastCommit.at) < Store.COALESCE_MS;

    const label = opts.label || History.describe(previous, next);

    if (coalescing) {
      // Typing in a field is one action, not one per keystroke: the entry the
      // run started is rewritten rather than a new one added.
      Store._history[Store._cursor] = { spec: next, label: label, at: now };
    } else {
      // Anything redone-past is gone the moment a new branch starts.
      Store._history.length = Store._cursor + 1;
      Store._history.push({ spec: next, label: label, at: now });
      Store._cursor += 1;

      // The oldest state falls off the end. The cursor moves with it, since it
      // counts from the start of the list.
      if (Store._history.length > Store.MAX_UNDO + 1) {
        Store._history.shift();
        Store._cursor -= 1;
      }
    }

    Store._lastCommit = { key: opts.coalesce || null, at: now };
    Store.emit(opts.reason || 'update');
  },

  /** Replace the whole spec, starting a fresh history (import / open / new). */
  replace(spec, reason, label) {
    Store._history = [{ spec: spec, label: label || 'Opened', at: Date.now() }];
    Store._cursor = 0;
    Store._lastCommit = { key: null, at: 0 };
    Store.emit(reason || 'replace');
  },

  canUndo() { return Store._cursor > 0; },
  canRedo() { return Store._cursor < Store._history.length - 1; },

  undo() {
    if (!Store.canUndo()) return;
    Store._cursor -= 1;
    Store._lastCommit = { key: null, at: 0 };
    Store.emit('undo');
  },

  redo() {
    if (!Store.canRedo()) return;
    Store._cursor += 1;
    Store._lastCommit = { key: null, at: 0 };
    Store.emit('redo');
  },

  /**
   * The whole timeline, oldest first, for the history menu.
   * @returns {Array<{index, label, at, current, future}>}
   */
  entries() {
    return Store._history.map((entry, index) => ({
      index: index,
      label: entry.label,
      at: entry.at,
      current: index === Store._cursor,
      // Redone-past states: still reachable, but not part of the table as it
      // stands. The menu dims them.
      future: index > Store._cursor
    }));
  },

  /** Move the cursor straight to a point in the timeline. */
  jumpTo(index) {
    const target = Math.max(0, Math.min(Store._history.length - 1, index));
    if (target === Store._cursor) return;
    Store._cursor = target;
    Store._lastCommit = { key: null, at: 0 };
    Store.emit('jump');
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
        fn(Store.get(), reason);
      } catch (err) {
        console.error('Store subscriber failed:', err);
      }
    }
  },

  /* ---------- Autosave ---------- */

  /** Persist the working spec to localStorage (debounced by the caller). */
  save() {
    try {
      localStorage.setItem(Spec.STORAGE_KEY, JSON.stringify(Store.get()));
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
