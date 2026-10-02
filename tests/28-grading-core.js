// Grading edits checked against closed form volumes. A pad offset from a
// polygon at H:1 on flat ground is a rounded frustum:
//   V = A D + P H D^2 / 2 + pi H^2 D^3 / 3
const T = require('../src/terrain-core.js');
const pass=[],fail=[];
const t=(n,f)=>{try{f()?pass.push(n):fail.push(n);}catch(e){fail.push(n+' -> '+e.message);}};
const near=(a,b,rel)=>Math.abs(a-b)<=Math.abs(b)*rel;

function ground(fn, n, cell){
  n=n||400; cell=cell||1;
  const g=T.makeGrid({crs:'EPSG:2230',x0:0,y0:0,cell,ncols:n,nrows:n,name:'base'});
  for(let r=0;r<n;r++) for(let c=0;c<n;c++){ const p=T.cellCentre(g,r,c); g.z[r*n+c]=fn(p.x,p.y); }
  return g;
}
const flat=ground(()=>100);
const SQ=[[150,150],[250,150],[250,250],[150,250]];          // 100 ft square
const frustum=(A,P,H,D)=>A*D+P*H*D*D/2+Math.PI*H*H*D*D*D/3;
const at=(g,x,y)=>T.gridSample(g,x,y);

const pad=T.gradeEdit(flat,SQ,{mode:'pad',elev:104,slope:2});
t('1 a fill pad is flat at its elevation inside the outline', ()=>
  at(pad.grid,200,200)===104 && at(pad.grid,151,249)===104);
t('2 the fill volume is the rounded frustum', ()=>pad.cut===0 && near(pad.fill,frustum(10000,400,2,4),0.01));
t('3 the slope runs at 2:1 and meets the ground 8 ft out', ()=>
  Math.abs(at(pad.grid,254.5,200)-(104-4.5/2))<0.01 && Math.abs(at(pad.grid,257.5,200)-(104-7.5/2))<0.01 &&
  isNaN(at(pad.grid,262,200)));
t('4 the footprint is the outline area', ()=>pad.footprint===10000);

const basin=T.gradeEdit(flat,SQ,{mode:'pad',elev:96,slope:3});
t('5 a cut basin uses the same rule the other way', ()=>basin.fill===0 && near(basin.cut,frustum(10000,400,3,4),0.01) &&
  Math.abs(at(basin.grid,253.5,200)-(96+3.5/3))<0.01);
const box=T.gradeEdit(flat,SQ,{mode:'pad',elev:96,slope:0});
t('6 with no slope the walls are vertical and the volume is area times depth', ()=>
  Math.abs(box.cut-40000)<1e-6 && box.fill===0);
const up=T.gradeEdit(flat,SQ,{mode:'offset',delta:2});
t('7 raising a footprint adds area times the raise, with no slopes', ()=>
  Math.abs(up.fill-20000)<1e-6 && up.changed===10000 && at(up.grid,200,200)===102);
t('8 lowering does the reverse', ()=>Math.abs(T.gradeEdit(flat,SQ,{mode:'offset',delta:-1.5}).cut-15000)<1e-6);

// a pad on a slope is part cut and part fill
const tilt=ground((x)=>100+0.05*x);
const before=Float32Array.from(tilt.z);
const mix=T.gradeEdit(tilt,SQ,{mode:'pad',elev:110,slope:2});
t('9 a pad across a slope is cut on the high side and filled on the low side', ()=>mix.cut>0 && mix.fill>0);
t('10 every graded cell outside the pad sits on its 2:1 slope', ()=>{
  const g=mix.grid; let bad=0, checked=0;
  for(let r=0;r<g.nrows;r++) for(let c=0;c<g.ncols;c++){
    const z=g.z[r*g.ncols+c]; if(isNaN(z)) continue;
    const p=T.cellCentre(g,r,c); if(T.pointInPolyXY(p.x,p.y,SQ)) continue;
    const zb=100+0.05*p.x; if(Math.abs(z-zb)<1e-4) continue;          // the untouched margin
    checked++;
    if(Math.abs(Math.abs(z-110)-T.distToRingXY(p.x,p.y,SQ)/2)>1e-3) bad++;
  }
  return checked>1000 && bad===0;
});
t('11 the ground underneath is not written to', ()=>tilt.z.every((v,i)=>v===before[i]));
t('12 the edit grid is aligned to the base cells', ()=>
  Number.isInteger((mix.grid.x0-tilt.x0)/tilt.cell) && Number.isInteger((mix.grid.y0-tilt.y0)/tilt.cell));
t('13 only changed cells and a one cell margin carry values', ()=>{
  const g=mix.grid; return isNaN(g.z[0]) && isNaN(g.z[g.z.length-1]);
});
t('14 an outline off the ground returns nothing', ()=>
  T.gradeEdit(flat,[[5000,5000],[5100,5000],[5100,5100]],{mode:'pad',elev:100,slope:2})===null);
t('15 a pad needs an elevation', ()=>T.gradeEdit(flat,SQ,{mode:'pad',elev:NaN,slope:2})===null);

// holes in the base
const holed=ground(()=>100); for(let r=190;r<210;r++) for(let c=190;c<210;c++) holed.z[r*400+c]=NaN;
t('16 a pad defines ground where the base had none; an offset cannot', ()=>
  T.gradeEdit(holed,SQ,{mode:'pad',elev:101,slope:0}).grid.z.some(v=>v===101) &&
  isNaN(at(T.gradeEdit(holed,SQ,{mode:'offset',delta:1}).grid,200,200)));
t('17 the edit spec survives save and open', ()=>{
  const g=pad.grid; g.id='tl-9'; g.edit={mode:'pad',elev:104,slope:2,ring:[[1,2]]};
  const o=JSON.parse(JSON.stringify(T.encodeGrid(g))); const back=T.decodeGrid(o);
  return back.edit && back.edit.elev===104 && back.edit.slope===2 && back.edit.ring[0][1]===2;
});
t('18 a layer with no edit saves no edit field', ()=>!('edit' in JSON.parse(JSON.stringify(T.gridMeta(flat)))));
t('19 point in polygon and distance to the outline are right', ()=>
  T.pointInPolyXY(200,200,SQ) && !T.pointInPolyXY(100,200,SQ) &&
  Math.abs(T.distToRingXY(260,200,SQ)-10)<1e-9 && Math.abs(T.distToRingXY(253,253,SQ)-Math.hypot(3,3))<1e-9);

console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
process.exit(fail.length?1:0);
