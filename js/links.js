import { CONFIG } from "./config.js";
import { appState, ELEMENTS } from "./state.js";
import { sx, sy } from "./map.js";

// Draw citation edges from the selected article: teal to articles it links to,
// amber from articles that link to it. Re-runs on every map render so edges
// track pan/zoom.
export function renderLinks() {
  const group = ELEMENTS.linksGroup;
  const sel = appState.selectedId;
  const t = appState.transform;
  if (sel == null || !t) {
    group.selectAll("*").remove();
    return;
  }

  const sxScreen = (i) => t.applyX(sx(appState.x[i]));
  const syScreen = (i) => t.applyY(sy(appState.y[i]));
  const x0 = sxScreen(sel);
  const y0 = syScreen(sel);

  const out = appState.meta.links[sel].map((j) => ({ j, dir: "out" }));
  const inc = appState.backlinks[sel].map((j) => ({ j, dir: "in" }));
  const edges = out.concat(inc);

  const lines = group.selectAll("line.cite-edge").data(edges, (d) => d.dir + d.j);
  lines.exit().remove();
  lines
    .enter()
    .append("line")
    .attr("class", (d) => `cite-edge ${d.dir}`)
    .merge(lines)
    .attr("x1", x0)
    .attr("y1", y0)
    .attr("x2", (d) => sxScreen(d.j))
    .attr("y2", (d) => syScreen(d.j))
    .attr("stroke", (d) => (d.dir === "out" ? CONFIG.colors.linkOut : CONFIG.colors.linkIn));

  const rings = group.selectAll("circle.cite-target").data(edges, (d) => d.dir + d.j);
  rings.exit().remove();
  rings
    .enter()
    .append("circle")
    .attr("class", (d) => `cite-target ${d.dir}`)
    .attr("r", 5)
    .merge(rings)
    .attr("cx", (d) => sxScreen(d.j))
    .attr("cy", (d) => syScreen(d.j))
    .attr("stroke", (d) => (d.dir === "out" ? CONFIG.colors.linkOut : CONFIG.colors.linkIn));
}
