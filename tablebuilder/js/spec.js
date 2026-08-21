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

      /* The structural pipeline: an ordered list of steps turning the file
         above into the table the aesthetic layer decorates. See pipeline.js
         for the step types and why the two stages cannot interleave. This
         replaced `spec.reshape` and the structural half of `spec.structure`,
         where the same operations sat with their order baked invisibly into
         `Compute.run`. */
      pipeline: [],      // [{id, type, enabled, ...params}]

      /* How the table looks, column by column. Everything here is display
         only: a hidden column is still in the data, so a `where` expression
         and gt's own `rows =` predicate both still reach its values. To take
         a column out of the data, use a `remove` step. */
      structure: {
        columnOrder: [],        // ids, in display order (cols_move)
        hidden: [],             // ids hidden from display (cols_hide)
        labels: {},             // id -> label (cols_label)
        align: {},              // id -> 'left'|'center'|'right'|'auto'
        widths: {},             // id -> CSS length (cols_width)
        stubIndent: {}          // rowIndex -> indent steps
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
    Spec.adoptColumns(spec);
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
    // **The pipeline's columns, not the file's.** These are aesthetic settings
    // keyed by column id, and the ids a pivot produces are not in the source —
    // so pruning against the file dropped the width, alignment and hidden flag
    // of every derived column on reimport, while the column itself came
    // straight back.
    columns = columns || Pipeline.run(spec.source, spec.pipeline).columns;
    const ids = columns.map((c) => c.id);
    const known = new Set(ids);
    const st = spec.structure;

    // Keep the existing order for surviving columns, append anything new.
    // `compute.js` treats this as a *preference* rather than the list of what
    // exists, so it does not have to be exhaustive or current — this only
    // keeps the file from accumulating ids for columns nobody will see again.
    const kept = st.columnOrder.filter((id) => known.has(id));
    for (const id of ids) if (!kept.includes(id)) kept.push(id);
    st.columnOrder = kept;

    st.hidden = st.hidden.filter((id) => known.has(id));

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

    spec.format = spec.format.filter((f) => f.columns.some((id) => known.has(id)));
    spec.dataColor = spec.dataColor.filter((d) => d.columns.some((id) => known.has(id)));

    // **Nothing structural is pruned here any more.** A step naming a column
    // the data no longer has is not damage to repair — it is a step waiting
    // for data that fits it, which is the ordinary state of a pipeline whose
    // earlier steps have just been reordered. `Pipeline.run` reports each one
    // as inert, on the step itself, and it comes back to life if the column
    // does. That is a better answer than deleting the user's work on import.
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
    for (const key of ['source', 'structure', 'parts', 'subs', 'meta']) {
      out[key] = Object.assign({}, base[key], obj[key] || {});
    }

    Spec.migratePipeline(out, obj);
    // Options: unknown keys are dropped, missing keys take their default.
    out.options = Object.assign({}, base.options, obj.options || {});

    for (const key of ['format', 'dataColor', 'styleRules', 'fonts', 'pipeline']) {
      if (!Array.isArray(out[key])) out[key] = [];
    }

    /*
     * Colour rules used to offer equal bins and quantiles as well. Both are
     * statements about a particular set of rows rather than about the values,
     * and the tables that want one are better served by
     * `data_color(method = "bin")` in the exported R than by a control most
     * tables never touch.
     *
     * A rule saved with either becomes continuous rather than being left
     * holding a method the picker cannot show — a select with no matching
     * option renders blank and writes whatever is chosen next, which is the
     * trap the `inherit` work was about. **This changes how such a project
     * draws**, and it is the one part of a removal that cannot be undone by
     * preference: a binned scale becomes a smooth one over the same domain.
     */
    for (const rule of out.dataColor) {
      if (rule.method === 'bin' || rule.method === 'quantile') rule.method = 'numeric';
      delete rule.bins;
    }
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

  /**
   * Turn a pre-pipeline spec into `spec.pipeline`, and drop what it came from.
   *
   * **The canonical order is chosen to reproduce the old render exactly**, not
   * because it is the only sensible one: `Compute.run` applied the pivot, then
   * corrections, then the filter, then the sort, and drew the stub, groups,
   * merges and spanners from whatever `spec.structure` held. A project that
   * opens after this must look the same as it did before it, which is the
   * whole test of this function.
   *
   * Merges can sit anywhere in the table stage: `Compute.applyMerges` builds a
   * *plan* rather than changing the data, so they never affected the filter or
   * the sort and their position among the gt verbs is free.
   *
   * The old keys are removed rather than left as dead weight. Two shapes in one
   * file is two producers of every structural fact, and a build that predates
   * this would open such a file and silently ignore the half that matters.
   */
  migratePipeline(out, obj) {
    if (Array.isArray(obj.pipeline)) return;      // already migrated
    const steps = [];
    const legacyStructure = (obj && obj.structure) || {};
    const push = (type, params) => {
      const step = Pipeline.create(type);
      if (step) steps.push(Object.assign(step, params));
    };

    /* ---- The data stage, in the order `Compute.run` used to apply it ---- */

    const reshape = obj && obj.reshape;
    if (reshape && reshape.mode === 'pivot') {
      push('pivot', {
        idCols: reshape.idCols || [],
        nameCols: reshape.nameCols || [],
        valueCols: reshape.valueCols || [],
        aggregate: reshape.aggregate || 'first',
        nameSep: reshape.nameSep || ' > '
      });
    }
    if (Array.isArray(obj.corrections) && obj.corrections.length) {
      push('correct', { edits: obj.corrections });
    }
    const filter = legacyStructure.filter;
    if (filter && Array.isArray(filter.conditions) && filter.conditions.length) {
      push('filter', { match: filter.match || 'all', conditions: filter.conditions });
    }
    if (Array.isArray(legacyStructure.sort) && legacyStructure.sort.length) {
      push('sort', { keys: legacyStructure.sort });
    }

    /* ---- The table stage ---- */

    if (legacyStructure.rownameCol) push('stub', { col: legacyStructure.rownameCol });
    if (legacyStructure.groupnameCol) {
      push('groups', {
        col: legacyStructure.groupnameCol,
        order: legacyStructure.rowGroupOrder || []
      });
    }
    for (const scope of ['groups', 'grand']) {
      for (const summary of ((obj.summaries || {})[scope]) || []) {
        push('summary', Object.assign({ scope: scope }, summary));
      }
    }
    for (const merge of legacyStructure.merges || []) {
      // `type` was the merge's kind and is now the step's, so it moves aside.
      push('merge', { mergeType: merge.type || 'merge', target: merge.target,
        columns: merge.columns || [], pattern: merge.pattern, sep: merge.sep });
    }
    // Ascending by level, so the innermost is written first — the order
    // `export-rgt.js` has always sorted them into before emitting.
    const spanners = (legacyStructure.spanners || []).slice()
      .sort((a, b) => (a.level || 1) - (b.level || 1));
    for (const spanner of spanners) push('spanner', spanner);

    out.pipeline = steps;

    // What they were built from is gone. `structure` keeps only the aesthetic
    // half; the rest were read above and have no second home.
    delete out.reshape;
    delete out.corrections;
    delete out.summaries;
    for (const key of ['rownameCol', 'groupnameCol', 'spanners', 'rowGroupOrder',
      'merges', 'sort', 'filter']) {
      delete out.structure[key];
    }
  },

  /**
   * Column ids in display order: the preference first, then anything it does
   * not mention.
   *
   * **`structure.columnOrder` is a preference, not the list of what exists.**
   * The pipeline decides which columns there are, and it can change them on
   * any edit; a preference that has not caught up must not be able to hide a
   * column. Filtering *by* it is what made a pivoted table show two columns in
   * the Structure panel while the table drew eleven — the panel had the rule
   * `compute.js` used before the pipeline, and nothing kept the two in step.
   *
   * One producer, called by both.
   */
  orderColumns(preference, ids) {
    const wanted = preference || [];
    return ids.slice().sort((a, b) => {
      const ia = wanted.indexOf(a);
      const ib = wanted.indexOf(b);
      if (ia === ib) return 0;
      if (ia < 0) return 1;
      if (ib < 0) return -1;
      return ia - ib;
    });
  },

  /**
   * What the editor calls each of a set of columns, made unambiguous.
   *
   * `columnTitle` answers for one column and cannot see its siblings, which is
   * fine until two of them answer the same. **A pivot makes that the normal
   * case, not an edge**: `Reshape.pivot` gives every derived column the
   * innermost tuple value as its `shortName`, so a year × metric pivot produces
   * three columns called *employment* and three called *output*. Every chip
   * picker, item subtitle, selection chip and Location line then showed six
   * indistinguishable names.
   *
   * A repeated title falls back to the column's full `name` — which for a pivot
   * is the whole tuple, `2022 > employment` — and then to the id. Columns whose
   * title is already unique are left alone, so nothing gets longer than it has
   * to be.
   *
   * @returns {Object} id -> title
   */
  columnTitles(spec, columns) {
    const seen = {};
    for (const column of columns) {
      const title = Spec.columnTitle(spec, column);
      seen[title] = (seen[title] || 0) + 1;
    }

    const out = {};
    for (const column of columns) {
      const title = Spec.columnTitle(spec, column);
      out[column.id] = seen[title] > 1
        ? (column.name || column.id)
        : title;
    }
    return out;
  },

  /** True when the spec has data to render. */
  hasData(spec) {
    return !!(spec && spec.source && spec.source.rows && spec.source.rows.length);
  },

  /**
   * Is this item of a spec list switched on?
   *
   * **One place decides, because nine asked and one answered differently.**
   * Style rules, colour rules, number formats and the panels' own checkboxes
   * all carry an `enabled` flag, and every site but one read it as *on unless
   * explicitly false*. `StyleRules.compile` read `!rule.enabled`, so a style
   * rule whose `enabled` key was simply absent — an older saved project, a
   * hand-edited file — was skipped by the preview while the checkbox beside it
   * showed ticked and `export-rgt.js` emitted the rule anyway. Three views of
   * one flag, disagreeing.
   *
   * Absent means on: the flag records having been switched *off*, and a rule
   * nobody has touched has not been.
   */
  isEnabled(item) {
    return !!item && item.enabled !== false;
  },

  /**
   * What to call a colour rule.
   *
   * A colour rule has no name of its own — there is nothing to type one into,
   * unlike a style rule's `label` — so it is described instead. The Colour
   * panel's list heading and the Inspector's "why is this cell blue" both need
   * that description, and two of them would drift, the way four producers of a
   * column's display name once did.
   */
  /**
   * Which colour scale a rule draws: continuous, or one colour per level.
   *
   * **One place, because the preview and the R export must not disagree.**
   * Equal bins and quantiles were offered until they were cut back to these
   * two, and a rule saved with either is normalised by `migrate` — but
   * `ExportRgt.build` takes whatever spec it is handed, so an un-migrated one
   * would have emitted `method = "bin"` for a table the preview drew smooth.
   * Anything that is not `factor` is continuous, which is what `Palettes.scale`
   * does, and now what the exporter does too.
   */
  colorMethod(rule) {
    return (rule && rule.method) === 'factor' ? 'factor' : 'numeric';
  },

  /**
   * The colours a rule paints with, as the vector gt is handed.
   *
   * A named palette is the whole vector; `custom` is the two or three stops
   * the user picked. The middle stop only exists when a midpoint does — a
   * neutral centre is the thing a third colour is *for*, and tying them keeps
   * one control from silently depending on another being set.
   *
   * One place, because `Palettes.scale` and `export-rgt.js` must be handed the
   * same list or the preview and the exported table are different pictures.
   */
  colorRamp(rule) {
    if ((rule && rule.palette) !== 'custom') {
      return Palettes.byName((rule && rule.palette) || 'Blues');
    }
    const stops = (rule && rule.stops) || {};
    const low = stops.low || '#FFFFFF';
    const high = stops.high || '#08306B';
    const wantsMiddle = rule.midpoint !== null && rule.midpoint !== undefined &&
      Number.isFinite(Number(rule.midpoint));
    return wantsMiddle ? [low, stops.mid || '#F7F7F7', high] : [low, high];
  },

  /**
   * Which columns' values drive a colour rule, as against which get painted.
   *
   * `rule.columns` has always meant the painted cells, and it still does.
   * `valuesFrom` is gt's `target_columns` seen from the other end: gt takes
   * the *values* in `columns` and paints `target_columns`, so when this is set
   * the two arguments swap over in the export. Empty means each column is
   * coloured by its own values, which is the ordinary case.
   */
  colorValueColumns(rule) {
    const from = (rule && rule.valuesFrom) || [];
    return from.length ? from : ((rule && rule.columns) || []);
  },

  /** Auto-contrast settings for a rule, falling back to the table's own type colours. */
  colorContrast(rule, options) {
    return {
      // gt's own default is APCA, and the two disagree on about a third of
      // ordinary fills, so the default has to match gt rather than be tidy.
      algo: (rule && rule.contrastAlgo) === 'wcag' ? 'wcag' : 'apca',
      dark: (rule && rule.autocolorDark) || (options && options['table.font.color']) || '#000000',
      light: (rule && rule.autocolorLight) || (options && options['table.font.color.light']) || '#FFFFFF'
    };
  },

  colorRuleTitle(rule) {
    if (!rule) return '';
    const count = (rule.columns || []).length;
    return (rule.palette || 'Blues') + ' → ' + count + ' column' + (count === 1 ? '' : 's');
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
    const draft = Store.draftOf(previous);

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

  /**
   * A working copy of a spec, sharing the imported data rather than copying it.
   *
   * **`spec.source` is immutable within a timeline, and it is nearly all of a
   * spec's weight.** Nothing in the app writes into it: corrections are an
   * override layer precisely so the file as imported survives, `Reshape` and
   * `Corrections` both hand back `source.rows` itself when they change
   * nothing, and the only way a source is *replaced* — import, open, new
   * project — goes through `Store.replace` or `Store.init`, which start a
   * fresh history anyway. So every entry in one timeline can share one copy.
   *
   * Measured on a 2,000 × 40 table, which is inside the app's own preview cap:
   * 61 history entries cost **158 MB** cloned whole and **0.8 MB** sharing the
   * source. That is what a browser tab runs out of memory on, and a fuzz run
   * did — sixty edits on a table that size is an ordinary afternoon.
   *
   * It is also most of the cost of an edit. `Util.clone` serialises whatever
   * it is handed, so every keystroke was re-serialising the whole dataset.
   */
  draftOf(spec) {
    const source = spec.source;
    const draft = Util.clone(Object.assign({}, spec, { source: null }));
    draft.source = source;
    return draft;
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
  }
};
