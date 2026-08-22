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
 * conditional or genuinely per-cell is a rule in the Style rules panel, which is
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
    // anything conditional or per-cell is a rule in the Style rules panel, which is
    // what survives the export to R. So a selection gets what it is, the
    // actions that act on it, and the defaults that govern it.
    if (items.length) {
      host.appendChild(Inspector.selectionSummary(spec, items));

      const value = Inspector.valueEditor(spec, items);
      if (value) host.appendChild(value);

      const indent = Inspector.indentEditor(spec, items);
      if (indent) host.appendChild(indent);

      const colour = Inspector.colorSource(spec, items);
      if (colour) host.appendChild(colour);

      const quick = Inspector.quickScope(spec, items);
      if (quick) host.appendChild(quick);

      host.appendChild(Controls.actions([
        Controls.button('Clear selection', () => Selection.clear(), { kind: 'ghost' })
      ]));

      host.appendChild(Inspector.partDefaults(spec, Selection.commonPart()));
      return host;
    }

    host.appendChild(Inspector.tableDefaults(spec, false));
    return host;
  },

  /* ================================================================
     Cell value
     ================================================================ */

  /**
   * The value behind the selected cell, editable.
   *
   * **This does not reopen the 2026-08-13 decision.** That removed hand-styling
   * a cell, and the Inspector still paints nothing. Correcting a spelling
   * mistake is not styling: it is a fact about the data that happens to have
   * been wrong in the file, and the alternative is editing the CSV and
   * re-importing, which throws away nothing but costs a round trip for one
   * character.
   *
   * **It shows the raw value, not the cell text.** A cell reading `1,234.57` is
   * a formatted view of `1234.5678`; letting someone edit the displayed string
   * would round-trip the rounding into the data. So the field is the underlying
   * value and the hint says what the cell makes of it — which is the same split
   * a spreadsheet draws between the formula bar and the grid.
   *
   * Data rows only. A summary row is computed, so there is nothing behind its
   * cells to correct; its *label* is already editable in Totals.
   */
  valueEditor(spec, items) {
    if (items.length !== 1) return null;
    const item = items[0];
    if (item.part !== 'body' && item.part !== 'stub') return null;
    if (item.srcIndex === undefined || item.srcIndex === null) return null;

    const model = App.model;
    if (!model || !model.ok) return null;

    // A stub location carries no `colId` by design — the column it draws is the
    // model's stub column, which is the one thing that knows.
    const colId = item.part === 'stub' ? model.stubColId : item.colId;
    if (!colId) return null;

    const column = App.workingColumnsById()[colId];
    if (!column) return null;

    const row = App.workingRowAt(item.srcIndex);
    if (!row || !(colId in row)) return null;

    const raw = row[colId] === null || row[colId] === undefined ? '' : String(row[colId]);
    const title = Spec.columnTitle(spec, column);
    const key = colId + '.' + item.srcIndex;
    const step = Pipeline.find(spec, 'correct');
    const correction = Corrections.find((step && step.edits) || [], item.srcIndex, colId);

    const nodes = [Controls.field('Value',
      Controls.text('cell.value.' + key, raw, (next) => {
        Store.update((draft) => {
          Corrections.set(draft, item.srcIndex, colId, next);
        }, { coalesce: 'cell.' + key, label: 'Edit ' + title });
      }, { placeholder: '(empty)' }))];

    /* ---- What the table makes of it ---- */

    const shown = Inspector.cellTextAt(model, item.srcIndex, colId, item.part);
    if (shown !== null && shown !== raw) {
      nodes.push(Util.el('div.field-hint', {
        text: 'The cell shows “' + Util.truncate(shown, 40) + '” — number formats, ' +
          'substitutions and column merges are applied on top of this value.'
      }));
    }

    // Not a blocker: the app itself copes with text in a numeric column, and
    // `Csv.inferType` only ever needed 85% of values to parse. But it changes
    // what the cell means to sorting, totals and the export, so it should not
    // be silent.
    if (column.type === 'number' && raw !== '' && Util.toNumber(raw) === null) {
      nodes.push(Util.el('div.field-hint.is-warn', {
        text: 'This column is numeric and this is not a number. It will not sort, ' +
          'total or format as one, and the R export emits it as text.'
      }));
    }

    /* ---- Where it came from ---- */

    if (correction) {
      nodes.push(Util.el('div.field-hint', {
        text: 'Corrected from “' + Util.truncate(correction.from, 40) + '”. ' +
          'The imported file is untouched; the correction travels with the project.'
      }));
      nodes.push(Controls.actions([
        Controls.button('Restore original', () => {
          Store.update((draft) => {
            Corrections.set(draft, item.srcIndex, colId, correction.from);
          }, { label: 'Restore ' + title });
        }, { kind: 'ghost' })
      ]));
    } else {
      nodes.push(Util.el('div.field-hint', {
        text: 'Editing this corrects the cell for this project only. The imported ' +
          'file is never changed, and every correction is listed under Data.'
      }));
    }

    return Controls.section('Value', nodes, { key: 'insp.value' });
  },

  /** The rendered text of one cell, as plain text, or null if it is not on screen. */
  cellTextAt(model, srcIndex, colId, part) {
    const row = (model.rows || []).find((r) => r.kind === 'data' && r.srcIndex === srcIndex);
    if (!row) return null;
    // A stub cell has no `colId`, so it is found by its kind rather than by id.
    const cell = part === 'stub'
      ? row.cells.find((c) => c.kind === 'stub')
      : row.cells.find((c) => c.colId === colId);
    return cell ? Markup.toPlain(cell.text) : null;
  },

  /* ================================================================
     Quick style rule
     ================================================================ */

  /**
   * Which selection the row choice is currently open for, as a key. Kept as a
   * key rather than a boolean so it closes itself when the selection moves —
   * the Inspector has no selection-change hook of its own to reset it from.
   */
  _rowScopeFor: null,

  /**
   * Two scopes a single body cell can be turned into a rule for: its whole
   * column, or its row.
   *
   * **This creates the rule and leaves.** The styling happens in the Style
   * panel, which is the decision recorded on 2026-08-13: the Inspector names
   * what is selected and the Style rules panel paints. What was missing was a way to
   * say *what a rule should cover* without going and building the location by
   * hand, which is the slow part.
   *
   * Body cells only. A column rule stops at the body and does not reach the
   * heading; a row rule does not reach the row label. Both are their own parts
   * and are styled by selecting them.
   */
  quickScope(spec, items) {
    if (items.length !== 1) return null;
    const item = items[0];
    if (item.part !== 'body' || !item.colId) return null;
    if (item.srcIndex === undefined || item.srcIndex === null) return null;

    // Two views of the same columns: `workingColumns` carries the label the
    // user sees (renames applied), `workingColumnsById` is the raw shape
    // `evalRowExpr` is given, so the expression is checked against exactly what
    // compute will check it against.
    const columns = App.workingColumnsById();
    const column = App.workingColumns().find((c) => c.id === item.colId);
    if (!column || !columns[item.colId]) return null;

    const key = item.colId + '#' + item.srcIndex;
    const nodes = [];

    const create = (scope, label) => {
      Store.update((draft) => {
        const rule = StyleRules.emptyRule(label);
        rule.locations = [StyleRules.bodyScope(scope)];
        draft.styleRules.push(rule);
      }, { label: 'Add style rule' });
      Inspector._rowScopeFor = null;
      App.goToPanel('style', 'style.rules');
    };

    /* ---- The two scopes ---- */

    nodes.push(Controls.actions([
      Controls.button('Style column', () => {
        create({ kind: 'column', colId: item.colId }, 'Column: ' + column.label);
      }, { title: 'Every body cell in ' + column.label + ' — not the heading' }),

      Controls.button(Inspector._rowScopeFor === key ? 'Style row ▴' : 'Style row…', () => {
        Inspector._rowScopeFor = Inspector._rowScopeFor === key ? null : key;
        App.renderInspector();
      })
    ]));

    /* ---- How the row should be identified ---- */

    if (Inspector._rowScopeFor === key) {
      const rowsById = {};
      for (const row of (App.model && App.model.rows) || []) {
        if (row.kind === 'data') rowsById[row.srcIndex] = row;
      }

      const raw = (App.workingRowAt(item.srcIndex) || {})[item.colId];
      const expr = StyleRules.seedExpr(item.colId, raw, column.type);
      const matched = StyleRules.evalRowExpr(expr, {
        rows: App.workingRows(), columnsById: columns
      });
      const hits = matched.rows ? matched.rows.size : 0;

      nodes.push(Controls.button('By value: ' + Util.truncate(expr, 30), () => {
        create({ kind: 'where', expr: expr }, 'Where ' + expr);
      }, { block: true }));
      nodes.push(Util.el('div.field-hint', {
        text: 'A rule that follows the data: matches ' + hits + ' row' + (hits === 1 ? '' : 's') +
          ' now, and whatever matches after the next import. Edit the expression under Style rules.'
      }));

      const stub = rowsById[item.srcIndex] && rowsById[item.srcIndex].cells[0];
      const rowName = stub && stub.text ? Markup.toPlain(stub.text) : null;

      nodes.push(Controls.button('By row: ' + (rowName || 'source row ' + (item.srcIndex + 1)), () => {
        create({ kind: 'row', srcIndex: item.srcIndex },
          'Row: ' + (rowName || 'source row ' + (item.srcIndex + 1)));
      }, { block: true }));
      nodes.push(Util.el('div.field-hint', {
        text: 'Pinned to this row of the imported data. It stays with the row through a ' +
          're-sort, and stops meaning anything if the row is removed.'
      }));
    }

    return Controls.section('Quick style rule', nodes, { key: 'insp.quick' });
  },

  /**
   * The defaults that actually govern whatever is selected: the column-label
   * options behind a column heading, the body options behind a body cell.
   *
   * Basic rows only. This is the quick-adjust surface and the Table defaults panel is
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

  /**
   * How far a row label is indented, for the selected rows.
   *
   * `structure.stubIndent` and the `stub.indent_length` option have both been
   * in the schema since the first commit and **nothing ever wrote the indent**
   * — an option in Table defaults governing a step size for an indent no
   * control could set, and a value `compute.js`, `render-html.js` and
   * `export-latex.js` all read and nobody produced. This is what makes it
   * reachable.
   *
   * Capped at gt's own limit: `tab_stub_indent()` takes a whole number between
   * 0 and 5 and errors outside it, so a preview that went further would be a
   * table that cannot be exported.
   */
  MAX_INDENT: 5,

  indentEditor(spec, items) {
    const rows = Util.unique(items
      .filter((item) => item.part === 'stub')
      .map((item) => item.srcIndex)
      .filter((i) => i !== undefined && i !== null));
    if (!rows.length) return null;

    const current = spec.structure.stubIndent || {};
    const levels = Util.unique(rows.map((i) => current[i] || 0));
    const shown = levels.length === 1 ? levels[0] : 0;

    const set = (value) => Store.update((draft) => {
      const next = Util.clamp(Math.round(value), 0, Inspector.MAX_INDENT);
      if (!draft.structure.stubIndent) draft.structure.stubIndent = {};
      for (const i of rows) {
        // Zero is the default, so it is an absence rather than a value — the
        // same instinct as `PanelStyle.applyProperty` deleting a key for
        // `inherit` instead of writing a neutral one over it.
        if (next) draft.structure.stubIndent[i] = next;
        else delete draft.structure.stubIndent[i];
      }
    }, { label: 'Indent row labels' });

    return Controls.section('Row label', [
      Controls.field('Indent', Controls.number('insp.indent', shown, set,
        { min: 0, max: Inspector.MAX_INDENT, step: 1 }),
      { hint: rows.length === 1
        ? 'Steps of the width set by Stub › Indent step. gt allows 0 to 5.'
        : 'Applies to all ' + rows.length + ' selected rows. gt allows 0 to 5.' }),
      levels.length > 1
        ? Util.el('div.field-hint', { text: 'The selected rows are indented differently; ' +
          'setting this puts them all at the same level.' })
        : null
    ].filter(Boolean), { key: 'insp.indent' });
  },

  /**
   * Which colour rule painted the selected cell, when one did.
   *
   * A border can be traced to the rule that drew it — the line card has said so
   * since `hSrc`/`vSrc` — and a fill could not, on the mechanism where overlap
   * is likeliest, since colour rules stack and the last one wins per property.
   * `Compute.colorFor` stamps the winner, so this reads it rather than
   * re-matching the plan.
   *
   * The fill and the text colour can come from different rules, so both are
   * named when they differ.
   */
  colorSource(spec, items) {
    // `App.model` is whatever `Compute.run` last returned, and that can be a
    // failed model. A failed model is readable now — empty `rows` and `cols`
    // rather than none — so this no longer has to ask to avoid throwing; it
    // asks because a colour on a table that did not resolve is not a fact
    // worth reporting.
    if (items.length !== 1 || !App.model || !App.model.ok) return null;
    const item = items[0];
    if (item.part !== 'body' || !item.colId || item.srcIndex === undefined) return null;

    const row = App.model.rows.find((r) => r.kind === 'data' && r.srcIndex === item.srcIndex);
    const cell = row && row.cells.find((c) => c.colId === item.colId);
    if (!cell || !cell.color) return null;

    const byId = {};
    for (const rule of spec.dataColor) byId[rule.id] = rule;

    const swatch = (value) => Util.el('span.swatch', {
      title: value, style: { background: value }
    });

    const fields = [];
    const seen = [];
    const add = (label, value, ruleId) => {
      const rule = byId[ruleId];
      const name = rule ? Spec.colorRuleTitle(rule) : null;
      fields.push(Controls.field(label, Util.el('span.wrap-any', null, [
        swatch(value),
        Util.el('span.mono.dim', { text: ' ' + value }),
        name ? Util.el('span.dim', { text: ' — ' + name }) : null
      ].filter(Boolean))));
      if (name && seen.indexOf(name) < 0) seen.push(name);
    };

    if (cell.color.fill) add('Fill', cell.color.fill, cell.color.fillRule);
    if (cell.color.color) add('Text', cell.color.color, cell.color.colorRule);
    if (!fields.length) return null;

    fields.push(Controls.actions([
      Controls.button('Edit colour rule', () => App.goToPanel('color', 'color.rules'), { kind: 'ghost' })
    ]));

    return Controls.section('Colour by value', fields, { key: 'insp.colour' });
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

    wrap.appendChild(Controls.section('Lines', [
      Controls.field('Row lines', Controls.select('td.hlines',
        OptionsSchema.BORDER_STYLES, spec.options['table_body.hlines.style'],
        set('table_body.hlines.style'))),
      Controls.field('Column lines', Controls.select('td.vlines',
        OptionsSchema.BORDER_STYLES, spec.options['table_body.vlines.style'],
        set('table_body.vlines.style'))),
      Controls.field('Stripe rows', Controls.checkbox('td.stripe',
        spec.options['row.striping.include_table_body'],
        set('row.striping.include_table_body'))),
      Util.el('div.field-hint', { text: 'The full set lives under Table defaults.' })
    ], { key: 'td.rules' }));

    return wrap;
  }
};
