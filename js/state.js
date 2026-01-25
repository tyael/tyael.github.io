// --- Application State ---
export const appState = {
  fullData: [],
  rawData: null, // Original JSON for n_neighbors switching
  articlesByExternalId: new Map(), // Lookup map for internal links
  backlinksMap: new Map(), // Reverse lookup: article ID -> array of articles linking TO it
  uniqueTags: [],
  uniqueAuthors: [],
  availableNNs: [], // Available n_neighbors values
  currentTransform: d3.zoomIdentity,
  dimensions: { width: 0, height: 0, plotWidth: 0, plotHeight: 0 },
  scales: { x: null, y: null },
  timeline: { scale: null, dimensions: null },
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
  // Current n_neighbors value used for coordinates
  currentNN: null,
  // Internal links depth (1, 2, or 3)
  linkDepth: 1,
  // NN transition state
  isTransitioning: false,
  // Date gradient display option
  dateGradientEnabled: false,
  // Cached date extent for gradient calculations
  dateExtent: null,
  // Map labels state
  mapLabelsEnabled: false,
  mapLabels: [], // Array of { level, cx, cy, label, size, zoomThreshold }
  mapLabelsComputed: false,
  // Zoom behavior reference
  zoomBehavior: null,
};

// --- DOM Elements ---
// Note: These are initialized after DOM is ready
export const ELEMENTS = {
  loadingIndicator: null,
  scatterplotContainer: null,
  scatterplotCanvas: null,
  scatterplotSvg: null,
  scatterplotContent: null,
  gridBackground: null,
  xAxisGroup: null,
  yAxisGroup: null,
  internalLinksGroup: null,
  hoverHighlight: null,
  tooltip: null,
  hoverTooltip: null,
  // Filter builder elements
  filterRulesContainer: null,
  addFilterBtn: null,
  filterMatchCount: null,
  resetFiltersBtn: null,
  articleCount: null,
  // Timeline and projection elements
  timelineContainer: null,
  timelineSvg: null,
  nnSelect: null,
  linkDepthSelect: null,
  dateGradientToggle: null,
  mapLabelsToggle: null,
  mapLabelsGroup: null,
};

// Initialize DOM element references
export function initializeElements() {
  ELEMENTS.loadingIndicator = d3.select("#loading-indicator");
  ELEMENTS.scatterplotContainer = d3.select("#scatterplot-container");
  ELEMENTS.scatterplotCanvas = d3.select("#scatterplot-canvas");
  ELEMENTS.scatterplotSvg = d3.select("#scatterplot-svg");
  ELEMENTS.scatterplotContent = d3.select("#scatterplot-svg g.scatterplot-content");
  ELEMENTS.gridBackground = d3.select("#scatterplot-svg .grid-background");
  ELEMENTS.xAxisGroup = d3.select("#scatterplot-svg g.x-axis");
  ELEMENTS.yAxisGroup = d3.select("#scatterplot-svg g.y-axis");
  ELEMENTS.internalLinksGroup = d3.select("#scatterplot-svg .internal-links");
  ELEMENTS.hoverHighlight = d3.select("#scatterplot-svg .hover-highlight");
  ELEMENTS.tooltip = d3.select("#tooltip");
  ELEMENTS.hoverTooltip = d3.select("#hover-tooltip");
  // Filter builder elements
  ELEMENTS.filterRulesContainer = d3.select("#filter-rules");
  ELEMENTS.addFilterBtn = d3.select("#add-filter-btn");
  ELEMENTS.filterMatchCount = d3.select("#filter-match-count");
  ELEMENTS.resetFiltersBtn = d3.select("#reset-filters-btn");
  ELEMENTS.articleCount = d3.select("#article-count");
  // Timeline and projection elements
  ELEMENTS.timelineContainer = d3.select("#timeline-container");
  ELEMENTS.timelineSvg = d3.select("#timeline-svg");
  ELEMENTS.nnSelect = d3.select("#nn-select");
  ELEMENTS.linkDepthSelect = d3.select("#link-depth-select");
  ELEMENTS.dateGradientToggle = d3.select("#date-gradient-toggle");
  ELEMENTS.mapLabelsToggle = d3.select("#map-labels-toggle");
  ELEMENTS.mapLabelsGroup = d3.select("#scatterplot-svg .map-labels");
}
