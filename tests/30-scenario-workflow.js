// Working with existing and proposed conditions once a project is set up:
// switching must not drop the engineer back to the new project cards, and
// the report must be exportable for either condition or both.
// Fixture: a real project saved from the live site (SD CCD New facility),
// one subarea paved from natural (0.40 cfs) to commercial (1.31 cfs).
const { JSDOM, VirtualConsole } = require('jsdom');
const fs=require('fs');
const html=fs.readFileSync('../public/index.html','utf8');
const PROJ=fs.readFileSync('../samples/sd_ccd_new_facility.json','utf8');
const errs=[]; const vc=new VirtualConsole();
vc.on('jsdomError',e=>errs.push(e.detail?e.detail.message:e.message));
const dom=new JSDOM(html,{runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,
  url:'https://local.test/',virtualConsole:vc});
const pass=[],fail=[];
const t=(n,f)=>{try{f()?pass.push(n):fail.push(n);}catch(e){fail.push(n+' -> '+e.message);}};

// a stand in for jsPDF that records what was written
function FakePDF(){
  const log={text:[],images:0,pages:1,saved:null};
  this.log=log;
  this.internal={pageSize:{getWidth:()=>612,getHeight:()=>792},getNumberOfPages:()=>log.pages};
  ['setFillColor','rect','setTextColor','setFont','setFontSize','setDrawColor','setLineWidth','line','setPage'].forEach(m=>this[m]=()=>this);
  this.text=(s)=>{ log.text.push(String(s)); return this; };
  this.addPage=()=>{ log.pages++; return this; };
  this.addImage=()=>{ log.images++; return this; };
  this.save=(n)=>{ log.saved=n; FakePDF.last=log; };
}

setTimeout(()=>{
 const w=dom.window,d=dom.window.document;
 w.open=()=>null; w.confirm=()=>true; w.fetch=()=>Promise.reject(new Error('offline'));
 let blobText=null,dlName=null;
 w.URL.createObjectURL=()=>'blob:x'; w.URL.revokeObjectURL=()=>{};
 const RB=w.Blob; w.Blob=function(p,o){blobText=String(p[0]);return new RB(p,o);};
 const realCreate=d.createElement.bind(d);
 d.createElement=function(tag){ const el=realCreate(tag);
   if(tag==='a'){ el.click=function(){ dlName=el.download; }; } return el; };
 const vis=id=>d.getElementById(id) && d.getElementById(id).style.display!=='none';
 const q2=()=>w.nodeResult(Object.values(w.appState.nodes).filter(n=>n.name==='Node 2')[0].id).Q;

 // ── a fresh page has only existing conditions
 t('1 the toolbar shows Existing and Proposed side by side, not a dropdown', ()=>{
   const seg=d.getElementById('scenario-seg');
   return seg && d.getElementById('seg-existing') && d.getElementById('seg-proposed') &&
          d.getElementById('scenario-sel').style.display==='none';
 });
 t('2 with no proposed case the second button offers to create one', ()=>
   /\+ Proposed/.test(d.getElementById('seg-proposed').textContent));
 t('3 an empty project still opens on the getting started cards', ()=>{ w.showHome(); return vis('v-welcome') && !vis('v-scenario'); });

 // ── open the saved project
 w.loadProjectText(PROJ,'sd_ccd_new_facility.json');
 t('4 opening a set up project lands on the project panel, not the setup cards', ()=>
   vis('v-scenario') && !vis('v-welcome'));
 t('5 the panel names the project and the condition being edited', ()=>{
   const tx=d.getElementById('v-scenario').textContent;
   return /SD CCD New facility/.test(tx) && /Existing conditions/.test(tx);
 });
 t('6 the active condition is highlighted in the toolbar', ()=>
   d.getElementById('seg-existing').classList.contains('on') && !d.getElementById('seg-proposed').classList.contains('on') &&
   /^Proposed$/.test(d.getElementById('seg-proposed').textContent.trim()));
 t('7 existing conditions give 0.40 cfs at Node 2', ()=>Math.abs(q2()-0.40)<0.01);

 d.getElementById('seg-proposed').click();
 t('8 switching to proposed stays on the project panel', ()=>
   w.appState.activeScenario==='proposed' && vis('v-scenario') && !vis('v-welcome') &&
   /Proposed conditions/.test(d.getElementById('v-scenario').textContent));
 t('9 proposed conditions give 1.31 cfs at Node 2', ()=>Math.abs(q2()-1.31)<0.01);
 t('10 the panel shows pre and post discharge side by side', ()=>{
   const tx=d.getElementById('v-scenario').textContent;
   return /Node 2/.test(tx) && /0\.40/.test(tx) && /1\.31/.test(tx);
 });
 t('11 clicking the active condition again does nothing', ()=>{
   d.getElementById('seg-proposed').click(); return w.appState.activeScenario==='proposed';
 });

 // deleting something in a set up project goes back to the project panel
 w.curTool='junction'; w.onDrawCreated({layer:w.L.marker([32.6999,-117.0993]),layerType:'marker'});
 w.deleteSelected();
 t('12 deleting returns to the project panel, not the setup cards', ()=>vis('v-scenario') && !vis('v-welcome'));

 // ── reports
 dlName=null; blobText=null;
 w.exportTXT();
 t('13 with both conditions, export asks which to include rather than guessing', ()=>
   dlName===null && vis('report-scope') && /Existing and proposed/.test(d.getElementById('report-scope').textContent));
 w.closeReportScope();

 const editsBefore=JSON.stringify(Object.values(w.appState.subareas).map(s=>[s.lu_idx,s.imp]));
 w.exportTXT('both');
 const both=blobText, bothName=dlName;
 t('14 the combined report covers existing, proposed and the comparison', ()=>
   /CONDITION     : Existing conditions/.test(both) && /CONDITION     : Proposed conditions/.test(both) &&
   /PRE AND POST DEVELOPMENT PEAK DISCHARGE/.test(both) &&
   both.indexOf('Existing conditions')<both.indexOf('Proposed conditions') &&
   both.indexOf('Proposed conditions')<both.indexOf('PRE AND POST DEVELOPMENT'));
 t('15 each condition carries its own numbers', ()=>{
   const ex=both.slice(0,both.indexOf('CONDITION     : Proposed'));
   const pr=both.slice(both.indexOf('CONDITION     : Proposed'));
   return /\.3500/.test(ex) && /\.8180/.test(pr) && !/\.8180/.test(ex);
 });
 t('16 the comparison is printed once, at the end', ()=>both.split('PRE AND POST DEVELOPMENT PEAK DISCHARGE').length===2);
 t('17 the file name says it holds both conditions', ()=>/Existing_and_Proposed/.test(bothName));
 t('18 exporting both leaves the engineer where they were', ()=>
   w.appState.activeScenario==='proposed' && Math.abs(q2()-1.31)<0.01 &&
   JSON.stringify(Object.values(w.appState.subareas).map(s=>[s.lu_idx,s.imp]))===editsBefore);
 t('19 the combined report keeps the 96 column limit', ()=>both.split('\n').every(l=>l.length<=96));

 w.exportTXT('existing');
 t('20 an existing only report has no comparison and no proposed numbers', ()=>
   /CONDITION     : Existing conditions/.test(blobText) && !/Proposed conditions/.test(blobText) &&
   !/PRE AND POST/.test(blobText) && /_Existing_/.test(dlName));
 w.exportTXT('proposed');
 t('21 a proposed report carries the comparison against existing', ()=>
   /CONDITION     : Proposed conditions/.test(blobText) && /PRE AND POST/.test(blobText) && /_Proposed_/.test(dlName));
 t('22 the choice is remembered for the next export', ()=>{
   dlName=null; w.exportTXT(); return /_Proposed_/.test(dlName);
 });

 // the preview follows the same choice
 w.setReportScope('both'); w.showReport();
 t('23 the report preview shows the chosen scope', ()=>
   /CONDITION     : Existing conditions/.test(d.getElementById('report-panel').textContent) &&
   /CONDITION     : Proposed conditions/.test(d.getElementById('report-panel').textContent));

 // PDF, against a recording stand in for jsPDF
 w.jspdf={jsPDF:FakePDF};
 // jsdom cannot draw a canvas, so record which hydrograph each section asked for
 const peaks=[]; const realPNG=w.hydrographPNG;
 w.hydrographPNG=h=>{ peaks.push(h?Math.max.apply(null,h.points.map(p=>p.Q)):null); return 'data:image/png;base64,AA'; };
 w.exportPDF('both');
 w.hydrographPNG=realPNG;
 const L=FakePDF.last;
 t('24 the PDF has a section for each condition and the comparison', ()=>
   L && L.text.indexOf('EXISTING CONDITIONS')>=0 && L.text.indexOf('PROPOSED CONDITIONS')>=0 &&
   L.text.some(s=>/PRE AND POST DEVELOPMENT/.test(s)) && /Existing_and_Proposed/.test(L.saved));
 t('25 each condition gets its own hydrograph', ()=>
   L.images===2 && peaks.length===2 && Math.abs(peaks[0]-0.40)<0.02 && Math.abs(peaks[1]-1.31)<0.02);
 t('26 the project block is printed once', ()=>L.text.filter(s=>s==='PROJECT').length===1);
 t('27 the PDF leaves the active condition alone', ()=>w.appState.activeScenario==='proposed' && Math.abs(q2()-1.31)<0.01);

 // ── a project with only existing conditions is not asked anything
 w.newProject();
 t('28 a new project goes back to the setup cards and a single condition', ()=>
   vis('v-welcome') && Object.keys(w.appState.scenarios).length===1 && /\+ Proposed/.test(d.getElementById('seg-proposed').textContent));
 t('29 existing hydrology is untouched', ()=>{
   const h=w.genHydro(10,0.6,20,34.3,[0.332,0.476,0.576,0.790,1.119,1.518,1.815,4.108]);
   return h.N===36&&h.vol===49.30&&h.Tp===245;
 });
 t('30 no runtime errors beyond the jsdom limits', ()=>
   errs.filter(e=>!/getContext|navigation|Not implemented/.test(e)).length===0);

 console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
 console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
 errs.filter(e=>!/getContext|navigation|Not implemented/.test(e)).slice(0,3).forEach(e=>console.log('  ERR '+e));
 process.exit(fail.length?1:0);
},7000);
