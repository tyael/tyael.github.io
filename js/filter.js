import { appState, ELEMENTS } from "./state.js";
import { renderMap } from "./map.js";
import { drawTimeline, clearTimelineBrush, syncDateInputs } from "./timeline.js";
import { renderLeaderboards } from "./leaderboards.js";

// Recompute the match mask by intersecting every active facet, then refresh all
// linked views. Text facets are case-insensitive substring ("contains") tests
// against the lowercased columns built in data.js.
export function applyFilter() {
  const { count, source, date, titleLC, authorLC, tagLC, filter } = appState;
  const mask = appState.matched;

  const tQ = filter.title.trim().toLowerCase();
  const aQ = filter.author.trim().toLowerCase();
  const gQ = filter.tag.trim().toLowerCase();
  const src = filter.source;
  const dr = filter.dateRange;

  let matchedCount = 0;
  for (let i = 0; i < count; i++) {
    let ok = 1;
    if (src !== null && source[i] !== src) ok = 0;
    else if (dr && (date[i] < dr[0] || date[i] > dr[1])) ok = 0;
    else if (tQ && !titleLC[i].includes(tQ)) ok = 0;
    else if (aQ && !authorLC[i].includes(aQ)) ok = 0;
    else if (gQ && !tagLC[i].includes(gQ)) ok = 0;
    mask[i] = ok;
    matchedCount += ok;
  }

  appState.matchedCount = matchedCount;
  updateResultCount();
  renderMap();
  drawTimeline();
  renderLeaderboards();
}

export function updateResultCount() {
  const n = appState.matchedCount;
  const total = appState.count;
  const txt =
    n === total
      ? `${total.toLocaleString()} articles`
      : `${n.toLocaleString()} of ${total.toLocaleString()} articles`;
  ELEMENTS.resultCount.text(txt);
  ELEMENTS.resetBtn.classed("active", isFiltering());
  if (ELEMENTS.srcButtons) {
    ELEMENTS.srcButtons.classed("active", function () {
      return +this.dataset.src === appState.filter.source;
    });
  }
}

export function isFiltering() {
  const f = appState.filter;
  return !!(f.title || f.author || f.tag || f.source !== null || f.dateRange);
}

export function resetFilters() {
  const f = appState.filter;
  f.title = "";
  f.author = "";
  f.tag = "";
  f.source = null;
  f.dateRange = null;
  if (ELEMENTS.titleInput) ELEMENTS.titleInput.property("value", "");
  if (ELEMENTS.authorInput) ELEMENTS.authorInput.property("value", "");
  if (ELEMENTS.tagInput) ELEMENTS.tagInput.property("value", "");
  document.querySelectorAll(".field-input.has-value").forEach((w) => w.classList.remove("has-value"));
  clearTimelineBrush();
  syncDateInputs();
  applyFilter();
}
