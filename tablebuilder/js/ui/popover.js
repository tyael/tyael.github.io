/**
 * ui/popover.js
 *
 * One floating panel anchored to a button, and the four ways it closes:
 * clicking the button again, clicking anywhere else, Escape, and running one
 * of its own actions.
 *
 * Extracted when the history menu became the second of these. Getting the
 * dismissal right is most of the work — the deferred document listener below
 * is not obvious, and neither is closing before an action runs — and two
 * copies of it would drift.
 *
 * Only one popover is open at a time, which is why the open one is module
 * state rather than per-caller: opening the second must close the first.
 */

const Popover = {

  _node: null,
  _anchor: null,
  _onClose: null,

  isOpen(anchor) {
    if (!Popover._node) return false;
    return anchor ? Popover._anchor === anchor : true;
  },

  /**
   * Show `content` under `anchor`.
   *
   * @param {Element} anchor - the button it belongs to
   * @param {Element} content - the body; built by the caller
   * @param {Object} [opts]
   * @param {string} [opts.className] - extra class on the popover
   * @param {Function} [opts.onClose] - called after it closes
   */
  open(anchor, content, opts) {
    opts = opts || {};
    Popover.close();
    if (!anchor) return null;

    const node = Util.el('div.popover' + (opts.className ? '.' + opts.className : ''),
      { role: 'menu' });
    node.appendChild(content);
    document.body.appendChild(node);

    Popover._node = node;
    Popover._anchor = anchor;
    Popover._onClose = opts.onClose || null;

    Popover.position();
    anchor.setAttribute('aria-expanded', 'true');

    // Deferred: the click that opened this is still propagating and would
    // reach the dismiss handler on its way up, closing what it just opened.
    setTimeout(() => document.addEventListener('click', Popover._onDocClick), 0);
    window.addEventListener('resize', Popover.close);

    const first = Util.qs('button, select, input', node);
    if (first) first.focus();

    return node;
  },

  /** Anchor under the button, right edges aligned, kept inside the viewport. */
  position() {
    const node = Popover._node;
    const anchor = Popover._anchor;
    if (!node || !anchor) return;

    const rect = anchor.getBoundingClientRect();
    node.style.top = Math.round(rect.bottom + 6) + 'px';
    const width = node.offsetWidth;
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    node.style.left = Math.round(left) + 'px';
  },

  close() {
    const node = Popover._node;
    if (!node) return;

    const anchor = Popover._anchor;
    const onClose = Popover._onClose;

    Popover._node = null;
    Popover._anchor = null;
    Popover._onClose = null;

    node.remove();
    document.removeEventListener('click', Popover._onDocClick);
    window.removeEventListener('resize', Popover.close);
    if (anchor) anchor.setAttribute('aria-expanded', 'false');
    if (onClose) onClose();
  },

  /** Close and hand focus back, for Escape and for keyboard users. */
  dismiss() {
    const anchor = Popover._anchor;
    Popover.close();
    if (anchor) anchor.focus();
  },

  /** Toggle: `build` is only called when it is about to open. */
  toggle(anchor, build, opts) {
    if (Popover.isOpen(anchor)) { Popover.close(); return null; }
    return Popover.open(anchor, build(), opts);
  },

  /**
   * Wrap an action so the popover always closes before it runs.
   *
   * Two of the export actions open the modal, and a popover left standing over
   * the backdrop is both wrong to look at and impossible to dismiss — Escape
   * belongs to the modal by then.
   */
  act(fn) {
    return () => { Popover.close(); fn(); };
  },

  _onDocClick(e) {
    if (Popover._node && Popover._node.contains(e.target)) return;
    if (Popover._anchor && e.target.closest && e.target.closest('#' + Popover._anchor.id)) return;
    Popover.close();
  }
};
