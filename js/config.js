// --- Configuration ---
export const CONFIG = {
  dataUrl: "articles.json",
  margin: { top: 30, right: 30, bottom: 40, left: 50 },
  timeline: {
    width: 280,
    margin: { top: 30, right: 50, bottom: 40, left: 20 },
  },
  pointRadius: 3,
  highlightRadius: 5,
  zoomMin: 0.5,
  zoomMax: 50,
  defaultNN: 15,
  gridSpacing: 50,
  nnTransitionDuration: 750,

  // --- Colors ---
  colors: {
    // Point colors
    filtered: "#b10836", //
    unfiltered: "#030303", // Points not matching filter

    // Internal link arrow colors
    forwardLink: "#06b6d4", // Cyan - outgoing links (this article links to)
    backlink: "#f59e0b", // Amber - incoming links (articles linking to this)

    // Source badge colors (ASPI and Lowy labels)
    sourceAspi: "#b10836", // ASPI Royal Red
    sourceLowy: "#002b45", // Lowy blue.
  },

  // Filter field definitions
  filterFields: [
    { id: "author", label: "Author", type: "array", field: "authors" },
    { id: "tag", label: "Tag", type: "array", field: "tags" },
    { id: "title", label: "Title", type: "string", field: "title" },
    {
      id: "source",
      label: "Source",
      type: "select",
      field: "source",
      options: ["ASPI", "Lowy"],
    },
    { id: "date", label: "Date", type: "daterange", field: "date" },
  ],
  // Filter operators by type
  filterOperators: {
    array: [
      { id: "contains", label: "contains" },
      { id: "equals", label: "equals" },
    ],
    string: [
      { id: "contains", label: "contains" },
      { id: "startsWith", label: "starts with" },
      { id: "equals", label: "equals" },
    ],
    select: [{ id: "equals", label: "is" }],
    daterange: [{ id: "between", label: "between" }],
  },
};
