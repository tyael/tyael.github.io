import { CONFIG } from './config.js';
import { appState, ELEMENTS } from './state.js';

// Get the appropriate color for internal link lines
// Outgoing links always use forwardLink color (cyan)
// Incoming links always use backlink color (amber)
export function getInternalLinkColor(direction) {
  return direction === 'incoming' ? CONFIG.colors.backlink : CONFIG.colors.forwardLink;
}

// Resolve internal link IDs to article objects recursively
// Returns an array of { article, level, sourceId, direction } objects
// direction: 'outgoing' (this article links to target) or 'incoming' (target links to this article)
export function resolveLinkedArticles(sourcePoint, maxDepth = 1) {
  const result = [];
  const visitedOutgoing = new Set([sourcePoint.id]); // Track visited for outgoing links
  const visitedIncoming = new Set([sourcePoint.id]); // Track visited for incoming links

  // Resolve outgoing links (articles this point links TO)
  function resolveOutgoingAtDepth(currentPoint, currentDepth) {
    if (currentDepth > maxDepth) return;
    if (!currentPoint.internalLinks || currentPoint.internalLinks.length === 0) return;

    for (const linkedId of currentPoint.internalLinks) {
      const linkedIdStr = String(linkedId);
      if (visitedOutgoing.has(linkedIdStr)) continue;

      const linkedArticle = appState.articlesByExternalId.get(linkedIdStr);
      if (linkedArticle) {
        visitedOutgoing.add(linkedIdStr);
        result.push({
          article: linkedArticle,
          level: currentDepth,
          sourceId: currentPoint.id,
          direction: 'outgoing',
        });

        // Recurse to next level
        if (currentDepth < maxDepth) {
          resolveOutgoingAtDepth(linkedArticle, currentDepth + 1);
        }
      }
    }
  }

  // Resolve incoming links (articles that link TO this point - backlinks)
  function resolveIncomingAtDepth(currentPoint, currentDepth) {
    if (currentDepth > maxDepth) return;

    const backlinks = appState.backlinksMap.get(currentPoint.id) || [];
    if (backlinks.length === 0) return;

    for (const linkingId of backlinks) {
      const linkingIdStr = String(linkingId);
      if (visitedIncoming.has(linkingIdStr)) continue;

      const linkingArticle = appState.articlesByExternalId.get(linkingIdStr);
      if (linkingArticle) {
        visitedIncoming.add(linkingIdStr);
        result.push({
          article: linkingArticle,
          level: currentDepth,
          sourceId: currentPoint.id,
          direction: 'incoming',
        });

        // Recurse to next level (find articles that link to the linking article)
        if (currentDepth < maxDepth) {
          resolveIncomingAtDepth(linkingArticle, currentDepth + 1);
        }
      }
    }
  }

  resolveOutgoingAtDepth(sourcePoint, 1);
  resolveIncomingAtDepth(sourcePoint, 1);

  return result;
}

// Get just the direct linked articles (for tooltip display) - outgoing links
export function getDirectLinkedArticles(sourcePoint) {
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

// Get articles that link TO this article (backlinks, for tooltip display)
export function getDirectBacklinks(sourcePoint) {
  const backlinks = appState.backlinksMap.get(sourcePoint.id) || [];
  const backlinkArticles = [];

  for (const linkingId of backlinks) {
    const linkingArticle = appState.articlesByExternalId.get(String(linkingId));
    if (linkingArticle) {
      backlinkArticles.push(linkingArticle);
    }
  }

  return backlinkArticles;
}

// Draw internal link lines and target circles from source point to linked articles
export function drawInternalLinks(sourcePoint) {
  clearInternalLinks();

  if (!sourcePoint) return;

  const linkedArticles = resolveLinkedArticles(sourcePoint, appState.linkDepth);
  if (linkedArticles.length === 0) return;

  const transform = appState.currentTransform;

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

  // Get position of the main source point (the hovered/clicked point)
  const mainSourcePos = positionMap.get(sourcePoint.id);

  // Draw lines with arrows to each linked article
  linkedArticles.forEach(({ article: target, level, sourceId, direction }) => {
    const sourcePos = positionMap.get(sourceId);
    const targetPos = positionMap.get(target.id);

    if (!sourcePos || !targetPos) return;

    // For outgoing links: arrow from sourceId to target
    // For incoming links: arrow from target TO sourceId (backlink)
    let lineCx1, lineCy1, lineCx2, lineCy2, circleTargetCx, circleTargetCy;

    if (direction === 'outgoing') {
      // Arrow goes from source to target
      lineCx1 = sourcePos.cx;
      lineCy1 = sourcePos.cy;
      lineCx2 = targetPos.cx;
      lineCy2 = targetPos.cy;
      circleTargetCx = targetPos.cx;
      circleTargetCy = targetPos.cy;
    } else {
      // Incoming (backlink): arrow goes from target (the linking article) to source
      lineCx1 = targetPos.cx;
      lineCy1 = targetPos.cy;
      lineCx2 = sourcePos.cx;
      lineCy2 = sourcePos.cy;
      circleTargetCx = targetPos.cx;
      circleTargetCy = targetPos.cy;
    }

    // Calculate offset to stop line at edge of target circle
    const dx = lineCx2 - lineCx1;
    const dy = lineCy2 - lineCy1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const targetRadius = 6; // Radius of target circle
    const arrowOffset = targetRadius + 3; // Small gap for arrow

    // Adjusted end point (stop before the arrow destination)
    let endX = lineCx2;
    let endY = lineCy2;
    if (dist > arrowOffset) {
      endX = lineCx2 - (dx / dist) * arrowOffset;
      endY = lineCy2 - (dy / dist) * arrowOffset;
    }

    // Get stroke width based on level
    const strokeWidth = level === 1 ? 2.5 : level === 2 ? 2 : 1.5;

    // Use different color and marker for incoming vs outgoing links
    const linkColor = getInternalLinkColor(direction);
    const markerUrl = direction === 'incoming' ? "url(#link-arrow-backlink)" : "url(#link-arrow-outgoing)";

    // Draw dashed line with arrow
    ELEMENTS.internalLinksGroup
      .append("line")
      .attr("class", `internal-link-line level-${level} ${direction}`)
      .attr("x1", lineCx1)
      .attr("y1", lineCy1)
      .attr("x2", endX)
      .attr("y2", endY)
      .attr("stroke", linkColor)
      .attr("stroke-width", strokeWidth)
      .attr("stroke-dasharray", level === 1 ? "4,3" : level === 2 ? "3,4" : "2,4")
      .attr("marker-end", markerUrl);

    // Draw dashed circle around the linked article (not the source)
    ELEMENTS.internalLinksGroup
      .append("circle")
      .attr("class", `internal-link-target level-${level} ${direction}`)
      .attr("cx", circleTargetCx)
      .attr("cy", circleTargetCy)
      .attr("r", targetRadius)
      .attr("fill", "none")
      .attr("stroke", linkColor)
      .attr("stroke-width", strokeWidth)
      .attr("stroke-dasharray", level === 1 ? "3,2" : level === 2 ? "2,3" : "2,4");
  });
}

// Clear all internal link visualizations
export function clearInternalLinks() {
  ELEMENTS.internalLinksGroup.selectAll("*").remove();
}

export function updateHoverHighlight() {
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
