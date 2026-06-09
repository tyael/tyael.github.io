'use strict';
/* interaction.js — pointer interaction on the map: hover/pin hit-testing, the
   cursor tooltip, and zoom-to helpers. */

/* ── Hover / pin ──────────────────────────────────────────────────────────── */
function pickNearest(ev){
  const r=canvas.getBoundingClientRect(), mx=ev.clientX-r.left, my=ev.clientY-r.top;
  const cand=quadtree.find(xSc.invert(mx), ySc.invert(my));
  if(!cand) return null;
  if(!clusterVisible(cand.cluster)) return null;
  const d=Math.hypot(xSc(cand.x)-mx, ySc(cand.y)-my);
  return d<16 ? cand : null;
}
let _hraf=null;
function onHover(ev){
  if(_hraf) return;
  _hraf=requestAnimationFrame(()=>{ _hraf=null;
    const hit=pickNearest(ev);
    if(hit){ showPointTooltip(ev,hit); if(state.hoveredPoint!==hit){ state.hoveredPoint=hit; scheduleRender(); } }
    else if(state.hoveredPoint){ state.hoveredPoint=null; hideTooltip(); scheduleRender(); }
  });
}
function onClick(ev){
  if(downPt && (Math.hypot(ev.clientX-downPt.x,ev.clientY-downPt.y)>5 || Date.now()-downPt.t>400)) return; // was a drag
  const hit=pickNearest(ev);
  pin((hit && hit===state.pinnedPoint) ? null : hit);
}
function pin(p){
  state.pinnedPoint=p;
  renderPinPanel(); updateDetail(); scheduleRender();
}

/* ── Tooltip ──────────────────────────────────────────────────────────────── */
const tt=document.getElementById('tooltip');
function placeTooltip(ev,w=340,h=180){
  let x=ev.clientX+14, y=ev.clientY+14;
  if(x+w>innerWidth) x=ev.clientX-w-14;
  if(y+h>innerHeight) y=ev.clientY-h-14;
  tt.style.left=x+'px'; tt.style.top=y+'px'; tt.style.display='block';
}
function showPointTooltip(ev,p){
  const c=DATA.clusters[p.cluster];
  document.getElementById('tt-dot').style.background=pointColor(p);
  document.getElementById('tt-report').innerHTML=reportTitleHTML(p.report);
  document.getElementById('tt-sub').textContent=`chunk ${p.chunk} · ${(p.fraction*100).toFixed(0)}% through`;
  const m = Array.isArray(p.mix && p.mix[0]) ? p.mix : [];
  const mixLine = m.length ? `<br><span class="tt-mix">${Math.round(m[0][1]*100)}% confidence${m[1]?` · also ${Math.round(m[1][1]*100)}% ${clusterName(DATA.clusters[m[1][0]])}`:''}</span>` : '';
  document.getElementById('tt-cluster').innerHTML=`<b>${clusterName(c)}</b> — ${clusterDesc(c)}${mixLine}`;
  document.getElementById('tt-text').innerHTML=highlight(p.text.length>320?p.text.slice(0,320)+'…':p.text);
  tt.querySelector('.tt-foot').style.display='';
  document.getElementById('tt-cluster').style.display='';
  document.getElementById('tt-text').style.display='';
  placeTooltip(ev);
}
function showHTMLTooltip(ev,html){
  document.getElementById('tt-dot').style.background='transparent';
  document.getElementById('tt-report').textContent='';
  document.getElementById('tt-sub').textContent='';
  document.getElementById('tt-cluster').style.display='none';
  document.getElementById('tt-text').style.display='none';
  tt.querySelector('.tt-foot').style.display='none';
  document.getElementById('tt-report').innerHTML=html;
  placeTooltip(ev,220,150);
}
function hideTooltip(){ tt.style.display='none'; }

/* ── Zoom-to helpers ───────────────────────────────────────────────────────── */
function zoomToPoint(p){
  const t=d3.zoomIdentity.translate(cssW/2,cssH/2).scale(Math.max(currentK,2.5)).translate(-xOrig(p.x),-yOrig(p.y));
  d3.select(canvas).transition().duration(450).call(zoomBehavior.transform,t);
}
function zoomToReport(rid){
  // Fit the report's spatial extent into view, then ease the shared zoom there.
  const pts=byReport[rid], xs=pts.map(p=>p.x), ys=pts.map(p=>p.y);
  const cx=(d3.min(xs)+d3.max(xs))/2, cy=(d3.min(ys)+d3.max(ys))/2;
  const spanX=Math.max(1e-3,(d3.max(xs)-d3.min(xs))), spanY=Math.max(1e-3,(d3.max(ys)-d3.min(ys)));
  const k=Math.max(1.2, Math.min(8,
    0.7*Math.min((xOrig.range()[1]-xOrig.range()[0])/Math.abs(xOrig(cx+spanX/2)-xOrig(cx-spanX/2)),
                 (yOrig.range()[0]-yOrig.range()[1])/Math.abs(yOrig(cy+spanY/2)-yOrig(cy-spanY/2)))));
  const t=d3.zoomIdentity.translate(cssW/2,cssH/2).scale(k).translate(-xOrig(cx),-yOrig(cy));
  d3.select(canvas).transition().duration(650).call(zoomBehavior.transform, t);
}
