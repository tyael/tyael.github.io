import { dayToDate, dateToDay } from "./config.js";
import { appState, ELEMENTS } from "./state.js";

// Monthly stacked bar chart, oriented vertically: time runs up the page (oldest
// at the bottom), post count runs across (left -> right). Each month's bar is
// stacked ASPI then Lowy and shows only the current filtered set. The value
// (count) axis rescales dynamically to the largest monthly bar in that set.
// A vertical brush sets the date-range facet.
// top margin holds the (always-visible) count axis; the chart can fill/overflow
// the rail vertically, so a bottom axis would scroll out of view.
const M = { top: 22, right: 10, bottom: 10, left: 34 };
const MIN_HEIGHT = 158; // floor when the rail is very short

let dims = null; // { w, h }
let svgHeight = MIN_HEIGHT;
let tScale = null; // time -> y (up)
let xScale = null; // count -> x (across)
let bins = null; // [{ date, next, y, h }] per month, precomputed geometry
let binOf = null; // point index -> bin index
let totA = null; // per-bin ASPI totals
let totL = null; // per-bin Lowy totals
let brush = null;

function monthIndex(d, sy, sm) {
  return (d.getFullYear() - sy) * 12 + (d.getMonth() - sm);
}

// epoch-day <-> <input type="date"> "YYYY-MM-DD" (UTC, matches dayToDate)
const dayToInput = (day) => dayToDate(day).toISOString().slice(0, 10);
const inputToDay = (str) => dateToDay(new Date(str));

export function setupTimeline() {
  const node = ELEMENTS.timeline.node();
  const w = node.clientWidth - M.left - M.right;
  svgHeight = Math.max(MIN_HEIGHT, node.clientHeight);
  const h = svgHeight - M.top - M.bottom;
  dims = { w, h };

  const start = dayToDate(appState.manifest.dateMinDay);
  const end = dayToDate(appState.manifest.dateMaxDay);
  const sy = start.getFullYear();
  const sm = start.getMonth();
  const nBins = monthIndex(end, sy, sm) + 1;

  const binStart = d3.range(nBins).map((i) => new Date(sy, sm + i, 1));
  const domainEnd = new Date(sy, sm + nBins, 1);

  binOf = new Int32Array(appState.count);
  totA = new Int32Array(nBins);
  totL = new Int32Array(nBins);
  for (let i = 0; i < appState.count; i++) {
    const b = monthIndex(dayToDate(appState.date[i]), sy, sm);
    binOf[i] = b;
    appState.source[i] === 0 ? totA[b]++ : totL[b]++;
  }

  // time up: earliest at the bottom (y=h), latest at the top (y=0)
  tScale = d3.scaleTime().domain([binStart[0], domainEnd]).range([h, 0]);
  // count axis: domain is set per-render to fit the current filtered max
  xScale = d3.scaleLinear().domain([0, 1]).range([0, w]);

  // Precompute each month's vertical slot. A 1px gap when rows are tall enough.
  bins = binStart.map((date, i) => {
    const next = i + 1 < nBins ? binStart[i + 1] : domainEnd;
    const yTop = tScale(next);
    const yBot = tScale(date);
    const rowH = yBot - yTop;
    const gap = rowH > 3 ? 1 : 0;
    return { date, next, y: yTop, h: Math.max(0.5, rowH - gap) };
  });

  ELEMENTS.timelineSvg.selectAll("*").remove();
  const g = ELEMENTS.timelineSvg
    .attr("width", w + M.left + M.right)
    .attr("height", svgHeight)
    .append("g")
    .attr("class", "timeline-g")
    .attr("transform", `translate(${M.left},${M.top})`);

  // filtered bars, stacked ASPI then Lowy (updated in drawTimeline)
  g.append("g").attr("class", "tl-fore aspi");
  g.append("g").attr("class", "tl-fore lowy");

  // value axis (across, top — always in view) — domain/ticks refreshed in
  // drawTimeline — and the time axis (up, left)
  g.append("g")
    .attr("class", "stream-axis x-axis");
  g.append("g")
    .attr("class", "stream-axis y-axis")
    .call(d3.axisLeft(tScale).ticks(d3.timeYear.every(2)).tickFormat(d3.timeFormat("%Y")));

  brush = d3.brushY().extent([[0, 0], [w, h]]).on("end", brushed);
  g.append("g").attr("class", "tl-brush").call(brush);

  drawTimeline();
  setBrushRange(); // restore any active range after a rebuild/resize
}

function brushed(event) {
  if (!event.sourceEvent) return; // ignore programmatic moves
  const sel = event.selection;
  if (!sel) {
    appState.filter.dateRange = null;
  } else {
    // sel[0] is higher on screen (later time), sel[1] lower (earlier time)
    const later = dateToDay(tScale.invert(sel[0]));
    const earlier = dateToDay(tScale.invert(sel[1]));
    appState.filter.dateRange = [earlier, later];
  }
  syncDateInputs(); // reflect the drag in the top-bar inputs
  import("./filter.js").then((m) => m.applyFilter());
}

// --- date inputs (top bar) <-> brush, sharing appState.filter.dateRange ------

// Move the brush to match the current date-range facet (programmatic, so it does
// not re-fire `brushed`). Null range clears the brush.
function setBrushRange() {
  if (!brush || !tScale) return;
  const g = ELEMENTS.timelineSvg.select(".tl-brush");
  const r = appState.filter.dateRange;
  if (!r) {
    g.call(brush.move, null);
    return;
  }
  // r = [earlierDay, laterDay]; later sits higher (smaller y) on the up axis
  g.call(brush.move, [tScale(dayToDate(r[1])), tScale(dayToDate(r[0]))]);
}

// Write the current range into the two date inputs (empty when no range).
export function syncDateInputs() {
  if (!ELEMENTS.dateFrom) return;
  const r = appState.filter.dateRange;
  ELEMENTS.dateFrom.property("value", r ? dayToInput(r[0]) : "");
  ELEMENTS.dateTo.property("value", r ? dayToInput(r[1]) : "");
}

function onDateInput() {
  const fv = ELEMENTS.dateFrom.property("value");
  const tv = ELEMENTS.dateTo.property("value");
  let range = null;
  if (fv || tv) {
    const lo = fv ? inputToDay(fv) : appState.manifest.dateMinDay;
    const hi = tv ? inputToDay(tv) : appState.manifest.dateMaxDay;
    range = lo <= hi ? [lo, hi] : [hi, lo];
  }
  appState.filter.dateRange = range;
  setBrushRange();
  import("./filter.js").then((m) => m.applyFilter());
}

export function setupDateInputs() {
  if (!ELEMENTS.dateFrom) return;
  const lo = dayToInput(appState.manifest.dateMinDay);
  const hi = dayToInput(appState.manifest.dateMaxDay);
  ELEMENTS.dateFrom.attr("min", lo).attr("max", hi);
  ELEMENTS.dateTo.attr("min", lo).attr("max", hi);
  ELEMENTS.dateFrom.on("change", onDateInput);
  ELEMENTS.dateTo.on("change", onDateInput);
  syncDateInputs();
}

export function drawTimeline() {
  if (!dims) return;
  const g = ELEMENTS.timelineSvg.select(".timeline-g");

  const { matched, count, matchedCount } = appState;
  const n = bins.length;
  const filtA = new Int32Array(n);
  const filtL = new Int32Array(n);
  if (matchedCount < count) {
    for (let i = 0; i < count; i++) {
      if (!matched[i]) continue;
      appState.source[i] === 0 ? filtA[binOf[i]]++ : filtL[binOf[i]]++;
    }
  } else {
    filtA.set(totA);
    filtL.set(totL);
  }

  // rescale the count axis to the largest monthly bar in the filtered set
  let maxBar = 0;
  for (let i = 0; i < n; i++) maxBar = Math.max(maxBar, filtA[i] + filtL[i]);
  xScale.domain([0, Math.max(1, maxBar)]).nice();
  g.select(".x-axis").call(
    d3.axisTop(xScale)
      .ticks(Math.min(4, xScale.domain()[1]))
      .tickFormat(d3.format("d")),
  );

  g.select(".tl-fore.aspi").selectAll("rect")
    .data(bins).join("rect")
    .attr("class", "stream filtered aspi")
    .attr("x", 0).attr("y", (d) => d.y).attr("height", (d) => d.h)
    .attr("width", (d, i) => xScale(filtA[i]));

  g.select(".tl-fore.lowy").selectAll("rect")
    .data(bins).join("rect")
    .attr("class", "stream filtered lowy")
    .attr("x", (d, i) => xScale(filtA[i])).attr("y", (d) => d.y).attr("height", (d) => d.h)
    .attr("width", (d, i) => xScale(filtA[i] + filtL[i]) - xScale(filtA[i]));
}

export function clearTimelineBrush() {
  if (!brush) return;
  ELEMENTS.timelineSvg.select(".tl-brush").call(brush.move, null);
}

export function resizeTimeline() {
  if (appState.manifest) setupTimeline();
}
