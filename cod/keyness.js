'use strict';
/* keyness.js — Keyness tab: quanteda-style target-vs-reference log-likelihood
   keyness, computed in-browser from per-group term-count vectors (keyness.json).
   Also owns the sidebar tab switch. */

let KEY=null, keyLoading=false;

function switchTab(tab){
  document.querySelectorAll('.stab').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  document.getElementById('legend').hidden = tab!=='topics';
  document.getElementById('keyness').hidden = tab!=='keyness';
  if(tab==='keyness') ensureKeyness();
}

function buildKeynessControls(){
  if(!DATA.meta.has_keyness) return;
  const tsel=document.getElementById('ky-target');
  const topics='<optgroup label="Topic">'+DATA.clusters.map((c,i)=>
    `<option value="topic:${i}">${escapeHTML(clusterName(c))}</option>`).join('')+'</optgroup>';
  const eras='<optgroup label="Era">'+(DATA.meta.eras||[]).map((e,i)=>
    `<option value="era:${i}">${e}</option>`).join('')+'</optgroup>';
  const reps='<optgroup label="Report">'+ORDER.slice().reverse().map(rid=>
    `<option value="report:${reportIndex[rid]}">${reportTitle(rid)}</option>`).join('')+'</optgroup>';
  tsel.innerHTML=topics+eras+reps;
  tsel.addEventListener('change',()=>{ updateRefOptions(); computeKeyness(); });
  document.getElementById('ky-ref').addEventListener('change',computeKeyness);
  document.getElementById('ky-phrases').addEventListener('change',computeKeyness);
  updateRefOptions();
}
const KY_GROUP_KEY = {topic:'topics', era:'eras', report:'reports'};
function kyGroupCount(kind){
  return kind==='topic'?DATA.clusters.length : kind==='era'?(DATA.meta.eras||[]).length : ORDER.length;
}
function kyGroupName(kind,i){
  if(kind==='topic') return clusterName(DATA.clusters[i]);
  if(kind==='era') return DATA.meta.eras[i];
  return reportTitle(ORDER[i]);          // reports are indexed by chronological order
}
function updateRefOptions(){
  const [kind,idxStr]=document.getElementById('ky-target').value.split(':'); const idx=+idxStr;
  let opts='<option value="rest">Rest of corpus</option>';
  const others=[];
  for(let i=0;i<kyGroupCount(kind);i++){
    if(i===idx) continue;
    others.push(`<option value="${kind}:${i}">${escapeHTML(kyGroupName(kind,i))}</option>`);
  }
  const lbl = kind==='topic'?'Other topics' : kind==='era'?'Other eras' : 'Other reports';
  opts += `<optgroup label="${lbl}">${others.join('')}</optgroup>`;
  document.getElementById('ky-ref').innerHTML=opts;
}
async function ensureKeyness(){
  if(KEY||keyLoading||!DATA.meta.has_keyness) return;
  keyLoading=true;
  document.getElementById('ky-results').innerHTML='<div class="ky-loading">Loading keyness data…</div>';
  try{ KEY=await fetch('keyness.json').then(r=>r.ok?r.json():null); }catch(e){ KEY=null; }
  keyLoading=false;
  if(!KEY){ document.getElementById('ky-results').innerHTML='<div class="ky-loading">keyness.json unavailable — rebuild the pipeline.</div>'; return; }
  KEY.corpus=sumVecs(KEY.groups.topics);
  KEY.corpusTotal=KEY.corpus.reduce((a,b)=>a+b,0);
  renderPhrasesList(); computeKeyness();
}
function sumVecs(rows){ const n=rows[0].length, s=new Array(n).fill(0);
  for(const r of rows) for(let i=0;i<n;i++) s[i]+=r[i]; return s; }
function vecTotal(v){ let t=0; for(const x of v) t+=x; return t; }

function computeKeyness(){
  if(!KEY) return;
  const [kind,idxStr]=document.getElementById('ky-target').value.split(':'); const idx=+idxStr;
  const tv = KEY.groups[KY_GROUP_KEY[kind]][idx];
  const refVal=document.getElementById('ky-ref').value;
  const phrasesOnly=document.getElementById('ky-phrases').checked;
  const tt=vecTotal(tv);
  let rv, rt;
  if(refVal==='rest'){ rv=KEY.corpus.map((v,i)=>v-tv[i]); rt=KEY.corpusTotal-tt; }
  else { const [rk,ri]=refVal.split(':'); rv=KEY.groups[KY_GROUP_KEY[rk]][+ri]; rt=vecTotal(rv); }
  if(rt<=0){ renderKeyness([]); return; }
  const c=tt, d=rt, cd=c+d, res=[];
  for(let i=0;i<tv.length;i++){
    const a=tv[i]; if(!a) continue;
    if(phrasesOnly && !KEY.vocab[i].includes(' ')) continue;
    const b=rv[i];
    if(a/c <= b/d) continue;                       // over-represented only
    const E1=c*(a+b)/cd, E2=d*(a+b)/cd;
    const g2=2*(a*Math.log(a/E1) + (b>0 ? b*Math.log(b/E2) : 0));
    res.push({t:KEY.vocab[i], g2, a, corp:KEY.corpus[i]});
  }
  res.sort((x,y)=>y.g2-x.g2);
  renderKeyness(res.slice(0,30));
}
function renderKeyness(res){
  const host=document.getElementById('ky-results');
  if(!res.length){ host.innerHTML='<div class="ky-loading">No over-represented terms.</div>'; return; }
  const mx=res[0].g2||1;
  host.innerHTML=res.map(r=>`<div class="ky-row" data-term="${escapeHTML(r.t)}">
      <div class="ky-rowtop"><span class="ky-term">${escapeHTML(r.t)}</span><span class="ky-stat" title="mentions in target / in whole corpus">${r.a.toLocaleString()} / ${r.corp.toLocaleString()}</span></div>
      <div class="ky-bar"><i style="width:${Math.max(3,r.g2/mx*100).toFixed(0)}%"></i></div></div>`).join('');
  host.querySelectorAll('.ky-row').forEach(el=>el.addEventListener('click',()=>runKeySearch(el.dataset.term)));
}
function renderPhrasesList(){
  const host=document.getElementById('ky-phrases-list');
  host.innerHTML=(KEY.phrases||[]).map(p=>`<span class="kw-chip ky-chip" data-term="${escapeHTML(p)}">${escapeHTML(p)}</span>`).join('');
  host.querySelectorAll('.ky-chip').forEach(el=>el.addEventListener('click',()=>runKeySearch(el.dataset.term)));
}
function runKeySearch(term){
  const s=document.getElementById('search'); s.value=term;
  document.getElementById('search-clear').style.display='block';
  state.query=term.toLowerCase(); updateDetail(); renderPinPanel(); scheduleRender();
}
