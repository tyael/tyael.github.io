// Main entry point - imports all modules and initializes the application
import { CONFIG } from './config.js';
import { appState, ELEMENTS, initializeElements } from './state.js';
import { showLoading } from './utils.js';
import { processData } from './data.js';
import { setupDimensions, setupScales, setupCanvas, setupSVG } from './scales.js';
import { setupZoom } from './zoom.js';
import { setupTimeline, drawTimeline } from './timeline.js';
import { setupNNSelector, setupLinkDepthSelector, setupDateGradientToggle, setupMapLabelsToggle } from './controls.js';
import { updateQuadtree, drawScatterplot } from './drawing.js';
import { applyFilterRules, updateFilterCount } from './filter-logic.js';
import { setupFilterBuilder } from './filter-builder.js';
import { setupEventHandlers } from './events.js';

// Apply colors from CONFIG to CSS custom properties and SVG markers
function applyColorsToCss() {
  const root = document.documentElement;
  root.style.setProperty('--color-filtered', CONFIG.colors.filtered);
  root.style.setProperty('--color-unfiltered', CONFIG.colors.unfiltered);
  root.style.setProperty('--color-forward-link', CONFIG.colors.forwardLink);
  root.style.setProperty('--color-backlink', CONFIG.colors.backlink);
  root.style.setProperty('--color-source-aspi', CONFIG.colors.sourceAspi);
  root.style.setProperty('--color-source-lowy', CONFIG.colors.sourceLowy);

  // Update SVG marker colors (SVG doesn't support CSS variables in fill attributes)
  const outgoingMarker = document.querySelector('#link-arrow-outgoing path');
  const backlinkMarker = document.querySelector('#link-arrow-backlink path');
  if (outgoingMarker) outgoingMarker.setAttribute('fill', CONFIG.colors.forwardLink);
  if (backlinkMarker) backlinkMarker.setAttribute('fill', CONFIG.colors.backlink);
}

// --- Initialization ---
async function initialize() {
  // Apply colors to CSS before anything else
  applyColorsToCss();

  // Initialize DOM element references
  initializeElements();

  showLoading("Loading articles...");

  try {
    const rawData = await d3.json(CONFIG.dataUrl);
    appState.rawData = rawData; // Store for n_neighbors switching
    processData(rawData);

    setupDimensions();
    setupScales();
    setupCanvas();
    setupSVG();
    setupTimeline();
    setupZoom();
    setupEventHandlers();
    setupFilterBuilder();
    setupNNSelector();
    setupLinkDepthSelector();
    setupDateGradientToggle();
    setupMapLabelsToggle();

    applyFilterRules();
    updateQuadtree();
    drawTimeline();
    drawScatterplot();
    updateFilterCount();

    showLoading(false);
    console.log(`Loaded ${appState.fullData.length} articles`);
  } catch (error) {
    console.error("Initialization failed:", error);
    showLoading(false);
  }
}

// --- Start ---
initialize();
