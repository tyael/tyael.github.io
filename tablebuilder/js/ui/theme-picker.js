/**
 * ui/theme-picker.js
 *
 * The theme grid, shared by the Data panel (right after import, where someone
 * who wants "an APA table" is looking) and the Table defaults panel (its full home).
 *
 * Built-ins and saved themes sit in one list; a saved theme differs only in
 * carrying export and delete affordances. Saving, parsing and storage all live
 * in user-themes.js — this file is the surface, not the logic.
 */

const ThemePicker = {

  render(spec) {
    const wrap = Util.el('div');
    const grid = Util.el('div.theme-grid');

    for (const theme of Themes.all()) {
      grid.appendChild(theme.custom
        ? ThemePicker.savedEntry(theme, spec)
        : ThemePicker.applyButton(theme, spec));
    }

    wrap.appendChild(grid);
    wrap.appendChild(Controls.actions([
      Controls.button('Save current look…', () => ThemePicker.saveCurrent(spec), { kind: 'ghost' }),
      Controls.button('Import theme…', () => ThemePicker.importFile(), { kind: 'ghost' })
    ]));

    return wrap;
  },

  applyButton(theme, spec) {
    return Util.el('button.btn' + (spec.meta.theme === theme.id ? '.btn-primary' : ''), {
      type: 'button',
      text: theme.label,
      title: theme.hint || '',
      dataset: { theme: theme.id },
      on: { click: () => Themes.apply(theme.id) }
    });
  },

  /** A saved theme: the same apply button, plus export and delete. */
  savedEntry(theme, spec) {
    return Util.el('div.theme-chip.is-custom', null, [
      ThemePicker.applyButton(theme, spec),
      Util.el('button.btn.btn-mini.btn-ghost', {
        type: 'button',
        text: '↓',
        title: 'Export “' + theme.label + '” as a file',
        dataset: { themeExport: theme.id },
        on: { click: () => ThemePicker.exportOne(theme.id) }
      }),
      Util.el('button.btn.btn-mini.btn-ghost', {
        type: 'button',
        text: '✕',
        title: 'Delete “' + theme.label + '”',
        dataset: { themeDelete: theme.id },
        on: {
          click: () => {
            if (!window.confirm('Delete the theme “' + theme.label + '”?')) return;
            UserThemes.remove(theme.id);
            Util.toast('Deleted “' + theme.label + '”', 'ok');
            App.renderPanels();
          }
        }
      })
    ]);
  },

  saveCurrent(spec) {
    const changed = Object.keys(OptionsSchema.diff(spec.options)).length;
    // Rules are part of the look too. Asking only about options refused to save
    // an italic source note or white ink on a coloured header band — which is
    // the one thing `tab_options()` cannot say, and so the whole reason a theme
    // carries rules at all — on the grounds that there was nothing there.
    const rules = UserThemes.portableRules(spec).length;
    if (!changed && !rules) {
      Util.toast('Nothing to save — every option is still at its default, and no '
        + 'style rule here would travel to another table', 'error');
      return;
    }

    const label = (window.prompt('Name this theme', spec.meta.name || 'My theme') || '').trim();
    if (!label) return;

    const theme = UserThemes.fromSpec(label, spec);
    if (!UserThemes.save(theme)) return;

    Store.update((draft) => { draft.meta.theme = theme.id; });

    // A rule naming a column, a group, a spanner or particular rows cannot
    // survive a change of data, so it does not travel — and the place to find
    // that out is here, not on the next dataset when the look comes back
    // missing something. Named, because "2 rules" is not enough to act on.
    const stuck = UserThemes.unportableRules(spec);
    const parts = [];
    if (changed) parts.push(Util.plural(changed, 'option'));
    if (theme.rules.length) parts.push(Util.plural(theme.rules.length, 'rule'));
    Util.toast('Saved “' + label + '” — ' + parts.join(', '), 'ok');
    if (stuck.length) {
      Util.toast(Util.plural(stuck.length, 'rule') + ' stayed behind — ' +
        stuck.map((rule) => '“' + (rule.label || 'Style rule') + '”').join(', ') +
        ' name columns or rows, which do not carry to another table', 'error');
    }
    App.renderPanels();
  },

  exportOne(id) {
    const theme = UserThemes.get(id);
    if (!theme) return;
    Util.download(Util.slug(theme.label) + '.tabletheme.json',
      UserThemes.toFile(theme), 'application/json');
  },

  importFile() {
    const input = Util.el('input', { type: 'file', accept: '.json,.tabletheme.json' });
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const theme = UserThemes.parse(await Util.readFile(file));
        if (!UserThemes.save(theme)) return;
        Themes.apply(theme.id);
        App.renderPanels();
      } catch (err) {
        Util.toast('Could not import that theme: ' + err.message, 'error');
      }
    });
    input.click();
  }
};
