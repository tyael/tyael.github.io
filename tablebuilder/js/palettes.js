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
  mix(a, b, t) {
    const ca = Palettes.parse(a) || { r: 0, g: 0, b: 0, a: 1 };
    const cb = Palettes.parse(b) || { r: 0, g: 0, b: 0, a: 1 };
    const k = Util.clamp(t, 0, 1);
    return {
      r: ca.r + (cb.r - ca.r) * k,
      g: ca.g + (cb.g - ca.g) * k,
      b: ca.b + (cb.b - ca.b) * k,
      a: ca.a + (cb.a - ca.a) * k
    };
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
   * Pick whichever of `dark` and `light` reads better on `background`.
   * This is gt's `autocolor_text`.
   */
  readableOn(background, dark, light) {
    const darkColor = dark || '#000000';
    const lightColor = light || '#FFFFFF';
    return Palettes.contrast(background, darkColor) >= Palettes.contrast(background, lightColor)
      ? darkColor
      : lightColor;
  },

  /** Lighten (positive) or darken (negative) by moving towards white or black. */
  adjustLuminance(color, amount) {
    const target = amount >= 0 ? '#FFFFFF' : '#000000';
    return Palettes.toCss(Palettes.mix(color, target, Math.abs(amount)));
  },

  /* ---------- Scales ---------- */

  /**
   * Build a value -> colour function.
   *
   * @param {Object} opts
   * @param {string[]} opts.colors  palette stops
   * @param {string} opts.method    'numeric' | 'bin' | 'quantile' | 'factor'
   * @param {number[]} opts.values  the data the scale is fitted to
   * @param {number[]} [opts.domain] explicit [min, max] for 'numeric'
   * @param {number} [opts.bins]    bin/quantile count
   * @param {boolean} [opts.reverse]
   * @param {number} [opts.midpoint] anchor for diverging palettes
   * @returns {{of: function, breaks: number[], levels: string[]}}
   */
  scale(opts) {
    const colors = opts.reverse ? opts.colors.slice().reverse() : opts.colors.slice();
    const method = opts.method || 'numeric';

    if (method === 'factor') {
      const levels = Util.unique(opts.values.map((v) => String(v)));
      const map = {};
      levels.forEach((level, i) => {
        map[level] = Palettes.toCss(colors.length >= levels.length
          ? Palettes.parse(colors[i % colors.length])
          : Palettes.sample(colors, levels.length === 1 ? 0.5 : i / (levels.length - 1)));
      });
      return {
        levels: levels,
        breaks: [],
        of: (value) => (value === null || value === undefined ? null : map[String(value)] || null)
      };
    }

    const nums = opts.values.map(Util.toNumber).filter((n) => n !== null).sort((a, b) => a - b);
    if (!nums.length) return { breaks: [], levels: [], of: () => null };

    if (method === 'bin' || method === 'quantile') {
      const count = Math.max(2, Math.min(24, opts.bins || 5));
      const breaks = method === 'bin'
        ? Palettes.equalBreaks(nums[0], nums[nums.length - 1], count)
        : Palettes.quantileBreaks(nums, count);
      const binColors = Palettes.ramp(colors, breaks.length - 1);
      return {
        breaks: breaks,
        levels: [],
        of: (value) => {
          const num = Util.toNumber(value);
          if (num === null) return null;
          for (let i = 0; i < breaks.length - 1; i += 1) {
            const last = i === breaks.length - 2;
            if (num >= breaks[i] && (last ? num <= breaks[i + 1] : num < breaks[i + 1])) {
              return binColors[i];
            }
          }
          return num < breaks[0] ? binColors[0] : binColors[binColors.length - 1];
        }
      };
    }

    // Continuous.
    let lo = opts.domain && isFinite(opts.domain[0]) ? opts.domain[0] : nums[0];
    let hi = opts.domain && isFinite(opts.domain[1]) ? opts.domain[1] : nums[nums.length - 1];
    if (hi === lo) hi = lo + 1;

    const mid = opts.midpoint;
    const useMid = mid !== null && mid !== undefined && isFinite(mid);

    return {
      breaks: [lo, hi],
      levels: [],
      of: (value) => {
        const num = Util.toNumber(value);
        if (num === null) return null;
        let t;
        if (useMid) {
          // Diverging: map [lo, mid] to [0, 0.5] and [mid, hi] to [0.5, 1] so the
          // palette's neutral centre lands exactly on the midpoint.
          t = num <= mid
            ? (mid === lo ? 0.5 : 0.5 * (num - lo) / (mid - lo))
            : (hi === mid ? 0.5 : 0.5 + 0.5 * (num - mid) / (hi - mid));
        } else {
          t = (num - lo) / (hi - lo);
        }
        return Palettes.toCss(Palettes.sample(colors, Util.clamp(t, 0, 1)));
      }
    };
  },

  /** N+1 evenly spaced break points between lo and hi. */
  equalBreaks(lo, hi, n) {
    const out = [];
    const step = (hi - lo) / n;
    for (let i = 0; i <= n; i += 1) out.push(lo + step * i);
    return out;
  },

  /** N+1 breaks at equal quantiles of an already sorted array. */
  quantileBreaks(sorted, n) {
    const out = [];
    for (let i = 0; i <= n; i += 1) {
      const pos = (sorted.length - 1) * (i / n);
      const lower = Math.floor(pos);
      const upper = Math.min(sorted.length - 1, lower + 1);
      out.push(sorted[lower] + (sorted[upper] - sorted[lower]) * (pos - lower));
    }
    // Collapse duplicate breaks, which happen when a value dominates the column.
    return out.filter((v, i) => i === 0 || v !== out[i - 1]);
  }
};
