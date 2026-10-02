// CAD drawings and lidar loaded through the app: the file picker, the
// layer chooser, the TIN, and the checks on units, CRS and location.
// The ground in every fixture is a known plane, so the surface the app
// builds can be checked to the hundredth of a foot.
const { JSDOM, VirtualConsole } = require('jsdom');
const fs=require('fs');
const F=require('./lib/fixtures-cad-lidar.js');
const html=fs.readFileSync('../public/index.html','utf8');
const errs=[]; const vc=new VirtualConsole();
vc.on('jsdomError',e=>errs.push(e.detail?e.detail.message:e.message));
const dom=new JSDOM(html,{runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,
  url:'https://local.test/',virtualConsole:vc});
const pass=[],fail=[];
const t=(n,f)=>{try{f()?pass.push(n):fail.push(n);}catch(e){fail.push(n+' -> '+e.message);}};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async (fn,ms)=>{ const t0=Date.now(); while(!fn() && Date.now()-t0<(ms||8000)) await wait(25); return fn(); };

setTimeout(async ()=>{
 const w=dom.window,d=dom.window.document;
 w.open=()=>null; w.confirm=()=>true;
 let toast=''; const T0=w.T; w.T=m=>{ toast=m; T0(m); };
 await new Promise(r=>w.terrainReady(ok=>r(ok)));
 const layers=()=>w.appState.terrain.layers;
 const last=()=>layers()[layers().length-1];
 const fileOf=(name,content)=>new w.File([content],name);

 // max departure of the built grid from the plane, over cells that have data
 function planeError(g){
   let worst=0,n=0;
   for(let r=0;r<g.nrows;r++) for(let c=0;c<g.ncols;c++){
     const v=g.z[r*g.ncols+c]; if(isNaN(v)) continue;
     const p=w.cellCentre(g,r,c); worst=Math.max(worst,Math.abs(v-F.PLANE(p.x,p.y))); n++;
   }
   return {worst,n};
 }

 t('1 the surface file picker is connected to the reader', ()=>{
   let got=null; const h=w.handleTerrainFile; w.handleTerrainFile=f=>{ got=f; };
   const inp=d.getElementById('terrain-file-input');
   Object.defineProperty(inp,'files',{value:[fileOf('x.dxf','0')],configurable:true});
   inp.dispatchEvent(new w.Event('change'));
   w.handleTerrainFile=h; delete inp.files;
   return got && got.name==='x.dxf';
 });
 t('2 the picker accepts DXF, LAS and LAZ', ()=>/\.dxf,\.las,\.laz/.test(d.getElementById('terrain-file-input').accept));

 // ── DXF ──
 w.handleTerrainFile(fileOf('topo.dxf',F.topoDXF()));
 await until(()=>d.getElementById('dxf-pick').style.display==='block');
 const boxes=()=>[...d.querySelectorAll('#dxf-pick .dxf-lyr')];
 t('3 a drawing opens the layer chooser rather than loading blind', ()=>
   d.getElementById('dxf-pick').style.display==='block' && boxes().length===7 && layers().length===0);
 t('4 the storm drain layer starts unticked, ground layers ticked', ()=>{
   const b=Object.fromEntries(boxes().map(x=>[x.value,x.checked]));
   return b['C-STRM-PIPE']===false && b['C-TOPO-MAJR']===true && b['C-TOPO-BRKL']===true;
 });
 t('5 the chooser reports the flat linework it ignored', ()=>/1 flat 2D objects were ignored/.test(d.getElementById('dxf-pick').textContent));
 w.buildDXFSurface(); await until(()=>layers().length===1);
 const gD=last();
 t('6 the surface is built from the ticked layers', ()=>gD && gD.kind==='dxf' && /6 layers/.test(gD.name) &&
   d.getElementById('dxf-pick').style.display==='none');
 t('7 the TIN reproduces the plane the contours were cut from', ()=>{
   const e=planeError(gD); return e.n>1000 && e.worst<0.02;
 });
 t('8 the pipe inverts did not cut a trench', ()=>{
   const v=w.gridSample(gD,F.X0+200,F.Y0+210);
   return isFinite(v) && Math.abs(v-F.PLANE(F.X0+200,F.Y0+210))<0.02;
 });
 t('9 the layer records its triangulation', ()=>gD.tin && gD.tin.points>100 && gD.tin.triangles>100);
 t('10 the drawing lands in San Diego County without a warning', ()=>!/outside San Diego County/.test(toast) &&
   gD.importNotes.indexOf('outside San Diego County')<0);
 t('11 the composite now reads the drawing on the map', ()=>{
   const ll=w.toLatLngXY(F.X0+150,F.Y0+250); const v=w.terrainSampleLatLng(ll[0],ll[1]);
   return Math.abs(v-F.PLANE(F.X0+150,F.Y0+250))<0.1;
 });

 // ticking the pipe in proves the chooser matters
 w.handleTerrainFile(fileOf('topo2.dxf',F.topoDXF()));
 await until(()=>d.getElementById('dxf-pick').style.display==='block');
 boxes().forEach(b=>{ b.checked = b.value==='C-STRM-PIPE' || b.value==='C-TOPO-MAJR'; });
 w.buildDXFSurface(); await until(()=>layers().length===2);
 t('12 with the pipe layer ticked the surface dips along the pipe', ()=>{
   const v=w.gridSample(last(),F.X0+200,F.Y0+210); return v<F.PLANE(F.X0+200,F.Y0+210)-2;
 });
 w.removeTerrainLayer(last().id);

 w.handleTerrainFile(fileOf('flat.dxf','0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nPROP\n10\n1\n20\n2\n30\n0\n11\n5\n21\n6\n31\n0\n0\nENDSEC\n0\nEOF\n'));
 await until(()=>/No elevations/.test(toast));
 t('13 a drawing with nothing but 2D linework says why it cannot help', ()=>/No elevations in flat\.dxf/.test(toast) &&
   d.getElementById('dxf-pick').style.display==='none');
 w.handleTerrainFile(fileOf('bin.dxf','AutoCAD Binary DXF\r\n\x1a\x00junk'));
 await until(()=>/binary DXF/.test(toast));
 t('14 a binary DXF gets a way forward, not an error', ()=>/Save it from CAD as ASCII DXF/.test(toast));
 w.handleTerrainFile(fileOf('metric.dxf',F.topoDXF({insunits:6})));
 await until(()=>d.getElementById('dxf-pick').style.display==='block');
 t('15 a drawing in metres against a feet setting is flagged before building', ()=>
   /declares m but the panel says feet/.test(d.getElementById('dxf-pick').textContent));
 w.cancelDXF();
 t('16 cancel clears the chooser and loads nothing', ()=>d.getElementById('dxf-pick').style.display==='none' &&
   !w.appState.dxfPending && layers().length===1);

 // ── LAS ──
 const lasFile=(name,o)=>fileOf(name,F.makeLAS(o).buf);
 w.handleTerrainFile(lasFile('ground.las',{fmt:6,epsg:2230,vcode:9003}));
 await until(()=>layers().length===2);
 const gL=last();
 t('17 lidar ground becomes a surface on the plane', ()=>{
   const e=planeError(gL); return gL.kind==='las' && e.n>500 && e.worst<0.02;
 });
 t('18 the building is not in the ground surface', ()=>{
   const v=w.gridSample(gL,F.X0+130,F.Y0+130); return Math.abs(v-F.PLANE(F.X0+130,F.Y0+130))<0.05;
 });
 t('19 the label counts ground points, not every return', ()=>/ground points\)/.test(gL.name));
 w.removeTerrainLayer(gL.id);

 w.handleTerrainFile(lasFile('raw.las',{fmt:1,unclassified:true}));
 await until(()=>layers().length===2);
 t('20 an unclassified cloud loads with the warning that buildings are in it', ()=>
   /no ground class in this file/.test(toast) && w.gridSample(last(),F.X0+130,F.Y0+130)>F.PLANE(F.X0+130,F.Y0+130)+20);
 w.removeTerrainLayer(last().id);

 // a metric UTM tile, declared in the file, read against a feet panel
 const utmWkt='COMPD_CS["x",PROJCS["NAD83(2011) / UTM zone 11N",GEOGCS["NAD83(2011)",DATUM["d",SPHEROID["GRS 1980",6378137,298.257222101]],AUTHORITY["EPSG","6318"]],PROJECTION["Transverse_Mercator"],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AUTHORITY["EPSG","6340"]],VERT_CS["NAVD88 height",VERT_DATUM["v",2005],UNIT["metre",1,AUTHORITY["EPSG","9001"]]]]';
 // build a small metric cloud at the same ground as the plane, in UTM metres
 const P4=w.proj4;
 const base=F.makeLAS({fmt:1}).pts.filter(p=>p[3]===2);
 const utmPts=base.map(p=>{ const q=P4('EPSG:2230','EPSG:6340',[p[0],p[1]]); return [q[0],q[1],p[2]/3.2808333333333,2]; });
 const R=F.makeLAS({fmt:1,wkt:utmWkt});
 // rewrite the points of R in UTM
 const dv=new DataView(R.buf), hdr=new DataView(R.buf,0,227);
 const off=hdr.getUint32(96,true); const ox=utmPts[0][0], oy=utmPts[0][1];
 dv.setFloat64(155,ox,true); dv.setFloat64(163,oy,true); dv.setFloat64(171,0,true);
 [0.001,0.001,0.001].forEach((v,i)=>dv.setFloat64(131+8*i,v,true));
 dv.setUint32(107,utmPts.length,true);
 utmPts.forEach((p,k)=>{ const o=off+k*28;
   dv.setInt32(o,Math.round((p[0]-ox)/0.001),true); dv.setInt32(o+4,Math.round((p[1]-oy)/0.001),true);
   dv.setInt32(o+8,Math.round(p[2]/0.001),true); dv.setUint8(o+15,2); });
 w.handleTerrainFile(fileOf('utm.las',R.buf.slice(0,off+utmPts.length*28)));
 await until(()=>layers().length===2);
 t('21 a UTM tile in metres is read in its own CRS and converted to feet', ()=>{
   const g=last(); return g.crs==='EPSG:6340' && /CRS EPSG:6340 from the file/.test(toast) &&
     /elevations in metres per the file/.test(toast);
 });
 t('22 and the composite reads the same ground as the feet surface', ()=>{
   const ll=w.toLatLngXY(F.X0+150,F.Y0+150); const v=w.terrainSampleLatLng(ll[0],ll[1]);
   return Math.abs(v-F.PLANE(F.X0+150,F.Y0+150))<0.15;
 });
 t('23 the panel shows the cell in metres for a metric grid', ()=>/at [\d.]+ m, EPSG:6340/.test(d.getElementById('terrain-items').textContent));
 w.removeTerrainLayer(last().id);

 w.handleTerrainFile(lasFile('tile.laz',{fmt:1}));
 await until(()=>/compressed LAZ/.test(toast));
 t('24 LAZ is refused with the fix', ()=>/Decompress it to LAS first/.test(toast) && layers().length===1);
 w.handleTerrainFile(lasFile('mislabelled.las',{fmt:1,laz:true}));
 await until(()=>/mislabelled\.las is compressed LAZ/.test(toast));
 t('25 a compressed file named .las is refused too', ()=>layers().length===1);

 // a drawing in local coordinates lands in the ocean
 // shift every x and y to small local numbers, as an unreferenced drawing has
 const ln=F.topoDXF().split('\n');
 for(let i=0;i+1<ln.length;i+=2){ const c=+ln[i];
   if(c>=10&&c<=13&&Math.abs(+ln[i+1])>1000) ln[i+1]=String(Math.sign(+ln[i+1])*(Math.abs(+ln[i+1])-F.X0+5000));
   if(c>=20&&c<=23&&+ln[i+1]>1000) ln[i+1]=String(+ln[i+1]-F.Y0+5000); }
 const local=ln.join('\n');
 w.handleTerrainFile(fileOf('local.dxf',local));
 await until(()=>d.getElementById('dxf-pick').style.display==='block');
 w.buildDXFSurface(); await until(()=>layers().length===2);
 t('26 a drawing in local coordinates is loaded with a location warning', ()=>
   /outside San Diego County/.test(toast) && last().importNotes.indexOf('outside San Diego County')>=0);
 w.removeTerrainLayer(last().id);

 // ── contours out, and back in ──
 w.appState.terrain.contourInterval=2; w.toggleContours(true);
 const out=w.buildDXF({contours:true});
 const back=w.parseDXFTerrain(out.text);
 t('27 exported contours carry their elevation', ()=>{
   const c=back.layers['HR-CONTOUR']; return c && c.count>50 && c.zmin>=490 && c.zmax<=520 && back.skippedFlat===0;
 });
 t('28 exported contours read back onto the surface they came from', ()=>{
   const pts=back.points.filter(p=>p[3]==='HR-CONTOUR');
   const bad=pts.filter(p=>Math.abs(p[2]-F.PLANE(p[0],p[1]))>0.05).length;
   return pts.length>50 && bad/pts.length<0.02;
 });
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
