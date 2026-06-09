'use strict';
/* core.js — shared state, globals, and small cross-cutting helpers.
   Loaded first; every other script reads the globals declared here. The scripts
   are plain (non-module) and share one global scope, so load order (see
   index.html) matters only for these top-level declarations — all function calls
   happen at runtime, after boot. */

/* ── State ──────────────────────────────────────────────────────────────── */
const state = {
  selectedReports: new Set(),  // report ids (timeline click) → trajectories
  selectedClusters: new Set(), // cluster ids (legend click) → spotlight, multi-select
  hoveredCluster:  null,       // legend hover → spotlight on map
  colorMode:       'topic',    // 'topic' | 'time'
  showTrajectories: true,
  showDrift:       false,
  fadeConfidence:  false,      // fade points by soft-membership confidence (3.2)
  query:           '',         // lowercased search string
  hoveredPoint:    null,
  pinnedPoint:     null,
};

let DATA, ORDER, YEARS;
let byReport = {}, byCluster = {}, byYear = {};
let reportIndex = {}, reportCentroids = {}, repById = {};
let currentK = 1;                                  // live zoom scale (semantic zoom)

let quadtree = null;
let tScale = null, zoomBehavior = null;
let xOrig, yOrig, xSc, ySc;                        // D3 scales (data → CSS px), updated by zoom
const margin = { top: 26, right: 28, bottom: 26, left: 28 };

/* ── Report identity ────────────────────────────────────────────────────── */
/* The split-year releases need human names rather than COD20_1 / COD22_2 etc. */
const SPLIT_LABELS = {
  'COD20_1': { full: '2020 DSU',     tag: '20·DSU' },
  'COD20_2': { full: '2020 Budget',  tag: '20·Bud' },
  'COD22_1': { full: '2022 March',   tag: '22·Mar' },
  'COD22_2': { full: '2022 October', tag: '22·Oct' },
};
function reportFull(rid){ const s=SPLIT_LABELS[rid]; if(s) return s.full; const r=repById[rid]; return r?String(r.year):rid; }
function reportShort(rid){ const s=SPLIT_LABELS[rid]; return s?s.tag:rid.replace('COD',''); }
/* Canonical report identity, used everywhere (tooltips + panels): "COD20_1 · 2020 DSU". */
function reportTitle(rid){ return `${rid} · ${reportFull(rid)}`; }
function reportTitleHTML(rid){ return `${rid} <span class="tt-sub">· ${reportFull(rid)}</span>`; }

/* Report trajectory colours (stable hash) */
const TRAJ_PALETTE = ['#ffffff','#ffd166','#06d6a0','#ff70a6','#c0fdff',
                      '#f8961e','#b8f2e6','#ff6b6b','#9bf6ff','#e0aaff'];
function trajColor(rid){ let h=5381; for(let i=0;i<rid.length;i++) h=(h*33 ^ rid.charCodeAt(i))>>>0; return TRAJ_PALETTE[h % TRAJ_PALETTE.length]; }

/* ── Category labels ──────────────────────────────────────────────────────
   Prefer the LLM-generated name/description, fall back to keywords. */
function clusterName(c){ return c.name || (c.keywords ? c.keywords.slice(0,3).join(' · ') : 'Topic '+c.id); }
function clusterDesc(c){ return c.description || (c.keywords ? c.keywords.slice(0,6).join(', ') : ''); }
function clusterKw(c){ return (c.keywords||[]).join(', '); }

/* Soft topic membership per chunk: p.mix is a ranked list of [topicId, weight]
   pairs (primary first). primaryWeight is the top weight, used for confidence fade. */
function primaryWeight(p){ const f = p.mix && p.mix[0]; return Array.isArray(f) ? f[1] : 1; }

/* topic_labels.json is the source of truth for display titles/descriptions: it
   overrides whatever was baked into data.json. Edit that file and refresh the
   browser to adjust the labels — no pipeline rebuild needed. Keyed by id. */
function applyTopicLabels(labels){
  const cl = (labels && labels.clusters) || {};
  const su = (labels && labels.supertopics) || {};
  for(const c of DATA.clusters){
    const e = cl[c.id];
    if(e){ if(e.name) c.name = e.name; if(e.description != null) c.description = e.description; }
  }
  for(const s of (DATA.supertopics || [])){
    const e = su[s.id];
    if(e && e.name) s.name = e.name;
  }
}

/* ── Text + colour utilities (used across modules) ────────────────────────── */
function matches(p){ if(!p._lc) p._lc=p.text.toLowerCase(); return p._lc.includes(state.query); }
function highlight(text){
  if(!state.query) return escapeHTML(text);
  const i=text.toLowerCase().indexOf(state.query); if(i<0) return escapeHTML(text);
  return escapeHTML(text.slice(0,i))+'<mark>'+escapeHTML(text.slice(i,i+state.query.length))+'</mark>'+escapeHTML(text.slice(i+state.query.length));
}
function hexA(hex,a){
  if(hex[0]!=='#') { // rgb()/named from d3 interpolator → convert via d3.color
    const c=d3.color(hex); return `rgba(${c.r},${c.g},${c.b},${a})`;
  }
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}
function escapeHTML(s){ return s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
