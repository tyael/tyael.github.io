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

  /** Shallow equality over own enumerable keys. */
  shallowEqual(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => a[k] === b[k]);
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
