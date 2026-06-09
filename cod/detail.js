'use strict';
/* detail.js — the context-sensitive sidebar panel (search ▸ selection ▸ guide)
   and the floating pinned-chunk overlay. */

function updateDetail(){
  if(state.query) return showSearchResults();
  if(state.selectedClusters.size===1) return showTopic([...state.selectedClusters][0]);
  if(state.selectedClusters.size>1) return showTopics();
  if(state.selectedReports.size) return showReports();
  showGuide();
}
function setDetail(title, html){
  document.getElementById('detail-title').innerHTML=`<span>${title}</span>`;
  document.getElementById('detail-body').innerHTML=html;
}
function showGuide(){
  setDetail('Guide', `<div class="hint-lines">
    <b>Topics</b> are k-means clusters of ${DATA.meta.space==='embedding'?'the '+DATA.meta.embed_model+' embeddings':'the 2-D map'}, ${DATA.meta.labelled?('named by a local model ('+DATA.meta.label_model+')'):'labelled by c-TF-IDF'}.<br>
    <b>Hover a topic</b> (left) to locate it on the map; its sparkline shows prevalence ${YEARS[0]}→${YEARS[YEARS.length-1]}.<br>
    <b>Click topics</b> to spotlight them — select several to compare; click again to deselect.<br>
    <b>Click a chunk</b> on the map to pin it and read its full text.<br>
    <b>Colour ▸ Time</b> repaints every point by year — watch the corpus sweep through semantic space.<br>
    <b>Corpus drift</b> arcs through each year's average position.<br>
    <b>Click a column</b> below to trace a report's reading path; <b>Search</b> charts when a term appears.<br>
    <kbd>Esc</kbd> resets.</div>`);
}
function mixHTML(props){
  return props.map(o=>{const c=DATA.clusters[o.i];
    return `<div class="mixrow"><div class="mixbar" style="width:${Math.max(2,o.p*150)}px;background:${c.color}"></div>
      <span class="mixlabel">${(o.p*100).toFixed(0)}% · ${clusterName(c)}</span></div>`;}).join('');
}
function showReports(){
  let html='';
  for(const rid of [...state.selectedReports].sort((a,b)=>reportIndex[a]-reportIndex[b])){
    const r=DATA.reports.find(x=>x.id===rid);
    const props=r.cluster_proportions.map((p,i)=>({p,i})).sort((a,b)=>b.p-a.p).slice(0,4).filter(o=>o.p>0.01);
    html+=`<div style="margin-bottom:13px">
      <div class="card-name"><span class="dotpill" style="background:${trajColor(rid)}"></span>${reportTitleHTML(rid)}</div>
      <div class="card-meta">${r.chunk_count} chunks · dominant topics</div>
      ${mixHTML(props)}</div>`;
  }
  setDetail(`Selected · ${state.selectedReports.size}`, html);
}
function showTopic(cid){
  const c=DATA.clusters[cid];
  const sup=(DATA.supertopics||[]).find(s=>s.children.includes(cid));
  const chips=(c.keywords||[]).map(k=>`<span class="kw-chip">${escapeHTML(k)}</span>`).join('');
  const eras=(c.era_terms||[]).map(([when,terms])=>`<div class="era-row">
      <div class="era-when">${when}</div><div class="era-terms">${escapeHTML(terms.join(', '))}</div></div>`).join('');
  setDetail('Topic', `
    <div class="card-name"><span class="dotpill" style="background:${c.color}"></span>${clusterName(c)}</div>
    <div class="card-meta">${c.size} chunks${sup?(' · '+escapeHTML(sup.name)):''}${c.description?(' · '+escapeHTML(c.description)):''}</div>
    <div class="kw-chips">${chips}</div>
    ${eras?`<div class="card-meta" style="margin-top:4px">Vocabulary over time</div>${eras}`:''}
    ${c.exemplar?`<div class="card-meta" style="margin-top:8px">Representative passage</div><div class="exemplar">${escapeHTML(c.exemplar)}…</div>`:''}`);
}
function showTopics(){
  const ids=[...state.selectedClusters].sort((a,b)=>a-b);
  let html='';
  for(const cid of ids){
    const c=DATA.clusters[cid];
    const chips=(c.keywords||[]).slice(0,6).map(k=>`<span class="kw-chip">${escapeHTML(k)}</span>`).join('');
    html+=`<div style="margin-bottom:13px">
      <div class="card-name"><span class="dotpill" style="background:${c.color}"></span>${clusterName(c)}</div>
      <div class="card-meta">${c.size} chunks${c.description?(' · '+escapeHTML(c.description)):''}</div>
      <div class="kw-chips">${chips}</div></div>`;
  }
  setDetail(`Topics · ${ids.length}`, html);
}
// Pinned-chunk fulltext lives in a floating panel over the plot (top-left),
// not in the sidebar — so it appears even while a search histogram is shown.
function renderPinPanel(){
  const panel=document.getElementById('pin-panel'), p=state.pinnedPoint;
  if(!p){ panel.hidden=true; panel.innerHTML=''; return; }
  const c=DATA.clusters[p.cluster];
  const mix = Array.isArray(p.mix && p.mix[0]) ? p.mix : [];
  const conf = mix.length
    ? `<div class="card-meta" style="margin-top:9px">Topic confidence</div>${mixHTML(mix.map(([i,w])=>({i,p:w})))}`
    : '';
  panel.innerHTML=`
    <button class="pin-close" title="Close (Esc)">&times;</button>
    <div class="card-name"><span class="dotpill" style="background:${c.color}"></span>${reportTitleHTML(p.report)}</div>
    <div class="card-meta">chunk ${p.chunk} · ${(p.fraction*100).toFixed(0)}% through · ${clusterName(c)}</div>
    ${conf}
    <div class="card-text" style="margin-top:9px">${highlight(p.text)}</div>`;
  panel.hidden=false;
  panel.querySelector('.pin-close').addEventListener('click',()=>pin(null));
}
function showSearchResults(){
  const q=state.query, matched=DATA.points.filter(matches);
  // per-report histogram
  const byR={}; for(const p of matched) byR[p.report]=(byR[p.report]||0)+1;
  const mx=Math.max(1,...Object.values(byR));
  const bars=ORDER.map(rid=>{const v=byR[rid]||0;
    return `<div class="hist-bar" title="${reportTitle(rid)}: ${v}" style="height:${(v/mx*100).toFixed(0)}%;opacity:${v?0.9:0.12}"></div>`;}).join('');
  const top=Object.entries(byR).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([rid,n])=>
    `<div class="toprow" data-rid="${rid}"><span>${reportTitle(rid)}</span><span class="c">${n}</span></div>`).join('');
  setDetail(`Search · ${matched.length} hits`, `
    <div class="card-meta">“${escapeHTML(q)}” across ${ORDER.length} reports</div>
    <div class="hist">${bars}</div>
    <div class="hist-axis"><span>${YEARS[0]}</span><span>${YEARS[YEARS.length-1]}</span></div>
    <div class="toplist">${top||'<span class="hint-lines">no matches</span>'}</div>`);
  document.querySelectorAll('.toprow').forEach(el=>el.addEventListener('click',()=>{
    const rid=el.dataset.rid; state.selectedReports=new Set([rid]); renderTimeline(); scheduleRender(); zoomToReport(rid);
  }));
}
