import { CONFIG, sourceColor } from "./config.js";
import { appState, ELEMENTS } from "./state.js";
import { renderLabels } from "./labels.js";
import { renderLinks } from "./links.js";
import { fetchProjectionAssets, applyProjectionAssets } from "./data.js";

// --- layout / scale -------------------------------------------------------
function measure() {
  const rect = ELEMENTS.mapContainer.node().getBoundingClientRect();
  appState.dimensions = { width: rect.width, height: rect.height };
  return appState.dimensions;
}

// Fit the data extent into the plot, preserving aspect ratio (no distortion).
function computeScale() {
  const { width, height } = appState.dimensions;
  const e = appState.manifest.extents[appState.projection];
  const dataW = e.xmax - e.xmin;
  const dataH = e.ymax - e.ymin;
  const k = Math.min(width / dataW, height / dataH) * CONFIG.fitPadding;
  appState.scale = {
    k,
    dataCx: (e.xmin + e.xmax) / 2,
    dataCy: (e.ymin + e.ymax) / 2,
    screenCx: width / 2,
    screenCy: height / 2,
  };
}

// data-space -> base screen coords (before the live zoom transform). y flips so
// larger embedding-y is visually up.
export function sx(x) {
  const s = appState.scale;
  return s.screenCx + (x - s.dataCx) * s.k;
}
export function sy(y) {
  const s = appState.scale;
  return s.screenCy - (y - s.dataCy) * s.k;
}

function buildBaseCoords() {
  const N = appState.count;
  const px = new Float32Array(N);
  const py = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    px[i] = sx(appState.x[i]);
    py[i] = sy(appState.y[i]);
  }
  appState.px = px;
  appState.py = py;
}

function buildQuadtree() {
  const idx = d3.range(appState.count);
  appState.quadtree = d3
    .quadtree()
    .x((i) => appState.px[i])
    .y((i) => appState.py[i])
    .addAll(idx);
}

// --- canvas sizing (devicePixelRatio aware) -------------------------------
function setupCanvas() {
  const { width, height } = appState.dimensions;
  const dpr = window.devicePixelRatio || 1;
  const canvas = ELEMENTS.canvas.node();
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + "px";
  canvas.style.height = height + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  appState.ctx = ctx;
  ELEMENTS.svg.attr("width", width).attr("height", height);
}

// --- zoom -----------------------------------------------------------------
function setupZoom() {
  const zoom = d3
    .zoom()
    .scaleExtent([CONFIG.zoomMin, CONFIG.zoomMax])
    .on("zoom", (event) => {
      appState.transform = event.transform;
      renderMap();
    });
  ELEMENTS.svg.call(zoom).on("dblclick.zoom", null);
  appState.zoomBehavior = zoom;
}

export function resetZoom() {
  ELEMENTS.svg
    .transition()
    .duration(500)
    .call(appState.zoomBehavior.transform, d3.zoomIdentity);
}

// requestAnimationFrame tween: calls onTick(easedT) each frame until done.
function tween(dur, onTick, ease = (t) => t) {
  return new Promise((resolve) => {
    const start = performance.now();
    (function frame(now) {
      const raw = Math.min(1, (now - start) / dur);
      onTick(ease(raw));
      raw < 1 ? requestAnimationFrame(frame) : resolve();
    })(performance.now());
  });
}

// Points-only paint at absolute screen coords (used mid-transition while the
// graticule/contours/labels are faded out). Reuses the full point styling so
// filtered/emphasised/selected groups keep rendering as the points move.
function paintPointsOnly(xs, ys) {
  const ctx = appState.ctx;
  const { width, height } = appState.dimensions;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = CONFIG.colors.ground;
  ctx.fillRect(0, 0, width, height);
  drawPoints(ctx, 1, xs, ys); // k=1: positions absolute, radii in screen px
}

// Switch UMAP projection with an animated transition: fade overlays out, fly the
// points to their new positions, then fade overlays back in. Filter mask and
// selection (point indices) are projection-independent and preserved throughout.
export async function setProjection(proj) {
  if (proj === appState.projection || appState.transitioning) return;
  appState.transitioning = true;
  const N = appState.count;

  // snapshot where every point currently sits on screen (old projection + zoom)
  const t = appState.transform;
  const fromX = new Float32Array(N);
  const fromY = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    fromX[i] = t.applyX(appState.px[i]);
    fromY[i] = t.applyY(appState.py[i]);
  }

  // 1. start fetching the new projection now, and fade the overlays out in
  //    parallel — so there's no idle "tail" waiting on the network afterwards
  const assets = fetchProjectionAssets(proj);
  await tween(120, (e) => { appState.overlayAlpha = 1 - e; renderMap(); }, d3.easeCubicInOut);

  // 2. swap in the new projection (overlays now invisible) and compute target
  //    (fitted) screen positions
  applyProjectionAssets(await assets);
  computeScale();
  buildBaseCoords(); // appState.px/py now hold the new fitted positions
  const toX = appState.px;
  const toY = appState.py;

  // 3. fly the points from old to new positions (overlays hidden)
  const ax = new Float32Array(N);
  const ay = new Float32Array(N);
  await tween(500, (e) => {
    for (let i = 0; i < N; i++) {
      ax[i] = fromX[i] + (toX[i] - fromX[i]) * e;
      ay[i] = fromY[i] + (toY[i] - fromY[i]) * e;
    }
    paintPointsOnly(ax, ay);
  }, d3.easeCubicInOut);

  // 4. settle at the fitted (identity) view and rebuild the spatial index
  appState.transform = d3.zoomIdentity;
  ELEMENTS.svg.call(appState.zoomBehavior.transform, d3.zoomIdentity);
  buildQuadtree();

  // 5. fade the overlays back in for the new projection
  await tween(120, (e) => { appState.overlayAlpha = e; renderMap(); }, d3.easeCubicInOut);
  appState.overlayAlpha = 1;
  appState.transitioning = false;
}

// --- drawing --------------------------------------------------------------
export function renderMap() {
  const ctx = appState.ctx;
  const t = appState.transform;
  const { width, height } = appState.dimensions;
  const oa = appState.overlayAlpha;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = CONFIG.colors.ground;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.scale(t.k, t.k);

  if (oa > 0) {
    drawGraticule(ctx, t.k, oa);
    drawContours(ctx, t.k, oa);
  }
  drawPoints(ctx, t.k);

  ctx.restore();

  // SVG overlays (positioned in screen space, read the same transform)
  renderLabels();
  renderLinks();
  ELEMENTS.labelsGroup.style("opacity", oa);
  ELEMENTS.linksGroup.style("opacity", oa);
}

// Faint chart grid in data space (moves with the map like a graticule).
function drawGraticule(ctx, k, oa = 1) {
  const e = appState.manifest.extents[appState.projection];
  const step = CONFIG.graticuleStep;
  ctx.beginPath();
  for (let gx = Math.ceil(e.xmin / step) * step; gx <= e.xmax; gx += step) {
    ctx.moveTo(sx(gx), sy(e.ymin));
    ctx.lineTo(sx(gx), sy(e.ymax));
  }
  for (let gy = Math.ceil(e.ymin / step) * step; gy <= e.ymax; gy += step) {
    ctx.moveTo(sx(e.xmin), sy(gy));
    ctx.lineTo(sx(e.xmax), sy(gy));
  }
  ctx.strokeStyle = CONFIG.colors.graticule;
  ctx.lineWidth = 1 / k;
  ctx.globalAlpha = oa;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawContours(ctx, k, oa = 1) {
  const levels = appState.contours;
  for (let li = 0; li < levels.length; li++) {
    const segs = levels[li].segments;
    ctx.beginPath();
    for (const s of segs) {
      ctx.moveTo(sx(s[0]), sy(s[1]));
      ctx.lineTo(sx(s[2]), sy(s[3]));
    }
    ctx.strokeStyle = CONFIG.colors.contour;
    ctx.globalAlpha = (0.32 + li * 0.13) * oa;
    ctx.lineWidth = (0.7 + li * 0.2) / k;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// `fast` (default: during a projection transition) batches each group into one
// path + a single fill — ~3 fills/frame vs ~27k. It drops the translucent
// overlap-density shading, which only matters for the static view, so the static
// view keeps the per-point fills and animation frames use the cheap path.
function drawPoints(ctx, k, xs = appState.px, ys = appState.py, fast = appState.transitioning) {
  const { source, matched, matchedCount, count } = appState;
  const px = xs, py = ys; // local aliases (xs/ys may be interpolated coords)
  const r = CONFIG.pointRadius / k;
  const filtering = matchedCount < count;

  // Emphasis factor in [0,1]: 0 when the match set is large, ramping to 1 as it
  // shrinks past `emphasisThreshold` down to `emphasisFull`. Only when filtering.
  let em = 0;
  if (filtering) {
    const { emphasisThreshold: hi, emphasisFull: lo } = CONFIG;
    em = Math.max(0, Math.min(1, (hi - matchedCount) / (hi - lo)));
  }
  // Emphasised dot/halo radii, blended from the base radius by `em`.
  const dotR = (CONFIG.pointRadius + em * (CONFIG.emphasisRadius - CONFIG.pointRadius)) / k;
  const haloR = (CONFIG.pointRadius + em * (CONFIG.emphasisHaloRadius - CONFIG.pointRadius)) / k;
  const alpha = CONFIG.pointAlpha + em * (1 - CONFIG.pointAlpha);

  // Draw a disc, either as its own path+fill (per-point, density shading) or
  // appended to the current batched path (caller fills once).
  const disc = (cx, cy, rr) => {
    if (fast) {
      ctx.moveTo(cx + rr, cy); // avoids a connecting line from the previous arc
      ctx.arc(cx, cy, rr, 0, 7);
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, 7);
      ctx.fill();
    }
  };

  if (filtering) {
    // dimmed background of filtered-out points
    ctx.fillStyle = CONFIG.colors.dim;
    if (fast) ctx.beginPath();
    for (let i = 0; i < count; i++) {
      if (matched[i]) continue;
      disc(px[i], py[i], r);
    }
    if (fast) ctx.fill();

    // pale halo behind each survivor so it pops off the field and the terrain
    if (em > 0) {
      ctx.fillStyle = CONFIG.colors.halo;
      ctx.globalAlpha = em;
      if (fast) ctx.beginPath();
      for (let i = 0; i < count; i++) {
        if (!matched[i]) continue;
        disc(px[i], py[i], haloR);
      }
      if (fast) ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // matched (or all) points, coloured by source. Translucent when unfiltered so
  // the terrain shows through; opaque and enlarged as emphasis ramps up. Batch
  // per colour.
  ctx.globalAlpha = alpha;
  for (const code of [0, 1]) {
    ctx.fillStyle = sourceColor(code);
    if (fast) ctx.beginPath();
    for (let i = 0; i < count; i++) {
      if (source[i] !== code) continue;
      if (filtering && !matched[i]) continue;
      disc(px[i], py[i], dotR);
    }
    if (fast) ctx.fill();
  }
  ctx.globalAlpha = 1;

  // selected point: emphasised opaque dot with registration ring
  const sel = appState.selectedId;
  if (sel != null) {
    ctx.fillStyle = sourceColor(source[sel]);
    ctx.beginPath();
    ctx.arc(px[sel], py[sel], (CONFIG.selectedRadius - 1) / k, 0, 7);
    ctx.fill();
    ctx.lineWidth = 2 / k;
    ctx.strokeStyle = CONFIG.colors.selectRing;
    ctx.stroke();
  }
}

// --- hit testing ----------------------------------------------------------
// Pointer (css px) -> nearest point index within a small radius, or null.
export function pickPoint(mx, my) {
  const t = appState.transform;
  if (!t || !appState.quadtree || appState.transitioning) return null;
  const bx = t.invertX(mx); // base screen coords
  const by = t.invertY(my);
  const radius = Math.max(8, CONFIG.pointRadius * 2.5) / t.k;
  const found = appState.quadtree.find(bx, by, radius);
  return found == null ? null : found;
}

// --- setup / resize -------------------------------------------------------
export function setupMap() {
  measure();
  computeScale();
  buildBaseCoords();
  buildQuadtree();
  setupCanvas();
  setupZoom();
  appState.transform = d3.zoomIdentity;
  renderMap();
}

export function resizeMap() {
  measure();
  computeScale();
  buildBaseCoords();
  buildQuadtree();
  setupCanvas();
  renderMap();
}
