'use strict';
/* legend.js — topic legend (keywords + sparkline), cluster selection/spotlight
   state, and the time-mode colourbar. */

function renderLegend(){
  document.getElementById('legend-sub').textContent =
    `${DATA.meta.n_clusters} · ${DATA.meta.space === 'embedding' ? DATA.meta.embed_model+' space' : '2-D space'}`;
  const host = document.getElementById('legend');
  host.innerHTML = '';
  for(const c of DATA.clusters){
    const series = DATA.reports.map(r => r.cluster_proportions[c.id]);
    const item = document.createElement('div');
    item.className = 'cluster-item'; item.dataset.cid = c.id;
    item.title = `${clusterKw(c)} · ${c.size} chunks`;
    item.innerHTML = `
      <div class="cluster-swatch" style="background:${c.color}"></div>
      <div class="cluster-text">
        <div class="cluster-keywords">${clusterName(c)}</div>
        <div class="cluster-sub">${clusterDesc(c)}</div>
      </div>
      ${sparkline(series, c.color)}`;
    item.addEventListener('click', () => toggleCluster(c.id));
    item.addEventListener('mouseenter', () => { state.hoveredCluster = c.id; updateTimelineFocus(); scheduleRender(); });
    item.addEventListener('mouseleave', () => { state.hoveredCluster = null; updateTimelineFocus(); scheduleRender(); });
    host.appendChild(item);
  }
}

function sparkline(series, color){
  const w=74,h=22,pad=2, n=series.length, mx=Math.max(...series,1e-9);
  const sx=i=>pad+(w-2*pad)*(i/(n-1)), sy=v=>h-pad-(h-2*pad)*(v/mx);
  let d='M'+series.map((v,i)=>`${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' L');
  const area=d+` L${sx(n-1).toFixed(1)},${h-pad} L${sx(0).toFixed(1)},${h-pad} Z`;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}">
    <path d="${area}" fill="${color}" opacity="0.16"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.3"/></svg>`;
}

function toggleCluster(cid){
  const s=state.selectedClusters;
  if(s.has(cid)) s.delete(cid); else s.add(cid);
  refreshLegend(); updateTimelineFocus(); updateDetail(); scheduleRender();
}
const anyClusterSel = () => state.selectedClusters.size>0;
// With nothing chosen, hover spotlights one topic (else all show). With a
// selection, the selected topics stay lit and a hovered one is lit alongside
// them (preview) — hover adds to the spotlight, it never hides the selection.
function clusterBright(cid){
  const hov=state.hoveredCluster;
  if(!anyClusterSel()) return hov==null || cid===hov;
  return state.selectedClusters.has(cid) || cid===hov;
}
function updateTimelineFocus(){
  const hov=state.hoveredCluster;
  d3.select('#timeline').selectAll('.layer').attr('opacity',(_,i)=>{
    if(!anyClusterSel()) return hov==null ? 0.92 : (i===hov?1:0.16);
    return (state.selectedClusters.has(i)||i===hov) ? 1 : 0.16;
  });
}
function refreshLegend(){
  document.querySelectorAll('.cluster-item').forEach(el=>{
    const cid=+el.dataset.cid;
    el.classList.toggle('solo', state.selectedClusters.has(cid));
    el.classList.toggle('dimmed', anyClusterSel() && !state.selectedClusters.has(cid));
  });
}
// The interactive / labelled set: all when nothing is chosen, else the selected
// topics plus whichever is hovered (so a hovered topic is previewable).
const clusterVisible = cid => !anyClusterSel()
  ? true : (state.selectedClusters.has(cid) || cid===state.hoveredCluster);

function renderColorbar(){
  const stops=[]; for(let i=0;i<=10;i++){ stops.push(timeColor(YEARS[0]+(YEARS[YEARS.length-1]-YEARS[0])*i/10)); }
  document.getElementById('cb-gradient').style.background = `linear-gradient(90deg, ${stops.join(',')})`;
  document.getElementById('cb-min').textContent = YEARS[0];
  document.getElementById('cb-max').textContent = YEARS[YEARS.length-1];
}
