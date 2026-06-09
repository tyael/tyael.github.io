// Static configuration for the embedding dashboard.
export const CONFIG = {
  dataDir: "data",
  defaultProjection: "25",

  // Rendering — small, translucent points so the contour terrain reads through
  // dense regions and overplotting itself reveals density.
  pointRadius: 1.7, // screen px at zoom 1
  pointAlpha: 0.62,
  selectedRadius: 6,

  // When a filter narrows the match set, emphasise the survivors so a small
  // handful doesn't vanish against the dimmed field. Emphasis ramps up as the
  // match count drops below `emphasisThreshold`, reaching full strength at or
  // below `emphasisFull`. At full strength points grow to `emphasisRadius`
  // (screen px), become opaque, and gain a contrasting halo ring.
  emphasisThreshold: 400,
  emphasisFull: 30,
  emphasisRadius: 4.5, // screen px the dot grows toward at full emphasis
  emphasisHaloRadius: 7, // screen px outer halo radius at full emphasis
  zoomMin: 0.6,
  zoomMax: 60,
  fitPadding: 0.94, // fraction of plot used when fitting the map extent
  graticuleStep: 2, // data-space spacing of the chart grid

  // Labels: a label is shown once the zoom factor passes its level threshold.
  labelMaxPerLevel: 999,

  // Colours mirror the CSS custom properties in style.css (canvas can't read CSS
  // vars). Keep the two in sync. Palette: aged vellum + sepia ink survey chart.
  colors: {
    ground: "#e7ddc8",
    contour: "#7a5c33", // sepia ink (alpha applied per level)
    graticule: "rgba(92, 72, 43, 0.09)",
    aspi: "#c0410f", // vermilion ink (warm)
    lowy: "#235aa6", // prussian blue ink (cool)
    dim: "rgba(70, 58, 40, 0.13)", // filtered-out points
    selectRing: "#1b1812",
    halo: "rgba(247, 240, 224, 0.9)", // pale vellum ring behind emphasised dots
    linkOut: "#0f766e", // teal  — this article links to
    linkIn: "#a65a16", // amber — linked from
  },
};

// Source code <-> label helpers (0 = ASPI, 1 = Lowy).
export const SOURCE_NAME = ["ASPI", "Lowy"];
export const sourceColor = (code) =>
  code === 0 ? CONFIG.colors.aspi : CONFIG.colors.lowy;

// epoch-day <-> Date helpers (meta stores dates as integer days since epoch).
export const MS_PER_DAY = 86400000;
export const dayToDate = (day) => new Date(day * MS_PER_DAY);
export const dateToDay = (date) => Math.floor(date.getTime() / MS_PER_DAY);
