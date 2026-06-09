'use strict';
/* data.js — derive index structures from DATA and build the time colour scale. */

function derive(){
  ORDER = DATA.meta.reports_order;
  ORDER.forEach((rid,i) => reportIndex[rid] = i);
  DATA.reports.forEach(r => repById[r.id] = r);
  byReport = {}; byCluster = {}; byYear = {};
  const sum = {};
  for(const p of DATA.points){
    (byReport[p.report] ||= []).push(p);
    (byCluster[p.cluster] ||= []).push(p);
    (byYear[p.year] ||= []).push(p);
    const s = (sum[p.report] ||= {x:0,y:0,n:0}); s.x+=p.x; s.y+=p.y; s.n++;
  }
  for(const rid in byReport) byReport[rid].sort((a,b)=>a.chunk-b.chunk);
  for(const rid of ORDER){ const s=sum[rid]; reportCentroids[rid] = {rid, x:s.x/s.n, y:s.y/s.n, year:repById[rid].year}; }
  YEARS = [...new Set(DATA.points.map(p=>p.year))].sort((a,b)=>a-b);
  quadtree = d3.quadtree().x(d=>d.x).y(d=>d.y).addAll(DATA.points);
}

function buildTimeScale(){
  // Turbo is perceptually ordered and stays bright on a dark ground; trim the
  // muddy extremes so early/late years remain legible. Colour by calendar year
  // so every encoding (points, drift arc, colourbar) is mutually consistent.
  tScale = d3.scaleLinear().domain([DATA.meta.year_min, DATA.meta.year_max]).range([0.05, 0.95]);
}
function timeColor(year){ return d3.interpolateTurbo(tScale(year)); }
