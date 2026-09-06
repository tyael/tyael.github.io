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
  _key: null,
  _onClose: null,

  /**
   * Is this popover the open one?
   *
   * By node identity, unless the caller supplied a `key`. A popover whose
   * contents commit to the spec outlives the button that opened it: the commit
   * rebuilds the panel, the anchor is replaced by an identical new node, and
   * identity then says the popover belongs to something else — so pressing the
   * button again reopened it instead of closing it, which looked like a
   * flicker and left the editor up. A key is whatever the caller has that
   * survives a rebuild; `data-ctl` is what the panels already use for exactly
   * this, being the name `Controls.restoreFocus` puts a caret back by.
   */
  isOpen(anchor, key) {
    if (!Popover._node) return false;
    if (key) return Popover._key === key;
    return anchor ? Popover._anchor === anchor : true;
  },

  /**
   * Show `content` under `anchor`.
   *
   * @param {Element} anchor - the button it belongs to
   * @param {Element} content - the body; built by the caller
   * @param {Object} [opts]
   * @param {string} [opts.className] - extra class on the popover
   * @param {string} [opts.focusFirst] - selector for what takes the focus,
   *   for a popover whose first control is not the one to start in
   * @param {string} [opts.key] - identity that outlives a rebuilt anchor
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
    Popover._key = opts.key || null;
    Popover._onClose = opts.onClose || null;

    Popover.position();
    anchor.setAttribute('aria-expanded', 'true');

    // Deferred: the click that opened this is still propagating and would
    // reach the dismiss handler on its way up, closing what it just opened.
    setTimeout(() => document.addEventListener('click', Popover._onDocClick), 0);
    window.addEventListener('resize', Popover.close);

    // The first control is the right place to land in a menu, where every
    // control is a choice. It is the wrong place in anything that is really
    // one field with buttons around it — the markup editor's toolbar comes
    // first in the DOM and the text is what you came to type in.
    const first = Util.qs(opts.focusFirst || 'button, select, input', node);
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
    Popover._key = null;
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
    opts = opts || {};
    if (Popover.isOpen(anchor, opts.key)) { Popover.close(); return null; }
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

  /**
   * Close, unless the click landed on the popover or on its own anchor.
   *
   * The anchor is spared because its own handler is about to toggle: closing
   * here first would leave that toggle looking at a shut popover and opening
   * it straight back up.
   *
   * Three ways to recognise it, because an anchor does not always survive to
   * be compared. The node itself is the direct question. A `key` and an `id`
   * are names that outlive a panel rebuild, which replaces the anchor with an
   * identical new node. And an anchor with none of them used to take the whole
   * handler down: `Popover._anchor.id` is `''` rather than undefined when a
   * button has no id, `'#' + ''` is not a selector, and `closest` throws on a
   * bad selector rather than returning null — so the exception escaped before
   * `close()`, and a popover on an id-less anchor could not be dismissed by
   * clicking away from it at all.
   */
  _onDocClick(e) {
    if (Popover._node && Popover._node.contains(e.target)) return;

    const anchor = Popover._anchor;
    if (anchor && anchor.contains && anchor.contains(e.target)) return;
    if (!e.target.closest) { Popover.close(); return; }

    if (Popover._key) {
      const named = e.target.closest('[data-popover-key]');
      if (named && named.dataset.popoverKey === Popover._key) return;
    }
    if (anchor && anchor.id && e.target.closest('#' + CSS.escape(anchor.id))) return;

    Popover.close();
  }
};
