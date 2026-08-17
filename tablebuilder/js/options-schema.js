/**
 * options-schema.js
 *
 * The gt `tab_options()` surface, declared as data.
 *
 * Every table-wide option lives here exactly once: its key (identical to gt's
 * argument name, so `export-rgt.js` is a direct transcription), its group, its
 * control type and its default. The options panel UI is generated from this
 * list, so adding an option is a one-line change here plus whatever
 * `render-html.js` does with it.
 *
 * Control types:
 *   len     CSS length ('12px', '90%', '1.2em') — free text with unit help
 *   color   colour; `nullable` options also accept '' meaning "not set"
 *   select  one of `enum`
 *   bool    checkbox
 *   text    free text
 *   fonts   font stack chosen from FONT_STACKS
 */

const BORDER_STYLES = ['none', 'solid', 'dashed', 'dotted', 'double', 'hidden'];
const TEXT_TRANSFORMS = ['inherit', 'uppercase', 'lowercase', 'capitalize'];
const FONT_WEIGHTS = ['initial', 'normal', 'bold', 'bolder', 'lighter',
  '100', '200', '300', '400', '500', '600', '700', '800', '900'];

/** Named font stacks offered throughout the app. */
const FONT_STACKS = [
  { id: 'system-sans', label: 'System sans', stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
  // Named, not "a sans": one of the themes reproduces a specification that
  // says Arial in as many words, and is held to it. No webfont — Arial is on
  // every machine that matters here, and Helvetica and Liberation Sans are
  // metric-compatible with it.
  { id: 'arial', label: 'Arial', stack: "Arial, 'Liberation Sans', Helvetica, sans-serif" },
  { id: 'system-serif', label: 'System serif', stack: "Georgia, Cambria, 'Times New Roman', Times, serif" },
  { id: 'system-mono', label: 'System mono', stack: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace" },
  { id: 'source-serif', label: 'Source Serif 4', stack: "'Source Serif 4', Georgia, serif", web: 'Source Serif 4' },
  { id: 'eb-garamond', label: 'EB Garamond', stack: "'EB Garamond', Garamond, Georgia, serif", web: 'EB Garamond' },
  { id: 'libre-baskerville', label: 'Libre Baskerville', stack: "'Libre Baskerville', Georgia, serif", web: 'Libre Baskerville' },
  { id: 'merriweather', label: 'Merriweather', stack: "'Merriweather', Georgia, serif", web: 'Merriweather' },
  { id: 'inter', label: 'Inter', stack: "'Inter', system-ui, sans-serif", web: 'Inter' },
  { id: 'lato', label: 'Lato', stack: "'Lato', Helvetica, Arial, sans-serif", web: 'Lato' },
  { id: 'ibm-plex-sans', label: 'IBM Plex Sans', stack: "'IBM Plex Sans', Helvetica, Arial, sans-serif", web: 'IBM Plex Sans' },
  // The closest free grotesque to Helvetica Neue, which is not free. Carries
  // a real 300 rather than a synthesised one.
  { id: 'public-sans', label: 'Public Sans', stack: "'Public Sans', Helvetica, Arial, sans-serif", web: 'Public Sans' },
  { id: 'roboto', label: 'Roboto', stack: "'Roboto', Helvetica, Arial, sans-serif", web: 'Roboto' },
  { id: 'roboto-condensed', label: 'Roboto Condensed', stack: "'Roboto Condensed', 'Arial Narrow', sans-serif", web: 'Roboto Condensed' },
  { id: 'ibm-plex-mono', label: 'IBM Plex Mono', stack: "'IBM Plex Mono', ui-monospace, monospace", web: 'IBM Plex Mono' },
  { id: 'jetbrains-mono', label: 'JetBrains Mono', stack: "'JetBrains Mono', ui-monospace, monospace", web: 'JetBrains Mono' }
];

/**
 * Helper: emit the style/width/colour triplet gt uses for every border.
 *
 * The three entries stay separate options — one per gt argument, which is what
 * keeps `export-rgt.js` a direct transcription — but each is stamped with the
 * border it belongs to. This is the only place that knows the three go
 * together, so `OptionsSchema.rows()` can fold them into one row for display
 * without anything downstream learning that composites exist.
 */
function borderTriplet(prefix, group, label, style, width, color, hint) {
  const stamp = (role) => ({ border: prefix, borderRole: role, borderLabel: label });
  // The hint belongs to the composite row the three fold into, so it rides on
  // the style entry — the one `OptionsSchema.rows()` builds that row from.
  return [
    Object.assign({ key: prefix + '.style', group: group, label: label + ' style', type: 'select', enum: BORDER_STYLES, default: style }, stamp('style'), hint ? { hint: hint } : null),
    Object.assign({ key: prefix + '.width', group: group, label: label + ' width', type: 'len', default: width }, stamp('width')),
    Object.assign({ key: prefix + '.color', group: group, label: label + ' colour', type: 'color', default: color }, stamp('color'))
  ];
}

/**
 * The column form's font overrides, and the Row groups option each defers to.
 *
 * A row group is one part in this app whichever form it takes — one entry in
 * `StyleRules.PARTS`, one `optionGroup`, one `data-part` on the cell — so the
 * Row groups options govern both, and these three narrow gt arguments are an
 * override on top. See `OptionsSchema.withGroupColumnOverrides`.
 */
const GROUP_COLUMN_OVERRIDES = {
  'stub_row_group.font.size': 'row_group.font.size',
  'stub_row_group.font.weight': 'row_group.font.weight',
  'stub_row_group.text_transform': 'row_group.text_transform'
};

const OptionsSchema = {

  BORDER_STYLES: BORDER_STYLES,
  TEXT_TRANSFORMS: TEXT_TRANSFORMS,
  FONT_WEIGHTS: FONT_WEIGHTS,
  FONT_STACKS: FONT_STACKS,

  /** Ordered option groups, used to lay out the options panel. */
  groups: [
    { id: 'table', label: 'Table', hint: 'Overall size, type and outer border of the table.' },
    { id: 'heading', label: 'Heading', hint: 'The title and subtitle block above the table.' },
    { id: 'column_labels', label: 'Column labels', hint: 'The column label row and any spanner rows above it.' },
    { id: 'row_group', label: 'Row groups', hint: 'Group label rows that break up the body.' },
    { id: 'stub', label: 'Stub', hint: 'The row-label column on the left.' },
    { id: 'table_body', label: 'Body', hint: 'Data rows: lines, padding and striping.' },
    { id: 'summary_row', label: 'Summary rows', hint: 'Group-wise and grand summary rows.' },
    { id: 'footnotes', label: 'Footnotes', hint: 'The footnote block in the table footer.' },
    { id: 'source_notes', label: 'Source notes', hint: 'The source note block in the table footer.' }
  ],

  /** Every option, in panel order within its group. */
  options: [

    /* ---------- Table ---------- */
    { key: 'table.width', group: 'table', label: 'Width', type: 'len', default: 'auto',
      hint: "'auto', a px width, or a percentage of the container." },
    { key: 'table.layout', group: 'table', label: 'Layout', type: 'select', enum: ['fixed', 'auto'], default: 'fixed',
      hint: "'fixed' honours column widths exactly; 'auto' sizes to content." },
    { key: 'table.align', group: 'table', label: 'Align', type: 'select', enum: ['center', 'left', 'right'], default: 'center' },
    { key: 'table.margin.left', group: 'table', label: 'Margin left', type: 'len', default: 'auto' },
    { key: 'table.margin.right', group: 'table', label: 'Margin right', type: 'len', default: 'auto' },
    { key: 'table.background.color', group: 'table', label: 'Background', type: 'color', default: '#FFFFFF', nullable: true },
    { key: 'table.font.names', group: 'table', label: 'Font', type: 'fonts', default: 'system-sans' },
    { key: 'table.font.size', group: 'table', label: 'Font size', type: 'len', default: '16px' },
    { key: 'table.font.weight', group: 'table', label: 'Font weight', type: 'select', enum: FONT_WEIGHTS, default: 'normal' },
    { key: 'table.font.style', group: 'table', label: 'Font style', type: 'select', enum: ['normal', 'italic', 'oblique'], default: 'normal' },
    { key: 'table.font.color', group: 'table', label: 'Text colour', type: 'color', default: '#333333' },
    { key: 'table.font.color.light', group: 'table', label: 'Light text colour', type: 'color', default: '#FFFFFF',
      hint: 'Used when auto-contrast flips text over a dark fill.' },
    ...borderTriplet('table.border.top', 'table', 'Top border', 'solid', '2px', '#A8A8A8'),
    ...borderTriplet('table.border.bottom', 'table', 'Bottom border', 'solid', '2px', '#A8A8A8'),
    ...borderTriplet('table.border.left', 'table', 'Left border', 'none', '2px', '#D3D3D3'),
    ...borderTriplet('table.border.right', 'table', 'Right border', 'none', '2px', '#D3D3D3'),

    /* ---------- Heading ---------- */
    { key: 'heading.background.color', group: 'heading', label: 'Background', type: 'color', default: '', nullable: true },
    { key: 'heading.align', group: 'heading', label: 'Align', type: 'select', enum: ['center', 'left', 'right'], default: 'center' },
    { key: 'heading.title.font.size', group: 'heading', label: 'Title size', type: 'len', default: '125%' },
    { key: 'heading.title.font.weight', group: 'heading', label: 'Title weight', type: 'select', enum: FONT_WEIGHTS, default: 'initial' },
    { key: 'heading.subtitle.font.size', group: 'heading', label: 'Subtitle size', type: 'len', default: '85%' },
    { key: 'heading.subtitle.font.weight', group: 'heading', label: 'Subtitle weight', type: 'select', enum: FONT_WEIGHTS, default: 'initial' },
    { key: 'heading.padding', group: 'heading', label: 'Padding', type: 'len', default: '4px' },
    { key: 'heading.padding.horizontal', group: 'heading', label: 'Padding (h)', type: 'len', default: '5px' },
    ...borderTriplet('heading.border.bottom', 'heading', 'Bottom border', 'solid', '2px', '#D3D3D3'),
    ...borderTriplet('heading.border.lr', 'heading', 'Side borders', 'none', '1px', '#D3D3D3'),

    /* ---------- Column labels ---------- */
    { key: 'column_labels.background.color', group: 'column_labels', label: 'Background', type: 'color', default: '', nullable: true },
    { key: 'column_labels.font.size', group: 'column_labels', label: 'Font size', type: 'len', default: '100%' },
    { key: 'column_labels.font.weight', group: 'column_labels', label: 'Font weight', type: 'select', enum: FONT_WEIGHTS, default: 'normal' },
    { key: 'column_labels.text_transform', group: 'column_labels', label: 'Text transform', type: 'select', enum: TEXT_TRANSFORMS, default: 'inherit' },
    { key: 'column_labels.padding', group: 'column_labels', label: 'Padding', type: 'len', default: '5px' },
    { key: 'column_labels.padding.horizontal', group: 'column_labels', label: 'Padding (h)', type: 'len', default: '5px' },
    { key: 'column_labels.hidden', group: 'column_labels', label: 'Hide label row', type: 'bool', default: false, structural: true },
    ...borderTriplet('column_labels.border.top', 'column_labels', 'Top border', 'solid', '2px', '#D3D3D3'),
    ...borderTriplet('column_labels.border.bottom', 'column_labels', 'Bottom border', 'solid', '2px', '#D3D3D3'),
    ...borderTriplet('column_labels.border.lr', 'column_labels', 'Side borders', 'none', '1px', '#D3D3D3'),
    ...borderTriplet('column_labels.vlines', 'column_labels', 'Vertical lines', 'none', '1px', '#D3D3D3'),
    ...borderTriplet('column_labels.spanner.border.bottom', 'column_labels', 'Column-group line', 'solid', '1px', '#D3D3D3'),
    { key: 'column_labels.spanner.underline', group: 'column_labels', label: 'Underline column groups', type: 'bool', default: true,
      hint: 'Draw the line only under the columns a group covers, as gt does.' },

    /* ---------- Row groups ---------- */
    { key: 'row_group.background.color', group: 'row_group', label: 'Background', type: 'color', default: '', nullable: true },
    { key: 'row_group.font.size', group: 'row_group', label: 'Font size', type: 'len', default: '100%' },
    { key: 'row_group.font.weight', group: 'row_group', label: 'Font weight', type: 'select', enum: FONT_WEIGHTS, default: 'initial' },
    { key: 'row_group.font.style', group: 'row_group', label: 'Font style', type: 'select', enum: ['normal', 'italic', 'oblique'], default: 'normal' },
    { key: 'row_group.text_transform', group: 'row_group', label: 'Text transform', type: 'select', enum: TEXT_TRANSFORMS, default: 'inherit' },
    { key: 'row_group.padding', group: 'row_group', label: 'Padding', type: 'len', default: '8px' },
    { key: 'row_group.padding.horizontal', group: 'row_group', label: 'Padding (h)', type: 'len', default: '5px' },
    { key: 'row_group.as_column', group: 'row_group', label: 'As a column', type: 'bool', default: false,
      structural: true,
      hint: 'Show group labels in their own left-hand column instead of on a spanning row.' },
    { key: 'row_group.default_label', group: 'row_group', label: 'Default label', type: 'text', default: '',
      structural: true,
      hint: 'Label used for rows whose group value is missing.' },
    // Top and bottom mark the boundary between one group and the next, so they
    // are drawn whichever form the group takes — on the label row, or between
    // the blocks of rows when the group is a column.
    ...borderTriplet('row_group.border.top', 'row_group', 'Top border', 'solid', '2px', '#D3D3D3'),
    ...borderTriplet('row_group.border.bottom', 'row_group', 'Bottom border', 'solid', '2px', '#D3D3D3'),
    // Left and right are the two ends of the label row, as they are in gt. A
    // group shown as a column has no such row: its own edge is the stub group
    // column border, which is why the hint sends you there.
    ...borderTriplet('row_group.border.left', 'row_group', 'Left border', 'none', '1px', '#D3D3D3',
      'The end of the group label row. With groups shown as a column, the column’s own edge is Stub › Group col border.'),
    ...borderTriplet('row_group.border.right', 'row_group', 'Right border', 'none', '1px', '#D3D3D3',
      'The end of the group label row. With groups shown as a column, the column’s own edge is Stub › Group col border.'),

    /* ---------- Stub ---------- */
    { key: 'stub.background.color', group: 'stub', label: 'Background', type: 'color', default: '', nullable: true },
    { key: 'stub.font.size', group: 'stub', label: 'Font size', type: 'len', default: '100%' },
    { key: 'stub.font.weight', group: 'stub', label: 'Font weight', type: 'select', enum: FONT_WEIGHTS, default: 'initial' },
    { key: 'stub.text_transform', group: 'stub', label: 'Text transform', type: 'select', enum: TEXT_TRANSFORMS, default: 'inherit' },
    { key: 'stub.indent_length', group: 'stub', label: 'Indent step', type: 'len', default: '5px' },
    ...borderTriplet('stub.border', 'stub', 'Right border', 'solid', '2px', '#D3D3D3'),
    { key: 'stub_row_group.font.size', group: 'stub', label: 'Group col size', type: 'len', default: '100%' },
    { key: 'stub_row_group.font.weight', group: 'stub', label: 'Group col weight', type: 'select', enum: FONT_WEIGHTS, default: 'initial' },
    { key: 'stub_row_group.text_transform', group: 'stub', label: 'Group col transform', type: 'select', enum: TEXT_TRANSFORMS, default: 'inherit' },
    ...borderTriplet('stub_row_group.border', 'stub', 'Group col border', 'solid', '2px', '#D3D3D3'),

    /* ---------- Body ---------- */
    { key: 'data_row.padding', group: 'table_body', label: 'Row padding', type: 'len', default: '8px' },
    { key: 'data_row.padding.horizontal', group: 'table_body', label: 'Row padding (h)', type: 'len', default: '5px' },
    ...borderTriplet('table_body.hlines', 'table_body', 'Horizontal lines', 'solid', '1px', '#D3D3D3'),
    ...borderTriplet('table_body.vlines', 'table_body', 'Vertical lines', 'none', '1px', '#D3D3D3'),
    ...borderTriplet('table_body.border.top', 'table_body', 'Top border', 'solid', '2px', '#D3D3D3'),
    ...borderTriplet('table_body.border.bottom', 'table_body', 'Bottom border', 'solid', '2px', '#D3D3D3'),
    { key: 'row.striping.include_table_body', group: 'table_body', label: 'Stripe body rows', type: 'bool', default: false },
    { key: 'row.striping.include_stub', group: 'table_body', label: 'Stripe the stub', type: 'bool', default: false },
    { key: 'row.striping.background_color', group: 'table_body', label: 'Stripe colour', type: 'color', default: 'rgba(128,128,128,0.05)' },

    /* ---------- Summary rows ---------- */
    { key: 'summary_row.background.color', group: 'summary_row', label: 'Background', type: 'color', default: '', nullable: true },
    { key: 'summary_row.text_transform', group: 'summary_row', label: 'Text transform', type: 'select', enum: TEXT_TRANSFORMS, default: 'inherit' },
    { key: 'summary_row.padding', group: 'summary_row', label: 'Padding', type: 'len', default: '8px' },
    { key: 'summary_row.padding.horizontal', group: 'summary_row', label: 'Padding (h)', type: 'len', default: '5px' },
    ...borderTriplet('summary_row.border', 'summary_row', 'Border', 'solid', '2px', '#D3D3D3'),
    { key: 'grand_summary_row.background.color', group: 'summary_row', label: 'Grand background', type: 'color', default: '', nullable: true },
    { key: 'grand_summary_row.text_transform', group: 'summary_row', label: 'Grand transform', type: 'select', enum: TEXT_TRANSFORMS, default: 'inherit' },
    { key: 'grand_summary_row.padding', group: 'summary_row', label: 'Grand padding', type: 'len', default: '8px' },
    { key: 'grand_summary_row.padding.horizontal', group: 'summary_row', label: 'Grand padding (h)', type: 'len', default: '5px' },
    ...borderTriplet('grand_summary_row.border', 'summary_row', 'Grand border', 'double', '6px', '#D3D3D3'),

    /* ---------- Footnotes ---------- */
    { key: 'footnotes.background.color', group: 'footnotes', label: 'Background', type: 'color', default: '', nullable: true },
    { key: 'footnotes.font.size', group: 'footnotes', label: 'Font size', type: 'len', default: '90%' },
    { key: 'footnotes.padding', group: 'footnotes', label: 'Padding', type: 'len', default: '4px' },
    { key: 'footnotes.padding.horizontal', group: 'footnotes', label: 'Padding (h)', type: 'len', default: '5px' },
    { key: 'footnotes.marks', group: 'footnotes', label: 'Mark set', type: 'select',
      enum: ['numbers', 'letters', 'LETTERS', 'standard', 'extended'], default: 'numbers',
      hint: "'standard' is * † ‡ §; 'extended' adds ‖ ¶." },
    { key: 'footnotes.multiline', group: 'footnotes', label: 'One per line', type: 'bool', default: true },
    { key: 'footnotes.sep', group: 'footnotes', label: 'Separator', type: 'text', default: ' ',
      hint: 'Used between footnotes when they share a line.' },
    { key: 'footnotes.spec_ref', group: 'footnotes', label: 'Mark style (in table)', type: 'text', default: '^i',
      hint: "gt footnote spec: i italic, b bold, ^ superscript, ( ) parentheses." },
    { key: 'footnotes.spec_ftr', group: 'footnotes', label: 'Mark style (in footer)', type: 'text', default: '^i',
      hint: "gt footnote spec: i italic, b bold, ^ superscript, ( ) parentheses." },
    ...borderTriplet('footnotes.border.bottom', 'footnotes', 'Bottom border', 'none', '2px', '#D3D3D3'),
    ...borderTriplet('footnotes.border.lr', 'footnotes', 'Side borders', 'none', '2px', '#D3D3D3'),

    /* ---------- Source notes ---------- */
    { key: 'source_notes.background.color', group: 'source_notes', label: 'Background', type: 'color', default: '', nullable: true },
    { key: 'source_notes.font.size', group: 'source_notes', label: 'Font size', type: 'len', default: '90%' },
    { key: 'source_notes.padding', group: 'source_notes', label: 'Padding', type: 'len', default: '4px' },
    { key: 'source_notes.padding.horizontal', group: 'source_notes', label: 'Padding (h)', type: 'len', default: '5px' },
    { key: 'source_notes.multiline', group: 'source_notes', label: 'One per line', type: 'bool', default: true },
    { key: 'source_notes.sep', group: 'source_notes', label: 'Separator', type: 'text', default: ' ' },
    ...borderTriplet('source_notes.border.bottom', 'source_notes', 'Bottom border', 'none', '2px', '#D3D3D3'),
    ...borderTriplet('source_notes.border.lr', 'source_notes', 'Side borders', 'none', '2px', '#D3D3D3')
  ],

  /**
   * The triage, as two lists of **row** ids — a composite border is one id, not
   * three keys. Everything unlisted is advanced.
   *
   * The sorting rule is "can you see what it does?". Basic changes the look
   * obviously and you would reach for it on any table; advanced is a real
   * visual choice, just a rarer one; expert needs gt's model to know what it
   * even means.
   *
   * The tier is declared here rather than on each option so the whole basic set
   * reads as one list — that list is the thing that gets argued about and
   * revised, and it is worth being able to see it at once. A pipeline check
   * asserts every id below resolves to a real row, so the lists cannot rot.
   */
  BASIC_ROWS: [
    'table.font.names', 'table.font.size', 'table.font.color',
    'table.background.color', 'table.width', 'table.align',
    'heading.title.font.size', 'heading.title.font.weight',
    'heading.subtitle.font.size',
    'column_labels.background.color', 'column_labels.font.size',
    'column_labels.font.weight', 'column_labels.text_transform',
    'row_group.background.color', 'row_group.font.weight', 'row_group.font.style',
    'stub.font.weight',
    'data_row.padding', 'table_body.hlines', 'table_body.vlines',
    'table_body.border.bottom', 'row.striping.include_table_body',
    'row.striping.background_color',
    'summary_row.background.color',
    'footnotes.marks', 'footnotes.font.size',
    'source_notes.font.size'
  ],

  EXPERT_ROWS: [
    'table.margin.left', 'table.margin.right', 'table.font.color.light',
    'heading.padding.horizontal', 'heading.border.lr',
    'column_labels.padding.horizontal', 'column_labels.border.lr',
    'column_labels.spanner.border.bottom', 'column_labels.spanner.underline',
    'row_group.padding.horizontal', 'row_group.border.left', 'row_group.border.right',
    'stub.indent_length', 'stub_row_group.font.size', 'stub_row_group.font.weight',
    'stub_row_group.text_transform', 'stub_row_group.border',
    'row.striping.include_stub',
    'summary_row.text_transform', 'summary_row.padding.horizontal',
    'grand_summary_row.text_transform', 'grand_summary_row.padding',
    'grand_summary_row.padding.horizontal',
    'footnotes.padding.horizontal', 'footnotes.sep',
    'footnotes.border.bottom', 'footnotes.border.lr',
    'source_notes.padding.horizontal', 'source_notes.sep',
    'source_notes.border.bottom', 'source_notes.border.lr'
  ],

  /** Lazily built row id -> tier. */
  _tierByRow: null,

  /** 'basic' | 'advanced' | 'expert' for a row id. */
  tierOf(rowId) {
    if (!OptionsSchema._tierByRow) {
      const map = {};
      for (const id of OptionsSchema.BASIC_ROWS) map[id] = 'basic';
      for (const id of OptionsSchema.EXPERT_ROWS) map[id] = 'expert';
      OptionsSchema._tierByRow = map;
    }
    return OptionsSchema._tierByRow[rowId] || 'advanced';
  },

  /**
   * A group as display rows. Consecutive options sharing a `border` id fold
   * into one composite row, so a border reads as the one decision it is rather
   * than three — that alone takes the surface from 154 rows to 100.
   *
   * Presentation only: every option keeps its own key and is written
   * independently by whoever renders the row.
   *
   * @param {string} groupId
   * @returns {Array<{id, tier, composite, label, hint, option?, options?}>}
   */
  rows(groupId) {
    const out = [];
    let open = null;

    for (const option of OptionsSchema.byGroup(groupId)) {
      if (option.border) {
        if (open && open.id === option.border) { open.options.push(option); continue; }
        open = {
          id: option.border,
          tier: OptionsSchema.tierOf(option.border),
          composite: true,
          label: option.borderLabel,
          hint: option.hint,
          options: [option]
        };
        out.push(open);
        continue;
      }

      open = null;
      out.push({
        id: option.key,
        tier: OptionsSchema.tierOf(option.key),
        composite: false,
        label: option.label,
        hint: option.hint,
        option: option
      });
    }

    return out;
  },

  /** Lazily built key -> option index. */
  _byKey: null,

  /** Look up a single option definition. */
  get(key) {
    if (!OptionsSchema._byKey) {
      OptionsSchema._byKey = {};
      for (const opt of OptionsSchema.options) OptionsSchema._byKey[opt.key] = opt;
    }
    return OptionsSchema._byKey[key] || null;
  },

  /** All options belonging to a group, in declared order. */
  byGroup(groupId) {
    return OptionsSchema.options.filter((o) => o.group === groupId);
  },

  /**
   * Options that decide what the table *is*, not how it looks: whether row
   * groups are a column, what an unlabelled group is called, whether the header
   * row exists at all.
   *
   * They live in `options` for the same reason everything else does, but they
   * are the user's structural choices, so a theme must not silently undo them —
   * applying a look should never move your row groups. A theme that names one
   * explicitly still wins; none of the built-ins do.
   */
  structural() {
    return OptionsSchema.options.filter((o) => o.structural).map((o) => o.key);
  },

  /** A fresh options object holding every default. */
  defaults() {
    const out = {};
    for (const opt of OptionsSchema.options) out[opt.key] = opt.default;
    return out;
  },

  GROUP_COLUMN_OVERRIDES: GROUP_COLUMN_OVERRIDES,

  /**
   * The option surface with the row-group column form's three overrides
   * resolved.
   *
   * `stub_row_group.font.size`, `.font.weight` and `.text_transform` are gt's
   * narrower set for a row group shown as a column, and each defaults to exactly
   * what its `row_group.*` counterpart defaults to. So until one is set to
   * something it expresses no intent — while landing on the same element one
   * rule later, which meant it won anyway and threw away whatever the Row groups
   * options had said. Resolving them here is what makes `row_group.as_column` a
   * decision about what the table *is*, as it is flagged, rather than one that
   * quietly discards a look chosen separately.
   *
   * **Derived, and never written back to the spec.** A saved project and a saved
   * theme keep only what was actually set, so a later change to what an unset
   * override means still reaches a file written today.
   *
   * `render-html.js` and `export-rgt.js` both read this, which is the point of
   * its being here rather than in either: gt applies `row_group.*` to the heading
   * row alone, so unless the value is written into gt's own second argument the
   * exported table loses it and the R stops reproducing the preview.
   *
   * Returns the same object when there is nothing to resolve.
   */
  withGroupColumnOverrides(options) {
    if (!options || !options['row_group.as_column']) return options;

    let out = options;
    for (const key of Object.keys(GROUP_COLUMN_OVERRIDES)) {
      const def = OptionsSchema.get(key);
      if (def && options[key] !== def.default) continue;   // set: it means it
      if (out === options) out = Object.assign({}, options);
      out[key] = options[GROUP_COLUMN_OVERRIDES[key]];
    }
    return out;
  },

  /**
   * Resolve a font reference to a CSS font-family value.
   * Delegates to fonts.js, which also knows about user-added fonts; this stays
   * here so every existing call site keeps working unchanged.
   */
  fontStack(idOrStack) {
    return Fonts.stack(idOrStack);
  },

  /** The Google Fonts family name for a font reference, or null. */
  webFont(idOrStack) {
    return Fonts.webFamily(idOrStack);
  },

  /**
   * Only the options that differ from their default. Used for compact project
   * files and for emitting a minimal `tab_options()` call in the R exporter.
   */
  diff(options) {
    const out = {};
    for (const opt of OptionsSchema.options) {
      const value = options[opt.key];
      if (value !== undefined && value !== opt.default) out[opt.key] = value;
    }
    return out;
  }
};
