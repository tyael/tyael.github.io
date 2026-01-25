import { CONFIG } from './config.js';
import { appState, ELEMENTS } from './state.js';
import { updateGridPattern } from './scales.js';
import { drawScatterplot } from './drawing.js';
import { updateMapLabels } from './map-labels.js';
import { hideTooltip } from './tooltip.js';

// --- Zoom Setup ---
export function setupZoom() {
  const { plotWidth, plotHeight } = appState.dimensions;

  const zoom = d3
    .zoom()
    .scaleExtent([CONFIG.zoomMin, CONFIG.zoomMax])
    .translateExtent([
      [0, 0],
      [plotWidth, plotHeight],
    ])
    .extent([
      [0, 0],
      [plotWidth, plotHeight],
    ])
    .on("zoom", handleZoom);

  ELEMENTS.scatterplotCanvas.call(zoom);
  appState.zoomBehavior = zoom;
}

function handleZoom(event) {
  appState.currentTransform = event.transform;
  updateGridPattern();
  drawScatterplot();
  updateMapLabels();
  // Only hide tooltip if no sticky point is locked
  if (!appState.stickyPoint) {
    hideTooltip();
  }
}
