// Anonymous accounts, cloud save, email link upgrade. Firebase is faked,
// but the fake enforces the 1 MiB document limit and the per user rule.
const { JSDOM, VirtualConsole } = require('jsdom');
const fs=require('fs');
const makeFake=require('./fake-firebase.js');
const html=fs.readFileSync('../public/index.html','utf8');
const CSV =fs.readFileSync('../samples/PF_Depth_English_PDS.csv','utf8');
const pass=[],fail=[];
const t=(n,f)=>{try{f()?pass.push(n):fail.push(n);}catch(e){fail.push(n+' -> '+e.message);}};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const CFG={apiKey:'test-key',authDomain:'hr.firebaseapp.com',projectId:'hydrorational-test'};

function boot(url, fake){
  const errs=[]; const vc=new VirtualConsole();
  vc.on('jsdomError',e=>errs.push(e.detail?e.detail.message:e.message));
  const dom=new JSDOM(html,{runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,
    url, virtualConsole:vc,
    beforeParse(win){
      win.firebase=fake.fb;
      win.fetch=(u)=>{
        if(/__\/firebase\/init\.json/.test(u))
          return Promise.resolve({ok:true,json:()=>Promise.resolve(CFG)});
        if(/\/api\/proxy$/.test(u))
          return Promise.resolve({ok:false,status:404,json:()=>Promise.resolve({})});
        return Promise.reject(new Error('offline'));
      };
    }});
  return {dom, errs};
}

(async ()=>{
 const fake=makeFake();
 const A=boot('https://hydrorational.web.app/', fake);
 await wait(6500);
 const w=A.dom.window, d=w.document;
 w.open=()=>null; w.confirm=()=>true;
 w.loadNOAAText(CSV,'noaa.csv');

 t('1 the page finds its Firebase config and starts cloud mode', ()=> w.CLOUD.ready===true);
 t('2 the visitor is signed in anonymously with no prompt', ()=>
   w.CLOUD.user && w.CLOUD.user.isAnonymous===true && /^anon/.test(w.CLOUD.user.uid));
 t('3 the account button reads Guest', ()=> d.getElementById('acct-btn').textContent==='Guest');

 // do some work
 w.curTool='outfall'; w.onDrawCreated({layer:w.L.marker([32.8260,-116.7720]),layerType:'marker'});
 const out=Object.keys(w.appState.nodes)[0];
 w.curTool='subcatchment';
 w.onDrawCreated({layer:w.L.polygon([[32.8300,-116.7780],[32.8305,-116.7740],[32.8270,-116.7735],[32.8265,-116.7775]]),layerType:'polygon'});
 const sc=Object.values(w.appState.subareas)[0]; sc.drainTo=out; w.recomputeNetwork();

 t('4 editing marks the project dirty for autosave', ()=> w.CLOUD.dirty===true);

 const ok1=await w.cloudSave({name:'Alpine Car Wash'});
 t('5 saving writes to the cloud', ()=> ok1===true && !!w.CLOUD.projectId);
 t('6 everything written sits inside this user\'s own space', ()=>
   fake.paths().length>0 && fake.paths().every(p=>p.startsWith('users/'+w.CLOUD.user.uid+'/')));
 t('7 the header records a summary for the project list', ()=>{
   const h=fake.store.get('users/'+w.CLOUD.user.uid+'/projects/'+w.CLOUD.projectId);
   return h && h.name==='Alpine Car Wash' && h.summary.subareas===1 && h.summary.nodes===1 && h.chunks>=1;
 });
 t('8 the dirty flag clears after saving', ()=> w.CLOUD.dirty===false);

 // a large survey must be chunked, since one document is capped at 1 MiB
 await new Promise(r=>w.terrainReady(r));
 const big=w.makeGrid({crs:'EPSG:2230',x0:6300000,y0:1840000,cell:1,ncols:900,nrows:900,name:'big survey.tif'});
 for(let i=0;i<big.z.length;i++) big.z[i]=1700+(i%900)*0.1+Math.floor(i/900)*0.07;
 big.id='tl-big'; big.kind='survey'; big.priority=2;
 w.appState.terrain.layers.push(big); w.appState.terrainPool[big.id]=big;
 const ok2=await w.cloudSave({});
 const hdr=fake.store.get('users/'+w.CLOUD.user.uid+'/projects/'+w.CLOUD.projectId);
 t('9 a project over the document limit still saves', ()=> ok2===true);
 t('10 it was split across several chunk documents', ()=> hdr.chunks>1 && hdr.bytes>1048576);
 t('11 every chunk is under the limit', ()=>{
   const pre='users/'+w.CLOUD.user.uid+'/projects/'+w.CLOUD.projectId+'/chunks/';
   const ch=fake.paths().filter(p=>p.startsWith(pre));
   return ch.length===hdr.chunks && ch.every(p=>JSON.stringify(fake.store.get(p)).length<1048576);
 });

 // shrink it again, leftovers must go
 w.appState.terrain.layers=w.appState.terrain.layers.filter(g=>g.id!=='tl-big');
 delete w.appState.terrainPool['tl-big'];
 await w.cloudSave({});
 const hdr2=fake.store.get('users/'+w.CLOUD.user.uid+'/projects/'+w.CLOUD.projectId);
 t('12 saving a smaller version removes the leftover chunks', ()=>{
   const pre='users/'+w.CLOUD.user.uid+'/projects/'+w.CLOUD.projectId+'/chunks/';
   return fake.paths().filter(p=>p.startsWith(pre)).length===hdr2.chunks && hdr2.chunks===1;
 });

 const list=await w.cloudList();
 t('13 the project list shows it', ()=> list.length===1 && list[0].name==='Alpine Car Wash');

 const pid=w.CLOUD.projectId;
 w.newProject();
 t('14 a new project clears the screen', ()=> Object.keys(w.appState.subareas).length===0);
 const ok3=await w.cloudOpen(pid);
 t('15 opening from the cloud restores the work', ()=>
   ok3===true && Object.keys(w.appState.subareas).length===1 &&
   Object.keys(w.appState.nodes).length===1);
 t('16 and the hydrology recomputes on the reopened project', ()=>{
   const s=Object.values(w.appState.subareas)[0];
   return s.Qp>0 && s.C>0;
 });

 // reassembly check: tampered chunk must be caught, not silently loaded
 const pre='users/'+w.CLOUD.user.uid+'/projects/'+pid+'/chunks/0';
 const good=fake.store.get(pre);
 fake.store.set(pre,{i:0,data:good.data.slice(0,-40)});
 const bad=await w.cloudOpen(pid);
 t('17 a corrupted project is refused rather than half loaded', ()=> bad===false);
 fake.store.set(pre,good);

 await w.cloudRename(pid,'Alpine Car Wash, revised');
 t('18 rename updates the list', ()=>
   fake.store.get('users/'+w.CLOUD.user.uid+'/projects/'+pid).name==='Alpine Car Wash, revised');

 // the upgrade: send a link, then open it in this browser
 d.getElementById('acct-email').value='kiran@example.com';
 const sentOk=await w.sendEmailLink();
 t('19 the sign-in link is sent to the address given', ()=>
   sentOk===true && fake.sent.length===1 && fake.sent[0].email==='kiran@example.com');
 t('20 the link returns to this page', ()=>
   fake.sent[0].settings.url==='https://hydrorational.web.app/' && fake.sent[0].settings.handleCodeInApp===true);
 t('21 a bad address is refused before anything is sent', ()=>{
   d.getElementById('acct-email').value='not an email';
   w.sendEmailLink();
   return fake.sent.length===1;
 });
 const anonUid=w.CLOUD.user.uid;
 const saveKey=w.localStorage.getItem('hr_emailForSignIn');
 t('22 the address is remembered for when the link comes back', ()=> saveKey==='kiran@example.com');

 w.history.replaceState(null,'','/?mode=signIn&oobCode=abc123&apiKey=test-key');
 const linked=await w.completeEmailLinkIfPresent();
 t('23 opening the link upgrades the same account', ()=>
   linked===true && w.CLOUD.user.uid===anonUid && w.CLOUD.user.isAnonymous===false &&
   w.CLOUD.user.email==='kiran@example.com');
 const after=await w.cloudList();
 t('25 the project list survives the upgrade', ()=> after.length===1);
 t('26 the link is cleaned out of the address bar', ()=> !/oobCode/.test(w.location.href));
 t('27 the remembered address is cleared once used', ()=> w.localStorage.getItem('hr_emailForSignIn')===null);
 t('28 the account button shows the signed in person', ()=>
   d.getElementById('acct-btn').textContent!=='Guest' && d.getElementById('acct-btn').textContent.length>0);

 // a second browser, where the email already has an account
 const fake2=makeFake();
 fake2.emailOwners['kiran@example.com']='user-existing';
 fake2.users['user-existing']={uid:'user-existing',isAnonymous:false,email:'kiran@example.com',
   linkWithCredential(){return Promise.reject(Object.assign(new Error('x'),{code:'auth/credential-already-in-use'}));}};
 const B=boot('https://hydrorational.web.app/', fake2);
 await wait(6500);
 const w2=B.dom.window;
 w2.open=()=>null; w2.confirm=()=>true;
 w2.curTool='outfall'; w2.onDrawCreated({layer:w2.L.marker([32.82,-116.77]),layerType:'marker'});
 await w2.cloudSave({name:'Drawn on the laptop'});
 w2.localStorage.setItem('hr_emailForSignIn','kiran@example.com');
 w2.history.replaceState(null,'','/?mode=signIn&oobCode=def456&apiKey=test-key');
 const merged=await w2.completeEmailLinkIfPresent();
 t('29 an email that already has an account signs into it', ()=>
   w2.CLOUD.user.uid==='user-existing');
 t('30 and brings this browser\'s projects across', ()=>{
   const hs=fake2.paths().filter(p=>/^users\/user-existing\/projects\/[^/]+$/.test(p));
   return merged===1 && hs.some(p=>/from this browser/.test(fake2.store.get(p).name));
 });

 // isolation: one user cannot read another's work
 const snoop=w.CLOUD.db.collection('users').doc('someone-else').collection('projects').get();
 let blocked=false; await snoop.catch(e=>{ blocked=/permission-denied/.test(e.message); });
 t('31 reading another user\'s projects is refused', ()=> blocked===true);

 await w.cloudDelete(pid);
 t('32 delete removes the header and every chunk', ()=>
   fake.paths().filter(p=>p.includes('/projects/'+pid)).length===0);

 // local file: everything must stay off
 const fake3=makeFake();
 const C=boot('file:///C:/hydrorational/index.html', fake3);
 await wait(6000);
 const w3=C.dom.window;
 t('33 opened as a local file, cloud mode stays off', ()=> w3.CLOUD.ready===false);
 t('34 and the button says so rather than pretending', ()=>
   w3.document.getElementById('acct-btn').textContent==='Local');
 t('35 the local file still saves by download', ()=>{
   let got=null; w3.URL.createObjectURL=()=>'blob:x'; w3.URL.revokeObjectURL=()=>{};
   const RB=w3.Blob; w3.Blob=function(p,o){got=String(p[0]);return new RB(p,o);};
   w3.saveProject();
   return got && JSON.parse(got).app==='HydroRational';
 });
 const r3=await w3.cloudSave({});
 t('36 a cloud save attempt from a file is declined cleanly', ()=> r3===false);

 t('37 existing hydrology is untouched', ()=>{
   const h=w.genHydro(10,0.6,20,34.3,[0.332,0.476,0.576,0.790,1.119,1.518,1.815,4.108]);
   return h.N===36&&h.vol===49.30&&h.Tp===245;
 });
 const allErrs=[...A.errs,...B.errs,...C.errs].filter(e=>!/getContext|navigation|Not implemented/.test(e));
 t('38 no runtime errors beyond the jsdom limits', ()=> allErrs.length===0);

 console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
 console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
 allErrs.slice(0,4).forEach(e=>console.log('  ERR '+e));
 process.exit(fail.length?1:0);
})();
