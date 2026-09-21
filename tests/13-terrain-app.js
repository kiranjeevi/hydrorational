// Terrain wired into the app: layer stack, composite, contours, profile,
// node elevations, and the seam warning. Uses the real 3DEP tile as the
// base surface, with a survey patch offset on top of it.
const { JSDOM, VirtualConsole } = require('jsdom');
const fs=require('fs');
const html=fs.readFileSync('../public/index.html','utf8');
const tile=fs.readFileSync('../samples/alpine_3dep.tif');
const errs=[]; const vc=new VirtualConsole();
vc.on('jsdomError',e=>errs.push(e.detail?e.detail.message:e.message));
const dom=new JSDOM(html,{runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,
  url:'https://local.test/',virtualConsole:vc});
const pass=[],fail=[];
const t=(n,f)=>{try{f()?pass.push(n):fail.push(n);}catch(e){fail.push(n+' -> '+e.message);}};
const wait=ms=>new Promise(r=>setTimeout(r,ms));

setTimeout(async ()=>{
 const w=dom.window,d=dom.window.document;
 w.open=()=>null; w.confirm=()=>true;
 if(!w.setImmediate) w.setImmediate=fn=>w.setTimeout(fn,0);
 // jsdom has no Worker, which the geotiff bundle touches at load time.
 // Real browsers all have it. Decoding runs on the main thread here.
 if(!w.Worker) w.Worker=function(){ throw new Error('no workers in tests'); };

 // load proj4 and geotiff the same way the app does
 await new Promise(r=>w.terrainReady(ok=>r(ok)));
 await new Promise(r=>w.ensureGeoTIFF(ok=>r(ok)));

 t('1 terrain panel and controls exist', ()=>
   d.getElementById('terrain-items')!==null &&
   d.getElementById('terr-crs')!==null && d.getElementById('terr-vunits')!==null &&
   d.getElementById('tog-contours')!==null && d.getElementById('tog-seam')!==null);
 t('2 the terrain pane sits under the imported layers', ()=>
   parseInt(w.map.getPane('paneTerrain').style.zIndex,10) <
   parseInt(w.map.getPane('paneUser').style.zIndex,10));
 t('3 State Plane zone 6 is registered with proj4', ()=> !!w.proj4.defs('EPSG:2230'));
 t('4 round tripping a coordinate returns the same point', ()=>{
   const xy=w.toWorkingXY(32.8280,-116.7750);
   const ll=w.toLatLngXY(xy[0],xy[1]);
   return Math.abs(ll[0]-32.8280)<1e-6 && Math.abs(ll[1]+116.7750)<1e-6;
 });

 // ingest the real tile as the base layer, exactly as fetchTerrain does
 const u8=new w.Uint8Array(tile.length); u8.set(tile);
 const tif=await w.GeoTIFF.fromArrayBuffer(u8.buffer);
 const img=await tif.getImage();
 const ras=await img.readRasters();
 const base=w.gridFromGeoTIFFParts({width:img.getWidth(),height:img.getHeight(),
   resolution:img.getResolution(),origin:img.getOrigin(),geoKeys:img.getGeoKeys(),data:ras[0]},
   {vUnits:'m',name:'USGS 3DEP',kind:'3dep',priority:0,crs:'EPSG:2230'});
 base.id='tl-base'; base.vSrc='metres, converted to feet';
 w.appState.terrain.layers.push(base);
 w.rebuildComposite();

 t('5 the composite builds from the base layer', ()=>
   w.appState.terrain.comp!==null && w.appState.terrain.target!==null);
 t('6 sampling the composite by lat/long matches the point service', ()=>
   Math.abs(w.terrainSampleLatLng(32.8280,-116.7750) - 1789.98) < 2.0);
 t('7 the panel lists the layer with its cell size and units', ()=>{
   const tx=d.getElementById('terrain-items').textContent;
   return /USGS 3DEP/.test(tx) && /converted to feet/.test(tx) && /EPSG:2230/.test(tx);
 });

 // survey patch 0.9 ft above the real ground
 const b=w.gridBounds(base), cx=(b.xmin+b.xmax)/2, cy=(b.ymin+b.ymax)/2;
 const st=w.makeTarget({xmin:cx-300,ymin:cy-300,xmax:cx+300,ymax:cy+300},3,'EPSG:2230');
 for(let r=0;r<st.nrows;r++) for(let c=0;c<st.ncols;c++){
   const p=w.cellCentre(st,r,c);
   st.z[w.gridIndex(st,r,c)]=w.gridSample(base,p.x,p.y)+0.9;
 }
 st.name='site survey'; st.kind='survey'; st.priority=2; st.vSrc='feet as supplied';
 w.acceptTerrainLayer(st,'site survey');

 t('8 the survey wins inside its footprint', ()=>{
   const ll=w.toLatLngXY(cx,cy);
   return Math.abs(w.terrainSampleLatLng(ll[0],ll[1]) - (1789.98+0.9)) < 2.0;
 });
 t('9 3DEP still supplies ground outside the survey', ()=>{
   const ll=w.toLatLngXY(b.xmin+40,b.ymin+40);
   return !isNaN(w.terrainSampleLatLng(ll[0],ll[1]));
 });
 t('10 the seam reports the offset we introduced', ()=>{
   const s=w.appState.terrain.seam;
   return s && Math.abs(s.meanAbs-0.9)<0.1 && /survey/.test(s.hi);
 });
 t('11 a seam beyond half a foot is called out in the panel', ()=>{
   const tx=d.getElementById('terrain-items').textContent;
   return /Seam/.test(tx) && /vertical datum/.test(tx);
 });
 t('12 tracing the seam produces boundary cells', ()=>{
   w.toggleSeam(true);
   const ok=w.appState.terrain.seamLayer && w.appState.terrain.seamLayer.getLayers().length>20;
   w.toggleSeam(false); return ok;
 });

 t('13 contours draw at the requested interval', ()=>{
   w.setContourInterval(10); w.toggleContours(true);
   const g=w.appState.terrain.contourLayer;
   return g && g.getLayers().length>5;
 });
 t('14 changing the interval redraws them', ()=>{
   const before=w.appState.terrain.contourLayer.getLayers().length;
   w.setContourInterval(5);
   return w.appState.terrain.contourLayer.getLayers().length>before;
 });
 t('15 contours turn off cleanly', ()=>{
   w.toggleContours(false); return w.appState.terrain.contourLayer===null;
 });

 t('16 a profile returns length, drop and grade', ()=>{
   const a=w.toLatLngXY(b.xmin+100,cy), z=w.toLatLngXY(b.xmax-100,cy);
   const p=w.buildProfile([w.L.latLng(a[0],a[1]), w.L.latLng(z[0],z[1])]);
   return p && p.stats && p.stats.gaps===0 && p.stats.samples>200 &&
          Math.abs(p.stats.length-(b.xmax-b.xmin-200))<20 && isFinite(p.stats.slopePct);
 });
 t('17 a profile drawn off the terrain is refused, not silently empty', ()=>{
   const far=w.toLatLngXY(b.xmin-5000,cy), far2=w.toLatLngXY(b.xmin-4000,cy);
   const p=w.buildProfile([w.L.latLng(far[0],far[1]), w.L.latLng(far2[0],far2[1])]);
   return p===null || p.stats===null;
 });
 t('18 the profile tool routes to the profile handler, not a flow path', ()=>{
   const a=w.toLatLngXY(b.xmin+150,cy+100), z=w.toLatLngXY(b.xmax-150,cy-100);
   const fpBefore=Object.keys(w.appState.flowpaths).length;
   w.curTool='profile';
   w.onDrawCreated({layer:w.L.polyline([[a[0],a[1]],[z[0],z[1]]]),layerType:'polyline'});
   return Object.keys(w.appState.flowpaths).length===fpBefore &&
          w.appState.terrain.profile!==null;
 });
 t('19 the drawer gains a profile tab', ()=> d.getElementById('drtab-profile')!==null &&
    d.getElementById('profile-canvas')!==null);

 const ll=w.toLatLngXY(cx+50,cy+50);
 w.curTool='junction';
 w.onDrawCreated({layer:w.L.marker([ll[0],ll[1]]),layerType:'marker'});
 await wait(200);
 t('21 a placed node takes its elevation from the terrain model', ()=>{
   const nd=Object.values(w.appState.nodes)[0];
   if(!nd || nd.elev===null) return false;
   const here=w.terrainSampleLatLng(nd.latlng.lat, nd.latlng.lng);
   return /terrain/.test(nd.elevSrc) && Math.abs(nd.elev-here)<0.01 && nd.elev>1700 && nd.elev<1900;
 });
 t('21b the node reads the survey surface, not the base, where they overlap', ()=>{
   const nd=Object.values(w.appState.nodes)[0];
   const baseG=w.appState.terrain.layers.filter(g=>g.kind==='3dep')[0];
   const xy=w.toWorkingXY(nd.latlng.lat, nd.latlng.lng);
   const bare=w.gridSample(baseG, xy[0], xy[1]);
   return Math.abs((nd.elev-bare)-0.9)<0.15;
 });
 t('22 removing the survey falls back to 3DEP', ()=>{
   const surv=w.appState.terrain.layers.filter(g=>g.kind==='survey')[0];
   w.removeTerrainLayer(surv.id);
   const ll2=w.toLatLngXY(cx,cy);
   return w.appState.terrain.layers.length===1 &&
          Math.abs(w.terrainSampleLatLng(ll2[0],ll2[1])-1789.98)<2.0;
 });
 t('23 the seam warning clears with only one layer', ()=> w.appState.terrain.seam===null);

 t('24 existing hydrology is untouched', ()=>{
   const h=w.genHydro(10,0.6,20,34.3,[0.332,0.476,0.576,0.790,1.119,1.518,1.815,4.108]);
   return h.N===36&&h.vol===49.30&&h.Tp===245;
 });
 t('25 no runtime errors beyond the jsdom canvas limits', ()=>
   errs.filter(e=>!/getContext|navigation|Not implemented/.test(e)).length===0);

 console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
 console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
 errs.filter(e=>!/getContext|navigation|Not implemented/.test(e)).slice(0,3).forEach(e=>console.log('  ERR '+e));
 process.exit(fail.length?1:0);
},7000);
