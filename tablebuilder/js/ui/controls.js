/**
 * ui/controls.js
 *
 * The widget factory every panel is built from.
 *
 * Panels are rebuilt wholesale whenever the spec changes, which keeps them
 * trivially correct but would throw away whatever the user was in the middle
 * of. Three things guard against that, and they are not the same thing:
 *
 *   - **Nothing is rebuilt out from under a live interaction.** A caret, an
 *     open colour picker and a press waiting for its click all live *on* a DOM
 *     node and die with it. `Controls.busy` is what the render loop asks
 *     before it destroys a panel; a rebuild refused there is held until the
 *     interaction ends.
 *   - **A burst of edits commits once.** `Controls.defer` holds the value
 *     until the typing stops, so the spec never sees `#a` on the way to
 *     `#aaaaaa`, and the whole table is not recomputed per character.
 *   - **The caret survives the rebuilds that cannot be held.** Each control
 *     carries a stable `data-ctl` key, and `rememberFocus`/`restoreFocus` put
 *     it back. That is for undo, redo and opening a file — the changes that
 *     happen *to* the user rather than because of them.
 */

const Controls = {

  /* ================================================================
     Focus preservation across rebuilds
     ================================================================ */

  _focus: null,

  /** Record which control has focus, and where the caret is. */
  rememberFocus(root) {
    const active = document.activeElement;
    if (!active || !root.contains(active) || !active.dataset || !active.dataset.ctl) {
      Controls._focus = null;
      return;
    }
    Controls._focus = {
      key: active.dataset.ctl,
      start: active.selectionStart,
      end: active.selectionEnd,
      scroll: root.scrollTop
    };
  },

  /** Put the caret back after a rebuild. */
  restoreFocus(root) {
    const saved = Controls._focus;
    if (!saved) return;
    Controls._focus = null;

    root.scrollTop = saved.scroll;
    const node = root.querySelector('[data-ctl="' + CSS.escape(saved.key) + '"]');
    if (!node) return;

    node.focus();
    if (saved.start !== null && saved.start !== undefined && node.setSelectionRange) {
      try { node.setSelectionRange(saved.start, saved.end); } catch (e) { /* not a text input */ }
    }
  },

  /* ================================================================
     Live interaction: what a rebuild must not interrupt
     ================================================================ */

  /**
   * True between a pointer going down and the click it produces.
   *
   * A rebuild inside that window removes the button before its `click` fires,
   * and the click is then silently lost — the event goes to whichever ancestor
   * survived, so the handler simply never runs. Every way a press can end
   * clears this, including the ones that never reach `click` (a drag that ends
   * in a drop, a press cancelled by a scroll, a window that loses focus mid
   * press), because a flag stuck true here would freeze the panels for good.
   */
  _pressed: false,

  _onIdle: null,

  /**
   * Watch for the end of an interaction, and say so.
   *
   * @param {Function} onIdle - called a task after a press or a focus ends
   */
  watch(onIdle) {
    Controls._onIdle = onIdle;

    const release = () => {
      // A task later, not now: `pointerup`, `mouseup` and `click` are one
      // dispatch, and clearing the flag inside it would let a rebuild land
      // between the press and the click it is about to become.
      setTimeout(() => {
        Controls._pressed = false;
        // A press that reaches the document is the page being used, which a
        // native picker's own window never is: whatever was open is closed.
        Controls._picking = null;
        if (Controls._onIdle) Controls._onIdle();
      }, 0);
    };

    document.addEventListener('pointerdown', () => { Controls._pressed = true; }, true);
    for (const ended of ['pointerup', 'pointercancel', 'dragend', 'drop', 'click']) {
      document.addEventListener(ended, release, false);
    }
    window.addEventListener('blur', release);

    // Focus leaving a field ends an edit without ending a press, so it needs
    // its own drain. Whether anything is actually free to rebuild is still
    // `busy`'s answer, asked again on the far side of the timeout.
    document.addEventListener('focusout', () => setTimeout(() => {
      if (Controls._onIdle) Controls._onIdle();
    }, 0), true);
  },

  /**
   * Is the user mid-edit in a control inside `root`?
   *
   * A caret in a text box is the obvious one. The other is a native colour
   * picker: it is a browser window rather than anything in the document, there
   * is no event for it opening or closing, and the only trace of it on this
   * side is that its swatch holds the focus. Destroy the swatch and the picker
   * goes with it — which is exactly what used to happen on the first character
   * typed into the picker's own hex box, since Chrome pads a partial hex out
   * to a whole colour (`a` becomes `#00000a`) and reports it as you type.
   */
  isEditing(root) {
    const active = document.activeElement;
    if (!active || !root.contains(active)) return false;
    if (active.tagName === 'TEXTAREA') return true;
    if (active.tagName !== 'INPUT') return false;
    return /^(text|search|number|color)$/.test(active.type);
  },

  /**
   * The swatch whose native picker may still be open, and when it last said so.
   *
   * `isEditing` finds an open picker by the focus, which is where Chrome keeps
   * it while the picker is up. No browser is obliged to: the picker is a
   * native window, and one that took the focus with it would leave its swatch
   * looking idle while it is anything but — and the swatch would then be
   * destroyed on the first value it reported, which is the whole bug. A swatch
   * that reported a value a moment ago is in use whatever the focus says.
   *
   * Held to the swatch itself, and dropped on the first press that reaches the
   * document, so this cannot quietly freeze the rest of the panel: a picker's
   * own window sends no events here, so a press *is* the page being used
   * again. Being wrong costs one rebuild's delay; being wrong the other way
   * costs the picker.
   */
  _picking: null,
  _pickedAt: 0,
  _pickerTimer: null,
  PICKER_GRACE_MS: 1500,

  /** A swatch reporting a value: its picker is open, whatever the focus says. */
  picking(node) {
    Controls._picking = node;
    Controls._pickedAt = Date.now();
    clearTimeout(Controls._pickerTimer);
    // Nothing announces a picker closing, so the grace has to expire on its
    // own — and expiring silently would leave the held rebuild sitting there
    // until the user happened to click something.
    Controls._pickerTimer = setTimeout(() => {
      if (Controls._onIdle) Controls._onIdle();
    }, Controls.PICKER_GRACE_MS + 50);
  },

  /** Everything a rebuild of `root` would interrupt, in one question. */
  busy(root) {
    if (Controls._pressed) return true;
    if (Controls._picking && root.contains(Controls._picking) &&
        Date.now() - Controls._pickedAt < Controls.PICKER_GRACE_MS) {
      return true;
    }
    return Controls.isEditing(root);
  },

  /* ================================================================
     Deferred commits
     ================================================================ */

  /**
   * How long a burst of edits may run before it lands in the spec.
   *
   * A commit is not cheap — it clones the spec, recomputes the model and
   * rebuilds the preview — but the reason for waiting is not the cost. It is
   * that a half-typed value is not a value. `#a`, `#aa` and `#aaa` are not
   * colours anyone asked for, `-` is not a number, and each of them used to be
   * written into the spec and rendered.
   */
  COMMIT_MS: 220,

  /** What a reader returns for an input that is not a value yet. */
  SKIP: { skip: true },

  /**
   * The one edit in flight. There is one caret, so one slot is enough, and
   * anything that needs the spec current can ask for it by name.
   */
  _pending: null,

  /** Commit whatever is waiting, now. */
  flushPending() { if (Controls._pending) Controls._pending.flush(); },

  /** Throw away whatever is waiting — the spec it was typed against is gone. */
  cancelPending() { if (Controls._pending) Controls._pending.cancel(); },

  /**
   * Wrap a commit so a burst of values lands once.
   *
   * Trailing by default, which is what typing wants: nothing reaches the spec
   * until the burst ends. `opts.lead` commits the first value at once and then
   * no more than one per `wait`, which is what dragging a colour picker wants
   * — every value there is already a whole colour, and watching it change is
   * the point.
   *
   * @param {Function} commit
   * @param {Object} [opts] - {lead, wait}
   * @returns {{push: Function, flush: Function, cancel: Function}}
   */
  defer(commit, opts) {
    opts = opts || {};
    const wait = opts.wait === undefined ? Controls.COMMIT_MS : opts.wait;
    const entry = { timer: null, value: undefined, held: false, at: 0 };

    entry.flush = () => {
      clearTimeout(entry.timer);
      entry.timer = null;
      if (Controls._pending === entry) Controls._pending = null;
      if (!entry.held) return;
      entry.held = false;
      entry.at = Date.now();
      commit(entry.value);
    };

    entry.cancel = () => {
      clearTimeout(entry.timer);
      entry.timer = null;
      entry.held = false;
      if (Controls._pending === entry) Controls._pending = null;
    };

    entry.push = (value) => {
      // Moving to another box ends the burst in the one just left, rather than
      // stranding it: the slot holds one edit, and the other one is real.
      if (Controls._pending && Controls._pending !== entry) Controls.flushPending();
      entry.value = value;
      entry.held = true;
      Controls._pending = entry;
      if (opts.lead && Date.now() - entry.at >= wait) { entry.flush(); return; }
      clearTimeout(entry.timer);
      entry.timer = setTimeout(entry.flush, wait);
    };

    return entry;
  },

  /**
   * Wire an input so a run of edits commits once.
   *
   * @param {Element} node
   * @param {Function} read - node => the value to commit, or `Controls.SKIP`
   *   for an intermediate state the spec should not see
   * @param {Function} onChange
   * @param {Object} [opts] - {lead, wait, changeEnds}
   */
  live(node, read, onChange, opts) {
    opts = opts || {};
    const pending = Controls.defer(onChange, opts);

    node.addEventListener('input', () => {
      const value = read(node);
      if (value !== Controls.SKIP) pending.push(value);
    });

    // The end of a burst, whatever the clock says.
    node.addEventListener('blur', pending.flush);
    node.addEventListener('keydown', (e) => { if (e.key === 'Enter') pending.flush(); });

    // `change` means blur-or-Enter on a text box and nothing more — but on a
    // colour swatch Chrome fires it for every value the picker passes through,
    // which would leave the interval doing nothing at all. `changeEnds: false`
    // is that case.
    if (opts.changeEnds !== false) node.addEventListener('change', pending.flush);

    return node;
  },

  /* ================================================================
     Layout
     ================================================================ */

  /** A collapsible section. `key` persists the open/closed state. */
  section(title, children, opts) {
    opts = opts || {};
    const key = 'section.' + (opts.key || Util.slug(title));
    const collapsed = Controls.sectionState(key, opts.collapsed);

    const body = Util.el('div.section-body', null, children);
    const caret = Util.el('span.caret', { text: '▾' });
    const head = Util.el('div.section-head', {
      on: {
        click: () => {
          const next = !section.classList.contains('is-collapsed');
          section.classList.toggle('is-collapsed', next);
          Controls.setSectionState(key, next);
        }
      }
    }, [
      Util.el('h4', { text: title }),
      opts.action || null,
      caret
    ]);

    const section = Util.el('div.section' + (collapsed ? '.is-collapsed' : ''), null, [head, body]);
    return section;
  },

  _sectionState: null,

  sectionState(key, fallback) {
    if (!Controls._sectionState) {
      try {
        Controls._sectionState = JSON.parse(localStorage.getItem('table_builder.sections') || '{}');
      } catch (e) {
        Controls._sectionState = {};
      }
    }
    const saved = Controls._sectionState[key];
    return saved === undefined ? !!fallback : saved;
  },

  setSectionState(key, collapsed) {
    // Callers that write without having read first — App.goToPanel forcing a
    // section open — would otherwise index into null.
    if (!Controls._sectionState) Controls.sectionState(key);
    Controls._sectionState[key] = collapsed;
    try {
      localStorage.setItem('table_builder.sections', JSON.stringify(Controls._sectionState));
    } catch (e) { /* ignore */ }
  },

  /** A labelled row: label on the left, control on the right. */
  field(label, control, opts) {
    opts = opts || {};
    const nodes = [];
    if (label !== null) nodes.push(Util.el('label', { text: label, title: opts.title || label }));
    nodes.push(Array.isArray(control)
      ? Util.el('div.field-control', null, control)
      : Util.el('div.field-control', null, [control]));
    if (opts.hint) nodes.push(Util.el('div.field-hint', { text: opts.hint }));

    // A control whose effect depends on state set elsewhere stays editable —
    // disabling it would make text already in it uneditable — but says so, and
    // offers one click to the panel that turns it on.
    const req = opts.requires;
    const inert = !!(req && !req.met);
    if (inert) {
      const note = Util.el('div.field-hint.field-inert-note', null, [
        Util.el('span', { text: req.because })
      ]);
      if (req.fix) {
        note.appendChild(Util.el('button.btn.btn-mini.btn-ghost', {
          type: 'button',
          text: req.fix.label,
          on: {
            click: () => {
              // Through `setPanel`, so a fix that points at an advanced-tier
              // panel opens that tier rather than landing on a hidden tab.
              App.setPanel(req.fix.panel);
              App.renderRail();
            }
          }
        }));
      }
      nodes.push(note);
    }

    return Util.el('div.field' +
      (opts.wide || label === null ? '.field-wide' : '') +
      (inert ? '.is-inert' : ''), null, nodes);
  },

  /** A row of buttons. */
  /**
   * A row of buttons under a section or an item.
   *
   * Wraps by default — a row of five could otherwise run off the side of the
   * rail with the last two unreachable, which is what the Shape panel's step
   * types did. `opts.grid` lays them out evenly instead of ragged, for a row
   * that is really a menu of choices rather than one action and its
   * alternatives.
   */
  actions(buttons, opts) {
    return Util.el('div.row-actions' + ((opts && opts.grid) ? '.is-grid' : ''), null, buttons);
  },

  button(label, onClick, opts) {
    opts = opts || {};
    // The tag must lead: Util.el('btn.btn-primary') would build a <btn>
    // element, which is not a button and picks up none of the button styling.
    const classes = ['button', 'btn'];
    if (opts.kind) classes.push('btn-' + opts.kind);
    if (opts.block) classes.push('btn-block');
    return Util.el(classes.join('.'), {
      type: 'button',
      text: label,
      title: opts.title || '',
      disabled: opts.disabled,
      on: { click: onClick }
    });
  },

  note(text) {
    return Util.el('div.empty-note', { text: text });
  },

  intro(text) {
    return Util.el('div.panel-intro', { text: text });
  },

  /* ================================================================
     Inputs
     ================================================================ */

  text(key, value, onChange, opts) {
    opts = opts || {};
    const node = Util.el('input', {
      type: 'text',
      value: value === null || value === undefined ? '' : value,
      placeholder: opts.placeholder || '',
      dataset: { ctl: key }
    });
    return Controls.live(node, (n) => n.value, onChange);
  },

  textarea(key, value, onChange, opts) {
    opts = opts || {};
    const node = Util.el('textarea', {
      placeholder: opts.placeholder || '',
      rows: opts.rows || 3,
      dataset: { ctl: key }
    });
    Controls.live(node, (n) => n.value, onChange);
    // A textarea has no `value` attribute — its value is its child text — so
    // this must be a property assignment. Routing it through Util.el would
    // setAttribute and leave the box empty after every rebuild.
    node.value = value === null || value === undefined ? '' : value;
    return node;
  },

  number(key, value, onChange, opts) {
    opts = opts || {};
    const node = Util.el('input', {
      type: 'number',
      value: value === null || value === undefined ? '' : value,
      min: opts.min === undefined ? null : opts.min,
      max: opts.max === undefined ? null : opts.max,
      step: opts.step === undefined ? null : opts.step,
      placeholder: opts.placeholder || '',
      dataset: { ctl: key }
    });

    return Controls.live(node, (n) => {
      // **A number box reports what it cannot parse as an empty value.** `-`
      // on the way to `-5`, `1e` on the way to `1e6`: `node.value` is `''` for
      // all of them, exactly as it is for a box the user has cleared, and
      // `validity.badInput` is the only thing that tells the two apart. Read
      // by value alone, every one of those keystrokes committed 0 — and the
      // box, rebuilt from the spec, then had that 0 sitting in front of
      // whatever was typed next. It is why a negative number could not be
      // typed into any of these boxes at all.
      if (n.validity && n.validity.badInput) return Controls.SKIP;

      const raw = n.value;
      if (raw === '') return opts.nullable ? null : 0;
      const num = parseFloat(raw);
      return isFinite(num) ? num : Controls.SKIP;
    }, onChange);
  },

  select(key, options, value, onChange, opts) {
    opts = opts || {};
    const node = Util.el('select', { dataset: { ctl: key }, on: { change: (e) => onChange(e.target.value) } });

    if (opts.placeholder) {
      node.appendChild(Util.el('option', { value: '', text: opts.placeholder }));
    }
    for (const option of options) {
      const optValue = typeof option === 'string' ? option : option.value;
      const optLabel = typeof option === 'string'
        ? ((opts.labels && opts.labels[option]) || option)
        : option.label;
      node.appendChild(Util.el('option', { value: optValue, text: optLabel }));
    }

    node.value = value === null || value === undefined ? '' : String(value);
    return node;
  },

  checkbox(key, value, onChange, label) {
    const input = Util.el('input', {
      type: 'checkbox',
      checked: !!value,
      dataset: { ctl: key },
      on: { change: (e) => onChange(e.target.checked) }
    });
    if (!label) return input;
    return Util.el('label.switch', null, [input, Util.el('span', { text: label })]);
  },

  /**
   * A colour control: swatch plus free text, so 'transparent', 'rgba(...)' and
   * a picked hex all work.
   */
  color(key, value, onChange, opts) {
    opts = opts || {};
    const swatch = Util.el('input', {
      type: 'color',
      value: Palettes.toHexInput(value, '#000000'),
      dataset: { ctl: key + '.swatch' }
    });

    const field = Util.el('input', {
      type: 'text',
      value: value === null || value === undefined ? '' : value,
      placeholder: opts.placeholder || (opts.nullable ? 'not set' : '#000000'),
      dataset: { ctl: key },
      style: { fontFamily: 'var(--font-mono)', fontSize: '11px' }
    });

    // The swatch leads: dragging in the picker is meant to be watched, and
    // every value it reports is already a whole colour, so the first lands at
    // once and the rest at no more than one per frame or so.
    Controls.live(swatch, (n) => n.value, onChange,
      { lead: true, wait: 60, changeEnds: false });

    // The two boxes keep each other current directly, because neither can be
    // refreshed from the spec while the other has the focus — that is the
    // whole point of `busy`. Before, the swatch left the hex box behind and
    // only a rebuild caught it up.
    swatch.addEventListener('input', () => {
      Controls.picking(swatch);
      field.value = swatch.value;
    });

    Controls.live(field, (n) => n.value, onChange);
    field.addEventListener('input', () => {
      const parsed = Palettes.parse(field.value);
      if (parsed) swatch.value = Palettes.toHex(parsed);
    });

    const nodes = [swatch, field];
    if (opts.nullable) {
      nodes.push(Util.el('button.btn.btn-mini.btn-ghost', {
        text: '✕',
        title: 'Clear',
        on: {
          click: () => {
            // Whatever was half-typed is what this is clearing.
            Controls.cancelPending();
            onChange('');
          }
        }
      }));
    }
    return nodes;
  },

  /** A CSS length: free text, because '12px', '90%' and '1.2em' are all valid. */
  length(key, value, onChange, opts) {
    opts = opts || {};
    const node = Util.el('input', {
      type: 'text',
      value: value === null || value === undefined ? '' : value,
      placeholder: opts.placeholder || 'e.g. 12px',
      dataset: { ctl: key },
      style: { fontFamily: 'var(--font-mono)', fontSize: '11px' }
    });
    return Controls.live(node, (n) => n.value, onChange);
  },

  /**
   * Font picker: the built-in stacks, whatever the user has added, and a
   * button to add more (a Google family, an installed face, or a font file).
   */
  fonts(key, value, onChange, opts) {
    opts = opts || {};
    const available = Fonts.all();

    const node = Util.el('select', {
      dataset: { ctl: key },
      on: { change: (e) => onChange(e.target.value) }
    });

    if (opts.nullable) node.appendChild(Util.el('option', { value: '', text: 'inherit' }));

    const addGroup = (label, entries) => {
      if (!entries.length) return;
      const group = Util.el('optgroup', { label: label });
      for (const entry of entries) {
        group.appendChild(Util.el('option', {
          value: entry.id,
          text: entry.label,
          style: { fontFamily: entry.stack }
        }));
      }
      node.appendChild(group);
    };

    addGroup('Built in', available.builtin);
    addGroup('Your fonts', available.custom);

    // A font referenced by the spec but no longer in the registry (a project
    // opened after its font was removed) still needs to be selectable.
    if (value && !Fonts.get(value)) {
      node.appendChild(Util.el('option', { value: value, text: value + '  (missing)' }));
    }

    node.value = value === null || value === undefined ? '' : String(value);

    return [
      node,
      Util.el('button.btn.btn-mini', {
        text: '+',
        title: 'Add a font',
        on: { click: () => FontManager.open((id) => onChange(id)) }
      })
    ];
  },

  /* ================================================================
     Column pickers
     ================================================================ */

  /**
   * A set of toggleable column chips.
   *
   * `opts.ordered` hands back the order they were clicked in and numbers each
   * selected chip, for the callers where that order carries meaning: the
   * pivot's `nameCols` runs outer to inner, and `idCols` decides which column
   * becomes the row group and which the row label. Everywhere else the order
   * says nothing, and the source order is the steadier thing to return.
   *
   * The chips themselves stay in source order in both modes — re-sorting them
   * as they are picked would move the one under the pointer.
   *
   * @param {Array} columns - [{id, label}]
   * @param {Array} selected - selected ids
   */
  columnChips(key, columns, selected, onChange, opts) {
    opts = opts || {};
    const picked = (selected || []).filter((id) => columns.some((c) => c.id === id));
    const chosen = new Set(picked);

    const chips = columns.map((col) => {
      const on = chosen.has(col.id);
      const rank = opts.ordered && on ? picked.indexOf(col.id) + 1 : 0;
      const label = col.label || col.id;

      return Util.el('span.chip' + (on ? '.is-on' : ''), {
        title: col.id + (rank ? ' — ' + rank + ' of ' + picked.length : ''),
        on: {
          click: () => {
            if (opts.single) {
              onChange(on ? [] : [col.id]);
              return;
            }
            const next = on
              ? picked.filter((id) => id !== col.id)
              : picked.concat([col.id]);
            onChange(opts.ordered
              ? next
              : columns.filter((c) => next.indexOf(c.id) >= 0).map((c) => c.id));
          }
        }
      }, rank ? [Util.el('span.chip-rank', { text: String(rank) }), label] : label);
    });

    if (!chips.length) return Controls.note(opts.emptyText || 'no columns');

    const nodes = [Util.el('div.chip-set', null, chips)];
    // `All` is dropped for an ordered picker: the order it would pick in is
    // whatever the file happened to be in, which is exactly the thing an
    // ordered picker exists to let you choose. `None` stays everywhere,
    // because it is the only way back to the blank state without clicking
    // every chip — and blank is a meaningful state in half these callers.
    if (!opts.single && columns.length > 2) {
      const buttons = [];
      if (!opts.ordered) {
        buttons.push(Controls.button('All', () => onChange(columns.map((c) => c.id)), { kind: 'ghost' }));
      }
      buttons.push(Controls.button('None', () => onChange([]), { kind: 'ghost' }));
      nodes.push(Util.el('div.row-actions', null, buttons));
    }
    return Util.el('div', null, nodes);
  },

  /** A single-column dropdown with a "none" entry. */
  columnSelect(key, columns, value, onChange, opts) {
    opts = opts || {};
    const options = columns.map((col) => ({ value: col.id, label: col.label || col.id }));
    return Controls.select(key, options, value || '', (next) => onChange(next || null),
      { placeholder: opts.placeholder || '— none —' });
  },

  /* ================================================================
     Item lists
     ================================================================ */

  /**
   * A reorderable list of items.
   * @param {Array} items
   * @param {Function} renderItem - (item, index) -> Node for the item's body
   * @param {Object} opts - {onReorder, onRemove, title, subtitle, key}
   */
  itemList(items, renderItem, opts) {
    opts = opts || {};
    if (!items.length) return Controls.note(opts.emptyText || 'nothing here yet');

    const list = Util.el('div.item-list');

    items.forEach((item, index) => {
      const head = Util.el('div.item-head');

      let handle = null;
      if (opts.onReorder) {
        handle = Util.el('span.item-drag', { text: '⠿', title: 'Drag to reorder' });
        head.appendChild(handle);
      }

      // Collapse is per item and remembered, so a long list stays scannable
      // across rebuilds. See `Controls.itemStateKey` for what identifies an
      // item — the list and the collapse-all control must agree, and deriving
      // it in two places is how they stopped agreeing once already.
      const stateKey = opts.collapsible ? Controls.itemStateKey(opts.key, item, index) : null;
      const startCollapsed = stateKey ? Controls.sectionState(stateKey, false) : false;

      let caret = null;
      if (opts.collapsible) {
        caret = Util.el('span.item-caret', { text: '▾', title: 'Show or hide the details' });
        head.appendChild(caret);
      }

      const title = Util.el('div.item-title' + (opts.collapsible ? '.is-clickable' : ''), {
        text: opts.title ? opts.title(item, index) : ('Item ' + (index + 1)),
        title: opts.collapsible ? 'Show or hide the details' : ''
      });
      head.appendChild(title);

      // A short standing fact about the item — where it came from, what owns
      // it — as against `subtitle`, which describes what it does. It lives in
      // the head because the head is what stays visible when an item is
      // collapsed, and `.item-sub` is `nowrap` with an ellipsis, so a sentence
      // put there would be cut off exactly when it mattered.
      const badge = opts.badge ? opts.badge(item, index) : null;
      if (badge) {
        head.appendChild(Util.el('span.item-badge', {
          text: badge.text,
          title: badge.title || ''
        }));
      }

      // An item whose toggle cannot do anything says so, once, from one place.
      // `opts.toggleInert` returns `{because, fix}` or null; the checkbox and
      // the note below both read it, so they cannot describe different reasons.
      const inert = opts.toggleInert ? opts.toggleInert(item, index) : null;

      if (opts.onToggle) {
        const box = Controls.checkbox(
          (opts.key || 'item') + '.' + index + '.on',
          opts.enabled ? opts.enabled(item) : true,
          (on) => opts.onToggle(item, index, on)
        );
        if (inert) {
          // Genuinely disabled, unlike `Controls.field`'s inert text controls —
          // those stay editable because disabling one would trap whatever had
          // already been typed into it. A checkbox holds nothing, so a control
          // that visibly moves and changes nothing is the worse option.
          box.disabled = true;
          box.title = inert.because;
        }
        head.appendChild(box);
      }

      if (opts.onRemove) {
        head.appendChild(Util.el('button.btn.btn-mini.btn-ghost', {
          text: '✕',
          title: 'Remove',
          on: { click: (e) => { e.stopPropagation(); opts.onRemove(item, index); } }
        }));
      }

      const node = Util.el('div.item' + (startCollapsed ? '.is-collapsed' : ''), null, [head]);

      if (opts.collapsible) {
        const toggle = () => {
          const next = !node.classList.contains('is-collapsed');
          node.classList.toggle('is-collapsed', next);
          Controls.setSectionState(stateKey, next);
        };
        // The title and the caret, not the whole head: the head also carries
        // the enable checkbox and the remove button, and a click on either of
        // those is not a request to collapse.
        title.addEventListener('click', toggle);
        caret.addEventListener('click', toggle);
      }
      if (opts.subtitle) {
        const sub = opts.subtitle(item, index);
        if (sub) node.appendChild(Util.el('div.item-sub', { text: sub }));
      }

      if (inert) {
        const note = Util.el('div.item-inert-note', null, [
          Util.el('span', { text: inert.because })
        ]);
        if (inert.fix) {
          note.appendChild(Util.el('button.btn.btn-mini.btn-ghost', {
            type: 'button',
            text: inert.fix.label,
            on: {
              click: (e) => {
                e.stopPropagation();
                App.goToPanel(inert.fix.panel, inert.fix.section);
              }
            }
          }));
        }
        node.appendChild(note);
      }

      const body = renderItem(item, index);
      if (body) node.appendChild(Util.el('div.item-body', null, [body]));

      if (opts.onReorder) Controls.makeDraggable(node, list, index, opts.onReorder, handle);
      list.appendChild(node);
    });

    return list;
  },

  /**
   * Where an item's collapsed state is remembered.
   *
   * Identified by whatever the item is, in preference to where it sits: an
   * object's `id`, a plain string list's own value (the columns list is a list
   * of column ids), and only then the index. Keyed by index, reordering the
   * list would leave the collapsed state behind on whatever moved into the
   * slot.
   */
  itemStateKey(listKey, item, index) {
    const id = (item && item.id) || (typeof item === 'string' ? item : null);
    return 'item.' + (listKey || 'item') + '.' + (id === null ? index : id);
  },

  /**
   * A collapse-all / expand-all control for a section holding a collapsible
   * list, to be passed as that section's `action`.
   *
   * It offers whichever is useful: *Expand all* only when everything is
   * already collapsed, *Collapse all* otherwise — so a half-collapsed list
   * offers the one that tidies it. Nothing is offered for a list of one,
   * where both would be a no-op.
   */
  collapseAll(listKey, items) {
    if (!items || items.length < 2) return null;

    const keys = items.map((item, index) => Controls.itemStateKey(listKey, item, index));
    const allCollapsed = keys.every((key) => Controls.sectionState(key, false));

    return Util.el('button.btn.btn-mini.btn-ghost', {
      type: 'button',
      text: allCollapsed ? 'Expand all' : 'Collapse all',
      title: allCollapsed ? 'Show every item' : 'Hide the details of every item',
      on: {
        click: (e) => {
          // The section head is itself a toggle, and this button sits inside
          // it — without this the section would close on the way past.
          e.stopPropagation();
          for (const key of keys) Controls.setSectionState(key, !allCollapsed);
          App.renderRail();
        }
      }
    });
  },

  /**
   * Wire up HTML5 drag-and-drop reordering for one item.
   *
   * **The item is only draggable while the pointer is on its handle.** An
   * ancestor carrying `draggable="true"` makes the browser treat a mousedown
   * inside it as the start of a drag rather than as a caret placement, so
   * every text field inside a reorderable item lost click-to-position and
   * drag-to-select: you could focus it and move about with the arrow keys, but
   * not click into the middle of what you had typed. That is every field in a
   * style rule, footnote, source note, format rule, colour rule, spanner,
   * merge and sort key — the `⠿` was decorative and the whole item was the
   * drag source.
   *
   * The flag goes up on mousedown over the handle and comes down when the drag
   * ends, or on any mouseup, so a press that never becomes a drag leaves
   * nothing latched.
   */
  makeDraggable(node, list, index, onReorder, handle) {
    node.setAttribute('draggable', 'false');
    node.dataset.index = index;

    const disarm = () => node.setAttribute('draggable', 'false');
    const arm = () => {
      node.setAttribute('draggable', 'true');
      // On the document, and once: a press that ends anywhere at all must put
      // the flag back, or the item stays draggable and takes the next click
      // meant for a field inside it.
      document.addEventListener('mouseup', disarm, { once: true });
    };

    if (handle) {
      handle.addEventListener('mousedown', arm);
    } else {
      // No handle to grab: keep the old whole-item behaviour rather than
      // silently making the list unorderable.
      node.setAttribute('draggable', 'true');
    }

    node.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
      node.classList.add('is-dragging');
    });

    node.addEventListener('dragend', () => {
      node.classList.remove('is-dragging');
      if (handle) disarm();
      for (const other of Util.qsa('.item', list)) other.classList.remove('is-drop-target');
    });

    node.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      node.classList.add('is-drop-target');
    });

    node.addEventListener('dragleave', () => node.classList.remove('is-drop-target'));

    node.addEventListener('drop', (e) => {
      e.preventDefault();
      node.classList.remove('is-drop-target');
      const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
      const to = parseInt(node.dataset.index, 10);
      if (isFinite(from) && isFinite(to) && from !== to) onReorder(from, to);
    });
  },

  /* ================================================================
     Schema-driven controls
     ================================================================ */

  /**
   * Build the control for one option-schema entry. This is what lets the
   * options panel cover the whole tab_options() surface without hand-written
   * markup per option.
   */
  forOption(option, value, onChange) {
    const key = 'opt.' + option.key;

    switch (option.type) {
      case 'bool':
        return Controls.checkbox(key, value, onChange);
      case 'color':
        return Controls.color(key, value, onChange, { nullable: option.nullable });
      case 'select':
        return Controls.select(key, option.enum, value, onChange, { labels: option.enumLabels });
      case 'fonts':
        return Controls.fonts(key, value, onChange);
      case 'len':
        return Controls.length(key, value, onChange, { placeholder: String(option.default) });
      case 'text':
      default:
        return Controls.text(key, value, onChange, { placeholder: String(option.default || '') });
    }
  },

  /**
   * The three controls of one border — style, width, colour — on one row.
   *
   * A border is one decision ("is there a line here, how heavy, what colour")
   * that gt spells as three arguments, and 81 of the 154 options are these
   * triplets. Composing them is presentation only: each control writes its own
   * key through `onSet`, so nothing downstream knows composites exist.
   *
   * Returns an array, which `Controls.field` already wraps in a flex
   * `.field-control` row.
   *
   * @param {string} key - focus-key prefix; the three controls take .style,
   *   .width and .color under it
   * @param {{style: string, width: string, color: string}} values
   * @param {Function} onSet - (role, value) => void, role is 'style'|'width'|'color'
   * @param {{widthPlaceholder?: string}} [opts] - `widthPlaceholder` overrides
   *   the width box's empty-value placeholder (default '1px'). Pass the
   *   option's own default — `Grand border`'s is '6px', and an empty box
   *   claiming '1px' would be wrong for it.
   * @returns {Array<Node>}
   */
  borderRow(key, values, onSet, opts) {
    opts = opts || {};
    const style = Controls.select(key + '.style', OptionsSchema.BORDER_STYLES,
      values.style, (value) => onSet('style', value));
    style.classList.add('border-style');

    const width = Controls.length(key + '.width', values.width,
      (value) => onSet('width', value), { placeholder: opts.widthPlaceholder || '1px' });
    width.classList.add('border-width');

    // color() returns [swatch, text]; the text box is the one that must shrink.
    const color = Controls.color(key + '.color', values.color,
      (value) => onSet('color', value));
    color[color.length - 1].classList.add('border-color');

    return [style, width].concat(color);
  },

  /** Build the control for one formatter parameter. */
  /**
   * A control for one schema param.
   *
   * `opts.unset` names the "not set" state and makes it reachable — a style
   * rule's properties are all optional, and a select with no empty option
   * rendered blank when unset and could never be put back. It is passed by the
   * caller rather than read off the param because the same params are used for
   * number formats and summaries, where there is nothing to inherit from and
   * an empty option would be a lie.
   */
  forParam(param, value, onChange, keyPrefix, opts) {
    const key = (keyPrefix || 'param') + '.' + param.key;
    const unset = (opts && opts.unset) || null;

    switch (param.type) {
      case 'bool':
        return Controls.checkbox(key, value, onChange);
      case 'select':
        return Controls.select(key, param.enum, value, onChange,
          { labels: param.enumLabels, placeholder: unset });
      case 'int':
        return Controls.number(key, value, onChange,
          { min: param.min, max: param.max, step: 1, nullable: true });
      case 'number':
        return Controls.number(key, value, onChange,
          { min: param.min, max: param.max, step: 'any', nullable: true });
      case 'color':
        return Controls.color(key, value, onChange,
          { nullable: !!unset, placeholder: unset });
      case 'fonts':
        return Controls.fonts(key, value, onChange, { nullable: true });
      case 'len':
        return Controls.length(key, value, onChange, { placeholder: unset });
      case 'text':
      default:
        return Controls.text(key, value, onChange, { placeholder: String(param.default || '') });
    }
  },

  /** A palette picker showing each palette as a gradient strip. */
  /**
   * The palette list, with the strip underneath showing what it looks like.
   *
   * `opts.custom` adds a *Custom* entry and the colours to draw for it — the
   * caller owns those stops, so the picker is handed the ramp rather than
   * working it out, and the strip is right for both kinds without this knowing
   * what a stop is.
   */
  palettePicker(key, value, onChange, opts) {
    opts = opts || {};
    const wrap = Util.el('div', { style: { width: '100%' } });

    const entries = Palettes.all().map((p) => ({
      value: p.id, label: p.id + '  (' + p.kind + ')'
    }));
    if (opts.custom) entries.unshift({ value: 'custom', label: 'Custom — your own colours' });

    const select = Controls.select(key, entries, value, onChange);
    wrap.appendChild(select);

    const colors = value === 'custom' && opts.custom ? opts.custom : Palettes.byName(value);
    const strip = Util.el('div', {
      style: {
        height: '11px',
        marginTop: '4px',
        borderRadius: '2px',
        border: '1px solid var(--border-subtle)',
        background: 'linear-gradient(to right, ' + Palettes.ramp(colors, 12).join(', ') + ')'
      }
    });
    wrap.appendChild(strip);

    return wrap;
  }
};
