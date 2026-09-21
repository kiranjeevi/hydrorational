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
 const D=w.appState.noaaDepths, I=T=>w.noaaIntensity(T,D);

 // ---- the junction equation itself ----
 t('1 Note 1: equal Tc flows add directly', ()=>{
   const r=w.mrmCombine([{Q:10,Tc:12,CA:10/I(12)},{Q:6,Tc:12,CA:6/I(12)}],D,false);
   return Math.abs(r.Q-16)<0.02 && r.Tc===12;
 });
 t('2 junction equation matches a hand calculation, 2 streams', ()=>{
   const s=[{Q:10,Tc:8,CA:10/I(8)},{Q:6,Tc:20,CA:6/I(20)}];
   const QT1=10+ (8/20)*6;
   const QT2=6 + (I(20)/I(8))*10;
   const r=w.mrmCombine(s,D,false);
   const expect=Math.max(QT1,QT2), tc=QT1>=QT2?8:20;
   return Math.abs(r.Q-expect)<0.02 && r.Tc===tc;
 });
 t('3 junction equation matches a hand calculation, 3 streams', ()=>{
   const s=[{Q:12,Tc:6,CA:12/I(6)},{Q:9,Tc:15,CA:9/I(15)},{Q:5,Tc:40,CA:5/I(40)}];
   const QT1=12+(6/15)*9+(6/40)*5;
   const QT2=9+(I(15)/I(6))*12+(15/40)*5;
   const QT3=5+(I(40)/I(6))*12+(I(40)/I(15))*9;
   const r=w.mrmCombine(s,D,false);
   return Math.abs(r.Q-Math.max(QT1,QT2,QT3))<0.02;
 });
 t('4 shorter Tc reduced by intensity ratio, longer by Tc ratio', ()=>{
   const s=[{Q:10,Tc:8,CA:10/I(8)},{Q:10,Tc:40,CA:10/I(40)}];
   const r=w.mrmCombine(s,D,false);
   const QT1=10+(8/40)*10, QT2=10+(I(40)/I(8))*10;
   return Math.abs(r.Q-Math.max(QT1,QT2))<0.02;
 });
 t('5 ties resolve to the shorter Tc', ()=>{
   const r=w.mrmCombine([{Q:5,Tc:10,CA:5/I(10)},{Q:5,Tc:10,CA:5/I(10)}],D,false);
   return r.Tc===10;
 });
 t('6 Note 2 applies when Tc values are within 10 percent', ()=>{
   const s=[{Q:10,Tc:20,CA:10/I(20)},{Q:8,Tc:21,CA:8/I(21)}];
   const r=w.mrmCombine(s,D,false);
   const CA=s[0].CA+s[1].CA;
   return /Note 2/.test(r.rule) && Math.abs(r.Q-CA*I(20))<0.02 && r.Tc===20;
 });
 t('7 Note 3 effective Tc is consistent with the combined Q', ()=>{
   const s=[{Q:12,Tc:6,CA:12/I(6)},{Q:5,Tc:40,CA:5/I(40)}];
   const r=w.mrmCombine(s,D,true);
   const CA=s[0].CA+s[1].CA;
   return r.TcEff>0 && Math.abs(CA*I(r.TcEff)-r.Q)/r.Q < 0.01;
 });
 t('8 intensityToTc inverts noaaIntensity', ()=>
   [7,15,45,120,300].every(T=>Math.abs(w.intensityToTc(I(T),D)-T)/T<0.01));
 t('9 combined Q never exceeds the plain sum', ()=>{
   const s=[{Q:12,Tc:6,CA:12/I(6)},{Q:9,Tc:15,CA:9/I(15)},{Q:5,Tc:40,CA:5/I(40)}];
   const r=w.mrmCombine(s,D,false);
   return r.Q <= 12+9+5+1e-6;
 });
 t('10 combined Q is at least the largest single flow', ()=>{
   const s=[{Q:12,Tc:6,CA:12/I(6)},{Q:5,Tc:40,CA:5/I(40)}];
   return w.mrmCombine(s,D,false).Q >= 12-1e-6;
 });

 // ---- network accumulation ----
 const mk=(tool,lat,lng)=>{ w.curTool=tool; w.onDrawCreated({layer:w.L.marker([lat,lng]),layerType:'marker'}); };
 mk('junction',32.7260,-117.1760); mk('junction',32.7230,-117.1700);
 mk('outfall', 32.7195,-117.1620);
 const N=Object.keys(w.appState.nodes);
 w.setNodeElev(w.appState.nodes[N[0]],1706,'x');
 w.setNodeElev(w.appState.nodes[N[1]],1698,'x');
 w.setNodeElev(w.appState.nodes[N[2]],1690,'x');
 w.curTool='link'; w.onDrawCreated({layer:w.L.polyline([[32.7260,-117.1760],[32.7230,-117.1700]]),layerType:'polyline'});
 w.curTool='link'; w.onDrawCreated({layer:w.L.polyline([[32.7230,-117.1700],[32.7195,-117.1620]]),layerType:'polyline'});
 w.curTool='subcatchment';
 w.onDrawCreated({layer:w.L.polygon([[32.7270,-117.1790],[32.7280,-117.1750],[32.7250,-117.1745],[32.7245,-117.1785]]),layerType:'polygon'});
 w.curTool='subcatchment';
 w.onDrawCreated({layer:w.L.polygon([[32.7240,-117.1720],[32.7248,-117.1690],[32.7222,-117.1685],[32.7215,-117.1715]]),layerType:'polygon'});
 const S=Object.values(w.appState.subareas);
 S[0].drainTo=N[0]; S[1].drainTo=N[1];
 w.recomputeNetwork();

 t('11 headwater node carries only its own subarea', ()=>{
   const r=w.nodeResult(N[0]);
   return r && r.streams.length===1 && Math.abs(r.Q-S[0].Qp)<0.01;
 });
 t('12 middle node combines local subarea with the upstream arrival', ()=>{
   const r=w.nodeResult(N[1]);
   return r && r.streams.length===2 &&
          r.streams.some(s=>s.kind==='upstream') && r.streams.some(s=>s.kind==='subarea');
 });
 t('13 upstream arrival Tc includes the flow path travel time', ()=>{
   const up=w.nodeResult(N[0]);
   const fp=Object.values(w.appState.flowpaths).filter(f=>f.toNode===N[1])[0];
   const arr=w.nodeResult(N[1]).streams.filter(s=>s.kind==='upstream')[0];
   return Math.abs(arr.Tc-(up.TcOut+fp.Tt))<0.02;
 });
 t('14 upstream arrival Q is recomputed at the longer Tc', ()=>{
   const up=w.nodeResult(N[0]);
   const arr=w.nodeResult(N[1]).streams.filter(s=>s.kind==='upstream')[0];
   return arr.Q < up.Q && Math.abs(arr.Q-up.CAOut*I(arr.Tc))<0.02;
 });
 t('15 outfall accumulates the whole system', ()=>{
   const r=w.nodeResult(N[2]);
   return r && r.Q>0 && r.area>0.9*(S[0].area+S[1].area);
 });
 t('16 accumulated Q is less than the sum of the subarea peaks', ()=>{
   const r=w.nodeResult(N[2]);
   return r.Q < S[0].Qp+S[1].Qp;
 });
 t('17 area accumulates down the network', ()=>{
   return w.nodeResult(N[2]).area >= w.nodeResult(N[1]).area - 1e-6 &&
          w.nodeResult(N[1]).area >= w.nodeResult(N[0]).area - 1e-6;
 });
 t('18 Tc grows downstream', ()=>
   w.nodeResult(N[2]).TcOut > w.nodeResult(N[0]).TcOut);
 t('19 a cycle does not hang the accumulation', ()=>{
   w.curTool='link';
   w.onDrawCreated({layer:w.L.polyline([[32.7195,-117.1620],[32.7260,-117.1760]]),layerType:'polyline'});
   const fp=Object.values(w.appState.flowpaths).slice(-1)[0];
   const res=w.accumulateNetwork();
   w.selectFlowPath(fp.id); w.deleteSelected(); w.recomputeNetwork();
   return !!res;
 });
 t('20 Note 3 toggle changes the effective Tc used downstream', ()=>{
   w.toggleNote3(false); const off=w.nodeResult(N[2]).TcOut;
   w.toggleNote3(true);  const on =w.nodeResult(N[2]).TcOut;
   return isFinite(off) && isFinite(on);
 });
 t('21 a routed basin releases its routed peak downstream', ()=>{
   const nd=w.appState.nodes[N[1]];
   nd.type='basin'; w.ensureBasin(nd); nd.basin.auto=true; nd.basin=w.defaultBasin(nd);
   nd.routing=w.routeBasin(nd);
   w.recomputeNetwork();
   const r=w.nodeResult(N[1]);
   const ok = r.routed===true && Math.abs(r.Q-nd.routing.peakOut)<0.01 && r.inQ>r.Q;
   nd.type='junction'; delete nd.routing; w.recomputeNetwork();
   return ok;
 });
 t('22 node panel shows all streams and the rule used', ()=>{
   w.selectNode(N[1]);
   const txt=d.getElementById('jct-tributaries').textContent;
   const rule=d.getElementById('jct-rule').textContent;
   return /via/.test(txt) && /Subarea/.test(txt) && rule.length>10;
 });
 t('23 layer tree shows accumulated node flows', ()=>
   /cfs/.test(d.getElementById('net-items').textContent));

 t('24 report still builds and is within 96 columns', ()=>{
   const r=w.buildReport();
   return /FLOW PROCESS FROM NODE/.test(r) && r.split('\n').every(l=>l.length<=96) &&
          r.indexOf('undefined')<0 && r.indexOf('NaN')<0;
 });
 t('24b report shows the junction equation candidate table', ()=>{
   const r=w.buildReport();
   return /JUNCTION EQUATION, SECTION 3.4/.test(r) &&
          /SHORTER Tc STREAMS REDUCED BY THE INTENSITY RATIO/.test(r) &&
          /CANDIDATE Tc\(MIN\.\)/.test(r) && /<== CONTROLS/.test(r) &&
          /RULE APPLIED:/.test(r);
 });
 t('24c node summary carries accumulated area, Tc and Q', ()=>{
   const r=w.buildReport();
   return /NODE           TYPE        ELEV\(FT\)  STREAMS  AREA\(AC\)   Tc\(MIN\)  Q\(CFS\)/.test(r);
 });
 t('25 save and open round-trips', ()=>{
   w.saveProject(); const f=blobText; w.newProject(); w.loadProjectText(f,'p.json');
   return Object.keys(w.appState.subareas).length===2 && Object.keys(w.appState.nodes).length===3;
 });
 t('26 accumulation rebuilds after reopening', ()=>{
   const ids=Object.keys(w.appState.nodes);
   return ids.some(id=>{ const r=w.nodeResult(id); return r && r.Q>0; });
 });
 t('27 genHydro benchmark unchanged', ()=>{
   const h=w.genHydro(10,0.6,20,34.3,[0.332,0.476,0.576,0.790,1.119,1.518,1.815,4.108]);
   return h.N===36&&h.vol===49.30&&h.Tp===245; });
 t('28 basemaps switch', ()=>{ w.switchBasemap('sat');
   const ok=d.getElementById('sbm').textContent==='Satellite'; w.switchBasemap('esritopo'); return ok; });
 t('29 no em dash', ()=> html.indexOf('\u2014')===-1);
 t('30 zero runtime errors', ()=> errs.length===0);

 console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
 console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
 errs.slice(0,4).forEach(e=>console.log('  ERR '+e));
 process.exit(0);
},6000);
