'use strict';
/* controls.js — header controls (search, colour mode, toggles, tabs, about) and
   the global reset. */

function wireControls(){
  const search=document.getElementById('search'), clearBtn=document.getElementById('search-clear');
  let deb=null;
  search.addEventListener('input',()=>{
    clearBtn.style.display = search.value?'block':'none';
    clearTimeout(deb); deb=setTimeout(()=>{ state.query=search.value.trim().toLowerCase(); updateDetail(); renderPinPanel(); scheduleRender(); },130);
  });
  clearBtn.addEventListener('click',()=>{ search.value=''; clearBtn.style.display='none'; state.query=''; updateDetail(); renderPinPanel(); scheduleRender(); search.focus(); });

  document.querySelectorAll('#colormode button').forEach(b=>b.addEventListener('click',()=>{
    state.colorMode=b.dataset.mode;
    document.querySelectorAll('#colormode button').forEach(x=>x.classList.toggle('active',x===b));
    document.getElementById('colorbar').style.display = state.colorMode==='time'?'block':'none';
    document.getElementById('hint').style.display = 'block';
    scheduleRender();
  }));

  document.querySelectorAll('.stab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));

  toggleBtn('btn-drift', ()=>state.showDrift, v=>state.showDrift=v);
  toggleBtn('btn-traj',  ()=>state.showTrajectories, v=>state.showTrajectories=v);
  toggleBtn('btn-conf', ()=>state.fadeConfidence, v=>state.fadeConfidence=v);
  document.getElementById('btn-clear').addEventListener('click',resetAll);

  // About panel
  const about=document.getElementById('about-panel');
  document.getElementById('btn-about').addEventListener('click',()=>{ renderAbout(); about.hidden=false; });
  document.getElementById('about-close').addEventListener('click',()=>{ about.hidden=true; });
  about.addEventListener('click',e=>{ if(e.target===about) about.hidden=true; });

  window.addEventListener('keydown',e=>{ if(e.key==='Escape'){ if(!about.hidden){ about.hidden=true; } else resetAll(); } });
}
function renderAbout(){
  const m=DATA.meta;
  document.getElementById('about-body').innerHTML = `
    <p class="about-p">Every dot is a short passage (~200 words) from ${ORDER.length} ASPI
      <em>Cost of Defence</em> briefs, ${m.year_min}–${m.year_max}. Passages that read alike
      sit close together, and colour sorts them into ${m.n_clusters} topics named from their
      most distinctive words.</p>
    <p class="about-p"><b>Topics are fuzzy, not exact.</b> Many passages sit between several,
      so read the colours as gradients rather than hard borders — the <b>Confidence</b>
      toggle dims the in-between ones.</p>
    <p class="about-stat">${m.n_points.toLocaleString()} passages · ${ORDER.length} reports · ${m.n_clusters} topics</p>`;
}
function toggleBtn(id,get,set){
  const b=document.getElementById(id);
  b.classList.toggle('active',get());
  b.addEventListener('click',()=>{ set(!get()); b.classList.toggle('active',get()); scheduleRender(); });
}
function resetAll(){
  state.selectedReports.clear(); state.selectedClusters.clear(); state.query=''; state.pinnedPoint=null;
  state.hoveredCluster=null;
  const s=document.getElementById('search'); s.value=''; document.getElementById('search-clear').style.display='none';
  refreshLegend(); updateTimelineFocus(); renderTimeline(); renderPinPanel(); updateDetail(); scheduleRender();
}
