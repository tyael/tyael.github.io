import { CONFIG } from './config.js';
import { appState, ELEMENTS } from './state.js';
import { applyFilterRules, updateFilterCount, ruleHasValue } from './filter-logic.js';
import { drawTimeline, syncTimelineBrush } from './timeline.js';
import { drawScatterplot } from './drawing.js';
import { showFilterAutocomplete, handleFilterAutocompleteKeydown } from './filter-autocomplete.js';

// --- Filter Builder Setup ---
export function setupFilterBuilder() {
  ELEMENTS.addFilterBtn.on("click", () => addFilterRule());
}

export function addFilterRule(logic = "AND", fieldId = null) {
  const ruleId = appState.filterRuleIdCounter++;
  const fieldConfig = fieldId
    ? CONFIG.filterFields.find((f) => f.id === fieldId)
    : CONFIG.filterFields[0];

  const rule = {
    id: ruleId,
    field: fieldConfig.id,
    operator: CONFIG.filterOperators[fieldConfig.type][0].id,
    value: "",
    logic: appState.filterRules.length > 0 ? logic : null,
    negate: false, // NOT toggle
    editing: true, // Start in editing mode
  };

  // For date range fields, use startDate/endDate instead of value
  if (fieldConfig.type === "daterange") {
    rule.startDate = null;
    rule.endDate = null;
  }

  appState.filterRules.push(rule);
  renderFilterRules();
  return rule;
}

export function removeFilterRule(ruleId) {
  const index = appState.filterRules.findIndex((r) => r.id === ruleId);
  if (index !== -1) {
    const removedRule = appState.filterRules[index];
    appState.filterRules.splice(index, 1);
    // If removed first rule, clear logic from new first rule
    if (index === 0 && appState.filterRules.length > 0) {
      appState.filterRules[0].logic = null;
    }
    renderFilterRules();
    applyFilterRules();
    updateFilterCount();
    // If we removed a date filter, update the timeline display
    if (removedRule.field === "date") {
      syncTimelineBrush();
    }
    drawTimeline();
    drawScatterplot();
  }
}

// Get the current date filter rule (if any)
export function getDateFilterRule() {
  return appState.filterRules.find((r) => r.field === "date");
}

// Update or create a date filter rule
export function setDateFilter(startDate, endDate) {
  let dateRule = getDateFilterRule();

  if (!startDate || !endDate) {
    // Remove date filter if no selection
    if (dateRule) {
      removeFilterRule(dateRule.id);
    }
    return;
  }

  if (!dateRule) {
    // Create new date filter rule
    dateRule = addFilterRule("AND", "date");
    dateRule.editing = false; // Don't start in editing mode
  }

  dateRule.startDate = startDate;
  dateRule.endDate = endDate;

  renderFilterRules();
  applyFilterRules();
  updateFilterCount();
  drawTimeline();
  drawScatterplot();
}

export function updateFilterRule(ruleId, field, value) {
  const rule = appState.filterRules.find((r) => r.id === ruleId);
  if (rule) {
    const oldField = rule.field;
    rule[field] = value;

    // If field changed, reset operator to first valid one
    if (field === "field") {
      const oldFieldConfig = CONFIG.filterFields.find((f) => f.id === oldField);
      const newFieldConfig = CONFIG.filterFields.find((f) => f.id === value);

      if (newFieldConfig) {
        rule.operator = CONFIG.filterOperators[newFieldConfig.type][0].id;
      }

      // Handle switching between date and non-date field types
      if (oldFieldConfig?.type === "daterange" && newFieldConfig?.type !== "daterange") {
        // Switching away from date - clear date values and sync timeline
        delete rule.startDate;
        delete rule.endDate;
        syncTimelineBrush();
      } else if (oldFieldConfig?.type !== "daterange" && newFieldConfig?.type === "daterange") {
        // Switching to date - clear regular value and initialize date values
        rule.value = "";
        rule.startDate = null;
        rule.endDate = null;
      }
    }

    if (field !== "value") {
      renderFilterRules();
    }
    applyFilterRules();
    updateFilterCount();
    drawTimeline();
    drawScatterplot();
  }
}

export function toggleFilterLogic(ruleId) {
  const rule = appState.filterRules.find((r) => r.id === ruleId);
  if (rule && rule.logic) {
    rule.logic = rule.logic === "AND" ? "OR" : "AND";
    renderFilterRules();
    applyFilterRules();
    updateFilterCount();
    drawTimeline();
    drawScatterplot();
  }
}

export function renderFilterRules() {
  ELEMENTS.filterRulesContainer.selectAll("*").remove();

  appState.filterRules.forEach((rule, index) => {
    const fieldConfig = CONFIG.filterFields.find((f) => f.id === rule.field);
    const operators = CONFIG.filterOperators[fieldConfig?.type || "string"];
    const operatorConfig = operators.find((op) => op.id === rule.operator);

    // Logic connector (before rule, except first)
    if (rule.logic) {
      const connector = ELEMENTS.filterRulesContainer
        .append("div")
        .attr("class", "filter-logic-connector");

      connector
        .append("button")
        .attr("class", `logic-btn ${rule.logic === "AND" ? "active" : ""}`)
        .text("AND")
        .on("click", () => {
          if (rule.logic !== "AND") toggleFilterLogic(rule.id);
        });

      connector
        .append("button")
        .attr("class", `logic-btn ${rule.logic === "OR" ? "active" : ""}`)
        .text("OR")
        .on("click", () => {
          if (rule.logic !== "OR") toggleFilterLogic(rule.id);
        });
    }

    // Rule container
    const ruleDiv = ELEMENTS.filterRulesContainer
      .append("div")
      .attr("class", `filter-rule ${rule.editing ? "editing" : "condensed"}`)
      .attr("data-rule-id", rule.id);

    if (rule.editing) {
      // === EDITING VIEW (stacked) ===

      // NOT toggle row
      const notRow = ruleDiv.append("div").attr("class", "filter-rule-row not-row");
      const notLabel = notRow.append("label").attr("class", "not-toggle");
      notLabel
        .append("input")
        .attr("type", "checkbox")
        .property("checked", rule.negate)
        .on("change", function () {
          rule.negate = this.checked;
          applyFilterRules();
          updateFilterCount();
          drawTimeline();
          drawScatterplot();
        });
      notLabel.append("span").text("NOT (exclude matches)");

      // Field row
      const fieldRow = ruleDiv.append("div").attr("class", "filter-rule-row");
      fieldRow.append("label").attr("class", "rule-label").text("Field");
      const fieldSelect = fieldRow
        .append("select")
        .attr("class", "filter-field-select")
        .on("change", function () {
          updateFilterRule(rule.id, "field", this.value);
        });

      CONFIG.filterFields.forEach((f) => {
        fieldSelect
          .append("option")
          .attr("value", f.id)
          .property("selected", f.id === rule.field)
          .text(f.label);
      });

      // Operator row (hidden for daterange since it only has one operator)
      if (fieldConfig?.type !== "daterange") {
        const opRow = ruleDiv.append("div").attr("class", "filter-rule-row");
        opRow.append("label").attr("class", "rule-label").text("Operator");
        const opSelect = opRow
          .append("select")
          .attr("class", "filter-op-select")
          .on("change", function () {
            updateFilterRule(rule.id, "operator", this.value);
          });

        operators.forEach((op) => {
          opSelect
            .append("option")
            .attr("value", op.id)
            .property("selected", op.id === rule.operator)
            .text(op.label);
        });
      }

      // Value row
      const valueRow = ruleDiv.append("div").attr("class", "filter-rule-row");
      valueRow.append("label").attr("class", "rule-label").text("Value");
      const valueContainer = valueRow
        .append("div")
        .attr("class", "filter-rule-value-container");

      // Check field type and render appropriate input
      if (fieldConfig?.type === "daterange") {
        // Render date range inputs
        const formatDateForInput = (date) => {
          if (!date) return "";
          const d = new Date(date);
          return d.toISOString().split("T")[0];
        };

        const dateContainer = valueContainer.attr("class", "filter-rule-value-container date-range-container");

        dateContainer.append("label").attr("class", "date-label").text("From:");
        dateContainer
          .append("input")
          .attr("type", "date")
          .attr("class", "date-input")
          .property("value", formatDateForInput(rule.startDate))
          .on("change", function () {
            rule.startDate = this.value ? new Date(this.value) : null;
            applyFilterRules();
            updateFilterCount();
            syncTimelineBrush();
            drawTimeline();
            drawScatterplot();
          });

        dateContainer.append("label").attr("class", "date-label").text("To:");
        dateContainer
          .append("input")
          .attr("type", "date")
          .attr("class", "date-input")
          .property("value", formatDateForInput(rule.endDate))
          .on("change", function () {
            rule.endDate = this.value ? new Date(this.value + "T23:59:59") : null;
            applyFilterRules();
            updateFilterCount();
            syncTimelineBrush();
            drawTimeline();
            drawScatterplot();
          });
      } else if (fieldConfig?.type === "select" && fieldConfig.options) {
        // Render a dropdown for select fields
        const valueSelect = valueContainer
          .append("select")
          .attr("class", "filter-value-select")
          .on("change", function () {
            rule.value = this.value;
            applyFilterRules();
            updateFilterCount();
            drawTimeline();
            drawScatterplot();
          });

        // Add empty option
        valueSelect
          .append("option")
          .attr("value", "")
          .text(`Select ${fieldConfig.label}...`);

        // Add field options
        fieldConfig.options.forEach((opt) => {
          valueSelect
            .append("option")
            .attr("value", opt)
            .property("selected", opt === rule.value)
            .text(opt);
        });
      } else {
        // Regular text input with autocomplete
        valueContainer
          .append("input")
          .attr("type", "text")
          .attr("placeholder", `Enter ${fieldConfig?.label || "value"}...`)
          .property("value", rule.value)
          .on("input", function () {
            rule.value = this.value;
            showFilterAutocomplete(rule.id, this.value);
            applyFilterRules();
            updateFilterCount();
            drawTimeline();
            drawScatterplot();
          })
          .on("focus", function () {
            showFilterAutocomplete(rule.id, this.value);
          })
          .on("keydown", function (event) {
            handleFilterAutocompleteKeydown(event, rule.id);
          });

        valueContainer
          .append("div")
          .attr("class", "autocomplete-dropdown")
          .attr("id", `autocomplete-${rule.id}`);
      }

      // Action buttons row
      const actionsRow = ruleDiv.append("div").attr("class", "filter-rule-actions");

      actionsRow
        .append("button")
        .attr("class", "rule-done-btn")
        .text("Done")
        .on("click", () => {
          rule.editing = false;
          renderFilterRules();
        });

      actionsRow
        .append("button")
        .attr("class", "rule-remove-btn")
        .text("Remove")
        .on("click", () => removeFilterRule(rule.id));

    } else {
      // === CONDENSED VIEW ===
      const summaryDiv = ruleDiv.append("div").attr("class", "filter-rule-summary");

      // Build summary text
      const negateText = rule.negate ? "NOT " : "";
      const fieldLabel = fieldConfig?.label || rule.field;
      const opLabel = operatorConfig?.label || rule.operator;

      let valueText;
      if (fieldConfig?.type === "daterange") {
        const formatDate = d3.timeFormat("%b %Y");
        const startText = rule.startDate ? formatDate(rule.startDate) : "?";
        const endText = rule.endDate ? formatDate(rule.endDate) : "?";
        valueText = `${startText} – ${endText}`;
      } else {
        valueText = rule.value || "(empty)";
      }

      summaryDiv
        .append("span")
        .attr("class", "rule-summary-text")
        .html(`${negateText}<strong>${fieldLabel}</strong> ${opLabel} "<em>${valueText}</em>"`);

      // Edit button
      summaryDiv
        .append("button")
        .attr("class", "rule-edit-btn")
        .text("Edit")
        .on("click", () => {
          rule.editing = true;
          renderFilterRules();
        });

      // Remove button
      summaryDiv
        .append("button")
        .attr("class", "remove-rule-btn")
        .html("&times;")
        .on("click", () => removeFilterRule(rule.id));
    }
  });
}
