// DXF export, checked by parsing the file back rather than trusting the writer.
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

// minimal group code reader
function parseDXF(txt){
  const lines=txt.split('\n');
  const pairs=[];
  for(let i=0;i+1<lines.length;i+=2) pairs.push([parseInt(lines[i],10), lines[i+1]]);
  const sections={}, entities=[], layers=[];
  let sec=null, ent=null;
  for(const [c,v] of pairs){
    if(c===0 && v==='SECTION'){ sec='?'; continue; }
    if(c===2 && sec==='?'){ sec=v; sections[v]=[]; continue; }
    if(c===0 && v==='ENDSEC'){ if(ent){entities.push(ent);ent=null;} sec=null; continue; }
    if(sec==='TABLES' && c===0 && v==='LAYER'){ layers.push({}); continue; }
    if(sec==='TABLES' && layers.length && c===2){ layers[layers.length-1].name=v; continue; }
    if(sec==='TABLES' && layers.length && c===62){ layers[layers.length-1].color=parseInt(v,10); continue; }
    if(sec==='ENTITIES'){
      if(c===0){
        if(v==='VERTEX'){ ent.verts.push({}); continue; }
        if(v==='SEQEND') continue;
        if(ent) entities.push(ent);
        ent={type:v, verts:[], props:{}};
        continue;
      }
      if(!ent) continue;
      if(ent.type==='POLYLINE' && ent.verts.length){
        const vt=ent.verts[ent.verts.length-1];
        if(c===10) vt.x=parseFloat(v); if(c===20) vt.y=parseFloat(v);
      }
      ent.props[c]=v;
    }
    if(sec==='HEADER'){ sections.HEADER.push([c,v]); }
  }
  if(ent) entities.push(ent);
  return {sections, entities, layers};
}

setTimeout(async ()=>{
 const w=dom.window,d=dom.window.document;
 w.open=()=>null; w.confirm=()=>true; w.fetch=()=>Promise.reject(new Error('offline'));
 let saved=null,name=null;
 w.URL.createObjectURL=()=>'blob:x'; w.URL.revokeObjectURL=()=>{};
 const RB=w.Blob; w.Blob=function(p,o){saved=String(p[0]);return new RB(p,o);};
 const realCreate=d.createElement.bind(d);
 d.createElement=function(tag){const el=realCreate(tag); if(tag==='a') el.click=function(){name=el.download;}; return el;};
 await new Promise(r=>w.terrainReady(r));
 w.loadNOAAText(CSV,'noaa.csv');

 // a small network
 w.curTool='junction'; w.onDrawCreated({layer:w.L.marker([32.8280,-116.7750]),layerType:'marker'});
 w.curTool='outfall';  w.onDrawCreated({layer:w.L.marker([32.8260,-116.7720]),layerType:'marker'});
 const ids=Object.keys(w.appState.nodes);
 w.setNodeElev(w.appState.nodes[ids[0]],1800,'entered');
 w.setNodeElev(w.appState.nodes[ids[1]],1780,'entered');
 w.curTool='link';
 w.onDrawCreated({layer:w.L.polyline([[32.8280,-116.7750],[32.8260,-116.7720]]),layerType:'polyline'});
 w.curTool='subcatchment';
 w.onDrawCreated({layer:w.L.polygon([[32.8300,-116.7780],[32.8305,-116.7740],[32.8270,-116.7735],[32.8265,-116.7775]]),layerType:'polygon'});
 const sc=Object.values(w.appState.subareas)[0];
 sc.drainTo=ids[1]; w.recomputeNetwork();

 let out=null, parsed=null;
 t('1 the drawing builds', ()=>{ out=w.buildDXF({}); return out && out.text.length>500; });
 t('2 it parses as a well formed DXF', ()=>{
   parsed=parseDXF(out.text);
   return /^0\nSECTION/.test(out.text) && /0\nEOF\n$/.test(out.text) &&
          parsed.sections.HEADER && parsed.sections.TABLES!==undefined;
 });
 t('3 it declares R12, which every CAD package reads', ()=>{
   const h=parsed.sections.HEADER.map(p=>p[1]);
   return h.indexOf('AC1009')>=0;
 });
 t('4 the layers are created with distinct names', ()=>{
   const names=parsed.layers.map(l=>l.name);
   return names.indexOf('HR-SUBAREA')>=0 && names.indexOf('HR-FLOWPATH')>=0 &&
          names.indexOf('HR-NODE')>=0 && names.indexOf('HR-TEXT')>=0 &&
          new Set(names).size===names.length;
 });
 t('5 one closed polyline per subarea', ()=>{
   const p=parsed.entities.filter(e=>e.type==='POLYLINE' && e.props[8]==='HR-SUBAREA');
   return p.length===1 && p[0].props[70]==='1' && p[0].verts.length===4;
 });
 t('6 flow paths come out open, not closed', ()=>{
   const p=parsed.entities.filter(e=>e.type==='POLYLINE' && e.props[8]==='HR-FLOWPATH');
   return p.length===1 && p[0].props[70]==='0' && p[0].verts.length===2;
 });
 t('7 a circle per node', ()=>
   parsed.entities.filter(e=>e.type==='CIRCLE' && e.props[8]==='HR-NODE').length===2);
 t('8 labels carry the numbers a reviewer looks for', ()=>{
   const txt=parsed.entities.filter(e=>e.type==='TEXT').map(e=>e.props[1]).join(' | ');
   return /Subarea A/.test(txt) && /ac/.test(txt) && /C=/.test(txt) &&
          /L=/.test(txt) && /Tt=/.test(txt) && /1800\.00/.test(txt);
 });
 t('9 coordinates are State Plane feet, not degrees', ()=>{
   const p=parsed.entities.filter(e=>e.type==='POLYLINE' && e.props[8]==='HR-SUBAREA')[0];
   const v=p.verts[0];
   return v.x>6000000 && v.x<7000000 && v.y>1000000 && v.y<2500000;
 });
 t('10 a vertex round trips back to the right ground position', ()=>{
   const p=parsed.entities.filter(e=>e.type==='POLYLINE' && e.props[8]==='HR-SUBAREA')[0];
   const v=p.verts[0];
   const ll=w.toLatLngXY(v.x,v.y);
   return Math.abs(ll[0]-32.8300)<1e-5 && Math.abs(ll[1]+116.7780)<1e-5;
 });
 t('11 the drawing extents bracket the geometry', ()=>{
   const e=out.extents;
   const p=parsed.entities.filter(e2=>e2.type==='POLYLINE')[0];
   return p.verts.every(v=>v.x>=e.xmin-1 && v.x<=e.xmax+1 && v.y>=e.ymin-1 && v.y<=e.ymax+1);
 });
 t('12 every vertex count is real, none are empty polylines', ()=>
   parsed.entities.filter(e=>e.type==='POLYLINE').every(e=>e.verts.length>=2));
 t('13 counts are reported back to the user', ()=>{
   const c=out.counts;
   return c.subareas===1 && c.flowpaths===1 && c.nodes===2 && c.labels===4;
 });
 t('14 contours are included only when they are drawn', ()=>{
   const without=w.buildDXF({contours:true});
   return without.counts.contours===0;
 });
 t('15 exporting downloads a .dxf named after the project', ()=>{
   d.getElementById('f-pname').value='Alpine Car Wash';
   w.exportDXF();
   return true;
 });
 setTimeout(()=>{
  t('16 the download carries the drawing and the right name', ()=>
    /_drainage_map\.dxf$/.test(name||'') && /Alpine_Car_Wash/.test(name||'') &&
    /HR-SUBAREA/.test(saved||''));
  t('17 an empty project is refused rather than writing an empty file', ()=>{
    const before=name;
    w.newProject();
    w.exportDXF();
    return name===before;
  });
  t('18 existing hydrology is untouched', ()=>{
    const h=w.genHydro(10,0.6,20,34.3,[0.332,0.476,0.576,0.790,1.119,1.518,1.815,4.108]);
    return h.N===36&&h.vol===49.30&&h.Tp===245;
  });
  t('19 no runtime errors beyond the jsdom limits', ()=>
    errs.filter(e=>!/getContext|navigation|Not implemented/.test(e)).length===0);

  console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
  console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
  errs.filter(e=>!/getContext|navigation|Not implemented/.test(e)).slice(0,3).forEach(e=>console.log('  ERR '+e));
  process.exit(fail.length?1:0);
 },400);
},6500);
