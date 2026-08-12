/**
 * fonts.js
 *
 * The font registry: the built-in stacks plus whatever fonts the user adds.
 *
 * A font is referenced everywhere by a single id string, so the rest of the app
 * never has to care where the face came from. Three kinds are supported:
 *
 *   google    a family from Google Fonts, named by the user. Loaded into the
 *             preview with a <link>, and inlined as base64 in SVG/PNG exports.
 *   embedded  a font file the user uploaded, carried in the project as a data
 *             URI. Always exports correctly, and needs no network.
 *   stack     a raw CSS font-family value. Renders if the face is installed on
 *             the machine; nothing to embed, so exports name it and rely on the
 *             reader having it too.
 *
 * Custom fonts live in `spec.fonts`, which means they travel with the project
 * file and are available to every exporter.
 */

const Fonts = {

  /** Registry of custom fonts, keyed by id. Rebuilt from the spec on render. */
  _custom: {},

  /** Ids whose face has already been pushed into the document. */
  _loaded: new Set(),

  /** Set when a sync actually loaded something, so the caller can re-render. */
  _pending: false,

  /* ================================================================
     Lookup
     ================================================================ */

  /** Built-in stacks, defined in options-schema.js. */
  builtins() {
    return OptionsSchema.FONT_STACKS;
  },

  /** Every font available to a picker, built-ins first. */
  all() {
    const custom = Object.keys(Fonts._custom).map((id) => Fonts._custom[id]);
    return {
      builtin: Fonts.builtins().map((f) => ({ id: f.id, label: f.label, stack: f.stack, kind: 'builtin' })),
      custom: custom.map((f) => ({ id: f.id, label: f.label || f.family, stack: f.stack, kind: f.kind }))
    };
  },

  /** The font record for an id, or null. */
  get(id) {
    if (!id) return null;
    if (Fonts._custom[id]) return Fonts._custom[id];
    const builtin = Fonts.builtins().find((f) => f.id === id);
    if (!builtin) return null;
    return {
      id: builtin.id, kind: builtin.web ? 'google' : 'stack', label: builtin.label,
      family: builtin.web || null, stack: builtin.stack, builtin: true
    };
  },

  /**
   * Resolve a font reference to a CSS font-family value.
   *
   * Unknown ids that look like a CSS stack are passed straight through, so a
   * hand-edited project file with a literal font-family still works.
   */
  stack(idOrStack) {
    const found = Fonts.get(idOrStack);
    if (found) return found.stack;

    const raw = String(idOrStack || '');
    if (raw.indexOf(',') >= 0 || raw.indexOf('"') >= 0 || raw.indexOf("'") >= 0) return raw;

    return Fonts.builtins()[0].stack;
  },

  /** The Google Fonts family name for an id, or null. */
  webFamily(id) {
    const found = Fonts.get(id);
    return found && found.kind === 'google' && found.family ? found.family : null;
  },

  /** The embedded face for an id, or null. */
  embedded(id) {
    const found = Fonts.get(id);
    if (!found || found.kind !== 'embedded' || !found.dataUrl) return null;
    return { family: found.family, dataUrl: found.dataUrl, format: found.format || 'woff2' };
  },

  /** A human label for an id, for the UI. */
  label(id) {
    const found = Fonts.get(id);
    return found ? (found.label || found.family || found.id) : String(id || '');
  },

  /* ================================================================
     Spec synchronisation
     ================================================================ */

  /**
   * Point the registry at a spec's custom fonts and make sure the browser has
   * every face it needs. Called on every render; cheap after the first time.
   *
   * @returns {boolean} true when something new was loaded, so the caller knows
   *   a re-render will be needed once the face arrives
   */
  sync(spec) {
    Fonts._custom = {};
    Fonts._pending = false;

    const list = (spec && spec.fonts) || [];
    for (const font of list) {
      if (!font || !font.id) continue;
      Fonts._custom[font.id] = font;
      Fonts.ensureLoaded(font);
    }

    return Fonts._pending;
  },

  /** Loads started by this module and not yet settled. */
  _loading: [],

  /** Push a face into the document if it is not there already. */
  ensureLoaded(font) {
    if (Fonts._loaded.has(font.id)) return;
    Fonts._loaded.add(font.id);

    if (font.kind === 'google' && font.family) {
      Fonts._pending = true;
      const link = Util.el('link', {
        rel: 'stylesheet',
        href: Fonts.googleUrl(font.family, font.weights),
        dataset: { fontId: font.id }
      });
      // The stylesheet has to arrive before the browser even knows the face
      // exists, so the link's own load event is part of "ready".
      Fonts._loading.push(new Promise((resolve) => {
        link.onload = resolve;
        link.onerror = () => {
          console.warn('Could not load font stylesheet for "' + font.family + '"');
          resolve();
        };
      }));
      document.head.appendChild(link);
      return;
    }

    if (font.kind === 'embedded' && font.dataUrl && typeof FontFace === 'function') {
      Fonts._pending = true;
      try {
        const face = new FontFace(font.family, 'url(' + font.dataUrl + ')');
        Fonts._loading.push(
          face.load()
            .then((loaded) => { document.fonts.add(loaded); })
            .catch((err) => {
              console.warn('Could not load embedded font "' + font.family + '":', err.message);
            })
        );
      } catch (err) {
        console.warn('Could not register embedded font "' + font.family + '":', err.message);
      }
    }
  },

  /** The Google Fonts CSS2 URL for a family. */
  googleUrl(family, weights) {
    const axis = weights && weights.trim() ? weights.trim() : '400;500;600;700';
    return 'https://fonts.googleapis.com/css2?family=' +
      encodeURIComponent(family).replace(/%20/g, '+') +
      ':ital,wght@' + axis.split(';').map((w) => '0,' + w).join(';') +
      ';' + axis.split(';').map((w) => '1,' + w).join(';') +
      '&display=swap';
  },

  /**
   * Resolve once every face this module started has actually arrived.
   *
   * `document.fonts.ready` alone is not enough: it settles the loads the
   * browser already knows about, and a face registered a moment ago may not be
   * among them yet. Measuring at that point would capture fallback metrics and
   * bake the wrong geometry into an SVG export — silently, because the preview
   * corrects itself a frame later.
   */
  async ready() {
    // Loads can start while we await, so drain until the queue stays empty.
    let guard = 0;
    while (Fonts._loading.length && guard < 10) {
      const batch = Fonts._loading;
      Fonts._loading = [];
      guard += 1;
      await Promise.all(batch);
    }
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  },

  /** True when the browser can actually render this font id right now. */
  isAvailable(id) {
    const font = Fonts.get(id);
    if (!font || !document.fonts || !document.fonts.check) return true;
    const family = font.family || (font.stack || '').split(',')[0].replace(/["']/g, '').trim();
    if (!family) return true;
    try {
      return document.fonts.check('16px ' + Fonts.quote(family));
    } catch (err) {
      return true;
    }
  },

  /* ================================================================
     Creating fonts
     ================================================================ */

  /**
   * Check that a Google family exists, and build a record for it.
   * @returns {Promise<Object>} the font record
   */
  async fromGoogle(family, weights, fallback) {
    const name = String(family || '').trim();
    if (!name) throw new Error('Give the family a name.');

    const response = await fetch(Fonts.googleUrl(name, weights));
    if (!response.ok) {
      throw new Error('Google Fonts does not have a family called “' + name + '”.');
    }

    return {
      id: Fonts.newId(name),
      kind: 'google',
      label: name,
      family: name,
      weights: (weights && weights.trim()) || '400;500;600;700',
      fallback: fallback || null,
      stack: Fonts.quote(name) + ', ' + Fonts.fallbackFor(name, fallback)
    };
  },

  /** A record for a locally installed face, or any hand-written CSS stack. */
  fromStack(label, stack) {
    const name = String(label || '').trim();
    const value = String(stack || '').trim();
    if (!name) throw new Error('Give the font a name.');
    if (!value) throw new Error('Give the font a CSS font-family value.');

    return {
      id: Fonts.newId(name),
      kind: 'stack',
      label: name,
      family: name,
      stack: value
    };
  },

  /**
   * A record for an uploaded font file, carrying the file itself as a data URI
   * so the project stays self-contained and the exports always have the face.
   */
  async fromFile(file, label, fallback) {
    const format = Fonts.formatOf(file.name);
    if (!format) {
      throw new Error('Use a .woff2, .woff, .ttf or .otf file.');
    }
    if (file.size > 6 * 1024 * 1024) {
      throw new Error('That file is ' + Math.round(file.size / 1024 / 1024) +
        ' MB. Fonts are stored inside the project file, so keep them under 6 MB — ' +
        'a .woff2 of the weights you need is usually well under 100 kB.');
    }

    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.readAsDataURL(file);
    });

    const name = String(label || '').trim() || file.name.replace(/\.[^.]+$/, '');

    return {
      id: Fonts.newId(name),
      kind: 'embedded',
      label: name,
      family: name,
      format: format,
      fileName: file.name,
      bytes: file.size,
      fallback: fallback || null,
      dataUrl: dataUrl,
      stack: Fonts.quote(name) + ', ' + Fonts.fallbackFor(name, fallback)
    };
  },

  /** Font formats a browser will actually load. */
  formatOf(filename) {
    const ext = String(filename).toLowerCase().split('.').pop();
    switch (ext) {
      case 'woff2': return 'woff2';
      case 'woff': return 'woff';
      case 'ttf': return 'truetype';
      case 'otf': return 'opentype';
      default: return null;
    }
  },

  /** The fallback stacks offered when adding a font. */
  FALLBACKS: [
    { id: 'serif', label: 'Serif', stack: 'Georgia, "Times New Roman", serif' },
    { id: 'sans', label: 'Sans-serif', stack: '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
    { id: 'mono', label: 'Monospace', stack: 'ui-monospace, Menlo, Consolas, monospace' }
  ],

  /**
   * The stack to sit behind a font, used while a webfont loads and if it never
   * does. `kind` is chosen by the user; without one, the family name is
   * guessed at — which is only a starting point, since a name like "Playfair
   * Display" gives nothing away about being a serif.
   */
  fallbackFor(family, kind) {
    if (kind) {
      const chosen = Fonts.FALLBACKS.find((f) => f.id === kind);
      if (chosen) return chosen.stack;
    }

    const name = String(family).toLowerCase();
    if (/mono|code|courier|consol/.test(name)) return Fonts.FALLBACKS[2].stack;
    if (/serif|garamond|baskerville|caslon|georgia|times|minion|roman|book|libre|playfair|spectral|lora|merriweather|crimson/.test(name) &&
        !/sans/.test(name)) {
      return Fonts.FALLBACKS[0].stack;
    }
    return Fonts.FALLBACKS[1].stack;
  },

  /** Which fallback family a stack is using, for round-tripping the UI. */
  fallbackKindOf(stack) {
    const found = Fonts.FALLBACKS.find((f) => String(stack).indexOf(f.stack) >= 0);
    return found ? found.id : null;
  },

  /** Quote a family name for CSS when it needs it. */
  quote(family) {
    return /^[A-Za-z][A-Za-z0-9]*$/.test(family) ? family : '"' + family + '"';
  },

  newId(name) {
    return 'font_' + Util.slug(name).slice(0, 20) + '_' + Math.random().toString(36).slice(2, 6);
  },

  /* ================================================================
     Locally installed fonts
     ================================================================ */

  /** True when this browser can enumerate installed fonts (Chromium only). */
  canQueryLocal() {
    return typeof window.queryLocalFonts === 'function';
  },

  /**
   * The families installed on this machine. Requires a permission prompt, and
   * is unavailable in Firefox and Safari — callers must handle rejection.
   */
  async queryLocal() {
    if (!Fonts.canQueryLocal()) {
      throw new Error('This browser cannot list installed fonts. Type the family name instead.');
    }
    const faces = await window.queryLocalFonts();
    const families = Util.unique(faces.map((f) => f.family)).sort((a, b) => a.localeCompare(b));
    return families;
  },

  /* ================================================================
     Export helpers
     ================================================================ */

  /** Every font id a spec actually references. */
  usedIds(spec) {
    const ids = new Set();
    if (spec.options && spec.options['table.font.names']) ids.add(spec.options['table.font.names']);
    for (const rule of spec.styleRules || []) {
      if (rule.style && rule.style.text && rule.style.text.font) ids.add(rule.style.text.font);
    }
    return Array.from(ids);
  },

  /**
   * `@font-face` CSS with the binary inlined, for a single font id.
   *
   * Google families are fetched and base64-encoded; embedded fonts already
   * carry their data URI; `stack` fonts have nothing to inline and return ''.
   */
  async faceCss(id) {
    const local = Fonts.embedded(id);
    if (local) {
      return '  @font-face {\n' +
        '    font-family: ' + Fonts.quote(local.family) + ';\n' +
        '    src: url(' + local.dataUrl + ') format("' + local.format + '");\n' +
        '  }';
    }

    const family = Fonts.webFamily(id);
    if (!family) return '';
    return await Fonts.embedGoogle(family, (Fonts.get(id) || {}).weights);
  },

  /** Cache of family -> inlined @font-face blocks. */
  _googleCache: {},

  /**
   * Fetch a Google family and inline each face as base64.
   *
   * Google serves both the stylesheet and the font files with permissive CORS,
   * so this works straight from the browser. Only the latin subset is taken —
   * the full set would add megabytes for no benefit in a table.
   */
  async embedGoogle(family, weights) {
    const key = family + '|' + (weights || '');
    if (Fonts._googleCache[key]) return Fonts._googleCache[key];

    const cssResponse = await fetch(Fonts.googleUrl(family, weights));
    if (!cssResponse.ok) throw new Error('stylesheet HTTP ' + cssResponse.status);
    const css = await cssResponse.text();

    const blocks = css.split('@font-face').slice(1);
    const out = [];

    for (const block of blocks) {
      const urlMatch = block.match(/url\((https:\/\/[^)]+\.woff2)\)/);
      if (!urlMatch) continue;

      const rangeMatch = block.match(/unicode-range:\s*([^;]+);/);
      if (rangeMatch && rangeMatch[1].indexOf('U+0000-00FF') < 0) continue;

      const weight = (block.match(/font-weight:\s*([^;]+);/) || [, '400'])[1].trim();
      const style = (block.match(/font-style:\s*([^;]+);/) || [, 'normal'])[1].trim();

      const fontResponse = await fetch(urlMatch[1]);
      if (!fontResponse.ok) continue;

      out.push(
        '  @font-face {\n' +
        '    font-family: "' + family + '";\n' +
        '    font-style: ' + style + ';\n' +
        '    font-weight: ' + weight + ';\n' +
        '    src: url(data:font/woff2;charset=utf-8;base64,' +
        Fonts.base64(await fontResponse.arrayBuffer()) + ') format("woff2");\n' +
        '  }'
      );
    }

    const result = out.join('\n');
    Fonts._googleCache[key] = result;
    return result;
  },

  /** ArrayBuffer to base64, chunked so large fonts do not blow the call stack. */
  base64(buffer) {
    const bytes = new Uint8Array(buffer);
    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  },

  /**
   * The `<link>` and `@font-face` markup a standalone HTML export needs.
   * @returns {{links: string, faces: string}}
   */
  htmlResources(spec) {
    const links = [];
    const faces = [];

    for (const id of Fonts.usedIds(spec)) {
      const family = Fonts.webFamily(id);
      if (family) {
        links.push('  <link href="' + Util.escapeHtml(Fonts.googleUrl(family, (Fonts.get(id) || {}).weights)) +
          '" rel="stylesheet">');
        continue;
      }
      const local = Fonts.embedded(id);
      if (local) {
        faces.push('    @font-face {\n' +
          '      font-family: ' + Fonts.quote(local.family) + ';\n' +
          '      src: url(' + local.dataUrl + ') format("' + local.format + '");\n' +
          '    }');
      }
    }

    return {
      links: links.length
        ? '  <link rel="preconnect" href="https://fonts.googleapis.com">\n' +
          '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
          links.join('\n') + '\n'
        : '',
      faces: faces.join('\n')
    };
  }
};
