import { CONFIG } from './config.js';
import { appState, ELEMENTS } from './state.js';
import { debounce } from './utils.js';
import { setupDimensions, setupScales, setupCanvas, setupSVG } from './scales.js';
import { setupZoom } from './zoom.js';
import { setupTimeline, drawTimeline, syncTimelineBrush, updateTimelineBarColors, updateDateRangeLabel } from './timeline.js';
import { updateQuadtree, drawScatterplot } from './drawing.js';
import { updateHoverHighlight } from './internal-links.js';
import { applyFilterRules, updateFilterCount } from './filter-logic.js';
import { renderFilterRules } from './filter-builder.js';
import { closeFilterAutocomplete } from './filter-autocomplete.js';
import { showTooltip, hideTooltip, showHoverTooltip, hideHoverTooltip } from './tooltip.js';
import { updateMapLabels } from './map-labels.js';

// --- Event Handlers Setup ---
export function setupEventHandlers() {
  ELEMENTS.scatterplotCanvas
    .on("mousemove", handleMouseMove)
    .on("mouseout", handleMouseOut)
    .on("click", handleClick);

  ELEMENTS.resetFiltersBtn.on("click", handleResetFilters);

  // Close dropdowns when clicking outside
  d3.select(document).on("click", (event) => {
    if (!event.target.closest(".filter-rule-value-container")) {
      closeFilterAutocomplete();
    }
  });

  d3.select(window).on("resize", debounce(handleResize, 250));
}

function handleMouseMove(event) {
  const [mouseX, mouseY] = d3.pointer(event);
  const transform = appState.currentTransform;
  const invertedX = transform.invertX(mouseX);
  const invertedY = transform.invertY(mouseY);
  const searchRadius = (CONFIG.highlightRadius * 1.5) / transform.k;

  const closest = appState.quadtree?.find(invertedX, invertedY, searchRadius);

  if (appState.hoveredPoint?.id !== closest?.id) {
    appState.hoveredPoint = closest;
    updateHoverHighlight();
  }

  // If there's a sticky tooltip, show a secondary hover tooltip
  if (appState.stickyPoint) {
    if (closest && closest.id !== appState.stickyPoint.id) {
      showHoverTooltip(closest);
    } else {
      hideHoverTooltip();
    }
  } else {
    // No sticky point - show regular tooltip on hover
    if (closest) {
      showTooltip(event, closest, false);
    } else {
      hideTooltip();
    }
  }
}

function handleMouseOut() {
  appState.hoveredPoint = null;
  updateHoverHighlight();

  // Hide hover tooltip
  hideHoverTooltip();

  // Only hide main tooltip if no sticky point
  if (!appState.stickyPoint) {
    hideTooltip();
  }
}

function handleClick(event) {
  const [mouseX, mouseY] = d3.pointer(event);
  const transform = appState.currentTransform;
  const invertedX = transform.invertX(mouseX);
  const invertedY = transform.invertY(mouseY);
  const searchRadius = (CONFIG.highlightRadius * 1.5) / transform.k;

  const clicked = appState.quadtree?.find(invertedX, invertedY, searchRadius);

  // Always hide hover tooltip on click
  hideHoverTooltip();

  if (clicked) {
    // Lock/switch tooltip to this point
    appState.stickyPoint = clicked;
    showTooltip(event, clicked, true);
    updateHoverHighlight();
  } else {
    // Clicked on empty area - dismiss sticky tooltip
    appState.stickyPoint = null;
    hideTooltip();
    updateHoverHighlight();
  }
}

export function handleResetFilters() {
  // Reset filter rules (includes date filter)
  appState.filterRules = [];
  appState.matchedIds.clear();
  renderFilterRules();

  // Reset link depth
  appState.linkDepth = 1;
  ELEMENTS.linkDepthSelect.property("value", "1");

  // Reset date gradient
  appState.dateGradientEnabled = false;
  ELEMENTS.dateGradientToggle.property("checked", false);

  // Reset map labels
  appState.mapLabelsEnabled = false;
  ELEMENTS.mapLabelsToggle.property("checked", false);
  ELEMENTS.mapLabelsGroup.selectAll("text").remove();

  closeFilterAutocomplete();
  applyFilterRules();
  updateQuadtree();
  syncTimelineBrush(); // Update timeline display since filters were cleared
  updateFilterCount();
  drawTimeline();
  drawScatterplot();
}

export function handleResize() {
  setupDimensions();
  setupScales();
  setupCanvas();
  setupSVG();
  setupTimeline();
  setupZoom();
  updateQuadtree();

  // Reset zoom transform on resize
  appState.currentTransform = d3.zoomIdentity;
  ELEMENTS.scatterplotCanvas.call(
    appState.zoomBehavior.transform,
    d3.zoomIdentity,
  );

  // Restore timeline selection from date filter rule
  syncTimelineBrush();

  drawTimeline();
  drawScatterplot();
  updateMapLabels();
}
