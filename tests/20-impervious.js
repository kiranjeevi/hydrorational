// Percent impervious sampled from NLCD. The service is stubbed so the maths
// and the provenance are tested, not the network.
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
const wait=ms=>new Promise(r=>setTimeout(r,ms));

setTimeout(async ()=>{
 const w=dom.window,d=dom.window.document;
 w.open=()=>null; w.confirm=()=>true;
 w.loadNOAAText(CSV,'noaa.csv');

 let asked=[];
 const stub=(vals)=>{ asked=[];
   w.fetch=(u)=>{ asked.push(u);
     const m=/bbox=([-\d.]+),([-\d.]+)/.exec(u);
     const v=typeof vals==='function'?vals(+m[2],+m[1]):vals;
     return Promise.resolve({ json:()=>Promise.resolve(
       v===null?{features:[]}:{features:[{properties:{PALETTE_INDEX:v}}]}) });
   };
 };

 w.curTool='subcatchment';
 w.onDrawCreated({layer:w.L.polygon([
   [32.830,-116.778],[32.830,-116.772],[32.826,-116.772],[32.826,-116.778]]),layerType:'polygon'});
 const sc=Object.values(w.appState.subareas)[0];
 w.selectSubarea(sc.id);

 t('1 the panel offers the NLCD sampler', ()=>
   /Sample percent impervious from NLCD/.test(d.body.textContent));
 t('2 sample points fall inside the polygon', ()=>{
   const ring=sc.layer.getLatLngs()[0];
   const pts=w.samplePointsInPolygon(ring,36);
   return pts.length>25 && pts.every(p=>w.pointInRing(p[0],p[1],ring));
 });
 t('3 a point outside the polygon is rejected', ()=>{
   const ring=sc.layer.getLatLngs()[0];
   return !w.pointInRing(32.840,-116.775,ring) && w.pointInRing(32.828,-116.775,ring);
 });
 t('4 a very thin polygon still yields a sample', ()=>{
   const thin=[{lat:32.8300,lng:-116.7780},{lat:32.83001,lng:-116.7720},
               {lat:32.83002,lng:-116.7720},{lat:32.83001,lng:-116.7780}];
   return w.samplePointsInPolygon(thin,36).length>=1;
 });

 stub(55);
 w.imperviousForSubarea();
 await wait(500);
 t('5 a uniform surface returns that value', ()=> Math.abs(sc.imp-55)<0.01);
 t('6 it queries the impervious layer, one request per point', ()=>
   asked.length>25 && asked.every(u=>/NLCD_2021_Impervious_L48/.test(u) &&
                                     /GetFeatureInfo/.test(u)));
 t('7 the runoff coefficient follows the sampled value', ()=>{
   // C = 0.90 x 0.55 + 0.25 x 0.45 for soil B
   return Math.abs(sc.C-(0.9*0.55+0.25*0.45))<0.002;
 });
 t('8 provenance records that it was sampled, with the count', ()=>
   sc.prov.imp==='sampled' && /NLCD points/.test(sc.prov.impNote));
 t('9 the panel shows where the value came from', ()=>{
   w.selectSubarea(sc.id);
   return /Impervious from/.test(d.getElementById('sc-prov').textContent);
 });

 // a mixed surface: half paved, half open
 stub((lat,lng)=> lng < -116.775 ? 90 : 10);
 w.imperviousForSubarea();
 await wait(500);
 t('10 a mixed surface averages across the area', ()=> sc.imp>35 && sc.imp<65);
 t('11 the spread is reported, not hidden', ()=>
   /spread 3\d|spread 4\d/.test(sc.prov.impNote));

 stub(null);
 const before=sc.imp;
 w.imperviousForSubarea();
 await wait(400);
 t('12 an empty answer leaves the old value alone', ()=> sc.imp===before);

 w.fetch=()=>Promise.reject(new Error('offline'));
 w.imperviousForSubarea();
 await wait(400);
 t('13 a network failure does not corrupt the subarea', ()=> sc.imp===before && sc.C>0);

 t('14 typing over the sampled value marks it as mine', ()=>{
   d.getElementById('sc-imp').value='25';
   w.scChanged();
   return sc.imp===25 && sc.prov.imp==='manual';
 });
 t('15 the override survives save and open', ()=>{
   let saved=null; w.URL.createObjectURL=()=>'blob:x'; w.URL.revokeObjectURL=()=>{};
   const RB=w.Blob; w.Blob=function(p,o){saved=String(p[0]);return new RB(p,o);};
   w.saveProject();
   const j=JSON.parse(saved);
   return j.subareas[0].prov.imp==='manual' && j.subareas[0].imp===25;
 });
 t('16 existing hydrology is untouched', ()=>{
   const h=w.genHydro(10,0.6,20,34.3,[0.332,0.476,0.576,0.790,1.119,1.518,1.815,4.108]);
   return h.N===36&&h.vol===49.30&&h.Tp===245;
 });
 t('17 no runtime errors beyond the jsdom limits', ()=>
   errs.filter(e=>!/getContext|navigation|Not implemented/.test(e)).length===0);

  t('18 a typed percentage is no longer reverted by a recompute', ()=>{
   // this used to snap back to the land use default on the next recompute
   d.getElementById('sc-imp').value='33';
   w.scChanged();
   w.computeSubarea(sc); w.recomputeNetwork(); w.computeSubarea(sc);
   return sc.imp===33 && sc.prov.imp==='manual';
 });
 t('19 choosing a land use hands the percentage back to the table', ()=>{
   d.getElementById('sc-lu').value='8';          // General Commercial, 85 percent
   w.scChanged();
   return sc.imp===85 && sc.prov.imp==='default' &&
          d.getElementById('sc-imp').value==='85';
 });
 t('20 and it keeps following the table until taken over again', ()=>{
   d.getElementById('sc-lu').value='0';          // Natural, 0 percent
   w.scChanged();
   w.computeSubarea(sc);
   return sc.imp===0 && Math.abs(sc.C-0.25)<0.002;   // soil B pervious coefficient
 });

 t('21 zero percent impervious can actually be entered', ()=>{
   d.getElementById('sc-lu').value='4'; w.scChanged();
   d.getElementById('sc-imp').value='0'; w.scChanged();
   return sc.imp===0 && sc.prov.imp==='manual' && Math.abs(sc.C-0.25)<0.002;
 });
 t('22 a blank field falls back instead of becoming zero', ()=>{
   const before=sc.area;
   d.getElementById('sc-area').value=''; w.scChanged();
   return sc.area===before;
 });

console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
 console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
 errs.filter(e=>!/getContext|navigation|Not implemented/.test(e)).slice(0,3).forEach(e=>console.log('  ERR '+e));
 process.exit(fail.length?1:0);
},6500);
