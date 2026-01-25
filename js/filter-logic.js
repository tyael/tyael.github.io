import { CONFIG } from './config.js';
import { appState, ELEMENTS } from './state.js';
import { escapeRegex } from './utils.js';

// Check if a rule has a valid value (handles both regular rules and date range rules)
export function ruleHasValue(rule) {
  const fieldConfig = CONFIG.filterFields.find((f) => f.id === rule.field);
  if (fieldConfig?.type === "daterange") {
    return rule.startDate && rule.endDate;
  }
  return rule.value && rule.value.trim();
}

// Build a sift.js query from filter rules
export function buildSiftQuery() {
  const rules = appState.filterRules.filter(ruleHasValue);

  if (rules.length === 0) {
    return null; // No filter = match all
  }

  // Group rules by their logic connectors
  // First, split into OR groups (OR has lower precedence)
  const orGroups = [];
  let currentAndGroup = [];

  rules.forEach((rule, index) => {
    if (index === 0 || rule.logic === "AND") {
      currentAndGroup.push(rule);
    } else if (rule.logic === "OR") {
      if (currentAndGroup.length > 0) {
        orGroups.push(currentAndGroup);
      }
      currentAndGroup = [rule];
    }
  });

  if (currentAndGroup.length > 0) {
    orGroups.push(currentAndGroup);
  }

  // Convert each group to sift conditions
  const orConditions = orGroups.map((andGroup) => {
    if (andGroup.length === 1) {
      return buildRuleCondition(andGroup[0], andGroup[0].negate);
    }
    return { $and: andGroup.map((r) => buildRuleCondition(r, r.negate)) };
  });

  if (orConditions.length === 1) {
    return orConditions[0];
  }

  return { $or: orConditions };
}

export function buildRuleCondition(rule, negate = false) {
  const fieldConfig = CONFIG.filterFields.find((f) => f.id === rule.field);
  if (!fieldConfig) return {};

  const field = fieldConfig.field;

  let condition = {};

  // Build the condition based on operator and field type
  if (fieldConfig.type === "daterange") {
    // Date range filter - uses startDate and endDate instead of value
    if (!rule.startDate || !rule.endDate) return {};

    condition = {
      $and: [
        { [field]: { $gte: rule.startDate } },
        { [field]: { $lte: rule.endDate } },
      ],
    };
  } else if (fieldConfig.type === "select") {
    const value = rule.value.trim();
    if (!value) return {};
    // For select fields (source), do exact equality match
    condition = { [field]: { $eq: value } };
  } else if (fieldConfig.type === "array") {
    const value = rule.value.trim();
    if (!value) return {};
    // For arrays (tags, authors)
    switch (rule.operator) {
      case "contains":
        // Match if any item in the array contains the value (case-insensitive)
        condition = {
          [field]: {
            $elemMatch: { $regex: new RegExp(escapeRegex(value), "i") },
          },
        };
        break;
      case "equals":
        // Match if any item in the array exactly equals the value (case-insensitive)
        condition = {
          [field]: {
            $elemMatch: { $regex: new RegExp(`^${escapeRegex(value)}$`, "i") },
          },
        };
        break;
      default:
        return {};
    }
  } else {
    const value = rule.value.trim();
    if (!value) return {};
    // For strings (title)
    switch (rule.operator) {
      case "contains":
        condition = { [field]: { $regex: new RegExp(escapeRegex(value), "i") } };
        break;
      case "startsWith":
        condition = { [field]: { $regex: new RegExp(`^${escapeRegex(value)}`, "i") } };
        break;
      case "equals":
        condition = { [field]: { $regex: new RegExp(`^${escapeRegex(value)}$`, "i") } };
        break;
      default:
        return {};
    }
  }

  // Wrap in $not if negated
  if (negate) {
    return { $not: condition };
  }

  return condition;
}

// Apply filter rules using sift.js
export function applyFilterRules() {
  appState.matchedIds.clear();

  const query = buildSiftQuery();

  if (!query) {
    // No filter = all articles match
    appState.fullData.forEach((d) => appState.matchedIds.add(d.id));
    return;
  }

  try {
    // sift.default() returns a filter function (UMD export)
    const siftFn = typeof sift === "function" ? sift : sift.default;
    const siftFilter = siftFn(query);

    appState.fullData.forEach((d) => {
      if (siftFilter(d)) {
        appState.matchedIds.add(d.id);
      }
    });
  } catch (error) {
    console.error("Filter error:", error);
    // On error, match nothing
  }
}

export function updateFilterCount() {
  const matchCount = appState.matchedIds.size;
  const hasActiveFilter = appState.filterRules.some(ruleHasValue);

  if (hasActiveFilter) {
    ELEMENTS.filterMatchCount.text(
      `${matchCount} article${matchCount !== 1 ? "s" : ""} match`,
    );
  } else {
    ELEMENTS.filterMatchCount.text("No filter active");
  }

  // Update article count
  const total = appState.fullData.length;
  ELEMENTS.articleCount.text(`${total} articles total`);
}
