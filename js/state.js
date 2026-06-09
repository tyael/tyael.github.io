// Single source of runtime truth. Modules read/write this object; render()
// functions derive everything they draw from it.
export const appState = {
  // --- loaded data (set by data.js) ---
  count: 0,
  manifest: null,
  projection: null, // active UMAP projection key ("5" | "25" | "125")
  x: null, // Float32Array  data-space coords (active projection)
  y: null, // Float32Array
  px: null, // Float32Array base screen coords (pre-zoom), rebuilt on resize
  py: null, // Float32Array
  source: null, // Uint8Array  0=ASPI 1=Lowy
  date: null, // Int32Array   epoch days
  meta: null, // { tagDict, authorDict, title[], url[], tags[][], authors[][], links[][] }
  backlinks: null, // Array<number[]>  reverse of meta.links
  labels: [], // region labels
  contours: [], // density contour levels

  // --- spatial index + view ---
  quadtree: null,
  scale: null, // { k, ox, oy, cx, cy } base data->screen fit
  dimensions: null, // { width, height }
  transform: null, // d3 zoom transform (set to identity on init)
  zoomBehavior: null,

  // --- cross-filter state (all text fields are case-insensitive "contains") ---
  filter: {
    title: "", // matches article title
    author: "", // matches any author name
    tag: "", // matches any tag name
    source: null, // null | 0 | 1
    dateRange: null, // [startDay, endDay] | null
  },

  // lowercased per-point search columns + tag display helpers (built in data.js)
  titleLC: null,
  authorLC: null,
  tagLC: null,
  tagLcOf: null, // tagDict index -> lowercased name
  tagCanon: null, // lowercased name -> canonical display name
  selectedId: null, // clicked point index (for detail + citation links)
  hoveredId: null,

  // --- derived ---
  matched: null, // Uint8Array mask (1 = passes all filters)
  matchedCount: 0,

  // --- projection transition ---
  overlayAlpha: 1, // 0..1 fade for graticule/contours/labels/links
  transitioning: false, // true while animating a projection switch
};

// DOM element handles, populated by main.js after the document is ready.
export const ELEMENTS = {};
