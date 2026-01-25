import { CONFIG } from './config.js';
import { appState, ELEMENTS } from './state.js';
import { getDateBasedOpacity, hexToRgba } from './utils.js';
import { updateHoverHighlight } from './internal-links.js';

// --- Quadtree ---
export function updateQuadtree() {
  appState.quadtree = d3
    .quadtree()
    .x((d) => d.px)
    .y((d) => d.py)
    .addAll(appState.fullData);
}

// --- Drawing ---
export function drawScatterplot() {
  const ctx = appState.canvasContext;
  const { plotWidth, plotHeight } = appState.dimensions;
  const transform = appState.currentTransform;

  ctx.save();
  ctx.clearRect(0, 0, plotWidth, plotHeight);
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);

  const radius = CONFIG.pointRadius / transform.k;

  // Use fullData - all points are always visible, colored by filter match
  const data = appState.fullData;
  const useGradient = appState.dateGradientEnabled;

  // Draw unmatched points first (gray)
  if (useGradient) {
    // With gradient: draw each point with individual opacity
    data.forEach((d) => {
      if (!appState.matchedIds.has(d.id)) {
        const opacity = getDateBasedOpacity(d.date);
        ctx.fillStyle = hexToRgba(CONFIG.colors.unfiltered, opacity);
        ctx.beginPath();
        ctx.arc(d.px, d.py, radius, 0, 2 * Math.PI);
        ctx.fill();
      }
    });
  } else {
    // Without gradient: batch draw with single color
    ctx.fillStyle = CONFIG.colors.unfiltered;
    data.forEach((d) => {
      if (!appState.matchedIds.has(d.id)) {
        ctx.beginPath();
        ctx.arc(d.px, d.py, radius, 0, 2 * Math.PI);
        ctx.fill();
      }
    });
  }

  // Draw matched points on top (colored, same size)
  if (useGradient) {
    // With gradient: draw each point with individual opacity
    data.forEach((d) => {
      if (appState.matchedIds.has(d.id)) {
        const opacity = getDateBasedOpacity(d.date);
        ctx.fillStyle = hexToRgba(CONFIG.colors.filtered, opacity);
        ctx.beginPath();
        ctx.arc(d.px, d.py, radius, 0, 2 * Math.PI);
        ctx.fill();
      }
    });
  } else {
    // Without gradient: batch draw with single color
    ctx.fillStyle = CONFIG.colors.filtered;
    data.forEach((d) => {
      if (appState.matchedIds.has(d.id)) {
        ctx.beginPath();
        ctx.arc(d.px, d.py, radius, 0, 2 * Math.PI);
        ctx.fill();
      }
    });
  }

  ctx.restore();

  updateHoverHighlight();
}
