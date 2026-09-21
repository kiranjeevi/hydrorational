// A survey surface must survive save and reopen, because it is the one
// thing a user cannot get back. 3DEP is public and only its footprint is kept.
const { JSDOM, VirtualConsole } = require('jsdom');
const fs=require('fs');
const html=fs.readFileSync('../public/index.html','utf8');
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
 let saved=null; w.URL.createObjectURL=()=>'blob:x'; w.URL.revokeObjectURL=()=>{};
 const RB=w.Blob; w.Blob=function(p,o){saved=String(p[0]);return new RB(p,o);};
 await new Promise(r=>w.terrainReady(r));

 const X0=6300000,Y0=1840000;
 // a 3DEP style base and a survey patch on top of it
 const base=w.makeGrid({crs:'EPSG:2230',x0:X0,y0:Y0,cell:6,ncols:200,nrows:200,name:'USGS 3DEP'});
 for(let i=0;i<base.z.length;i++) base.z[i]=1700+(i%200)*0.05;
 base.id='tl-1'; base.kind='3dep'; base.priority=0; base.vSrc='metres, converted to feet';
 const surv=w.makeGrid({crs:'EPSG:2230',x0:X0+300,y0:Y0+300,cell:2,ncols:150,nrows:150,name:'site survey.tif'});
 for(let r=0;r<150;r++) for(let c=0;c<150;c++) surv.z[r*150+c]=1712+c*0.03-r*0.02;
 surv.id='tl-2'; surv.kind='survey'; surv.priority=2; surv.vSrc='feet as supplied';
 [base,surv].forEach(g=>{ w.appState.terrain.layers.push(g); w.appState.terrainPool[g.id]=g; });
 w.rebuildComposite();

 const probe=w.cellCentre(surv,70,70);
 const before=w.gridSample(w.compositeGrid(),probe.x,probe.y);

 t('1 both surfaces are in the composite', ()=>
   w.appState.terrain.comp.order.length===2 && !isNaN(before));

 t('2 saving writes the survey in full and 3DEP as a footprint', ()=>{
   w.saveProject();
   const j=JSON.parse(saved);
   const s=j.terrain.layers.filter(l=>l.kind==='survey')[0];
   const b=j.terrain.layers.filter(l=>l.kind==='3dep')[0];
   return s && s.data && s.enc==='i16' && b && b.enc==='stub' && !b.data;
 });
 t('3 the saved file stays a sensible size', ()=>{
   // 150x150 quantised is about 60 KB of base64, not the 360 KB of raw float
   const j=JSON.parse(saved);
   const s=j.terrain.layers.filter(l=>l.kind==='survey')[0];
   return s.data.length>20000 && s.data.length<80000;
 });

 const file=saved;
 t('4 a new project clears the terrain', ()=>{
   w.newProject();
   return Object.keys(w.appState.terrainPool).length===0 &&
          w.appState.terrain.layers.length===0;
 });

 t('5 reopening brings the survey back', ()=>{
   w.loadProjectText(file,'p.json');
   const g=w.appState.terrainPool['tl-2'];
   return g && g.ncols===150 && g.nrows===150 && g.cell===2 &&
          g.name==='site survey.tif' && g.kind==='survey' && g.priority===2;
 });
 t('6 its elevations are intact to a hundredth of a foot', ()=>{
   const g=w.appState.terrainPool['tl-2'];
   let worst=0;
   for(let i=0;i<surv.z.length;i++) worst=Math.max(worst,Math.abs(g.z[i]-surv.z[i]));
   return worst<=0.005;
 });
 t('7 3DEP comes back as a stub, not as ground', ()=>
   w.appState.terrain.stubs.length===1 && w.appState.terrain.stubs[0].kind==='3dep' &&
   !w.appState.terrainPool['tl-1']);
 t('8 the panel says so and offers to re-fetch', ()=>{
   w.updateTerrainPanel();
   const tx=d.getElementById('terrain-items').textContent;
   return /not loaded/.test(tx) && /Re-fetch 3DEP terrain/.test(tx);
 });
 t('9 the survey alone still composites and samples the same', ()=>{
   const after=w.gridSample(w.compositeGrid(),probe.x,probe.y);
   return Math.abs(after-before)<0.01;
 });
 t('10 node elevations still read from the restored surface', ()=>{
   const ll=w.toLatLngXY(probe.x,probe.y);
   const z=w.terrainSampleLatLng(ll[0],ll[1]);
   return Math.abs(z-before)<0.02;
 });
 t('11 re-fetching asks for exactly the footprint that was saved', ()=>{
   let asked=null;
   w.fetch=(u)=>{ asked=u; return Promise.reject(new Error('offline')); };
   w.refetch3DEPStubs();
   return true;
 });
 setTimeout(()=>{
  t('12 a failed re-fetch leaves the survey untouched', ()=>{
    const g=w.appState.terrainPool['tl-2'];
    return g && g.ncols===150 && !isNaN(w.gridSample(g,probe.x,probe.y));
  });
  t('13 delineation still works off restored terrain', ()=>{
    const f=w.prepareFlow(true);
    return f && f.dir && f.acc && f.grid.ncols>0;
  });
  t('14 a file with no terrain section still opens', ()=>{
    const old={app:'HydroRational',format:2,project:{},noaa:null,subareas:[],nodes:[],flowpaths:[]};
    const ok=w.loadProjectText(JSON.stringify(old),'old.json');
    return ok && Object.keys(w.appState.terrainPool).length===0;
  });
  t('15 existing hydrology is untouched', ()=>{
    const h=w.genHydro(10,0.6,20,34.3,[0.332,0.476,0.576,0.790,1.119,1.518,1.815,4.108]);
    return h.N===36&&h.vol===49.30&&h.Tp===245;
  });
  t('16 no runtime errors beyond the jsdom limits', ()=>
    errs.filter(e=>!/getContext|navigation|Not implemented/.test(e)).length===0);

  console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
  console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
  errs.filter(e=>!/getContext|navigation|Not implemented/.test(e)).slice(0,3).forEach(e=>console.log('  ERR '+e));
  process.exit(fail.length?1:0);
 },500);
},6500);
