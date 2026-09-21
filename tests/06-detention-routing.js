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
 let blobText=null; w.URL.createObjectURL=()=>'blob:x'; w.URL.revokeObjectURL=()=>{};
 const RB=w.Blob; w.Blob=function(p,o){blobText=String(p[0]);return new RB(p,o);};

 w.loadNOAAText(CSV,'noaa.csv');
 w.curTool='junction'; w.onDrawCreated({layer:w.L.marker([32.7240,-117.1730]),layerType:'marker'});
 w.curTool='basin';    w.onDrawCreated({layer:w.L.marker([32.7200,-117.1660]),layerType:'marker'});
 const ids=Object.keys(w.appState.nodes);
 w.setNodeElev(w.appState.nodes[ids[0]],1706,'USGS 3DEP');
 w.setNodeElev(w.appState.nodes[ids[1]],1690,'USGS 3DEP');
 w.curTool='subcatchment';
 w.onDrawCreated({layer:w.L.polygon([[32.726,-117.176],[32.727,-117.170],[32.723,-117.169],[32.722,-117.175]]),layerType:'polygon'});
 const sc=Object.values(w.appState.subareas)[0];
 sc.drainTo=ids[1]; w.computeSubarea(sc);
 const basin=w.appState.nodes[ids[1]];

 t('1 basin object is created with sensible defaults', ()=>{
   const b=w.ensureBasin(basin);
   return b.dia_in===18 && b.cd===0.61 && b.stage.length===5 && b.inv===1690;
 });
 t('2 orifice is zero below the invert', ()=> w.orificeQ(1689.5, basin.basin)===0);
 t('3 orifice grows monotonically with head', ()=>{
   const b=basin.basin;
   let last=-1, ok=true;
   for(let h=0.05;h<=6;h+=0.05){ const q=w.orificeQ(1690+h,b); if(q<last-1e-9) ok=false; last=q; }
   return ok;
 });
 t('4 orifice is continuous at the full flow point', ()=>{
   const b=basin.basin, D=18/12;
   const a=w.orificeQ(1690+D-0.001,b), c=w.orificeQ(1690+D+0.001,b);
   return Math.abs(a-c)/Math.max(a,c) < 0.02;
 });
 t('5 submerged orifice matches Cd A sqrt(2 g h)', ()=>{
   const b=basin.basin, D=18/12, A=Math.PI*(D/2)*(D/2), h=5;
   const expect=0.61*A*Math.sqrt(2*32.174*(h-D/2));
   return Math.abs(w.orificeQ(1690+h,b)-expect)<0.01;
 });
 t('6 weir is zero below the crest, correct above', ()=>{
   const b=basin.basin;
   const below=w.weirQ(b.wcrest-0.1,b);
   const above=w.weirQ(b.wcrest+1,b);
   return below===0 && Math.abs(above-(3.0*b.wlen*Math.pow(1,1.5)))<0.01;
 });
 t('7 stage-storage interpolates and extrapolates', ()=>{
   const b=basin.basin;
   const mid=w.storageAtStage(b,1690.5);
   return Math.abs(mid-0.120)<1e-6 && w.storageAtStage(b,1694)>1.79 && w.storageAtStage(b,1689)===0;
 });

 let res=null;
 t('8 routing runs and returns results', ()=>{ res=w.routeBasin(basin); return !res.error && res.rows.length>10; });
 t('9 peak outflow is less than peak inflow', ()=> res.peakOut < res.peakIn && res.peakOut>0);
 t('10 peak reduction reported as a percentage', ()=> res.reduction>0 && res.reduction<100);
 t('11 routing step equals the hydrograph Tc', ()=> res.dt_min===res.inflow.Tc);
 t('12 water surface starts at the lowest stage', ()=> res.rows[0].wse===res.lowestStage);
 t('13 max WSE is above the orifice invert', ()=> res.maxWSE > basin.basin.inv);
 t('14 storage never goes negative', ()=> res.rows.every(r=>r.S>=-1e-6));
 t('15 outflow never goes negative', ()=> res.rows.every(r=>r.O>=0));
 t('16 outflow recedes to near zero by the end', ()=> res.rows[res.rows.length-1].O<=0.02);
 t('17 continuity: routed volume balances within 2 percent', ()=>{
   const dt=res.dt_min*60;
   let vin=0,vout=0;
   for(let i=0;i<res.rows.length-1;i++){
     vin +=(res.rows[i].I+res.rows[i+1].I)/2*dt;
     vout+=(res.rows[i].O+res.rows[i+1].O)/2*dt;
   }
   const stored=res.rows[res.rows.length-1].S;
   const err=Math.abs(vin-(vout+stored))/Math.max(1,vin);
   if(err>=0.02) console.log('   [continuity error '+(err*100).toFixed(2)+'%]');
   return err<0.02;
 });
 t('18 with the orifice in control, a bigger orifice releases more and stores less', ()=>{
   const kA=sc.area, kD=basin.basin.dia_in, kS=basin.basin.stage, kW=basin.basin.wcrest;
   sc.area=2.0; w.computeSubarea(sc);
   basin.basin.stage=[{e:1690,v:0},{e:1691,v:0.30},{e:1692,v:0.70},{e:1693,v:1.20},{e:1694,v:1.80}];
   basin.basin.wcrest=1693.5;
   basin.basin.dia_in=12; const small=w.routeBasin(basin);
   basin.basin.dia_in=24; const big=w.routeBasin(basin);
   sc.area=kA; basin.basin.dia_in=kD; basin.basin.stage=kS; basin.basin.wcrest=kW; w.computeSubarea(sc);
   if (small.weirActive || big.weirActive) { console.log('   [weir active, orifice not in control]'); return false; }
   return big.peakOut > small.peakOut && big.maxStorage_acft < small.maxStorage_acft;
 });
 t('18b when the weir controls, a bigger orifice lowers the water surface', ()=>{
   const kD=basin.basin.dia_in;
   basin.basin.dia_in=12; const a=w.routeBasin(basin);
   basin.basin.dia_in=36; const b2=w.routeBasin(basin);
   basin.basin.dia_in=kD;
   return a.weirActive && b2.weirActive && b2.maxWSE < a.maxWSE &&
          b2.maxStorage_acft < a.maxStorage_acft;
 });
 t('19 a smaller orifice raises the water surface', ()=>{
   const keep=basin.basin.dia_in;
   basin.basin.dia_in=6;
   const tiny=w.routeBasin(basin);
   basin.basin.dia_in=keep;
   return tiny.maxWSE>res.maxWSE;
 });
 t('20 overtopping is flagged when storage is too small', ()=>{
   const keep=basin.basin.stage;
   basin.basin.stage=[{e:1690,v:0},{e:1690.2,v:0.002}];
   const r=w.routeBasin(basin);
   basin.basin.stage=keep;
   return r.overtops===true;
 });
 t('21 weir activation is reported', ()=>{
   const keep=basin.basin.wcrest;
   basin.basin.wcrest=1690.1;
   const r=w.routeBasin(basin);
   basin.basin.wcrest=keep;
   return r.weirActive===true && r.peakOut>res.peakOut;
 });
 t('22 missing tributary is refused with a message', ()=>{
   const keep=sc.drainTo; sc.drainTo=null;
   const r=w.routeBasin(basin); sc.drainTo=keep;
   return !!r.error;
 });
 t('23 fewer than two stage rows is refused', ()=>{
   const keep=basin.basin.stage; basin.basin.stage=[{e:1690,v:0}];
   const r=w.routeBasin(basin); basin.basin.stage=keep;
   return !!r.error;
 });

 t('24 panel populates and routing button works', ()=>{
   w.selectNode(ids[1]);
   const populated = d.getElementById('b-dia').value==='18' && d.getElementById('b-stor-rows').children.length===5;
   w.runBasinRouting();
   const txt=d.getElementById('b-rt-results').textContent;
   return populated && /Peak inflow/.test(txt) && /Peak outflow/.test(txt) && /Max WSE/.test(txt);
 });
 t('25 stage rows are editable and add/remove', ()=>{
   const n0=basin.basin.stage.length;
   w.addStorRow();
   const added=basin.basin.stage.length===n0+1;
   w.stageEdit(0,'v',0.05);
   const edited=basin.basin.stage[0].v===0.05;
   w.stageDel(basin.basin.stage.length-1);
   basin.basin.stage[0].v=0;
   return added && edited && basin.basin.stage.length===n0;
 });
 t('26 chart receives both inflow and outflow series', ()=>{
   const h=w.appState.lastHydro;
   return h.outflow && h.outflow.length>5 && h.outPeak>0;
 });
 t('27 basin settings survive save and open', ()=>{
   basin.basin.dia_in=24; basin.basin.cd=0.65;
   w.saveProject(); const f=blobText;
   w.newProject(); w.loadProjectText(f,'p.json');
   const nb=Object.keys(w.appState.nodes).map(k=>w.appState.nodes[k]).filter(n=>n.type==='basin')[0];
   return nb && nb.basin && nb.basin.dia_in===24 && nb.basin.cd===0.65 && nb.basin.stage.length===5;
 });
 t('28 routing still works after reopening', ()=>{
   const nb=Object.keys(w.appState.nodes).map(k=>w.appState.nodes[k]).filter(n=>n.type==='basin')[0];
   const r=w.routeBasin(nb);
   return !r.error && r.peakOut>0 && r.peakOut<r.peakIn;
 });

 t('29 node and station report still builds', ()=> /FLOW PROCESS FROM NODE/.test(w.buildReport()));
 t('29b report contains the routing section with method and tables', ()=>{
   const nb=Object.keys(w.appState.nodes).map(k=>w.appState.nodes[k]).filter(n=>n.type==='basin')[0];
   nb.routing=w.routeBasin(nb);
   const r=w.buildReport();
   return /DETENTION BASIN ROUTING/.test(r) && /MODIFIED PULS \(STORAGE INDICATION\)/.test(r) &&
          /2S2\/dt \+ O2/.test(r) && /\*\* ROUTING TABLE \*\*/.test(r) &&
          /PEAK ATTENUATION\(PERCENT\)/.test(r) && /MAXIMUM WATER SURFACE ELEVATION/.test(r) &&
          r.split('\n').every(l=>l.length<=96) && r.indexOf('undefined')<0 && r.indexOf('NaN')<0;
 });
 t('30 genHydro benchmark unchanged', ()=>{
   const h=w.genHydro(10,0.6,20,34.3,[0.332,0.476,0.576,0.790,1.119,1.518,1.815,4.108]);
   return h.N===36&&h.vol===49.30&&h.Tp===245; });
 t('31 basemaps switch', ()=>{ w.switchBasemap('sat');
   const ok=d.getElementById('sbm').textContent==='Satellite'; w.switchBasemap('esritopo'); return ok; });
 t('32 no em dash', ()=> html.indexOf('\u2014')===-1);
 t('33 zero runtime errors', ()=> errs.length===0);

 console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
 console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
 errs.slice(0,4).forEach(e=>console.log('  ERR '+e));
 process.exit(0);
},6000);
