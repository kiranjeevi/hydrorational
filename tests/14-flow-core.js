// Flow routing checked against surfaces whose answers can be worked out by hand.
const T = require('../src/terrain-core.js');
const F = require('../src/flow-core.js');
const pass=[],fail=[];
const t=(n,f)=>{try{f()?pass.push(n):fail.push(n);}catch(e){fail.push(n+' -> '+e.message);}};
const near=(a,b,tol)=>Math.abs(a-b)<=(tol===undefined?1e-6:tol);

function surface(ncols,nrows,cell,fn){
  const g=T.makeGrid({crs:'EPSG:2230',x0:1000,y0:2000,cell,ncols,nrows,name:'s'});
  for(let r=0;r<nrows;r++) for(let c=0;c<ncols;c++) g.z[T.gridIndex(g,r,c)]=fn(r,c);
  return g;
}
const idx=(g,r,c)=>r*g.ncols+c;

// A: a plane falling to the east, 0.2 ft per 10 ft cell, so 2 percent
const A=surface(30,30,10,(r,c)=>100-c*0.2);
const Az=F.fillDepressions(A,A.z);
const Adir=F.flowDirD8(A,Az);
const Aacc=F.flowAccum(A,Az,Adir);

t('1 a monotone plane needs no filling', ()=>{
  let worst=0; for(let i=0;i<Az.length;i++) worst=Math.max(worst,Math.abs(Az[i]-A.z[i]));
  return worst<0.002;
});
t('2 every interior cell on the plane flows east', ()=>{
  for(let r=1;r<29;r++) for(let c=0;c<29;c++) if(Adir[idx(A,r,c)]!==2) return false;
  return true;
});
t('3 the downslope edge has nowhere to go', ()=> Adir[idx(A,15,29)]===-1);
t('4 accumulation at the outlet equals the row length', ()=> near(Aacc[idx(A,15,29)],30,1e-6));
t('5 accumulation grows one cell at a time down the row', ()=>
  [0,1,10,20,29].every(c=>near(Aacc[idx(A,15,c)],c+1,1e-6)));
t('6 the watershed of an outlet cell is exactly its row', ()=>{
  const m=F.watershedFrom(A,Adir,15,29);
  let n=0,offRow=0;
  for(let i=0;i<m.length;i++) if(m[i]){ n++; if(((i/A.ncols)|0)!==15) offRow++; }
  return n===30 && offRow===0;
});
t('7 watershed area matches cell count times cell area', ()=>{
  const m=F.watershedFrom(A,Adir,15,29);
  return near(F.maskArea(A,m), 30*100, 1e-6) &&
         near(F.maskAreaAcres(A,m), 3000/43560, 1e-9);
});
t('8 the longest flow path spans the row', ()=>{
  const m=F.watershedFrom(A,Adir,15,29);
  const lp=F.longestFlowPath(A,Adir,m,idx(A,15,29));
  return lp && lp.cells.length===30 && near(lp.length,290,1e-6);
});
t('9 the traced reach reports the true 2 percent grade', ()=>{
  const m=F.watershedFrom(A,Adir,15,29);
  const lp=F.longestFlowPath(A,Adir,m,idx(A,15,29));
  return near(F.reachSlopePct(A,Az,lp.cells),2,0.01);
});
t('10 splitting the reach conserves length', ()=>{
  const m=F.watershedFrom(A,Adir,15,29);
  const lp=F.longestFlowPath(A,Adir,m,idx(A,15,29));
  const s=F.splitInitialReach(A,Az,lp.cells,70);
  return near(s.overlandLength,70,10) && near(s.overlandLength+s.channelLength,290,10);
});
t('11 a diagonal step counts as the longer distance', ()=>{
  const g=T.makeGrid({crs:'EPSG:2230',x0:0,y0:0,cell:10,ncols:3,nrows:3});
  return near(F.pathLengthCells(g,[[0,0],[1,1]]), 10*Math.SQRT2, 1e-9) &&
         near(F.pathLengthCells(g,[[0,0],[0,1]]), 10, 1e-9);
});

// B: the same plane with a pit carved into it
const B=surface(24,24,10,(r,c)=>{
  let z=100-c*0.2;
  if(r>=10&&r<=13&&c>=10&&c<=13) z-=8;     // a closed depression
  return z;
});
t('12 the raw surface has sinks', ()=> F.countSinks(B,B.z)>0);
t('13 filling removes every interior sink', ()=>{
  const z=F.fillDepressions(B,B.z);
  return F.countSinks(B,z)===0;
});
t('14 filling only ever raises ground, never lowers it', ()=>{
  const z=F.fillDepressions(B,B.z);
  for(let i=0;i<z.length;i++) if(z[i]<B.z[i]-1e-9) return false;
  return true;
});
t('15 ground outside the pit is left alone', ()=>{
  const z=F.fillDepressions(B,B.z);
  return near(z[idx(B,2,2)],B.z[idx(B,2,2)],0.002) &&
         near(z[idx(B,20,20)],B.z[idx(B,20,20)],0.002);
});
t('16 an unfilled pit would strand a traced path, a filled one does not', ()=>{
  const raw=F.flowDirD8(B,B.z);
  const stuck=F.traceDownslope(B,raw,11,5);          // runs into the pit
  const z=F.fillDepressions(B,B.z);
  const dir=F.flowDirD8(B,z);
  const through=F.traceDownslope(B,dir,11,5);
  return stuck.length<through.length && through[through.length-1][1]>=B.ncols-2;
});

// C: a valley falling south, with side slopes toward the axis at c=15
const C=surface(31,40,10,(r,c)=>100-r*0.05+Math.abs(c-15)*0.25);
const Cz=F.fillDepressions(C,C.z);
const Cdir=F.flowDirD8(C,Cz);
const Cacc=F.flowAccum(C,Cz,Cdir);
const outlet=idx(C,39,15);

t('17 the valley axis carries the most flow', ()=>{
  const axis=Cacc[idx(C,38,15)];
  return axis>Cacc[idx(C,38,5)] && axis>Cacc[idx(C,38,25)] && axis>100;
});
t('18 the outlet watershed covers most of the surface', ()=>{
  const m=F.watershedFrom(C,Cdir,39,15);
  let n=0; for(const v of m) if(v) n++;
  return n > 0.5*C.ncols*C.nrows;
});
t('19 snapping a click finds the channel', ()=>{
  const s=F.snapToChannel(C,Cacc,38,18,4);
  return s.c===15 && s.a>Cacc[idx(C,38,18)];
});
t('20 the watershed outline closes and encloses the right area', ()=>{
  const m=F.watershedFrom(C,Cdir,39,15);
  const rings=F.maskToRings(C,m,T.marchLevel,T.joinSegments,T.makeGrid);
  if(!rings.length) return false;
  const ring=rings[0];
  const closed=Math.hypot(ring[0][0]-ring[ring.length-1][0], ring[0][1]-ring[ring.length-1][1]) < C.cell;
  let a=0;
  for(let i=0;i<ring.length-1;i++) a+=ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1];
  const polyArea=Math.abs(a/2);
  const cellArea=F.maskArea(C,m);
  return closed && Math.abs(polyArea-cellArea)/cellArea < 0.15;
});
t('21 the longest path starts at the divide and ends at the outlet', ()=>{
  const m=F.watershedFrom(C,Cdir,39,15);
  const lp=F.longestFlowPath(C,Cdir,m,outlet);
  const last=lp.cells[lp.cells.length-1];
  return lp.length>300 && last[0]===39 && last[1]===15;
});
t('22 flow length is zero at the outlet and grows upstream', ()=>{
  const m=F.watershedFrom(C,Cdir,39,15);
  const len=F.flowLengthTo(C,Cdir,m,outlet);
  return len[outlet]===0 && len[idx(C,20,15)]>100 && len[idx(C,5,15)]>len[idx(C,20,15)];
});
t('23 a path traced from any cell reaches the outlet', ()=>{
  const cells=F.traceDownslope(C,Cdir,3,25);
  const last=cells[cells.length-1];
  return last[0]===39 || last[1]===0 || last[1]===30;
});
t('24 tracing cannot loop forever', ()=>{
  const flat=surface(10,10,10,()=>50);
  const z=F.fillDepressions(flat,flat.z);
  const dir=F.flowDirD8(flat,z);
  const cells=F.traceDownslope(flat,dir,5,5);
  return cells.length<=100;
});
t('25 nodata is carried through instead of routed over', ()=>{
  const g=surface(12,12,10,(r,c)=>(r>8?NaN:100-c*0.2));
  const z=F.fillDepressions(g,g.z);
  const dir=F.flowDirD8(g,z);
  return dir[idx(g,10,5)]===-1 && isNaN(z[idx(g,10,5)]);
});

t('26 a watershed that runs off the tile edge still closes', ()=>{
  const E=surface(20,20,10,(r,c)=>100-c*0.2);
  const z=F.fillDepressions(E,E.z), dir=F.flowDirD8(E,z);
  const m=F.watershedFrom(E,dir,10,19);
  const rings=F.maskToRings(E,m,T.marchLevel,T.joinSegments,T.makeGrid);
  if(!rings.length) return false;
  const ring=rings[0];
  return Math.hypot(ring[0][0]-ring[ring.length-1][0], ring[0][1]-ring[ring.length-1][1]) < E.cell;
});
t('27 an outline is produced even when the mask hugs three edges', ()=>{
  const E=surface(16,16,10,(r,c)=>100-c*0.2);
  const z=F.fillDepressions(E,E.z), dir=F.flowDirD8(E,z);
  const m=new Uint8Array(E.ncols*E.nrows);
  for(let r=0;r<E.nrows;r++) for(let c=0;c<E.ncols;c++) if(c<12) m[r*E.ncols+c]=1;
  const rings=F.maskToRings(E,m,T.marchLevel,T.joinSegments,T.makeGrid);
  return rings.length===1 && rings[0].length>20;
});

console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
process.exit(fail.length?1:0);

