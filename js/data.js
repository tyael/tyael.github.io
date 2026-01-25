import { CONFIG } from './config.js';
import { appState, ELEMENTS } from './state.js';
import { getSourceFromUrl } from './utils.js';

// Determine the n_neighbors value to use from available options
export function determineNN(rawData, preferredNN) {
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

// Process raw data into application format
export function processData(rawData) {
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
      const source = getSourceFromUrl(d.url);
      return {
        id: String(d.post_id || d.external_id || i),
        title: d.title || "",
        url: d.url || "",
        source,
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

  // Build lookup map for internal links
  appState.articlesByExternalId.clear();
  appState.fullData.forEach((article) => {
    appState.articlesByExternalId.set(article.id, article);
  });

  // Build reverse lookup map (backlinks: who links TO this article)
  appState.backlinksMap.clear();
  appState.fullData.forEach((article) => {
    // For each article's outgoing links, add this article as a backlink
    article.internalLinks.forEach((targetId) => {
      const targetIdStr = String(targetId);
      if (!appState.backlinksMap.has(targetIdStr)) {
        appState.backlinksMap.set(targetIdStr, []);
      }
      appState.backlinksMap.get(targetIdStr).push(article.id);
    });
  });

  appState.uniqueTags = Array.from(tagsSet).sort((a, b) => a.localeCompare(b));
  appState.uniqueAuthors = Array.from(authorsSet).sort((a, b) =>
    a.localeCompare(b),
  );

  // Cache date extent for gradient calculations
  appState.dateExtent = d3.extent(appState.fullData, (d) => d.date);

  ELEMENTS.articleCount.text(`${appState.fullData.length} articles total`);
}
