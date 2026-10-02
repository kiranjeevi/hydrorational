// Reading elevations out of CAD drawings and lidar, against synthetic
// files whose ground is a known plane.
const T = require('../src/terrain-core.js');
const F = require('./lib/fixtures-cad-lidar.js');
const pass=[],fail=[];
const t=(n,f)=>{try{f()?pass.push(n):fail.push(n);}catch(e){fail.push(n+' -> '+e.message);}};
const near=(a,b,tol)=>Math.abs(a-b)<=(tol===undefined?1e-6:tol);
const onPlane=(pts,tol)=>pts.every(p=>near(p[2],F.PLANE(p[0],p[1]),tol===undefined?0.01:tol));

// ── DXF ──
const dxf=F.topoDXF();
const P=T.parseDXFTerrain(dxf);
t('1 DXF group codes pair up', ()=>{ const pr=T.dxfPairs('0\nSECTION\n2\nENTITIES\n'); return pr.length===2 && pr[1][0]===2 && pr[1][1]==='ENTITIES'; });
t('2 the declared drawing unit is read from $INSUNITS', ()=>P.insunits===2 && P.units==='ft' &&
  T.parseDXFTerrain(F.topoDXF({insunits:6})).units==='m');
t('3 LWPOLYLINE contours take their elevation from group 38', ()=>{
  const L=P.layers['C-TOPO-MAJR']; return L && L.entities===10 && L.zmin===494 && L.zmax===512;
});
t('4 every contour vertex lies on the plane it was cut from', ()=>
  onPlane(P.points.filter(p=>p[3]==='C-TOPO-MAJR'),0.002));
t('5 a 3D polyline keeps z per vertex', ()=>{
  const b=P.points.filter(p=>p[3]==='C-TOPO-BRKL'); return b.length===7 && onPlane(b);
});
t('6 a 2D polyline takes its elevation from the POLYLINE record', ()=>{
  const b=P.points.filter(p=>p[3]==='C-TOPO-MINR'); return b.length===2 && b.every(p=>p[2]===503) && onPlane(b,0.002);
});
t('7 POINT and 3DFACE are read, the repeated 4th corner dropped', ()=>
  P.points.filter(p=>p[3]==='V-TOPO-SPOT').length===2 &&
  P.points.filter(p=>p[3]==='C-TOPO-FACE').length===3 &&
  onPlane(P.points.filter(p=>/SPOT|FACE/.test(p[3]))));
t('8 a mirrored polyline (extrusion 0,0,-1) lands where it was drawn', ()=>{
  const m=P.points.filter(p=>p[3]==='C-TOPO-MIRR');
  return m.length===2 && m.every(p=>p[2]===505 && p[0]>F.X0) && onPlane(m,0.002);
});
t('9 flat 2D linework is skipped and counted, not read as sea level', ()=>
  P.skippedFlat===1 && !P.points.some(p=>p[3]==='V-PROP-LINE') && P.layers['V-PROP-LINE'].flat===1);
t('10 text is not read as an elevation', ()=>!P.points.some(p=>p[2]===999));
t('11 utility layers are left out of the default selection', ()=>{
  const d=T.dxfDefaultLayers(P);
  return d.indexOf('C-STRM-PIPE')<0 && d.indexOf('C-TOPO-MAJR')>=0 && d.indexOf('V-PROP-LINE')<0 && d.length===6;
});
t('12 points come back only for the layers chosen', ()=>{
  const pts=T.dxfPointsOnLayers(P,['C-TOPO-BRKL']); return pts.length===7 && pts[0].length===3;
});
t('13 densifying a contour keeps it flat and caps the segment', ()=>{
  const d=T.densifyLine([[0,0,10],[100,0,10]],25);
  return d.length===5 && d.every(p=>p[2]===10) && near(d[1][0],25);
});
t('14 densifying a breakline interpolates z', ()=>{
  const d=T.densifyLine([[0,0,10],[10,0,20]],5); return d.length===3 && near(d[1][2],15);
});
t('15 parse with maxSeg densifies lines but not spot points', ()=>{
  const Q=T.parseDXFTerrain(dxf,{maxSeg:10});
  return Q.layers['C-TOPO-MAJR'].count>P.layers['C-TOPO-MAJR'].count &&
         Q.layers['V-TOPO-SPOT'].count===2 && onPlane(Q.points.filter(p=>p[3]!=='C-STRM-PIPE'),0.002);
});
t('16 a binary DXF is recognised and refused', ()=>T.parseDXFTerrain('AutoCAD Binary DXF\r\n\x1a\x00...').binary===true);
t('17 a DXF with CRLF line endings reads the same', ()=>{
  const Q=T.parseDXFTerrain(dxf.replace(/\n/g,'\r\n')); return Q.points.length===P.points.length;
});

// ── TIN helpers ──
t('18 duplicates are removed and disagreements counted', ()=>{
  const r=T.dedupePoints([[0,0,1],[0,0,1],[0,0,2],[1,0,1]]); return r.points.length===2 && r.conflicts===1;
});
t('19 long triangles are trimmed and counted', ()=>{
  const pts=[[0,0,0],[1,0,0],[0,1,0],[100,0,0]], tri=[0,1,2, 1,3,2];
  const r=T.trimTIN(pts,tri,5); return r.triangles.length===3 && r.dropped===1 &&
    T.trimTIN(pts,tri,0).triangles.length===6;
});
t('20 the median edge is the middle edge', ()=>near(T.medianTriEdge([[0,0],[3,0],[0,4]],[0,1,2]),4));

// ── LAS ──
const L12=F.makeLAS({fmt:1}), L14=F.makeLAS({fmt:6});
t('21 the LAS header is read', ()=>{
  const h=T.parseLASHeader(L12.buf); return h.major===1 && h.minor===2 && h.format===1 && h.count===L12.pts.length && !h.compressed;
});
t('22 LAS 1.4 takes the 64 bit point count', ()=>{
  const h=T.parseLASHeader(L14.buf); return h.minor===4 && h.format===6 && h.count===L14.pts.length;
});
const R12=T.parseLAS(L12.buf), R14=T.parseLAS(L14.buf);
t('23 only ground (class 2) is kept, and it is on the plane', ()=>{
  const g=L12.pts.filter(p=>p[3]===2).length;
  return R12.points.length===g && !R12.unclassified && onPlane(R12.points,0.006);
});
t('24 buildings and noise are counted but not used', ()=>R12.classes[6]>0 && R12.classes[7]===1 &&
  !R12.points.some(p=>p[2]>600));
t('25 point format 6 reads classification from byte 16', ()=>
  R14.points.length===R12.points.length && onPlane(R14.points,0.006));
t('26 an unclassified file uses every point but noise, and says so', ()=>{
  const r=T.parseLAS(F.makeLAS({unclassified:true}).buf);
  return r.unclassified && r.points.length===r.read-1 && !r.points.some(p=>p[2]===9999);
});
t('27 LAZ is refused rather than read as garbage', ()=>T.parseLAS(F.makeLAS({laz:true}).buf).error==='compressed (LAZ)');
t('28 a file that is not LAS is refused', ()=>T.parseLAS(new ArrayBuffer(400)).error==='not a LAS file');
t('29 GeoKeys give the CRS and the vertical unit', ()=>{
  const r=T.parseLAS(F.makeLAS({epsg:2230,vcode:9003}).buf); return r.georef.epsg==='EPSG:2230' && r.georef.vUnits==='ft';
});
t('30 a WKT record gives the horizontal CRS, not a datum or unit id', ()=>{
  const wkt='COMPD_CS["NAD83(2011) / UTM zone 11N + NAVD88 height",PROJCS["NAD83(2011) / UTM zone 11N",GEOGCS["NAD83(2011)",DATUM["NAD83_2011",SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],AUTHORITY["EPSG","1116"]],AUTHORITY["EPSG","6318"]],PROJECTION["Transverse_Mercator"],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AUTHORITY["EPSG","6340"]],VERT_CS["NAVD88 height",VERT_DATUM["North American Vertical Datum 1988",2005,AUTHORITY["EPSG","5103"]],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AUTHORITY["EPSG","5703"]]]';
  const r=T.parseLAS(F.makeLAS({wkt}).buf); return r.georef.epsg==='EPSG:6340' && r.georef.vUnits==='m';
});
t('31 UTM 11N and the 2011 zone 6 are known to the projection set', ()=>
  T.CRS_DEFS['EPSG:6340'] && T.CRS_DEFS['EPSG:26911'] && T.CRS_DEFS['EPSG:6426']===T.CRS_DEFS['EPSG:2230']);
t('32 binning averages within a cell and keeps a plane a plane', ()=>{
  const b=T.binPoints(R12.points,12); return b.length<R12.points.length && b.length>100 && onPlane(b,0.006);
});

console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
process.exit(fail.length?1:0);
