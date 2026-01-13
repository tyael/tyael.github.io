// --- Configuration ---
const CONFIG = {
  dataUrl: "articles.json",
  margin: { top: 30, right: 30, bottom: 40, left: 50 },
  timeline: { height: 80, margin: { top: 10, right: 30, bottom: 25, left: 50 } },
  pointRadius: 3,
  highlightRadius: 5,
  zoomMin: 0.5,
  zoomMax: 20,
  defaultNN: 15,
  gridSpacing: 50,
  nnTransitionDuration: 750,
  colors: {
    inactive: "#e0e0e0",
    matched: "#2563eb",
    internalLink: "#b10836",
  },
  // Filter field definitions
  filterFields: [
    { id: "author", label: "Author", type: "array", field: "authors" },
    { id: "tag", label: "Tag", type: "array", field: "tags" },
    { id: "title", label: "Title", type: "string", field: "title" },
  ],
  // Filter operators by type
  filterOperators: {
    array: [
      { id: "contains", label: "contains" },
      { id: "equals", label: "equals" },
    ],
    string: [
      { id: "contains", label: "contains" },
      { id: "startsWith", label: "starts with" },
      { id: "equals", label: "equals" },
    ],
  },
};

// --- Application State ---
const appState = {
  fullData: [],
  filteredData: [], // After date range filter
  rawData: null, // Original JSON for n_neighbors switching
  articlesByExternalId: new Map(), // Lookup map for internal links
  uniqueTags: [],
  uniqueAuthors: [],
  availableNNs: [], // Available n_neighbors values
  currentTransform: d3.zoomIdentity,
  dimensions: { width: 0, height: 0, plotWidth: 0, plotHeight: 0 },
  scales: { x: null, y: null },
  timeline: { scale: null, brush: null, selection: null },
  quadtree: null,
  hoveredPoint: null,
  stickyPoint: null, // Locked tooltip point (persists on click)
  canvasContext: null,
  // New filter builder state
  filterRules: [], // Array of { id, field, operator, value, logic }
  filterRuleIdCounter: 0,
  matchedIds: new Set(), // IDs of articles matching current filter
  // Autocomplete state for filter builder
  activeAutocomplete: null, // { ruleId, options, highlightedIndex }
  dateRange: null, // { start: Date, end: Date } or null for all
  // Current n_neighbors value used for coordinates
  currentNN: null,
  // Internal links depth (1, 2, or 3)
  linkDepth: 1,
  // NN transition state
  isTransitioning: false,
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
  internalLinksGroup: d3.select("#scatterplot-svg .internal-links"),
  hoverHighlight: d3.select("#scatterplot-svg .hover-highlight"),
  tooltip: d3.select("#tooltip"),
  // Filter builder elements
  filterRulesContainer: d3.select("#filter-rules"),
  addFilterBtn: d3.select("#add-filter-btn"),
  filterMatchCount: d3.select("#filter-match-count"),
  resetFiltersBtn: d3.select("#reset-filters-btn"),
  articleCount: d3.select("#article-count"),
  // Timeline and projection elements
  timelineContainer: d3.select("#timeline-container"),
  timelineSvg: d3.select("#timeline-svg"),
  nnSelect: d3.select("#nn-select"),
  linkDepthSelect: d3.select("#link-depth-select"),
};

// --- Initialization ---
async function initialize() {
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

    applyDateFilter();
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

// --- Data Processing ---
function processData(rawData) {
  const tagsSet = new Set();
  const authorsSet = new Set();

  // Determine available n_neighbors values and pick the best default
  const { nn, availableNNs } = determineNN(rawData, CONFIG.defaultNN);
  appState.currentNN = nn;
  appState.availableNNs = availableNNs;
  console.log(`Using n_neighbors = ${nn}, available: ${availableNNs.join(", ")}`);

  appState.fullData = rawData
    .filter((d) => {
      if (!d || typeof d !== "object") return false;
      // New format: umap.NN.d0 / umap.NN.d1
      const coords = d.umap?.[nn];
      if (!coords) return false;
      const x = coords.d0;
      const y = coords.d1;
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

      const coords = d.umap[nn];
      return {
        id: d.external_id || `article-${i}`,
        title: d.title || "",
        url: d.url || "",
        date: new Date(d.published_at_local),
        tags,
        authors,
        x: +coords.d0,
        y: +coords.d1,
        px: 0,
        py: 0,
        internalLinks: Array.isArray(d.internal_links) ? d.internal_links : [],
        _tagsLower: tags.map((t) => t.toLowerCase()),
        _authorsLower: authors.map((a) => a.toLowerCase()),
        _umap: d.umap, // Store original umap for n_neighbors switching
      };
    });

  // Initialize filteredData to full data
  appState.filteredData = appState.fullData;

  // Build lookup map for internal links
  appState.articlesByExternalId.clear();
  appState.fullData.forEach((article) => {
    appState.articlesByExternalId.set(article.id, article);
  });

  appState.uniqueTags = Array.from(tagsSet).sort((a, b) => a.localeCompare(b));
  appState.uniqueAuthors = Array.from(authorsSet).sort((a, b) =>
    a.localeCompare(b),
  );

  ELEMENTS.articleCount.text(`${appState.fullData.length} articles total`);
}

// Determine the n_neighbors value to use from available options
function determineNN(rawData, preferredNN) {
  // Find first article with umap data to get available keys
  const sampleArticle = rawData.find((d) => d?.umap && typeof d.umap === "object");
  if (!sampleArticle) {
    console.warn("No articles with UMAP data found, using default NN");
    return { nn: preferredNN, availableNNs: [preferredNN] };
  }

  const availableNNs = Object.keys(sampleArticle.umap)
    .map((k) => parseInt(k, 10))
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);

  if (availableNNs.length === 0) {
    console.warn("No valid NN keys found in UMAP data, using default NN");
    return { nn: preferredNN, availableNNs: [preferredNN] };
  }

  // If preferred NN is available, use it
  if (availableNNs.includes(preferredNN)) {
    return { nn: preferredNN, availableNNs };
  }

  // Otherwise find closest to preferred
  let closest = availableNNs[0];
  let minDiff = Math.abs(preferredNN - closest);
  for (const n of availableNNs) {
    const diff = Math.abs(preferredNN - n);
    if (diff < minDiff) {
      minDiff = diff;
      closest = n;
    }
  }

  console.log(`Preferred NN ${preferredNN} not available, using closest: ${closest}`);
  return { nn: closest, availableNNs };
}

// --- Dimension Setup (fills space, equal axis scales) ---
function setupDimensions() {
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
function setupScales() {
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
function setupCanvas() {
  const { plotWidth, plotHeight, offsetX, offsetY } = appState.dimensions;

  ELEMENTS.scatterplotCanvas
    .attr("width", plotWidth)
    .attr("height", plotHeight)
    .style("transform", `translate(${offsetX}px, ${offsetY}px)`);

  appState.canvasContext = ELEMENTS.scatterplotCanvas.node().getContext("2d");
}

// --- SVG Setup ---
function setupSVG() {
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

  // Axes - calculate tick count based on dimension
  const xTickCount = Math.max(3, Math.floor(plotWidth / 100));
  const yTickCount = Math.max(3, Math.floor(plotHeight / 100));

  const xAxis = d3
    .axisBottom(appState.scales.x)
    .ticks(xTickCount)
    .tickSizeOuter(0);
  const yAxis = d3
    .axisLeft(appState.scales.y)
    .ticks(yTickCount)
    .tickSizeOuter(0);

  ELEMENTS.xAxisGroup
    .attr("transform", `translate(0, ${plotHeight})`)
    .call(xAxis);

  ELEMENTS.yAxisGroup.call(yAxis);
}

function updateGridPattern() {
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

// --- Zoom Setup ---
function setupZoom() {
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

// --- Timeline Setup ---
function setupTimeline() {
  const container = ELEMENTS.timelineContainer.node();
  const rect = container.getBoundingClientRect();
  const margin = CONFIG.timeline.margin;
  const width = rect.width - margin.left - margin.right;
  const height = rect.height - margin.top - margin.bottom;

  // Get date extent from data
  const dateExtent = d3.extent(appState.fullData, (d) => d.date);

  // Create time scale
  appState.timeline.scale = d3
    .scaleTime()
    .domain(dateExtent)
    .range([0, width]);

  // Create brush
  appState.timeline.brush = d3
    .brushX()
    .extent([
      [0, 0],
      [width, height],
    ])
    .on("brush end", handleTimelineBrush);

  // Set up SVG structure
  ELEMENTS.timelineSvg.selectAll("*").remove();

  const g = ELEMENTS.timelineSvg
    .append("g")
    .attr("class", "timeline-content")
    .attr("transform", `translate(${margin.left}, ${margin.top})`);

  // Add bars group
  g.append("g").attr("class", "timeline-bars");

  // Add axis
  g.append("g")
    .attr("class", "timeline-axis")
    .attr("transform", `translate(0, ${height})`);

  // Add brush
  g.append("g").attr("class", "brush").call(appState.timeline.brush);

  // Add date range label
  g.append("text")
    .attr("class", "date-range-label")
    .attr("x", width / 2)
    .attr("y", -2)
    .attr("text-anchor", "middle");

  appState.timeline.dimensions = { width, height, margin };
}

function drawTimeline() {
  const { width, height } = appState.timeline.dimensions;
  const scale = appState.timeline.scale;

  // Bin data by fortnight (every 2 weeks)
  const fortnightInterval = d3.timeWeek.every(2);
  const bins = d3
    .bin()
    .value((d) => d.date)
    .domain(scale.domain())
    .thresholds(fortnightInterval.range(scale.domain()[0], scale.domain()[1]))(
    appState.fullData,
  );

  // Y scale for bar heights
  const yScale = d3
    .scaleLinear()
    .domain([0, d3.max(bins, (b) => b.length)])
    .range([height, 0]);

  // Calculate bar width
  const barWidth = Math.max(1, width / bins.length - 1);

  // Update bars
  const barsGroup = ELEMENTS.timelineSvg.select(".timeline-bars");
  const bars = barsGroup.selectAll(".timeline-bar").data(bins);

  bars.join(
    (enter) =>
      enter
        .append("rect")
        .attr("class", "timeline-bar")
        .attr("x", (d) => scale(d.x0))
        .attr("y", (d) => yScale(d.length))
        .attr("width", barWidth)
        .attr("height", (d) => height - yScale(d.length)),
    (update) =>
      update
        .attr("x", (d) => scale(d.x0))
        .attr("y", (d) => yScale(d.length))
        .attr("width", barWidth)
        .attr("height", (d) => height - yScale(d.length)),
    (exit) => exit.remove(),
  );

  // Update bar colors based on selection
  updateTimelineBarColors();

  // Update axis
  const tickCount = Math.max(3, Math.floor(width / 80));
  const xAxis = d3.axisBottom(scale).ticks(tickCount).tickSizeOuter(0);
  ELEMENTS.timelineSvg.select(".timeline-axis").call(xAxis);

  // Update date range label
  updateDateRangeLabel();
}

function updateTimelineBarColors() {
  const { selection, scale } = appState.timeline;

  ELEMENTS.timelineSvg.selectAll(".timeline-bar").classed("in-range", (d) => {
    if (!selection) return true; // No selection = all in range
    const barStart = d.x0;
    const barEnd = d.x1;
    return barStart >= selection[0] && barEnd <= selection[1];
  });
}

function updateDateRangeLabel() {
  const label = ELEMENTS.timelineSvg.select(".date-range-label");
  const { selection } = appState.timeline;

  if (selection) {
    const formatDate = d3.timeFormat("%b %Y");
    label.text(`${formatDate(selection[0])} – ${formatDate(selection[1])}`);
  } else {
    const dateExtent = d3.extent(appState.fullData, (d) => d.date);
    const formatDate = d3.timeFormat("%b %Y");
    label.text(`${formatDate(dateExtent[0])} – ${formatDate(dateExtent[1])} (All)`);
  }
}

function handleTimelineBrush(event) {
  const selection = event.selection;

  if (selection) {
    const scale = appState.timeline.scale;
    appState.timeline.selection = [scale.invert(selection[0]), scale.invert(selection[1])];
    appState.dateRange = {
      start: appState.timeline.selection[0],
      end: appState.timeline.selection[1],
    };
  } else {
    appState.timeline.selection = null;
    appState.dateRange = null;
  }

  updateTimelineBarColors();
  updateDateRangeLabel();
  applyDateFilter();
  updateQuadtree();
  applyFilterRules();
  updateFilterCount();
  drawScatterplot();
}

// Apply date range filter to get filteredData
function applyDateFilter() {
  if (!appState.dateRange) {
    appState.filteredData = appState.fullData;
  } else {
    const { start, end } = appState.dateRange;
    appState.filteredData = appState.fullData.filter(
      (d) => d.date >= start && d.date <= end,
    );
  }
}

// --- N_Neighbors Selector Setup ---
function setupNNSelector() {
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

      console.log(`Transitioned to n_neighbors = ${targetNN}`);
    }
  });
}

// --- Link Depth Selector Setup ---
function setupLinkDepthSelector() {
  ELEMENTS.linkDepthSelect.on("change", handleLinkDepthChange);
}

function handleLinkDepthChange() {
  appState.linkDepth = parseInt(ELEMENTS.linkDepthSelect.property("value"), 10);
  updateHoverHighlight();
}

// --- Event Handlers Setup ---
function setupEventHandlers() {
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

// --- Filter Builder Setup ---
function setupFilterBuilder() {
  ELEMENTS.addFilterBtn.on("click", () => addFilterRule());
}

function addFilterRule(logic = "AND") {
  const ruleId = appState.filterRuleIdCounter++;
  const rule = {
    id: ruleId,
    field: CONFIG.filterFields[0].id,
    operator: CONFIG.filterOperators[CONFIG.filterFields[0].type][0].id,
    value: "",
    logic: appState.filterRules.length > 0 ? logic : null,
    negate: false, // NOT toggle
    editing: true, // Start in editing mode
  };
  appState.filterRules.push(rule);
  renderFilterRules();
}

function removeFilterRule(ruleId) {
  const index = appState.filterRules.findIndex((r) => r.id === ruleId);
  if (index !== -1) {
    appState.filterRules.splice(index, 1);
    // If removed first rule, clear logic from new first rule
    if (index === 0 && appState.filterRules.length > 0) {
      appState.filterRules[0].logic = null;
    }
    renderFilterRules();
    applyFilterRules();
    updateFilterCount();
    drawScatterplot();
  }
}

function updateFilterRule(ruleId, field, value) {
  const rule = appState.filterRules.find((r) => r.id === ruleId);
  if (rule) {
    rule[field] = value;
    // If field changed, reset operator to first valid one
    if (field === "field") {
      const fieldConfig = CONFIG.filterFields.find((f) => f.id === value);
      if (fieldConfig) {
        rule.operator = CONFIG.filterOperators[fieldConfig.type][0].id;
      }
    }
    if (field !== "value") {
      renderFilterRules();
    }
    applyFilterRules();
    updateFilterCount();
    drawScatterplot();
  }
}

function toggleFilterLogic(ruleId) {
  const rule = appState.filterRules.find((r) => r.id === ruleId);
  if (rule && rule.logic) {
    rule.logic = rule.logic === "AND" ? "OR" : "AND";
    renderFilterRules();
    applyFilterRules();
    updateFilterCount();
    drawScatterplot();
  }
}

function renderFilterRules() {
  ELEMENTS.filterRulesContainer.selectAll("*").remove();

  appState.filterRules.forEach((rule, index) => {
    const fieldConfig = CONFIG.filterFields.find((f) => f.id === rule.field);
    const operators = CONFIG.filterOperators[fieldConfig?.type || "string"];
    const operatorConfig = operators.find((op) => op.id === rule.operator);

    // Logic connector (before rule, except first)
    if (rule.logic) {
      const connector = ELEMENTS.filterRulesContainer
        .append("div")
        .attr("class", "filter-logic-connector");

      connector
        .append("button")
        .attr("class", `logic-btn ${rule.logic === "AND" ? "active" : ""}`)
        .text("AND")
        .on("click", () => {
          if (rule.logic !== "AND") toggleFilterLogic(rule.id);
        });

      connector
        .append("button")
        .attr("class", `logic-btn ${rule.logic === "OR" ? "active" : ""}`)
        .text("OR")
        .on("click", () => {
          if (rule.logic !== "OR") toggleFilterLogic(rule.id);
        });
    }

    // Rule container
    const ruleDiv = ELEMENTS.filterRulesContainer
      .append("div")
      .attr("class", `filter-rule ${rule.editing ? "editing" : "condensed"}`)
      .attr("data-rule-id", rule.id);

    if (rule.editing) {
      // === EDITING VIEW (stacked) ===

      // NOT toggle row
      const notRow = ruleDiv.append("div").attr("class", "filter-rule-row not-row");
      const notLabel = notRow.append("label").attr("class", "not-toggle");
      notLabel
        .append("input")
        .attr("type", "checkbox")
        .property("checked", rule.negate)
        .on("change", function () {
          rule.negate = this.checked;
          applyFilterRules();
          updateFilterCount();
          drawScatterplot();
        });
      notLabel.append("span").text("NOT (exclude matches)");

      // Field row
      const fieldRow = ruleDiv.append("div").attr("class", "filter-rule-row");
      fieldRow.append("label").attr("class", "rule-label").text("Field");
      const fieldSelect = fieldRow
        .append("select")
        .attr("class", "filter-field-select")
        .on("change", function () {
          updateFilterRule(rule.id, "field", this.value);
        });

      CONFIG.filterFields.forEach((f) => {
        fieldSelect
          .append("option")
          .attr("value", f.id)
          .property("selected", f.id === rule.field)
          .text(f.label);
      });

      // Operator row
      const opRow = ruleDiv.append("div").attr("class", "filter-rule-row");
      opRow.append("label").attr("class", "rule-label").text("Operator");
      const opSelect = opRow
        .append("select")
        .attr("class", "filter-op-select")
        .on("change", function () {
          updateFilterRule(rule.id, "operator", this.value);
        });

      operators.forEach((op) => {
        opSelect
          .append("option")
          .attr("value", op.id)
          .property("selected", op.id === rule.operator)
          .text(op.label);
      });

      // Value row
      const valueRow = ruleDiv.append("div").attr("class", "filter-rule-row");
      valueRow.append("label").attr("class", "rule-label").text("Value");
      const valueContainer = valueRow
        .append("div")
        .attr("class", "filter-rule-value-container");

      valueContainer
        .append("input")
        .attr("type", "text")
        .attr("placeholder", `Enter ${fieldConfig?.label || "value"}...`)
        .property("value", rule.value)
        .on("input", function () {
          rule.value = this.value;
          showFilterAutocomplete(rule.id, this.value);
          applyFilterRules();
          updateFilterCount();
          drawScatterplot();
        })
        .on("focus", function () {
          showFilterAutocomplete(rule.id, this.value);
        })
        .on("keydown", function (event) {
          handleFilterAutocompleteKeydown(event, rule.id);
        });

      valueContainer
        .append("div")
        .attr("class", "autocomplete-dropdown")
        .attr("id", `autocomplete-${rule.id}`);

      // Action buttons row
      const actionsRow = ruleDiv.append("div").attr("class", "filter-rule-actions");

      actionsRow
        .append("button")
        .attr("class", "rule-done-btn")
        .text("Done")
        .on("click", () => {
          rule.editing = false;
          renderFilterRules();
        });

      actionsRow
        .append("button")
        .attr("class", "rule-remove-btn")
        .text("Remove")
        .on("click", () => removeFilterRule(rule.id));

    } else {
      // === CONDENSED VIEW ===
      const summaryDiv = ruleDiv.append("div").attr("class", "filter-rule-summary");

      // Build summary text
      const negateText = rule.negate ? "NOT " : "";
      const fieldLabel = fieldConfig?.label || rule.field;
      const opLabel = operatorConfig?.label || rule.operator;
      const valueText = rule.value || "(empty)";

      summaryDiv
        .append("span")
        .attr("class", "rule-summary-text")
        .html(`${negateText}<strong>${fieldLabel}</strong> ${opLabel} "<em>${valueText}</em>"`);

      // Edit button
      summaryDiv
        .append("button")
        .attr("class", "rule-edit-btn")
        .text("Edit")
        .on("click", () => {
          rule.editing = true;
          renderFilterRules();
        });

      // Remove button
      summaryDiv
        .append("button")
        .attr("class", "remove-rule-btn")
        .html("&times;")
        .on("click", () => removeFilterRule(rule.id));
    }
  });
}

// --- Filter Autocomplete ---
function getAutocompleteOptions(fieldId, query) {
  const queryLower = query.toLowerCase().trim();
  let options = [];

  if (fieldId === "author") {
    options = appState.uniqueAuthors;
  } else if (fieldId === "tag") {
    options = appState.uniqueTags;
  } else {
    return []; // No autocomplete for title
  }

  if (!queryLower) {
    return options.slice(0, 50); // Limit initial list
  }

  return options.filter((opt) => opt.toLowerCase().includes(queryLower));
}

function showFilterAutocomplete(ruleId, query) {
  const rule = appState.filterRules.find((r) => r.id === ruleId);
  if (!rule) return;

  const options = getAutocompleteOptions(rule.field, query);
  const dropdown = d3.select(`#autocomplete-${ruleId}`);

  dropdown.selectAll("*").remove();

  if (options.length === 0) {
    if (rule.field !== "title" && query) {
      dropdown
        .append("div")
        .attr("class", "autocomplete-no-results")
        .text("No matches found");
    }
    dropdown.classed("visible", options.length > 0 || (rule.field !== "title" && query));
    appState.activeAutocomplete = null;
    return;
  }

  appState.activeAutocomplete = {
    ruleId,
    options,
    highlightedIndex: -1,
  };

  options.slice(0, 50).forEach((option, index) => {
    dropdown
      .append("div")
      .attr("class", "autocomplete-item")
      .attr("data-index", index)
      .text(option)
      .on("mousedown", (event) => {
        event.preventDefault();
        selectFilterAutocompleteOption(ruleId, option);
      })
      .on("mouseenter", () => {
        appState.activeAutocomplete.highlightedIndex = index;
        updateAutocompleteHighlight(ruleId);
      });
  });

  dropdown.classed("visible", true);
}

function updateAutocompleteHighlight(ruleId) {
  const dropdown = d3.select(`#autocomplete-${ruleId}`);
  const { highlightedIndex } = appState.activeAutocomplete || {};

  dropdown.selectAll(".autocomplete-item").classed("highlighted", (d, i) => i === highlightedIndex);
}

function handleFilterAutocompleteKeydown(event, ruleId) {
  if (!appState.activeAutocomplete || appState.activeAutocomplete.ruleId !== ruleId) {
    return;
  }

  const { options, highlightedIndex } = appState.activeAutocomplete;

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      if (options.length > 0) {
        appState.activeAutocomplete.highlightedIndex = Math.min(
          highlightedIndex + 1,
          Math.min(options.length, 50) - 1,
        );
        updateAutocompleteHighlight(ruleId);
        scrollToHighlightedItem(ruleId);
      }
      break;

    case "ArrowUp":
      event.preventDefault();
      if (options.length > 0) {
        appState.activeAutocomplete.highlightedIndex = Math.max(highlightedIndex - 1, 0);
        updateAutocompleteHighlight(ruleId);
        scrollToHighlightedItem(ruleId);
      }
      break;

    case "Enter":
      event.preventDefault();
      if (highlightedIndex >= 0 && options[highlightedIndex]) {
        selectFilterAutocompleteOption(ruleId, options[highlightedIndex]);
      }
      break;

    case "Escape":
      closeFilterAutocomplete();
      break;
  }
}

function scrollToHighlightedItem(ruleId) {
  const dropdown = d3.select(`#autocomplete-${ruleId}`);
  const highlighted = dropdown.select(".autocomplete-item.highlighted").node();
  if (highlighted) {
    highlighted.scrollIntoView({ block: "nearest" });
  }
}

function selectFilterAutocompleteOption(ruleId, value) {
  const rule = appState.filterRules.find((r) => r.id === ruleId);
  if (rule) {
    rule.value = value;
    // Update input value
    d3.select(`.filter-rule[data-rule-id="${ruleId}"] input`).property("value", value);
    closeFilterAutocomplete();
    applyFilterRules();
    updateFilterCount();
    drawScatterplot();
  }
}

function closeFilterAutocomplete() {
  d3.selectAll(".autocomplete-dropdown").classed("visible", false);
  appState.activeAutocomplete = null;
}

// --- Quadtree ---
function updateQuadtree() {
  appState.quadtree = d3
    .quadtree()
    .x((d) => d.px)
    .y((d) => d.py)
    .addAll(appState.filteredData);
}

// --- Drawing ---
function drawScatterplot() {
  const ctx = appState.canvasContext;
  const { plotWidth, plotHeight } = appState.dimensions;
  const transform = appState.currentTransform;

  ctx.save();
  ctx.clearRect(0, 0, plotWidth, plotHeight);
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);

  const radius = CONFIG.pointRadius / transform.k;
  const highlightRadius = CONFIG.highlightRadius / transform.k;

  // Use filteredData (after date range filter)
  const data = appState.filteredData;
  const hasActiveFilter = appState.filterRules.some((r) => r.value.trim());

  // Draw unmatched points first (smaller, gray)
  ctx.fillStyle = CONFIG.colors.inactive;
  data.forEach((d) => {
    if (!appState.matchedIds.has(d.id)) {
      ctx.beginPath();
      ctx.arc(d.px, d.py, radius, 0, 2 * Math.PI);
      ctx.fill();
    }
  });

  // Draw matched points on top (larger, colored)
  ctx.fillStyle = CONFIG.colors.matched;
  data.forEach((d) => {
    if (appState.matchedIds.has(d.id)) {
      ctx.beginPath();
      ctx.arc(d.px, d.py, hasActiveFilter ? highlightRadius : radius, 0, 2 * Math.PI);
      ctx.fill();
    }
  });

  ctx.restore();

  updateHoverHighlight();
}

// --- Internal Links Visualization ---

// Get the appropriate color for internal link lines based on point's filter state
function getInternalLinkColor(point) {
  const hasActiveFilter = appState.filterRules.some((r) => r.value.trim());

  if (hasActiveFilter && appState.matchedIds.has(point.id)) {
    return CONFIG.colors.matched;
  }
  // Not filtered or no active filter - use default internal link color
  return CONFIG.colors.internalLink;
}

// Resolve internal link IDs to article objects recursively
// Returns an array of { article, level, sourceId } objects
function resolveLinkedArticles(sourcePoint, maxDepth = 1) {
  const result = [];
  const visited = new Set([sourcePoint.id]); // Track visited to avoid cycles

  function resolveAtDepth(currentPoint, currentDepth) {
    if (currentDepth > maxDepth) return;
    if (!currentPoint.internalLinks || currentPoint.internalLinks.length === 0) return;

    for (const linkedId of currentPoint.internalLinks) {
      const linkedIdStr = String(linkedId);
      if (visited.has(linkedIdStr)) continue;

      const linkedArticle = appState.articlesByExternalId.get(linkedIdStr);
      if (linkedArticle) {
        visited.add(linkedIdStr);
        result.push({
          article: linkedArticle,
          level: currentDepth,
          sourceId: currentPoint.id,
        });

        // Recurse to next level
        if (currentDepth < maxDepth) {
          resolveAtDepth(linkedArticle, currentDepth + 1);
        }
      }
    }
  }

  resolveAtDepth(sourcePoint, 1);
  return result;
}

// Get just the direct linked articles (for tooltip display)
function getDirectLinkedArticles(sourcePoint) {
  const linkedArticles = [];
  if (!sourcePoint.internalLinks || sourcePoint.internalLinks.length === 0) {
    return linkedArticles;
  }

  for (const linkedId of sourcePoint.internalLinks) {
    const linkedArticle = appState.articlesByExternalId.get(String(linkedId));
    if (linkedArticle) {
      linkedArticles.push(linkedArticle);
    }
  }

  return linkedArticles;
}

// Draw internal link lines and target circles from source point to linked articles
function drawInternalLinks(sourcePoint) {
  clearInternalLinks();

  if (!sourcePoint) return;

  const linkedArticles = resolveLinkedArticles(sourcePoint, appState.linkDepth);
  if (linkedArticles.length === 0) return;

  const transform = appState.currentTransform;
  const baseColor = getInternalLinkColor(sourcePoint);

  // Build a map of article positions for drawing lines
  const positionMap = new Map();
  positionMap.set(sourcePoint.id, {
    cx: transform.applyX(sourcePoint.px),
    cy: transform.applyY(sourcePoint.py),
  });

  linkedArticles.forEach(({ article }) => {
    positionMap.set(article.id, {
      cx: transform.applyX(article.px),
      cy: transform.applyY(article.py),
    });
  });

  // Draw lines with arrows to each linked article
  linkedArticles.forEach(({ article: target, level, sourceId }) => {
    const sourcePos = positionMap.get(sourceId);
    const targetPos = positionMap.get(target.id);

    if (!sourcePos || !targetPos) return;

    const sourceCx = sourcePos.cx;
    const sourceCy = sourcePos.cy;
    const targetCx = targetPos.cx;
    const targetCy = targetPos.cy;

    // Calculate offset to stop line at edge of target circle
    const dx = targetCx - sourceCx;
    const dy = targetCy - sourceCy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const targetRadius = 5; // Radius of target circle
    const arrowOffset = targetRadius + 2; // Small gap for arrow

    // Adjusted end point (stop before target circle)
    let endX = targetCx;
    let endY = targetCy;
    if (dist > arrowOffset) {
      endX = targetCx - (dx / dist) * arrowOffset;
      endY = targetCy - (dy / dist) * arrowOffset;
    }

    // Get stroke width based on level
    const strokeWidth = level === 1 ? 1.5 : level === 2 ? 1.2 : 1;

    // Draw dashed line with arrow
    ELEMENTS.internalLinksGroup
      .append("line")
      .attr("class", `internal-link-line level-${level}`)
      .attr("x1", sourceCx)
      .attr("y1", sourceCy)
      .attr("x2", endX)
      .attr("y2", endY)
      .attr("stroke", baseColor)
      .attr("stroke-width", strokeWidth)
      .attr("stroke-dasharray", level === 1 ? "4,3" : level === 2 ? "3,4" : "2,4")
      .attr("marker-end", "url(#link-arrow)")
      .style("color", baseColor); // For the arrow marker fill

    // Draw dashed circle around target
    ELEMENTS.internalLinksGroup
      .append("circle")
      .attr("class", `internal-link-target level-${level}`)
      .attr("cx", targetCx)
      .attr("cy", targetCy)
      .attr("r", targetRadius)
      .attr("fill", "none")
      .attr("stroke", baseColor)
      .attr("stroke-width", strokeWidth)
      .attr("stroke-dasharray", level === 1 ? "3,2" : level === 2 ? "2,3" : "2,4");
  });
}

// Clear all internal link visualizations
function clearInternalLinks() {
  ELEMENTS.internalLinksGroup.selectAll("*").remove();
}

function updateHoverHighlight() {
  // Sticky point takes priority over hovered point
  const point = appState.stickyPoint || appState.hoveredPoint;
  const transform = appState.currentTransform;

  if (point) {
    const cx = transform.applyX(point.px);
    const cy = transform.applyY(point.py);
    ELEMENTS.hoverHighlight
      .attr("cx", cx)
      .attr("cy", cy)
      .style("display", "block");

    // Draw internal links from the active point
    drawInternalLinks(point);
  } else {
    ELEMENTS.hoverHighlight.style("display", "none");
    clearInternalLinks();
  }
}

// --- Filter Logic (using sift.js) ---

// Build a sift.js query from filter rules
function buildSiftQuery() {
  const rules = appState.filterRules.filter((r) => r.value.trim());

  if (rules.length === 0) {
    return null; // No filter = match all
  }

  // Group rules by their logic connectors
  // First, split into OR groups (OR has lower precedence)
  const orGroups = [];
  let currentAndGroup = [];

  rules.forEach((rule, index) => {
    if (index === 0 || rule.logic === "AND") {
      currentAndGroup.push(rule);
    } else if (rule.logic === "OR") {
      if (currentAndGroup.length > 0) {
        orGroups.push(currentAndGroup);
      }
      currentAndGroup = [rule];
    }
  });

  if (currentAndGroup.length > 0) {
    orGroups.push(currentAndGroup);
  }

  // Convert each group to sift conditions
  const orConditions = orGroups.map((andGroup) => {
    if (andGroup.length === 1) {
      return buildRuleCondition(andGroup[0], andGroup[0].negate);
    }
    return { $and: andGroup.map((r) => buildRuleCondition(r, r.negate)) };
  });

  if (orConditions.length === 1) {
    return orConditions[0];
  }

  return { $or: orConditions };
}

function buildRuleCondition(rule, negate = false) {
  const fieldConfig = CONFIG.filterFields.find((f) => f.id === rule.field);
  if (!fieldConfig) return {};

  const field = fieldConfig.field;
  const value = rule.value.trim();

  if (!value) return {};

  let condition = {};

  // Build the condition based on operator and field type
  if (fieldConfig.type === "array") {
    // For arrays (tags, authors)
    switch (rule.operator) {
      case "contains":
        // Match if any item in the array contains the value (case-insensitive)
        condition = {
          [field]: {
            $elemMatch: { $regex: new RegExp(escapeRegex(value), "i") },
          },
        };
        break;
      case "equals":
        // Match if any item in the array exactly equals the value (case-insensitive)
        condition = {
          [field]: {
            $elemMatch: { $regex: new RegExp(`^${escapeRegex(value)}$`, "i") },
          },
        };
        break;
      default:
        return {};
    }
  } else {
    // For strings (title)
    switch (rule.operator) {
      case "contains":
        condition = { [field]: { $regex: new RegExp(escapeRegex(value), "i") } };
        break;
      case "startsWith":
        condition = { [field]: { $regex: new RegExp(`^${escapeRegex(value)}`, "i") } };
        break;
      case "equals":
        condition = { [field]: { $regex: new RegExp(`^${escapeRegex(value)}$`, "i") } };
        break;
      default:
        return {};
    }
  }

  // Wrap in $not if negated
  if (negate) {
    return { $not: condition };
  }

  return condition;
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Apply filter rules using sift.js
function applyFilterRules() {
  appState.matchedIds.clear();

  const query = buildSiftQuery();

  if (!query) {
    // No filter = all articles match
    appState.filteredData.forEach((d) => appState.matchedIds.add(d.id));
    return;
  }

  try {
    // sift.default() returns a filter function (UMD export)
    const siftFn = typeof sift === "function" ? sift : sift.default;
    const siftFilter = siftFn(query);

    appState.filteredData.forEach((d) => {
      if (siftFilter(d)) {
        appState.matchedIds.add(d.id);
      }
    });
  } catch (error) {
    console.error("Filter error:", error);
    // On error, match nothing
  }
}

function updateFilterCount() {
  const matchCount = appState.matchedIds.size;
  const hasActiveFilter = appState.filterRules.some((r) => r.value.trim());

  if (hasActiveFilter) {
    ELEMENTS.filterMatchCount.text(
      `${matchCount} article${matchCount !== 1 ? "s" : ""} match`,
    );
  } else {
    ELEMENTS.filterMatchCount.text("No filter active");
  }

  // Update article count with date filter info
  const total = appState.fullData.length;
  const dateFiltered = appState.filteredData.length;
  if (dateFiltered < total) {
    ELEMENTS.articleCount.text(`${dateFiltered} of ${total} articles`);
  } else {
    ELEMENTS.articleCount.text(`${total} articles total`);
  }
}

// --- Event Handlers ---
function handleZoom(event) {
  appState.currentTransform = event.transform;
  updateGridPattern();
  drawScatterplot();
  // Only hide tooltip if no sticky point is locked
  if (!appState.stickyPoint) {
    hideTooltip();
  }
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

  // Show hover tooltip only if no sticky point is locked
  if (!appState.stickyPoint) {
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

  // Only hide tooltip if no sticky point
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

  if (clicked) {
    // Lock tooltip on this point
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

function handleResetFilters() {
  // Reset filter rules
  appState.filterRules = [];
  appState.matchedIds.clear();
  renderFilterRules();

  // Reset date range
  appState.dateRange = null;
  appState.timeline.selection = null;
  ELEMENTS.timelineSvg.select(".brush").call(appState.timeline.brush.move, null);

  // Reset link depth
  appState.linkDepth = 1;
  ELEMENTS.linkDepthSelect.property("value", "1");

  closeFilterAutocomplete();
  applyDateFilter();
  applyFilterRules();
  updateQuadtree();
  updateTimelineBarColors();
  updateDateRangeLabel();
  updateFilterCount();
  drawScatterplot();
}

function handleResize() {
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

  // Restore timeline selection if there was one
  if (appState.dateRange) {
    const { width } = appState.timeline.dimensions;
    const scale = appState.timeline.scale;
    const selection = [
      scale(appState.dateRange.start),
      scale(appState.dateRange.end),
    ];
    ELEMENTS.timelineSvg
      .select(".brush")
      .call(appState.timeline.brush.move, selection);
  }

  drawTimeline();
  drawScatterplot();
}

// --- Tooltip ---
function showTooltip(event, data, sticky = false) {
  const dateStr =
    data.date instanceof Date && !isNaN(data.date)
      ? data.date.toLocaleDateString()
      : "Unknown date";

  const authorsStr =
    data.authors.length > 0 ? data.authors.join(", ") : "Unknown";
  const tagsStr = data.tags.length > 0 ? data.tags.join(", ") : "None";

  // Title as hyperlink
  const titleHtml = data.url
    ? `<a href="${data.url}" target="_blank" class="tooltip-title">${data.title || "Untitled"}</a>`
    : `<span class="tooltip-title">${data.title || "Untitled"}</span>`;

  // Get immediate linked articles (only direct links, not recursive)
  const linkedArticles = getDirectLinkedArticles(data);
  const linksSection = linkedArticles.length > 0
    ? `<div class="links">
        <strong>Links to:</strong>
        <ul>${linkedArticles.map((a) => {
          const aDateStr = a.date instanceof Date && !isNaN(a.date)
            ? a.date.toLocaleDateString()
            : "Unknown date";
          const aAuthorsStr = a.authors.length > 0 ? a.authors.join(", ") : "Unknown";
          const aTitleHtml = a.url
            ? `<a href="${a.url}" target="_blank">${a.title || "Untitled"}</a>`
            : (a.title || "Untitled");
          return `<li>${aTitleHtml}<span class="link-meta">${aAuthorsStr} · ${aDateStr}</span></li>`;
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
  `;

  ELEMENTS.tooltip
    .style("display", "block")
    .style("right", "20px")
    .style("top", "20px")
    .style("pointer-events", sticky ? "auto" : "none")
    .classed("sticky", sticky)
    .html(content);
}

function hideTooltip() {
  ELEMENTS.tooltip
    .style("display", "none")
    .style("pointer-events", "none")
    .classed("sticky", false);
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
