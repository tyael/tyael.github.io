import { CONFIG } from './config.js';
import { appState, ELEMENTS } from './state.js';

// --- Dimension Setup (fills space, equal axis scales) ---
export function setupDimensions() {
  const rect = ELEMENTS.scatterplotContainer.node().getBoundingClientRect();
  const plotWidth = Math.max(
    100,
    rect.width - CONFIG.margin.left - CONFIG.margin.right,
  );
  const plotHeight = Math.max(
    100,
    rect.height - CONFIG.margin.top - CONFIG.margin.bottom,
  );

  appState.dimensions = {
    width: rect.width,
    height: rect.height,
    plotWidth,
    plotHeight,
    offsetX: CONFIG.margin.left,
    offsetY: CONFIG.margin.top,
  };
}

// --- Scale Setup ---
export function setupScales() {
  const { plotWidth, plotHeight } = appState.dimensions;

  // Get data extents
  const xExtent = d3.extent(appState.fullData, (d) => d.x);
  const yExtent = d3.extent(appState.fullData, (d) => d.y);

  const xDataRange = xExtent[1] - xExtent[0];
  const yDataRange = yExtent[1] - yExtent[0];

  // Center the data
  const xCenter = (xExtent[0] + xExtent[1]) / 2;
  const yCenter = (yExtent[0] + yExtent[1]) / 2;

  // Calculate pixels per data unit for each axis if we used full extent
  const xPixelsPerUnit = plotWidth / xDataRange;
  const yPixelsPerUnit = plotHeight / yDataRange;

  // Use the smaller scale factor to ensure equal axis scales
  // This means 1 data unit = same number of pixels on both axes
  const pixelsPerUnit = Math.min(xPixelsPerUnit, yPixelsPerUnit);

  // Add some padding (5% of the used range)
  const paddingFactor = 0.95;
  const effectivePixelsPerUnit = pixelsPerUnit * paddingFactor;

  // Calculate how much data range fits in each dimension
  const xHalfDataRange = plotWidth / effectivePixelsPerUnit / 2;
  const yHalfDataRange = plotHeight / effectivePixelsPerUnit / 2;

  appState.scales.x = d3
    .scaleLinear()
    .domain([xCenter - xHalfDataRange, xCenter + xHalfDataRange])
    .range([0, plotWidth]);

  appState.scales.y = d3
    .scaleLinear()
    .domain([yCenter - yHalfDataRange, yCenter + yHalfDataRange])
    .range([plotHeight, 0]);

  // Update point positions
  appState.fullData.forEach((d) => {
    d.px = appState.scales.x(d.x);
    d.py = appState.scales.y(d.y);
  });
}

// --- Canvas Setup ---
export function setupCanvas() {
  const { plotWidth, plotHeight, offsetX, offsetY } = appState.dimensions;

  ELEMENTS.scatterplotCanvas
    .attr("width", plotWidth)
    .attr("height", plotHeight)
    .style("transform", `translate(${offsetX}px, ${offsetY}px)`);

  appState.canvasContext = ELEMENTS.scatterplotCanvas.node().getContext("2d");
}

// --- SVG Setup ---
export function setupSVG() {
  const { width, height, plotWidth, plotHeight, offsetX, offsetY } =
    appState.dimensions;

  ELEMENTS.scatterplotSvg.attr("width", width).attr("height", height);

  ELEMENTS.scatterplotContent.attr(
    "transform",
    `translate(${offsetX}, ${offsetY})`,
  );

  // Grid background
  ELEMENTS.gridBackground.attr("width", plotWidth).attr("height", plotHeight);

  // Update grid pattern for current scale
  updateGridPattern();

  // Axes removed - UMAP coordinates have no semantic meaning
  ELEMENTS.xAxisGroup.selectAll("*").remove();
  ELEMENTS.yAxisGroup.selectAll("*").remove();
}

export function updateGridPattern() {
  const { plotWidth, plotHeight } = appState.dimensions;
  const transform = appState.currentTransform;

  // Calculate grid spacing in screen coordinates
  const gridSpacing = CONFIG.gridSpacing * transform.k;

  // Update the pattern
  d3.select("#grid-pattern")
    .attr("width", gridSpacing)
    .attr("height", gridSpacing)
    .attr(
      "patternTransform",
      `translate(${transform.x % gridSpacing}, ${transform.y % gridSpacing})`,
    )
    .select("path")
    .attr("d", `M ${gridSpacing} 0 L 0 0 0 ${gridSpacing}`);
}
