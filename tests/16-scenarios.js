// Existing versus proposed, and the discharge comparison that is the
// actual deliverable of having two of them.
const { JSDOM, VirtualConsole } = require('jsdom');
const fs=require('fs');
const html=fs.readFileSync('../public/index.html','utf8');
const CSV =fs.readFileSync('../samples/PF_Depth_English_PDS.csv','utf8');
const errs=[]; const vc=new VirtualConsole();
vc.on('jsdomError',e=>errs.push(e.detail?e.detail.message:e.message));
const dom=new JSDOM(html,{runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,
  url:'https://local.test/',virtualConsole:vc});
const pass=[],fail=[];
const t=(n,f)=>{try{f()?pass.push(n):fail.push(n);}catch(e){fail.push(n+' -> '+e.message);}};

setTimeout(()=>{
 const w=dom.window,d=dom.window.document;
 w.open=()=>null; w.confirm=()=>true; w.fetch=()=>Promise.reject(new Error('offline'));
 let saved=null; w.URL.createObjectURL=()=>'blob:x'; w.URL.revokeObjectURL=()=>{};
 const RB=w.Blob; w.Blob=function(p,o){saved=String(p[0]);return new RB(p,o);};
 w.loadNOAAText(CSV,'noaa.csv');

 t('1 an existing scenario is created on load', ()=>
   w.appState.activeScenario==='existing' && !!w.appState.scenarios.existing);
 t('2 the toolbar shows the scenario selector', ()=>
   d.getElementById('scenario-sel')!==null && d.getElementById('scenario-make')!==null);

 // build existing conditions: two subareas to one outfall
 const mk=(tool,lat,lng)=>{ w.curTool=tool; w.onDrawCreated({layer:w.L.marker([lat,lng]),layerType:'marker'}); };
 mk('outfall',32.7200,-117.1660);
 const out=Object.keys(w.appState.nodes)[0];
 w.appState.nodes[out].name='Discharge point 1';
 w.setNodeElev(w.appState.nodes[out],120,'entered');
 w.curTool='subcatchment';
 w.onDrawCreated({layer:w.L.polygon([[32.726,-117.176],[32.727,-117.172],[32.724,-117.171],[32.723,-117.175]]),layerType:'polygon'});
 w.curTool='subcatchment';
 w.onDrawCreated({layer:w.L.polygon([[32.722,-117.170],[32.723,-117.166],[32.720,-117.165],[32.719,-117.169]]),layerType:'polygon'});
 const subs=Object.values(w.appState.subareas);
 subs.forEach(s=>{ s.drainTo=out; s.lu_idx=2; s.imp=20; });
 w.recomputeNetwork();
 const preQ=w.nodeResult(out).Q;

 t('3 existing conditions produce a discharge at the outfall', ()=> preQ>0);

 t('4 proposed is created from existing, carrying the geometry over', ()=>{
   w.createProposed();
   return w.appState.activeScenario==='proposed' &&
          Object.keys(w.appState.subareas).length===2 &&
          Object.keys(w.appState.nodes).length===1;
 });
 t('5 the two scenarios are independent', ()=>{
   const s=Object.values(w.appState.subareas);
   s.forEach(x=>{ x.lu_idx=8; x.imp=85; });      // pave it
   w.recomputeNetwork();
   const postQ=w.nodeResult(out).Q;
   return postQ>preQ;
 });
 t('6 switching back restores existing untouched', ()=>{
   w.switchScenario('existing');
   const s=Object.values(w.appState.subareas);
   return w.appState.activeScenario==='existing' &&
          s.every(x=>x.imp===20) && Math.abs(w.nodeResult(out).Q-preQ)<0.01;
 });
 t('7 switching forward restores the proposed edits', ()=>{
   w.switchScenario('proposed');
   const s=Object.values(w.appState.subareas);
   return s.every(x=>x.imp===85) && w.nodeResult(out).Q>preQ;
 });
 t('8 geometry survives a round trip between scenarios', ()=>{
   const s=Object.values(w.appState.subareas)[0];
   return s.layer && s.layer.getLatLngs()[0].length===4 && s.area>0;
 });

 let cmp=null;
 t('9 the comparison pairs the discharge points', ()=>{
   cmp=w.compareScenarios();
   return cmp && cmp.rows.length===1 && cmp.rows[0].node==='Discharge point 1';
 });
 t('10 pre and post are the right way round', ()=>{
   const r=cmp.rows[0];
   return Math.abs(r.preQ-preQ)<0.01 && r.postQ>r.preQ;
 });
 t('11 the change and percentage are consistent', ()=>{
   const r=cmp.rows[0];
   return Math.abs(r.delta-(r.postQ-r.preQ))<0.01 &&
          Math.abs(r.pct-((r.postQ-r.preQ)/r.preQ*100))<0.1;
 });
 t('12 paving the site increases the discharge', ()=> cmp.rows[0].delta>0);
 t('13 totals are reported for both conditions', ()=>
   cmp.totalsPre.subareas===2 && cmp.totalsPost.subareas===2 &&
   Math.abs(cmp.totalsPre.area-cmp.totalsPost.area)<0.01);

 t('14 the comparison panel renders', ()=>{
   w.showComparison();
   const tx=d.getElementById('compare-panel').textContent;
   return /PRE AND POST DEVELOPMENT/.test(tx) && /Discharge point 1/.test(tx) &&
          /Percent/.test(tx);
 });
 t('15 the report carries the comparison table', ()=>{
   const r=w.buildReport();
   return /PRE AND POST DEVELOPMENT PEAK DISCHARGE/.test(r) &&
          /Discharge point 1/i.test(r) && /REQUIRES MITIGATION/.test(r) &&
          r.split('\n').every(l=>l.length<=96);
 });
 t('16 the report says which condition it describes', ()=>
   /CONDITION     : Proposed conditions/.test(w.buildReport()));

 t('17 a node only in one scenario is flagged rather than dropped', ()=>{
   w.curTool='junction';
   w.onDrawCreated({layer:w.L.marker([32.7180,-117.1640]),layerType:'marker'});
   const extra=Object.values(w.appState.nodes).filter(n=>n.type==='junction')[0];
   extra.name='New bypass';
   const sub=Object.values(w.appState.subareas)[0];
   sub.drainTo=extra.id; w.recomputeNetwork();
   const c=w.compareScenarios();
   const row=c.rows.filter(r=>r.node==='New bypass')[0];
   return row && row.onlyIn==='proposed' && row.preQ===null && row.postQ>0;
 });

 t('18 scenarios are written into the saved file', ()=>{
   w.saveProject();
   const j=JSON.parse(saved);
   return j.format===3 && j.scenarios.existing && j.scenarios.proposed &&
          j.scenarios.proposed.subareas.length===2 &&
          j.scenarios.existing.subareas[0].imp===20 &&
          j.scenarios.proposed.subareas[0].imp===85;
 });
 t('19 reopening restores both scenarios and the active one', ()=>{
   const f=saved;
   w.newProject();
   w.loadProjectText(f,'p.json');
   return Object.keys(w.appState.scenarios).length===2 &&
          w.appState.activeScenario==='proposed' &&
          w.appState.scenarios.existing.subareas[0].imp===20;
 });
 t('20 the comparison still works after reopening', ()=>{
   const c=w.compareScenarios();
   return c && c.rows.length>=1 && c.rows.some(r=>r.delta!==null);
 });
 t('21 a new project resets to a single existing scenario', ()=>{
   w.newProject();
   return Object.keys(w.appState.scenarios).length===1 &&
          w.appState.activeScenario==='existing' &&
          Object.keys(w.appState.subareas).length===0;
 });
 t('22 an older file without scenarios still opens', ()=>{
   const v2={app:'HydroRational',format:2,project:{},noaa:null,subareas:[],nodes:[],flowpaths:[]};
   const ok=w.loadProjectText(JSON.stringify(v2),'old.json');
   return ok && w.appState.activeScenario==='existing';
 });
 t('23 existing hydrology is untouched', ()=>{
   const h=w.genHydro(10,0.6,20,34.3,[0.332,0.476,0.576,0.790,1.119,1.518,1.815,4.108]);
   return h.N===36&&h.vol===49.30&&h.Tp===245;
 });
 t('24 no runtime errors beyond the jsdom limits', ()=>
   errs.filter(e=>!/getContext|navigation|Not implemented/.test(e)).length===0);

 console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
 console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
 errs.filter(e=>!/getContext|navigation|Not implemented/.test(e)).slice(0,3).forEach(e=>console.log('  ERR '+e));
 process.exit(fail.length?1:0);
},6500);
