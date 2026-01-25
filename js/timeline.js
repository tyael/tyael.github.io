import { CONFIG } from './config.js';
import { appState, ELEMENTS } from './state.js';
import { getDateFilterRule } from './filter-builder.js';

// --- Timeline Setup (Vertical orientation: up = later, down = earlier) ---
// Butterfly histogram: total bars extend right, filtered bars extend left
export function setupTimeline() {
  const container = ELEMENTS.timelineContainer.node();
  const rect = container.getBoundingClientRect();
  const margin = CONFIG.timeline.margin;
  const width = rect.width - margin.left - margin.right;
  const height = rect.height - margin.top - margin.bottom;
  const centerX = width / 2;

  // Get date extent from data
  const dateExtent = d3.extent(appState.fullData, (d) => d.date);

  // Create time scale (vertical: earlier dates at bottom, later at top)
  appState.timeline.scale = d3
    .scaleTime()
    .domain(dateExtent)
    .range([height, 0]); // Inverted: 0 at top (later), height at bottom (earlier)

  // Set up SVG structure
  ELEMENTS.timelineSvg.selectAll("*").remove();

  const g = ELEMENTS.timelineSvg
    .append("g")
    .attr("class", "timeline-content")
    .attr("transform", `translate(${margin.left}, ${margin.top})`);

  // Add center line
  g.append("line")
    .attr("class", "timeline-center-line")
    .attr("x1", centerX)
    .attr("x2", centerX)
    .attr("y1", 0)
    .attr("y2", height);

  // Add bars group (total bars on right)
  g.append("g").attr("class", "timeline-bars");

  // Add filtered bars group (on left)
  g.append("g").attr("class", "timeline-bars-filtered");

  // Add date axis on the right side with year ticks
  g.append("g")
    .attr("class", "timeline-axis timeline-axis-date")
    .attr("transform", `translate(${width}, 0)`);

  // Add count axis for total (right side, at bottom)
  g.append("g")
    .attr("class", "timeline-axis timeline-axis-total")
    .attr("transform", `translate(0, ${height})`);

  // Add count axis for filtered (left side, at bottom)
  g.append("g")
    .attr("class", "timeline-axis timeline-axis-filtered")
    .attr("transform", `translate(0, ${height})`);

  // Add date range label at top
  g.append("text")
    .attr("class", "date-range-label")
    .attr("x", centerX)
    .attr("y", -8)
    .attr("text-anchor", "middle");

  appState.timeline.dimensions = { width, height, margin, centerX };
}

export function drawTimeline() {
  const { width, height, centerX } = appState.timeline.dimensions;
  const scale = appState.timeline.scale;

  // Bin data by month
  const monthInterval = d3.timeMonth.every(1);
  const thresholds = monthInterval.range(scale.domain()[0], scale.domain()[1]);

  // Bin all data for total histogram (right side)
  const totalBins = d3
    .bin()
    .value((d) => d.date)
    .domain(scale.domain())
    .thresholds(thresholds)(appState.fullData);

  const totalMax = d3.max(totalBins, (b) => b.length);

  // X scale for total bars (extends right from center)
  const xScaleTotal = d3
    .scaleLinear()
    .domain([0, totalMax])
    .range([centerX, width]);

  // Calculate bar height with 1px gap between bars
  const barGap = 1;
  const getBarHeight = (d) => Math.max(1, Math.abs(scale(d.x0) - scale(d.x1)) - barGap);
  const getBarY = (d) => Math.min(scale(d.x0), scale(d.x1));

  // Update total bars (right side) - start at center, extend right
  const barsGroup = ELEMENTS.timelineSvg.select(".timeline-bars");
  const bars = barsGroup.selectAll(".timeline-bar").data(totalBins);

  bars.join(
    (enter) =>
      enter
        .append("rect")
        .attr("class", "timeline-bar")
        .attr("x", centerX)
        .attr("y", getBarY)
        .attr("width", (d) => xScaleTotal(d.length) - centerX)
        .attr("height", getBarHeight),
    (update) =>
      update
        .attr("x", centerX)
        .attr("y", getBarY)
        .attr("width", (d) => xScaleTotal(d.length) - centerX)
        .attr("height", getBarHeight),
    (exit) => exit.remove(),
  );

  // Update bar colors based on selection
  updateTimelineBarColors();

  // Check if there's an active filter (filter rules with values)
  const hasActiveFilter = appState.matchedIds.size < appState.fullData.length;

  // Draw filtered bars (left side) if filter is active
  const filteredBarsGroup = ELEMENTS.timelineSvg.select(".timeline-bars-filtered");

  if (hasActiveFilter && appState.matchedIds.size > 0) {
    // Get articles matching the filter
    const matchedArticles = appState.fullData.filter((d) => appState.matchedIds.has(d.id));

    // Bin matched articles
    const filteredBins = d3
      .bin()
      .value((d) => d.date)
      .domain(scale.domain())
      .thresholds(thresholds)(matchedArticles);

    const filteredMax = d3.max(filteredBins, (b) => b.length) || 1;

    // X scale for filtered bars (extends left from center - independent scale)
    const xScaleFiltered = d3
      .scaleLinear()
      .domain([0, filteredMax])
      .range([centerX, 0]); // Reversed: 0 count at center, max at left edge

    // Draw filtered bars (left side) - start at center, extend left
    const filteredBars = filteredBarsGroup.selectAll(".timeline-bar-filtered").data(filteredBins);

    filteredBars.join(
      (enter) =>
        enter
          .append("rect")
          .attr("class", "timeline-bar-filtered")
          .attr("x", (d) => xScaleFiltered(d.length))
          .attr("y", getBarY)
          .attr("width", (d) => centerX - xScaleFiltered(d.length))
          .attr("height", getBarHeight),
      (update) =>
        update
          .attr("x", (d) => xScaleFiltered(d.length))
          .attr("y", getBarY)
          .attr("width", (d) => centerX - xScaleFiltered(d.length))
          .attr("height", getBarHeight),
      (exit) => exit.remove(),
    );

    // Update filtered count axis (left side)
    const xAxisFiltered = d3
      .axisBottom(xScaleFiltered)
      .ticks(3)
      .tickSize(3)
      .tickFormat(d3.format("d"));
    ELEMENTS.timelineSvg.select(".timeline-axis-filtered")
      .call(xAxisFiltered)
      .selectAll("text")
      .style("fill", "var(--color-filtered)");
  } else {
    // Remove filtered bars and axis if no active filter
    filteredBarsGroup.selectAll(".timeline-bar-filtered").remove();
    ELEMENTS.timelineSvg.select(".timeline-axis-filtered").selectAll("*").remove();
  }

  // Update date axis with year ticks
  const yAxis = d3
    .axisRight(scale)
    .ticks(d3.timeYear.every(1))
    .tickFormat(d3.timeFormat("%Y"))
    .tickSizeOuter(0);
  ELEMENTS.timelineSvg.select(".timeline-axis-date").call(yAxis);

  // Update total count axis (right side)
  const xAxisTotal = d3
    .axisBottom(xScaleTotal)
    .ticks(3)
    .tickSize(3)
    .tickFormat(d3.format("d"));
  ELEMENTS.timelineSvg.select(".timeline-axis-total").call(xAxisTotal);

  // Update date range label
  updateDateRangeLabel();
}

export function updateTimelineBarColors() {
  const dateRule = getDateFilterRule();

  ELEMENTS.timelineSvg.selectAll(".timeline-bar").classed("in-range", (d) => {
    if (!dateRule || !dateRule.startDate || !dateRule.endDate) return true;
    const barStart = d.x0;
    const barEnd = d.x1;
    return barStart >= dateRule.startDate && barEnd <= dateRule.endDate;
  });
}

export function updateDateRangeLabel() {
  const label = ELEMENTS.timelineSvg.select(".date-range-label");
  const dateRule = getDateFilterRule();

  if (dateRule && dateRule.startDate && dateRule.endDate) {
    const formatDate = d3.timeFormat("%b %Y");
    label.text(`${formatDate(dateRule.startDate)} – ${formatDate(dateRule.endDate)}`);
  } else {
    const dateExtent = d3.extent(appState.fullData, (d) => d.date);
    const formatDate = d3.timeFormat("%b %Y");
    label.text(`${formatDate(dateExtent[0])} – ${formatDate(dateExtent[1])}`);
  }
}

// Update timeline visuals when date filter changes (called from filter-builder)
export function syncTimelineBrush() {
  updateTimelineBarColors();
  updateDateRangeLabel();
}
