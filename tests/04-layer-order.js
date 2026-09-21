const { JSDOM, VirtualConsole } = require('jsdom');
const fs_=require('fs');
const html=fs_.readFileSync('../public/index.html','utf8');
const CSV =fs_.readFileSync('../samples/PF_Depth_English_PDS.csv','utf8');
const errs=[]; const vc=new VirtualConsole();
vc.on('jsdomError',e=>errs.push(e.detail?e.detail.message:e.message));
const dom=new JSDOM(html,{runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,
  url:'https://local.test/',virtualConsole:vc});
const pass=[],fail=[];
const t=(n,f)=>{try{f()?pass.push(n):fail.push(n);}catch(e){fail.push(n+' -> THREW: '+e.message);}};

setTimeout(()=>{
 const w=dom.window,d=dom.window.document;
 w.open=()=>null; w.fetch=()=>Promise.reject(new Error('offline')); w.confirm=()=>true;
 let saved=null; w.URL.createObjectURL=()=>'blob:x'; w.URL.revokeObjectURL=()=>{};
 const RB=w.Blob; w.Blob=function(p,o){saved=String(p[0]);return new RB(p,o);};

 w.loadNOAAText(CSV,'noaa.csv');
 // subcatchment first, then flow path over the top of it (the reported problem)
 w.curTool='subcatchment';
 w.onDrawCreated({layer:w.L.polygon([[32.718,-117.175],[32.726,-117.175],[32.726,-117.160],[32.718,-117.160]]),layerType:'polygon'});
 w.curTool='junction'; w.onDrawCreated({layer:w.L.marker([32.7240,-117.1730]),layerType:'marker'});
 w.curTool='outfall';  w.onDrawCreated({layer:w.L.marker([32.7195,-117.1620]),layerType:'marker'});
 const ids=Object.keys(w.appState.nodes);
 w.appState.nodes[ids[0]].elev=1706; w.appState.nodes[ids[1]].elev=1690;
 w.curTool='link';
 w.onDrawCreated({layer:w.L.polyline([[32.7240,-117.1730],[32.7195,-117.1620]]),layerType:'polyline'});

 const sc=Object.values(w.appState.subareas)[0];
 const fp=Object.values(w.appState.flowpaths)[0];
 const z=n=>parseInt(w.map.getPane(n).style.zIndex,10);

 t('1 custom panes exist', ()=> w.map.getPane('paneSub') && w.map.getPane('paneFp'));
 t('2 flow path pane sits above subcatchment pane', ()=> z('paneFp') > z('paneSub'));
 t('3 node markers sit above both', ()=>{
   const mp=w.getComputedStyle(w.map.getPane('markerPane')).zIndex;
   const mz=parseInt(mp,10);
   return (isNaN(mz)?600:mz) > z('paneFp');
 });
 t('4 subcatchment polygon is in paneSub', ()=> sc.layer.options.pane==='paneSub');
 t('5 flow path line is in paneFp', ()=> fp.layer.options.pane==='paneFp');
 t('6 flow path has a wide invisible hit target', ()=>
   fp.hit && fp.hit.options.weight>=16 && fp.hit.options.opacity===0 &&
   fp.hit.options.pane==='paneFp' && fp.hit.options.pointerEvents==='stroke');
 t('7 clicking the hit target selects the flow path', ()=>{
   w.selectSubarea(sc.id);
   fp.hit.fire('click');
   return w.appState.activeFpId===fp.id && d.getElementById('v-link').style.display!=='none';
 });
 t('8 clicking the polygon still selects the subarea', ()=>{
   sc.layer.fire('click');
   return w.appState.activeScId===sc.id && d.getElementById('v-sc').style.display!=='none';
 });
 t('9 clicking a node still selects the node', ()=>{
   w.appState.nodes[ids[1]].marker.fire('click');
   return w.appState.activeNodeId===ids[1] && d.getElementById('v-jct').style.display!=='none';
 });

 t('10 hit target is not written to the saved file', ()=>{
   w.saveProject();
   const j=JSON.parse(saved);
   return j.flowpaths[0].hit===undefined && j.flowpaths[0].latlngs.length===2;
 });
 const file=saved;
 t('11 reopened flow path gets its panes and hit target back', ()=>{
   w.newProject(); w.loadProjectText(file,'p.json');
   const f2=Object.values(w.appState.flowpaths)[0];
   const s2=Object.values(w.appState.subareas)[0];
   return f2.layer.options.pane==='paneFp' && s2.layer.options.pane==='paneSub' &&
          f2.hit && f2.hit.options.weight>=16;
 });
 t('12 reopened hit target is clickable', ()=>{
   const f2=Object.values(w.appState.flowpaths)[0];
   w.showV('v-welcome'); f2.hit.fire('click');
   return w.appState.activeFpId===f2.id;
 });
 t('13 deleting a flow path removes both line and hit target', ()=>{
   const f2=Object.values(w.appState.flowpaths)[0];
   const before=w.drawnItems.getLayers().length;
   w.selectFlowPath(f2.id); w.deleteSelected();
   return w.drawnItems.getLayers().length===before-2 &&
          Object.keys(w.appState.flowpaths).length===0;
 });

 t('14 draw tool shapeOptions carry the pane', ()=>
   /pane:'paneSub'/.test(html) && /pane:'paneFp'/.test(html));
 t('15 genHydro benchmark unchanged', ()=>{
   const h=w.genHydro(10,0.6,20,34.3,[0.332,0.476,0.576,0.790,1.119,1.518,1.815,4.108]);
   return h.N===36&&h.vol===49.30&&h.Tp===245; });
 t('16 NOAA CSV still loads', ()=> w.loadNOAAText(CSV,'x.csv')===true);
 t('17 runAnalysis still works', ()=>{
   const p=w.L.polygon([[32.720,-117.170],[32.725,-117.165],[32.722,-117.160]]);
   w.curTool='subcatchment'; w.onDrawCreated({layer:p,layerType:'polygon'});
   w.runAnalysis(); return w.appState.lastHydro.Qp>0; });
 t('18 basemaps switch', ()=>{ w.switchBasemap('sat');
   const ok=d.getElementById('sbm').textContent==='Satellite'; w.switchBasemap('esritopo'); return ok; });
 t('19 no em dash', ()=> html.indexOf('\u2014')===-1);
 t('20 zero runtime errors', ()=> errs.length===0);

 console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
 console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
 errs.slice(0,4).forEach(e=>console.log('  ERR '+e));
 process.exit(0);
},6000);
