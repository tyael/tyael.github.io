/**
 * ui/inspector.js
 *
 * The right-hand inspector: what is selected, and the defaults that govern it.
 *
 * It deliberately does not style individual cells. Hand-picking one cell and
 * painting it is the rare case, it does not survive a data update, and anyone
 * who wants that granularity is better served exporting to R and working in
 * RStudio. What this offers instead is the table options for the part you
 * clicked — click a column heading, adjust column headings — while anything
 * conditional or genuinely per-cell is a rule in the Style panel, which is
 * what `tab_style()` carries into the export.
 */

const Inspector = {

  /* ================================================================
     Panel
     ================================================================ */

  render(spec) {
    const host = Util.el('div.panel');
    const items = Selection.current();

    Util.qs('#inspector-title').textContent = items.length ? 'Selection' : 'Table';
    const hint = Util.qs('#inspector-hint');
    if (items.length) {
      hint.textContent = Selection.describePlain() || '';
      hint.title = Selection.describe() || '';
    } else {
      hint.textContent = 'nothing selected — showing table defaults';
      hint.title = '';
    }

    if (!Spec.hasData(spec)) {
      host.appendChild(Controls.note('Import data to begin.'));
      return host;
    }

    // Hand-styling one cell is not something this editor does: the way to
    // change how a table looks is the defaults for the part you clicked, and
    // anything conditional or per-cell is a rule in the Style panel, which is
    // what survives the export to R. So a selection gets what it is, the
    // actions that act on it, and the defaults that govern it.
    if (items.length) {
      host.appendChild(Inspector.selectionSummary(spec, items));

      host.appendChild(Controls.actions([
        Controls.button('Clear selection', () => Selection.clear(), { kind: 'ghost' })
      ]));

      host.appendChild(Inspector.partDefaults(spec, Selection.commonPart()));
      return host;
    }

    host.appendChild(Inspector.tableDefaults(spec, false));
    return host;
  },

  /**
   * The defaults that actually govern whatever is selected: the column-label
   * options behind a column heading, the body options behind a body cell.
   *
   * Basic rows only. This is the quick-adjust surface and the Options panel is
   * the reference one, so the link at the bottom is how you reach the rest.
   * Rendering the whole group put 23 fields behind a column heading — twelve of
   * them border sub-properties — in the narrower of the two rails.
   *
   * These apply to every cell of the part, not only the selection. Falls back
   * to the table-wide block for a mixed selection.
   */
  partDefaults(spec, part) {
    const meta = part ? StyleRules.PARTS.find((p) => p.id === part) : null;
    const group = meta && meta.optionGroup
      ? OptionsSchema.groups.find((g) => g.id === meta.optionGroup)
      : null;

    if (!group) {
      const wrap = Util.el('div');
      wrap.appendChild(Util.el('div.mini-label', {
        text: 'Table-wide defaults', style: { marginTop: '14px' }
      }));
      wrap.appendChild(Inspector.tableDefaults(spec, true));
      return wrap;
    }

    const changedKeys = new Set(Object.keys(OptionsSchema.diff(spec.options)));

    const fields = [Util.el('div.field-hint', {
      text: group.hint + ' These apply to every one, not just the selection.'
    })];

    for (const row of OptionsSchema.rows(group.id)) {
      if (row.tier === 'basic') fields.push(PanelOptions.rowField(spec, row, changedKeys));
    }

    fields.push(Controls.actions([
      Controls.button('Open ' + group.label + ' in Options →',
        () => App.goToPanel('options', ['opt.' + group.id, 'opt.more.' + group.id]),
        { kind: 'ghost' })
    ]));

    const wrap = Util.el('div');
    wrap.appendChild(Util.el('div.mini-label', {
      text: group.label + ' defaults', style: { marginTop: '14px' }
    }));
    wrap.appendChild(Controls.section(group.label, fields, { key: 'insp.part.' + group.id }));
    return wrap;
  },

  selectionSummary(spec, items) {
    return Controls.section('Selected', [
      Controls.field('Cells', Util.el('span.mono.dim', { text: String(items.length) })),
      Controls.field('Location', Util.el('span.dim.wrap-any', {
        text: Selection.describePlain() || '',
        title: Selection.describe() || ''
      })),
      Controls.actions([
        Controls.button('Add footnote here', () => PanelContent.addFootnote(items)),
        Controls.button('Copy values', () => Inspector.copyValues(items), { kind: 'ghost' })
      ])
    ], { key: 'insp.selected' });
  },

  /** Copy the raw values of the selected body cells to the clipboard, TSV. */
  copyValues(items) {
    const model = App.model;
    if (!model) return;

    const rows = Util.unique(items.map((s) => s.srcIndex).filter((i) => i !== undefined));
    const cols = Selection.selectedColumnIds();
    const byIndex = {};
    for (const row of model.rows) {
      if (row.kind === 'data') byIndex[row.srcIndex] = row;
    }

    const lines = rows.map((srcIndex) => {
      const row = byIndex[srcIndex];
      if (!row) return '';
      return cols.map((colId) => {
        const cell = row.cells.find((c) => c.colId === colId);
        return cell ? Markup.toPlain(cell.text) : '';
      }).join('\t');
    }).filter(Boolean);

    if (!lines.length) { Util.toast('Nothing to copy', 'error'); return; }
    Util.copy(lines.join('\n')).then((ok) => {
      Util.toast(ok ? 'Copied ' + lines.length + ' row(s)' : 'Copy failed', ok ? 'ok' : 'error');
    });
  },

  /* ================================================================
     Table defaults (shown when nothing is selected)
     ================================================================ */

  tableDefaults(spec, hasSelection) {
    const wrap = Util.el('div');
    const set = (key) => (value) => Store.update((draft) => { draft.options[key] = value; },
      { coalesce: 'opt.' + key });

    // The guidance is for the empty state; with something selected the user has
    // already found the gesture, and a label above these sections says enough.
    if (!hasSelection) {
      wrap.appendChild(Controls.intro(
        'Click any cell, label, column group or title to see the settings for it, ' +
        'or alt-click a column heading to take the whole column. ' +
        'These are the table-wide defaults.'
      ));
    }

    wrap.appendChild(Controls.section('Type', [
      Controls.field('Font', Controls.fonts('td.font', spec.options['table.font.names'],
        set('table.font.names'))),
      Controls.field('Size', Controls.length('td.size', spec.options['table.font.size'],
        set('table.font.size'))),
      Controls.field('Colour', Controls.color('td.color', spec.options['table.font.color'],
        set('table.font.color'))),
      Controls.field('Background', Controls.color('td.bg', spec.options['table.background.color'],
        set('table.background.color'), { nullable: true }))
    ], { key: 'td.type' }));

    wrap.appendChild(Controls.section('Density', [
      Controls.field('Row padding', Controls.length('td.pad', spec.options['data_row.padding'],
        set('data_row.padding'))),
      Controls.field('Row padding (h)', Controls.length('td.padh', spec.options['data_row.padding.horizontal'],
        set('data_row.padding.horizontal'))),
      Controls.field('Table width', Controls.length('td.width', spec.options['table.width'],
        set('table.width')), { hint: "'auto', a px value, or a percentage." }),
      Controls.field('Layout', Controls.select('td.layout', ['fixed', 'auto'],
        spec.options['table.layout'], set('table.layout')),
        { hint: "'auto' lets columns size to their content." })
    ], { key: 'td.density' }));

    wrap.appendChild(Controls.section('Rules', [
      Controls.field('Row lines', Controls.select('td.hlines',
        OptionsSchema.BORDER_STYLES, spec.options['table_body.hlines.style'],
        set('table_body.hlines.style'))),
      Controls.field('Column lines', Controls.select('td.vlines',
        OptionsSchema.BORDER_STYLES, spec.options['table_body.vlines.style'],
        set('table_body.vlines.style'))),
      Controls.field('Stripe rows', Controls.checkbox('td.stripe',
        spec.options['row.striping.include_table_body'],
        set('row.striping.include_table_body'))),
      Util.el('div.field-hint', { text: 'The full set lives under Options.' })
    ], { key: 'td.rules' }));

    return wrap;
  }
};
