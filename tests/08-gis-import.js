const { JSDOM, VirtualConsole } = require('jsdom');
const fs_=require('fs');
const html=fs_.readFileSync('../public/index.html','utf8');
const CSV =fs_.readFileSync('../samples/PF_Depth_English_PDS.csv','utf8');
const SHPZIP=fs_.readFileSync('../samples/basins_sp6.zip');
const KML  =fs_.readFileSync('../samples/site.kml','utf8');
const GJ   =fs_.readFileSync('../samples/subs.geojson','utf8');
const errs=[]; const vc=new VirtualConsole();
vc.on('jsdomError',e=>errs.push(e.detail?e.detail.message:e.message));
const dom=new JSDOM(html,{runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,
  url:'https://local.test/',virtualConsole:vc});
const pass=[],fail=[];
const t=(n,f)=>{try{f()?pass.push(n):fail.push(n);}catch(e){fail.push(n+' -> THREW: '+e.message);}};
const wait=ms=>new Promise(r=>setTimeout(r,ms));

function fakeFile(name, data, isText){
  return { name, _d:data, _t:isText };
}

setTimeout(async ()=>{
 const w=dom.window,d=dom.window.document;
 w.open=()=>null; w.confirm=()=>true;
 // jsdom has no setImmediate, which JSZip's scheduler needs. Browsers are fine.
 if(!w.setImmediate) w.setImmediate=function(fn){var a=[].slice.call(arguments,1);return w.setTimeout(function(){fn.apply(null,a);},0);};
 // FileReader stub that serves our fixtures
 w.FileReader=function(){
   this.readAsText=f=>{ this.result = typeof f._d==='string'?f._d:f._d.toString('utf8'); setTimeout(()=>this.onload&&this.onload(),0); };
   this.readAsArrayBuffer=f=>{ const b=f._d; const u8=new w.Uint8Array(b.length); u8.set(b);
     this.result=u8.buffer; setTimeout(()=>this.onload&&this.onload(),0); };
 };
 w.loadNOAAText(CSV,'noaa.csv');

 t('1 user pane sits below the subcatchment pane', ()=>
   parseInt(w.map.getPane('paneUser').style.zIndex,10) < parseInt(w.map.getPane('paneSub').style.zIndex,10));
 t('2 import UI present', ()=> d.getElementById('gis-file-input')!==null && /Import shapefile/.test(d.body.textContent));

 // GeoJSON
 w.handleGISFile(fakeFile('subs.geojson', GJ, true));
 await wait(300);
 t('3 GeoJSON imports as a user layer', ()=>{
   const L=Object.values(w.appState.userLayers);
   return L.length===1 && L[0].count===2 && L[0].name==='subs.geojson';
 });
 t('4 layer appears in the user layer tree with a count', ()=>
   /subs\.geojson/.test(d.getElementById('user-items').textContent));
 t('5 polygons convert to subcatchments and take their NAME', ()=>{
   const id=Object.keys(w.appState.userLayers)[0];
   w.subareasFromLayer(id);
   const subs=Object.values(w.appState.subareas);
   return subs.length===2 && subs.some(s=>s.name==='Sub 1') && subs.some(s=>s.name==='Sub 2');
 });
 t('6 converted subcatchments have a real computed area', ()=>{
   const subs=Object.values(w.appState.subareas);
   return subs.every(s=>s.area>10 && s.area<40);
 });
 t('7 converted subcatchments compute C, Tc and Qp', ()=>{
   const s=Object.values(w.appState.subareas)[0];
   return s.C>0 && s.Tc>0 && s.Qp>0;
 });
 t('8 converted polygons land in the subcatchment pane', ()=>
   Object.values(w.appState.subareas).every(s=>s.layer.options.pane==='paneSub'));

 // KML
 w.handleGISFile(fakeFile('site.kml', KML, true));
 await wait(2500);
 t('9 KML imports polygon and point', ()=>{
   const L=Object.values(w.appState.userLayers).filter(x=>x.name==='site.kml')[0];
   return L && L.count===2;
 });
 t('10 KML coordinates land near the site', ()=>{
   const L=Object.values(w.appState.userLayers).filter(x=>x.name==='site.kml')[0];
   const b=L.group.getBounds();
   return Math.abs(b.getCenter().lat-32.828)<0.01 && Math.abs(b.getCenter().lng+116.768)<0.01;
 });

 // Shapefile in State Plane
 w.handleGISFile(fakeFile('basins_sp6.zip', SHPZIP, false));
 await wait(4000);
 const SL=Object.values(w.appState.userLayers).filter(x=>/basins/.test(x.name))[0];
 t('11 zipped shapefile imports', ()=> SL && SL.count===2);
 t('12 State Plane coordinates were reprojected to WGS84', ()=>{
   if(!SL) return false;
   const b=SL.group.getBounds();
   return b.getCenter().lat>32.5 && b.getCenter().lat<33.2 &&
          b.getCenter().lng<-116.5 && b.getCenter().lng>-117.2;
 });
 t('13 dbf attributes came through', ()=>
   SL && SL.features.some(f=>/Basin/.test(String((f.properties||{}).NAME||''))));
 t('14 shapefile polygons convert to subcatchments with sane acreage', ()=>{
   const before=Object.keys(w.appState.subareas).length;
   w.subareasFromLayer(SL.id);
   const subs=Object.values(w.appState.subareas);
   const added=subs.slice(before);
   return added.length===2 && added.every(s=>s.area>2 && s.area<8);
 });

 t('15 layer visibility toggles', ()=>{
   const id=SL.id;
   w.toggleUserLayer(id,false); const off=!w.map.hasLayer(SL.group);
   w.toggleUserLayer(id,true);  return off && w.map.hasLayer(SL.group);
 });
 t('16 layer removal cleans up', ()=>{
   const n=Object.keys(w.appState.userLayers).length;
   w.removeUserLayer(SL.id);
   return Object.keys(w.appState.userLayers).length===n-1 && !w.map.hasLayer(SL.group);
 });
 t('17 a HydroRational project json is routed to the project loader, not imported as GIS', ()=>{
   let saved=null; w.URL.createObjectURL=()=>'blob:x'; w.URL.revokeObjectURL=()=>{};
   const RB=w.Blob; w.Blob=function(p,o){saved=String(p[0]);return new RB(p,o);};
   w.saveProject();
   const before=Object.keys(w.appState.userLayers).length;
   w.handleGISFile(fakeFile('proj.json', saved, true));
   return before===Object.keys(w.appState.userLayers).length;
 });
 await wait(200);
 t('18 unsupported type is refused cleanly', ()=>{
   const before=Object.keys(w.appState.userLayers).length;
   w.handleGISFile(fakeFile('notes.docx','x',true));
   return Object.keys(w.appState.userLayers).length===before;
 });

 t('19 network still computes after imports', ()=>{
   w.recomputeNetwork();
   return Object.values(w.appState.subareas).every(s=>s.Qp>0);
 });
 t('20 report still builds within 96 columns', ()=>{
   const r=w.buildReport();
   return /FLOW PROCESS FROM NODE/.test(r) && r.split('\n').every(l=>l.length<=96);
 });
 t('21 genHydro benchmark unchanged', ()=>{
   const h=w.genHydro(10,0.6,20,34.3,[0.332,0.476,0.576,0.790,1.119,1.518,1.815,4.108]);
   return h.N===36&&h.vol===49.30&&h.Tp===245; });
 t('22 no em dash', ()=> html.indexOf('\u2014')===-1);
 t('23 no runtime errors beyond jsdom canvas limits', ()=>
   errs.filter(e=>!/getContext|navigation/.test(e)).length===0);

 console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
 console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
 errs.filter(e=>!/getContext|navigation/.test(e)).slice(0,4).forEach(e=>console.log('  ERR '+e));
 process.exit(0);
},6000);
