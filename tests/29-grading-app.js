// Grading edits in the app: draw an outline, set a pad or a raise, and
// get a layer of its own above the ground with cut and fill reported.
const { JSDOM, VirtualConsole } = require('jsdom');
const fs=require('fs');
const html=fs.readFileSync('../public/index.html','utf8');
const CSV=fs.readFileSync('../samples/PF_Depth_English_PDS.csv','utf8');
const errs=[]; const vc=new VirtualConsole();
vc.on('jsdomError',e=>errs.push(e.detail?e.detail.message:e.message));
const dom=new JSDOM(html,{runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,
  url:'https://local.test/',virtualConsole:vc});
const pass=[],fail=[];
const t=(n,f)=>{try{f()?pass.push(n):fail.push(n);}catch(e){fail.push(n+' -> '+e.message);}};

setTimeout(async ()=>{
 const w=dom.window,d=dom.window.document;
 w.open=()=>null; w.confirm=()=>true; w.fetch=()=>Promise.reject(new Error('offline'));
 let toast=''; const T0=w.T; w.T=m=>{ toast=m; T0(m); };
 await new Promise(r=>w.terrainReady(r));
 w.loadNOAAText(CSV,'noaa.csv');

 t('1 grading asks for terrain first', ()=>{ w.startGrade(); return w.curTool!=='grade' && /Load or fetch terrain first/.test(toast); });

 // flat existing ground at 100 ft, 2 ft cells, 300 ft square
 const X0=6300000, Y0=1840000, CELL=2, N=150;
 const g=w.makeGrid({crs:'EPSG:2230',x0:X0,y0:Y0,cell:CELL,ncols:N,nrows:N,name:'existing survey'});
 for(let i=0;i<N*N;i++) g.z[i]=100;
 g.kind='survey'; g.priority=2; g.vSrc='feet as supplied';
 w.acceptTerrainLayer(g,'existing survey');
 const groundBefore=Float32Array.from(g.z);
 const ll=(x,y)=>{ const p=w.toLatLngXY(X0+x,Y0+y); return w.L.latLng(p[0],p[1]); };
 const square=(a,b)=>[ll(a,a),ll(b,a),ll(b,b),ll(a,b)];
 const comp=(x,y)=>{ const p=ll(x,y); return w.terrainSampleLatLng(p.lat,p.lng); };
 const set=(id,v)=>{ d.getElementById(id).value=v; };

 t('2 the panel has a grading button and the tool has a name', ()=>{
   w.startGrade(); const ok=w.curTool==='grade' && /Grade a pad or basin/.test(d.getElementById('stool').textContent);
   w.setTool('select'); return ok && /Grade a pad or basin/.test(d.body.textContent);
 });
 const subsBefore=Object.keys(w.appState.subareas).length;
 w.curTool='grade';
 w.onDrawCreated({layer:w.L.polygon(square(100,200)),layerType:'polygon'});
 t('3 the outline opens the grading form and makes no subarea', ()=>
   d.getElementById('grade-pick').style.display==='block' && Object.keys(w.appState.subareas).length===subsBefore);
 t('4 the form starts at the mean ground inside', ()=>d.getElementById('grade-elev').value==='100.0');

 // a 4 ft fill pad at 2:1
 set('grade-mode','pad'); set('grade-elev','104'); set('grade-slope','2');
 w.applyGradeEdit();
 const e1=w.appState.terrain.layers.filter(l=>l.kind==='edit')[0];
 t('5 the edit is a layer of its own above the ground', ()=>e1 && e1.priority>2 && e1.name==='Grading edit 1' &&
   w.appState.terrain.comp.order[0]===e1);
 t('6 the composite shows the pad and its slope', ()=>
   Math.abs(comp(150,150)-104)<1e-3 && Math.abs(comp(205,150)-101.5)<0.05 && Math.abs(comp(250,150)-100)<1e-3);
 t('7 the surveyed ground underneath is untouched', ()=>g.z.every((v,i)=>v===groundBefore[i]));
 const frustum=(A,P,H,D)=>A*D+P*H*D*D/2+Math.PI*H*H*D*D*D/3;
 t('8 the fill volume is the rounded frustum, in cubic yards in the message', ()=>
   Math.abs(e1.edit.fill-frustum(10000,400,2,4))/frustum(10000,400,2,4)<0.02 && e1.edit.cut===0 &&
   /fill 1,7\d\d cy/.test(toast));
 t('9 the terrain panel describes the edit, not a priority number', ()=>
   /Pad at 104\.00 ft, 2:1 slopes\. Cut 0 cy, fill 1,7\d\d cy, footprint 0\.2\d\d ac/.test(d.getElementById('terrain-items').textContent));
 t('10 a grading edit is not reported as a datum seam', ()=>!w.appState.terrain.seam);

 // a basin cut beside it, 6 ft deep with vertical walls, then storage from it
 w.curTool='grade';
 w.onDrawCreated({layer:w.L.polygon(square(30,70)),layerType:'polygon'});
 set('grade-mode','pad'); set('grade-elev','94'); set('grade-slope','0');
 w.applyGradeEdit();
 const e2=w.appState.terrain.layers.filter(l=>l.kind==='edit')[1];
 t('11 a slope of 0 is a real value, not a missing one', ()=>e2 && e2.edit.slope===0 && /vertical walls/.test(toast));
 t('12 the box basin cut is area times depth', ()=>Math.abs(e2.edit.cut-1600*6)<1e-6);
 w.curTool='basin';
 w.onDrawCreated({layer:w.L.marker(ll(50,50)),layerType:'marker'});
 const nd=Object.values(w.appState.nodes).slice(-1)[0];
 w.selectNode(nd.id);
 set('b-stage-step','1'); set('b-stage-max','8');
 w.stageStorageFromTerrain();
 t('13 basin storage reads straight off the graded edit', ()=>{
   const row=nd.basin.stage.filter(s=>Math.abs(s.e-97)<0.01)[0];
   return Math.abs(nd.basin.stage[0].e-94)<0.01 && row && Math.abs(row.v-(1600*3/43560))<0.003;
 });

 // a later edit over an earlier one wins
 w.curTool='grade';
 w.onDrawCreated({layer:w.L.polygon(square(140,160)),layerType:'polygon'});
 set('grade-mode','offset'); w.gradeModeChanged(); set('grade-delta','2');
 w.applyGradeEdit();
 t('14 a later edit sits on top of an earlier one', ()=>Math.abs(comp(150,150)-106)<1e-3);
 t('15 raising takes the ground it is drawn on, here the pad', ()=>{
   const e3=w.appState.terrain.layers.filter(l=>l.kind==='edit')[2];
   return e3 && Math.abs(e3.edit.fill-400*2)<1e-6 && e3.edit.mode==='offset';
 });

 w.curTool='grade';
 w.onDrawCreated({layer:w.L.polygon(square(10,20)),layerType:'polygon'});
 set('grade-mode','offset'); set('grade-delta','0'); w.applyGradeEdit();
 t('16 a zero change is refused', ()=>/non-zero change/.test(toast) && d.getElementById('grade-pick').style.display==='block');
 set('grade-mode','pad'); set('grade-elev',''); w.applyGradeEdit();
 t('17 a blank elevation is refused, not read as zero', ()=>/Enter the pad elevation/.test(toast));
 w.cancelGradeEdit();
 t('18 cancel closes the form and adds nothing', ()=>d.getElementById('grade-pick').style.display==='none' &&
   w.appState.terrain.layers.filter(l=>l.kind==='edit').length===3);

 // save and open
 let saved=null; w.URL.createObjectURL=()=>'blob:x'; w.URL.revokeObjectURL=()=>{};
 const RB=w.Blob; w.Blob=function(p,o){ saved=String(p[0]); return new RB(p,o); };
 w.saveProject(); w.Blob=RB;
 w.appState.terrain.nextId=1; w.appState.nextEdit=1;          // a fresh session
 w.loadProjectText(saved,'p.json');
 const edits=()=>w.appState.terrain.layers.filter(l=>l.kind==='edit');
 t('19 edits come back from the file with their description', ()=>
   edits().length===3 && edits()[0].edit.mode==='pad' && edits()[0].edit.slope===2 &&
   Math.abs(comp(150,150)-106)<0.05);
 t('20 a new layer after opening does not reuse a saved id', ()=>{
   const ids=w.appState.terrain.layers.map(l=>l.id);
   const g2=w.makeGrid({crs:'EPSG:2230',x0:X0+400,y0:Y0,cell:4,ncols:10,nrows:10,name:'patch'});
   for(let i=0;i<100;i++) g2.z[i]=90;
   w.acceptTerrainLayer(g2,'patch');
   return ids.indexOf(g2.id)<0 && Object.keys(w.appState.terrainPool).length===ids.length+1;
 });
 t('21 a new edit after opening is numbered after the saved ones', ()=>{
   w.curTool='grade';
   w.onDrawCreated({layer:w.L.polygon(square(240,260)),layerType:'polygon'});
   set('grade-mode','offset'); w.gradeModeChanged(); set('grade-delta','-1'); w.applyGradeEdit();
   return edits().slice(-1)[0].name==='Grading edit 4';
 });
 t('22 removing an edit restores the ground under it', ()=>{
   const top=edits().filter(e=>e.edit.mode==='offset' && e.edit.delta===2)[0];
   w.removeTerrainLayer(top.id);
   return Math.abs(comp(150,150)-104)<1e-3;
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
},7000);
