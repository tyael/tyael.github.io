import { SOURCE_NAME, dayToDate } from "./config.js";
import { appState, ELEMENTS } from "./state.js";
import { escapeHtml, formatDate } from "./utils.js";
import { renderMap } from "./map.js";

// Select a point: drives the detail panel and the on-map citation edges.
export function selectArticle(i) {
  appState.selectedId = i;
  renderDetail();
  renderMap();
}

export function clearSelection() {
  if (appState.selectedId == null) return;
  appState.selectedId = null;
  renderDetail();
  renderMap();
}

function articleRow(i) {
  const { meta, source } = appState;
  const src = SOURCE_NAME[source[i]].toLowerCase();
  return `<li><a href="#" data-goto="${i}">${escapeHtml(meta.title[i])}</a>
    <span class="src-badge ${src}">${SOURCE_NAME[source[i]]}</span></li>`;
}

export function renderDetail() {
  const i = appState.selectedId;
  const panel = ELEMENTS.detailPanel;
  if (i == null) {
    panel.classed("open", false).html("");
    return;
  }
  const { meta, source, date, backlinks } = appState;
  const src = SOURCE_NAME[source[i]];
  const out = meta.links[i];
  const inc = backlinks[i];

  const tagsHtml = meta.tags[i]
    .map((t) => {
      const name = meta.tagDict[t];
      return `<button class="detail-tag" data-tag-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`;
    })
    .join("");
  const authors = meta.authors[i].map((a) => escapeHtml(meta.authorDict[a])).join(", ") || "—";

  panel.classed("open", true).html(`
    <button class="detail-close" title="Close">×</button>
    <div class="detail-head">
      <span class="src-badge ${src.toLowerCase()}">${src}</span>
      <span class="detail-date">${formatDate(dayToDate(date[i]))}</span>
    </div>
    <a class="detail-title" href="${escapeHtml(meta.url[i])}" target="_blank" rel="noopener">
      ${escapeHtml(meta.title[i])}</a>
    <div class="detail-authors">${authors}</div>
    <div class="detail-tags">${tagsHtml}</div>
    ${out.length ? `<div class="detail-links"><h4>Links to (${out.length})</h4><ul>${out.map(articleRow).join("")}</ul></div>` : ""}
    ${inc.length ? `<div class="detail-links backlinks"><h4>Linked from (${inc.length})</h4><ul>${inc.map(articleRow).join("")}</ul></div>` : ""}
  `);

  panel.select(".detail-close").on("click", clearSelection);
  panel.selectAll("a[data-goto]").on("click", (e) => {
    e.preventDefault();
    selectArticle(+e.currentTarget.dataset.goto);
  });
  panel.selectAll("button[data-tag-name]").on("click", (e) => {
    const name = e.currentTarget.dataset.tagName;
    appState.filter.tag = name;
    if (ELEMENTS.tagInput) ELEMENTS.tagInput.property("value", name);
    import("./filter.js").then((m) => m.applyFilter());
  });
}
