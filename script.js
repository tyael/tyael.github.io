// --- Configuration ---
const CONFIG = {
  dataUrl: "articles.json",
  margin: { top: 30, right: 30, bottom: 40, left: 50 },
  pointRadius: 3,
  highlightRadius: 5,
  zoomMin: 0.5,
  zoomMax: 20,
  defaultNN: 15,
  gridSpacing: 50,
  colors: {
    inactive: "#e0e0e0",
    filterA: "#2563eb",
    filterB: "#dc2626",
    filterBoth: "#7c3aed",
    filterXor: "#059669",
  },
};

// --- Application State ---
const appState = {
  fullData: [],
  uniqueTags: [],
  uniqueAuthors: [],
  currentTransform: d3.zoomIdentity,
  dimensions: { width: 0, height: 0, plotSize: 0 },
  scales: { x: null, y: null },
  quadtree: null,
  hoveredPoint: null,
  canvasContext: null,
  filters: {
    a: { type: null, value: null },
    b: { type: null, value: null },
  },
  // Computed sets for filter results
  matchA: new Set(),
  matchB: new Set(),
};

// --- DOM Elements ---
const ELEMENTS = {
  loadingIndicator: d3.select("#loading-indicator"),
  scatterplotContainer: d3.select("#scatterplot-container"),
  scatterplotCanvas: d3.select("#scatterplot-canvas"),
  scatterplotSvg: d3.select("#scatterplot-svg"),
  scatterplotContent: d3.select("#scatterplot-svg g.scatterplot-content"),
  gridBackground: d3.select("#scatterplot-svg .grid-background"),
  xAxisGroup: d3.select("#scatterplot-svg g.x-axis"),
  yAxisGroup: d3.select("#scatterplot-svg g.y-axis"),
  hoverHighlight: d3.select("#scatterplot-svg .hover-highlight"),
  tooltip: d3.select("#tooltip"),
  filterAType: d3.select("#filter-a-type"),
  filterAValue: d3.select("#filter-a-value"),
  filterBType: d3.select("#filter-b-type"),
  filterBValue: d3.select("#filter-b-value"),
  filterACount: d3.select("#filter-a-count"),
  filterBCount: d3.select("#filter-b-count"),
  filterBothCount: d3.select("#filter-both-count"),
  filterXorCount: d3.select("#filter-xor-count"),
  resetFiltersBtn: d3.select("#reset-filters-btn"),
  articleCount: d3.select("#article-count"),
};

// --- Initialization ---
async function initialize() {
  showLoading("Loading articles...");

  try {
    const rawData = await d3.json(CONFIG.dataUrl);
    processData(rawData);

    setupDimensions();
    setupScales();
    setupCanvas();
    setupSVG();
    setupZoom();
    setupEventHandlers();

    updateQuadtree();
    drawScatterplot();
    updateCounts();

    showLoading(false);
    console.log(`Loaded ${appState.fullData.length} articles`);
  } catch (error) {
    console.error("Initialization failed:", error);
    showLoading(false);
  }
}

// --- Data Processing ---
function processData(rawData) {
  const tagsSet = new Set();
  const authorsSet = new Set();
  const nn = CONFIG.defaultNN;

  appState.fullData = rawData
    .filter((d) => {
      if (!d || typeof d !== "object") return false;
      const x = d[`x_${nn}`];
      const y = d[`y_${nn}`];
      return x != null && y != null && !isNaN(+x) && !isNaN(+y);
    })
    .map((d, i) => {
      const tags = Array.isArray(d.tags)
        ? d.tags.filter((t) => typeof t === "string" && t.trim())
        : [];
      const authors = Array.isArray(d.authors)
        ? d.authors.filter((a) => typeof a === "string" && a.trim())
        : [];

      tags.forEach((t) => tagsSet.add(t));
      authors.forEach((a) => authorsSet.add(a));

      return {
        id: d.id || `article-${i}`,
        title: d.title || "",
        url: d.url || "",
        date: new Date(d.date),
        tags,
        authors,
        x: +d[`x_${nn}`],
        y: +d[`y_${nn}`],
        px: 0,
        py: 0,
        _tagsLower: tags.map((t) => t.toLowerCase()),
        _authorsLower: authors.map((a) => a.toLowerCase()),
      };
    });

  appState.uniqueTags = Array.from(tagsSet).sort((a, b) => a.localeCompare(b));
  appState.uniqueAuthors = Array.from(authorsSet).sort((a, b) =>
    a.localeCompare(b),
  );

  ELEMENTS.articleCount.text(`${appState.fullData.length} articles total`);
}

// --- Dimension Setup (1:1 aspect ratio) ---
function setupDimensions() {
  const rect = ELEMENTS.scatterplotContainer.node().getBoundingClientRect();
  const availableWidth = rect.width - CONFIG.margin.left - CONFIG.margin.right;
  const availableHeight =
    rect.height - CONFIG.margin.top - CONFIG.margin.bottom;

  // Use the smaller dimension to maintain 1:1 aspect ratio
  const plotSize = Math.max(100, Math.min(availableWidth, availableHeight));

  appState.dimensions = {
    width: rect.width,
    height: rect.height,
    plotSize,
    offsetX: CONFIG.margin.left + (availableWidth - plotSize) / 2,
    offsetY: CONFIG.margin.top + (availableHeight - plotSize) / 2,
  };
}

// --- Scale Setup ---
function setupScales() {
  const { plotSize } = appState.dimensions;

  // Get data extents
  const xExtent = d3.extent(appState.fullData, (d) => d.x);
  const yExtent = d3.extent(appState.fullData, (d) => d.y);

  // Find the larger range to use for both axes (maintain 1:1 data ratio)
  const xRange = xExtent[1] - xExtent[0];
  const yRange = yExtent[1] - yExtent[0];
  const maxRange = Math.max(xRange, yRange);

  // Center the data in both dimensions
  const xCenter = (xExtent[0] + xExtent[1]) / 2;
  const yCenter = (yExtent[0] + yExtent[1]) / 2;

  const padding = maxRange * 0.05;
  const halfRange = maxRange / 2 + padding;

  appState.scales.x = d3
    .scaleLinear()
    .domain([xCenter - halfRange, xCenter + halfRange])
    .range([0, plotSize]);

  appState.scales.y = d3
    .scaleLinear()
    .domain([yCenter - halfRange, yCenter + halfRange])
    .range([plotSize, 0]);

  // Update point positions
  appState.fullData.forEach((d) => {
    d.px = appState.scales.x(d.x);
    d.py = appState.scales.y(d.y);
  });
}

// --- Canvas Setup ---
function setupCanvas() {
  const { plotSize, offsetX, offsetY } = appState.dimensions;

  ELEMENTS.scatterplotCanvas
    .attr("width", plotSize)
    .attr("height", plotSize)
    .style("transform", `translate(${offsetX}px, ${offsetY}px)`);

  appState.canvasContext = ELEMENTS.scatterplotCanvas.node().getContext("2d");
}

// --- SVG Setup ---
function setupSVG() {
  const { width, height, plotSize, offsetX, offsetY } = appState.dimensions;

  ELEMENTS.scatterplotSvg.attr("width", width).attr("height", height);

  ELEMENTS.scatterplotContent.attr(
    "transform",
    `translate(${offsetX}, ${offsetY})`,
  );

  // Grid background
  ELEMENTS.gridBackground.attr("width", plotSize).attr("height", plotSize);

  // Update grid pattern for current scale
  updateGridPattern();

  // Axes
  const xAxis = d3.axisBottom(appState.scales.x).ticks(5).tickSizeOuter(0);
  const yAxis = d3.axisLeft(appState.scales.y).ticks(5).tickSizeOuter(0);

  ELEMENTS.xAxisGroup
    .attr("transform", `translate(0, ${plotSize})`)
    .call(xAxis);

  ELEMENTS.yAxisGroup.call(yAxis);
}

function updateGridPattern() {
  const { plotSize } = appState.dimensions;
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

// --- Zoom Setup ---
function setupZoom() {
  const { plotSize } = appState.dimensions;

  const zoom = d3
    .zoom()
    .scaleExtent([CONFIG.zoomMin, CONFIG.zoomMax])
    .translateExtent([
      [0, 0],
      [plotSize, plotSize],
    ])
    .extent([
      [0, 0],
      [plotSize, plotSize],
    ])
    .on("zoom", handleZoom);

  ELEMENTS.scatterplotCanvas.call(zoom);
  appState.zoomBehavior = zoom;
}

// --- Event Handlers Setup ---
function setupEventHandlers() {
  ELEMENTS.scatterplotCanvas
    .on("mousemove", handleMouseMove)
    .on("mouseout", handleMouseOut)
    .on("click", handleClick);

  ELEMENTS.filterAType.on("change", () => handleFilterTypeChange("a"));
  ELEMENTS.filterBType.on("change", () => handleFilterTypeChange("b"));
  ELEMENTS.filterAValue.on("change", () => handleFilterValueChange("a"));
  ELEMENTS.filterBValue.on("change", () => handleFilterValueChange("b"));
  ELEMENTS.resetFiltersBtn.on("click", handleResetFilters);

  d3.select(window).on("resize", debounce(handleResize, 250));
}

// --- Quadtree ---
function updateQuadtree() {
  appState.quadtree = d3
    .quadtree()
    .x((d) => d.px)
    .y((d) => d.py)
    .addAll(appState.fullData);
}

// --- Drawing ---
function drawScatterplot() {
  const ctx = appState.canvasContext;
  const { plotSize } = appState.dimensions;
  const transform = appState.currentTransform;

  ctx.save();
  ctx.clearRect(0, 0, plotSize, plotSize);
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);

  const radius = CONFIG.pointRadius / transform.k;
  const highlightRadius = CONFIG.highlightRadius / transform.k;

  // Draw inactive points first
  ctx.fillStyle = CONFIG.colors.inactive;
  appState.fullData.forEach((d) => {
    if (!appState.matchA.has(d.id) && !appState.matchB.has(d.id)) {
      ctx.beginPath();
      ctx.arc(d.px, d.py, radius, 0, 2 * Math.PI);
      ctx.fill();
    }
  });

  // Draw XOR points (A or B but not both)
  ctx.fillStyle = CONFIG.colors.filterXor;
  appState.fullData.forEach((d) => {
    const inA = appState.matchA.has(d.id);
    const inB = appState.matchB.has(d.id);
    if ((inA || inB) && !(inA && inB)) {
      ctx.beginPath();
      ctx.arc(d.px, d.py, highlightRadius, 0, 2 * Math.PI);
      ctx.fill();
    }
  });

  // Draw A-only points (on top of XOR, but we'll overdraw)
  ctx.fillStyle = CONFIG.colors.filterA;
  appState.fullData.forEach((d) => {
    if (appState.matchA.has(d.id) && !appState.matchB.has(d.id)) {
      ctx.beginPath();
      ctx.arc(d.px, d.py, highlightRadius, 0, 2 * Math.PI);
      ctx.fill();
    }
  });

  // Draw B-only points
  ctx.fillStyle = CONFIG.colors.filterB;
  appState.fullData.forEach((d) => {
    if (appState.matchB.has(d.id) && !appState.matchA.has(d.id)) {
      ctx.beginPath();
      ctx.arc(d.px, d.py, highlightRadius, 0, 2 * Math.PI);
      ctx.fill();
    }
  });

  // Draw BOTH points (A AND B) on top
  ctx.fillStyle = CONFIG.colors.filterBoth;
  appState.fullData.forEach((d) => {
    if (appState.matchA.has(d.id) && appState.matchB.has(d.id)) {
      ctx.beginPath();
      ctx.arc(d.px, d.py, highlightRadius, 0, 2 * Math.PI);
      ctx.fill();
    }
  });

  ctx.restore();

  updateHoverHighlight();
}

function updateHoverHighlight() {
  const point = appState.hoveredPoint;
  const transform = appState.currentTransform;

  if (point) {
    const cx = transform.applyX(point.px);
    const cy = transform.applyY(point.py);
    ELEMENTS.hoverHighlight
      .attr("cx", cx)
      .attr("cy", cy)
      .style("display", "block");
  } else {
    ELEMENTS.hoverHighlight.style("display", "none");
  }
}

// --- Filter Logic ---
function computeFilterMatches() {
  appState.matchA.clear();
  appState.matchB.clear();

  const { a, b } = appState.filters;

  appState.fullData.forEach((d) => {
    if (matchesFilter(d, a)) {
      appState.matchA.add(d.id);
    }
    if (matchesFilter(d, b)) {
      appState.matchB.add(d.id);
    }
  });
}

function matchesFilter(article, filter) {
  if (!filter.type || !filter.value) return false;

  const valueLower = filter.value.toLowerCase();

  if (filter.type === "tag") {
    return article._tagsLower.includes(valueLower);
  } else if (filter.type === "author") {
    return article._authorsLower.includes(valueLower);
  }

  return false;
}

function updateCounts() {
  const aCount = appState.matchA.size;
  const bCount = appState.matchB.size;

  let bothCount = 0;
  let xorCount = 0;

  appState.fullData.forEach((d) => {
    const inA = appState.matchA.has(d.id);
    const inB = appState.matchB.has(d.id);
    if (inA && inB) bothCount++;
    if ((inA || inB) && !(inA && inB)) xorCount++;
  });

  ELEMENTS.filterACount.text(`${aCount} article${aCount !== 1 ? "s" : ""}`);
  ELEMENTS.filterBCount.text(`${bCount} article${bCount !== 1 ? "s" : ""}`);
  ELEMENTS.filterBothCount.text(bothCount);
  ELEMENTS.filterXorCount.text(xorCount);
}

// --- Event Handlers ---
function handleZoom(event) {
  appState.currentTransform = event.transform;
  updateGridPattern();
  drawScatterplot();
  hideTooltip();
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

  if (closest) {
    showTooltip(event, closest);
  } else {
    hideTooltip();
  }
}

function handleMouseOut() {
  appState.hoveredPoint = null;
  updateHoverHighlight();
  hideTooltip();
}

function handleClick(event) {
  const [mouseX, mouseY] = d3.pointer(event);
  const transform = appState.currentTransform;
  const invertedX = transform.invertX(mouseX);
  const invertedY = transform.invertY(mouseY);
  const searchRadius = (CONFIG.highlightRadius * 1.5) / transform.k;

  const clicked = appState.quadtree?.find(invertedX, invertedY, searchRadius);

  if (clicked && clicked.url) {
    window.open(clicked.url, "_blank");
  }
}

function handleFilterTypeChange(filterKey) {
  const typeSelect =
    filterKey === "a" ? ELEMENTS.filterAType : ELEMENTS.filterBType;
  const valueSelect =
    filterKey === "a" ? ELEMENTS.filterAValue : ELEMENTS.filterBValue;
  const type = typeSelect.property("value");

  appState.filters[filterKey].type = type || null;
  appState.filters[filterKey].value = null;

  // Populate value dropdown
  if (type) {
    const options =
      type === "tag" ? appState.uniqueTags : appState.uniqueAuthors;
    valueSelect.property("disabled", false).selectAll("option").remove();

    valueSelect.append("option").attr("value", "").text("-- Select Value --");

    options.forEach((opt) => {
      valueSelect.append("option").attr("value", opt).text(opt);
    });
  } else {
    valueSelect.property("disabled", true).selectAll("option").remove();

    valueSelect.append("option").attr("value", "").text("-- Select Value --");
  }

  computeFilterMatches();
  updateCounts();
  drawScatterplot();
}

function handleFilterValueChange(filterKey) {
  const valueSelect =
    filterKey === "a" ? ELEMENTS.filterAValue : ELEMENTS.filterBValue;
  const value = valueSelect.property("value");

  appState.filters[filterKey].value = value || null;

  computeFilterMatches();
  updateCounts();
  drawScatterplot();
}

function handleResetFilters() {
  appState.filters.a = { type: null, value: null };
  appState.filters.b = { type: null, value: null };

  ELEMENTS.filterAType.property("value", "");
  ELEMENTS.filterBType.property("value", "");

  [ELEMENTS.filterAValue, ELEMENTS.filterBValue].forEach((el) => {
    el.property("disabled", true).selectAll("option").remove();
    el.append("option").attr("value", "").text("-- Select Value --");
  });

  computeFilterMatches();
  updateCounts();
  drawScatterplot();
}

function handleResize() {
  setupDimensions();
  setupScales();
  setupCanvas();
  setupSVG();
  setupZoom();
  updateQuadtree();

  // Reset zoom transform on resize
  appState.currentTransform = d3.zoomIdentity;
  ELEMENTS.scatterplotCanvas.call(
    appState.zoomBehavior.transform,
    d3.zoomIdentity,
  );

  drawScatterplot();
}

// --- Tooltip ---
function showTooltip(event, data) {
  const dateStr =
    data.date instanceof Date && !isNaN(data.date)
      ? data.date.toLocaleDateString()
      : "Unknown date";

  const authorsStr =
    data.authors.length > 0 ? data.authors.join(", ") : "Unknown";
  const tagsStr = data.tags.length > 0 ? data.tags.join(", ") : "None";

  const content = `
    <strong>${data.title || "Untitled"}</strong>
    <div class="meta">
      ${authorsStr}<br>
      ${dateStr}
    </div>
    <div class="tags">Tags: ${tagsStr}</div>
  `;

  ELEMENTS.tooltip
    .style("display", "block")
    .style("right", "20px")
    .style("top", "20px")
    .html(content);
}

function hideTooltip() {
  ELEMENTS.tooltip.style("display", "none");
}

// --- Utilities ---
function showLoading(message) {
  if (message) {
    ELEMENTS.loadingIndicator.text(message).style("display", "block");
  } else {
    ELEMENTS.loadingIndicator.style("display", "none");
  }
}

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// --- Start ---
initialize();
