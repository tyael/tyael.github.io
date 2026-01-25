import { appState, ELEMENTS } from './state.js';
import { showLoading } from './utils.js';

// Compute hierarchical clusters and their labels
export function computeMapLabels() {
  console.time("computeMapLabels");

  const data = appState.fullData;
  const n = data.length;

  if (n === 0) {
    appState.mapLabels = [];
    appState.mapLabelsComputed = true;
    return;
  }

  // Determine number of levels and clusters per level based on dataset size
  // For ~12-13k points: 4 levels with increasing granularity
  const levels = calculateClusterLevels(n);
  console.log("Cluster levels:", levels);

  // Extract coordinates for clustering
  const points = data.map((d) => ({ x: d.x, y: d.y, tags: d.tags, id: d.id }));

  // Pre-compute global tag frequencies for TF-IDF
  const globalTagCounts = computeGlobalTagCounts(points);
  const totalDocs = points.length;

  // Compute clusters at each level, storing candidate tags (not final labels yet)
  const allClusters = [];

  for (let levelIdx = 0; levelIdx < levels.length; levelIdx++) {
    const k = levels[levelIdx].k;
    const zoomThreshold = levels[levelIdx].zoomThreshold;
    const fontSize = levels[levelIdx].fontSize;

    // Run k-means clustering
    const clusters = kMeansClustering(points, k, 20);

    // For each cluster, compute centroid and get ranked candidate tags
    clusters.forEach((cluster) => {
      if (cluster.points.length === 0) return;

      // Compute centroid
      const cx = cluster.points.reduce((sum, p) => sum + p.x, 0) / cluster.points.length;
      const cy = cluster.points.reduce((sum, p) => sum + p.y, 0) / cluster.points.length;

      // Get ranked candidate tags (top 6 for fallback options)
      const candidateTags = getDistinctiveTagsRanked(cluster.points, globalTagCounts, totalDocs, 6);

      if (candidateTags.length > 0) {
        allClusters.push({
          level: levelIdx,
          cx,
          cy,
          candidateTags,
          size: cluster.points.length,
          zoomThreshold,
          fontSize,
          priority: cluster.points.length * (levels.length - levelIdx),
        });
      }
    });
  }

  // Now assign labels with inheritance/deduplication
  const allLabels = assignLabelsWithInheritance(allClusters, levels.length);

  appState.mapLabels = allLabels;
  appState.mapLabelsComputed = true;

  console.timeEnd("computeMapLabels");
  console.log(`Computed ${allLabels.length} map labels`);
}

// Pre-compute global tag document frequencies
function computeGlobalTagCounts(points) {
  const globalTagCounts = new Map();
  for (const p of points) {
    const seenTags = new Set();
    for (const tag of p.tags) {
      if (!seenTags.has(tag)) {
        globalTagCounts.set(tag, (globalTagCounts.get(tag) || 0) + 1);
        seenTags.add(tag);
      }
    }
  }
  return globalTagCounts;
}

// Assign labels ensuring no duplicate tag combinations at the same level,
// with inheritance allowing a tag to pass to at most one child cluster
function assignLabelsWithInheritance(clusters, numLevels) {
  const labels = [];

  // Track which tag combinations are used at each level and their positions
  // Map: level -> Map: tagCombo -> { cx, cy }
  const usedAtLevel = new Map();
  for (let i = 0; i < numLevels; i++) {
    usedAtLevel.set(i, new Map());
  }

  // Track which tags have been "claimed" by higher-level clusters
  // Map: tag -> [{ level, cx, cy, claimedByChild: boolean }]
  const tagOwners = new Map();

  // Sort clusters by level (lowest/highest first) then by size (largest first)
  const sortedClusters = [...clusters].sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level; // Process higher levels first
    return b.size - a.size; // Larger clusters first within level
  });

  for (const cluster of sortedClusters) {
    const label = selectBestLabel(cluster, usedAtLevel, tagOwners);

    if (label) {
      labels.push({
        level: cluster.level,
        cx: cluster.cx,
        cy: cluster.cy,
        label,
        size: cluster.size,
        zoomThreshold: cluster.zoomThreshold,
        fontSize: cluster.fontSize,
        priority: cluster.priority,
      });

      // Mark this tag combination as used at this level
      usedAtLevel.get(cluster.level).set(label, { cx: cluster.cx, cy: cluster.cy });

      // Register individual tags as owned by this cluster
      const tags = label.split(" / ");
      for (const tag of tags) {
        if (!tagOwners.has(tag)) {
          tagOwners.set(tag, []);
        }
        tagOwners.get(tag).push({
          level: cluster.level,
          cx: cluster.cx,
          cy: cluster.cy,
          childClaimed: false,
        });
      }
    }
  }

  return labels;
}

// Select the best available label for a cluster, respecting inheritance rules
function selectBestLabel(cluster, usedAtLevel, tagOwners) {
  const candidateTags = cluster.candidateTags;

  // Try combinations of top tags
  for (let numTags = Math.min(2, candidateTags.length); numTags >= 1; numTags--) {
    // Try each starting position
    for (let startIdx = 0; startIdx <= candidateTags.length - numTags; startIdx++) {
      const selectedTags = candidateTags.slice(startIdx, startIdx + numTags);
      const label = selectedTags.join(" / ");

      // Check if this exact combination is already used at this level
      const levelUsed = usedAtLevel.get(cluster.level);
      if (levelUsed.has(label)) {
        continue; // Skip, already used at this level
      }

      // Check inheritance rules for each tag
      let canUse = true;
      for (const tag of selectedTags) {
        const owners = tagOwners.get(tag) || [];

        // Find if any higher-level cluster owns this tag
        const higherOwners = owners.filter(o => o.level < cluster.level);

        if (higherOwners.length > 0) {
          // This tag is owned by higher-level cluster(s)
          // We can only inherit if we're the closest unclaimed child
          const closestOwner = findClosestOwner(higherOwners, cluster.cx, cluster.cy);

          if (closestOwner.childClaimed) {
            // Another cluster already inherited this tag from this owner
            canUse = false;
            break;
          }

          // Check if we're actually close to the owner (within reasonable distance)
          const dist = Math.sqrt(
            Math.pow(cluster.cx - closestOwner.cx, 2) +
            Math.pow(cluster.cy - closestOwner.cy, 2)
          );

          // Get typical cluster spread for this level to determine "close enough"
          // Use a heuristic based on the data range
          const dataRange = Math.max(
            d3.max(appState.fullData, d => d.x) - d3.min(appState.fullData, d => d.x),
            d3.max(appState.fullData, d => d.y) - d3.min(appState.fullData, d => d.y)
          );
          const inheritanceRadius = dataRange / (3 * (cluster.level + 1));

          if (dist > inheritanceRadius) {
            // Too far from owner to inherit
            canUse = false;
            break;
          }
        }

        // Check if same-level clusters already use this tag nearby
        const sameLevelOwners = owners.filter(o => o.level === cluster.level);
        if (sameLevelOwners.length > 0) {
          // Tag already used at this level - skip unless we're far away
          const closestSameLevel = findClosestOwner(sameLevelOwners, cluster.cx, cluster.cy);
          const dist = Math.sqrt(
            Math.pow(cluster.cx - closestSameLevel.cx, 2) +
            Math.pow(cluster.cy - closestSameLevel.cy, 2)
          );

          const dataRange = Math.max(
            d3.max(appState.fullData, d => d.x) - d3.min(appState.fullData, d => d.x),
            d3.max(appState.fullData, d => d.y) - d3.min(appState.fullData, d => d.y)
          );
          const minSeparation = dataRange / (5 * (cluster.level + 1));

          if (dist < minSeparation) {
            canUse = false;
            break;
          }
        }
      }

      if (canUse) {
        // Mark inheritance if applicable
        for (const tag of selectedTags) {
          const owners = tagOwners.get(tag) || [];
          const higherOwners = owners.filter(o => o.level < cluster.level);
          if (higherOwners.length > 0) {
            const closestOwner = findClosestOwner(higherOwners, cluster.cx, cluster.cy);
            closestOwner.childClaimed = true;
          }
        }
        return label;
      }
    }
  }

  // If we couldn't find any valid combination, return null
  return null;
}

// Find the closest owner to a given position
function findClosestOwner(owners, cx, cy) {
  let closest = owners[0];
  let minDist = Infinity;

  for (const owner of owners) {
    const dist = Math.pow(cx - owner.cx, 2) + Math.pow(cy - owner.cy, 2);
    if (dist < minDist) {
      minDist = dist;
      closest = owner;
    }
  }

  return closest;
}

// Calculate cluster levels based on dataset size
function calculateClusterLevels(n) {
  // Dynamic level calculation based on dataset size
  // More points = more levels and more clusters per level

  if (n < 500) {
    return [
      { k: 3, zoomThreshold: 0.5, fontSize: 16 },
      { k: 8, zoomThreshold: 1.5, fontSize: 12 },
    ];
  } else if (n < 2000) {
    return [
      { k: 5, zoomThreshold: 0.5, fontSize: 18 },
      { k: 15, zoomThreshold: 1.2, fontSize: 13 },
      { k: 40, zoomThreshold: 2.5, fontSize: 10 },
    ];
  } else if (n < 8000) {
    return [
      { k: 6, zoomThreshold: 0.5, fontSize: 18 },
      { k: 20, zoomThreshold: 1.0, fontSize: 14 },
      { k: 60, zoomThreshold: 2.0, fontSize: 11 },
      { k: 150, zoomThreshold: 4.0, fontSize: 9 },
    ];
  } else {
    // 8000+ points (like 12-13k)
    return [
      { k: 8, zoomThreshold: 0.5, fontSize: 18 },
      { k: 25, zoomThreshold: 0.9, fontSize: 14 },
      { k: 80, zoomThreshold: 1.8, fontSize: 11 },
      { k: 200, zoomThreshold: 3.5, fontSize: 9 },
    ];
  }
}

// K-means clustering implementation
function kMeansClustering(points, k, maxIterations = 20) {
  const n = points.length;
  if (n === 0 || k <= 0) return [];

  // Initialize centroids using k-means++ for better initial placement
  const centroids = initializeCentroidsKMeansPlusPlus(points, k);

  // Track which cluster each point belongs to
  const assignments = new Array(n).fill(-1);

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    // Assign each point to nearest centroid
    for (let i = 0; i < n; i++) {
      const p = points[i];
      let minDist = Infinity;
      let minCluster = 0;

      for (let c = 0; c < k; c++) {
        const dx = p.x - centroids[c].x;
        const dy = p.y - centroids[c].y;
        const dist = dx * dx + dy * dy;
        if (dist < minDist) {
          minDist = dist;
          minCluster = c;
        }
      }

      if (assignments[i] !== minCluster) {
        assignments[i] = minCluster;
        changed = true;
      }
    }

    if (!changed) break;

    // Update centroids
    const sums = centroids.map(() => ({ x: 0, y: 0, count: 0 }));
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      sums[c].x += points[i].x;
      sums[c].y += points[i].y;
      sums[c].count++;
    }

    for (let c = 0; c < k; c++) {
      if (sums[c].count > 0) {
        centroids[c].x = sums[c].x / sums[c].count;
        centroids[c].y = sums[c].y / sums[c].count;
      }
    }
  }

  // Build cluster objects with their points
  const clusters = centroids.map(() => ({ points: [] }));
  for (let i = 0; i < n; i++) {
    clusters[assignments[i]].points.push(points[i]);
  }

  return clusters;
}

// K-means++ initialization for better centroid placement
function initializeCentroidsKMeansPlusPlus(points, k) {
  const n = points.length;
  const centroids = [];

  // Pick first centroid randomly
  const firstIdx = Math.floor(Math.random() * n);
  centroids.push({ x: points[firstIdx].x, y: points[firstIdx].y });

  // Pick remaining centroids with probability proportional to squared distance
  for (let c = 1; c < k; c++) {
    const distances = points.map((p) => {
      let minDist = Infinity;
      for (const centroid of centroids) {
        const dx = p.x - centroid.x;
        const dy = p.y - centroid.y;
        minDist = Math.min(minDist, dx * dx + dy * dy);
      }
      return minDist;
    });

    const totalDist = distances.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalDist;
    let selectedIdx = 0;

    for (let i = 0; i < n; i++) {
      r -= distances[i];
      if (r <= 0) {
        selectedIdx = i;
        break;
      }
    }

    centroids.push({ x: points[selectedIdx].x, y: points[selectedIdx].y });
  }

  return centroids;
}

// Get distinctive tags for a cluster using TF-IDF-like scoring
// Returns an array of tags ranked by distinctiveness
function getDistinctiveTagsRanked(clusterPoints, globalTagCounts, totalDocs, maxTags = 6) {
  if (clusterPoints.length === 0) return [];

  // Count tag frequency in cluster
  const clusterTagCounts = new Map();
  let clusterTotalTags = 0;

  for (const p of clusterPoints) {
    for (const tag of p.tags) {
      clusterTagCounts.set(tag, (clusterTagCounts.get(tag) || 0) + 1);
      clusterTotalTags++;
    }
  }

  if (clusterTotalTags === 0) return [];

  // Calculate TF-IDF scores
  const scores = [];
  for (const [tag, count] of clusterTagCounts) {
    const tf = count / clusterTotalTags;
    const docFreq = globalTagCounts.get(tag) || 1;
    const idf = Math.log(totalDocs / docFreq);

    // Also consider how much of the tag's total usage is in this cluster
    const clusterConcentration = count / docFreq;

    // Combined score: TF-IDF * concentration
    const score = tf * idf * (1 + clusterConcentration);

    scores.push({ tag, score, count, docFreq });
  }

  // Sort by score
  scores.sort((a, b) => b.score - a.score);

  // Filter out very generic tags (appearing in >50% of points)
  const filtered = scores.filter((s) => s.docFreq / totalDocs < 0.5);

  const topTags = (filtered.length > 0 ? filtered : scores)
    .slice(0, maxTags)
    .map((s) => s.tag);

  return topTags;
}

// Update map labels visibility and positions
export function updateMapLabels() {
  const labelsGroup = ELEMENTS.mapLabelsGroup;

  if (!appState.mapLabelsEnabled) {
    labelsGroup.selectAll("text").remove();
    return;
  }

  const transform = appState.currentTransform;
  const zoomLevel = transform.k;

  // Filter labels visible at current zoom level
  let visibleLabels = appState.mapLabels.filter(
    (label) => zoomLevel >= label.zoomThreshold
  );

  // Calculate screen positions
  visibleLabels = visibleLabels.map((label) => ({
    ...label,
    screenX: transform.applyX(appState.scales.x(label.cx)),
    screenY: transform.applyY(appState.scales.y(label.cy)),
  }));

  // Calculate opacity based on zoom level (fade in effect)
  visibleLabels.forEach((label) => {
    const fadeRange = 0.3; // Fade in over 30% of threshold
    const fadeStart = label.zoomThreshold;
    const fadeEnd = fadeStart * (1 + fadeRange);

    if (zoomLevel >= fadeEnd) {
      label.opacity = 1;
    } else {
      label.opacity = (zoomLevel - fadeStart) / (fadeEnd - fadeStart);
    }
  });

  // Handle collision detection - hide lower priority overlapping labels
  visibleLabels = resolveCollisions(visibleLabels);

  // Update DOM
  const labels = labelsGroup.selectAll("text").data(visibleLabels, (d) => `${d.level}-${d.label}-${d.cx.toFixed(2)}`);

  labels.join(
    (enter) =>
      enter
        .append("text")
        .attr("class", (d) => `level-${d.level}`)
        .attr("x", (d) => d.screenX)
        .attr("y", (d) => d.screenY)
        .style("font-size", (d) => `${d.fontSize}px`)
        .style("opacity", (d) => d.opacity)
        .text((d) => d.label),
    (update) =>
      update
        .attr("class", (d) => `level-${d.level}`)
        .attr("x", (d) => d.screenX)
        .attr("y", (d) => d.screenY)
        .style("font-size", (d) => `${d.fontSize}px`)
        .style("opacity", (d) => d.opacity)
        .text((d) => d.label),
    (exit) => exit.remove()
  );
}

// Resolve label collisions by hiding lower priority overlapping labels
function resolveCollisions(labels) {
  if (labels.length === 0) return labels;

  // Sort by priority (higher first)
  const sorted = [...labels].sort((a, b) => b.priority - a.priority);

  const visible = [];
  const placedBoxes = [];

  for (const label of sorted) {
    // Estimate bounding box (rough approximation)
    const charWidth = label.fontSize * 0.6;
    const boxWidth = label.label.length * charWidth + 10;
    const boxHeight = label.fontSize + 6;

    const box = {
      left: label.screenX - boxWidth / 2,
      right: label.screenX + boxWidth / 2,
      top: label.screenY - boxHeight / 2,
      bottom: label.screenY + boxHeight / 2,
    };

    // Check for collisions with already placed labels
    let hasCollision = false;
    for (const placed of placedBoxes) {
      if (
        box.left < placed.right &&
        box.right > placed.left &&
        box.top < placed.bottom &&
        box.bottom > placed.top
      ) {
        hasCollision = true;
        break;
      }
    }

    if (!hasCollision) {
      visible.push(label);
      placedBoxes.push(box);
    }
  }

  return visible;
}

// Recompute labels (called on n_neighbors change)
export function recomputeMapLabels() {
  appState.mapLabelsComputed = false;
  if (appState.mapLabelsEnabled) {
    showLoading("Recomputing map labels...");
    setTimeout(() => {
      computeMapLabels();
      updateMapLabels();
      showLoading(false);
    }, 50);
  }
}
