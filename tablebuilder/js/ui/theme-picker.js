/**
 * ui/theme-picker.js
 *
 * The theme grid, shared by the Data panel (right after import, where someone
 * who wants "an APA table" is looking) and the Options panel (its full home).
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
    if (!changed) {
      Util.toast('Nothing to save — every option is still at its default', 'error');
      return;
    }

    const label = (window.prompt('Name this theme', spec.meta.name || 'My theme') || '').trim();
    if (!label) return;

    const theme = UserThemes.fromSpec(label, spec);
    if (!UserThemes.save(theme)) return;

    Store.update((draft) => { draft.meta.theme = theme.id; });
    Util.toast('Saved “' + label + '” — ' + changed + ' option(s)', 'ok');
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
