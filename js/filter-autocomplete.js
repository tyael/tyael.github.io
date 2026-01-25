import { appState, ELEMENTS } from './state.js';
import { applyFilterRules, updateFilterCount } from './filter-logic.js';
import { drawTimeline } from './timeline.js';
import { drawScatterplot } from './drawing.js';

// --- Filter Autocomplete ---
export function getAutocompleteOptions(fieldId, query) {
  const queryLower = query.toLowerCase().trim();
  let options = [];

  if (fieldId === "author") {
    options = appState.uniqueAuthors;
  } else if (fieldId === "tag") {
    options = appState.uniqueTags;
  } else {
    return []; // No autocomplete for title
  }

  if (!queryLower) {
    return options.slice(0, 50); // Limit initial list
  }

  return options.filter((opt) => opt.toLowerCase().includes(queryLower));
}

export function showFilterAutocomplete(ruleId, query) {
  const rule = appState.filterRules.find((r) => r.id === ruleId);
  if (!rule) return;

  const options = getAutocompleteOptions(rule.field, query);
  const dropdown = d3.select(`#autocomplete-${ruleId}`);

  dropdown.selectAll("*").remove();

  if (options.length === 0) {
    if (rule.field !== "title" && query) {
      dropdown
        .append("div")
        .attr("class", "autocomplete-no-results")
        .text("No matches found");
    }
    dropdown.classed("visible", options.length > 0 || (rule.field !== "title" && query));
    appState.activeAutocomplete = null;
    return;
  }

  appState.activeAutocomplete = {
    ruleId,
    options,
    highlightedIndex: -1,
  };

  options.slice(0, 50).forEach((option, index) => {
    dropdown
      .append("div")
      .attr("class", "autocomplete-item")
      .attr("data-index", index)
      .text(option)
      .on("mousedown", (event) => {
        event.preventDefault();
        selectFilterAutocompleteOption(ruleId, option);
      })
      .on("mouseenter", () => {
        appState.activeAutocomplete.highlightedIndex = index;
        updateAutocompleteHighlight(ruleId);
      });
  });

  dropdown.classed("visible", true);
}

export function updateAutocompleteHighlight(ruleId) {
  const dropdown = d3.select(`#autocomplete-${ruleId}`);
  const { highlightedIndex } = appState.activeAutocomplete || {};

  dropdown.selectAll(".autocomplete-item").classed("highlighted", (d, i) => i === highlightedIndex);
}

export function handleFilterAutocompleteKeydown(event, ruleId) {
  if (!appState.activeAutocomplete || appState.activeAutocomplete.ruleId !== ruleId) {
    return;
  }

  const { options, highlightedIndex } = appState.activeAutocomplete;

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      if (options.length > 0) {
        appState.activeAutocomplete.highlightedIndex = Math.min(
          highlightedIndex + 1,
          Math.min(options.length, 50) - 1,
        );
        updateAutocompleteHighlight(ruleId);
        scrollToHighlightedItem(ruleId);
      }
      break;

    case "ArrowUp":
      event.preventDefault();
      if (options.length > 0) {
        appState.activeAutocomplete.highlightedIndex = Math.max(highlightedIndex - 1, 0);
        updateAutocompleteHighlight(ruleId);
        scrollToHighlightedItem(ruleId);
      }
      break;

    case "Enter":
      event.preventDefault();
      if (highlightedIndex >= 0 && options[highlightedIndex]) {
        selectFilterAutocompleteOption(ruleId, options[highlightedIndex]);
      }
      break;

    case "Escape":
      closeFilterAutocomplete();
      break;
  }
}

function scrollToHighlightedItem(ruleId) {
  const dropdown = d3.select(`#autocomplete-${ruleId}`);
  const highlighted = dropdown.select(".autocomplete-item.highlighted").node();
  if (highlighted) {
    highlighted.scrollIntoView({ block: "nearest" });
  }
}

export function selectFilterAutocompleteOption(ruleId, value) {
  const rule = appState.filterRules.find((r) => r.id === ruleId);
  if (rule) {
    rule.value = value;
    // Update input value
    d3.select(`.filter-rule[data-rule-id="${ruleId}"] input`).property("value", value);
    closeFilterAutocomplete();
    applyFilterRules();
    updateFilterCount();
    drawTimeline();
    drawScatterplot();
  }
}

export function closeFilterAutocomplete() {
  d3.selectAll(".autocomplete-dropdown").classed("visible", false);
  appState.activeAutocomplete = null;
}
