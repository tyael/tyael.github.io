/**
 * ui/panel-options.js
 *
 * The Table defaults panel: the whole `tab_options()` surface, generated from
 * options-schema.js.
 *
 * Nothing here is written per option — the groups, the rows, the controls and
 * the search index all come from the schema. What this file adds is the
 * triage: basic rows first, advanced behind a per-group disclosure, and the
 * expert tier behind one toggle, so the surface opens at 27 rows rather than
 * 154.
 *
 * Two overrides stop the tiers from hiding anything that matters — a search
 * reaches every tier, and an option differing from its default always renders.
 */

const PanelOptions = {

  id: 'options',
  label: 'Table defaults',
  hint: 'Table-wide appearance defaults, and themes',

  _query: '',

  /**
   * In-memory fallback for the localStorage read below, so a storage failure
   * degrades to a working default instead of reverting the checkbox on every
   * click — the same precedent `Controls.sectionState` already sets.
   */
  _showExpert: null,

  /**
   * The expert tier belongs to the person, not the table, so it lives in
   * localStorage rather than the spec — the same reasoning that keeps saved
   * themes out of the spec.
   */
  showExpert() {
    if (PanelOptions._showExpert === null) {
      try {
        PanelOptions._showExpert = localStorage.getItem('table_builder.showExpertOptions') === '1';
      } catch (e) {
        PanelOptions._showExpert = false;
      }
    }
    return PanelOptions._showExpert;
  },

  setShowExpert(on) {
    PanelOptions._showExpert = !!on;
    try {
      localStorage.setItem('table_builder.showExpertOptions', on ? '1' : '0');
    } catch (e) { /* ignore */ }
  },

  render(spec) {
    const panel = Util.el('div.panel');

    /* ---- Themes ---- */

    panel.appendChild(PanelOptions.themeSection(spec));

    /* ---- Search ---- */

    const search = Util.el('input', {
      type: 'search',
      placeholder: 'Search options…',
      value: PanelOptions._query,
      dataset: { ctl: 'opt.search' },
      on: {
        input: (e) => {
          // Neither deferred nor held: this filters the panel rather than
          // changing the spec, so the rebuild *is* the keystroke's effect, and
          // `renderRail` never yields to the box it is called from.
          PanelOptions._query = e.target.value;
          App.renderRail();
        }
      }
    });
    panel.appendChild(Util.el('div', { style: { marginBottom: '10px' } }, [search]));

    const query = PanelOptions._query.trim().toLowerCase();
    const changedKeys = new Set(Object.keys(OptionsSchema.diff(spec.options)));
    const expert = PanelOptions.showExpert();

    if (changedKeys.size) {
      panel.appendChild(Util.el('div.field-hint', {
        style: { marginBottom: '8px' },
        text: changedKeys.size + ' option(s) changed from the default.'
      }));
      panel.appendChild(Controls.button('Reset all to defaults', () => {
        if (!window.confirm('Reset every appearance option to its default?\n\n' +
          'Structural choices — row groups as a column, the default group label, ' +
          'a hidden header — are kept.')) return;
        Store.update((draft) => {
          const next = OptionsSchema.defaults();
          for (const key of OptionsSchema.structural()) next[key] = draft.options[key];
          draft.options = next;
        });
      }, { kind: 'danger', block: true }));
      panel.appendChild(Util.el('div', { style: { height: '10px' } }));
    }

    /* ---- The expert tier ---- */

    panel.appendChild(Controls.field('Show all gt options',
      Controls.checkbox('opt.showExpert', expert, (on) => {
        PanelOptions.setShowExpert(on);

        // One-shot, not a per-render force — the same shape as `App.moreOpen`
        // in main.js (see `onChange`'s comment there). Expert rows only ever
        // land inside a group's "More …" disclosure, so turning this toggle
        // on with every disclosure closed moves nothing but a count buried
        // two levels deep — a dead control. Forcing every group's "More"
        // section open here, in the change handler, fires exactly once, when
        // the toggle flips on; computing it in `render` instead would force
        // it open on every rebuild of this panel (which happens on every
        // spec change, e.g. a later Inspector edit) and the user could never
        // collapse a group's "More" section again. The group's own section is
        // forced open too — a "More" disclosure opened inside a still-
        // collapsed group is exactly as invisible as the bug being fixed.
        // Turning the toggle off deliberately does nothing here: the user's
        // own open/closed choices, once made, are theirs to keep.
        if (on) {
          for (const group of OptionsSchema.groups) {
            Controls.setSectionState('section.opt.' + group.id, false);
            Controls.setSectionState('section.opt.more.' + group.id, false);
          }
        }

        App.renderRail();
      }),
      {
        hint: 'These map 1:1 to gt’s tab_options() arguments. If you are heading ' +
          'to R anyway, Export › R — gt pipeline gives you the call to edit there.'
      }));

    /* ---- Groups ---- */

    let shown = 0;

    for (const group of OptionsSchema.groups) {
      const rows = OptionsSchema.rows(group.id)
        .filter((row) => PanelOptions.rowVisible(row, query, expert, changedKeys, group));

      if (!rows.length) continue;
      shown += rows.length;

      const basic = rows.filter((row) => row.tier === 'basic');
      const rest = rows.filter((row) => row.tier !== 'basic');
      // A changed advanced/expert value renders (rowVisible's override), but it
      // still sits behind the "More" disclosure and the group's own collapse.
      // Without a count on both, a changed option is invisible in two nested
      // closed disclosures — the Booktabs theme trips this on three options and
      // the group header reads identically to an untouched spec.
      const changedRest = rest.filter((row) => PanelOptions.rowChanged(row, changedKeys)).length;

      const nodes = [Util.el('div.field-hint', { text: group.hint })];
      const inert = PanelOptions.groupInert(spec, group);
      if (inert) nodes.push(inert);
      for (const row of basic) nodes.push(PanelOptions.rowField(spec, row, changedKeys));

      if (rest.length) {
        if (query) {
          // A search already narrowed the list; a second disclosure would just
          // hide the hit the user came for.
          for (const row of rest) nodes.push(PanelOptions.rowField(spec, row, changedKeys));
        } else {
          const moreCount = changedRest > 0
            ? rest.length + '  ·  ' + changedRest + ' changed'
            : String(rest.length);
          nodes.push(Controls.section(
            'More ' + group.label.toLowerCase() + ' options (' + moreCount + ')',
            rest.map((row) => PanelOptions.rowField(spec, row, changedKeys)),
            { key: 'opt.more.' + group.id, collapsed: true }));
        }
      }

      // The header count is what opening the group gets you, not what exists —
      // plus, when something changed deeper in, how many and that they did.
      const count = query ? rows.length : basic.length;
      const headSuffix = changedRest > 0 ? '  ·  ' + changedRest + ' changed' : '';
      panel.appendChild(Controls.section(group.label + '  ·  ' + count + headSuffix, nodes, {
        key: 'opt.' + group.id,
        collapsed: !query
      }));
    }

    if (query && !shown) {
      panel.appendChild(Controls.note('No options match “' + PanelOptions._query + '”.'));
    }

    return panel;
  },

  /* ================================================================
     Rows
     ================================================================ */

  /**
   * Why a whole group is drawing nothing, when that is the case.
   *
   * Twenty-odd fonts, paddings and borders for a header that is switched off
   * read as broken rather than as inert, and the switch is in a different
   * panel — so the note carries the way there. Same shape as
   * `Controls.field`'s `requires`, one level up.
   */
  groupInert(spec, group) {
    if (group.id !== 'column_labels' || !Spec.headerHidden(spec)) return null;

    return Util.el('div.field-hint.field-inert-note', null, [
      Util.el('span', { text: 'The header is hidden, so none of this is drawn — ' +
        'the label row, the column-group rows and the stubhead are all off.' }),
      Util.el('button.btn.btn-mini.btn-ghost', {
        type: 'button',
        text: 'Go to Columns',
        // `goToPanel`, not `setPanel` — `setPanel` only sets the state, and
        // the one place rail navigation happens is the one that also renders.
        on: { click: () => App.goToPanel('structure') }
      })
    ]);
  },

  /** Every option a row covers — one, or the three of a composite border. */
  rowOptions(row) {
    return row.composite ? row.options : [row.option];
  },

  rowChanged(row, changedKeys) {
    return PanelOptions.rowOptions(row).some((option) => changedKeys.has(option.key));
  },

  rowMatches(row, query, group) {
    if (row.label.toLowerCase().indexOf(query) >= 0) return true;
    if (group.label.toLowerCase().indexOf(query) >= 0) return true;
    return PanelOptions.rowOptions(row).some((option) =>
      option.key.toLowerCase().indexOf(query) >= 0 ||
      option.label.toLowerCase().indexOf(query) >= 0);
  },

  /**
   * The two overrides that keep the tiers honest.
   *
   * A search reaches every tier, so nothing in the 154 is ever unreachable.
   * And an option differing from its default always renders — without that, a
   * theme (which writes the whole option surface) or an opened project could
   * set something the user can neither see nor reset.
   */
  rowVisible(row, query, expert, changedKeys, group) {
    if (query) return PanelOptions.rowMatches(row, query, group);
    if (row.tier !== 'expert') return true;
    return expert || PanelOptions.rowChanged(row, changedKeys);
  },

  /**
   * One row as a labelled field — a single option, or a composite border whose
   * three controls each write their own key.
   *
   * Shared with the Inspector, which renders the basic rows of the selected
   * part's group from here.
   */
  rowField(spec, row, changedKeys) {
    const set = (key) => (value) => {
      Store.update((draft) => { draft.options[key] = value; }, { coalesce: 'opt.' + key });
    };

    let control;
    let title;

    if (row.composite) {
      const byRole = {};
      for (const option of row.options) byRole[option.borderRole] = option;
      control = Controls.borderRow('opt.' + row.id, {
        style: spec.options[byRole.style.key],
        width: spec.options[byRole.width.key],
        color: spec.options[byRole.color.key]
      }, (role, value) => set(byRole[role].key)(value),
      { widthPlaceholder: String(byRole.width.default) });
      title = row.id + '.{style,width,color}';
    } else {
      control = Controls.forOption(row.option, spec.options[row.option.key],
        set(row.option.key));
      title = row.option.key;
    }

    // A border row needs room for style + width + colour swatch + colour text
    // side by side — the two-column field grid only gives the control column
    // 159px (left rail) / 135px (right), not enough for the three of them. A
    // composite row spans the full field width instead; a plain option row
    // keeps the normal label/control split.
    const field = Controls.field(row.label, control,
      { hint: row.hint, title: title, wide: row.composite });

    if (PanelOptions.rowChanged(row, changedKeys)) {
      const label = Util.qs('label', field);
      if (label) {
        label.style.color = 'var(--accent-strong)';
        label.title = PanelOptions.rowOptions(row)
          .filter((option) => changedKeys.has(option.key))
          .map((option) => option.key + '  (changed — default: ' + option.default + ')')
          .join('\n');
      }
    }

    return field;
  },

  /* ================================================================
     Themes
     ================================================================ */

  themeSection(spec) {
    return Controls.section('Themes', [
      Util.el('div.field-hint', {
        text: 'A theme sets the appearance options, and sometimes a rule or two for things options cannot reach, like the text colour on a coloured header. Apply one, then keep editing. ' +
          'Save your own once a table looks the way you want it.'
      }),
      ThemePicker.render(spec)
    ], { key: 'opt.themes' });
  }
};
