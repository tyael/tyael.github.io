import { CONFIG } from "./config.js";
import { appState } from "./state.js";

// Fetch a projection's assets (coords + labels + contours) without touching
// appState — so the network can run during a fade-out before the swap.
export async function fetchProjectionAssets(proj) {
  const base = CONFIG.dataDir;
  const [coordsBuf, labels, contours] = await Promise.all([
    fetch(`${base}/coords-${proj}.bin`).then((r) => r.arrayBuffer()),
    fetch(`${base}/labels-${proj}.json`).then((r) => r.json()),
    fetch(`${base}/contours-${proj}.json`).then((r) => r.json()),
  ]);
  return { proj, coordsBuf, labels, contours };
}

// Apply fetched assets: rebuild the coordinate columns and swap labels/contours.
export function applyProjectionAssets({ proj, coordsBuf, labels, contours }) {
  const N = appState.count;
  // Split interleaved [x,y,...] float buffer into separate columns.
  const coords = new Float32Array(coordsBuf);
  const x = new Float32Array(N);
  const y = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    x[i] = coords[i * 2];
    y[i] = coords[i * 2 + 1];
  }
  appState.projection = proj;
  appState.x = x;
  appState.y = y;
  appState.labels = labels;
  appState.contours = contours;
}

// Convenience: fetch + apply in one step (used on first load).
export async function loadProjectionAssets(proj) {
  applyProjectionAssets(await fetchProjectionAssets(proj));
}

// Fetch the projection-independent assets, build the in-memory typed columns and
// reverse citation index, then load the default projection's coordinates.
export async function loadData() {
  const base = CONFIG.dataDir;

  const [manifest, meta] = await Promise.all([
    fetch(`${base}/manifest.json`).then((r) => r.json()),
    fetch(`${base}/meta.json`).then((r) => r.json()),
  ]);

  const N = manifest.count;
  appState.count = N;
  appState.manifest = manifest;
  appState.meta = meta;

  appState.source = Uint8Array.from(meta.source);
  appState.date = Int32Array.from(meta.date);

  // Reverse citation index: for each point, who links *to* it.
  const backlinks = Array.from({ length: N }, () => []);
  for (let i = 0; i < N; i++) {
    for (const j of meta.links[i]) backlinks[j].push(i);
  }
  appState.backlinks = backlinks;

  // Lowercased per-point columns for case-insensitive "contains" filtering.
  // A separator between names stops a query matching across two of them.
  const SEP = "  ";
  const titleLC = new Array(N);
  const authorLC = new Array(N);
  const tagLC = new Array(N);
  for (let i = 0; i < N; i++) {
    titleLC[i] = meta.title[i].toLowerCase();
    authorLC[i] = meta.authors[i].map((a) => meta.authorDict[a]).join(SEP).toLowerCase();
    tagLC[i] = meta.tags[i].map((t) => meta.tagDict[t]).join(SEP).toLowerCase();
  }
  appState.titleLC = titleLC;
  appState.authorLC = authorLC;
  appState.tagLC = tagLC;

  // Case-insensitive tag display: pick the most frequent original casing as the
  // canonical label for each lowercased tag (e.g. "Coronavirus" over "coronavirus").
  const tagFreq = new Int32Array(meta.tagDict.length);
  for (let i = 0; i < N; i++) for (const t of meta.tags[i]) tagFreq[t]++;
  const tagLcOf = new Array(meta.tagDict.length);
  const tagCanon = new Map();
  for (let t = 0; t < meta.tagDict.length; t++) {
    const name = meta.tagDict[t];
    const lc = name.toLowerCase();
    tagLcOf[t] = lc;
    const cur = tagCanon.get(lc);
    if (!cur || tagFreq[t] > cur.f) tagCanon.set(lc, { name, f: tagFreq[t] });
  }
  appState.tagLcOf = tagLcOf;
  appState.tagCanon = tagCanon;

  appState.matched = new Uint8Array(N).fill(1);
  appState.matchedCount = N;

  // load the starting projection's coordinates, labels and contours
  await loadProjectionAssets(manifest.defaultProjection || CONFIG.defaultProjection);
  return appState;
}
