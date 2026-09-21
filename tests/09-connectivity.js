// A drawn network is not a connected network. These checks cover the case
// where subareas exist but are not assigned to a downstream node.
const { JSDOM, VirtualConsole } = require('jsdom');
const fs=require('fs');
const html=fs.readFileSync('../public/index.html','utf8');
const proj=fs.readFileSync('../samples/unconnected_project.json','utf8');
const errs=[]; const vc=new VirtualConsole();
vc.on('jsdomError',e=>errs.push(e.detail?e.detail.message:e.message));
const dom=new JSDOM(html,{runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,
  url:'https://local.test/',virtualConsole:vc});
const pass=[],fail=[];
const t=(n,f)=>{try{f()?pass.push(n):fail.push(n);}catch(e){fail.push(n+' -> '+e.message);}};

setTimeout(()=>{
 const w=dom.window,d=dom.window.document;
 w.open=()=>null; w.confirm=()=>true; w.fetch=()=>Promise.reject(new Error('offline'));
 w.loadProjectText(proj,'p.json');
 const subs=()=>Object.values(w.appState.subareas);

 t('1 the file loads with subareas and nodes', ()=>
   subs().length===3 && Object.keys(w.appState.nodes).length===5);
 t('2 no subarea is connected, so no node has a stream', ()=>
   w.unconnectedSubareas().length===3 &&
   Object.keys(w.appState.nodes).every(id=>!w.nodeResult(id)));
 t('3 the layer tree warns and offers a fix', ()=>{
   const tx=d.getElementById('net-items').textContent;
   return /do not drain to a node/.test(tx) && /Connect to nearest node/.test(tx);
 });
 t('4 the report states why nothing confluenced', ()=>{
   const r=w.buildReport();
   return /NETWORK CONNECTIVITY NOTICE/.test(r) &&
          /NOT ASSIGNED TO A DOWNSTREAM NODE/.test(r) &&
          /Subarea A/.test(r) && /JUNCTION CONFLUENCE ANALYSIS/.test(r);
 });
 t('5 auto-connect assigns every subarea', ()=>{
   const n=w.autoConnectSubareas();
   return n===3 && w.unconnectedSubareas().length===0;
 });
 t('6 each subarea is attached to its nearest node', ()=>
   subs().every(s=>{
     const c=s.layer.getBounds().getCenter();
     const dists=Object.values(w.appState.nodes)
       .map(n=>({id:n.id,d:w.map.distance(c,n.latlng)})).sort((a,b)=>a.d-b.d);
     return s.drainTo===dists[0].id;
   }));
 t('7 flow now accumulates at the receiving nodes', ()=>{
   const hit=Object.keys(w.appState.nodes).filter(id=>w.nodeResult(id));
   return hit.length>0 && hit.some(id=>w.nodeResult(id).Q>0);
 });
 t('8 a node fed by two subareas runs the junction equation', ()=>{
   const s=subs();
   s[0].drainTo=s[1].drainTo='nd-4';
   w.recomputeNetwork();
   const r=w.nodeResult('nd-4');
   return r && r.streams.length>=2 && /junction equation|Note 2/.test(r.rule);
 });
 t('9 combined flow sits between the largest stream and the plain sum', ()=>{
   const r=w.nodeResult('nd-4');
   const sum=r.streams.reduce((a,x)=>a+x.Q,0);
   const max=r.streams.reduce((a,x)=>Math.max(a,x.Q),0);
   return r.Q>=max-1e-6 && r.Q<=sum+1e-6;
 });
 t('9b the node also picks up flow arriving through a flow path', ()=>{
   const r=w.nodeResult('nd-4');
   return r.streams.some(x=>x.kind==='upstream') && r.streams.some(x=>x.kind==='subarea');
 });
 t('10 the confluence block now appears in the report', ()=>{
   const r=w.buildReport();
   return /CONFLUENCE OF MINOR STREAMS/.test(r) &&
          /JUNCTION EQUATION, SECTION 3.4/.test(r) &&
          !/NETWORK CONNECTIVITY NOTICE/.test(r);
 });
 t('11 the warning clears once everything is connected', ()=>
   !/do not drain to a node/.test(d.getElementById('net-items').textContent));
 t('12 no trade name remains in the report or the page', ()=>
   html.indexOf('AES')===-1 && w.buildReport().indexOf('AES')===-1);
 t('13 zero runtime errors', ()=> errs.filter(e=>!/getContext|navigation/.test(e)).length===0);

 console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
 console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
 process.exit(fail.length?1:0);
},6000);
