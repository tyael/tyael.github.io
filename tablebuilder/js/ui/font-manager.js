/**
 * ui/font-manager.js
 *
 * The "add a font" dialogue, and the list of fonts already added.
 *
 * Three routes in, because no single one covers every case:
 *
 *   Google Fonts   type a family name. Widest choice, and it embeds cleanly in
 *                  every export — the best option unless the journal insists on
 *                  a specific licensed face.
 *   Installed      name a face on this machine. Renders here and in the SVG for
 *                  anyone who also has it, but nothing can be embedded.
 *   Font file      upload .woff2/.woff/.ttf/.otf. Always exports correctly and
 *                  needs no network, at the cost of size in the project file.
 */

const FontManager = {

  _onPick: null,

  /** Open the dialogue. `onPick` receives the new font's id. */
  open(onPick) {
    FontManager._onPick = onPick || null;
    App.showModal('Fonts', FontManager.build());
  },

  build() {
    const wrap = Util.el('div');
    wrap.appendChild(FontManager.googleSection());
    wrap.appendChild(FontManager.installedSection());
    wrap.appendChild(FontManager.fileSection());
    wrap.appendChild(FontManager.listSection());
    return wrap;
  },

  /** Rebuild the dialogue in place after adding or removing a font. */
  refresh() {
    const body = Util.qs('#modal-body');
    if (!body) return;
    Util.clear(body);
    body.appendChild(FontManager.build());
  },

  /* ================================================================
     Google Fonts
     ================================================================ */

  googleSection() {
    const name = Util.el('input', {
      type: 'text',
      placeholder: 'e.g. Playfair Display, Spectral, Lora, Source Sans 3',
      dataset: { ctl: 'fm.google.name' }
    });
    const weights = Util.el('input', {
      type: 'text',
      value: '400;500;600;700',
      dataset: { ctl: 'fm.google.weights' }
    });
    const fallback = FontManager.fallbackSelect('fm.google.fallback');
    const status = Util.el('div.field-hint');
    const preview = FontManager.previewNode();

    const add = async () => {
      status.textContent = 'Checking with Google Fonts…';
      status.style.color = '';
      try {
        const font = await Fonts.fromGoogle(name.value, weights.value, fallback.value);
        FontManager.commit(font);
      } catch (err) {
        status.textContent = err.message;
        status.style.color = 'var(--danger)';
      }
    };

    // Live preview: load the family as the user types, then render the sample.
    const tryPreview = Util.debounce(async () => {
      const family = name.value.trim();
      if (family.length < 3) { preview.style.fontFamily = ''; return; }
      try {
        const url = Fonts.googleUrl(family, weights.value);
        const response = await fetch(url);
        if (!response.ok) { status.textContent = ''; preview.style.fontFamily = ''; return; }
        if (!Util.qs('link[data-preview-font="' + CSS.escape(family) + '"]')) {
          document.head.appendChild(Util.el('link', {
            rel: 'stylesheet', href: url, dataset: { previewFont: family }
          }));
        }
        await Fonts.ready();
        preview.style.fontFamily = Fonts.quote(family) + ', ' + Fonts.fallbackFor(family, fallback.value);
        status.textContent = '“' + family + '” found.';
        status.style.color = 'var(--ok)';
      } catch (err) {
        preview.style.fontFamily = '';
      }
    }, 450);

    name.addEventListener('input', tryPreview);
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

    return Controls.section('From Google Fonts', [
      Util.el('div.field-hint', {
        text: 'Around 1,500 families, all free to use. The face is inlined into SVG and PNG ' +
          'exports, so the file carries its own typeface.'
      }),
      Controls.field('Family', name),
      Controls.field('Weights', weights, { hint: 'Semicolon-separated. Fewer weights means smaller exports.' }),
      Controls.field('Falls back to', fallback,
        { hint: 'What a reader sees while the font loads, or if it never does. Match the shape of the face.' }),
      preview,
      status,
      Controls.actions([
        Controls.button('Add font', add, { kind: 'primary' }),
        Controls.button('Browse fonts.google.com', () => {
          window.open('https://fonts.google.com/', '_blank', 'noopener');
        }, { kind: 'ghost' })
      ])
    ], { key: 'fm.google' });
  },

  /* ================================================================
     Installed fonts
     ================================================================ */

  installedSection() {
    const label = Util.el('input', {
      type: 'text',
      placeholder: 'e.g. Minion Pro',
      dataset: { ctl: 'fm.local.name' }
    });
    const stack = Util.el('input', {
      type: 'text',
      placeholder: '"Minion Pro", Georgia, serif',
      dataset: { ctl: 'fm.local.stack' }
    });
    const fallback = FontManager.fallbackSelect('fm.local.fallback');
    const status = Util.el('div.field-hint');
    const preview = FontManager.previewNode();

    const rebuildStack = () => {
      const name = label.value.trim();
      if (!name || stack.dataset.touched) return;
      stack.value = Fonts.quote(name) + ', ' + Fonts.fallbackFor(name, fallback.value);
      preview.style.fontFamily = stack.value;
    };

    label.addEventListener('input', rebuildStack);
    fallback.addEventListener('change', rebuildStack);
    stack.addEventListener('input', () => {
      stack.dataset.touched = '1';
      preview.style.fontFamily = stack.value;
    });

    const nodes = [
      Util.el('div.field-hint', {
        text: 'Use a face installed on this machine. It renders here and in exports for anyone ' +
          'who also has it — but nothing can be embedded, so a reader without the font sees the fallback.'
      }),
      Controls.field('Name', label),
      Controls.field('Falls back to', fallback),
      Controls.field('CSS stack', stack, { hint: 'The fallbacks after the comma are what a reader without the font gets.' }),
      preview,
      status
    ];

    // Chromium can list installed families behind a permission prompt; Firefox
    // and Safari cannot, so this only appears where it will work.
    if (Fonts.canQueryLocal()) {
      const picker = Util.el('div');
      nodes.push(Controls.button('List installed fonts…', async () => {
        status.textContent = 'Waiting for permission…';
        status.style.color = '';
        try {
          const families = await Fonts.queryLocal();
          FontManager.fillLocalPicker(picker, families, (family) => {
            label.value = family;
            stack.value = Fonts.quote(family) + ', ' + Fonts.fallbackFor(family, fallback.value);
            stack.dataset.touched = '1';
            preview.style.fontFamily = stack.value;
            status.textContent = 'Picked “' + family + '”.';
          });
          status.textContent = families.length + ' families found.';
        } catch (err) {
          status.textContent = err.message;
          status.style.color = 'var(--danger)';
        }
      }, { kind: 'ghost' }));
      nodes.push(picker);
    } else {
      nodes.push(Util.el('div.field-hint', {
        text: 'This browser cannot list your installed fonts, so type the family name exactly as ' +
          'the system knows it.'
      }));
    }

    nodes.push(Controls.actions([
      Controls.button('Add font', () => {
        try {
          FontManager.commit(Fonts.fromStack(label.value, stack.value));
        } catch (err) {
          status.textContent = err.message;
          status.style.color = 'var(--danger)';
        }
      }, { kind: 'primary' })
    ]));

    return Controls.section('An installed font', nodes, { key: 'fm.local', collapsed: true });
  },

  /** Fill a container with a filterable list of installed families. */
  fillLocalPicker(host, families, onPick) {
    Util.clear(host);

    const filter = Util.el('input', { type: 'search', placeholder: 'Filter…', style: { marginTop: '6px' } });
    const list = Util.el('div', {
      style: {
        maxHeight: '220px', overflowY: 'auto', border: '1px solid var(--border-subtle)',
        borderRadius: '3px', marginTop: '4px'
      }
    });

    const draw = () => {
      Util.clear(list);
      const needle = filter.value.trim().toLowerCase();
      const shown = families.filter((f) => !needle || f.toLowerCase().indexOf(needle) >= 0);
      for (const family of shown.slice(0, 300)) {
        list.appendChild(Util.el('div', {
          text: family,
          style: {
            padding: '4px 8px', cursor: 'pointer',
            fontFamily: Fonts.quote(family) + ', sans-serif',
            borderBottom: '1px solid var(--border-subtle)'
          },
          on: { click: () => onPick(family) }
        }));
      }
      if (shown.length > 300) {
        list.appendChild(Util.el('div.field-hint', {
          text: (shown.length - 300) + ' more — narrow the filter.', style: { padding: '4px 8px' }
        }));
      }
    };

    filter.addEventListener('input', draw);
    host.appendChild(filter);
    host.appendChild(list);
    draw();
  },

  /* ================================================================
     Uploaded font file
     ================================================================ */

  fileSection() {
    const input = Util.el('input', { type: 'file', accept: '.woff2,.woff,.ttf,.otf' });
    const label = Util.el('input', { type: 'text', placeholder: 'Name (defaults to the filename)' });
    const fallback = FontManager.fallbackSelect('fm.file.fallback');
    const status = Util.el('div.field-hint');

    return Controls.section('A font file', [
      Util.el('div.field-hint', {
        text: 'The file is stored inside the project, so the design and its typeface stay together ' +
          'and every export is self-contained. A .woff2 of just the weights you need is usually ' +
          'well under 100 kB.'
      }),
      Controls.field('File', input),
      Controls.field('Name', label),
      Controls.field('Falls back to', fallback),
      status,
      Controls.actions([
        Controls.button('Add font', async () => {
          const file = input.files && input.files[0];
          if (!file) {
            status.textContent = 'Choose a file first.';
            status.style.color = 'var(--danger)';
            return;
          }
          status.textContent = 'Reading ' + file.name + '…';
          status.style.color = '';
          try {
            FontManager.commit(await Fonts.fromFile(file, label.value, fallback.value));
          } catch (err) {
            status.textContent = err.message;
            status.style.color = 'var(--danger)';
          }
        }, { kind: 'primary' })
      ])
    ], { key: 'fm.file', collapsed: true });
  },

  /* ================================================================
     Existing custom fonts
     ================================================================ */

  listSection() {
    const spec = Store.get();
    const fonts = spec.fonts || [];

    const KIND_LABEL = {
      google: 'Google Fonts · embeds in exports',
      embedded: 'uploaded file · embeds in exports',
      stack: 'installed font · not embeddable'
    };

    const list = Controls.itemList(fonts, (font) => Util.el('div', null, [
      Util.el('div', {
        text: 'Handgloves 0123 — The quick brown fox',
        style: { fontFamily: font.stack, fontSize: '17px', padding: '4px 0' }
      }),
      Util.el('div.item-sub', { text: font.stack })
    ]), {
      key: 'fm.list',
      title: (font) => font.label || font.family,
      subtitle: (font) => (KIND_LABEL[font.kind] || font.kind) +
        (font.bytes ? ' · ' + Math.round(font.bytes / 1024) + ' kB' : ''),
      onRemove: (font) => FontManager.remove(font),
      emptyText: 'no fonts added yet'
    });

    return Controls.section('Your fonts (' + fonts.length + ')', [
      list,
      Controls.actions([
        Controls.button('Done', () => App.closeModal(), { kind: 'primary' })
      ])
    ], { key: 'fm.list.section' });
  },

  /* ================================================================
     Commit and remove
     ================================================================ */

  /** Store a new font, select it, and close. */
  commit(font) {
    Store.update((draft) => {
      if (!Array.isArray(draft.fonts)) draft.fonts = [];
      draft.fonts.push(font);
    });

    Fonts.sync(Store.get());

    if (FontManager._onPick) {
      const pick = FontManager._onPick;
      FontManager._onPick = null;
      pick(font.id);
    }

    // Re-render once the face has actually arrived, so the preview is measured
    // against the real metrics rather than the fallback.
    Fonts.ready().then(() => App.render());

    App.closeModal();
    Util.toast('Added “' + (font.label || font.family) + '”', 'ok');
  },

  /**
   * Remove a font, moving anything still using it back to a built-in so the
   * table never ends up pointing at a font that is not there.
   */
  remove(font) {
    const spec = Store.get();
    const inUse = Fonts.usedIds(spec).indexOf(font.id) >= 0;

    if (inUse && !window.confirm(
      '“' + (font.label || font.family) + '” is in use.\n\n' +
      'Remove it and fall back to the system stack?')) {
      return;
    }

    Store.update((draft) => {
      draft.fonts = (draft.fonts || []).filter((f) => f.id !== font.id);

      const fallback = OptionsSchema.get('table.font.names').default;
      if (draft.options['table.font.names'] === font.id) {
        draft.options['table.font.names'] = fallback;
      }
      for (const rule of draft.styleRules) {
        if (rule.style && rule.style.text && rule.style.text.font === font.id) {
          delete rule.style.text.font;
        }
      }
    });

    Fonts.sync(Store.get());
    FontManager.refresh();
  },

  /* ================================================================
     Shared bits
     ================================================================ */

  /** The serif / sans / mono fallback picker shared by all three routes. */
  fallbackSelect(key) {
    return Controls.select(key,
      Fonts.FALLBACKS.map((f) => ({ value: f.id, label: f.label })), 'serif', () => {});
  },

  previewNode() {
    return Util.el('div', {
      text: 'Handgloves 0123 — Table 1. Effect of the intervention',
      style: {
        fontSize: '19px', padding: '8px 10px', marginTop: '6px',
        background: '#ffffff', color: '#111111', borderRadius: '3px',
        border: '1px solid var(--border-subtle)', overflow: 'hidden',
        whiteSpace: 'nowrap', textOverflow: 'ellipsis'
      }
    });
  }
};
