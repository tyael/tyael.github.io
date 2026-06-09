import { appState, ELEMENTS } from "./state.js";
import { applyFilter } from "./filter.js";

// Apply a leaderboard row as a text filter facet, syncing the matching input.
function setFacet(key, value) {
  appState.filter[key] = value;
  const input = key === "tag" ? ELEMENTS.tagInput : ELEMENTS.authorInput;
  if (input) {
    input.property("value", value);
    const wrap = input.node().closest(".field-input");
    if (wrap) wrap.classList.add("has-value");
  }
  applyFilter();
}

// How many rows fit in a board's rendered height. Measures an existing row when
// possible (falls back to an estimate before the first render).
function rowCapacity(node) {
  const avail = node.clientHeight;
  let rh = 21; // ~10.5px * 1.5 line + 4px padding + 1px gap
  const sample = node.querySelector(".board-row");
  if (sample) rh = sample.getBoundingClientRect().height + 1;
  return Math.max(3, Math.floor(avail / rh));
}

// Read-only leaderboards over the current match set: top tags (case-insensitively
// merged) and top authors. The list lengths scale to the available rail height.
// The ASPI/Lowy split is shown textually in the top bar.
export function renderLeaderboards() {
  const { count, matched, matchedCount, meta, tagLcOf, tagCanon } = appState;
  const filtering = matchedCount < count;
  const inSet = (i) => !filtering || matched[i];

  // --- tags (merge case variants by lowercased name) ---
  const tagFreq = new Map();
  for (let i = 0; i < count; i++) {
    if (!inSet(i)) continue;
    for (const t of meta.tags[i]) {
      const lc = tagLcOf[t];
      tagFreq.set(lc, (tagFreq.get(lc) || 0) + 1);
    }
  }
  const tagRows = [...tagFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, rowCapacity(ELEMENTS.tagList.node()))
    .map(([lc, n]) => ({ key: lc, label: tagCanon.get(lc).name, n }));
  drawBoard(ELEMENTS.tagList, tagRows, (d) => setFacet("tag", d.label));

  // --- authors ---
  const authFreq = new Map();
  for (let i = 0; i < count; i++) {
    if (!inSet(i)) continue;
    for (const a of meta.authors[i]) authFreq.set(a, (authFreq.get(a) || 0) + 1);
  }
  const authRows = [...authFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, rowCapacity(ELEMENTS.authorList.node()))
    .map(([a, n]) => ({ key: a, label: meta.authorDict[a], n }));
  drawBoard(ELEMENTS.authorList, authRows, (d) => setFacet("author", d.label));

  // --- source split -> top bar ---
  let aspi = 0, lowy = 0;
  for (let i = 0; i < count; i++) {
    if (!inSet(i)) continue;
    appState.source[i] === 0 ? aspi++ : lowy++;
  }
  if (ELEMENTS.brandSub) {
    ELEMENTS.brandSub.html(
      `<span class="src-stat aspi">ASPI ${aspi.toLocaleString()}</span> · ` +
      `<span class="src-stat lowy">Lowy ${lowy.toLocaleString()}</span> in embedding space`,
    );
  }
}

// Generic ranked bar list. `rows`: [{ key, label, n, color? }] sorted desc.
// `onClick(d)` (optional) makes rows clickable as a filter facet.
function drawBoard(container, rows, onClick) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  const sel = container.selectAll("div.board-row").data(rows, (d) => d.key);
  sel.exit().remove();
  const enter = sel.enter().append("div").attr("class", "board-row");
  enter.append("span").attr("class", "board-bar");
  enter.append("span").attr("class", "board-name");
  enter.append("span").attr("class", "board-count");

  const merged = enter.merge(sel);
  if (onClick) {
    merged.classed("clickable", true).attr("title", (d) => d.label).on("click", (e, d) => onClick(d));
  }
  merged.select(".board-bar")
    .style("width", (d) => `${(d.n / max) * 100}%`)
    .style("background", (d) => d.color || null);
  merged.select(".board-name").text((d) => d.label);
  merged.select(".board-count").text((d) => d.n.toLocaleString());
  // keep DOM order matching the sorted data
  merged.order();
}
