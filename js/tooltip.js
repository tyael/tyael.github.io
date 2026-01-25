import { appState, ELEMENTS } from './state.js';
import { getDirectLinkedArticles, getDirectBacklinks } from './internal-links.js';

// --- Tooltip ---
export function showTooltip(event, data, sticky = false) {
  const dateStr =
    data.date instanceof Date && !isNaN(data.date)
      ? data.date.toLocaleDateString()
      : "Unknown date";

  const authorsStr =
    data.authors.length > 0 ? data.authors.join(", ") : "Unknown";
  const tagsStr = data.tags.length > 0 ? data.tags.join(", ") : "None";

  // Title as hyperlink with source badge
  const sourceBadge = `<span class="source-badge source-${data.source.toLowerCase()}">${data.source}</span>`;
  const titleHtml = data.url
    ? `<div class="tooltip-title-row"><a href="${data.url}" target="_blank" class="tooltip-title">${data.title || "Untitled"}</a> ${sourceBadge}</div>`
    : `<div class="tooltip-title-row"><span class="tooltip-title">${data.title || "Untitled"}</span> ${sourceBadge}</div>`;

  // Get immediate linked articles (only direct links, not recursive)
  const linkedArticles = getDirectLinkedArticles(data);
  const linksSection = linkedArticles.length > 0
    ? `<div class="links outgoing-links">
        <strong>Links to:</strong>
        <ul>${linkedArticles.map((a) => {
          const aDateStr = a.date instanceof Date && !isNaN(a.date)
            ? a.date.toLocaleDateString()
            : "Unknown date";
          const aAuthorsStr = a.authors.length > 0 ? a.authors.join(", ") : "Unknown";
          const aSourceBadge = `<span class="source-badge source-${a.source.toLowerCase()}">${a.source}</span>`;
          const aTitleHtml = a.url
            ? `<a href="${a.url}" target="_blank">${a.title || "Untitled"}</a>`
            : (a.title || "Untitled");
          return `<li>${aTitleHtml} ${aSourceBadge}<span class="link-meta">${aAuthorsStr} · ${aDateStr}</span></li>`;
        }).join("")}</ul>
      </div>`
    : "";

  // Get backlinks (articles that link TO this article)
  const backlinkArticles = getDirectBacklinks(data);
  const backlinksSection = backlinkArticles.length > 0
    ? `<div class="links backlinks">
        <strong>Linked from:</strong>
        <ul>${backlinkArticles.map((a) => {
          const aDateStr = a.date instanceof Date && !isNaN(a.date)
            ? a.date.toLocaleDateString()
            : "Unknown date";
          const aAuthorsStr = a.authors.length > 0 ? a.authors.join(", ") : "Unknown";
          const aSourceBadge = `<span class="source-badge source-${a.source.toLowerCase()}">${a.source}</span>`;
          const aTitleHtml = a.url
            ? `<a href="${a.url}" target="_blank">${a.title || "Untitled"}</a>`
            : (a.title || "Untitled");
          return `<li>${aTitleHtml} ${aSourceBadge}<span class="link-meta">${aAuthorsStr} · ${aDateStr}</span></li>`;
        }).join("")}</ul>
      </div>`
    : "";

  const content = `
    ${titleHtml}
    <div class="meta">
      ${authorsStr}<br>
      ${dateStr}
    </div>
    <div class="tags">Tags: ${tagsStr}</div>
    ${linksSection}
    ${backlinksSection}
  `;

  ELEMENTS.tooltip
    .style("display", "block")
    .style("right", "20px")
    .style("top", "20px")
    .style("pointer-events", sticky ? "auto" : "none")
    .classed("sticky", sticky)
    .html(content);
}

export function hideTooltip() {
  ELEMENTS.tooltip
    .style("display", "none")
    .style("pointer-events", "none")
    .classed("sticky", false);
}

// Show secondary hover tooltip (simplified, positioned left of main tooltip)
export function showHoverTooltip(data) {
  const dateStr =
    data.date instanceof Date && !isNaN(data.date)
      ? data.date.toLocaleDateString()
      : "Unknown date";

  const authorsStr =
    data.authors.length > 0 ? data.authors.join(", ") : "Unknown";
  const tagsStr = data.tags.length > 0 ? data.tags.join(", ") : "None";

  // Title as text (no hyperlink in hover tooltip) with source badge
  const sourceBadge = `<span class="source-badge source-${data.source.toLowerCase()}">${data.source}</span>`;
  const titleHtml = `<div class="tooltip-title-row"><span class="tooltip-title">${data.title || "Untitled"}</span> ${sourceBadge}</div>`;

  const content = `
    ${titleHtml}
    <div class="meta">
      ${authorsStr}<br>
      ${dateStr}
    </div>
    <div class="tags">Tags: ${tagsStr}</div>
  `;

  // Position to the left of the main tooltip (main is at right: 20px)
  // Hover tooltip at right: 390px (20 + 350 max-width + 20 gap)
  ELEMENTS.hoverTooltip
    .style("display", "block")
    .style("right", "390px")
    .style("top", "20px")
    .html(content);
}

export function hideHoverTooltip() {
  ELEMENTS.hoverTooltip.style("display", "none");
}
