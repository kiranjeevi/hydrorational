// One click delineation over the real 3DEP tile, and the provenance rules
// that decide what a re-run is allowed to overwrite.
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

setTimeout(async ()=>{
 const w=dom.window,d=dom.window.document;
 w.open=()=>null; w.confirm=()=>true;
 if(!w.Worker) w.Worker=function(){throw new Error('no workers in tests')};
 await new Promise(r=>w.terrainReady(r));
 await new Promise(r=>w.ensureGeoTIFF(r));

 const u8=new w.Uint8Array(tile.length); u8.set(tile);
 const img=await (await w.GeoTIFF.fromArrayBuffer(u8.buffer)).getImage();
 const ras=await img.readRasters();
 const base=w.gridFromGeoTIFFParts({width:img.getWidth(),height:img.getHeight(),
   resolution:img.getResolution(),origin:img.getOrigin(),geoKeys:img.getGeoKeys(),data:ras[0]},
   {vUnits:'m',name:'USGS 3DEP',kind:'3dep',priority:0,crs:'EPSG:2230'});
 base.id='tl-base'; w.appState.terrain.layers.push(base); w.rebuildComposite();

 t('1 routing the terrain produces direction and accumulation', ()=>{
   const f=w.prepareFlow(true);
   return f && f.dir.length===f.grid.ncols*f.grid.nrows && f.acc.length===f.dir.length;
 });
 t('2 filling leaves no interior sinks on real ground', ()=>{
   const f=w.appState.flow;
   return w.countSinks(f.grid,f.z)===0;
 });
 t('3 routing is cached and not redone for the same terrain', ()=>{
   const k=w.appState.flow.key;
   w.prepareFlow(false);
   return w.appState.flow.key===k;
 });

 // pick the cell with the largest accumulation as a realistic outlet
 const f=w.appState.flow, g=f.grid;
 let best=0; for(let i=1;i<f.acc.length;i++) if(f.acc[i]>f.acc[best]) best=i;
 const br=(best/g.ncols)|0, bc=best%g.ncols;
 const p=w.cellCentre(g,br,bc), outletLL=w.toLatLngXY(p.x,p.y);

 let sc=null;
 t('4 a click delineates a subarea with a real acreage', ()=>{
   sc=w.delineateAt(outletLL[0],outletLL[1]);
   return sc && sc.area>0.5 && sc.area<400;
 });
 t('5 the boundary is a closed polygon on the map', ()=>{
   const ring=sc.layer.getLatLngs()[0];
   return ring.length>20 && w.drawnItems.hasLayer(sc.layer);
 });
 t('6 the polygon area agrees with the cell count', ()=>{
   const geo=w.geodesicArea(sc.layer.getLatLngs()[0])/4046.86;
   return Math.abs(geo-sc.area)/sc.area < 0.2;
 });
 t('7 the longest flow path is split into overland and watercourse', ()=>
   sc.derived && sc.derived.L_ov>0 && sc.derived.L_tt>0 &&
   Math.abs(sc.derived.L_ov+sc.derived.L_tt-sc.derived.pathLength)<sc.derived.pathLength*0.05);
 t('8 the overland reach is capped near the Table 3-2 length', ()=>
   sc.derived.L_ov>50 && sc.derived.L_ov<95);
 t('9 slopes come back positive and plausible', ()=>
   sc.sl_ov>0 && sc.sl_ov<60 && sc.sl_tt>0 && sc.sl_tt<60);
 t('10 the derived lengths land on the subarea fields', ()=>
   sc.L_ov===sc.derived.L_ov && sc.L_tt===sc.derived.L_tt &&
   sc.sl_ov===sc.derived.sl_ov && sc.sl_tt===sc.derived.sl_tt);
 t('11 the traced route is drawn in two reaches', ()=>
   sc.pathLayer && sc.pathLayer.getLayers().length===2);
 t('12 provenance records that the terrain supplied it', ()=>
   sc.prov.geometry==='derived' && sc.prov.area==='derived' &&
   sc.prov.L_ov==='derived' && /3DEP/.test(sc.prov.source));
 t('13 the panel says where the numbers came from', ()=>{
   w.selectSubarea(sc.id);
   const tx=d.getElementById('sc-prov').textContent;
   return /boundary from terrain/.test(tx) && /from terrain/.test(tx);
 });
 t('14 hydrology runs on the delineated subarea', ()=>{
   w.loadNOAAText('by duration for ARI (years):, 1,2,5,10,25,50,100,200,500,1000\n'+
     '5-min:, .1,.1,.1,.1,.1,.1,0.329,.1,.1,.1\n10-min:, .1,.1,.1,.1,.1,.1,0.472,.1,.1,.1\n'+
     '15-min:, .1,.1,.1,.1,.1,.1,0.570,.1,.1,.1\n30-min:, .1,.1,.1,.1,.1,.1,0.791,.1,.1,.1\n'+
     '60-min:, .1,.1,.1,.1,.1,.1,1.120,.1,.1,.1\n2-hr:, .1,.1,.1,.1,.1,.1,1.490,.1,.1,.1\n'+
     '3-hr:, .1,.1,.1,.1,.1,.1,1.770,.1,.1,.1\n6-hr:, .1,.1,.1,.1,.1,.1,2.360,.1,.1,.1\n','noaa.csv');
   w.computeSubarea(sc);
   return sc.C>0 && sc.Ti>0 && sc.Tt>0 && sc.Tc>0 && sc.Qp>0;
 });
 t('15 Tc is built from the terrain derived lengths', ()=>
   Math.abs(sc.Tc-(sc.Ti+sc.Tt))<0.11);

 // the override rules
 t('16 typing a length marks that field as mine', ()=>{
   w.selectSubarea(sc.id);
   d.getElementById('sc-ltt').value='777';
   w.scChanged();
   return sc.L_tt===777 && sc.prov.L_tt==='manual';
 });
 t('17 re-running keeps the overridden field and refreshes the rest', ()=>{
   const ovBefore=sc.L_ov;
   w.redelineate(sc.id);
   return sc.L_tt===777 && sc.prov.L_tt==='manual' &&
          sc.prov.L_ov==='derived' && Math.abs(sc.L_ov-ovBefore)<1;
 });
 t('18 an edited boundary is not overwritten by a re-run', ()=>{
   sc.prov.geometry='edited';
   const before=sc.layer.getLatLngs()[0].length;
   w.redelineate(sc.id);
   return sc.layer.getLatLngs()[0].length===before && sc.prov.geometry==='edited';
 });
 t('19 a hand drawn subarea has nothing to re-run', ()=>{
   w.curTool='subcatchment';
   w.onDrawCreated({layer:w.L.polygon([[32.826,-116.778],[32.827,-116.776],[32.825,-116.775]]),layerType:'polygon'});
   const manual=Object.values(w.appState.subareas).slice(-1)[0];
   return !manual.outlet && !manual.derived;
 });
 t('20 provenance survives save and open', ()=>{
   let saved=null; w.URL.createObjectURL=()=>'blob:x'; w.URL.revokeObjectURL=()=>{};
   const RB=w.Blob; w.Blob=function(p,o){saved=String(p[0]);return new RB(p,o);};
   w.saveProject();
   const j=JSON.parse(saved);
   const s0=j.subareas.filter(x=>x.prov)[0];
   return s0 && s0.prov.L_tt==='manual' && s0.derived && s0.derived.split===undefined;
 });

 t('21 channels draw from the accumulation raster', ()=>{
   w.setChannelThreshold(2); w.toggleChannels(true);
   const ok=w.appState.flow.channelLayer && w.appState.flow.channelLayer.getLayers().length>0;
   w.toggleChannels(false);
   return ok && w.appState.flow.channelLayer===null;
 });
 t('22 a click far off the terrain is refused, not guessed at', ()=>{
   const before=Object.keys(w.appState.subareas).length;
   w.delineateAt(34.5,-119.5);
   return Object.keys(w.appState.subareas).length===before;
 });
 t('23 the delineate tool is a click tool, not a draw handler', ()=>{
   w.setTool('delineate');
   const ok=w.curTool==='delineate' && !w.activeDrawer;
   w.setTool('select'); return ok;
 });
 t('24 existing hydrology is untouched', ()=>{
   const h=w.genHydro(10,0.6,20,34.3,[0.332,0.476,0.576,0.790,1.119,1.518,1.815,4.108]);
   return h.N===36&&h.vol===49.30&&h.Tp===245;
 });
 t('25 no runtime errors beyond the jsdom limits', ()=>
   errs.filter(e=>!/getContext|navigation|Not implemented/.test(e)).length===0);

 console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
 console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
 errs.filter(e=>!/getContext|navigation|Not implemented/.test(e)).slice(0,3).forEach(e=>console.log('  ERR '+e));
 process.exit(fail.length?1:0);
},7000);
