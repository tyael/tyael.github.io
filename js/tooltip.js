import { SOURCE_NAME, dayToDate } from "./config.js";
import { appState, ELEMENTS } from "./state.js";
import { escapeHtml, formatDate } from "./utils.js";

export function showTooltip(i, clientX, clientY) {
  const { meta, source, date } = appState;
  const src = SOURCE_NAME[source[i]];
  const authors = meta.authors[i].map((a) => escapeHtml(meta.authorDict[a])).join(", ");
  ELEMENTS.tooltip
    .html(`
      <div class="tt-title">${escapeHtml(meta.title[i])}</div>
      ${authors ? `<div class="tt-authors">${authors}</div>` : ""}
      <div class="tt-meta"><span class="src-badge ${src.toLowerCase()}">${src}</span>
        ${formatDate(dayToDate(date[i]))}</div>`)
    .style("left", clientX + 14 + "px")
    .style("top", clientY + 14 + "px")
    .classed("visible", true);
}

export function hideTooltip() {
  ELEMENTS.tooltip.classed("visible", false);
}
