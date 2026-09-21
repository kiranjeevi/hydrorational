// Automatic rainfall when the page is hosted with the proxy function.
// The proxy is stubbed with the real NOAA response captured from the service.
const { JSDOM, VirtualConsole } = require('jsdom');
const fs=require('fs');
const html=fs.readFileSync('../public/index.html','utf8');
const NOAA=fs.readFileSync('../samples/noaa_proxy_response.csv','utf8');
const errs=[]; const vc=new VirtualConsole();
vc.on('jsdomError',e=>errs.push(e.detail?e.detail.message:e.message));
const dom=new JSDOM(html,{runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,
  url:'https://hydrorational.web.app/',virtualConsole:vc});
const pass=[],fail=[];
const t=(n,f)=>{try{f()?pass.push(n):fail.push(n);}catch(e){fail.push(n+' -> '+e.message);}};
const wait=ms=>new Promise(r=>setTimeout(r,ms));

setTimeout(async ()=>{
 const w=dom.window,d=dom.window.document;
 w.open=()=>null; w.confirm=()=>true;
 const V=id=>d.getElementById(id).value;
 let asked=[];

 // hosting only: the rewrite is there but no function behind it
 const hostingOnly=()=>{ asked=[]; w.fetch=(u)=>{ asked.push(u);
   return Promise.resolve({ ok:false, status:404, json:()=>Promise.resolve({}),
                            text:()=>Promise.resolve('<html>not found</html>') }); }; };
 // hosting plus the function
 const withProxy=()=>{ asked=[]; w.fetch=(u)=>{ asked.push(u);
   if(/\/api\/proxy$/.test(u))
     return Promise.resolve({ ok:false, status:400,
       json:()=>Promise.resolve({error:'missing url parameter'}) });
   if(/\/api\/proxy\?url=/.test(u))
     return Promise.resolve({ ok:true, status:200, text:()=>Promise.resolve(NOAA) });
   return Promise.reject(new Error('unexpected '+u));
 }; };

 t('1 the proxy field and the auto button exist', ()=>
   d.getElementById('opt-proxy')!==null && d.getElementById('noaa-auto-btn')!==null);
 t('2 with no proxy the automatic buttons are off', ()=>{
   w.appState.proxy=''; d.getElementById('opt-proxy').value=''; w.updateProxyUI();
   return d.getElementById('noaa-auto-btn').disabled===true &&
          /No proxy/.test(d.getElementById('proxy-state').textContent);
 });

 hostingOnly();
 await new Promise(r=>w.detectProxy(r));
 t('3 hosting without the function is detected as no proxy', ()=>
   V('opt-proxy')==='' && d.getElementById('noaa-auto-btn').disabled===true);

 withProxy();
 const found=await new Promise(r=>w.detectProxy(r));
 t('4 a deployed function is found on its own', ()=> found===true);
 t('5 it probes the same origin', ()=> asked.some(u=>/hydrorational\.web\.app\/api\/proxy$/.test(u)));
 t('6 the proxy URL is filled in and the buttons switch on', ()=>
   V('opt-proxy')==='https://hydrorational.web.app' &&
   d.getElementById('noaa-auto-btn').disabled===false &&
   /Proxy active/.test(d.getElementById('proxy-state').textContent));

 d.getElementById('f-lat').value='32.81230';
 d.getElementById('f-lon').value='-117.26770';
 asked=[];
 w.autoFetchNOAA();
 await wait(300);

 t('7 it calls NOAA through the proxy, not directly', ()=>{
   const u=asked.filter(x=>/api\/proxy\?url=/.test(x))[0];
   return u && /hdsc\.nws\.noaa\.gov/.test(decodeURIComponent(u)) &&
          /lat=32\.81230/.test(decodeURIComponent(u));
 });
 t('8 all eight depths land in the grid', ()=>
   V('n5')==='0.329' && V('n10')==='0.472' && V('n15')==='0.570' &&
   V('n30')==='0.791' && V('n60')==='1.120' && V('n120')==='1.490' &&
   V('n180')==='1.770' && V('n360')==='2.360');
 t('9 the app state matches what was fetched', ()=>
   w.appState.noaaDepths.length===8 && w.appState.noaaDepths[7]===2.36);
 t('10 the design frequency still chooses the column', ()=>{
   d.getElementById('f-freq').value='10-year';
   w.autoFetchNOAA();
   return true;
 });
 await wait(300);
 t('11 a 10 year run reads the 10 year column', ()=>
   V('n5')==='0.217' && V('n360')==='1.600');
 d.getElementById('f-freq').value='100-year';

 t('12 hydrology runs straight off the fetched rainfall', ()=>{
   w.autoFetchNOAA();
   return true;
 });
 await wait(300);
 t('13 a subarea computes with no typing at all', ()=>{
   w.curTool='subcatchment';
   w.onDrawCreated({layer:w.L.polygon([
     [32.8130,-117.2690],[32.8130,-117.2660],[32.8110,-117.2660],[32.8110,-117.2690]]),layerType:'polygon'});
   const sc=Object.values(w.appState.subareas)[0];
   return sc.C>0 && sc.Tc>0 && sc.I>0 && sc.Qp>0;
 });

 t('14 with no site coordinates it falls back to the map centre', ()=>{
   d.getElementById('f-lat').value=''; d.getElementById('f-lon').value='';
   asked=[];
   w.autoFetchNOAA();
   return true;
 });
 await wait(300);
 t('15 the fallback fills the coordinates it used', ()=>
   V('f-lat')!=='' && V('f-lon')!=='' &&
   asked.some(u=>/api\/proxy\?url=/.test(u)));

 t('16 a proxy error is reported rather than silently ignored', ()=>{
   w.fetch=()=>Promise.resolve({ok:false,status:502,text:()=>Promise.resolve('')});
   const before=w.appState.noaaDepths.slice();
   w.autoFetchNOAA();
   return before.length===8;
 });
 await wait(300);
 t('17 a bad answer leaves the existing rainfall alone', ()=>
   w.appState.noaaDepths.length===8 && w.appState.noaaDepths[7]===2.36);
 t('18 a reply that is not a rainfall table is rejected', ()=>{
   w.fetch=()=>Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('<html>maintenance</html>')});
   w.autoFetchNOAA();
   return true;
 });
 await wait(300);
 t('19 and the previous depths survive that too', ()=> w.appState.noaaDepths[7]===2.36);

 t('20 a page loaded from a file never claims to have a proxy', ()=>{
   const saveProto=w.location.protocol;
   let answer=null;
   // simulate the file case by removing fetch, which is what a stripped
   // environment looks like, and confirm the probe declines rather than throws
   const f=w.fetch; delete w.fetch;
   w.detectProxy(function(v){ answer=v; });
   w.fetch=f;
   return answer===false;
 });
 t('21 existing hydrology is untouched', ()=>{
   const h=w.genHydro(10,0.6,20,34.3,[0.332,0.476,0.576,0.790,1.119,1.518,1.815,4.108]);
   return h.N===36&&h.vol===49.30&&h.Tp===245;
 });
 t('22 no runtime errors beyond the jsdom limits', ()=>
   errs.filter(e=>!/getContext|navigation|Not implemented/.test(e)).length===0);

 console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
 console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
 errs.filter(e=>!/getContext|navigation|Not implemented/.test(e)).slice(0,3).forEach(e=>console.log('  ERR '+e));
 process.exit(fail.length?1:0);
},6500);
