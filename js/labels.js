import { appState, ELEMENTS } from "./state.js";
import { sx, sy } from "./map.js";

// Approx average character width for a quick collision box (proportional sans).
const CHAR_W = 6.4;
const LINE_H = 15;

// Render region labels as SVG text, positioned by the live zoom transform.
// A label appears once zoom passes its level threshold, fades in over a short
// range, and yields to higher-priority (bigger) labels when boxes overlap.
export function renderLabels() {
  const t = appState.transform;
  const group = ELEMENTS.labelsGroup;
  if (!t) return;

  // candidates visible at this zoom, projected to screen space
  const candidates = [];
  for (const l of appState.labels) {
    if (t.k < l.zoom) continue;
    const screenX = t.applyX(sx(l.x));
    const screenY = t.applyY(sy(l.y));
    // fade in over the first 35% above the threshold
    const fadeEnd = (l.zoom || 0.001) * 1.35;
    const opacity = l.zoom === 0 ? 1 : Math.min(1, Math.max(0, (t.k - l.zoom) / (fadeEnd - l.zoom)));
    const w = l.text.length * CHAR_W;
    candidates.push({ ...l, screenX, screenY, opacity, w });
  }

  // greedy collision resolution, biggest clusters win
  candidates.sort((a, b) => b.size - a.size);
  const placed = [];
  const shown = [];
  for (const c of candidates) {
    const box = {
      x0: c.screenX - c.w / 2,
      x1: c.screenX + c.w / 2,
      y0: c.screenY - LINE_H / 2,
      y1: c.screenY + LINE_H / 2,
    };
    const clash = placed.some(
      (p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0,
    );
    if (clash) continue;
    placed.push(box);
    shown.push(c);
  }

  const sel = group
    .selectAll("text.region-label")
    .data(shown, (d) => `${d.level}:${d.text}`);
  sel.exit().remove();
  sel
    .enter()
    .append("text")
    .attr("class", (d) => `region-label level-${d.level}`)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .merge(sel)
    .attr("x", (d) => d.screenX)
    .attr("y", (d) => d.screenY)
    .style("opacity", (d) => d.opacity)
    .text((d) => d.text);
}
