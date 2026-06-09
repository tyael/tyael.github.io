'use strict';
/* map.js — the canvas scatter: scales, zoom setup, and all point/label/trajectory
   drawing. Owns the canvas globals. */

const canvas=document.getElementById('scatter'), ctx=canvas.getContext('2d');
const DOT=2.3, DOT_HI=5.5;
let cssW=0, cssH=0, downPt=null;

function initCanvas(){
  const cont=document.getElementById('map');
  new ResizeObserver(()=>{
    const dpr=window.devicePixelRatio||1;
    cssW=cont.clientWidth; cssH=cont.clientHeight;
    canvas.width=cssW*dpr; canvas.height=cssH*dpr;
    canvas.style.width=cssW+'px'; canvas.style.height=cssH+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
    buildScales(cssW,cssH); renderTimeline(); scheduleRender();
  }).observe(cont);

  zoomBehavior = d3.zoom().scaleExtent([0.3,80]).on('zoom',ev=>{
    currentK=ev.transform.k;
    xSc=ev.transform.rescaleX(xOrig); ySc=ev.transform.rescaleY(yOrig); scheduleRender();
  });
  d3.select(canvas).call(zoomBehavior);

  canvas.addEventListener('mousemove',onHover);
  canvas.addEventListener('mouseleave',()=>{ state.hoveredPoint=null; hideTooltip(); scheduleRender(); });
  canvas.addEventListener('mousedown',e=>downPt={x:e.clientX,y:e.clientY,t:Date.now()});
  canvas.addEventListener('click',onClick);
}

function buildScales(w,h){
  // Equal pixels-per-unit on both axes so the embedding's geometry is faithful
  // (1:1). The square data extent is letterboxed and centred in the map area.
  const xs=DATA.points.map(p=>p.x), ys=DATA.points.map(p=>p.y);
  const x0=d3.min(xs), x1=d3.max(xs), y0=d3.min(ys), y1=d3.max(ys);
  const px=(x1-x0)*0.04, py=(y1-y0)*0.04;
  const dx0=x0-px, dx1=x1+px, dy0=y0-py, dy1=y1+py;
  const dataW=dx1-dx0, dataH=dy1-dy0;
  const availW=Math.max(1,w-margin.left-margin.right), availH=Math.max(1,h-margin.top-margin.bottom);
  const s=Math.min(availW/dataW, availH/dataH);            // shared scale → 1:1
  const offX=margin.left+(availW-dataW*s)/2, offY=margin.top+(availH-dataH*s)/2;
  xOrig=d3.scaleLinear().domain([dx0,dx1]).range([offX, offX+dataW*s]);
  yOrig=d3.scaleLinear().domain([dy0,dy1]).range([offY+dataH*s, offY]);  // flip y → up
  xSc=xOrig.copy(); ySc=yOrig.copy();
}

let _raf=null;
function scheduleRender(){ if(_raf) return; _raf=requestAnimationFrame(()=>{ _raf=null; render(); }); }

function pointColor(p){ return state.colorMode==='time' ? timeColor(p.year) : DATA.clusters[p.cluster].color; }

function render(){
  if(!xSc||!cssW) return;
  ctx.clearRect(0,0,cssW,cssH); ctx.fillStyle='#0d1117'; ctx.fillRect(0,0,cssW,cssH);

  const sel=state.selectedReports, hasSel=sel.size>0;
  const q=state.query, hasQ=q.length>0, hov=state.hoveredCluster;
  const filtering = hasSel||hasQ||hov!=null||anyClusterSel();
  const brightA = filtering?0.85:0.55, dimA=0.05;

  // Batch points by a single fill colour: by year (time mode) or cluster (topic).
  const groups = state.colorMode==='time'
    ? YEARS.map(y=>({color:timeColor(y), pts:byYear[y]}))
    : DATA.clusters.map(c=>({color:c.color, pts:byCluster[c.id]}));

  for(const grp of groups){
    const bright=[], dim=[];
    for(const p of grp.pts){
      if(p===state.pinnedPoint||p===state.hoveredPoint) continue;
      const active = (!hasSel||sel.has(p.report)) && (!hasQ||matches(p)) && clusterBright(p.cluster);
      (active?bright:dim).push(p);
    }
    blob(dim, grp.color, dimA, false);
    blob(bright, grp.color, brightA, state.fadeConfidence);
  }

  if(state.showDrift) drawDrift();
  if(state.showTrajectories && hasSel) for(const rid of sel) drawTrajectory(rid);
  if(!hasQ && state.hoveredPoint==null) drawLabels();

  drawMarker(state.hoveredPoint, false);
  drawMarker(state.pinnedPoint, true);
}

function blob(pts,color,alpha,fade){
  if(!pts.length) return;
  if(!fade){
    ctx.fillStyle=hexA(color,alpha); ctx.beginPath();
    for(const p of pts){ const px=xSc(p.x),py=ySc(p.y); ctx.moveTo(px+DOT,py); ctx.arc(px,py,DOT,0,6.2832); }
    ctx.fill(); return;
  }
  // Fade by soft-membership confidence: bucket into 4 alpha tiers, stay batched.
  const tiers=[[],[],[],[]];
  for(const p of pts){ const w=primaryWeight(p); tiers[Math.min(3,Math.floor(w*4))].push(p); }
  tiers.forEach((tp,t)=>{ if(!tp.length) return;
    ctx.fillStyle=hexA(color, alpha*(0.18+0.82*((t+0.5)/4))); ctx.beginPath();
    for(const p of tp){ const px=xSc(p.x),py=ySc(p.y); ctx.moveTo(px+DOT,py); ctx.arc(px,py,DOT,0,6.2832); }
    ctx.fill();
  });
}

function drawLabels(){
  ctx.textBaseline='middle'; ctx.textAlign='center';
  // Semantic zoom: umbrella super-topics when zoomed out, fine topics when in.
  const supers = DATA.supertopics||[];
  if(currentK < 1.7 && supers.length && !anyClusterSel()){
    for(const s of supers){
      const cx=xSc(s.label_xy[0]), cy=ySc(s.label_xy[1]);
      ctx.font='700 14px system-ui,sans-serif';
      const tw=ctx.measureText(s.name).width;
      ctx.fillStyle='rgba(13,17,23,0.78)'; roundRect(cx-tw/2-7,cy-11,tw+14,22,6); ctx.fill();
      ctx.fillStyle='rgba(230,237,243,0.97)'; ctx.fillText(s.name,cx,cy);
    }
    ctx.textAlign='left'; return;
  }
  for(const c of DATA.clusters){
    if(!clusterVisible(c.id)) continue;
    const faded = state.hoveredCluster!=null && state.hoveredCluster!==c.id;
    const cx=xSc(c.label_xy[0]), cy=ySc(c.label_xy[1]);
    const label=clusterName(c);
    ctx.font='600 12px system-ui,sans-serif';
    const tw=ctx.measureText(label).width;
    ctx.fillStyle=`rgba(13,17,23,${faded?0.4:0.72})`;
    roundRect(cx-tw/2-5,cy-9,tw+10,18,5); ctx.fill();
    ctx.fillStyle=hexA(c.color, faded?0.4:1);
    ctx.fillText(label,cx,cy);
  }
  ctx.textAlign='left';
}

function drawTrajectory(rid){
  const pts=byReport[rid]; if(!pts||pts.length<2) return;
  const color=trajColor(rid), n=pts.length;
  ctx.lineWidth=1.3; ctx.lineJoin='round';
  for(let i=0;i<n-1;i++){
    ctx.strokeStyle=hexA(color,0.12+0.66*(i/(n-1)));
    ctx.beginPath(); ctx.moveTo(xSc(pts[i].x),ySc(pts[i].y)); ctx.lineTo(xSc(pts[i+1].x),ySc(pts[i+1].y)); ctx.stroke();
  }
  const s=pts[0], e=pts[n-1];
  ctx.strokeStyle=hexA(color,0.9); ctx.fillStyle=hexA(color,0.25); ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.arc(xSc(s.x),ySc(s.y),5,0,6.2832); ctx.fill(); ctx.stroke();
  ctx.fillStyle=color; ctx.strokeStyle='#fff'; ctx.lineWidth=1.3;
  ctx.beginPath(); ctx.arc(xSc(e.x),ySc(e.y),5,0,6.2832); ctx.fill(); ctx.stroke();
  ctx.fillStyle=color; ctx.font='700 11px system-ui,sans-serif'; ctx.textBaseline='middle';
  ctx.fillText(reportShort(rid), xSc(e.x)+9, ySc(e.y));
}

function drawDrift(){
  const cs=ORDER.map(r=>reportCentroids[r]);
  // Halo behind the arc so it stays legible over the dense point field.
  ctx.save();
  ctx.shadowColor='rgba(0,0,0,0.85)'; ctx.shadowBlur=6;
  ctx.lineWidth=2.6; ctx.lineJoin='round';
  for(let i=0;i<cs.length-1;i++){
    ctx.strokeStyle=hexA(timeColor(cs[i+1].year),0.95);
    ctx.beginPath(); ctx.moveTo(xSc(cs[i].x),ySc(cs[i].y)); ctx.lineTo(xSc(cs[i+1].x),ySc(cs[i+1].y)); ctx.stroke();
  }
  ctx.restore();
  for(let i=0;i<cs.length;i++){
    ctx.fillStyle=timeColor(cs[i].year); ctx.strokeStyle='rgba(13,17,23,0.95)'; ctx.lineWidth=1.6;
    ctx.beginPath(); ctx.arc(xSc(cs[i].x),ySc(cs[i].y),4,0,6.2832); ctx.fill(); ctx.stroke();
  }
  ctx.textBaseline='middle'; ctx.textAlign='left'; ctx.font='700 11px system-ui,sans-serif';
  cs.forEach((c,i)=>{ if(i%3===0||i===cs.length-1){
    const t="'"+String(c.year).slice(2);
    ctx.fillStyle='rgba(13,17,23,0.8)'; const tw=ctx.measureText(t).width;
    roundRect(xSc(c.x)+6,ySc(c.y)-8,tw+6,16,4); ctx.fill();
    ctx.fillStyle='#fff'; ctx.fillText(t,xSc(c.x)+9,ySc(c.y)); }});
  ctx.textAlign='left';
}

function drawMarker(p,isPin){
  if(!p||!clusterVisible(p.cluster)) return;
  const col=pointColor(p);
  ctx.fillStyle=col; ctx.beginPath(); ctx.arc(xSc(p.x),ySc(p.y),DOT_HI,0,6.2832); ctx.fill();
  ctx.strokeStyle='#fff'; ctx.lineWidth=isPin?2.2:1.5; ctx.stroke();
  if(isPin){ ctx.strokeStyle=hexA(col,0.6); ctx.lineWidth=1.2; ctx.beginPath(); ctx.arc(xSc(p.x),ySc(p.y),DOT_HI+4,0,6.2832); ctx.stroke(); }
}

function roundRect(x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
