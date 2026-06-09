// Dropdown autocomplete for the three filter boxes (title / author / tag).
//
// Each box becomes a combobox: typing shows a ranked suggestion menu, which can
// be navigated with the keyboard or clicked. Authors and tags are suggested from
// the corpus dictionaries ranked by article frequency; titles are matched
// directly against the article titles. Committing a suggestion fills the input
// and applies the filter (the existing case-insensitive "contains" semantics —
// a chosen name is a substring of itself, so the filter still matches).
import { appState, ELEMENTS } from "./state.js";
import { applyFilter } from "./filter.js";
import { debounce } from "./utils.js";

const MAX_SUGGEST = 8; // menu rows
let dicts = null; // lazily-built { author:[], tag:[] } ranked by frequency

// Build frequency-ranked suggestion dictionaries once, after data has loaded.
function buildDicts() {
  const meta = appState.meta;
  const N = appState.count;

  const authorFreq = new Int32Array(meta.authorDict.length);
  for (let i = 0; i < N; i++) for (const a of meta.authors[i]) authorFreq[a]++;
  const author = meta.authorDict
    .map((name, i) => ({ name, lc: name.toLowerCase(), count: authorFreq[i] }))
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count);

  // tagCanon: lc -> { name (most common casing), f (frequency) }
  const tag = [...appState.tagCanon.values()]
    .map((v) => ({ name: v.name, lc: v.name.toLowerCase(), count: v.f }))
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count);

  dicts = { author, tag };
}

// Rank candidates for a query: prefix matches first, then other substring
// matches; each group keeps the underlying (frequency) order of `list`.
function rankDict(list, q) {
  if (!q) return list.slice(0, MAX_SUGGEST);
  const pre = [];
  const sub = [];
  for (const d of list) {
    const at = d.lc.indexOf(q);
    if (at === 0) pre.push(d);
    else if (at > 0) sub.push(d);
  }
  return pre.concat(sub).slice(0, MAX_SUGGEST);
}

// Titles are matched on the fly against the prebuilt lowercased title column.
// Prefer prefix hits, then earliest match position, then shorter titles.
function rankTitles(q) {
  if (!q) return [];
  const { titleLC, meta, count } = appState;
  const hits = [];
  for (let i = 0; i < count; i++) {
    const at = titleLC[i].indexOf(q);
    if (at >= 0) hits.push({ name: meta.title[i], at, len: meta.title[i].length });
  }
  hits.sort((a, b) => a.at - b.at || a.len - b.len);
  return hits.slice(0, MAX_SUGGEST);
}

function suggestFor(kind, q) {
  if (kind === "title") return rankTitles(q);
  return rankDict(dicts[kind], q);
}

// Wire one input as a combobox. `kind` selects the suggestion source; `key` is
// the appState.filter field it drives.
function attach(input, kind, key) {
  const node = input.node();
  const field = node.closest(".field");
  field.classList.add("ac-field");

  const menu = document.createElement("ul");
  menu.className = "ac-menu";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;
  field.appendChild(menu);

  node.setAttribute("role", "combobox");
  node.setAttribute("aria-autocomplete", "list");
  node.setAttribute("aria-expanded", "false");

  const wrap = node.closest(".field-input");
  const clearBtn = wrap ? wrap.querySelector(".field-clear") : null;
  const updateClear = () => wrap && wrap.classList.toggle("has-value", node.value.length > 0);

  let items = []; // current suggestion objects
  let active = -1; // highlighted index, or -1

  const commitFilter = debounce((v) => {
    appState.filter[key] = v;
    applyFilter();
  }, 160);

  function close() {
    menu.hidden = true;
    menu.innerHTML = "";
    items = [];
    active = -1;
    node.setAttribute("aria-expanded", "false");
  }

  function setActive(i) {
    active = i;
    [...menu.children].forEach((el, k) => {
      el.classList.toggle("active", k === active);
      if (k === active) el.scrollIntoView({ block: "nearest" });
    });
  }

  function render(q) {
    items = suggestFor(kind, q);
    if (!items.length) {
      close();
      return;
    }
    menu.innerHTML = "";
    items.forEach((d, i) => {
      const li = document.createElement("li");
      li.className = "ac-item";
      li.setAttribute("role", "option");

      const name = document.createElement("span");
      name.className = "ac-name";
      name.textContent = d.name;
      li.appendChild(name);

      if (d.count != null) {
        const c = document.createElement("span");
        c.className = "ac-count";
        c.textContent = d.count.toLocaleString();
        li.appendChild(c);
      }

      // mousedown (not click) so the choice commits before the input blurs.
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        choose(i);
      });
      menu.appendChild(li);
    });
    active = -1;
    menu.hidden = false;
    node.setAttribute("aria-expanded", "true");
  }

  function choose(i) {
    const d = items[i];
    if (!d) return;
    node.value = d.name;
    appState.filter[key] = d.name;
    updateClear();
    close();
    applyFilter();
  }

  function clearField() {
    node.value = "";
    appState.filter[key] = "";
    updateClear();
    close();
    applyFilter();
  }

  node.addEventListener("input", () => {
    const v = node.value;
    updateClear();
    render(v.trim().toLowerCase());
    commitFilter(v); // keep live filtering on every keystroke
  });

  node.addEventListener("focus", () => {
    if (node.value.trim() || kind !== "title") render(node.value.trim().toLowerCase());
  });

  if (clearBtn) {
    // mousedown so the clear fires before the input's blur closes the menu
    clearBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      clearField();
      node.focus();
    });
  }
  updateClear(); // initial state

  node.addEventListener("blur", () => close());

  node.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (menu.hidden) render(node.value.trim().toLowerCase());
      else if (items.length) setActive((active + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length) setActive((active - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      if (active >= 0) {
        e.preventDefault();
        choose(active);
      }
    } else if (e.key === "Escape") {
      if (!menu.hidden) {
        e.preventDefault();
        e.stopPropagation(); // don't trigger the global reset
        close();
      }
    }
  });
}

export function setupAutocomplete() {
  buildDicts();
  attach(ELEMENTS.titleInput, "title", "title");
  attach(ELEMENTS.authorInput, "author", "author");
  attach(ELEMENTS.tagInput, "tag", "tag");
}
