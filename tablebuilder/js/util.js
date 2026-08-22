/**
 * util.js
 * Small shared helpers. No dependencies, loaded first.
 */

const Util = {

  /* ---------- DOM ---------- */

  /** Shorthand for querySelector within an optional root. */
  qs(sel, root) {
    return (root || document).querySelector(sel);
  },

  /** Shorthand for querySelectorAll, returned as a real array. */
  qsa(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  },

  /**
   * Build an element.
   * @param {string} tag - tag name, optionally with .classes (e.g. 'div.item.is-on')
   * @param {Object} [attrs] - attributes; `text`, `html`, `style` and `on` are special
   * @param {Array|Node|string} [children]
   */
  el(tag, attrs, children) {
    const parts = tag.split('.');
    const node = document.createElement(parts[0]);
    if (parts.length > 1) node.className = parts.slice(1).join(' ');

    if (attrs) {
      for (const key in attrs) {
        const val = attrs[key];
        if (val === null || val === undefined || val === false) continue;
        if (key === 'text') node.textContent = val;
        else if (key === 'html') node.innerHTML = val;
        else if (key === 'style' && typeof val === 'object') Object.assign(node.style, val);
        else if (key === 'on') for (const ev in val) node.addEventListener(ev, val[ev]);
        else if (key === 'dataset') Object.assign(node.dataset, val);
        else if (val === true) node.setAttribute(key, '');
        else node.setAttribute(key, val);
      }
    }

    if (children !== null && children !== undefined) Util.append(node, children);
    return node;
  },

  /** Append a child, array of children, or text to a node. */
  append(node, children) {
    const list = Array.isArray(children) ? children : [children];
    for (const child of list) {
      if (child === null || child === undefined || child === false) continue;
      node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  },

  /** Remove all children of a node. */
  clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  },

  /* ---------- Strings ---------- */

  /** Escape for insertion into HTML text or an attribute value. */
  escapeHtml(str) {
    return String(str === null || str === undefined ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  /** Escape for insertion into XML/SVG text content. */
  escapeXml(str) {
    return String(str === null || str === undefined ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  /** Truncate with an ellipsis. */
  truncate(str, max) {
    str = String(str === null || str === undefined ? '' : str);
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
  },

  /** Turn an arbitrary string into a safe identifier fragment. */
  slug(str) {
    return String(str)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'x';
  },

  /**
   * `1 style rule`, `2 style rules`. English only, and only the -s case, which
   * is every noun this app counts.
   */
  plural(n, noun) {
    return n + ' ' + noun + (n === 1 ? '' : 's');
  },

  /** Title-ish humanisation of a column id: `total_pop_2024` -> `Total pop 2024`. */
  humanise(str) {
    const s = String(str).replace(/[_.]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  },

  /* ---------- Ids ---------- */

  _idCounter: 0,

  /** Short unique id with an optional prefix. */
  uid(prefix) {
    Util._idCounter += 1;
    return (prefix || 'id') + '_' + Date.now().toString(36).slice(-4) +
      Util._idCounter.toString(36) + Math.random().toString(36).slice(2, 5);
  },

  /* ---------- Data ---------- */

  /** Structured deep clone with a JSON fallback for older engines. */
  clone(obj) {
    if (typeof structuredClone === 'function') {
      try { return structuredClone(obj); } catch (e) { /* fall through */ }
    }
    return JSON.parse(JSON.stringify(obj));
  },


  /**
   * Unique values, order preserved.
   * Note `Array.from`, not `slice.call`: a Set is iterable but not array-like,
   * so the slice trick silently yields an empty array.
   */
  unique(arr) {
    return Array.from(new Set(arr));
  },

  /** Group array items by a key function into a Map (insertion ordered). */
  groupBy(arr, keyFn) {
    const map = new Map();
    for (const item of arr) {
      const key = keyFn(item);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return map;
  },

  /** Move an item within an array, returning a new array. */
  moveItem(arr, from, to) {
    const out = arr.slice();
    if (from < 0 || from >= out.length) return out;
    const clamped = Math.max(0, Math.min(out.length - 1, to));
    const [item] = out.splice(from, 1);
    out.splice(clamped, 0, item);
    return out;
  },

  /** Clamp a number. */
  clamp(n, lo, hi) {
    return n < lo ? lo : (n > hi ? hi : n);
  },

  /**
   * Coerce a value to a finite number, tolerating thousands separators,
   * currency symbols, percent signs and parenthesised negatives.
   * Returns null when the value is not numeric.
   */
  toNumber(value) {
    if (typeof value === 'number') return isFinite(value) ? value : null;
    if (value === null || value === undefined) return null;
    let str = String(value).trim();
    if (!str) return null;
    let negative = false;
    if (/^\(.*\)$/.test(str)) { negative = true; str = str.slice(1, -1); }
    str = str.replace(/[\s,_]/g, '').replace(/^[$£€¥₹]/, '').replace(/%$/, '');
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(str)) return null;
    const num = parseFloat(str);
    if (!isFinite(num)) return null;
    return negative ? -num : num;
  },

  /* ---------- Dates ---------- */

  /**
   * Days from the spreadsheet epoch to 1970-01-01. Excel, Sheets and LibreOffice
   * all count from 1899-12-30 — a day earlier than they claim, because 1900 is
   * treated as a leap year for compatibility with Lotus 1-2-3.
   */
  SERIAL_EPOCH: -2209161600000,

  MONTH_NAMES: ['january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'],

  /**
   * Coerce a value to a `Date`, or null when it is not one.
   *
   * The sibling of `toNumber`, and **the one date parser in the app**.
   * `Csv.isDateish` asks it what counts as a date and `Formatters.parseDate`
   * asks it what a date *is*, so the two cannot disagree about a value. They
   * did: `isDateish` accepted `14/05/2013`, `new Date` called it invalid, and
   * the column typed as dates while the Date format silently did nothing to it.
   *
   * **Nothing here goes through `new Date(string)`.** The engine's string
   * parser is locale-flavoured and largely unspecified: it reads `3/05/2016`
   * month-first with no way to ask for the other, rejects `14/05/2013`
   * outright, and disagrees with itself across browsers on most of the rest.
   * Every shape below is matched explicitly and built from its parts.
   *
   * A value is local time unless it carries a `Z` or a `±HH:MM` offset, which
   * is honoured. A bare date is midnight local, so the day it prints is the day
   * it was written and never one either side of it.
   *
   * @param {*} value
   * @param {Object} [opts]
   * @param {'dmy'|'mdy'|null} [opts.order] - how to read `3/05/2016` when the
   *   numbers alone cannot say. A value that settles it — `14/05/2013` — always
   *   settles it, whatever this says. Omitted means month-first, which is how
   *   the engine and gt both read it.
   * @param {boolean} [opts.serial] - accept a bare number as a spreadsheet
   *   serial. Off by default, or every numeric column would be dates.
   * @param {boolean} [opts.timeOnly] - accept a bare `09:30`, dated today.
   * @returns {Date|null}
   */
  toDate(value, opts) {
    opts = opts || {};
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (Util.isMissing(value)) return null;

    const str = String(value).trim();
    if (!str) return null;

    const split = Util.splitTime(str);
    const parts = split.date ? Util.dateParts(split.date, opts) : null;

    if (!parts) {
      // Nothing but a clock face. Only the time formatters want this; for
      // everyone else `09:30` is a number with a colon in it.
      if (!split.time || split.date || !opts.timeOnly) return null;
      const now = new Date();
      return Util.dateAt(
        { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() }, split.time);
    }

    return Util.dateAt(parts, split.time);
  },

  /**
   * A trailing clock time, split off whatever date shape precedes it.
   *
   * Done first and separately so each date shape below is written once rather
   * than once bare and once with a time glued to the end of it.
   *
   * @returns {{date: string, time: Object|null}}
   */
  splitTime(str) {
    const match = /(?:^|[\sT])(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(?:([ap])\.?m\.?)?\s*(Z|[+-]\d{1,2}:?\d{2})?$/i
      .exec(str);
    if (!match) return { date: str, time: null };

    let hour = Number(match[1]);
    const half = match[5] ? match[5].toLowerCase() : null;
    if (half === 'p' && hour < 12) hour += 12;
    if (half === 'a' && hour === 12) hour = 0;
    if (hour > 23) return { date: str, time: null };

    const zone = match[6];
    let offset = null;
    if (zone) {
      if (/^z$/i.test(zone)) {
        offset = 0;
      } else {
        const sign = zone[0] === '-' ? -1 : 1;
        const digits = zone.slice(1).replace(':', '');
        offset = sign * (Number(digits.slice(0, digits.length - 2)) * 60 +
          Number(digits.slice(-2)));
      }
    }

    return {
      // Whatever joined the two — a comma, a `T`, spaces — belongs to neither.
      date: str.slice(0, match.index).replace(/[\s,T]+$/, ''),
      time: {
        h: hour,
        mi: Number(match[2]),
        s: match[3] ? Number(match[3]) : 0,
        ms: match[4] ? Math.round(Number('0.' + match[4]) * 1000) : 0,
        offset: offset
      }
    };
  },

  /**
   * The year, month and day of a date written without a time.
   *
   * Ordered widest-net-last: every shape that says outright which number is
   * the year is tried before the one that has to be told.
   *
   * @returns {{y, m, d}|null} month is 1-based
   */
  dateParts(str, opts) {
    let m;

    // 2024-03-08, 2024/03/08, 2024.03.08 — the year leads, so nothing to guess.
    m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(str);
    if (m) return { y: +m[1], m: +m[2], d: +m[3] };

    // 2024-03. A month is a date once a day is assumed, and gt has a
    // `month_year` style to show it with.
    m = /^(\d{4})[-/](\d{1,2})$/.exec(str);
    if (m) return { y: +m[1], m: +m[2], d: 1 };

    // 2024 March 8 — the `year_month_day` style this app itself emits.
    m = /^(\d{4})\s+([A-Za-z]{3,})\s+(\d{1,2})$/.exec(str);
    if (m) return { y: +m[1], m: Util.monthNumber(m[2]), d: +m[3] };

    // 20240308. Ahead of the serial branch: a serial that large is the year
    // 57000, so the two can never mean the same string.
    m = /^(\d{4})(\d{2})(\d{2})$/.exec(str);
    if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) {
      return { y: +m[1], m: +m[2], d: +m[3] };
    }

    // 8-Mar-2024, 8 Mar 2024, 8 March 2024.
    m = /^(\d{1,2})(?:st|nd|rd|th)?[-\s]+([A-Za-z]{3,})[-\s,]+(\d{2,4})$/.exec(str);
    if (m) return { y: Util.fullYear(+m[3]), m: Util.monthNumber(m[2]), d: +m[1] };

    // Mar 8, 2024 / March 8 2024 / Mar-8-2024.
    m = /^([A-Za-z]{3,})[-\s]+(\d{1,2})(?:st|nd|rd|th)?[-\s,]+(\d{2,4})$/.exec(str);
    if (m) return { y: Util.fullYear(+m[3]), m: Util.monthNumber(m[1]), d: +m[2] };

    // March 2024, Mar-24.
    m = /^([A-Za-z]{3,})[-\s]+(\d{2,4})$/.exec(str);
    if (m) return { y: Util.fullYear(+m[2]), m: Util.monthNumber(m[1]), d: 1 };

    // 3/05/2016 and 14-05-2013 — the ambiguous one, so it goes last.
    // A dotted date must spell its year out in full: `1.2.3` is a version
    // number far more often than it is the 1st of February 2003.
    m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(str) ||
        /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(str);
    if (m) {
      const first = +m[1];
      const second = +m[2];
      return Util.dayFirst(first, second, opts.order)
        ? { y: Util.fullYear(+m[3]), m: second, d: first }
        : { y: Util.fullYear(+m[3]), m: first, d: second };
    }

    // A spreadsheet serial, for a column that came across as bare numbers.
    if (opts.serial && /^\d+(\.\d+)?$/.test(str)) {
      const days = Number(str);
      // 1 is 1899-12-31 and 2958465 is 9999-12-31. Outside that it is a
      // number that happens to be a number.
      if (days >= 1 && days <= 2958465) {
        return { serial: days };
      }
    }

    return null;
  },

  /**
   * Which of the first two numbers in `3/05/2016` is the day.
   *
   * **A value that settles it settles it**, whatever the caller asked for: told
   * `dmy` and handed `5/23/2024`, reading the 23 as a month gives no date at
   * all. The setting only decides the ones the numbers cannot.
   */
  dayFirst(first, second, order) {
    if (first > 12 && second <= 12) return true;
    if (second > 12 && first <= 12) return false;
    if (order === 'dmy') return true;
    if (order === 'mdy') return false;
    return false;
  },

  /** A month name or abbreviation as a 1-based number, or 0. */
  monthNumber(name) {
    const lower = String(name).toLowerCase().replace(/\.$/, '');
    for (let i = 0; i < Util.MONTH_NAMES.length; i += 1) {
      if (Util.MONTH_NAMES[i].indexOf(lower) === 0 && lower.length >= 3) return i + 1;
    }
    return 0;
  },

  /**
   * A two-digit year in full. The POSIX pivot, which R's `%y` uses too: 69–99
   * is last century, 00–68 is this one.
   */
  fullYear(year) {
    if (year >= 100) return year;
    return year < 69 ? 2000 + year : 1900 + year;
  },

  /**
   * Build the `Date`, and refuse the ones that only look like dates.
   *
   * `new Date(2024, 1, 31)` is the 2nd of March rather than an error, so every
   * field is read back: a rolled-over day means the parts were never a date.
   */
  dateAt(parts, time) {
    const t = time || { h: 0, mi: 0, s: 0, ms: 0, offset: null };

    if (parts.serial !== undefined) {
      return new Date(Util.SERIAL_EPOCH + Math.round(parts.serial * 86400000));
    }
    if (!parts.m || parts.m < 1 || parts.m > 12 || parts.d < 1 || parts.d > 31) return null;

    if (t.offset !== null) {
      const utc = new Date(0);
      utc.setUTCFullYear(parts.y, parts.m - 1, parts.d);
      utc.setUTCHours(t.h, t.mi - t.offset, t.s, t.ms);
      if (isNaN(utc.getTime())) return null;
      return utc;
    }

    const date = new Date(0);
    // Through `setFullYear`, because the two-argument `Date` constructor maps
    // years 0–99 onto 1900–1999 and a year 50 date is a year 50 date.
    date.setFullYear(parts.y, parts.m - 1, parts.d);
    date.setHours(t.h, t.mi, t.s, t.ms);
    if (isNaN(date.getTime())) return null;
    if (date.getFullYear() !== parts.y || date.getMonth() !== parts.m - 1 ||
        date.getDate() !== parts.d) {
      return null;
    }
    return date;
  },

  /** True when a value counts as missing (NA / NaN / empty / null). */
  isMissing(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'number') return !isFinite(value);
    const str = String(value).trim();
    return str === '' || str === 'NA' || str === 'N/A' || str === 'NaN' ||
      str === 'null' || str === 'NULL' || str === '.';
  },

  /* ---------- Timing ---------- */

  /** Trailing-edge debounce. */
  debounce(fn, ms) {
    let timer = null;
    return function debounced() {
      const args = arguments;
      const self = this;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(self, args), ms);
    };
  },

  /** Coalesce calls into the next animation frame. */
  raf(fn) {
    let pending = false;
    return function scheduled() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; fn(); });
    };
  },

  /* ---------- CSS values ---------- */

  /** Normalise a CSS length: bare numbers become px, `%`/`px`/`em` pass through. */
  cssLength(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback || null;
    const str = String(value).trim();
    if (/^-?[\d.]+$/.test(str)) return str + 'px';
    return str;
  },

  /** Strip the unit off a CSS length, returning a number (or null). */
  cssNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const match = String(value).match(/-?[\d.]+/);
    return match ? parseFloat(match[0]) : null;
  },

  /* ---------- Files ---------- */

  /** Trigger a browser download of a Blob or string. */
  download(filename, content, mime) {
    const blob = content instanceof Blob
      ? content
      : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = Util.el('a', { href: url, download: filename });
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  /** Copy text to the clipboard, resolving to true on success. */
  async copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Fallback for file:// and older browsers, where the async API is blocked.
      const area = Util.el('textarea', { style: { position: 'fixed', opacity: '0' } });
      area.value = text;
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      document.body.removeChild(area);
      return ok;
    }
  },

  /** Read a File as text. */
  readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  },

  /* ---------- Feedback ---------- */

  /** Show a transient toast. `kind` is '', 'ok' or 'error'. */
  toast(message, kind, ms) {
    const host = document.getElementById('toast-host');
    if (!host) return;
    const node = Util.el('div.toast' + (kind ? ' is-' + kind : ''), { text: message });
    host.appendChild(node);
    setTimeout(() => {
      node.style.transition = 'opacity 0.2s';
      node.style.opacity = '0';
      setTimeout(() => node.remove(), 220);
    }, ms || (kind === 'error' ? 4200 : 2000));
  },

  /** Write the left-hand status bar message. */
  status(message) {
    const node = document.getElementById('status-left');
    if (node) node.textContent = message;
  }
};
