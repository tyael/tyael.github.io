/**
 * palettes.js
 *
 * Colour parsing, interpolation, contrast and the named palettes offered by
 * data_color. Also used by the inspector's colour controls.
 *
 * Any CSS colour string is accepted. Parsing goes through a 1×1 canvas, which
 * normalises named colours, hsl(), rgb() and every hex form without needing a
 * lookup table of its own.
 */

const Palettes = {

  /* ---------- Named palettes ---------- */

  sequential: {
    viridis: ['#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c', '#28ae80', '#5ec962', '#addc30', '#fde725'],
    magma: ['#000004', '#1c1044', '#4f127b', '#812581', '#b5367a', '#e55964', '#fb8761', '#fec287', '#fcfdbf'],
    plasma: ['#0d0887', '#47039f', '#7301a8', '#9c179e', '#bd3786', '#d8576b', '#ed7953', '#fa9e3b', '#f0f921'],
    inferno: ['#000004', '#1b0c41', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fb9b06', '#fcffa4'],
    cividis: ['#00224e', '#123570', '#3b496c', '#575d6d', '#707173', '#8a8678', '#a59c74', '#c3b369', '#fee838'],
    Blues: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#08519c', '#08306b'],
    Greens: ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#006d2c', '#00441b'],
    Reds: ['#fff5f0', '#fee0d2', '#fcbba1', '#fc9272', '#fb6a4a', '#ef3b2c', '#cb181d', '#a50f15', '#67000d'],
    Oranges: ['#fff5eb', '#fee6ce', '#fdd0a2', '#fdae6b', '#fd8d3c', '#f16913', '#d94801', '#a63603', '#7f2704'],
    Purples: ['#fcfbfd', '#efedf5', '#dadaeb', '#bcbddc', '#9e9ac8', '#807dba', '#6a51a3', '#54278f', '#3f007d'],
    Greys: ['#ffffff', '#f0f0f0', '#d9d9d9', '#bdbdbd', '#969696', '#737373', '#525252', '#252525', '#000000'],
    YlGnBu: ['#ffffd9', '#edf8b1', '#c7e9b4', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8', '#253494', '#081d58'],
    YlOrRd: ['#ffffcc', '#ffeda0', '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#bd0026', '#800026']
  },

  diverging: {
    RdBu: ['#67001f', '#b2182b', '#d6604d', '#f4a582', '#fddbc7', '#f7f7f7', '#d1e5f0', '#92c5de', '#4393c3', '#2166ac', '#053061'],
    BrBG: ['#543005', '#8c510a', '#bf812d', '#dfc27d', '#f6e8c3', '#f5f5f5', '#c7eae5', '#80cdc1', '#35978f', '#01665e', '#003c30'],
    PiYG: ['#8e0152', '#c51b7d', '#de77ae', '#f1b6da', '#fde0ef', '#f7f7f7', '#e6f5d0', '#b8e186', '#7fbc41', '#4d9221', '#276419'],
    RdYlBu: ['#a50026', '#d73027', '#f46d43', '#fdae61', '#fee090', '#ffffbf', '#e0f3f8', '#abd9e9', '#74add1', '#4575b4', '#313695'],
    RdYlGn: ['#a50026', '#d73027', '#f46d43', '#fdae61', '#fee08b', '#ffffbf', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850', '#006837'],
    Spectral: ['#9e0142', '#d53e4f', '#f46d43', '#fdae61', '#fee08b', '#ffffbf', '#e6f598', '#abdda4', '#66c2a5', '#3288bd', '#5e4fa2']
  },

  qualitative: {
    'Okabe-Ito': ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7', '#000000'],
    Tableau10: ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'],
    Set2: ['#66c2a5', '#fc8d62', '#8da0cb', '#e78ac3', '#a6d854', '#ffd92f', '#e5c494', '#b3b3b3'],
    Dark2: ['#1b9e77', '#d95f02', '#7570b3', '#e7298a', '#66a61e', '#e6ab02', '#a6761d', '#666666'],
    Paired: ['#a6cee3', '#1f78b4', '#b2df8a', '#33a02c', '#fb9a99', '#e31a1c', '#fdbf6f', '#ff7f00', '#cab2d6', '#6a3d9a'],
    Pastel: ['#b3e2cd', '#fdcdac', '#cbd5e8', '#f4cae4', '#e6f5c9', '#fff2ae', '#f1e2cc', '#cccccc']
  },

  /** All palettes as a flat list of {id, kind, colors}, for pickers. */
  all() {
    const out = [];
    for (const kind of ['sequential', 'diverging', 'qualitative']) {
      for (const id in Palettes[kind]) {
        out.push({ id: id, kind: kind, colors: Palettes[kind][id] });
      }
    }
    return out;
  },

  /** Look a palette up by name across all kinds. */
  byName(name) {
    return Palettes.sequential[name] || Palettes.diverging[name] ||
      Palettes.qualitative[name] || Palettes.sequential.Blues;
  },

  /** True when the named palette is diverging (so it wants a midpoint). */
  isDiverging(name) {
    return Object.prototype.hasOwnProperty.call(Palettes.diverging, name);
  },

  /* ---------- Parsing ---------- */

  _ctx: null,
  _cache: {},

  /** Lazily created 1×1 canvas used to normalise arbitrary CSS colours. */
  _context() {
    if (!Palettes._ctx) {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      Palettes._ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    return Palettes._ctx;
  },

  /**
   * Parse any CSS colour to {r, g, b, a} with 0–255 channels and 0–1 alpha.
   * Returns null for 'transparent', '', 'none' and anything unparseable.
   */
  parse(color) {
    if (!color) return null;
    const key = String(color).trim();
    if (!key || key === 'none' || key === 'transparent' || key === 'NA') return null;
    if (Object.prototype.hasOwnProperty.call(Palettes._cache, key)) return Palettes._cache[key];

    let out = null;

    // Fast path for the hex forms, which are the overwhelming majority here.
    const hex = key.match(/^#([0-9a-f]{3,8})$/i);
    if (hex) {
      const h = hex[1];
      if (h.length === 3 || h.length === 4) {
        out = {
          r: parseInt(h[0] + h[0], 16),
          g: parseInt(h[1] + h[1], 16),
          b: parseInt(h[2] + h[2], 16),
          a: h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1
        };
      } else if (h.length === 6 || h.length === 8) {
        out = {
          r: parseInt(h.slice(0, 2), 16),
          g: parseInt(h.slice(2, 4), 16),
          b: parseInt(h.slice(4, 6), 16),
          a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
        };
      }
    }

    if (!out) {
      const rgb = key.match(/^rgba?\(([^)]+)\)$/i);
      if (rgb) {
        const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
        if (parts.length >= 3) {
          const channel = (p) => p.indexOf('%') >= 0 ? Math.round(parseFloat(p) * 2.55) : parseFloat(p);
          out = {
            r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]),
            a: parts.length > 3 ? (parts[3].indexOf('%') >= 0 ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) : 1
          };
        }
      }
    }

    if (!out) {
      // Everything else — named colours, hsl(), lab(), colour functions — goes
      // through the canvas, which returns a normalised rgba() string.
      try {
        const ctx = Palettes._context();
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000000';
        ctx.fillStyle = key;
        const normalised = ctx.fillStyle;
        if (normalised !== key && /^#|^rgb/.test(normalised)) {
          out = Palettes.parse(normalised);
        } else {
          ctx.fillStyle = key;
          ctx.fillRect(0, 0, 1, 1);
          const data = ctx.getImageData(0, 0, 1, 1).data;
          out = { r: data[0], g: data[1], b: data[2], a: data[3] / 255 };
        }
      } catch (err) {
        out = null;
      }
    }

    if (out) {
      out.r = Util.clamp(Math.round(out.r), 0, 255);
      out.g = Util.clamp(Math.round(out.g), 0, 255);
      out.b = Util.clamp(Math.round(out.b), 0, 255);
      out.a = Util.clamp(isFinite(out.a) ? out.a : 1, 0, 1);
    }

    Palettes._cache[key] = out;
    return out;
  },

  /* ---------- Formatting ---------- */

  /** {r,g,b,a} to '#rrggbb' (alpha dropped). */
  toHex(rgb) {
    if (!rgb) return '#000000';
    const hex = (n) => Util.clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
    return '#' + hex(rgb.r) + hex(rgb.g) + hex(rgb.b);
  },

  /** {r,g,b,a} to a CSS string, using rgba() only when it has to. */
  toCss(rgb) {
    if (!rgb) return 'transparent';
    if (rgb.a >= 1) return Palettes.toHex(rgb);
    const round = (n) => Util.clamp(Math.round(n), 0, 255);
    return 'rgba(' + round(rgb.r) + ',' + round(rgb.g) + ',' + round(rgb.b) + ',' +
      Math.round(rgb.a * 1000) / 1000 + ')';
  },

  /** Normalise any CSS colour to '#rrggbb', for `<input type="color">`. */
  toHexInput(color, fallback) {
    const rgb = Palettes.parse(color);
    return rgb ? Palettes.toHex(rgb) : (fallback || '#000000');
  },

  /** Apply an alpha multiplier to a colour, returning a CSS string. */
  withAlpha(color, alpha) {
    const rgb = Palettes.parse(color);
    if (!rgb) return 'transparent';
    return Palettes.toCss({ r: rgb.r, g: rgb.g, b: rgb.b, a: rgb.a * Util.clamp(alpha, 0, 1) });
  },

  /* ---------- Interpolation ---------- */

  /** Linear mix of two colours; t = 0 gives a, t = 1 gives b. */
  /*
   * sRGB <-> CIE Lab, D65.
   *
   * **Because gt interpolates in Lab and we have to paint the same colour.**
   * `scales::colour_ramp`, which `data_color()` builds on, converts to Lab
   * before mixing; blending the channels straight is a different ramp, and
   * visibly so — black to white lands on `#808080` in RGB and `#777777` in
   * Lab, and a two-stop custom ramp drifted by six or seven steps per channel
   * in the middle. Same picture on screen and in the exported table is the
   * whole contract, so this follows gt rather than being simpler.
   */
  toLab(rgb) {
    const lin = (v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const r = lin(rgb.r);
    const g = lin(rgb.g);
    const b = lin(rgb.b);
    // D65 white point.
    const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
    const y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b);
    const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
    const f = (t) => (t > 0.008856451679035631 ? Math.cbrt(t) : (903.2962962962963 * t + 16) / 116);
    const fx = f(x);
    const fy = f(y);
    const fz = f(z);
    return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  },

  fromLab(lab) {
    const fy = (lab.L + 16) / 116;
    const fx = fy + lab.a / 500;
    const fz = fy - lab.b / 200;
    const inv = (t) => {
      const cube = t * t * t;
      return cube > 0.008856451679035631 ? cube : (116 * t - 16) / 903.2962962962963;
    };
    const x = inv(fx) * 0.95047;
    const y = (lab.L > 8 ? Math.pow(fy, 3) : lab.L / 903.2962962962963);
    const z = inv(fz) * 1.08883;

    const r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
    const g = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z;
    const b = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
    const out = (v) => {
      const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
      return Util.clamp(c * 255, 0, 255);
    };
    return { r: out(r), g: out(g), b: out(b) };
  },

  /** Blend two colours, in Lab, the way `scales::colour_ramp` does. */
  mix(a, b, t) {
    const ca = Palettes.parse(a) || { r: 0, g: 0, b: 0, a: 1 };
    const cb = Palettes.parse(b) || { r: 0, g: 0, b: 0, a: 1 };
    const k = Util.clamp(t, 0, 1);
    if (k <= 0) return Object.assign({}, ca);
    if (k >= 1) return Object.assign({}, cb);

    const la = Palettes.toLab(ca);
    const lb = Palettes.toLab(cb);
    const blended = Palettes.fromLab({
      L: la.L + (lb.L - la.L) * k,
      a: la.a + (lb.a - la.a) * k,
      b: la.b + (lb.b - la.b) * k
    });
    // Alpha is not a colour and stays linear.
    blended.a = ca.a + (cb.a - ca.a) * k;
    return blended;
  },

  /**
   * Sample a palette at t in [0, 1]. Interpolates between the palette's stops,
   * so a 9-stop palette still gives a smooth ramp.
   */
  sample(colors, t) {
    if (!colors || !colors.length) return { r: 0, g: 0, b: 0, a: 1 };
    if (colors.length === 1) return Palettes.parse(colors[0]);

    const k = Util.clamp(t, 0, 1);
    const scaled = k * (colors.length - 1);
    const lower = Math.floor(scaled);
    const upper = Math.min(colors.length - 1, lower + 1);
    return Palettes.mix(colors[lower], colors[upper], scaled - lower);
  },

  /** N evenly spaced samples from a palette, as CSS strings. */
  ramp(colors, n) {
    if (n <= 1) return [Palettes.toCss(Palettes.sample(colors, 0.5))];
    const out = [];
    for (let i = 0; i < n; i += 1) {
      out.push(Palettes.toCss(Palettes.sample(colors, i / (n - 1))));
    }
    return out;
  },

  /* ---------- Contrast ---------- */

  /** WCAG relative luminance, 0 (black) to 1 (white). */
  luminance(color) {
    const rgb = Palettes.parse(color);
    if (!rgb) return 1;   // treat "no fill" as paper white
    const channel = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  },

  /** WCAG contrast ratio between two colours, 1 to 21. */
  contrast(a, b) {
    const la = Palettes.luminance(a);
    const lb = Palettes.luminance(b);
    const light = Math.max(la, lb);
    const dark = Math.min(la, lb);
    return (light + 0.05) / (dark + 0.05);
  },

  /**
   * APCA-W3 lightness contrast (Lc), the algorithm gt reaches for by default.
   *
   * **Not a refinement of the WCAG ratio — a different answer.** Of twenty
   * ordinary fills, the two disagree about which text colour to use on eight:
   * mid greys, most saturated mid-tones, and every teal. WCAG says black on
   * `#767676`, APCA says white. So exposing the choice means implementing
   * this, not approximating it, or the preview and the exported table paint
   * different text.
   *
   * The constants are APCA-W3 0.1.9. Every one of those twenty was checked
   * against what real gt actually emitted, both ways round — see the R suite.
   *
   * @returns {number} Lc, signed: positive for dark text on light, negative
   *   for light on dark. Callers compare magnitudes.
   */
  apca(text, background) {
    const TRC = 2.4;
    const BLACK_THRESHOLD = 0.022;
    const BLACK_CLAMP = 1.414;
    const y = (color) => {
      const rgb = Palettes.parse(color);
      if (!rgb) return 1;
      const ch = (v) => Math.pow(v / 255, TRC);
      const raw = 0.2126729 * ch(rgb.r) + 0.7151522 * ch(rgb.g) + 0.0721750 * ch(rgb.b);
      // Soft-clamp the near-black end, where the power curve stops modelling
      // how flare makes dark surfaces read.
      return raw > BLACK_THRESHOLD
        ? raw
        : raw + Math.pow(BLACK_THRESHOLD - raw, BLACK_CLAMP);
    };

    const txtY = y(text);
    const bgY = y(background);
    if (Math.abs(bgY - txtY) < 0.0005) return 0;

    // Two polarities with different exponents, because dark-on-light and
    // light-on-dark are not symmetric to the eye.
    let sapc;
    let out;
    if (bgY > txtY) {
      sapc = (Math.pow(bgY, 0.56) - Math.pow(txtY, 0.57)) * 1.14;
      out = sapc < 0.1 ? 0 : sapc - 0.027;
    } else {
      sapc = (Math.pow(bgY, 0.65) - Math.pow(txtY, 0.62)) * 1.14;
      out = sapc > -0.1 ? 0 : sapc + 0.027;
    }
    return out * 100;
  },

  /**
   * Pick whichever of `dark` and `light` reads better on `background`.
   * This is gt's `autocolor_text`, and `algo` is its `contrast_algo`.
   */
  readableOn(background, dark, light, algo) {
    const darkColor = dark || '#000000';
    const lightColor = light || '#FFFFFF';
    if (algo === 'wcag') {
      return Palettes.contrast(background, darkColor) >= Palettes.contrast(background, lightColor)
        ? darkColor
        : lightColor;
    }
    return Math.abs(Palettes.apca(darkColor, background)) >=
      Math.abs(Palettes.apca(lightColor, background))
      ? darkColor
      : lightColor;
  },


  /* ---------- Scales ---------- */

  /**
   * Build a value -> colour function.
   *
   * @param {Object} opts
   * @param {string[]} opts.colors  palette stops
   * @param {string} opts.method    'numeric' | 'factor'
   * @param {number[]} opts.values  the data the scale is fitted to
   * @param {number[]} [opts.domain] explicit [min, max] for 'numeric'
   * @param {boolean} [opts.reverse]
   * @param {number} [opts.midpoint] anchor for diverging palettes
   * @returns {{of: function, breaks: number[], levels: string[]}}
   */
  scale(opts) {
    const colors = opts.reverse ? opts.colors.slice().reverse() : opts.colors.slice();
    const method = opts.method || 'numeric';

    // A missing cell gets this rather than nothing, which is gt's `na_color`.
    // `null` means "leave the cell alone", which is what gt does with no
    // `na_color` set, so the two agree by default.
    const naColor = opts.naColor || null;
    const forMissing = (value) => (Util.isMissing(value) ? naColor : undefined);

    if (method === 'factor') {
      const levels = Util.unique(opts.values.filter((v) => !Util.isMissing(v)).map((v) => String(v)));
      // An explicit assignment wins; the rest take the palette in level order.
      // Both halves are handed to gt as `levels =` and a matching `palette =`,
      // which maps positionally — verified against real gt, not assumed.
      const chosen = opts.levelColors || {};
      const map = {};
      levels.forEach((level, i) => {
        map[level] = chosen[level] || Palettes.toCss(colors.length >= levels.length
          ? Palettes.parse(colors[i % colors.length])
          : Palettes.sample(colors, levels.length === 1 ? 0.5 : i / (levels.length - 1)));
      });
      return {
        levels: levels,
        colorOf: (level) => map[String(level)] || null,
        breaks: [],
        of: (value) => {
          const missing = forMissing(value);
          if (missing !== undefined) return missing;
          return map[String(value)] || null;
        }
      };
    }

    const nums = opts.values.map(Util.toNumber).filter((n) => n !== null).sort((a, b) => a - b);
    if (!nums.length) {
      return { breaks: [], levels: [], of: (value) => forMissing(value) || null };
    }


    // Continuous.
    const span = Palettes.continuousDomain(nums, opts.domain, opts.midpoint);
    const lo = span[0];
    const hi = span[1];

    return {
      breaks: [lo, hi],
      levels: [],
      of: (value) => {
        const missing = forMissing(value);
        if (missing !== undefined) return missing;
        const num = Util.toNumber(value);
        if (num === null) return null;
        return Palettes.toCss(Palettes.sample(colors, Util.clamp((num - lo) / (hi - lo), 0, 1)));
      }
    };
  },

  /**
   * The domain a continuous scale is actually fitted over.
   *
   * **A midpoint is a symmetric domain, not a second mapping.** It used to be
   * one: `[lo, mid]` mapped to the palette's lower half and `[mid, hi]` to its
   * upper half, each side stretched to reach its own extreme. Two things were
   * wrong with that.
   *
   * It misreads the data. Over `[-4, 6]` centred on 0, −4 and +6 both came out
   * at full intensity, so a small negative looked as extreme as a large
   * positive — the opposite of what a diverging scale is for, which is that
   * distance from the centre is comparable in both directions.
   *
   * And it could not be exported. gt's `data_color()` has no `midpoint`
   * argument and maps its domain linearly, so the midpoint reached R as
   * nothing at all: the preview put the palette's neutral colour on zero and
   * the exported table put it wherever the data happened to be centred. A
   * symmetric domain is how gt centres a diverging scale, and it is a domain,
   * so `export-rgt.js` can simply say it.
   *
   * An explicit domain is treated as the range that must be covered: the
   * result is widened around the midpoint until it is symmetric, never
   * narrowed below what was asked for.
   *
   * @param {number[]} sorted ascending numeric values, non-empty
   * @param {?number[]} domain explicit [min, max], or null to fit the data
   * @param {?number} midpoint the value the palette's centre lands on
   * @returns {number[]} [lo, hi]
   */
  continuousDomain(sorted, domain, midpoint) {
    /*
     * `Number.isFinite`, not the global `isFinite`, and that is the whole of a
     * crash. The global one coerces first, and `Number(null)` is 0 — so
     * `isFinite(null)` is **true**. Clearing a domain box in the Colour panel
     * writes `null` (`Controls.number` is nullable there, because blank has to
     * mean "fit the data"), that null passed this guard, and `lo` became null:
     * the scale's breaks came out `[null, …]` and the panel's own legend threw
     * on `null.toExponential()`, taking the rail down with it.
     *
     * `Number.isFinite` is false for null, undefined and strings, which is
     * what "is this a number I can build a domain from" actually means.
     */
    let lo = domain && Number.isFinite(domain[0]) ? domain[0] : sorted[0];
    let hi = domain && Number.isFinite(domain[1]) ? domain[1] : sorted[sorted.length - 1];
    if (hi === lo) hi = lo + 1;

    if (midpoint === null || midpoint === undefined || !isFinite(midpoint)) return [lo, hi];

    // `hi > lo` above, so at least one arm is positive and the radius cannot
    // be zero — including when the midpoint sits outside the data entirely.
    const radius = Math.max(midpoint - lo, hi - midpoint);
    return [midpoint - radius, midpoint + radius];
  },

  /*
   * `equalBreaks` and `quantileBreaks` lived here until the colour methods were
   * cut back to continuous and categorical. Binning is a statement about a
   * particular set of rows rather than about the values, and the cases that
   * want it are better served by `data_color(method = "bin")` in the exported
   * R than by a control most tables never touch. Removed rather than left
   * unreachable — see the work log.
   */
};
