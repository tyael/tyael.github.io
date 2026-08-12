/**
 * ui/panel-options.js
 *
 * The Options panel: the whole `tab_options()` surface, generated from
 * options-schema.js.
 *
 * Nothing here is written per option — the groups, the controls and the
 * search index all come from the schema. Adding an option to the schema makes
 * it appear here, correctly typed, with no work in this file.
 */

const PanelOptions = {

  id: 'options',
  label: 'Options',

  _query: '',

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
          PanelOptions._query = e.target.value;
          App.renderRail();
        }
      }
    });
    panel.appendChild(Util.el('div', { style: { marginBottom: '10px' } }, [search]));

    const query = PanelOptions._query.trim().toLowerCase();
    const changed = OptionsSchema.diff(spec.options);
    const changedKeys = new Set(Object.keys(changed));

    if (changedKeys.size) {
      panel.appendChild(Util.el('div.field-hint', {
        style: { marginBottom: '8px' },
        text: changedKeys.size + ' option(s) changed from the default.'
      }));
      panel.appendChild(Controls.button('Reset all to defaults', () => {
        if (!window.confirm('Reset every table option to its default?')) return;
        Store.update((draft) => { draft.options = OptionsSchema.defaults(); });
      }, { kind: 'danger', block: true }));
      panel.appendChild(Util.el('div', { style: { height: '10px' } }));
    }

    /* ---- Groups ---- */

    let shown = 0;

    for (const group of OptionsSchema.groups) {
      const options = OptionsSchema.byGroup(group.id).filter((option) => {
        if (!query) return true;
        return option.key.toLowerCase().indexOf(query) >= 0 ||
          option.label.toLowerCase().indexOf(query) >= 0 ||
          group.label.toLowerCase().indexOf(query) >= 0;
      });

      if (!options.length) continue;
      shown += options.length;

      const nodes = [Util.el('div.field-hint', { text: group.hint })];

      for (const option of options) {
        const value = spec.options[option.key];
        const isChanged = changedKeys.has(option.key);

        const field = Controls.field(option.label,
          Controls.forOption(option, value, (next) => {
            Store.update((draft) => { draft.options[option.key] = next; },
              { coalesce: 'opt.' + option.key });
          }),
          { hint: option.hint, title: option.key });

        if (isChanged) {
          const label = Util.qs('label', field);
          if (label) {
            label.style.color = 'var(--accent-bright)';
            label.title = option.key + '  (changed — default: ' + option.default + ')';
          }
        }

        nodes.push(field);
      }

      panel.appendChild(Controls.section(group.label, nodes, {
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
     Themes
     ================================================================ */

  themeSection(spec) {
    return Controls.section('Themes', [
      Util.el('div.field-hint', {
        text: 'A theme is just a bundle of option values — apply one, then keep editing. ' +
          'Save your own once a table looks the way you want it.'
      }),
      ThemePicker.render(spec)
    ], { key: 'opt.themes' });
  }
};
