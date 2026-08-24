/**
 * formatters.js
 *
 * The value formatters, as a registry. Each entry declares the parameters it
 * accepts so the format panel can generate its own controls — adding a
 * formatter needs no UI work.
 *
 * This is the core of gt's `fmt_*` family: number, integer, percent, currency,
 * scientific, engineering, date, time, datetime, plus passthrough and markdown.
 * The exotic members (units, chem, flags, icons, country names, fractions,
 * roman numerals, spelled-out numbers, byte sizes) are out of scope.
 */

const Formatters = {

  /** Symbols offered by the currency formatter. */
  CURRENCIES: [
    { code: 'USD', symbol: '$' }, { code: 'EUR', symbol: '€' }, { code: 'GBP', symbol: '£' },
    { code: 'JPY', symbol: '¥' }, { code: 'AUD', symbol: 'A$' }, { code: 'CAD', symbol: 'C$' },
    { code: 'NZD', symbol: 'NZ$' }, { code: 'CHF', symbol: 'CHF' }, { code: 'CNY', symbol: '¥' },
    { code: 'INR', symbol: '₹' }, { code: 'KRW', symbol: '₩' }, { code: 'BRL', symbol: 'R$' },
    { code: 'ZAR', symbol: 'R' }, { code: 'SEK', symbol: 'kr' }, { code: 'NOK', symbol: 'kr' }
  ],

  /**
   * Named date styles, mapped to Intl options — and each carrying the name gt
   * knows it by, where gt knows it at all.
   *
   * **The two sets of names are not the same set**, which is why `gt` is
   * written out rather than assumed to be `id`. Three styles here were emitting
   * `date_style = "month_year"` and its neighbours, which are not gt style
   * names: `fmt_date()` aborts on them, so those three tables exported R that
   * would not run. `month_year` and `m_year` are `yMMMM` and `yMMM` in gt and
   * render identically; `year_month_day` is nothing in gt, and says so rather
   * than being emitted as something close.
   */
  DATE_STYLES: [
    { id: 'iso', label: 'ISO — 2024-03-08', gt: 'iso' },
    { id: 'wday_month_day_year', label: 'Friday, March 8, 2024', gt: 'wday_month_day_year' },
    { id: 'month_day_year', label: 'March 8, 2024', gt: 'month_day_year' },
    { id: 'm_day_year', label: 'Mar 8, 2024', gt: 'm_day_year' },
    { id: 'day_month_year', label: '8 March 2024', gt: 'day_month_year' },
    { id: 'day_m_year', label: '8 Mar 2024', gt: 'day_m_year' },
    { id: 'day_month', label: '8 March', gt: 'day_month' },
    { id: 'year_month_day', label: '2024 March 8', gt: null },
    { id: 'month_year', label: 'March 2024', gt: 'yMMMM' },
    { id: 'm_year', label: 'Mar 2024', gt: 'yMMM' },
    { id: 'year', label: '2024', gt: 'year' },
    { id: 'month', label: 'March', gt: 'month' },
    { id: 'yMd', label: '3/8/2024 (locale short)', gt: 'yMd' }
  ],

  /** As above: `hm_p` and `hms_p` are `h_m_p` and `h_m_s_p` to gt. */
  TIME_STYLES: [
    { id: 'iso', label: 'ISO — 14:30:00', gt: 'iso' },
    { id: 'hms', label: '14:30:00', gt: 'Hms' },
    { id: 'hm', label: '14:30', gt: 'Hm' },
    { id: 'h_p', label: '2 PM', gt: 'h_p' },
    { id: 'hm_p', label: '2:30 PM', gt: 'h_m_p' },
    { id: 'hms_p', label: '2:30:00 PM', gt: 'h_m_s_p' }
  ],

  /**
   * The gt name for one of the styles above, or null where gt has none.
   * @param {'date'|'time'} family
   */
  gtStyle(family, id) {
    const list = family === 'time' ? Formatters.TIME_STYLES : Formatters.DATE_STYLES;
    const found = list.find((style) => style.id === id);
    return found ? found.gt : null;
  },

  /* ---------- Registry ---------- */

  /**
   * Every formatter. `params` drives the UI; `apply` does the work and is given
   * the raw cell value, the resolved options, and a context object carrying the
   * column and the whole column of values (needed by suffixing decisions).
   */
  types: [

    {
      type: 'number',
      label: 'Number',
      numeric: true,
      params: [
        { key: 'decimals', label: 'Decimals', type: 'int', default: 2, min: 0, max: 12 },
        { key: 'nSigfig', label: 'Significant figures', type: 'int', default: null, min: 1, max: 15,
          hint: 'Overrides Decimals when set.' },
        { key: 'useSeparator', label: 'Thousands separator', type: 'bool', default: true },
        { key: 'sepMark', label: 'Separator mark', type: 'text', default: ',' },
        { key: 'decMark', label: 'Decimal mark', type: 'text', default: '.' },
        { key: 'dropTrailingZeros', label: 'Drop trailing zeros', type: 'bool', default: false },
        { key: 'forceSign', label: 'Always show sign', type: 'bool', default: false },
        { key: 'negativeParens', label: 'Negatives in parentheses', type: 'bool', default: false },
        { key: 'scaleBy', label: 'Scale by', type: 'number', default: 1 },
        { key: 'suffixing', label: 'K/M/B/T suffixes', type: 'bool', default: false },
        { key: 'pattern', label: 'Pattern', type: 'text', default: '{x}',
          hint: '{x} is the formatted value, e.g. "{x} kg".' }
      ],
      apply(value, o, ctx) {
        const num = Util.toNumber(value);
        if (num === null) return null;
        return Formatters.formatNumber(num, o, ctx);
      }
    },

    {
      type: 'integer',
      label: 'Integer',
      numeric: true,
      params: [
        { key: 'useSeparator', label: 'Thousands separator', type: 'bool', default: true },
        { key: 'sepMark', label: 'Separator mark', type: 'text', default: ',' },
        { key: 'forceSign', label: 'Always show sign', type: 'bool', default: false },
        { key: 'negativeParens', label: 'Negatives in parentheses', type: 'bool', default: false },
        { key: 'scaleBy', label: 'Scale by', type: 'number', default: 1 },
        { key: 'suffixing', label: 'K/M/B/T suffixes', type: 'bool', default: false },
        { key: 'pattern', label: 'Pattern', type: 'text', default: '{x}' }
      ],
      apply(value, o, ctx) {
        const num = Util.toNumber(value);
        if (num === null) return null;
        return Formatters.formatNumber(num, Object.assign({}, o, { decimals: 0 }), ctx);
      }
    },

    {
      type: 'percent',
      label: 'Percent',
      numeric: true,
      params: [
        { key: 'decimals', label: 'Decimals', type: 'int', default: 1, min: 0, max: 8 },
        { key: 'alreadyPercent', label: 'Values are already 0–100', type: 'bool', default: false,
          hint: 'Off means 0.42 becomes 42%.' },
        { key: 'useSeparator', label: 'Thousands separator', type: 'bool', default: true },
        { key: 'decMark', label: 'Decimal mark', type: 'text', default: '.' },
        { key: 'placement', label: 'Symbol placement', type: 'select', enum: ['right', 'left'], default: 'right' },
        { key: 'incl_space', label: 'Space before symbol', type: 'bool', default: false },
        { key: 'forceSign', label: 'Always show sign', type: 'bool', default: false },
        { key: 'pattern', label: 'Pattern', type: 'text', default: '{x}' }
      ],
      apply(value, o, ctx) {
        const num = Util.toNumber(value);
        if (num === null) return null;
        const scaled = o.alreadyPercent ? num : num * 100;
        const body = Formatters.formatNumber(scaled, Object.assign({}, o, {
          scaleBy: 1, pattern: '{x}', suffixing: false
        }), ctx);
        const space = o.incl_space ? ' ' : '';
        const text = o.placement === 'left' ? '%' + space + body : body + space + '%';
        return Formatters.applyPattern(text, o.pattern);
      }
    },

    {
      type: 'currency',
      label: 'Currency',
      numeric: true,
      params: [
        // `enum` is filled in by initFormatterEnums() at the bottom of this file,
        // because the lists it draws on are properties of Formatters itself.
        { key: 'currency', label: 'Currency', type: 'select', enum: [], default: 'USD' },
        { key: 'symbol', label: 'Custom symbol', type: 'text', default: '',
          hint: 'Overrides the currency above when set.' },
        { key: 'decimals', label: 'Decimals', type: 'int', default: 2, min: 0, max: 6 },
        { key: 'useSeparator', label: 'Thousands separator', type: 'bool', default: true },
        { key: 'sepMark', label: 'Separator mark', type: 'text', default: ',' },
        { key: 'decMark', label: 'Decimal mark', type: 'text', default: '.' },
        { key: 'placement', label: 'Symbol placement', type: 'select', enum: ['left', 'right'], default: 'left' },
        { key: 'incl_space', label: 'Space after symbol', type: 'bool', default: false },
        { key: 'negativeParens', label: 'Negatives in parentheses', type: 'bool', default: true },
        { key: 'scaleBy', label: 'Scale by', type: 'number', default: 1 },
        { key: 'suffixing', label: 'K/M/B/T suffixes', type: 'bool', default: false },
        { key: 'pattern', label: 'Pattern', type: 'text', default: '{x}' }
      ],
      apply(value, o, ctx) {
        const num = Util.toNumber(value);
        if (num === null) return null;
        const entry = Formatters.CURRENCIES.find((c) => c.code === o.currency);
        const symbol = o.symbol || (entry ? entry.symbol : '$');
        const negative = num < 0;
        const body = Formatters.formatNumber(Math.abs(num), Object.assign({}, o, {
          pattern: '{x}', forceSign: false, negativeParens: false
        }), ctx);
        const space = o.incl_space ? ' ' : '';
        let text = o.placement === 'right' ? body + space + symbol : symbol + space + body;
        if (negative) text = o.negativeParens ? '(' + text + ')' : '−' + text;
        return Formatters.applyPattern(text, o.pattern);
      }
    },

    {
      type: 'scientific',
      label: 'Scientific',
      numeric: true,
      params: [
        { key: 'decimals', label: 'Decimals', type: 'int', default: 2, min: 0, max: 12 },
        { key: 'expStyle', label: 'Exponent style', type: 'select',
          enum: ['x10n', 'e', 'E'], default: 'x10n',
          hint: "'x10n' renders 1.23 × 10³ using a superscript." },
        { key: 'forceSign', label: 'Always show sign', type: 'bool', default: false },
        { key: 'forceSignExp', label: 'Sign on exponent', type: 'bool', default: false },
        { key: 'pattern', label: 'Pattern', type: 'text', default: '{x}' }
      ],
      apply(value, o, ctx) {
        const num = Util.toNumber(value);
        if (num === null) return null;
        if (num === 0) return Formatters.applyPattern((0).toFixed(o.decimals), o.pattern);

        const exp = Math.floor(Math.log10(Math.abs(num)));
        const mantissa = num / Math.pow(10, exp);
        let mText = mantissa.toFixed(o.decimals);
        if (o.forceSign && mantissa > 0) mText = '+' + mText;

        let eText = String(exp);
        if (o.forceSignExp && exp > 0) eText = '+' + eText;

        let text;
        if (o.expStyle === 'x10n') text = mText + ' × 10^{' + eText + '}';
        else text = mText + o.expStyle + eText;

        return Formatters.applyPattern(text, o.pattern);
      }
    },

    {
      type: 'engineering',
      label: 'Engineering',
      numeric: true,
      params: [
        { key: 'decimals', label: 'Decimals', type: 'int', default: 2, min: 0, max: 12 },
        { key: 'expStyle', label: 'Exponent style', type: 'select', enum: ['x10n', 'e', 'E'], default: 'x10n' },
        { key: 'pattern', label: 'Pattern', type: 'text', default: '{x}' }
      ],
      apply(value, o, ctx) {
        const num = Util.toNumber(value);
        if (num === null) return null;
        if (num === 0) return Formatters.applyPattern((0).toFixed(o.decimals), o.pattern);

        // Engineering notation pins the exponent to a multiple of three.
        const exp = Math.floor(Math.floor(Math.log10(Math.abs(num))) / 3) * 3;
        const mantissa = num / Math.pow(10, exp);
        const mText = mantissa.toFixed(o.decimals);
        const text = o.expStyle === 'x10n'
          ? mText + ' × 10^{' + exp + '}'
          : mText + o.expStyle + exp;
        return Formatters.applyPattern(text, o.pattern);
      }
    },

    {
      type: 'date',
      label: 'Date',
      params: [
        { key: 'style', label: 'Style', type: 'select', enum: [], default: 'iso' },
        { key: 'order', label: 'Day/month order', type: 'select',
          enum: ['auto', 'dmy', 'mdy'], default: 'auto',
          hint: 'Only used where the numbers cannot say: a column holding 14/05 anywhere ' +
            'is read day-first throughout, whatever this says.' },
        { key: 'locale', label: 'Locale', type: 'text', default: '', hint: "Blank uses the browser's." },
        { key: 'pattern', label: 'Pattern', type: 'text', default: '{x}' }
      ],
      apply(value, o, ctx) {
        const date = Formatters.parseDate(value, Formatters.dateOpts(o, ctx));
        if (!date) return null;
        return Formatters.applyPattern(Formatters.formatDate(date, o.style, o.locale), o.pattern);
      }
    },

    {
      type: 'time',
      label: 'Time',
      params: [
        { key: 'style', label: 'Style', type: 'select', enum: [], default: 'hms' },
        { key: 'locale', label: 'Locale', type: 'text', default: '' },
        { key: 'pattern', label: 'Pattern', type: 'text', default: '{x}' }
      ],
      apply(value, o, ctx) {
        const date = Formatters.parseDate(value,
          Object.assign(Formatters.dateOpts(o, ctx), { timeOnly: true }));
        if (!date) return null;
        return Formatters.applyPattern(Formatters.formatTime(date, o.style, o.locale), o.pattern);
      }
    },

    {
      type: 'datetime',
      label: 'Date & time',
      params: [
        { key: 'dateStyle', label: 'Date style', type: 'select', enum: [], default: 'iso' },
        { key: 'timeStyle', label: 'Time style', type: 'select', enum: [], default: 'hms' },
        { key: 'order', label: 'Day/month order', type: 'select',
          enum: ['auto', 'dmy', 'mdy'], default: 'auto',
          hint: 'Only used where the numbers cannot say.' },
        { key: 'sep', label: 'Separator', type: 'text', default: ' ' },
        { key: 'locale', label: 'Locale', type: 'text', default: '' },
        { key: 'pattern', label: 'Pattern', type: 'text', default: '{x}' }
      ],
      apply(value, o, ctx) {
        const date = Formatters.parseDate(value,
          Object.assign(Formatters.dateOpts(o, ctx), { timeOnly: true }));
        if (!date) return null;
        const text = Formatters.formatDate(date, o.dateStyle, o.locale) + (o.sep || ' ') +
          Formatters.formatTime(date, o.timeStyle, o.locale);
        return Formatters.applyPattern(text, o.pattern);
      }
    },

    {
      type: 'text',
      label: 'Text',
      params: [
        { key: 'regex', label: 'Extract', type: 'text', default: '',
          hint: 'A regular expression. The cell shows what it matches — “\\d{4}” pulls ' +
            'the year out of a citation. A cell it does not match is left alone.' },
        { key: 'regexGroup', label: 'Group', type: 'int', default: 0, min: 0, max: 9,
          hint: '0 is the whole match; 1 is the first (…) in the expression.' },
        { key: 'regexIgnoreCase', label: 'Ignore case', type: 'bool', default: false },
        { key: 'transform', label: 'Case', type: 'select',
          enum: ['none', 'uppercase', 'lowercase', 'capitalize', 'title'], default: 'none' },
        { key: 'trim', label: 'Trim whitespace', type: 'bool', default: true },
        { key: 'truncate', label: 'Truncate to', type: 'int', default: null, min: 1, max: 500 },
        { key: 'pattern', label: 'Pattern', type: 'text', default: '{x}' }
      ],
      apply(value, o) {
        let text = String(value);
        if (o.trim) text = text.trim();

        // **Before the case change and the truncation, after the trim.** The
        // expression is written against what is in the cell, so it has to see
        // the cell; everything after it is tidying up what came out.
        text = Formatters.extract(text, o);

        switch (o.transform) {
          case 'uppercase': text = text.toUpperCase(); break;
          case 'lowercase': text = text.toLowerCase(); break;
          case 'capitalize': text = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase(); break;
          case 'title': text = text.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()); break;
          default: break;
        }
        if (o.truncate) text = Util.truncate(text, o.truncate);
        return Formatters.applyPattern(text, o.pattern);
      }
    },

    {
      type: 'markdown',
      label: 'Markup',
      params: [],
      hint: 'Interpret the cell text as inline markup (**bold**, *italic*, ^{sup}, _{sub}).',
      apply(value) {
        return String(value);
      }
    },

    {
      type: 'passthrough',
      label: 'Passthrough',
      params: [
        { key: 'pattern', label: 'Pattern', type: 'text', default: '{x}' }
      ],
      apply(value, o) {
        return Formatters.applyPattern(String(value), o.pattern);
      }
    }
  ],

  /* ---------- Lookup ---------- */

  _byType: null,

  get(type) {
    if (!Formatters._byType) {
      Formatters._byType = {};
      for (const f of Formatters.types) Formatters._byType[f.type] = f;
    }
    return Formatters._byType[type] || null;
  },

  /** Default option object for a formatter type. */
  defaults(type) {
    const def = Formatters.get(type);
    if (!def) return {};
    const out = {};
    for (const p of def.params) out[p.key] = p.default;
    return out;
  },

  /** Fill in any missing options with their defaults. */
  resolveOpts(type, opts) {
    return Object.assign(Formatters.defaults(type), opts || {});
  },

  /**
   * Format one value.
   * @returns {string|null} null when the formatter could not handle the value,
   *   in which case the caller should fall back to the raw text.
   */
  apply(type, value, opts, ctx) {
    const def = Formatters.get(type);
    if (!def) return null;
    try {
      return def.apply(value, Formatters.resolveOpts(type, opts), ctx || {});
    } catch (err) {
      console.warn('Formatter "' + type + '" failed on', value, err);
      return null;
    }
  },

  /* ---------- Shared number machinery ---------- */

  SUFFIXES: [
    { at: 1e12, s: 'T' }, { at: 1e9, s: 'B' }, { at: 1e6, s: 'M' }, { at: 1e3, s: 'K' }
  ],

  /**
   * The common numeric path: scaling, suffixing, rounding, grouping, sign.
   */
  formatNumber(num, o, ctx) {
    let value = num * (o.scaleBy === undefined || o.scaleBy === null ? 1 : o.scaleBy);
    let suffix = '';

    if (o.suffixing) {
      const abs = Math.abs(value);
      for (const step of Formatters.SUFFIXES) {
        if (abs >= step.at) { value = value / step.at; suffix = step.s; break; }
      }
    }

    const negative = value < 0;
    let abs = Math.abs(value);

    let text;
    if (o.nSigfig) {
      text = Formatters.toSigfig(abs, o.nSigfig);
    } else {
      const decimals = o.decimals === undefined || o.decimals === null ? 2 : o.decimals;
      text = abs.toFixed(Math.max(0, Math.min(20, decimals)));
    }

    if (o.dropTrailingZeros && text.indexOf('.') >= 0) {
      text = text.replace(/\.?0+$/, '');
    }

    // Group the integer part.
    let [intPart, fracPart] = text.split('.');
    if (o.useSeparator) {
      intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, o.sepMark === undefined ? ',' : o.sepMark);
    }
    text = intPart + (fracPart ? (o.decMark === undefined ? '.' : o.decMark) + fracPart : '');
    text += suffix;

    if (negative) {
      text = o.negativeParens ? '(' + text + ')' : '−' + text;
    } else if (o.forceSign) {
      text = '+' + text;
    }

    return Formatters.applyPattern(text, o.pattern);
  },

  /** Round to a number of significant figures, keeping trailing zeros. */
  toSigfig(num, sig) {
    if (num === 0) return (0).toFixed(Math.max(0, sig - 1));
    const magnitude = Math.floor(Math.log10(Math.abs(num)));
    const decimals = Util.clamp(sig - 1 - magnitude, 0, 20);
    return num.toFixed(decimals);
  },

  /** Substitute the formatted value into a `{x}` pattern. */
  /**
   * Compiled expressions, by pattern and flags.
   *
   * `new RegExp` on every cell of every render is not free, and this runs on
   * the keystroke path — the Format panel previews a rule as it is typed, so
   * the half-written expressions all arrive here too.
   */
  _regexCache: {},

  /**
   * Compile a user's expression, or null if it will not compile.
   *
   * **Never throws.** A regular expression is typed a character at a time and
   * is invalid for most of that time — `(`, `[a-`, `\` are all states on the
   * way to something good. A throw here would take the whole render with it
   * and blank the table under the person typing.
   */
  regex(pattern, ignoreCase) {
    if (!pattern) return null;
    const key = (ignoreCase ? 'i:' : ':') + pattern;
    if (key in Formatters._regexCache) return Formatters._regexCache[key];

    let compiled = null;
    try {
      compiled = new RegExp(pattern, ignoreCase ? 'i' : '');
    } catch (err) {
      compiled = null;
    }

    // One entry per keystroke while an expression is being typed, and every
    // prefix of it is a key nothing will ask for again. Emptied rather than
    // evicted one by one: the only entry that matters is the last one.
    if (Object.keys(Formatters._regexCache).length > 200) Formatters._regexCache = {};
    Formatters._regexCache[key] = compiled;
    return compiled;
  },

  /** Why an expression will not compile, or null when it will. */
  regexError(pattern, ignoreCase) {
    if (!pattern) return null;
    if (Formatters.regex(pattern, ignoreCase)) return null;
    try {
      new RegExp(pattern, ignoreCase ? 'i' : '');
      return null;
    } catch (err) {
      return err.message;
    }
  },

  /**
   * The part of `text` an expression matches, or `text` untouched.
   *
   * **A cell the expression does not match keeps what it had.** That is what
   * every other formatter here does with a value it cannot handle — the number
   * formatter hands back `null` and `Compute.cellText` shows the raw value
   * rather than blanking it — and blanking a cell is a bad way to say "no
   * match" when the alternative is showing what is actually there.
   */
  extract(text, o) {
    const compiled = Formatters.regex(o.regex, o.regexIgnoreCase);
    if (!compiled) return text;

    const match = compiled.exec(text);
    if (!match) return text;

    const group = o.regexGroup || 0;
    const picked = match[group];
    // A group that did not take part matched nothing, not the whole cell.
    return picked === undefined ? text : picked;
  },

  applyPattern(text, pattern) {
    if (!pattern || pattern === '{x}') return text;
    return String(pattern).replace(/\{x\}/g, text);
  },

  /* ---------- Dates ---------- */

  /**
   * Parse a date. Every shape lives in `Util.toDate`, which `Csv.isDateish`
   * asks the same question of, so what types as a date is what formats as one.
   */
  parseDate(value, opts) {
    return Util.toDate(value, opts);
  },

  /**
   * How to read this column's dates, from the rule and the column together.
   *
   * The rule's setting wins when it is not `auto`; otherwise the order the
   * importer worked out from the whole column does. Neither is consulted for a
   * value that says outright which number is the day.
   *
   * **Serial numbers are on.** Choosing the Date format is a statement that the
   * column holds dates, and 45292 in a column of them is a spreadsheet serial,
   * not the number forty-five thousand. `Util.toDate` refuses them by default
   * precisely because type inference must not make every numeric column dates.
   */
  dateOpts(o, ctx) {
    const column = (ctx && ctx.column) || null;
    const chosen = o && o.order && o.order !== 'auto' ? o.order : null;
    return {
      order: chosen || (column && column.dateOrder) || null,
      serial: true
    };
  },

  formatDate(date, style, locale) {
    const loc = locale || undefined;
    const pad = (n) => String(n).padStart(2, '0');

    switch (style) {
      case 'iso':
        // `Util.toIso` and not a second spelling of it. This was one, and it
        // carried the same unpadded year — so a date before 1000 AD drew
        // `850-05-14` in the table while claiming to be ISO, and the column
        // stopped being readable by anything that reads dates, this formatter
        // included. The styles below spell a year out for a person to read and
        // an unpadded one is right for them; only this one has a grammar.
        return Util.toIso(date, false);
      case 'wday_month_day_year':
        return date.toLocaleDateString(loc, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      case 'month_day_year':
        return date.toLocaleDateString(loc, { year: 'numeric', month: 'long', day: 'numeric' });
      case 'm_day_year':
        return date.toLocaleDateString(loc, { year: 'numeric', month: 'short', day: 'numeric' });
      case 'day_month_year':
        return date.getDate() + ' ' + date.toLocaleDateString(loc, { month: 'long' }) + ' ' + date.getFullYear();
      case 'day_m_year':
        return date.getDate() + ' ' + date.toLocaleDateString(loc, { month: 'short' }) + ' ' + date.getFullYear();
      case 'day_month':
        return date.getDate() + ' ' + date.toLocaleDateString(loc, { month: 'long' });
      case 'year_month_day':
        return date.getFullYear() + ' ' + date.toLocaleDateString(loc, { month: 'long' }) + ' ' + date.getDate();
      case 'month_year':
        return date.toLocaleDateString(loc, { month: 'long', year: 'numeric' });
      case 'm_year':
        return date.toLocaleDateString(loc, { month: 'short', year: 'numeric' });
      case 'year':
        return String(date.getFullYear());
      case 'month':
        return date.toLocaleDateString(loc, { month: 'long' });
      default:
        return date.toLocaleDateString(loc);
    }
  },

  formatTime(date, style, locale) {
    const loc = locale || undefined;
    const pad = (n) => String(n).padStart(2, '0');

    switch (style) {
      case 'iso':
      case 'hms':
        return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
      case 'hm':
        return pad(date.getHours()) + ':' + pad(date.getMinutes());
      case 'h_p':
        return date.toLocaleTimeString(loc, { hour: 'numeric', hour12: true });
      case 'hm_p':
        return date.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit', hour12: true });
      case 'hms_p':
        return date.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
      default:
        return date.toLocaleTimeString(loc);
    }
  },

  /**
   * Suggest a formatter for a column based on its inferred type and values.
   * Used to pre-fill the format panel rather than applied automatically.
   */
  suggest(column, values) {
    if (!column) return 'passthrough';
    if (column.type === 'date') return 'date';
    if (column.type !== 'number') return 'passthrough';

    const nums = values.map(Util.toNumber).filter((n) => n !== null);
    if (!nums.length) return 'passthrough';

    const allInteger = nums.every((n) => Number.isInteger(n));
    if (allInteger) return 'integer';

    const maxAbs = Math.max.apply(null, nums.map(Math.abs));
    const minAbs = Math.min.apply(null, nums.filter((n) => n !== 0).map(Math.abs));
    if (maxAbs !== 0 && (maxAbs >= 1e6 || (minAbs && minAbs < 1e-4))) return 'scientific';

    return 'number';
  }
};

/* Fill in the enum lists that reference the tables declared above. */
(function initFormatterEnums() {
  const currency = Formatters.get('currency').params.find((p) => p.key === 'currency');
  currency.enum = Formatters.CURRENCIES.map((c) => c.code);

  const dateStyles = Formatters.DATE_STYLES.map((s) => s.id);
  const timeStyles = Formatters.TIME_STYLES.map((s) => s.id);
  const labelFor = (list) => {
    const map = {};
    for (const s of list) map[s.id] = s.label;
    return map;
  };

  const ORDER_LABELS = {
    auto: 'Auto — as the column reads',
    dmy: 'Day first — 3/05 is 3 May',
    mdy: 'Month first — 3/05 is 5 March'
  };
  for (const type of ['date', 'datetime']) {
    const order = Formatters.get(type).params.find((p) => p.key === 'order');
    order.enumLabels = ORDER_LABELS;
  }

  const date = Formatters.get('date').params.find((p) => p.key === 'style');
  date.enum = dateStyles;
  date.enumLabels = labelFor(Formatters.DATE_STYLES);

  const time = Formatters.get('time').params.find((p) => p.key === 'style');
  time.enum = timeStyles;
  time.enumLabels = labelFor(Formatters.TIME_STYLES);

  const dt = Formatters.get('datetime');
  const dtDate = dt.params.find((p) => p.key === 'dateStyle');
  dtDate.enum = dateStyles;
  dtDate.enumLabels = labelFor(Formatters.DATE_STYLES);
  const dtTime = dt.params.find((p) => p.key === 'timeStyle');
  dtTime.enum = timeStyles;
  dtTime.enumLabels = labelFor(Formatters.TIME_STYLES);
}());
