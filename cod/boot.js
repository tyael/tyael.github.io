'use strict';
/* boot.js — entry point. MUST load last: it calls into every other module once
   the data is fetched. All fetches are document-relative so the app runs from
   any path. */

(async function init(){
  try {
    DATA = await fetch('data.json').then(r => { if(!r.ok) throw new Error(r.statusText); return r.json(); });
    try {  // overlay hand-editable labels; missing/invalid file → keep data.json labels
      const labels = await fetch('topic_labels.json').then(r => r.ok ? r.json() : null);
      if(labels) applyTopicLabels(labels);
    } catch(e){ /* no usable topic_labels.json */ }
  } catch(e){
    document.getElementById('root').innerHTML =
      `<div id="error"><h2>Could not load <code>data.json</code></h2>
        <p style="margin:14px 0;color:#8b949e">Build it once from the project root, then serve this folder:</p>
        <p>1 &nbsp; <code>uv run python web/pipeline.py</code></p>
        <p style="margin-top:8px">2 &nbsp; <code>cd web &amp;&amp; python -m http.server 8080</code></p>
        <p style="margin-top:14px;color:#6e7681">(${e.message})</p></div>`;
    return;
  }
  derive();
  buildTimeScale();
  renderLegend();
  buildKeynessControls();
  renderColorbar();
  renderTimeline();
  initCanvas();
  wireControls();
  showGuide();
})();

window.addEventListener('resize',()=>{ renderTimeline(); });
