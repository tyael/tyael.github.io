/**
 * themes.js
 *
 * A theme is mostly a bundle of option values: applying one writes them into
 * `spec.options`, so a theme is a starting point you keep editing rather than a
 * mode you are locked into.
 *
 * A theme may also carry a few **part-level style rules**, for the things
 * `tab_options()` has no argument for — chiefly the text colour on a coloured
 * header band. See `Themes.RULES` for why that is not an option instead.
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
    // Every band is enclosed, heading and footer included — which is the whole
    // point of this theme, and now has to be said rather than falling out of a
    // border on the element.
    'column_labels.border.lr.style': 'solid',
    'column_labels.border.lr.width': '1px',
    'heading.border.lr.style': 'solid',
    'heading.border.lr.width': '1px',
    'footnotes.border.lr.style': 'solid',
    'footnotes.border.lr.width': '1px',
    'source_notes.border.lr.style': 'solid',
    'source_notes.border.lr.width': '1px',
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

  /* ================================================================
     Structure, not hue

     These five replaced Blue/Green/Red/Grey, which were one table in four
     colours. Each of these is a different *shape* — where the emphasis sits,
     whether there are verticals, whether the reader is helped by striping or
     by a frame, how dense it is — so choosing one is a decision about the
     table rather than about a colour. Recolouring any of them is two clicks in
     Options, and "Save current look" keeps it.
     ================================================================ */

  /** A frame around a light interior grid — every cell enclosed, nothing shouted. */
  boxed: {
    'table.font.color': '#1F2328',
    'table.border.top.style': 'solid',
    'table.border.top.width': '2px',
    'table.border.top.color': '#5A6270',
    'table.border.bottom.style': 'solid',
    'table.border.bottom.width': '2px',
    'table.border.bottom.color': '#5A6270',
    'table.border.left.style': 'solid',
    'table.border.left.width': '2px',
    'table.border.left.color': '#5A6270',
    'table.border.right.style': 'solid',
    'table.border.right.width': '2px',
    'table.border.right.color': '#5A6270',
    'heading.align': 'left',
    'heading.title.font.weight': 'bold',
    'heading.border.bottom.style': 'solid',
    'heading.border.bottom.width': '1px',
    'heading.border.bottom.color': '#D5D8DE',
    // The frame goes round everything, so each band carries its own sides.
    'heading.border.lr.style': 'solid',
    'heading.border.lr.width': '2px',
    'heading.border.lr.color': '#5A6270',
    'footnotes.border.lr.style': 'solid',
    'footnotes.border.lr.width': '2px',
    'footnotes.border.lr.color': '#5A6270',
    'source_notes.border.lr.style': 'solid',
    'source_notes.border.lr.width': '2px',
    'source_notes.border.lr.color': '#5A6270',
    'column_labels.font.weight': 'bold',
    'column_labels.background.color': '#F2F3F5',
    'column_labels.border.top.style': 'none',
    'column_labels.border.bottom.style': 'solid',
    'column_labels.border.bottom.width': '2px',
    'column_labels.border.bottom.color': '#5A6270',
    'column_labels.vlines.style': 'solid',
    'column_labels.vlines.width': '1px',
    'column_labels.vlines.color': '#D5D8DE',
    'column_labels.spanner.border.bottom.style': 'solid',
    'column_labels.spanner.border.bottom.width': '1px',
    'column_labels.spanner.border.bottom.color': '#D5D8DE',
    'data_row.padding': '6px',
    'table_body.hlines.style': 'solid',
    'table_body.hlines.width': '1px',
    'table_body.hlines.color': '#D5D8DE',
    'table_body.vlines.style': 'solid',
    'table_body.vlines.width': '1px',
    'table_body.vlines.color': '#D5D8DE',
    'table_body.border.top.style': 'none',
    'table_body.border.bottom.style': 'none',
    'stub.border.style': 'solid',
    'stub.border.width': '1px',
    'stub.border.color': '#D5D8DE',
    'stub.font.weight': 'bold',
    'stub_row_group.border.style': 'none',
    'row_group.background.color': '#F2F3F5',
    'row_group.font.weight': 'bold',
    'row_group.border.top.style': 'solid',
    'row_group.border.top.width': '1px',
    'row_group.border.top.color': '#D5D8DE',
    'row_group.border.bottom.style': 'solid',
    'row_group.border.bottom.width': '1px',
    'row_group.border.bottom.color': '#D5D8DE',
    'summary_row.border.style': 'solid',
    'summary_row.border.width': '1px',
    'summary_row.border.color': '#5A6270',
    'grand_summary_row.background.color': '#E9EBEE',
    'grand_summary_row.border.style': 'solid',
    'grand_summary_row.border.width': '2px',
    'grand_summary_row.border.color': '#5A6270',
    'footnotes.border.bottom.style': 'none',
    'source_notes.border.bottom.style': 'none'
  },

  /**
   * Monograph — a scholarly serif table: EB Garamond, a double rule under the
   * column heads, hairlines top and bottom, and nothing vertical at all.
   *
   * A second serif *face* rather than a second serif theme. Booktabs is Source
   * Serif 4, a transitional; Garamond is an old-style, and the two do not look
   * alike at any size. Weights are 400 and 600 because those are the ones
   * loaded — asking for `bold` would get 700 synthesised, which in an
   * old-style face reads as a smear.
   */
  monograph: {
    'table.font.names': 'eb-garamond',
    'table.font.size': '17px',
    'table.font.color': '#1A1714',
    'table.align': 'left',
    'table.border.top.style': 'solid',
    'table.border.top.width': '1px',
    'table.border.top.color': '#1A1714',
    'table.border.bottom.style': 'none',
    'table.border.left.style': 'none',
    'table.border.right.style': 'none',

    'heading.align': 'left',
    'heading.title.font.weight': '600',
    'heading.title.font.size': '115%',
    'heading.subtitle.font.size': '95%',
    'heading.padding': '5px',
    'heading.border.bottom.style': 'none',

    'column_labels.font.weight': '600',
    'column_labels.text_transform': 'uppercase',
    'column_labels.font.size': '80%',
    'column_labels.padding': '6px',
    'column_labels.padding.horizontal': '10px',
    'column_labels.border.top.style': 'none',
    // The double rule is the device: two lines under the heads, which is how a
    // book sets a table and something no other theme here does.
    'column_labels.border.bottom.style': 'double',
    'column_labels.border.bottom.width': '4px',
    'column_labels.border.bottom.color': '#1A1714',
    'column_labels.vlines.style': 'none',
    'column_labels.spanner.border.bottom.style': 'solid',
    'column_labels.spanner.border.bottom.width': '1px',
    'column_labels.spanner.border.bottom.color': '#1A1714',

    'data_row.padding': '5px',
    'data_row.padding.horizontal': '10px',
    'table_body.hlines.style': 'none',
    'table_body.vlines.style': 'none',
    'table_body.border.top.style': 'none',
    'table_body.border.bottom.style': 'solid',
    'table_body.border.bottom.width': '1px',
    'table_body.border.bottom.color': '#1A1714',

    'stub.border.style': 'none',
    'stub_row_group.border.style': 'none',
    'row_group.font.style': 'italic',
    'row_group.font.weight': '400',
    'row_group.padding': '7px',
    'row_group.border.top.style': 'none',
    'row_group.border.bottom.style': 'none',

    'summary_row.border.style': 'solid',
    'summary_row.border.width': '1px',
    'summary_row.border.color': '#B8B0A6',
    'grand_summary_row.border.style': 'solid',
    'grand_summary_row.border.width': '1px',
    'grand_summary_row.border.color': '#1A1714',

    'footnotes.marks': 'letters',
    'footnotes.font.size': '82%',
    'footnotes.border.bottom.style': 'none',
    'source_notes.font.size': '82%',
    'source_notes.border.bottom.style': 'none'
  },

  /** A near-black band over a white body: corporate, and prints as grey. */
  inverse: {
    'table.font.color': '#1F2328',
    'table.border.top.style': 'none',
    'table.border.bottom.style': 'solid',
    'table.border.bottom.width': '2px',
    'table.border.bottom.color': '#1F2328',
    'table.border.left.style': 'none',
    'table.border.right.style': 'none',
    'heading.align': 'left',
    'heading.title.font.weight': 'bold',
    'heading.border.bottom.style': 'none',
    'column_labels.background.color': '#1F2328',
    'column_labels.font.weight': 'bold',
    'column_labels.padding': '7px',
    'column_labels.border.top.style': 'none',
    'column_labels.border.bottom.style': 'none',
    'column_labels.vlines.style': 'solid',
    'column_labels.vlines.width': '1px',
    'column_labels.vlines.color': '#4A5058',
    'column_labels.spanner.border.bottom.style': 'solid',
    'column_labels.spanner.border.bottom.width': '1px',
    'column_labels.spanner.border.bottom.color': '#4A5058',
    'data_row.padding': '6px',
    'table_body.hlines.style': 'solid',
    'table_body.hlines.width': '1px',
    'table_body.hlines.color': '#DCDEE2',
    'table_body.vlines.style': 'none',
    'table_body.border.top.style': 'none',
    'table_body.border.bottom.style': 'none',
    'stub.border.style': 'none',
    'stub_row_group.border.style': 'none',
    'row_group.background.color': '#EDEEF0',
    'row_group.font.weight': 'bold',
    'row_group.border.top.style': 'solid',
    'row_group.border.top.width': '1px',
    'row_group.border.top.color': '#DCDEE2',
    'row_group.border.bottom.style': 'solid',
    'row_group.border.bottom.width': '1px',
    'row_group.border.bottom.color': '#DCDEE2',
    'summary_row.border.style': 'solid',
    'summary_row.border.width': '1px',
    'summary_row.border.color': '#DCDEE2',
    'grand_summary_row.border.style': 'solid',
    'grand_summary_row.border.width': '2px',
    'grand_summary_row.border.color': '#1F2328',
    'footnotes.border.bottom.style': 'none',
    'source_notes.border.bottom.style': 'none'
  },

  /**
   * Green-bar paper: the striping does all the work and there are no rules at
   * all. The one theme here where the row label is the emphasis.
   */
  ledger: {
    'table.font.color': '#1F2A22',
    'table.background.color': '#FFFFFF',
    'table.border.top.style': 'none',
    'table.border.bottom.style': 'none',
    'table.border.left.style': 'none',
    'table.border.right.style': 'none',
    'heading.align': 'left',
    'heading.title.font.weight': 'bold',
    'heading.border.bottom.style': 'none',
    'column_labels.font.weight': 'bold',
    'column_labels.text_transform': 'uppercase',
    'column_labels.font.size': '86%',
    'column_labels.padding': '5px',
    'column_labels.border.top.style': 'none',
    'column_labels.border.bottom.style': 'solid',
    'column_labels.border.bottom.width': '1px',
    'column_labels.border.bottom.color': '#5E7A52',
    'column_labels.vlines.style': 'none',
    'column_labels.spanner.border.bottom.style': 'solid',
    'column_labels.spanner.border.bottom.width': '1px',
    'column_labels.spanner.border.bottom.color': '#5E7A52',
    'data_row.padding': '5px',
    'table_body.hlines.style': 'none',
    'table_body.vlines.style': 'none',
    'table_body.border.top.style': 'none',
    'table_body.border.bottom.style': 'none',
    'stub.border.style': 'none',
    'stub.font.weight': 'bold',
    'stub_row_group.border.style': 'none',
    // Striping including the stub is the whole device — green-bar paper runs
    // its bars the full width of the sheet.
    'row.striping.include_table_body': true,
    'row.striping.include_stub': true,
    'row.striping.background_color': '#E4EFDE',
    'row_group.background.color': '#CFE0C6',
    'row_group.font.weight': 'bold',
    'row_group.text_transform': 'uppercase',
    'row_group.border.top.style': 'none',
    'row_group.border.bottom.style': 'none',
    'summary_row.border.style': 'solid',
    'summary_row.border.width': '1px',
    'summary_row.border.color': '#5E7A52',
    'grand_summary_row.border.style': 'double',
    'grand_summary_row.border.width': '3px',
    'grand_summary_row.border.color': '#5E7A52',
    'footnotes.border.bottom.style': 'none',
    'source_notes.border.bottom.style': 'none'
  },

  /* ================================================================
     Placenames

     Each of these reproduces the look of a particular published document.
     They are named for a place rather than for what they reproduce: a
     placename ages better than an institution's, none of them are official
     templates, and the look is the point of a theme rather than its
     pedigree. The hints describe the look for the same reason.

     What matters for maintenance is that their figures are transcribed or
     measured rather than chosen — see each block for which, and do not
     casually round them.
     ================================================================ */

  /**
   * Canberra — transcribed from a written specification, not eyeballed from a
   * picture. The source states these and the theme states them back:
   *
   *   Font          Arial, 8 pt, colour = Black (not automatic)
   *   Row height    11.25 pt for 8 pt text
   *   Alignment     text left, numbers right, braced headings centred
   *   Borders       Black, hairline weight
   *   Shading       RGB 235/235/235
   *
   * The 8 pt and 11.25 pt stay in points rather than being converted, because
   * that is how the specification reads and how anyone checking output against
   * it will think. 11.25 pt of row height around 8 pt of text leaves about
   * 1.5 pt above and below.
   *
   * The same specification says to border only the row carrying the
   * description and its values, never the rows above or below — which is why
   * the body has no horizontal lines. A rule here marks a total; it does not
   * separate every row.
   *
   * A pipeline check holds the theme to these figures so a later tidy-up
   * cannot quietly drift off them.
   */
  canberra: {
    'table.font.names': 'arial',
    'table.font.size': '8pt',
    'table.font.color': '#000000',
    'table.background.color': '#FFFFFF',
    'table.border.top.style': 'solid',
    'table.border.top.width': '0.5pt',
    'table.border.top.color': '#000000',
    'table.border.bottom.style': 'solid',
    'table.border.bottom.width': '0.5pt',
    'table.border.bottom.color': '#000000',
    'table.border.left.style': 'none',
    'table.border.right.style': 'none',

    'heading.align': 'left',
    'heading.title.font.size': '110%',
    'heading.title.font.weight': 'bold',
    'heading.subtitle.font.size': '100%',
    'heading.border.bottom.style': 'none',

    'column_labels.font.weight': 'bold',
    'column_labels.padding': '1.5pt',
    'column_labels.padding.horizontal': '4pt',
    'column_labels.border.top.style': 'solid',
    'column_labels.border.top.width': '0.5pt',
    'column_labels.border.top.color': '#000000',
    'column_labels.border.bottom.style': 'solid',
    'column_labels.border.bottom.width': '0.5pt',
    'column_labels.border.bottom.color': '#000000',
    'column_labels.border.lr.style': 'none',
    'column_labels.vlines.style': 'none',
    'column_labels.spanner.border.bottom.style': 'solid',
    'column_labels.spanner.border.bottom.width': '0.5pt',
    'column_labels.spanner.border.bottom.color': '#000000',

    // Row height 11.25pt around 8pt text.
    'data_row.padding': '1.5pt',
    'data_row.padding.horizontal': '4pt',
    'table_body.hlines.style': 'none',
    'table_body.vlines.style': 'none',
    'table_body.border.top.style': 'none',
    'table_body.border.bottom.style': 'solid',
    'table_body.border.bottom.width': '0.5pt',
    'table_body.border.bottom.color': '#000000',

    'stub.border.style': 'none',
    'stub_row_group.border.style': 'none',
    'row_group.font.weight': 'bold',
    'row_group.padding': '1.5pt',
    'row_group.border.top.style': 'none',
    'row_group.border.bottom.style': 'none',

    // RGB 235, 235, 235 — the specification's shading, which marks the totals.
    'summary_row.background.color': '#EBEBEB',
    'summary_row.padding': '1.5pt',
    'summary_row.border.style': 'solid',
    'summary_row.border.width': '0.5pt',
    'summary_row.border.color': '#000000',
    'grand_summary_row.background.color': '#EBEBEB',
    'grand_summary_row.padding': '1.5pt',
    'grand_summary_row.border.style': 'solid',
    'grand_summary_row.border.width': '0.5pt',
    'grand_summary_row.border.color': '#000000',

    'footnotes.marks': 'letters',
    'footnotes.font.size': '100%',
    'footnotes.border.bottom.style': 'none',
    'source_notes.font.size': '100%',
    'source_notes.border.bottom.style': 'none'
  },

  /**
   * Sydney — a solid blue header band, white text, and a full blue grid.
   * Sampled from a published table.
   */
  sydney: {
    'table.font.names': 'roboto',
    'table.font.weight': '300',
    'table.font.size': '14px',
    'table.font.color': '#3B3B3B',
    'table.background.color': '#FFFFFF',
    'table.align': 'left',
    // The blue hairline encloses the table proper — the column labels and the
    // body — and stops there. The title, subtitle, footnotes and source notes
    // sit outside it, unboxed, which is why the top and bottom edges come from
    // the label row and the last body row rather than from the element.
    'table.border.top.style': 'none',
    'table.border.bottom.style': 'none',
    'table.border.left.style': 'solid',
    'table.border.left.width': '1px',
    'table.border.left.color': '#2164AA',
    'table.border.right.style': 'solid',
    'table.border.right.width': '1px',
    'table.border.right.color': '#2164AA',

    'heading.align': 'left',
    'heading.title.font.weight': 'bold',
    'heading.border.bottom.style': 'none',

    'column_labels.background.color': '#2164AA',
    'column_labels.font.weight': '300',
    // The top of the enclosure. It runs along the top of the blue band, so it
    // reads as the edge of the band rather than as a line above it.
    'column_labels.border.top.style': 'solid',
    'column_labels.border.top.width': '1px',
    'column_labels.border.top.color': '#2164AA',
    // The band's own sides, matching the enclosure it is part of.
    'column_labels.border.lr.style': 'solid',
    'column_labels.border.lr.width': '1px',
    'column_labels.border.lr.color': '#2164AA',
    // The group column's divider, which the schema otherwise leaves at 2px
    // grey — visible the moment row groups are shown as a column.
    'stub_row_group.border.style': 'solid',
    'stub_row_group.border.width': '1px',
    'stub_row_group.border.color': '#2164AA',
    'column_labels.padding': '11px',
    'column_labels.padding.horizontal': '10px',
    'column_labels.border.bottom.style': 'none',
    'column_labels.vlines.style': 'none',

    'data_row.padding': '10px',
    'data_row.padding.horizontal': '10px',
    'table_body.hlines.style': 'solid',
    'table_body.hlines.width': '1px',
    'table_body.hlines.color': '#2164AA',
    'table_body.vlines.style': 'solid',
    'table_body.vlines.width': '1px',
    'table_body.vlines.color': '#2164AA',
    'table_body.border.top.style': 'none',
    // Closes the body, which is what separates the last row from the footnote
    // and source-note block below it. With no footer it lands on the table's
    // own bottom edge and collapses into it, so it costs nothing there.
    'table_body.border.bottom.style': 'solid',
    'table_body.border.bottom.width': '1px',
    'table_body.border.bottom.color': '#2164AA',

    'stub.border.style': 'solid',
    'stub.border.width': '1px',
    'stub.border.color': '#2164AA',
    'row_group.background.color': '#2164AA',
    'row_group.font.weight': '400',
    // Never set before, so the group kept the schema's 2px grey — the only
    // rule in the theme that was neither 1px nor blue.
    'row_group.border.top.style': 'solid',
    'row_group.border.top.width': '1px',
    'row_group.border.top.color': '#2164AA',
    'row_group.border.bottom.style': 'solid',
    'row_group.border.bottom.width': '1px',
    'row_group.border.bottom.color': '#2164AA',
    // The spanner's underline sits on the blue band, so it is white like the
    // type on it — grey was the schema default showing through.
    'column_labels.spanner.border.bottom.style': 'solid',
    'column_labels.spanner.border.bottom.width': '1px',
    'column_labels.spanner.border.bottom.color': '#FFFFFF',
    // Totals keep a tint rather than the band — they close a section, they do
    // not open one — but a tint deep enough to see, and the grand total is
    // ruled off in the theme's own blue.
    'summary_row.background.color': '#DCE7F4',
    'summary_row.border.style': 'solid',
    'summary_row.border.width': '1px',
    'summary_row.border.color': '#2164AA',
    'grand_summary_row.background.color': '#DCE7F4',
    // One weight throughout: the theme's whole grid is a 1px blue hairline and
    // a heavier rule under the total read as a different theme's idea.
    'grand_summary_row.border.style': 'solid',
    'grand_summary_row.border.width': '1px',
    'grand_summary_row.border.color': '#2164AA',
    'footnotes.marks': 'letters',
    'footnotes.border.bottom.style': 'none',
    'source_notes.border.bottom.style': 'none'
  },

  /**
   * John Adam — a full-width grotesque data sheet. Grey column heads under bold
   * black group names, a hairline between every row, and the heaviest rule in
   * the table closing the body. No verticals, no bands, no fills.
   *
   * Measured off a source image 834px wide at 1x, so the figures below are CSS
   * pixels and are transcribed as such rather than converted. Cap heights, not
   * glyph bounding boxes — a bounding box picks up ascenders and descenders and
   * reads a size or two large:
   *
   *   body            cap 11px  →  15px
   *   title           cap 16px  →  22px (147%), bold, black
   *   column labels   cap 10px  →  13px (88%), #666666
   *   row pitch       21px      →  1px of vertical padding on a 15px body
   *   row lines       1px #BCBCBC
   *   header rule     1px #949494 — heavier than the row lines by colour
   *   body's bottom   2px #868686 — the heaviest line in the table
   *
   * The source's face is a proprietary condensed grotesque. Roboto is the
   * closest already loaded: the source runs about 10px of advance per lowercase
   * character against a 16px cap, which is a shade narrower than a normal-width
   * sans and nowhere near as narrow as Roboto Condensed.
   *
   * **Everything sits on one left edge at 6px**, so the title, the row labels
   * and the footnotes line up and the rules run 6px past the type at each end.
   * The source has the type flush at 0 and the figures 12px off their right cell
   * edge, which is one horizontal padding per column — `data_row.padding` is one
   * value for the whole body, and a style rule carries text, fill and borders
   * but no padding (nor does `tab_style`). 6px is the compromise: the last
   * column of a right-aligned table does not touch the table's edge, and the
   * indent on the row labels is small enough to read as deliberate.
   *
   * Three things in the source are per-column and so cannot belong to a theme
   * at all: the conditional fills behind the leading figures, the small grey
   * period columns beside them, and the header's vertical rules — which fall at
   * the group boundaries, where `column_labels.vlines` would draw one between
   * every label. On the source's ten columns that is nine lines where it has
   * three, so this draws none.
   */
  'john-adam': {
    'table.font.names': 'roboto',
    'table.font.size': '15px',
    // #2F2F2F, off a body stem. Near-black but not black: the title and the
    // group names are the only true black in the table, which is what gives the
    // header its weight.
    'table.font.color': '#2F2F2F',
    'table.background.color': '#FFFFFF',
    // The rules run the whole width of the sheet, which is most of the look.
    // `auto` layout with it, or a fixed layout would divide the width equally
    // and leave the row labels as narrow as a two-digit figure.
    'table.width': '100%',
    'table.layout': 'auto',
    'table.align': 'left',
    'table.border.top.style': 'none',
    'table.border.bottom.style': 'none',
    'table.border.left.style': 'none',
    'table.border.right.style': 'none',

    'heading.align': 'left',
    'heading.title.font.size': '147%',
    'heading.title.font.weight': 'bold',
    'heading.subtitle.font.size': '100%',
    'heading.padding': '2px',
    'heading.padding.horizontal': '6px',
    // No rule under the title block: the header's own rule is the first line in
    // the table.
    'heading.border.bottom.style': 'none',

    'column_labels.font.size': '88%',
    'column_labels.font.weight': 'normal',
    'column_labels.padding': '1px',
    'column_labels.padding.horizontal': '6px',
    'column_labels.border.top.style': 'none',
    'column_labels.border.bottom.style': 'solid',
    'column_labels.border.bottom.width': '1px',
    'column_labels.border.bottom.color': '#949494',
    'column_labels.vlines.style': 'none',
    // A column group is named, not underlined — the group's own vertical rules
    // do that job in the source, and they are not a theme's to draw.
    'column_labels.spanner.underline': false,

    'data_row.padding': '1px',
    'data_row.padding.horizontal': '6px',
    'table_body.hlines.style': 'solid',
    'table_body.hlines.width': '1px',
    'table_body.hlines.color': '#BCBCBC',
    'table_body.vlines.style': 'none',
    'table_body.border.top.style': 'none',
    'table_body.border.bottom.style': 'solid',
    'table_body.border.bottom.width': '2px',
    'table_body.border.bottom.color': '#868686',

    // The row labels are ordinary body text, flush left, with nothing between
    // them and the figures.
    'stub.font.weight': 'initial',
    'stub.border.style': 'none',
    'stub_row_group.border.style': 'none',

    // A section heading opens a block, so it takes the header's rule above it
    // and nothing below; the bold black comes from the rule below, the same
    // black as the column group names.
    'row_group.padding': '2px',
    'row_group.padding.horizontal': '6px',
    'row_group.border.top.style': 'solid',
    'row_group.border.top.width': '1px',
    'row_group.border.top.color': '#949494',
    'row_group.border.bottom.style': 'none',

    // A total closes one, so it is ruled off above at the header's weight, and
    // the grand total at the body's — the two weights already in the table
    // rather than a third.
    'summary_row.padding': '1px',
    'summary_row.padding.horizontal': '6px',
    'summary_row.border.style': 'solid',
    'summary_row.border.width': '1px',
    'summary_row.border.color': '#949494',
    'grand_summary_row.padding': '1px',
    'grand_summary_row.padding.horizontal': '6px',
    'grand_summary_row.border.style': 'solid',
    'grand_summary_row.border.width': '2px',
    'grand_summary_row.border.color': '#868686',

    // `* † ‡ §`, doubling to `** †† ‡‡` once the set runs out, upright rather
    // than italic, and run together into one flowing footer instead of a line
    // each — all four of which the source does.
    'footnotes.marks': 'standard',
    'footnotes.multiline': false,
    'footnotes.sep': '  ',
    'footnotes.spec_ref': '^',
    'footnotes.spec_ftr': '^',
    'footnotes.font.size': '88%',
    'footnotes.padding.horizontal': '6px',
    'source_notes.font.size': '88%',
    'source_notes.padding': '2px',
    'source_notes.padding.horizontal': '6px'
  },

  /**
   * Russell — navy text with orange rules and orange totals.
   * The only one of the four that colours the type rather than the ground.
   */
  russell: {
    // Helvetica Neue in the original, which is not free. Public Sans is the
    // closest free grotesque and has a drawn 300 rather than a synthesised one,
    // which matters when the whole table sits at that weight.
    'table.font.names': 'public-sans',
    'table.font.weight': '300',
    'table.font.size': '13px',
    // #1D1D1B, sampled off the source at 130 dpi. The first cut of this theme
    // said navy, picked from a screenshot where subpixel antialiasing fringes
    // dark text blue — the same artefact that made a black-and-white sample
    // come back orange and blue. Ink is ink.
    'table.font.color': '#1D1D1B',
    'table.background.color': '#FDFDFD',
    'table.align': 'left',
    // No rule boxes the table. Everything is hung off the header and the
    // totals.
    'table.border.top.style': 'none',
    'table.border.bottom.style': 'none',
    'table.border.left.style': 'none',
    'table.border.right.style': 'none',

    'heading.align': 'left',
    'heading.title.font.weight': 'bold',
    'heading.title.font.size': '105%',
    'heading.border.bottom.style': 'none',

    'column_labels.font.weight': 'normal',
    'column_labels.font.size': '92%',
    'column_labels.padding': '3px',
    'column_labels.padding.horizontal': '7px',
    'column_labels.border.top.style': 'none',
    'column_labels.border.bottom.style': 'solid',
    'column_labels.border.bottom.width': '1px',
    'column_labels.border.bottom.color': '#E14412',
    // The orange strokes between the header cells. In the header these really
    // are full-height cell borders, so they come out exactly right.
    'column_labels.vlines.style': 'solid',
    'column_labels.vlines.width': '1px',
    'column_labels.vlines.color': '#E14412',
    // The line under a column group belongs to the same set of marks as the
    // strokes between the labels, so it takes the same colour and weight.
    'column_labels.spanner.border.bottom.style': 'solid',
    'column_labels.spanner.border.bottom.width': '1px',
    'column_labels.spanner.border.bottom.color': '#E14412',

    'data_row.padding': '3px',
    'data_row.padding.horizontal': '7px',
    'table_body.hlines.style': 'none',
    'table_body.vlines.style': 'none',
    'table_body.border.top.style': 'none',
    'table_body.border.bottom.style': 'none',

    'stub.border.style': 'none',
    'stub_row_group.border.style': 'none',
    'row_group.font.weight': 'bold',
    'row_group.padding': '6px',
    'row_group.border.top.style': 'none',
    'row_group.border.bottom.style': 'none',

    // Two tiers of total, which is as many as gt has: a subtotal is bold ink,
    // a headline total is orange and ruled.
    'summary_row.border.style': 'none',
    'grand_summary_row.border.style': 'solid',
    'grand_summary_row.border.width': '1px',
    'grand_summary_row.border.color': '#E14412',

    'footnotes.marks': 'numbers',
    'footnotes.font.size': '88%',
    'footnotes.border.bottom.style': 'none',
    'source_notes.font.size': '88%',
    'source_notes.border.bottom.style': 'none'
  },

  /* ================================================================
     Macquarie

     Two tables from a printed report of 2003, measured off the source PDF at
     300 dpi rather than eyeballed: the page is 481x841 pt, so every pixel is
     exactly 0.24 pt and the figures below are the document's own.

     The face is Univers, which is not free; Roboto is the closest neo-grotesque
     already loaded here.

     **Both bands are below the modern contrast floor.** White on #79AA8F is
     2.6:1 against a 4.5:1 requirement — the source is a print document from
     before that was anyone's concern. These are reproductions, so they keep it;
     `lowContrast` says so out loud and is what lets the readability check pass
     over them rather than being weakened for everyone. Darkening the band to
     #547F66 clears the floor if fidelity is not the point.
     ================================================================ */

  /**
   * Macquarie Classic — the wide annex table: a green band, alternating green
   * and grey rows, and a white gutter between every cell.
   *
   * The gutters are asymmetric and that is the whole character of it: 4 pt of
   * white between rows, 1 pt between columns. They are borders here, not
   * spacing — under `border-collapse: collapse` a white border between two
   * tinted cells is exactly a white gutter, which is how this gets the
   * separated-cell look without leaving the collapsed border model the rest of
   * the app depends on.
   */
  'macquarie-classic': {
    'table.font.names': 'roboto',
    'table.font.size': '9pt',
    'table.font.color': '#231F20',
    'table.background.color': '#EAF0EA',
    'table.align': 'left',
    'table.border.top.style': 'none',
    'table.border.bottom.style': 'none',
    'table.border.left.style': 'none',
    'table.border.right.style': 'none',

    'heading.align': 'left',
    'heading.title.font.weight': 'bold',
    'heading.title.font.size': '105%',
    // White, so the title reads as sitting above the tinted block rather than
    // inside it — which is where the source puts it.
    'heading.background.color': '#FFFFFF',
    'heading.padding': '6pt',
    'heading.padding.horizontal': '0pt',
    'heading.border.bottom.style': 'none',

    'column_labels.background.color': '#79AA8F',
    'column_labels.font.weight': 'bold',
    'column_labels.padding': '3.5pt',
    'column_labels.padding.horizontal': '6pt',
    'column_labels.border.top.style': 'none',
    'column_labels.border.bottom.style': 'solid',
    'column_labels.border.bottom.width': '4pt',
    'column_labels.border.bottom.color': '#FFFFFF',
    'column_labels.vlines.style': 'solid',
    'column_labels.vlines.width': '1pt',
    'column_labels.vlines.color': '#FFFFFF',
    'column_labels.spanner.border.bottom.style': 'solid',
    'column_labels.spanner.border.bottom.width': '1pt',
    'column_labels.spanner.border.bottom.color': '#FFFFFF',

    'data_row.padding': '2pt',
    'data_row.padding.horizontal': '6pt',
    'table_body.hlines.style': 'solid',
    'table_body.hlines.width': '4pt',
    'table_body.hlines.color': '#FFFFFF',
    'table_body.vlines.style': 'solid',
    'table_body.vlines.width': '1pt',
    'table_body.vlines.color': '#FFFFFF',
    'table_body.border.top.style': 'none',
    'table_body.border.bottom.style': 'solid',
    'table_body.border.bottom.width': '4pt',
    'table_body.border.bottom.color': '#FFFFFF',

    'stub.border.style': 'solid',
    'stub.border.width': '1pt',
    'stub.border.color': '#FFFFFF',
    'stub_row_group.border.style': 'none',
    'row_group.background.color': '#CFDACF',
    'row_group.font.weight': 'bold',
    'row_group.padding': '3pt',
    // The white gutter is the whole language of this theme, and a group label
    // that suppresses it butts straight against the band above and the first
    // row below — the one place the separated-cell look broke.
    'row_group.border.top.style': 'solid',
    'row_group.border.top.width': '4pt',
    'row_group.border.top.color': '#FFFFFF',
    'row_group.border.bottom.style': 'solid',
    'row_group.border.bottom.width': '4pt',
    'row_group.border.bottom.color': '#FFFFFF',

    // Row 1 takes the table background, row 2 the stripe — which is the order
    // the source alternates in.
    'row.striping.include_table_body': true,
    'row.striping.include_stub': true,
    'row.striping.background_color': '#E9E9E9',

    'summary_row.background.color': '#CFDACF',
    'summary_row.border.style': 'none',
    'grand_summary_row.background.color': '#CFDACF',
    'grand_summary_row.border.style': 'none',

    'footnotes.background.color': '#CFDACF',
    'footnotes.font.size': '78%',
    'footnotes.padding': '5pt',
    'footnotes.marks': 'letters',
    'footnotes.border.bottom.style': 'none',
    'source_notes.background.color': '#CFDACF',
    'source_notes.font.size': '78%',
    'source_notes.padding': '5pt',
    'source_notes.border.bottom.style': 'none'
  },

  /**
   * Macquarie Data — the dense century-long series: 8 pt on an 11.27 pt row
   * pitch, a white row-label column against a pale green body, and a hairline
   * green rule under every row.
   *
   * One column of the source's two is reproduced; the two columns are a page
   * layout, not a table structure. The vertically-set header labels are not
   * possible in a table model and are horizontal here.
   */
  'macquarie-data': {
    'table.font.names': 'roboto',
    'table.font.size': '8pt',
    'table.font.color': '#231F20',
    // The body tint. The row-label column sits on white over the top of it,
    // which is the one place these two tables differ in construction.
    'table.background.color': '#E3EBE3',
    'table.align': 'left',
    'table.border.top.style': 'none',
    'table.border.bottom.style': 'none',
    'table.border.left.style': 'none',
    'table.border.right.style': 'none',

    'heading.align': 'left',
    'heading.title.font.weight': 'bold',
    'heading.title.font.size': '112%',
    'heading.background.color': '#FFFFFF',
    'heading.padding': '6pt',
    'heading.padding.horizontal': '0pt',
    'heading.border.bottom.style': 'none',

    'column_labels.background.color': '#6C9880',
    'column_labels.font.weight': 'normal',
    'column_labels.padding': '4pt',
    'column_labels.padding.horizontal': '5pt',
    'column_labels.border.top.style': 'none',
    'column_labels.border.bottom.style': 'none',
    'column_labels.vlines.style': 'solid',
    'column_labels.vlines.width': '1.5pt',
    'column_labels.vlines.color': '#FFFFFF',
    'column_labels.spanner.border.bottom.style': 'solid',
    'column_labels.spanner.border.bottom.width': '1.5pt',
    'column_labels.spanner.border.bottom.color': '#FFFFFF',

    'data_row.padding': '1pt',
    'data_row.padding.horizontal': '5pt',
    'table_body.hlines.style': 'solid',
    'table_body.hlines.width': '0.5pt',
    'table_body.hlines.color': '#79AA8F',
    'table_body.vlines.style': 'solid',
    'table_body.vlines.width': '0.5pt',
    'table_body.vlines.color': '#FFFFFF',
    'table_body.border.top.style': 'none',
    // The same hairline closes the body, so the last row is ruled off from the
    // source note the way every row above it is ruled off from the next.
    'table_body.border.bottom.style': 'solid',
    'table_body.border.bottom.width': '0.5pt',
    'table_body.border.bottom.color': '#79AA8F',

    'stub.background.color': '#FFFFFF',
    'stub.border.style': 'solid',
    'stub.border.width': '0.5pt',
    'stub.border.color': '#FFFFFF',
    'stub_row_group.border.style': 'none',
    'row_group.background.color': '#CFDACF',
    'row_group.font.weight': 'bold',
    'row_group.padding': '2pt',
    // A white band above every group label, so a group that starts mid-table
    // gets the same air above it that the first one gets under the column
    // labels. Without it the first group reads as deliberately spaced and
    // every later one as crowded.
    'row_group.border.top.style': 'solid',
    'row_group.border.top.width': '4px',
    'row_group.border.top.color': '#FFFFFF',
    // Ruled off from the first row of its group the way every row pair is.
    'row_group.border.bottom.style': 'solid',
    'row_group.border.bottom.width': '0.5pt',
    'row_group.border.bottom.color': '#79AA8F',

    'summary_row.background.color': '#CFDACF',
    'summary_row.border.style': 'none',
    'grand_summary_row.background.color': '#CFDACF',
    'grand_summary_row.border.style': 'none',

    'footnotes.background.color': '#CFDACF',
    'footnotes.font.size': '85%',
    'footnotes.padding': '4pt',
    'footnotes.border.bottom.style': 'none',
    'source_notes.background.color': '#CFDACF',
    'source_notes.font.size': '85%',
    'source_notes.padding': '4pt',
    'source_notes.border.bottom.style': 'none'
  },

  /** gt's own defaults, for getting back to a known state. */
  'gt-default': {},

  /* ================================================================
     Theme style rules
     ================================================================ */

  /**
   * Style rules a theme brings with it, by theme id.
   *
   * **Why a theme carries rules at all.** `tab_options()` has no
   * column-label text colour — gt does not offer one, and inventing an option
   * gt lacks would put an argument into `export-rgt.js` that gt rejects (the
   * same reasoning that keeps `parts.captionAlign` out of `spec.options`). gt
   * gets a readable coloured header the only way it can: `opt_stylize()`
   * emits `tab_style()`. So does this.
   *
   * It was needed. The shipped Blue theme put `#333333` on `#0076BA` — a
   * contrast ratio of 2.6:1, well under the 4.5:1 floor — and Green, Red and
   * Grey were no better. A band with no way to colour the text on it is a band
   * you cannot read.
   *
   * **Only part-level locations belong here.** A theme is a look that outlives
   * any one project, and a style rule naming column ids does not survive a
   * change of dataset — which is why themes carry no style rules in general. A
   * location that names a *part* — every column label, every grand-summary row
   * — names nothing dataset-specific, so that reasoning does not reach it.
   *
   * Three things hold the line. The shorthand below has nowhere to put a
   * column, group, spanner or row, so a built-in cannot express one;
   * `Themes.isPortable` is what decides which of a project's rules are
   * captured when someone saves their own look; and a check in the pipeline
   * suite asserts every built-in rule through that same predicate.
   */
  RULES: {
    inverse: [
      { label: 'Inverse header', part: 'column_labels', text: { color: '#FFFFFF' } },
      { label: 'Inverse spanner', part: 'column_spanners', text: { color: '#FFFFFF' } },
      { label: 'Inverse stubhead', part: 'stubhead', text: { color: '#FFFFFF' } }
    ],
    sydney: [
      { label: 'Sydney header', part: 'column_labels', text: { color: '#FFFFFF', weight: '300' } },
      { label: 'Sydney spanner', part: 'column_spanners', text: { color: '#FFFFFF', weight: '300' } },
      { label: 'Sydney stubhead', part: 'stubhead', text: { color: '#FFFFFF', weight: '300' } },
      // A section heading takes the same band as the column labels. The pale
      // tint it used before appeared nowhere else in the theme and read as a
      // washed-out data row rather than a heading.
      { label: 'Sydney group', part: 'row_groups', text: { color: '#FFFFFF', weight: '400' } }
    ],
    'macquarie-classic': [
      { label: 'Macquarie header', part: 'column_labels', text: { color: '#FFFFFF', weight: 'bold' } },
      { label: 'Macquarie spanner', part: 'column_spanners', text: { color: '#FFFFFF', weight: 'bold' } },
      { label: 'Macquarie stubhead', part: 'stubhead', text: { color: '#FFFFFF', weight: 'bold' } }
    ],
    'macquarie-data': [
      { label: 'Macquarie header', part: 'column_labels', text: { color: '#FFFFFF' } },
      { label: 'Macquarie spanner', part: 'column_spanners', text: { color: '#FFFFFF' } },
      { label: 'Macquarie stubhead', part: 'stubhead', text: { color: '#FFFFFF' } }
    ],
    'john-adam': [
      // The heads are grey and the group names above them bold black — the one
      // contrast the header is built on. `tab_options()` has no text colour for
      // either, so both are rules.
      { label: 'John Adam heads', part: 'column_labels', text: { color: '#666666' } },
      { label: 'John Adam stubhead', part: 'stubhead', text: { color: '#666666' } },
      // `align` because `.gt-spanner` is centred in the generated CSS with no
      // option behind it, and the source hangs a group name off the left edge of
      // the columns it covers.
      { label: 'John Adam groups', part: 'column_spanners',
        text: { color: '#000000', weight: 'bold', align: 'left' } },
      // The title is the other true black. It would otherwise take
      // `table.font.color`, and at 22px bold the near-black reads as grey.
      { label: 'John Adam title', part: 'title', text: { color: '#000000' } },
      // A section heading in the body is the same mark as a column group name.
      { label: 'John Adam sections', part: 'row_groups', text: { color: '#000000', weight: 'bold' } },
      // The footer is quieter than the body it follows, at #636363 off the
      // source. Size alone did not separate it far enough.
      { label: 'John Adam footnotes', part: 'footnotes', text: { color: '#636363' } },
      { label: 'John Adam source', part: 'source_notes', text: { color: '#636363' } }
    ],
    russell: [
      // The body sits at 300, so a total only has to reach 400 to read as
      // emphasised — what looks bold in the original is regular against thin.
      // Section headings are the one place the source goes properly bold.
      { label: 'Russell subtotals', part: 'summary', text: { weight: '400' } },
      { label: 'Russell totals', part: 'grand_summary', text: { color: '#E14412', weight: '400' } },
      { label: 'Russell sections', part: 'row_groups', text: { color: '#E14412', weight: '700' } }
    ]
  },

  /**
   * Can this style rule belong to a theme?
   *
   * **The whole justification for letting a theme carry rules at all**: a
   * part-level location survives a change of data, a column id does not. So the
   * question is what the rule *names*, never where it came from.
   *
   * `UserThemes.fromSpec` used to ask the other question — is it tagged
   * `fromTheme` — and then hand what it found to `toShorthand`, which keeps the
   * part and drops columns, rows, groups and spanners. Two things followed. A
   * theme rule the user had narrowed to one column was saved with its scope
   * silently removed, so the theme painted every column label where the project
   * painted one. And the user's own part-level rule — as portable as any of the
   * theme's, and the exact thing a theme is for — was dropped, on a stated
   * reason ("the user's own name column ids") that was not true of it.
   *
   * The built-in themes are held to this by a check in the pipeline suite,
   * which now asks through here rather than restating the list.
   */
  isPortable(rule) {
    if (!rule || !rule.locations || rule.locations.length !== 1) return false;
    const loc = rule.locations[0];
    if (!StyleRules.PARTS.some((part) => part.id === loc.part)) return false;
    for (const field of ['columns', 'groups', 'spanners']) {
      if (loc[field] && loc[field].length) return false;
    }
    if (loc.rows && loc.rows.mode && loc.rows.mode !== 'all') return false;
    return true;
  },

  /** A theme rule reduced to the shorthand above, for saving. */
  toShorthand(rule) {
    const loc = (rule.locations && rule.locations[0]) || {};
    return {
      label: rule.label,
      part: loc.part || 'body',
      text: Object.assign({}, rule.style && rule.style.text),
      fill: Object.assign({}, rule.style && rule.style.fill),
      borders: Object.assign({}, rule.style && rule.style.borders)
    };
  },

  /** The style rules a theme brings, or an empty list. */
  rules(id) {
    const saved = UserThemes.get(id);
    if (saved) return saved.rules || [];

    return Themes.RULES[id] || [];
  },

  /** Expand a theme's shorthand into real style rules, tagged as the theme's. */
  buildRules(id) {
    return Themes.rules(id).map((spec) => {
      const rule = StyleRules.emptyRule(spec.label);
      rule.fromTheme = id;
      rule.locations = [StyleRules.emptyLocation(spec.part)];
      rule.style = {
        text: Object.assign({}, spec.text),
        fill: Object.assign({}, spec.fill),
        borders: Object.assign({}, spec.borders)
      };
      return rule;
    });
  },

  /**
   * The themes offered in the panel, in order.
   */
  list: [
    { id: 'gt-default', label: 'gt default', hint: 'The gt package’s own look.' },
    { id: 'booktabs', label: 'Booktabs', hint: 'Three lines, no verticals — the LaTeX journal convention.' },
    { id: 'apa', label: 'APA 7', hint: 'APA table style: sans-serif, lines top and bottom, lettered notes.' },
    { id: 'plain', label: 'Plain', hint: 'No lines, striped rows.' },
    { id: 'grid', label: 'Grid', hint: 'Every line drawn.' },
    { id: 'dark', label: 'Dark', hint: 'Light text on a dark table, for slides.' },
    { id: 'boxed', label: 'Boxed', hint: 'A frame around a light interior grid.' },
    { id: 'monograph', label: 'Monograph', hint: 'Garamond with a double rule under the heads — a book table.' },
    { id: 'inverse', label: 'Inverse', hint: 'Near-black header band over a white body.' },
    { id: 'ledger', label: 'Ledger', hint: 'Green-bar paper: striped rows, bold labels, no rules.' },

    /* Reproductions — see the Placenames block above. */
    { id: 'canberra', label: 'Canberra', hint: 'Arial 8pt, black hairlines, shaded totals.' },
    { id: 'john-adam', label: 'John Adam',
      hint: 'Full width: grey heads under bold group names, a hairline between every row.' },
    { id: 'sydney', label: 'Sydney', hint: 'A solid blue header band over a blue grid.' },
    { id: 'russell', label: 'Russell', hint: 'Near-black ink, orange rules and totals.' },

    /* Reproductions of a printed report. `lowContrast` is a declared
       exception to the readability check: the source sets white on a mid
       green, which is 2.6:1. */
    { id: 'macquarie-classic', label: 'Macquarie Classic', lowContrast: true,
      hint: 'Green band, alternating rows, white gutter between every cell.' },
    { id: 'macquarie-data', label: 'Macquarie Data', lowContrast: true,
      hint: 'Dense series: 8pt, white row labels on a green body, hairline rules.' }
  ],

  /** Resolve a theme id to its option patch. */
  patch(id) {
    const saved = UserThemes.get(id);
    if (saved) return saved.options;
    return Themes[id] || {};
  },

  /**
   * The built-ins plus whatever the user has saved, in one list. A saved theme
   * is marked `custom` — that is the only thing the picker treats differently.
   */
  /** A theme's display name, falling back to its id when it is not installed. */
  label(id) {
    const found = Themes.all().find((theme) => theme.id === id);
    return found ? found.label : id;
  },

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
    const named = Themes.all().find((t) => t.id === id);

    // Named explicitly: this rewrites the whole option surface, and "154
    // options" is a true but useless thing for the history list to say.
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

      // The previous theme's rules go; the user's own stay, in the order they
      // were left in. Later rules win, so a theme is a starting point rather
      // than a lock — but *where* the block sits is the user's to decide, and
      // the list is drag-reorderable precisely so it can be decided. Dropping
      // the new rules at the front unconditionally silently undid that: drag
      // your rule above the theme's to let the theme win over it, change theme,
      // and it was back at the bottom overriding everything again.
      //
      // The block goes where the last theme's block was, which for a first
      // apply — nothing tagged yet — is the front, as before.
      const rules = draft.styleRules || [];
      const firstTheme = rules.findIndex((rule) => rule.fromTheme);
      const mine = rules.filter((rule) => !rule.fromTheme);
      const at = firstTheme < 0
        ? 0
        : rules.slice(0, firstTheme).filter((rule) => !rule.fromTheme).length;
      draft.styleRules = mine.slice(0, at).concat(Themes.buildRules(id), mine.slice(at));
    }, { label: 'Theme: ' + (named ? named.label : id) });

    Util.toast('Applied “' + (named ? named.label : id) + '”', 'ok');
  }
};
