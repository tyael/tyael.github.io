import { appState, ELEMENTS } from "./state.js";
import { loadData } from "./data.js";
import { setupMap, resizeMap, resetZoom, pickPoint, setProjection } from "./map.js";
import { setupTimeline, resizeTimeline, setupDateInputs } from "./timeline.js";
import { renderLeaderboards } from "./leaderboards.js";
import { applyFilter, resetFilters } from "./filter.js";
import { selectArticle, clearSelection, renderDetail } from "./detail.js";
import { showTooltip, hideTooltip } from "./tooltip.js";
import { setupAutocomplete } from "./autocomplete.js";
import { debounce } from "./utils.js";

function initElements() {
  const $ = (id) => d3.select(id);
  Object.assign(ELEMENTS, {
    loading: $("#loading"),
    mapContainer: $("#map-container"),
    canvas: $("#map-canvas"),
    svg: $("#map-svg"),
    labelsGroup: $("#labels-group"),
    linksGroup: $("#links-group"),
    tooltip: $("#tooltip"),
    detailPanel: $("#detail-panel"),
    timeline: $("#timeline"),
    timelineSvg: $("#timeline-svg"),
    tagList: $("#tag-list"),
    authorList: $("#author-list"),
    titleInput: $("#f-title"),
    authorInput: $("#f-author"),
    tagInput: $("#f-tag"),
    dateFrom: $("#date-from"),
    dateTo: $("#date-to"),
    brandSub: $("#brand-sub"),
    resultCount: $("#result-count"),
    resetBtn: $("#reset"),
    srcButtons: d3.selectAll(".src-toggle"),
    projButtons: d3.selectAll(".proj-btn"),
  });
}

function setupInteractions() {
  ELEMENTS.svg
    .on("mousemove", (event) => {
      const [mx, my] = d3.pointer(event, ELEMENTS.svg.node());
      const i = pickPoint(mx, my);
      appState.hoveredId = i;
      if (i == null) hideTooltip();
      else showTooltip(i, event.clientX, event.clientY);
    })
    .on("mouseleave", hideTooltip)
    .on("click", (event) => {
      const [mx, my] = d3.pointer(event, ELEMENTS.svg.node());
      const i = pickPoint(mx, my);
      if (i == null) clearSelection();
      else selectArticle(i);
    });

  ELEMENTS.srcButtons.on("click", function () {
    const code = +this.dataset.src;
    appState.filter.source = appState.filter.source === code ? null : code;
    applyFilter();
  });

  ELEMENTS.projButtons.on("click", async function () {
    const p = this.dataset.proj;
    if (p === appState.projection || appState.transitioning) return;
    ELEMENTS.projButtons.classed("active", function () {
      return this.dataset.proj === p;
    });
    await setProjection(p);
  });

  ELEMENTS.resetBtn.on("click", () => {
    resetFilters();
    clearSelection();
  });

  d3.select(document).on("keydown", (e) => {
    if (e.key === "Escape") {
      if (appState.selectedId != null) clearSelection();
      else resetFilters();
    }
  });

  ELEMENTS.svg.on("dblclick", () => resetZoom());

  window.addEventListener(
    "resize",
    debounce(() => {
      resizeMap();
      resizeTimeline();
      renderLeaderboards();
    }, 200),
  );
}

async function init() {
  initElements();
  try {
    await loadData();
    ELEMENTS.projButtons.classed("active", function () {
      return this.dataset.proj === appState.projection;
    });
    setupMap();
    setupTimeline();
    setupDateInputs();
    setupAutocomplete();
    renderLeaderboards();
    renderDetail();
    applyFilter();
    setupInteractions();
    ELEMENTS.loading.classed("hidden", true);
    console.log(`Loaded ${appState.count} articles`);
  } catch (err) {
    console.error("Init failed:", err);
    ELEMENTS.loading.text("Failed to load data — see console.");
  }
}

init();
