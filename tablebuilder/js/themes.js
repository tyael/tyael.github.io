/**
 * themes.js
 *
 * Themes are bundles of option values, nothing more. Applying one writes those
 * values into `spec.options` and leaves everything else alone, so a theme is a
 * starting point you keep editing rather than a mode you are locked into.
 */

const Themes = {

  /**
   * Booktabs — the LaTeX convention almost every journal expects.
   * Three horizontal rules, no vertical rules at all, generous padding.
   */
  booktabs: {
    'table.border.top.style': 'none',
    'table.border.bottom.style': 'none',
    'table.border.left.style': 'none',
    'table.border.right.style': 'none',
    'table.font.names': 'source-serif',
    'table.font.color': '#000000',
    'heading.border.bottom.style': 'none',
    'heading.align': 'left',
    'heading.title.font.weight': '600',
    'column_labels.border.top.style': 'solid',
    'column_labels.border.top.width': '1.5px',
    'column_labels.border.top.color': '#000000',
    'column_labels.border.bottom.style': 'solid',
    'column_labels.border.bottom.width': '0.75px',
    'column_labels.border.bottom.color': '#000000',
    'column_labels.border.lr.style': 'none',
    'column_labels.vlines.style': 'none',
    'column_labels.font.weight': 'normal',
    'column_labels.spanner.border.bottom.style': 'solid',
    'column_labels.spanner.border.bottom.width': '0.5px',
    'column_labels.spanner.border.bottom.color': '#000000',
    'table_body.border.top.style': 'none',
    'table_body.border.bottom.style': 'solid',
    'table_body.border.bottom.width': '1.5px',
    'table_body.border.bottom.color': '#000000',
    'table_body.hlines.style': 'none',
    'table_body.vlines.style': 'none',
    'stub.border.style': 'none',
    'stub_row_group.border.style': 'none',
    'row_group.border.top.style': 'solid',
    'row_group.border.top.width': '0.5px',
    'row_group.border.top.color': '#000000',
    'row_group.border.bottom.style': 'none',
    'row_group.font.weight': 'bold',
    'summary_row.border.style': 'solid',
    'summary_row.border.width': '0.5px',
    'summary_row.border.color': '#000000',
    'grand_summary_row.border.style': 'solid',
    'grand_summary_row.border.width': '0.75px',
    'grand_summary_row.border.color': '#000000',
    'footnotes.border.bottom.style': 'none',
    'footnotes.marks': 'letters',
    'source_notes.border.bottom.style': 'none',
    'data_row.padding': '5px',
    'data_row.padding.horizontal': '9px',
    'column_labels.padding': '5px',
    'column_labels.padding.horizontal': '9px',
    'row.striping.include_table_body': false
  },

  /**
   * APA 7th — booktabs plus the things APA is fussy about: sans-serif body,
   * italic table number, no vertical lines, note block underneath.
   */
  apa: {
    'table.border.top.style': 'none',
    'table.border.bottom.style': 'none',
    'table.border.left.style': 'none',
    'table.border.right.style': 'none',
    'table.font.names': 'lato',
    'table.font.size': '14px',
    'table.font.color': '#000000',
    'heading.align': 'left',
    'heading.border.bottom.style': 'none',
    'heading.title.font.weight': 'bold',
    'heading.title.font.size': '100%',
    'heading.subtitle.font.size': '100%',
    'column_labels.border.top.style': 'solid',
    'column_labels.border.top.width': '1px',
    'column_labels.border.top.color': '#000000',
    'column_labels.border.bottom.style': 'solid',
    'column_labels.border.bottom.width': '1px',
    'column_labels.border.bottom.color': '#000000',
    'column_labels.vlines.style': 'none',
    'column_labels.font.weight': 'normal',
    'table_body.border.top.style': 'none',
    'table_body.border.bottom.style': 'solid',
    'table_body.border.bottom.width': '1px',
    'table_body.border.bottom.color': '#000000',
    'table_body.hlines.style': 'none',
    'table_body.vlines.style': 'none',
    'stub.border.style': 'none',
    'row_group.border.top.style': 'none',
    'row_group.border.bottom.style': 'none',
    'row_group.font.style': 'italic',
    'footnotes.border.bottom.style': 'none',
    'footnotes.marks': 'letters',
    'footnotes.font.size': '90%',
    'source_notes.border.bottom.style': 'none',
    'data_row.padding': '4px',
    'data_row.padding.horizontal': '8px',
    'row.striping.include_table_body': false
  },

  /** Every line drawn — useful when you actually want a grid. */
  grid: {
    'table.border.top.style': 'solid',
    'table.border.bottom.style': 'solid',
    'table.border.left.style': 'solid',
    'table.border.right.style': 'solid',
    'table.border.left.width': '1px',
    'table.border.right.width': '1px',
    'column_labels.vlines.style': 'solid',
    'column_labels.background.color': '#f2f2f2',
    'column_labels.font.weight': 'bold',
    'table_body.hlines.style': 'solid',
    'table_body.vlines.style': 'solid',
    'table_body.hlines.width': '1px',
    'table_body.vlines.width': '1px'
  },

  /** Nothing but the data — no rules at all, striping for legibility. */
  plain: {
    'table.border.top.style': 'none',
    'table.border.bottom.style': 'none',
    'table.border.left.style': 'none',
    'table.border.right.style': 'none',
    'heading.border.bottom.style': 'none',
    'column_labels.border.top.style': 'none',
    'column_labels.border.bottom.style': 'solid',
    'column_labels.border.bottom.width': '1px',
    'column_labels.border.bottom.color': '#cccccc',
    'column_labels.vlines.style': 'none',
    'column_labels.font.weight': '600',
    'table_body.border.top.style': 'none',
    'table_body.border.bottom.style': 'none',
    'table_body.hlines.style': 'none',
    'table_body.vlines.style': 'none',
    'stub.border.style': 'none',
    'row_group.border.top.style': 'none',
    'row_group.border.bottom.style': 'none',
    'row.striping.include_table_body': true,
    'row.striping.include_stub': true,
    'footnotes.border.bottom.style': 'none',
    'source_notes.border.bottom.style': 'none'
  },

  /** For slides and dark documents. */
  dark: {
    'table.background.color': '#12161d',
    'table.font.color': '#e6ecf3',
    'table.font.color.light': '#12161d',
    'table.font.names': 'inter',
    'table.border.top.color': '#4d5766',
    'column_labels.background.color': '#1b212b',
    'column_labels.font.weight': '600',
    'column_labels.border.top.color': '#39424f',
    'column_labels.border.bottom.color': '#39424f',
    'table_body.hlines.color': '#262e3a',
    'table_body.border.top.color': '#39424f',
    'table_body.border.bottom.color': '#39424f',
    'table.border.bottom.color': '#4d5766',
    'stub.border.color': '#39424f',
    'row_group.background.color': '#1b212b',
    'row_group.border.top.color': '#39424f',
    'row_group.border.bottom.color': '#39424f',
    'row.striping.background_color': 'rgba(255,255,255,0.035)'
  },

  /** gt's own defaults, for getting back to a known state. */
  'gt-default': {},

  /**
   * The themes offered in the panel, in order.
   */
  list: [
    { id: 'gt-default', label: 'gt default', hint: 'The gt package’s own look.' },
    { id: 'booktabs', label: 'Booktabs', hint: 'Three rules, no verticals — the LaTeX journal convention.' },
    { id: 'apa', label: 'APA 7', hint: 'APA table style: sans-serif, ruled top and bottom, lettered notes.' },
    { id: 'plain', label: 'Plain', hint: 'No rules, striped rows.' },
    { id: 'grid', label: 'Grid', hint: 'Every line drawn.' },
    { id: 'dark', label: 'Dark', hint: 'Light text on a dark table, for slides.' },
    { id: 'stylize-blue', label: 'Blue', hint: 'Coloured header band, striped body.' },
    { id: 'stylize-green', label: 'Green', hint: 'Coloured header band, striped body.' },
    { id: 'stylize-red', label: 'Red', hint: 'Coloured header band, striped body.' },
    { id: 'stylize-grey', label: 'Grey', hint: 'Coloured header band, striped body.' }
  ],

  /** gt's `opt_stylize()` family, generated from a single accent colour. */
  STYLIZE_COLORS: {
    blue: { dark: '#004D80', mid: '#0076BA', light: '#E5F2FB' },
    green: { dark: '#00553D', mid: '#00845E', light: '#E3F5EF' },
    red: { dark: '#7A1A1A', mid: '#B02B2B', light: '#FBEAEA' },
    grey: { dark: '#2F3538', mid: '#5A6469', light: '#EFF1F2' }
  },

  stylize(name) {
    const c = Themes.STYLIZE_COLORS[name];
    if (!c) return {};
    return {
      'table.border.top.style': 'solid',
      'table.border.top.width': '3px',
      'table.border.top.color': c.dark,
      'table.border.bottom.style': 'solid',
      'table.border.bottom.width': '3px',
      'table.border.bottom.color': c.dark,
      'table.border.left.style': 'none',
      'table.border.right.style': 'none',
      'table.font.names': 'inter',
      'heading.background.color': c.light,
      'heading.border.bottom.style': 'solid',
      'heading.border.bottom.width': '2px',
      'heading.border.bottom.color': c.mid,
      'heading.title.font.weight': '600',
      'column_labels.background.color': c.mid,
      'column_labels.font.weight': '600',
      'column_labels.text_transform': 'uppercase',
      'column_labels.font.size': '85%',
      'column_labels.border.top.style': 'none',
      'column_labels.border.bottom.style': 'solid',
      'column_labels.border.bottom.width': '2px',
      'column_labels.border.bottom.color': c.dark,
      'column_labels.vlines.style': 'none',
      'table_body.hlines.style': 'solid',
      'table_body.hlines.width': '1px',
      'table_body.hlines.color': '#E1E4E6',
      'table_body.vlines.style': 'none',
      'table_body.border.top.style': 'none',
      'table_body.border.bottom.style': 'solid',
      'table_body.border.bottom.width': '2px',
      'table_body.border.bottom.color': c.dark,
      'stub.border.style': 'solid',
      'stub.border.width': '1px',
      'stub.border.color': '#E1E4E6',
      'stub.font.weight': '600',
      'row_group.background.color': c.light,
      'row_group.font.weight': '600',
      'row_group.border.top.style': 'solid',
      'row_group.border.top.width': '1px',
      'row_group.border.top.color': c.mid,
      'row_group.border.bottom.style': 'solid',
      'row_group.border.bottom.width': '1px',
      'row_group.border.bottom.color': c.mid,
      'grand_summary_row.background.color': c.light,
      'grand_summary_row.border.style': 'double',
      'grand_summary_row.border.width': '5px',
      'grand_summary_row.border.color': c.mid,
      'row.striping.include_table_body': true,
      'row.striping.background_color': 'rgba(0,0,0,0.03)'
    };
  },

  /** Resolve a theme id to its option patch. */
  patch(id) {
    const saved = UserThemes.get(id);
    if (saved) return saved.options;
    if (id && id.indexOf('stylize-') === 0) return Themes.stylize(id.slice('stylize-'.length));
    return Themes[id] || {};
  },

  /**
   * The built-ins plus whatever the user has saved, in one list. A saved theme
   * is marked `custom` — that is the only thing the picker treats differently.
   */
  all() {
    return Themes.list.map((theme) => Object.assign({ custom: false }, theme))
      .concat(UserThemes.list().map((theme) => ({
        id: theme.id,
        label: theme.label,
        hint: theme.notes || 'Your saved theme',
        custom: true
      })));
  },

  /** Apply a theme: reset to defaults, then lay the theme's values over the top. */
  apply(id) {
    const saved = UserThemes.get(id);
    const patch = Themes.patch(id);

    Store.update((draft) => {
      // Reset first, so switching themes cannot leave the previous one's
      // values behind — but structural choices are not the theme's to reset.
      // Whether row groups are a column is a decision about the data, and it
      // used to come unstuck every time a theme was applied. A theme that names
      // one explicitly still wins, since the patch goes on top.
      const next = OptionsSchema.defaults();
      for (const key of OptionsSchema.structural()) next[key] = draft.options[key];

      draft.options = Object.assign(next, patch);
      draft.meta.theme = id;

      // A saved theme carries the fonts its options name, so applying it to a
      // project that has never seen them selects the real family rather than
      // silently falling back.
      if (saved && saved.fonts && saved.fonts.length) {
        const have = new Set((draft.fonts || []).map((font) => font.id));
        draft.fonts = (draft.fonts || []).concat(saved.fonts.filter((f) => !have.has(f.id)));
      }
    });

    const entry = Themes.all().find((t) => t.id === id);
    Util.toast('Applied “' + (entry ? entry.label : id) + '”', 'ok');
  }
};
