// Reading a basin's stage-storage off a graded surface, and routing it.
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

setTimeout(async ()=>{
 const w=dom.window,d=dom.window.document;
 w.open=()=>null; w.confirm=()=>true; w.fetch=()=>Promise.reject(new Error('offline'));
 await new Promise(r=>w.terrainReady(r));
 w.loadNOAAText(CSV,'noaa.csv');

 // a graded surface: ground falling east with a rectangular basin cut into it
 const X0=6300000, Y0=1840000, CELL=4, N=160;
 const g=w.makeGrid({crs:'EPSG:2230',x0:X0,y0:Y0,cell:CELL,ncols:N,nrows:N,name:'proposed grading'});
 const inBasin=(r,c)=>r>=70&&r<90&&c>=70&&c<90;          // 20x20 cells = 80x80 ft
 for(let r=0;r<N;r++) for(let c=0;c<N;c++){
   g.z[r*N+c] = inBasin(r,c) ? 96 : 104 - c*0.02;         // 8 ft deep box basin
 }
 g.kind='survey'; g.priority=2; g.vSrc='feet as supplied'; g.id='tl-grade';
 w.appState.terrain.layers.push(g); w.appState.terrainPool[g.id]=g;
 w.rebuildComposite();

 const p=w.cellCentre(g,80,80), ll=w.toLatLngXY(p.x,p.y);
 w.curTool='basin';
 w.onDrawCreated({layer:w.L.marker([ll[0],ll[1]]),layerType:'marker'});
 const nd=Object.values(w.appState.nodes)[0];
 w.selectNode(nd.id);

 t('1 the basin node landed on the graded surface', ()=>
   nd.type==='basin' && Math.abs(w.terrainSampleLatLng(ll[0],ll[1])-96)<0.5);
 t('2 the panel offers to read storage from terrain', ()=>
   d.getElementById('b-stage-step')!==null && /Read storage from the terrain/.test(d.body.textContent));

 t('3 reading storage fills the stage table', ()=>{
   d.getElementById('b-stage-step').value='1';
   d.getElementById('b-stage-max').value='12';
   w.stageStorageFromTerrain();
   return nd.basin.stage.length>5 && nd.basin.stageSrc && /terrain/.test(nd.basin.stageSrc);
 });
 t('4 the floor matches the graded invert', ()=> Math.abs(nd.basin.stage[0].e-96)<0.01);
 t('5 the first row holds no volume', ()=> nd.basin.stage[0].v===0);
 t('6 storage matches the box geometry', ()=>{
   // 20x20 cells of 4 ft = 6400 sq ft, so 4 ft deep is 25600 cf = 0.5877 ac-ft
   const row=nd.basin.stage.filter(s=>Math.abs(s.e-100)<0.01)[0];
   return row && Math.abs(row.v-(6400*4/43560))<0.02;
 });
 t('7 storage is linear with depth in a vertical walled basin', ()=>{
   const a=nd.basin.stage.filter(s=>Math.abs(s.e-98)<0.01)[0];
   const b=nd.basin.stage.filter(s=>Math.abs(s.e-102)<0.01)[0];
   return a && b && Math.abs(b.v-3*a.v)<0.03;
 });
 t('8 the spill is the LOWEST point on the rim, not the highest', ()=>{
   // ground falls east at 0.02 ft per ft, so the rim low point is on the
   // east side at 104 - 90*0.02 = 102.20, not the 104 of the west side
   return Math.abs(nd.basin.spillElev-102.20)<0.15 && nd.basin.spilled!==false;
 });
 t('9 the orifice invert defaults to the basin floor', ()=>
   Math.abs(nd.basin.inv-96)<0.01);
 t('10 the pond outline is drawn on the map', ()=>
   nd.pondLayer && nd.pondLayer.getLayers().length>0);
 t('11 the weir can be set to the spill elevation', ()=>{
   w.useSpillAsWeir();
   return Math.abs(nd.basin.wcrest-nd.basin.spillElev)<1e-9;
 });
 t('12 the table reaches the panel', ()=>
   d.getElementById('b-stor-rows').children.length===nd.basin.stage.length);

 t('13 the terrain read table routes through Modified Puls', ()=>{
   w.curTool='subcatchment';
   w.onDrawCreated({layer:w.L.polygon([
     [ll[0]+0.002,ll[1]-0.002],[ll[0]+0.002,ll[1]+0.002],
     [ll[0]-0.001,ll[1]+0.002],[ll[0]-0.001,ll[1]-0.002]],),layerType:'polygon'});
   const sc=Object.values(w.appState.subareas)[0];
   sc.drainTo=nd.id; w.computeSubarea(sc); w.recomputeNetwork();
   const res=w.routeBasin(nd);
   return !res.error && res.peakOut>0 && res.peakOut<res.peakIn;
 });
 t('14 the routed surface either stays in the table or is flagged as overtopping', ()=>{
   const res=w.routeBasin(nd);
   const top=nd.basin.stage[nd.basin.stage.length-1].e;
   if(res.maxWSE<=top+0.01) return res.maxWSE>=nd.basin.stage[0].e && res.overtops===false;
   return res.overtops===true;          // a small basin should say so, not hide it
 });
 t('15 the report carries the terrain read stage table', ()=>{
   nd.routing=w.routeBasin(nd);
   const r=w.buildReport();
   return /STAGE STORAGE/.test(r) && /96\.00/.test(r) &&
          r.split('\n').every(l=>l.length<=96);
 });
 t('16 editing a row marks the basin as no longer automatic', ()=>{
   w.selectNode(nd.id);              // stageEdit acts on the selected node
   w.stageEdit(1,'v',0.123);
   return nd.basin.auto===false && nd.basin.stage[1].v===0.123;
 });
 t('17 basin data including the terrain table survives save and open', ()=>{
   let saved=null; w.URL.createObjectURL=()=>'blob:x'; w.URL.revokeObjectURL=()=>{};
   const RB=w.Blob; w.Blob=function(q,o){saved=String(q[0]);return new RB(q,o);};
   w.saveProject();
   const j=JSON.parse(saved);
   const b=j.nodes.filter(x=>x.basin)[0];
   return b && b.basin.stage.length===nd.basin.stage.length &&
          Math.abs(b.basin.stage[0].e-96)<0.01;
 });
 t('18 a basin outside the terrain is refused rather than guessed', ()=>{
   const far=w.toLatLngXY(X0-20000, Y0-20000);
   w.curTool='basin';
   w.onDrawCreated({layer:w.L.marker([far[0],far[1]]),layerType:'marker'});
   const nd2=Object.values(w.appState.nodes).slice(-1)[0];
   w.selectNode(nd2.id);
   const before=nd2.basin ? nd2.basin.stage.length : 0;
   w.stageStorageFromTerrain();
   return !nd2.basin || nd2.basin.stage.length===before;
 });
 t('19 existing hydrology is untouched', ()=>{
   const h=w.genHydro(10,0.6,20,34.3,[0.332,0.476,0.576,0.790,1.119,1.518,1.815,4.108]);
   return h.N===36&&h.vol===49.30&&h.Tp===245;
 });
 t('20 no runtime errors beyond the jsdom limits', ()=>
   errs.filter(e=>!/getContext|navigation|Not implemented/.test(e)).length===0);

 console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
 console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
 errs.filter(e=>!/getContext|navigation|Not implemented/.test(e)).slice(0,3).forEach(e=>console.log('  ERR '+e));
 process.exit(fail.length?1:0);
},6500);
