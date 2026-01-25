import { CONFIG } from './config.js';
import { appState, ELEMENTS } from './state.js';
import { setupScales } from './scales.js';
import { updateQuadtree, drawScatterplot } from './drawing.js';
import { updateHoverHighlight } from './internal-links.js';
import { showLoading } from './utils.js';
import { computeMapLabels, updateMapLabels, recomputeMapLabels } from './map-labels.js';

// --- N_Neighbors Selector Setup ---
export function setupNNSelector() {
  const select = ELEMENTS.nnSelect;

  // Populate options
  select.selectAll("option").remove();
  appState.availableNNs.forEach((nn) => {
    select
      .append("option")
      .attr("value", nn)
      .text(`n=${nn}`)
      .property("selected", nn === appState.currentNN);
  });

  select.property("disabled", false);
  select.on("change", handleNNChange);
}

function handleNNChange() {
  if (appState.isTransitioning) return;

  const newNN = parseInt(ELEMENTS.nnSelect.property("value"), 10);
  if (newNN === appState.currentNN) return;

  transitionToNN(newNN);
}

function transitionToNN(targetNN) {
  if (appState.isTransitioning) return;

  appState.isTransitioning = true;
  ELEMENTS.nnSelect.property("disabled", true);

  const sourceNN = appState.currentNN;

  // Store original positions
  appState.fullData.forEach((d) => {
    d._sourceX = d.x;
    d._sourceY = d.y;
    const targetCoords = d._umap?.[targetNN];
    if (targetCoords) {
      d._targetX = +targetCoords.d0;
      d._targetY = +targetCoords.d1;
    } else {
      // Fallback to current position if target NN not available
      d._targetX = d.x;
      d._targetY = d.y;
    }
  });

  // Animate transition
  const duration = CONFIG.nnTransitionDuration;
  const timer = d3.timer((elapsed) => {
    const t = Math.min(1, d3.easeCubicInOut(elapsed / duration));

    // Interpolate positions
    appState.fullData.forEach((d) => {
      d.x = d._sourceX + (d._targetX - d._sourceX) * t;
      d.y = d._sourceY + (d._targetY - d._sourceY) * t;
    });

    // Update scales and redraw
    setupScales();
    updateQuadtree();
    drawScatterplot();

    // Hide labels during transition (they'll be recomputed after)
    if (appState.mapLabelsEnabled) {
      ELEMENTS.mapLabelsGroup.selectAll("text").style("opacity", 0);
    }

    if (t >= 1) {
      timer.stop();
      appState.currentNN = targetNN;
      appState.isTransitioning = false;
      ELEMENTS.nnSelect.property("disabled", false);

      // Clean up transition properties
      appState.fullData.forEach((d) => {
        delete d._sourceX;
        delete d._sourceY;
        delete d._targetX;
        delete d._targetY;
      });

      // Recompute map labels for new projection
      recomputeMapLabels();

      console.log(`Transitioned to n_neighbors = ${targetNN}`);
    }
  });
}

// --- Link Depth Selector Setup ---
export function setupLinkDepthSelector() {
  ELEMENTS.linkDepthSelect.on("change", handleLinkDepthChange);
}

function handleLinkDepthChange() {
  appState.linkDepth = parseInt(ELEMENTS.linkDepthSelect.property("value"), 10);
  updateHoverHighlight();
}

// --- Date Gradient Toggle Setup ---
export function setupDateGradientToggle() {
  ELEMENTS.dateGradientToggle.on("change", handleDateGradientChange);
}

function handleDateGradientChange() {
  appState.dateGradientEnabled = ELEMENTS.dateGradientToggle.property("checked");
  drawScatterplot();
}

// --- Map Labels Toggle Setup ---
export function setupMapLabelsToggle() {
  ELEMENTS.mapLabelsToggle.on("change", handleMapLabelsChange);
}

function handleMapLabelsChange() {
  appState.mapLabelsEnabled = ELEMENTS.mapLabelsToggle.property("checked");

  if (appState.mapLabelsEnabled && !appState.mapLabelsComputed) {
    // Show loading message and compute after a brief delay to let UI update
    showLoading("Computing map labels...");
    setTimeout(() => {
      computeMapLabels();
      updateMapLabels();
      showLoading(false);
    }, 50);
  } else {
    updateMapLabels();
  }
}
