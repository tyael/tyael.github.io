/**
 * ui/panel-content.js
 *
 * The Content panel: every piece of prose attached to the table — title,
 * subtitle, stubhead label, caption, source notes and footnotes.
 *
 * All of these accept inline markup (see markup.js), which is what lets a
 * footnote carry a superscript or a title carry an italicised species name.
 */

const PanelContent = {

  id: 'content',
  // Non-breaking space before the ampersand: `text-wrap: balance` otherwise
  // evens the two lines as "TITLES / & NOTES", and a line may not open on an
  // ampersand. Binding it to the word before forces "TITLES & / NOTES".
  label: 'Titles\u00A0& notes',
  hint: 'Title, subtitle, caption, footnotes and source notes',

  MARKUP_HINT: '**bold**  *italic*  ^{sup}  _{sub}  `code`  <br>',

  render(spec) {
    const panel = Util.el('div.panel');

    if (!Spec.hasData(spec)) {
      panel.appendChild(Controls.note('Import data first.'));
      return panel;
    }

    panel.appendChild(PanelContent.headerSection(spec));
    panel.appendChild(PanelContent.captionSection(spec));
    panel.appendChild(PanelContent.stubheadSection(spec));
    panel.appendChild(PanelContent.footnotesSection(spec));
    panel.appendChild(PanelContent.sourceSection(spec));

    return panel;
  },

  /* ================================================================
     Header text
     ================================================================ */

  headerSection(spec) {
    const parts = spec.parts;

    const set = (key) => (value) => Store.update((draft) => {
      draft.parts[key] = value;
    }, { coalesce: 'parts.' + key });

    return Controls.section('Title & subtitle', [
      Controls.field('Title', Controls.textarea('parts.title', parts.title, set('title'),
        { rows: 2, placeholder: 'Table title' }), { wide: true }),

      Controls.field('Subtitle', Controls.textarea('parts.subtitle', parts.subtitle, set('subtitle'),
        { rows: 2, placeholder: 'Optional subtitle' }), { wide: true }),

      // This is `heading.align`, and it reaches the title and subtitle only.
      // It used to sit in a box that also held the caption and the row-label
      // header, neither of which it touches.
      Controls.field('Align', Controls.select('opt.headingAlign',
        ['center', 'left', 'right'], spec.options['heading.align'],
        (value) => Store.update((draft) => { draft.options['heading.align'] = value; }))),

      Util.el('div.field-hint', { text: PanelContent.MARKUP_HINT })
    ], { key: 'content.header' });
  },

  /* ================================================================
     Caption
     ================================================================ */

  captionSection(spec) {
    const parts = spec.parts;

    return Controls.section('Caption', [
      Controls.field(null, Controls.textarea('parts.caption', parts.caption,
        (value) => Store.update((draft) => { draft.parts.caption = value; },
          { coalesce: 'parts.caption' }),
        { rows: 2, placeholder: 'Figure caption, shown below the table' }), { wide: true }),

      Controls.field('Align', Controls.select('parts.captionAlign',
        ['center', 'left', 'right'], parts.captionAlign || 'center',
        (value) => Store.update((draft) => { draft.parts.captionAlign = value; }))),

      Util.el('div.field-hint', {
        text: 'A caption labels the figure rather than the table, so it sits below it and ' +
          'has its own alignment. It reaches the preview, the standalone HTML page, LaTeX ' +
          '\\caption{} and gt’s tab_caption() — but not the SVG, PNG or HTML fragment, ' +
          'which are the table alone.'
      }),
      Util.el('div.field-hint', { text: PanelContent.MARKUP_HINT })
    ], { key: 'content.caption' });
  },

  /* ================================================================
     Row-label header
     ================================================================ */

  stubheadSection(spec) {
    return Controls.section('Row-label header', [
      Controls.field(null, Controls.text('parts.stubhead', spec.parts.stubhead,
        (value) => Store.update((draft) => { draft.parts.stubhead = value; },
          { coalesce: 'parts.stubhead' }),
        { placeholder: 'Label for the row-label column' }),
        {
          wide: true,
          hint: 'The cell above the row labels — gt calls this the stubhead.',
          requires: {
            met: !!((Pipeline.find(spec, 'stub') || {}).col),
            because: 'Not shown yet — no Row labels step names a column.',
            fix: { panel: 'steps', label: 'Add one' }
          }
        })
    ], { key: 'content.stubhead' });
  },

  /* ================================================================
     Footnotes
     ================================================================ */

  footnotesSection(spec) {
    const notes = spec.parts.footnotes;
    const model = App.model;
    const marks = {};
    if (model && model.footnotes) {
      for (const note of model.footnotes) marks[note.id] = note.mark;
    }

    const list = Controls.itemList(notes, (note, index) => {
      const body = Util.el('div');

      body.appendChild(Controls.field(null, Controls.textarea('fn.text.' + note.id, note.text,
        (value) => Store.update((draft) => { draft.parts.footnotes[index].text = value; },
          { coalesce: 'fn.text.' + note.id }), { rows: 2, placeholder: 'Footnote text' }),
        { wide: true }));

      // A note anchored before the header was hidden cannot be refused after
      // the fact, so it is reported instead: its text is still in the footer,
      // and its mark is nowhere.
      body.appendChild(Controls.field('Attached to',
        Util.el('span.mono.dim', { text: PanelContent.describeLocation(note.location) }),
        {
          requires: {
            met: !Spec.inHiddenHeader(spec, note.location),
            because: 'This is in the header, which is hidden — the text still ' +
              'prints in the footer, but the mark is not drawn.',
            fix: { label: 'Go to Columns', panel: 'structure' }
          }
        }));

      body.appendChild(Controls.actions([
        Controls.button('Attach to selection', () => PanelContent.attachToSelection(index),
          { title: 'Point this footnote at whatever is selected in the table' }),
        note.location ? Controls.button('Detach', () => {
          Store.update((draft) => { draft.parts.footnotes[index].location = null; });
        }, { kind: 'ghost' }) : null
      ].filter(Boolean)));

      return body;
    }, {
      key: 'footnotes',
      title: (note) => (marks[note.id] ? marks[note.id] + '  ' : '') +
        (Util.truncate(Markup.toPlain(note.text), 30) || '(empty)'),
      subtitle: (note) => PanelContent.describeLocation(note.location) +
        (Spec.inHiddenHeader(spec, note.location) ? '  ·  mark not drawn' : ''),
      onRemove: (note, index) => Store.update((draft) => { draft.parts.footnotes.splice(index, 1); }),
      onReorder: (from, to) => Store.update((draft) => {
        draft.parts.footnotes = Util.moveItem(draft.parts.footnotes, from, to);
      })
    });

    const selection = Selection.current();

    return Controls.section('Footnotes', [
      Util.el('div.field-hint', {
        text: 'Select a cell, label or column group in the table, then add a footnote — it gets marked there. ' +
          'Footnotes with identical text share one mark, and marks are numbered in reading order.'
      }),
      list,
      Controls.actions([
        // Read the selection when the button is pressed, not when it was
        // built: the label can only be as fresh as the last render, but what
        // the footnote attaches to must never be.
        Controls.button(selection.length ? 'Add on selection' : 'Add footnote',
          () => PanelContent.addFootnote(Selection.current()), { kind: 'primary' })
      ]),

      Controls.field('Mark set', Controls.select('opt.fnMarks',
        ['numbers', 'letters', 'LETTERS', 'standard', 'extended'],
        spec.options['footnotes.marks'],
        (value) => Store.update((draft) => { draft.options['footnotes.marks'] = value; })),
        { hint: 'standard is * † ‡ §; extended adds ‖ ¶.' }),

      Controls.field('One per line', Controls.checkbox('opt.fnMultiline',
        spec.options['footnotes.multiline'],
        (value) => Store.update((draft) => { draft.options['footnotes.multiline'] = value; })))
    ], { key: 'content.footnotes' });
  },

  /**
   * Why this location cannot carry a mark, or null if it can.
   *
   * **gt keeps a footnote's text whatever it points at, and silently drops the
   * mark when the thing it marks is not drawn.** With the header hidden, a
   * note anchored to a column label renders as `1 A NOTE` under a table with
   * no `1` anywhere in it — checked against real gt, and the preview does
   * exactly the same. There is no reason to want a footnote on a label nobody
   * can see, so it is refused rather than explained after the fact.
   */
  anchorRefusal(spec, loc) {
    if (!Spec.inHiddenHeader(spec, loc)) return null;
    const part = StyleRules.PARTS.find((p) => p.id === loc.part);
    return (part ? part.label : loc.part) + ' is not drawn while the header is ' +
      'hidden, so the mark would have nowhere to go.';
  },

  addFootnote(selection) {
    const loc = selection.length ? PanelContent.locationOf(selection[0]) : null;
    const refused = PanelContent.anchorRefusal(Store.get(), loc);

    // The note is still made, just unattached — an unattached footnote is an
    // ordinary state, and throwing away the text someone was about to write
    // would be the ruder half of refusing.
    if (refused) Util.toast(refused + ' Added without an anchor.', 'error', 5000);

    Store.update((draft) => {
      draft.parts.footnotes.push({
        id: Util.uid('fn'),
        text: 'Footnote text',
        location: refused ? null : loc
      });
    });
  },

  attachToSelection(index) {
    const selection = Selection.current();
    if (!selection.length) {
      Util.toast('Select something in the table first', 'error');
      return;
    }

    const loc = PanelContent.locationOf(selection[0]);
    const refused = PanelContent.anchorRefusal(Store.get(), loc);
    if (refused) {
      Util.toast(refused, 'error', 5000);
      return;
    }

    Store.update((draft) => {
      draft.parts.footnotes[index].location = loc;
    });
  },

  /** A selection entry reduced to the fields a footnote location needs. */
  locationOf(sel) {
    const loc = { part: sel.part };
    if (sel.colId) loc.colId = sel.colId;
    if (sel.srcIndex !== undefined && sel.srcIndex !== null) loc.srcIndex = sel.srcIndex;
    if (sel.groupId) loc.groupId = sel.groupId;
    if (sel.spannerId) loc.spannerId = sel.spannerId;
    return loc;
  },

  describeLocation(loc) {
    if (!loc || !loc.part) return 'not attached';
    const part = StyleRules.PARTS.find((p) => p.id === loc.part);
    const bits = [part ? part.label : loc.part];
    if (loc.colId) bits.push(loc.colId);
    if (loc.srcIndex !== undefined) bits.push('row ' + (loc.srcIndex + 1));
    if (loc.groupId) bits.push('“' + loc.groupId + '”');
    return bits.join(' · ');
  },

  /* ================================================================
     Source notes
     ================================================================ */

  sourceSection(spec) {
    const notes = spec.parts.sourceNotes;

    const list = Controls.itemList(notes, (note, index) =>
      Controls.field(null, Controls.textarea('sn.text.' + note.id, note.text,
        (value) => Store.update((draft) => { draft.parts.sourceNotes[index].text = value; },
          { coalesce: 'sn.text.' + note.id }), { rows: 2, placeholder: 'Source: …' }),
        { wide: true }),
    {
      key: 'sourceNotes',
      title: (note) => Util.truncate(Markup.toPlain(note.text), 34) || '(empty)',
      onRemove: (note, index) => Store.update((draft) => { draft.parts.sourceNotes.splice(index, 1); }),
      onReorder: (from, to) => Store.update((draft) => {
        draft.parts.sourceNotes = Util.moveItem(draft.parts.sourceNotes, from, to);
      })
    });

    return Controls.section('Source notes', [
      list,
      Controls.button('Add source note', () => {
        Store.update((draft) => {
          draft.parts.sourceNotes.push({ id: Util.uid('sn'), text: 'Source: ' });
        });
      }, { block: true, kind: 'primary' })
    ], { key: 'content.sources' });
  }
};
