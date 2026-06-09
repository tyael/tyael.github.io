'use strict';
/* timeline.js — "composition over time": one horizontal 100% stacked bar per
   report (newest at top), plus report selection. */

function renderTimeline(){
  const wrap=document.getElementById('timeline-svg-wrap');
  const W=wrap.clientWidth||280, H=wrap.clientHeight||600;
  const m={top:4,right:12,bottom:6,left:52}, w=W-m.left-m.right, h=H-m.top-m.bottom;
  const reports=DATA.reports.slice().reverse();   // newest → oldest, top → bottom
  const svg=d3.select('#timeline').attr('width',W).attr('height',H); svg.selectAll('*').remove();
  const g=svg.append('g').attr('transform',`translate(${m.left},${m.top})`);

  const y=d3.scaleBand().domain(reports.map(r=>r.id)).range([0,h]).paddingInner(0.22);
  const x=d3.scaleLinear().domain([0,1]).range([0,w]);
  const keys=DATA.clusters.map((_,i)=>i);
  const series=d3.stack().keys(keys).offset(d3.stackOffsetExpand).value((d,k)=>d.cluster_proportions[k])(reports);

  // One <g class="layer"> per topic (updateTimelineFocus dims by topic); each
  // holds one rect per report → discrete horizontal stacked bars.
  const layers=g.selectAll('.layer').data(series).join('g').attr('class','layer')
    .attr('fill',(_,i)=>DATA.clusters[i].color);
  layers.selectAll('rect').data(d=>d).join('rect')
    .attr('y',(d,i)=>y(reports[i].id))
    .attr('x',d=>x(d[0]))
    .attr('width',d=>Math.max(0,x(d[1])-x(d[0])))
    .attr('height',y.bandwidth());
  updateTimelineFocus();   // apply current selection/hover highlight

  // selection outline around the whole bar
  g.selectAll('.tl-sel').data(reports.filter(r=>state.selectedReports.has(r.id))).join('rect')
    .attr('class','tl-sel').attr('x',-2).attr('y',d=>y(d.id)-1.5)
    .attr('width',w+4).attr('height',y.bandwidth()+3)
    .attr('fill','none').attr('stroke','#fff').attr('stroke-width',1.4).attr('opacity',0.85);

  // hover/click hit rows (cover the label gutter + bar for easy targeting)
  g.selectAll('.hit').data(reports).join('rect').attr('class','hit')
    .attr('x',-m.left).attr('y',d=>y(d.id)-y.step()*y.paddingInner()/2)
    .attr('width',W).attr('height',y.step())
    .attr('fill','transparent').style('cursor','pointer')
    .on('mousemove',(ev,d)=>timelineHover(ev,d))
    .on('mouseleave',hideTooltip)
    .on('click',(_,d)=>toggleReport(d.id));

  // every row labelled with its report id
  g.selectAll('.tl-year').data(reports).join('text').attr('class',d=>'tl-year'+(state.selectedReports.has(d.id)?' sel':''))
    .attr('x',-8).attr('y',d=>y(d.id)+y.bandwidth()/2).attr('text-anchor','end')
    .attr('dominant-baseline','central').text(d=>d.id);
}

function timelineHover(ev,d){
  const props=d.cluster_proportions.map((p,i)=>({p,i})).sort((a,b)=>b.p-a.p).slice(0,4).filter(o=>o.p>0.001);
  const rows=props.map(o=>{const c=DATA.clusters[o.i];
    return `<div class="mixrow"><span class="dotpill" style="background:${c.color}"></span>
      <span class="mixlabel">${(o.p*100).toFixed(0)}% ${clusterName(c)}</span></div>`;}).join('');
  showHTMLTooltip(ev,
    `<div class="tt-report">${reportTitleHTML(d.id)}</div>
     <div class="tt-sub" style="margin-bottom:6px">${d.chunk_count} chunks</div>${rows}`);
}

function toggleReport(rid){
  if(state.selectedReports.has(rid)) state.selectedReports.delete(rid); else state.selectedReports.add(rid);
  renderTimeline(); scheduleRender(); updateDetail();
}
