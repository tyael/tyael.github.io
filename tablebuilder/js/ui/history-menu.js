/**
 * ui/history-menu.js
 *
 * The list behind the undo arrows: everything done since the data was
 * imported, newest first, with the current position marked. Clicking an entry
 * moves straight to that state.
 *
 * Two arrows tell you nothing about where you are or what you are about to
 * undo. The list is the same timeline the arrows walk — `Store.entries()` —
 * so it cannot disagree with them.
 */

const HistoryMenu = {

  toggle() {
    const button = Util.qs('#btn-history');
    Popover.toggle(button, () => HistoryMenu.body(), { className: 'history-menu' });
  },

  body() {
    const wrap = Util.el('div.history-menu-body');
    const entries = Store.entries();

    wrap.appendChild(Util.el('div.export-menu-group', { text: 'History' }));

    if (entries.length === 1) {
      wrap.appendChild(Util.el('div.export-menu-note', { text: 'Nothing done yet.' }));
      return wrap;
    }

    const list = Util.el('div.history-list');

    // Newest first: the thing you are about to undo is the thing you are most
    // likely to be looking for, and it sits under the pointer.
    for (const entry of entries.slice().reverse()) {
      const row = Util.el('button.history-item' +
        (entry.current ? '.is-current' : '') +
        (entry.future ? '.is-future' : ''), {
        type: 'button',
        title: entry.current ? 'Where you are now' : 'Go back to just after this',
        on: { click: () => { Popover.close(); Store.jumpTo(entry.index); } }
      });

      row.appendChild(Util.el('span.history-mark', { text: entry.current ? '▸' : '' }));
      row.appendChild(Util.el('span.history-label', { text: entry.label }));
      row.appendChild(Util.el('span.history-time', { text: HistoryMenu.clock(entry.at) }));
      list.appendChild(row);
    }

    wrap.appendChild(list);

    wrap.appendChild(Util.el('div.export-menu-hint', {
      text: entries.length - 1 + ' change' + (entries.length === 2 ? '' : 's') +
        ' since the data was loaded. Undo history is not saved with the project.'
    }));

    return wrap;
  },

  clock(at) {
    if (!at) return '';
    const d = new Date(at);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
};
