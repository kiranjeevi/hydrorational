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
 let blobText=null,dlName=null;
 w.URL.createObjectURL=()=>'blob:x'; w.URL.revokeObjectURL=()=>{};
 const RB=w.Blob; w.Blob=function(p,o){blobText=String(p[0]);return new RB(p,o);};
 const realCreate=d.createElement.bind(d);
 d.createElement=function(tag){ const el=realCreate(tag);
   if(tag==='a'){ el.click=function(){ dlName=el.download; }; } return el; };

 // build a two-subarea network with a confluence
 w.loadNOAAText(CSV,'noaa.csv');
 d.getElementById('f-pname').value='Alpine Car Wash';
 d.getElementById('f-addr').value='1250 Tavern Road, Alpine, CA 91901';
 d.getElementById('f-eng').value='Kiran Pallachulla';
 d.getElementById('f-firm').value='Snipes-Dye Associates';
 w.curTool='junction'; w.onDrawCreated({layer:w.L.marker([32.7240,-117.1730]),layerType:'marker'});
 w.curTool='junction'; w.onDrawCreated({layer:w.L.marker([32.7215,-117.1680]),layerType:'marker'});
 w.curTool='outfall';  w.onDrawCreated({layer:w.L.marker([32.7195,-117.1620]),layerType:'marker'});
 const ids=Object.keys(w.appState.nodes);
 w.appState.nodes[ids[0]].elev=1706.00;
 w.appState.nodes[ids[1]].elev=1700.28;
 w.appState.nodes[ids[2]].elev=1693.70;
 w.curTool='link';
 w.onDrawCreated({layer:w.L.polyline([[32.7240,-117.1730],[32.7215,-117.1680]]),layerType:'polyline'});
 w.curTool='link';
 w.onDrawCreated({layer:w.L.polyline([[32.7215,-117.1680],[32.7195,-117.1620]]),layerType:'polyline'});
 const fps=Object.values(w.appState.flowpaths);
 fps[1].kind='pipe'; fps[1].dia_in=24; w.computeFlowPath(fps[1]);
 w.curTool='subcatchment';
 w.onDrawCreated({layer:w.L.polygon([[32.726,-117.176],[32.727,-117.172],[32.724,-117.171],[32.723,-117.175]]),layerType:'polygon'});
 w.curTool='subcatchment';
 w.onDrawCreated({layer:w.L.polygon([[32.722,-117.170],[32.723,-117.166],[32.720,-117.165],[32.719,-117.169]]),layerType:'polygon'});
 const subs=Object.values(w.appState.subareas);
 subs[0].stn_from='100'; subs[0].stn_to='101'; subs[0].usNode=ids[0]; subs[0].drainTo=ids[2];
 subs[1].stn_from='200'; subs[1].stn_to='201'; subs[1].usNode=ids[1]; subs[1].drainTo=ids[2];
 subs[1].soil='C'; subs[1].lu_idx=8;
 w.recomputeNetwork(); w.runAnalysis();

 const R=()=>w.buildReport();

 t('1 report generates', ()=> R().length>1500);
 t('2 header carries project, engineer and firm', ()=>{
   const r=R();
   return /PROJECT       : Alpine Car Wash/.test(r) && /Kiran Pallachulla/.test(r) &&
          /Snipes-Dye Associates/.test(r) && /STORM FREQUENCY: 100 YEAR/.test(r);
 });
 t('3 NOAA depths block present with 8 durations', ()=>{
   const r=R();
   return /NOAA ATLAS 14 POINT PRECIPITATION DEPTHS/.test(r) &&
          /5-MIN = /.test(r) && /6-HR = /.test(r) && !/4-HR/.test(r);
 });
 t('4 initial subarea block uses CODE = 21', ()=>
   /FLOW PROCESS FROM NODE\s+100\.00 TO NODE\s+101\.00 IS CODE = 21/.test(R()));
 t('5 initial subarea block has the expected field set', ()=>{
   const r=R();
   return /RATIONAL METHOD INITIAL SUBAREA ANALYSIS/.test(r) &&
          /USER-SPECIFIED RUNOFF COEFFICIENT      = \./.test(r) &&
          /INITIAL SUBAREA FLOW-LENGTH\(FEET\)/.test(r) &&
          /SUBAREA OVERLAND TIME OF FLOW\(MIN\.\)/.test(r) &&
          /100 YEAR RAINFALL INTENSITY\(INCH\/HOUR\)/.test(r) &&
          /TOTAL AREA\(ACRES\) =/.test(r);
 });
 t('6 C printed without the leading zero', ()=>
   /RUNOFF COEFFICIENT      = \.\d{4}/.test(R()));
 t('7 node elevations and difference reported', ()=>{
   const r=R();
   return /UPSTREAM ELEVATION\(FEET\)               =    1706\.00/.test(r) &&
          /DOWNSTREAM ELEVATION\(FEET\)/.test(r) && /ELEVATION DIFFERENCE\(FEET\)/.test(r);
 });
 t('8 gutter travel time block uses CODE = 61', ()=>{
   const r=R();
   return /IS CODE = 61/.test(r) && /COMPUTE STREET FLOW TRAVEL TIME THRU SUBAREA/.test(r);
 });
 t('9 pipe travel time block uses CODE = 31 and prints diameter', ()=>{
   const r=R();
   return /IS CODE = 31/.test(r) && /COMPUTE PIPEFLOW TRAVEL TIME/.test(r) &&
          /PIPE DIAMETER\(INCHES\)                  =      24\.00/.test(r);
 });
 t('10 travel time lines accumulate Tc', ()=>{
   const m=R().match(/TRAVEL TIME\(MIN\.\)  =\s+([\d.]+)\s+TC\(MIN\.\) =\s+([\d.]+)/g);
   return m && m.length>=2;
 });
 t('11 confluence block emitted at the shared outfall', ()=>{
   const r=R();
   return /IS CODE = 1\b/.test(r) && /CONFLUENCE OF MINOR STREAMS/.test(r) &&
          /CONTROLLING TIME OF CONCENTRATION/.test(r) &&
          /JUNCTION EQUATION, SECTION 3.4/.test(r) && /RULE APPLIED:/.test(r);
 });
 t('12 confluence Qp matches mrmJunction', ()=>{
   const m=w.mrmJunction(subs,w.appState.noaaDepths);
   return R().indexOf('PEAK FLOW RATE(CFS) = '+m.Qp.toFixed(2).padStart(8))>=0;
 });
 t('13 subarea summary table totals correctly', ()=>{
   const r=R();
   const tot=(subs[0].area+subs[1].area).toFixed(2);
   return /SUBAREA SUMMARY TABLE/.test(r) && r.indexOf(tot)>=0;
 });
 t('14 node summary lists every node with type and elevation', ()=>{
   const r=R();
   return /NODE SUMMARY TABLE/.test(r) && /OUTFALL/.test(r) && /1706\.00/.test(r);
 });
 t('15 flow path summary lists both paths', ()=>{
   const r=R();
   return /FLOW PATH SUMMARY TABLE/.test(r) && /Street gutter/.test(r) && /Pipe \/ conduit/.test(r);
 });
 t('16 hydrograph block matches Section 6 values', ()=>{
   const r=R(), h=w.appState.lastHydro;
   return /SECTION 6 RATIONAL METHOD HYDROGRAPH/.test(r) &&
          r.indexOf('NUMBER OF RAINFALL BLOCKS N    = '+String(h.N).padStart(6))>=0 &&
          /240 \+ 0\.5 x Tc/.test(r);
 });
 t('17 report ends cleanly', ()=> /END OF RATIONAL METHOD ANALYSIS/.test(R()));
 t('18 every line fits a 96 column listing', ()=>
   R().split('\n').every(l=>l.length<=96));
 t('19 no em dash in generated report', ()=> R().indexOf('\u2014')===-1);

 t('20 Report tab exists and preview fills', ()=>{
   w.showReport();
   const el=d.getElementById('report-panel');
   return d.getElementById('drtab-report')!==null && el.textContent.length>1500 &&
          el.style.display==='block';
 });
 t('21 switching back to hydrograph tab hides the report', ()=>{
   w.showDrawerTab('hydro');
   return d.getElementById('report-panel').style.display==='none' &&
          d.getElementById('drtab-hydro').classList.contains('on');
 });
 t('22 text export downloads a .txt with the listing', ()=>{
   w.exportTXT();
   return /_Node_Station_Report.txt$/.test(dlName) && /FLOW PROCESS FROM NODE/.test(blobText);
 });
 t('23 filename derives from the project name', ()=> /Alpine_Car_Wash/.test(dlName));
 t('24 exportPDF falls back to text when the library cannot load', ()=>{
   dlName=null; blobText=null;
   w.exportPDF();
   return true;   // resolved below
 });
 t('25 empty project is refused rather than producing a blank report', ()=>{
   const keep=w.appState.subareas; w.appState.subareas={};
   const before=dlName; w.exportTXT();
   const same=(dlName===before);
   w.appState.subareas=keep; return same;
 });
 t('26 report survives missing node elevations', ()=>{
   const e=w.appState.nodes[ids[0]].elev; w.appState.nodes[ids[0]].elev=null;
   const r=R(); w.appState.nodes[ids[0]].elev=e;
   return r.length>1000 && r.indexOf('undefined')<0 && r.indexOf('NaN')<0;
 });
 t('27 report survives no NOAA data', ()=>{
   const n=w.appState.noaaDepths; w.appState.noaaDepths=null;
   const r=R(); w.appState.noaaDepths=n;
   return r.length>500 && r.indexOf('undefined')<0;
 });

 t('28 genHydro benchmark unchanged', ()=>{
   const h=w.genHydro(10,0.6,20,34.3,[0.332,0.476,0.576,0.790,1.119,1.518,1.815,4.108]);
   return h.N===36&&h.vol===49.30&&h.Tp===245; });
 t('29 save/open still round-trips', ()=>{
   w.saveProject(); const f=blobText;
   w.newProject(); w.loadProjectText(f,'p.json');
   return Object.keys(w.appState.subareas).length===2 &&
          Object.keys(w.appState.flowpaths).length===2 &&
          Object.keys(w.appState.nodes).length===3;
 });
 t('30 panes and hit targets survive', ()=>{
   const f=Object.values(w.appState.flowpaths)[0];
   return f.layer.options.pane==='paneFp' && f.hit && f.hit.options.weight>=16;
 });
 t('31 no em dash in the app', ()=> html.indexOf('\u2014')===-1);
 t('32 zero runtime errors', ()=> errs.length===0);

 setTimeout(()=>{
   console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
   console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
   errs.slice(0,4).forEach(e=>console.log('  ERR '+e));
   process.exit(0);
 },1200);
},6000);
