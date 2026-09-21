const { JSDOM, VirtualConsole } = require('jsdom');
const fs_=require('fs');
const html=fs_.readFileSync('../public/index.html','utf8');
const CSV =fs_.readFileSync('../samples/PF_Depth_English_PDS.csv','utf8');
const OLDJSON=fs_.readFileSync('../samples/legacy_project_v1.json','utf8');
const errs=[]; const vc=new VirtualConsole();
vc.on('jsdomError',e=>errs.push(e.detail?e.detail.message:e.message));
const dom=new JSDOM(html,{runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,
  url:'https://local.test/',virtualConsole:vc});
const pass=[],fail=[];
const t=(n,f)=>{try{f()?pass.push(n):fail.push(n);}catch(e){fail.push(n+' -> THREW: '+e.message);}};

setTimeout(()=>{
 const w=dom.window,d=dom.window.document;
 w.open=()=>null; w.fetch=()=>Promise.reject(new Error('offline'));
 w.confirm=()=>true;
 const V=id=>d.getElementById(id).value;
 let saved=null;
 w.URL.createObjectURL=()=>'blob:x'; w.URL.revokeObjectURL=()=>{};
 const RealBlob=w.Blob;
 w.Blob=function(parts,opt){ saved=String(parts[0]); return new RealBlob(parts,opt); };

 t('1 Open button and file input exist', ()=>
   d.getElementById('proj-file-input')!==null && /Open project/.test(html));

 // ---- build a project ----
 w.loadNOAAText(CSV,'noaa.csv');
 d.getElementById('f-pname').value='Alpine Car Wash';
 d.getElementById('f-eng').value='Kiran Pallachulla, PE';
 d.getElementById('f-lat').value='32.81200'; d.getElementById('f-lon').value='-117.26800';
 w.curTool='junction'; w.onDrawCreated({layer:w.L.marker([32.7185,-117.1715]),layerType:'marker'});
 w.curTool='outfall';  w.onDrawCreated({layer:w.L.marker([32.7185,-117.1655]),layerType:'marker'});
 const ids=Object.keys(w.appState.nodes);
 w.appState.nodes[ids[0]].elev=1706.0; w.appState.nodes[ids[0]].elevSrc='USGS 3DEP';
 w.appState.nodes[ids[1]].elev=1693.7; w.appState.nodes[ids[1]].elevSrc='USGS 3DEP';
 w.curTool='link';
 w.onDrawCreated({layer:w.L.polyline([[32.7185,-117.1715],[32.7185,-117.1655]]),layerType:'polyline'});
 const fp0=Object.values(w.appState.flowpaths)[0]; fp0.kind='swale'; w.computeFlowPath(fp0);
 w.curTool='subcatchment';
 w.onDrawCreated({layer:w.L.polygon([[32.7200,-117.1720],[32.7210,-117.1700],[32.7195,-117.1690],[32.7190,-117.1710]]),layerType:'polygon'});
 const sc0=Object.values(w.appState.subareas)[0];
 sc0.name='Basin A'; sc0.usNode=ids[0]; sc0.drainTo=ids[1]; sc0.soil='C'; sc0.lu_idx=8; sc0.stn_from='100';
 w.computeSubarea(sc0);
 w.switchBasemap('usgstopo');

 const before={ sc:JSON.parse(JSON.stringify(Object.values(w.appState.subareas).map(s=>{const o={...s};delete o.layer;return o;}))),
                nd:Object.values(w.appState.nodes).map(n=>({id:n.id,name:n.name,type:n.type,elev:n.elev,lat:n.latlng.lat,lng:n.latlng.lng})),
                fp:Object.values(w.appState.flowpaths).map(f=>{const o={...f};delete o.layer;return o;}),
                noaa:w.appState.noaaDepths.slice() };

 t('2 save writes a versioned file with geometry', ()=>{
   w.saveProject();
   const j=JSON.parse(saved);
   return j.format>=2 && j.subareas[0].latlngs.length===4 &&
          j.nodes.length===2 && j.flowpaths[0].latlngs.length===2 &&
          j.view.basemap==='usgstopo' && j.noaa.length===8;
 });
 t('2b the file carries the scenario set as well', ()=>{
   const j=JSON.parse(saved);
   return j.format===3 && j.scenarios && j.scenarios.existing &&
          j.activeScenario==='existing' &&
          j.scenarios.existing.subareas.length===j.subareas.length;
 });
 t('3 saved file keeps project info', ()=>{
   const j=JSON.parse(saved);
   return j.project['f-pname']==='Alpine Car Wash' && /Kiran/.test(j.project['f-eng']);
 });

 const file=saved;
 t('4 new project clears everything', ()=>{
   w.newProject();
   return Object.keys(w.appState.subareas).length===0 &&
          Object.keys(w.appState.nodes).length===0 &&
          Object.keys(w.appState.flowpaths).length===0 &&
          V('f-pname')==='' && V('n360')==='';
 });

 t('5 reopening restores subareas with polygons', ()=>{
   w.loadProjectText(file,'alpine.json');
   const scs=Object.values(w.appState.subareas);
   return scs.length===1 && scs[0].layer && scs[0].layer.getLatLngs()[0].length===4;
 });
 t('6 subarea attributes round-trip exactly', ()=>{
   const s=Object.values(w.appState.subareas)[0], b=before.sc[0];
   return s.name===b.name && s.area===b.area && s.soil===b.soil && s.lu_idx===b.lu_idx &&
          s.stn_from===b.stn_from && s.usNode===b.usNode && s.drainTo===b.drainTo;
 });
 t('7 nodes restore with type, elevation and position', ()=>{
   const ns=Object.values(w.appState.nodes);
   return ns.length===2 && ns[0].elev===1706.0 && ns[1].type==='outfall' &&
          Math.abs(ns[0].latlng.lng-before.nd[0].lng)<1e-7 && ns[0].marker;
 });
 t('8 flow paths restore with type and geometry', ()=>{
   const f=Object.values(w.appState.flowpaths)[0];
   return f.kind==='swale' && f.layer && f.layer.getLatLngs().length===2 &&
          Math.abs(f.length_ft-before.fp[0].length_ft)<1;
 });
 t('9 rainfall restores', ()=>{
   const ok = w.appState.noaaDepths.length===8 &&
              before.noaa.every((v,i)=>Math.abs(w.appState.noaaDepths[i]-v)<1e-9) &&
              V('n360')===before.noaa[7].toFixed(3) &&
              V('n5')===before.noaa[0].toFixed(3);
   if(!ok) console.log('   [n360 field='+V('n360')+' expected='+before.noaa[7].toFixed(3)+']');
   return ok;
 });
 t('10 project info restores', ()=> V('f-pname')==='Alpine Car Wash' && V('f-lat')==='32.81200');
 t('11 basemap restores', ()=> w.curBasemap==='usgstopo');
 t('12 computed results match the pre-save values', ()=>{
   const s=Object.values(w.appState.subareas)[0], b=before.sc[0];
   return Math.abs(s.C-b.C)<1e-9 && Math.abs(s.Tc-b.Tc)<0.02 &&
          Math.abs(s.Qp-b.Qp)<0.02 && /segment/.test(s.ttSrc);
 });
 t('13 restored layers are clickable', ()=>{
   const s=Object.values(w.appState.subareas)[0];
   w.selectSubarea(s.id);
   return d.getElementById('v-sc').style.display!=='none' && V('sc-area')===s.area.toFixed(2);
 });
 t('14 id counters resume without collision', ()=>{
   w.curTool='junction'; w.onDrawCreated({layer:w.L.marker([32.719,-117.169]),layerType:'marker'});
   const keys=Object.keys(w.appState.nodes);
   return keys.length===3 && new Set(keys).size===3;
 });
 t('15 save then reopen twice is stable', ()=>{
   w.saveProject(); const f2=saved;
   w.loadProjectText(f2,'again.json');
   return Object.keys(w.appState.nodes).length===3 &&
          Object.keys(w.appState.subareas).length===1 &&
          Object.keys(w.appState.flowpaths).length===1;
 });

 t('16 your existing v1 CVS file opens', ()=> w.loadProjectText(OLDJSON,'CVS.json')===true);
 t('17 v1 file restores its settings', ()=>{
   const s=Object.values(w.appState.subareas)[0];
   return V('f-addr')==='CVS Pharmacy, 5495' && s.area===0.45 && s.stn_from==='100' &&
          Math.abs(s.C-0.51)<1e-9;
 });
 t('18 v1 nine-value rainfall collapses to eight correctly', ()=>{
   const nine={noaa:[0.332,0.476,0.576,0.790,1.119,1.518,1.815,2.495,4.108],subareas:[],project:{}};
   w.loadProjectText(JSON.stringify(nine),'nine.json');
   return V('n180')==='1.815' && V('n360')==='4.108' && w.appState.noaaDepths.length===8;
 });
 t('19 junk file is rejected without breaking the app', ()=>{
   const ok = w.loadProjectText('not json at all','bad.json')===false &&
              w.loadProjectText('{"hello":1}','bad2.json')===false;
   return ok && w.map && w.map._loaded===true;
 });

 t('20 fitProject zooms to drawn extents', ()=>{
   w.loadProjectText(file,'alpine.json');
   const c0=w.map.getCenter(); w.map.setView([10,10],3); w.fitProject();
   const c1=w.map.getCenter();
   return Math.abs(c1.lat-c0.lat)<0.02 && Math.abs(c1.lng-c0.lng)<0.02;
 });
 t('21 genHydro benchmark unchanged', ()=>{
   const h=w.genHydro(10,0.6,20,34.3,[0.332,0.476,0.576,0.790,1.119,1.518,1.815,4.108]);
   return h.N===36&&h.vol===49.30&&h.Tp===245; });
 t('22 runAnalysis works on a reopened project', ()=>{ w.runAnalysis(); return w.appState.lastHydro.Qp>0; });
 t('23 toolbar names still correct', ()=>
   /Junction \/ Node/.test(d.getElementById('dt-jct').textContent) &&
   /Link \/ Flow path/.test(d.getElementById('dt-lnk').textContent));
 t('24 no em dash', ()=> html.indexOf('\u2014')===-1);
 t('25 zero runtime errors', ()=> errs.length===0);

 console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
 console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
 errs.slice(0,4).forEach(e=>console.log('  ERR '+e));
 process.exit(0);
},6000);
