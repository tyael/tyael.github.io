#!/usr/bin/env node
// One-time offline preprocessing: articles.json (source of truth) -> slim static
// assets in data/. Pure Node, no external dependencies. Re-run whenever
// articles.json changes:  node build/preprocess.mjs
//
// Emits:
//   data/coords-{5,25,125}.bin  Float32 interleaved [x,y,...] in point-index order
//   data/meta.json              columnar metadata (dictionaries + parallel arrays)
//   data/labels-{5,25,125}.json topic-region labels, one set per projection
//   data/contours-{5,25,125}.json density contour lines, one set per projection
//   data/manifest.json          extents, counts, date range, defaults
//   data/.nojekyll              so GitHub Pages serves .bin / dirs untouched

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const PROJECTIONS = ["5", "25", "125"];
const DEFAULT_PROJECTION = "25";

// ---------------------------------------------------------------------------
// Load + index
// ---------------------------------------------------------------------------
console.time("total");
console.log("Reading articles.json ...");
const raw = JSON.parse(readFileSync(join(ROOT, "articles.json"), "utf8"));
const N = raw.length;
console.log(`  ${N} articles`);

// post_ids are contiguous 1..N; index = post_id - 1. Place into a dense array so
// internal_links (which reference post_ids) map straight to point indices.
const byIndex = new Array(N).fill(null);
for (const a of raw) {
  const idx = a.post_id - 1;
  if (idx < 0 || idx >= N) throw new Error(`post_id ${a.post_id} out of range`);
  if (byIndex[idx]) throw new Error(`duplicate post_id ${a.post_id}`);
  byIndex[idx] = a;
}
const missing = byIndex.filter((x) => !x).length;
if (missing) throw new Error(`${missing} gaps in post_id sequence`);

function sourceOf(url) {
  if (/aspistrategist\.org\.au/.test(url)) return 0; // ASPI
  if (/lowyinstitute\.org/.test(url)) return 1; // Lowy
  throw new Error(`unknown source url: ${url}`);
}
const MS_PER_DAY = 86400000;

// ---------------------------------------------------------------------------
// Columnar metadata + dictionaries
// ---------------------------------------------------------------------------
const tagDict = [];
const tagIndex = new Map();
const authorDict = [];
const authorIndex = new Map();
const intern = (dict, map, value) => {
  let i = map.get(value);
  if (i === undefined) {
    i = dict.length;
    dict.push(value);
    map.set(value, i);
  }
  return i;
};

const source = new Array(N);
const date = new Array(N); // epoch days
const title = new Array(N);
const url = new Array(N);
const tags = new Array(N);
const authors = new Array(N);
const links = new Array(N);

for (let i = 0; i < N; i++) {
  const a = byIndex[i];
  source[i] = sourceOf(a.url);
  date[i] = Math.floor(new Date(a.published_at_local).getTime() / MS_PER_DAY);
  title[i] = a.title || "";
  url[i] = a.url;
  tags[i] = (a.tags || []).map((t) => intern(tagDict, tagIndex, t));
  authors[i] = (a.authors || []).map((p) => intern(authorDict, authorIndex, p));
  // internal_links are post_ids -> point indices; drop self/out-of-range/dupes
  const seen = new Set();
  links[i] = (a.internal_links || [])
    .map((pid) => pid - 1)
    .filter((j) => j >= 0 && j < N && j !== i && !seen.has(j) && seen.add(j));
}

mkdirSync(DATA, { recursive: true });
writeFileSync(
  join(DATA, "meta.json"),
  JSON.stringify({ count: N, tagDict, authorDict, source, date, title, url, tags, authors, links }),
);
console.log(`  meta.json: ${tagDict.length} tags, ${authorDict.length} authors`);

// ---------------------------------------------------------------------------
// Coordinate binaries (Float32, interleaved) + per-projection extents
// ---------------------------------------------------------------------------
const extents = {};
for (const p of PROJECTIONS) {
  const buf = new Float32Array(N * 2);
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < N; i++) {
    const c = byIndex[i].umap[p];
    const x = c.d0, y = c.d1;
    buf[i * 2] = x;
    buf[i * 2 + 1] = y;
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
  }
  writeFileSync(join(DATA, `coords-${p}.bin`), Buffer.from(buf.buffer));
  extents[p] = { xmin, xmax, ymin, ymax };
}
console.log(`  coords-*.bin written for projections ${PROJECTIONS.join(", ")}`);

// Per-projection coordinate arrays for the label/contour passes below.
function projCoords(p) {
  const xs = new Float32Array(N);
  const ys = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const c = byIndex[i].umap[p];
    xs[i] = c.d0;
    ys[i] = c.d1;
  }
  return { xs, ys };
}

// ---------------------------------------------------------------------------
// Topic-region labels: k-means at several granularities, TF-IDF tag per cluster
// ---------------------------------------------------------------------------
function kmeans(xs, ys, k, iters = 25, seed = 1) {
  const n = xs.length;
  // k-means++ style seeding with a deterministic LCG
  let s = seed >>> 0;
  const rand = () => ((s = (1103515245 * s + 12345) >>> 0) / 4294967296);
  const cx = new Float64Array(k);
  const cy = new Float64Array(k);
  let first = (rand() * n) | 0;
  cx[0] = xs[first]; cy[0] = ys[first];
  const d2 = new Float64Array(n).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const ddx = xs[i] - cx[c - 1], ddy = ys[i] - cy[c - 1];
      const d = ddx * ddx + ddy * ddy;
      if (d < d2[i]) d2[i] = d;
      sum += d2[i];
    }
    let r = rand() * sum, pick = 0;
    for (let i = 0; i < n; i++) { r -= d2[i]; if (r <= 0) { pick = i; break; } }
    cx[c] = xs[pick]; cy[c] = ys[pick];
  }
  const assign = new Int32Array(n);
  for (let it = 0; it < iters; it++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const ddx = xs[i] - cx[c], ddy = ys[i] - cy[c];
        const d = ddx * ddx + ddy * ddy;
        if (d < bd) { bd = d; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; moved++; }
    }
    const sx = new Float64Array(k), sy = new Float64Array(k), cnt = new Int32Array(k);
    for (let i = 0; i < n; i++) { const c = assign[i]; sx[c] += xs[i]; sy[c] += ys[i]; cnt[c]++; }
    for (let c = 0; c < k; c++) if (cnt[c]) { cx[c] = sx[c] / cnt[c]; cy[c] = sy[c] / cnt[c]; }
    if (moved === 0 && it > 0) break;
  }
  return { assign, cx, cy };
}

// global tag document frequency for TF-IDF (idf)
const tagDocFreq = new Int32Array(tagDict.length);
for (let i = 0; i < N; i++) for (const t of tags[i]) tagDocFreq[t]++;

// Case-insensitive tag identity for labels: lowercase key, canonical display =
// most frequent original casing, and document frequency summed across variants.
const tagLcKey = tagDict.map((name) => name.toLowerCase());
const canonName = new Map(); // lc -> { name, freq }
const docFreqLc = new Map(); // lc -> summed doc frequency
for (let t = 0; t < tagDict.length; t++) {
  const lc = tagLcKey[t];
  const cur = canonName.get(lc);
  if (!cur || tagDocFreq[t] > cur.freq) canonName.set(lc, { name: tagDict[t], freq: tagDocFreq[t] });
  docFreqLc.set(lc, (docFreqLc.get(lc) || 0) + tagDocFreq[t]);
}

// Levels: coarse -> fine; each becomes visible past its zoom threshold.
const LEVELS = [
  { k: 7, zoom: 0.0 },
  { k: 18, zoom: 1.6 },
  { k: 45, zoom: 3.2 },
];

// Build the region labels for one projection's coordinates. `usedLabels` resets
// per call so each projection gets a self-consistent coarse->fine label set.
function buildLabels(xs, ys) {
  const usedLabels = new Set();
  const labels = [];
  for (let li = 0; li < LEVELS.length; li++) {
    const { k, zoom } = LEVELS[li];
    const { assign, cx, cy } = kmeans(xs, ys, k, 25, 12345 + li);
    // accumulate per-cluster tag term frequency
    const clusterTagTf = Array.from({ length: k }, () => new Map());
    const clusterSize = new Int32Array(k);
    for (let i = 0; i < N; i++) {
      const c = assign[i];
      clusterSize[c]++;
      // accumulate by case-insensitive tag key so variants merge
      for (const t of tags[i]) {
        const lc = tagLcKey[t];
        clusterTagTf[c].set(lc, (clusterTagTf[c].get(lc) || 0) + 1);
      }
    }
    for (let c = 0; c < k; c++) {
      if (clusterSize[c] < 25) continue;
      // rank this cluster's tags by TF-IDF distinctiveness (case-insensitive)
      const ranked = [];
      for (const [lc, tf] of clusterTagTf[c]) {
        const idf = Math.log(N / (1 + docFreqLc.get(lc)));
        ranked.push({ lc, score: (tf / clusterSize[c]) * idf });
      }
      ranked.sort((a, b) => b.score - a.score);
      // primary headline tag: best one not already used at a coarser level
      const primary = ranked.find((r) => !usedLabels.has(r.lc));
      if (!primary) continue;
      usedLabels.add(primary.lc);
      // secondary tag: next most distinctive in the cluster (label reads "X / Y")
      const secondary = ranked.find((r) => r.lc !== primary.lc);
      const text = secondary
        ? `${canonName.get(primary.lc).name} / ${canonName.get(secondary.lc).name}`
        : canonName.get(primary.lc).name;
      labels.push({
        x: +cx[c].toFixed(3),
        y: +cy[c].toFixed(3),
        text,
        level: li,
        size: clusterSize[c],
        zoom,
      });
    }
  }
  return labels;
}

// ---------------------------------------------------------------------------
// Density contours (marching squares) for the cartographic base layer
// ---------------------------------------------------------------------------
const GRID = 220; // columns; rows derived from aspect
const LEVEL_FRACTIONS = [0.06, 0.13, 0.24, 0.4, 0.62];

// separable box blur (repeat -> approximates gaussian) to smooth the field
function blur(src, w, h, r, passes) {
  let a = src;
  for (let p = 0; p < passes; p++) {
    const tmp = new Float64Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, c = 0;
      for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += a[y * w + xx]; c++; } }
      tmp[y * w + x] = s / c;
    }
    const out = new Float64Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, c = 0;
      for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; c++; } }
      out[y * w + x] = s / c;
    }
    a = out;
  }
  return a;
}

// Build the density contour lines for one projection. Returns the segments plus
// the padded grid box used (recorded per projection in the manifest).
function buildContours(xs, ys, ext) {
  const pad = 0.04;
  const x0 = ext.xmin - (ext.xmax - ext.xmin) * pad;
  const x1 = ext.xmax + (ext.xmax - ext.xmin) * pad;
  const y0 = ext.ymin - (ext.ymax - ext.ymin) * pad;
  const y1 = ext.ymax + (ext.ymax - ext.ymin) * pad;
  const cols = GRID;
  const rows = Math.max(2, Math.round((GRID * (y1 - y0)) / (x1 - x0)));
  const grid = new Float64Array(cols * rows);
  for (let i = 0; i < N; i++) {
    const gx = ((xs[i] - x0) / (x1 - x0)) * (cols - 1);
    const gy = ((ys[i] - y0) / (y1 - y0)) * (rows - 1);
    const cxi = Math.min(cols - 1, Math.max(0, Math.round(gx)));
    const cyi = Math.min(rows - 1, Math.max(0, Math.round(gy)));
    grid[cyi * cols + cxi] += 1;
  }
  const field = blur(grid, cols, rows, 2, 3);
  let fmax = 0;
  for (const v of field) if (v > fmax) fmax = v;

  // marching squares -> line segments at each threshold (data-space coords)
  const gxToData = (gx) => x0 + (gx / (cols - 1)) * (x1 - x0);
  const gyToData = (gy) => y0 + (gy / (rows - 1)) * (y1 - y0);
  function isoSegments(thr) {
    const segs = [];
    const lerp = (xa, ya, va, xb, yb, vb) => {
      const t = (thr - va) / (vb - va || 1e-9);
      return [xa + (xb - xa) * t, ya + (yb - ya) * t];
    };
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols - 1; x++) {
        const tl = field[y * cols + x];
        const tr = field[y * cols + x + 1];
        const br = field[(y + 1) * cols + x + 1];
        const bl = field[(y + 1) * cols + x];
        let code = 0;
        if (tl > thr) code |= 8;
        if (tr > thr) code |= 4;
        if (br > thr) code |= 2;
        if (bl > thr) code |= 1;
        if (code === 0 || code === 15) continue;
        const top = () => lerp(x, y, tl, x + 1, y, tr);
        const right = () => lerp(x + 1, y, tr, x + 1, y + 1, br);
        const bottom = () => lerp(x + 1, y + 1, br, x, y + 1, bl);
        const left = () => lerp(x, y + 1, bl, x, y, tl);
        const push = (a, b) => segs.push([
          +gxToData(a[0]).toFixed(3), +gyToData(a[1]).toFixed(3),
          +gxToData(b[0]).toFixed(3), +gyToData(b[1]).toFixed(3),
        ]);
        switch (code) {
          case 1: case 14: push(left(), bottom()); break;
          case 2: case 13: push(bottom(), right()); break;
          case 3: case 12: push(left(), right()); break;
          case 4: case 11: push(top(), right()); break;
          case 5: push(left(), top()); push(bottom(), right()); break;
          case 6: case 9: push(top(), bottom()); break;
          case 7: case 8: push(left(), top()); break;
          case 10: push(left(), bottom()); push(top(), right()); break;
        }
      }
    }
    return segs;
  }
  const contours = LEVEL_FRACTIONS.map((f, i) => ({
    level: i,
    threshold: +(f * fmax).toFixed(4),
    segments: isoSegments(f * fmax),
  }));
  return { contours, box: { x0, x1, y0, y1 } };
}

// ---------------------------------------------------------------------------
// Emit per-projection labels + contours
// ---------------------------------------------------------------------------
const contourGrids = {};
for (const p of PROJECTIONS) {
  const { xs, ys } = projCoords(p);
  const labels = buildLabels(xs, ys);
  writeFileSync(join(DATA, `labels-${p}.json`), JSON.stringify(labels));
  const { contours, box } = buildContours(xs, ys, extents[p]);
  writeFileSync(join(DATA, `contours-${p}.json`), JSON.stringify(contours));
  contourGrids[p] = box;
  console.log(
    `  proj ${p}: ${labels.length} labels, ` +
    `${contours.map((c) => c.segments.length).join("/")} contour segs`,
  );
}

// ---------------------------------------------------------------------------
// Manifest + .nojekyll
// ---------------------------------------------------------------------------
let dmin = Infinity, dmax = -Infinity;
for (let i = 0; i < N; i++) { if (date[i] < dmin) dmin = date[i]; if (date[i] > dmax) dmax = date[i]; }
writeFileSync(
  join(DATA, "manifest.json"),
  JSON.stringify({
    count: N,
    projections: PROJECTIONS,
    defaultProjection: DEFAULT_PROJECTION,
    extents,
    contourGrids,
    dateMinDay: dmin,
    dateMaxDay: dmax,
    sources: { 0: "ASPI", 1: "Lowy" },
  }),
);
writeFileSync(join(DATA, ".nojekyll"), "");
console.timeEnd("total");
console.log("Done -> data/");
