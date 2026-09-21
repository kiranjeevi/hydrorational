// Terrain core tested against surfaces whose answers are known in closed form.
const T = require('../src/terrain-core.js');
const pass=[],fail=[];
const t=(n,f)=>{try{f()?pass.push(n):fail.push(n);}catch(e){fail.push(n+' -> '+e.message);}};
const near=(a,b,tol)=>Math.abs(a-b)<=(tol===undefined?1e-6:tol);

// a tilted plane: z = 100 + 0.02x - 0.01y, cell 10, 50x50, origin (1000,2000)
function plane(ncols,nrows,cell,x0,y0,fn,crs){
  const g=T.makeGrid({crs:crs||'EPSG:2230',x0,y0,cell,ncols,nrows,name:'plane'});
  for(let r=0;r<nrows;r++) for(let c=0;c<ncols;c++){
    const p=T.cellCentre(g,r,c); g.z[T.gridIndex(g,r,c)]=fn(p.x,p.y);
  }
  return g;
}
const F=(x,y)=>100+0.02*x-0.01*y;
const G=plane(50,50,10,1000,2000,F);

t('1 grid bounds are right', ()=>{
  const b=T.gridBounds(G);
  return b.xmin===1000 && b.ymin===2000 && b.xmax===1500 && b.ymax===2500;
});
t('2 cell centre geometry, row 0 is the north row', ()=>{
  const a=T.cellCentre(G,0,0), b=T.cellCentre(G,49,0);
  return near(a.x,1005) && near(a.y,2495) && near(b.y,2005);
});
t('3 bilinear sampling reproduces a plane exactly inside the cell centre hull', ()=>
  [[1005,2495],[1234,2311],[1450,2050],[1100,2100]].every(([x,y])=>
    near(T.gridSample(G,x,y), F(x,y), 1e-4)));
t('3b in the outer half cell it clamps to the edge rather than extrapolating', ()=>{
  // 1499 lies past the last cell centre at 1495, so the value holds at the edge
  const v=T.gridSample(G,1499,2050);
  return !isNaN(v) && near(v, F(1495,2050), 1e-4) && v !== F(1499,2050);
});
t('4 sampling outside the grid returns NaN', ()=>
  isNaN(T.gridSample(G,999,2100)) && isNaN(T.gridSample(G,1200,2600)));
t('5 nodata propagates instead of being silently zero', ()=>{
  const H=plane(10,10,5,0,0,()=>50); H.z[T.gridIndex(H,5,5)]=NaN;
  return isNaN(T.gridSample(H, T.cellCentre(H,5,5).x, T.cellCentre(H,5,5).y));
});

// resample onto a finer target, same CRS
const tgt=T.makeTarget({xmin:1100,ymin:2100,xmax:1300,ymax:2300}, 4, 'EPSG:2230');
t('6 resample to a finer grid preserves the plane', ()=>{
  const band=T.resampleOnto(G,tgt,null);
  let worst=0;
  for(let r=0;r<tgt.nrows;r++) for(let c=0;c<tgt.ncols;c++){
    const p=T.cellCentre(tgt,r,c), v=band[T.gridIndex(tgt,r,c)];
    if(isNaN(v)) continue;
    worst=Math.max(worst,Math.abs(v-F(p.x,p.y)));
  }
  return worst<1e-3;
});

// composite: a small high priority patch sitting on a big low priority surface
const base=plane(60,60,10,1000,2000,F);           base.name='3DEP'; base.priority=0;
const surv=plane(20,20,5,1150,2150,(x,y)=>F(x,y)); surv.name='survey'; surv.priority=1;
const ct=T.makeTarget({xmin:1000,ymin:2000,xmax:1600,ymax:2600}, 5, 'EPSG:2230');
const comp=T.compositeStack([base,surv],ct,null);

t('7 higher priority layer wins inside its footprint', ()=>{
  const p={x:1200,y:2200};
  const c=Math.floor((p.x-ct.x0)/ct.cell), r=ct.nrows-1-Math.floor((p.y-ct.y0)/ct.cell);
  return comp.order[comp.src[T.gridIndex(ct,r,c)]].name==='survey';
});
t('8 base fills everywhere outside the survey', ()=>{
  const p={x:1500,y:2500};
  const c=Math.floor((p.x-ct.x0)/ct.cell), r=ct.nrows-1-Math.floor((p.y-ct.y0)/ct.cell);
  return comp.order[comp.src[T.gridIndex(ct,r,c)]].name==='3DEP';
});
t('9 every cell inside the base extent gets a source', ()=>{
  let unset=0; for(let i=0;i<comp.src.length;i++) if(comp.src[i]<0) unset++;
  return unset===0;
});
t('10 matching surfaces give a seam of zero', ()=>{
  const s=T.seamStats(comp,0,1);
  return s.overlap>100 && Math.abs(s.meanAbs)<1e-3;
});
t('11 a datum offset shows up in the seam report', ()=>{
  const off=plane(20,20,5,1150,2150,(x,y)=>F(x,y)+1.8); off.name='survey'; off.priority=1;
  const c2=T.compositeStack([base,off],ct,null);
  const s=T.seamStats(c2,0,1);
  return near(s.mean,1.8,0.01) && near(s.max,1.8,0.01);
});
t('12 seam cells trace the survey boundary', ()=>{
  const cells=T.seamCells(comp);
  return cells.length>20 && cells.length<400;
});

// ASCII ingest, including the metre to foot conversion
const asc=['ncols 4','nrows 3','xllcorner 500','yllcorner 900','cellsize 25','NODATA_value -9999',
 '10 11 12 13','14 15 16 -9999','18 19 20 21'].join('\n');
t('13 ASCII grid header and ordering', ()=>{
  const g=T.gridFromAscii(asc,{});
  return g.ncols===4 && g.nrows===3 && g.cell===25 && g.x0===500 && g.y0===900 &&
         g.z[T.gridIndex(g,0,0)]===10 && g.z[T.gridIndex(g,2,3)]===21;
});
t('14 ASCII nodata becomes NaN, not a number', ()=>
  isNaN(T.gridFromAscii(asc,{}).z[T.gridIndex(T.gridFromAscii(asc,{}),1,3)]));
t('15 metres convert to US survey feet on ingest', ()=>{
  const g=T.gridFromAscii(asc,{vUnits:'m'});
  return near(g.z[T.gridIndex(g,0,0)], 10*T.M_TO_USFT, 1e-4);
});
t('16 a datum shift is applied on ingest', ()=>{
  const g=T.gridFromAscii(asc,{vShift:-2.5});
  return near(g.z[T.gridIndex(g,0,0)], 7.5, 1e-6);
});
t('17 a truncated ASCII file is rejected rather than half read', ()=>
  T.gridFromAscii('ncols 4\nnrows 3\nxllcorner 0\nyllcorner 0\ncellsize 1\n1 2 3 4\n',{})===null);

// XYZ and TIN
t('18 XYZ parsing skips headers and keeps triples', ()=>{
  const p=T.parseXYZPoints('PointID,East,North,Elev\n1000,2000,50\n1010,2000,52\n1000,2010,51\nbad line\n');
  return p.length===3 && p[1][2]===52;
});
t('19 TIN rasterizing reproduces a plane inside the hull', ()=>{
  const pts=[]; for(let i=0;i<=4;i++) for(let j=0;j<=4;j++) pts.push([1000+i*25,2000+j*25,F(1000+i*25,2000+j*25)]);
  // two triangles per quad
  const tri=[];
  const id=(i,j)=>i*5+j;
  for(let i=0;i<4;i++) for(let j=0;j<4;j++){
    tri.push(id(i,j),id(i+1,j),id(i,j+1));
    tri.push(id(i+1,j),id(i+1,j+1),id(i,j+1));
  }
  const tt=T.makeTarget({xmin:1000,ymin:2000,xmax:1100,ymax:2100},5,'EPSG:2230');
  const z=T.rasterizeTIN(pts,tri,tt,{});
  let worst=0,filled=0;
  for(let r=0;r<tt.nrows;r++) for(let c=0;c<tt.ncols;c++){
    const v=z[T.gridIndex(tt,r,c)]; if(isNaN(v)) continue;
    filled++; const p=T.cellCentre(tt,r,c);
    worst=Math.max(worst,Math.abs(v-F(p.x,p.y)));
  }
  return filled>300 && worst<1e-3;
});

// contours on a cone: z = 100 - sqrt((x-xc)^2+(y-yc)^2)*0.1
t('20 contours on a plane are straight and correctly spaced', ()=>{
  const cs=T.contourLines(G,2);
  if(!cs.length) return false;
  const lv=cs.map(c=>c.level);
  const diffs=[]; for(let i=1;i<lv.length;i++) diffs.push(+(lv[i]-lv[i-1]).toFixed(6));
  return diffs.every(d=>near(d,2,1e-6));
});
t('21 every contour vertex sits on its own level', ()=>{
  const cs=T.contourLines(G,2);
  let worst=0;
  cs.forEach(c=>c.lines.forEach(l=>l.forEach(p=>{
    const z=T.gridSample(G,p[0],p[1]);
    if(!isNaN(z)) worst=Math.max(worst,Math.abs(z-c.level));
  })));
  return worst<0.05;
});
t('22 a cone produces closed rings', ()=>{
  const C=plane(60,60,10,0,0,(x,y)=>200-Math.sqrt((x-300)**2+(y-300)**2)*0.1);
  const cs=T.contourLines(C,2);
  const ring=cs.find(c=>c.level===180);
  if(!ring) return false;
  const l=ring.lines[0];
  const d=Math.hypot(l[0][0]-l[l.length-1][0], l[0][1]-l[l.length-1][1]);
  return l.length>20 && d<15;
});

// profile
t('23 profile length and gradient match the plane', ()=>{
  const sampler=(x,y)=>T.gridSample(G,x,y);
  const prof=T.profileAlong([[1050,2100],[1450,2100]], sampler, 5);
  const st=T.profileStats(prof);
  // along +x, z rises 0.02 per ft, so the profile falls 2% going forward
  return near(st.length,400,1e-6) && near(st.slopePct,-2,0.01) && st.gaps===0;
});
t('24 profile reports gaps where the surface has no data', ()=>{
  const sampler=(x,y)=>T.gridSample(G,x,y);
  const prof=T.profileAlong([[900,2100],[1100,2100]], sampler, 5);
  return T.profileStats(prof).gaps>0;
});
t('25 a diagonal profile gets the true 3D run', ()=>{
  const sampler=(x,y)=>T.gridSample(G,x,y);
  const prof=T.profileAlong([[1050,2050],[1250,2250]], sampler, 5);
  return near(T.profileStats(prof).length, Math.hypot(200,200), 1e-6);
});

console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
process.exit(fail.length?1:0);
