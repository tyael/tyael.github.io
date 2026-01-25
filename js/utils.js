import { appState, ELEMENTS } from './state.js';

// Extract source from URL (ASPI or Lowy)
export function getSourceFromUrl(url) {
  if (!url) return "Unknown";
  if (url.includes("aspistrategist.org.au")) return "ASPI";
  if (url.includes("lowyinstitute.org")) return "Lowy";
  return "Unknown";
}

// Show/hide loading indicator
export function showLoading(message) {
  if (message) {
    ELEMENTS.loadingIndicator.text(message).style("display", "block");
  } else {
    ELEMENTS.loadingIndicator.style("display", "none");
  }
}

// Debounce utility
export function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Escape special regex characters
export function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Convert hex color to rgba string with given opacity
export function hexToRgba(hex, opacity) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// Calculate opacity for a point based on its date (0.15 to 1.0)
export function getDateBasedOpacity(date) {
  if (!appState.dateExtent || !appState.dateExtent[0] || !appState.dateExtent[1]) {
    return 1.0;
  }

  const [minDate, maxDate] = appState.dateExtent;
  const minTime = minDate.getTime();
  const maxTime = maxDate.getTime();
  const dateTime = date.getTime();

  // Normalize to 0-1 range (0 = oldest, 1 = newest)
  const normalized = (dateTime - minTime) / (maxTime - minTime);

  // Map to opacity range: 0.15 (oldest) to 1.0 (newest)
  return 0.15 + normalized * 0.85;
}
