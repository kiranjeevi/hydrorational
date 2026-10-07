// Editing subarea boundaries: a clear way in, a clear way out, and the
// choice to keep or throw away the changes.
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

setTimeout(()=>{
 const w=dom.window,d=dom.window.document;
 w.open=()=>null; w.confirm=()=>true; w.fetch=()=>Promise.reject(new Error('offline'));
 let ran=0; const RA=w.runAnalysis; w.runAnalysis=function(){ ran++; };
 w.loadProjectText(PROJ,'p.json');
 const sc=()=>Object.values(w.appState.subareas)[0];
 const btn=()=>d.getElementById('btn-shape-edit');
 const bar=()=>d.getElementById('edit-bar');
 const editing=()=>!!w.appState.flow.editor;
 const key=k=>d.dispatchEvent(new w.KeyboardEvent('keydown',{key:k,bubbles:true}));
 const area0=sc().area, ring0=JSON.stringify(sc().layer.getLatLngs()[0]);
 // pull the first vertex out by about 30 ft, as a drag would
 const stretch=()=>{ const ll=sc().layer.getLatLngs()[0].map(p=>w.L.latLng(p.lat,p.lng));
   ll[0]=w.L.latLng(ll[0].lat+0.0001,ll[0].lng-0.0001); sc().layer.setLatLngs([ll]); };

 btn().click();
 t('1 the button starts editing and then reads as the way out', ()=>
   editing() && /Done editing/.test(btn().textContent) && btn().classList.contains('btn-p'));
 t('2 a bar on the map offers Done and Cancel', ()=>
   bar() && bar().style.display!=='none' && /Done/.test(bar().textContent) && /Cancel/.test(bar().textContent));
 t('3 the map hint no longer points at a cancel button that is not there', ()=>
   !/Click cancel/i.test(w.L.drawLocal.edit.handlers.edit.tooltip.text) &&
   /Done|Enter/.test(w.L.drawLocal.edit.handlers.edit.tooltip.text));
 t('4 only subarea boundaries are editable, not nodes or flow paths', ()=>{
   const fp=Object.values(w.appState.flowpaths)[0], nd=Object.values(w.appState.nodes)[0];
   return sc().layer.editing.enabled() && !(fp.layer.editing && fp.layer.editing.enabled()) &&
          !(nd.marker.dragging && nd.marker.dragging.enabled());
 });
 t('5 double click does not zoom while editing', ()=>!w.map.doubleClickZoom.enabled());

 stretch(); btn().click();
 t('6 pressing the button again keeps the edit and updates the area', ()=>
   !editing() && sc().area>area0 && sc().prov.geometry==='edited' && /Edit boundaries/.test(btn().textContent) &&
   bar().style.display==='none' && w.map.doubleClickZoom.enabled());
 const area1=sc().area, ring1=JSON.stringify(sc().layer.getLatLngs()[0]);

 btn().click(); stretch(); d.getElementById('edit-cancel').click();
 t('7 Cancel puts the boundary and the area back', ()=>
   !editing() && JSON.stringify(sc().layer.getLatLngs()[0])===ring1 && sc().area===area1);

 btn().click(); stretch(); key('Escape');
 t('8 Esc cancels too', ()=>!editing() && JSON.stringify(sc().layer.getLatLngs()[0])===ring1);

 btn().click(); stretch(); ran=0; key('Enter');
 t('9 Enter finishes the edit instead of running the analysis', ()=>!editing() && ran===0 && sc().area>area1);
 const area2=sc().area;

 btn().click(); w.map.fire('dblclick',{latlng:w.map.getCenter()});
 t('10 double clicking the map finishes', ()=>!editing());
 btn().click(); w.map.fire('contextmenu',{latlng:w.map.getCenter(),originalEvent:{preventDefault(){}}});
 t('11 right clicking the map finishes', ()=>!editing());

 btn().click(); w.selectSubarea(sc().id); key('Delete');
 t('12 Delete while editing does not remove the subarea', ()=>editing() && !!sc());
 stretch(); w.setTool('subcatchment');
 t('13 picking another tool finishes and keeps the edit', ()=>!editing() && sc().area>area2);
 w.setTool('select');

 t('14 the area after editing is the geodesic area of the boundary', ()=>
   Math.abs(sc().area - w.geodesicArea(sc().layer.getLatLngs()[0])/4046.86)<0.001);
 w.runAnalysis=RA;
 t('15 existing hydrology is untouched', ()=>{
   const h=w.genHydro(10,0.6,20,34.3,[0.332,0.476,0.576,0.790,1.119,1.518,1.815,4.108]);
   return h.N===36&&h.vol===49.30&&h.Tp===245;
 });
 t('16 no runtime errors beyond the jsdom limits', ()=>
   errs.filter(e=>!/getContext|navigation|Not implemented/.test(e)).length===0);
 t('17 the starting boundary was a real one', ()=>ring0.length>50 && area0>0);

 console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
 console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
 errs.filter(e=>!/getContext|navigation|Not implemented/.test(e)).slice(0,3).forEach(e=>console.log('  ERR '+e));
 process.exit(fail.length?1:0);
},7000);
