/**
 * ui/markup-editor.js
 *
 * The popover that writes `markup.js`'s language: a toolbar, the text itself,
 * and a live preview of what the table will draw.
 *
 * **It is a textarea with buttons, not a `contenteditable`.** Six node types
 * round-trip losslessly, so a WYSIWYG surface is tractable here in a way it is
 * not in general — and it would still be the wrong shape. `contenteditable`
 * has no `selectionStart`, and `Controls.rememberFocus` carries a caret across
 * a panel rebuild as exactly that: two integers, put back with
 * `setSelectionRange`. A second kind of caret would need a second path through
 * the one mechanism every live-typing control in the app depends on, and
 * `restoreFocus` already swallows a failure there in a `try` — so the day it
 * broke, it would break quietly. The rest is the usual `contenteditable` tax:
 * `<div>` and `<span style>` on paste, sup/sub that behave differently per
 * engine, and `document.execCommand` deprecated with nothing behind it.
 *
 * What WYSIWYG is normally bought for is seeing the result, and the preview
 * gives that: it is drawn by `Markup.toDom`, the same call the table cell
 * makes, so it cannot drift from what the table draws.
 *
 * A toolbar press goes through `Controls.live` by dispatching `input`, exactly
 * as a keystroke does. That is the whole reason it is safe: there is one path
 * from this box to the spec, so the burst already in flight cannot land on top
 * of a press a fifth of a second later.
 */

const MarkupEditor = {

  /**
   * The toolbar. `wrap` is what goes either side of the selection; `link` is
   * the one that needs an address as well as a label and so opens a form.
   *
   * The labels are the conventional glyphs, because those are what a toolbar is
   * read for; the *title* on each one carries the mark it writes. That is the
   * half that matters here — this editor is the only place in the app that
   * teaches the language, and a user who picks up `^{ }` from a tooltip can
   * then type it into any of the boxes the button is not beside.
   */
  ACTIONS: [
    { label: 'B', title: 'Bold — **text**', wrap: ['**', '**'], className: 'is-bold' },
    { label: 'I', title: 'Italic — *text*', wrap: ['*', '*'], className: 'is-italic' },
    { label: 'x²', title: 'Superscript — ^{text}', wrap: ['^{', '}'] },
    { label: 'x₂', title: 'Subscript — _{text}', wrap: ['_{', '}'] },
    { label: '‹›', title: 'Monospace — `text`', wrap: ['`', '`'] },
    { label: '↵', title: 'Line break — <br>', insert: '<br>' },
    { label: '🔗', title: 'Link — [text](url)', link: true }
  ],

  /* ================================================================
     The field a panel puts on screen
     ================================================================ */

  /**
   * A markup-bearing field: the box the panel already builds, and the button
   * that opens this editor on the same value.
   *
   * The control arrives built rather than described, because every caller
   * already knows whether it wants one row or four, what its placeholder says
   * and which key its focus is restored by — and none of that is the editor's
   * business.
   *
   * The value is read off the box when the button is pressed and never
   * captured here. A burst of typing has not reached the spec yet, so an
   * editor opened on the value this field was built from would silently
   * discard whatever was typed just before the button was clicked.
   *
   * @param {string|null} label - the field label, and the editor's own heading
   * @param {Element} control - a `Controls.text` or `Controls.textarea`
   * @param {Function} onChange - the same commit the control was given
   * @param {Object} [opts] - passed through to `Controls.field`
   */
  field(label, control, onChange, opts) {
    opts = opts || {};

    const button = Util.el('button.btn.btn-mini.btn-ghost.markup-open', {
      type: 'button',
      text: 'Aa',
      title: 'Rich text — bold, italic, superscript, subscript, code and links',
      'aria-label': 'Rich text editor' + (label ? ' for ' + label : ''),
      // Stamped on the button rather than only remembered by the popover, so
      // that the *rebuilt* button is recognisable as this editor's anchor
      // while the editor is open. Without it the document handler closes on
      // the click and the button's own handler reopens on the same one.
      dataset: { popoverKey: MarkupEditor.keyFor(control, label) }
    });

    button.addEventListener('click', () => MarkupEditor.open(button, {
      heading: opts.editorHeading || label || 'Text',
      control: control,
      onChange: onChange
    }));

    return Controls.field(label,
      [Util.el('div.markup-field', null, [control, button])], opts);
  },

  /* ================================================================
     The popover
     ================================================================ */

  /**
   * Open the editor under `anchor`, on the value in `opts.control`.
   *
   * `Popover.toggle` builds only on the way open, so the value is read at that
   * moment rather than at the moment the panel was rendered.
   */
  open(anchor, opts) {
    return Popover.toggle(anchor, () => MarkupEditor.build(opts), {
      className: 'markup-editor',
      focusFirst: 'textarea.markup-area',
      // Every commit from this editor rebuilds the panel behind it and
      // replaces the button it hangs from, so the popover has to be known by
      // something steadier than that button. The control's own focus key is
      // exactly that — it is what `Controls.restoreFocus` finds a box by after
      // the same rebuild.
      key: MarkupEditor.keyFor(opts.control, opts.heading)
    });
  },

  /**
   * What this field's editor is known by, across a rebuild of the field.
   *
   * The control's own focus key, which is the name `Controls.restoreFocus`
   * already finds a box by after exactly the same rebuild — so there is one
   * answer to "which field is this" rather than two that can disagree.
   */
  keyFor(control, heading) {
    return 'markup:' + ((control.dataset && control.dataset.ctl) || heading || '');
  },

  build(opts) {
    const body = Util.el('div.markup-body');

    body.appendChild(Util.el('div.markup-heading', { text: opts.heading }));

    const area = Util.el('textarea.markup-area', {
      rows: 4,
      placeholder: opts.control.placeholder || '',
      spellcheck: 'false'
    });
    // A textarea has no `value` attribute — its value is its child text — so
    // this is a property assignment rather than anything Util.el could do.
    area.value = opts.control.value === undefined || opts.control.value === null
      ? '' : String(opts.control.value);

    // The same wiring every box in the app has: a burst of edits lands once,
    // when it ends, and blur or Enter ends it early. The panel's own box is
    // rebuilt from the spec on that commit, so the two never disagree.
    Controls.live(area, (n) => n.value, opts.onChange);

    const preview = Util.el('div.markup-preview');
    const linkForm = MarkupEditor.linkForm(area, () => MarkupEditor.draw(area, preview));

    body.appendChild(MarkupEditor.toolbar(area, preview, linkForm));
    body.appendChild(area);
    body.appendChild(linkForm.node);
    body.appendChild(Util.el('div.markup-preview-label', { text: 'Preview' }));
    body.appendChild(preview);

    area.addEventListener('input', () => MarkupEditor.draw(area, preview));
    MarkupEditor.draw(area, preview);

    return body;
  },

  toolbar(area, preview, linkForm) {
    const bar = Util.el('div.markup-bar');

    for (const action of MarkupEditor.ACTIONS) {
      bar.appendChild(Util.el('button.btn.btn-mini.markup-btn' +
        (action.className ? '.' + action.className : ''), {
        type: 'button',
        text: action.label,
        title: action.title,
        on: {
          // Without this the button takes the focus on the way down and the
          // textarea's selection stops being drawn, so the wrap lands on a
          // range the user can no longer see. Preventing the default keeps
          // the caret where it was and where the wrap is about to go.
          mousedown: (e) => e.preventDefault(),
          click: () => {
            if (action.link) { linkForm.toggle(); return; }
            linkForm.hide();
            if (action.insert) MarkupEditor.insert(area, action.insert);
            else MarkupEditor.wrap(area, action.wrap[0], action.wrap[1]);
            MarkupEditor.draw(area, preview);
          }
        }
      }));
    }

    return bar;
  },

  /* ================================================================
     Editing the text
     ================================================================ */

  /**
   * Put `text` in place of the selection, move the caret, and tell the control.
   *
   * The dispatched `input` is not decoration. `Controls.live` is what turns a
   * value into a deferred commit, so going through it means a toolbar press
   * and a keystroke reach the spec by one path. Calling `onChange` here
   * instead would be a second path, and the burst already in flight would land
   * on top of the press a fifth of a second later — which is exactly the fault
   * `Controls.cancelPending` exists to paper over elsewhere.
   *
   * @param {Element} area
   * @param {string} text - what replaces the selection
   * @param {number} caretIn - where the caret goes, from the start of `text`
   * @param {number} caretLen - how much of it stays selected
   */
  replace(area, text, caretIn, caretLen) {
    const start = area.selectionStart;
    const end = area.selectionEnd;

    area.value = area.value.slice(0, start) + text + area.value.slice(end);

    area.focus();
    const caret = start + caretIn;
    area.setSelectionRange(caret, caret + caretLen);

    area.dispatchEvent(new Event('input', { bubbles: true }));
  },

  /** Wrap the selection, leaving it selected inside its new delimiters. */
  wrap(area, before, after) {
    const selected = area.value.slice(area.selectionStart, area.selectionEnd);
    MarkupEditor.replace(area, before + selected + after, before.length, selected.length);
  },

  /** Drop a construct in that takes no text, like a line break. */
  insert(area, text) {
    MarkupEditor.replace(area, text, text.length, 0);
  },

  /* ================================================================
     Links
     ================================================================ */

  /**
   * The two-field form the link button reveals.
   *
   * A link is the one construct that needs something the selection cannot
   * supply, so it is the one that cannot be a plain wrap. The label is
   * pre-filled from the selection, which is what makes "select the words, click
   * the button, paste the address" work.
   */
  linkForm(area, redraw) {
    const text = Util.el('input.markup-link-text', { type: 'text', placeholder: 'Text' });
    const url = Util.el('input.markup-link-url', { type: 'text', placeholder: 'https://…' });
    const error = Util.el('div.field-hint.is-warn.markup-link-error', { hidden: true });

    const node = Util.el('div.markup-link', { hidden: true });

    const hide = () => { node.hidden = true; error.hidden = true; };

    const submit = () => {
      const address = Markup.normaliseUrl(url.value);
      if (!address) {
        error.textContent = 'Needs a web or email address — https://example.org, ' +
          'example.org or name@example.org. Anything else is left as plain text.';
        error.hidden = false;
        url.focus();
        return;
      }

      const markup = Markup.linkMarkup(text.value || address, address);
      if (!markup) {
        error.textContent = 'That link text cannot be written as a link — an unmatched ' +
          '“]” in it would close the label early.';
        error.hidden = false;
        text.focus();
        return;
      }

      hide();
      MarkupEditor.replace(area, markup, 0, markup.length);
      redraw();
    };

    for (const box of [text, url]) {
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
        if (e.key === 'Escape') { e.preventDefault(); hide(); area.focus(); }
      });
    }

    node.appendChild(Util.el('div.markup-link-row', null, [text, url]));
    node.appendChild(Util.el('div.markup-link-row.is-actions', null, [
      Controls.button('Insert', submit, { kind: 'primary' }),
      Controls.button('Cancel', () => { hide(); area.focus(); }, { kind: 'ghost' })
    ]));
    node.appendChild(error);

    return {
      node: node,
      hide: hide,
      toggle: () => {
        if (!node.hidden) { hide(); area.focus(); return; }
        // Pre-filled from the selection, and the address box takes the focus,
        // because the selection is usually the label already.
        text.value = area.value.slice(area.selectionStart, area.selectionEnd);
        error.hidden = true;
        node.hidden = false;
        url.focus();
      }
    };
  },

  /* ================================================================
     The preview
     ================================================================ */

  /**
   * Draw the text as the table would.
   *
   * Through `Markup.toDom`, which is the call `RenderHtml.fillText` makes, so
   * this cannot show something the cell will not. Links are drawn and inert —
   * a live one here would navigate the whole editor away, the same reason the
   * table preview suppresses them.
   */
  draw(area, preview) {
    Util.clear(preview);

    if (!area.value) {
      preview.appendChild(Util.el('span.markup-preview-empty', { text: 'Nothing yet' }));
      return;
    }

    preview.appendChild(Markup.toDom(area.value));
  }
};
