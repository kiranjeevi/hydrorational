const T = require('../src/terrain-core.js');
const F = require('../src/flow-core.js');
const pass=[],fail=[];
const t=(n,f)=>{try{f()?pass.push(n):fail.push(n);}catch(e){fail.push(n+' -> '+e.message);}};
const near=(a,b,tol)=>Math.abs(a-b)<=tol;

function surface(nc,nr,cell,fn){
  const g=T.makeGrid({crs:'EPSG:2230',x0:0,y0:0,cell,ncols:nc,nrows:nr});
  for(let r=0;r<nr;r++)for(let c=0;c<nc;c++)g.z[r*nc+c]=fn(r,c);
  return g;
}
const AC=43560;

// 1. a flat bottomed box pit, 10 by 10 cells of 5 ft, walls 20 ft high
const box=surface(30,30,5,(r,c)=>(r>=10&&r<20&&c>=10&&c<20)?100:120);
const bp=F.pondFill(box,box.z,14,14,{step:1});
t('1 the pond bottom is the pit floor', ()=> near(bp.bottom,100,1e-6));
t('2 storage in a vertical walled pit is area times depth', ()=>{
  const s=bp.samples.filter(x=>near(x.e,105,1e-6))[0];
  return s && near(s.v, 100*25*5, 1e-3);      // 100 cells x 25 sq ft x 5 ft
});
t('3 storage is linear with depth in a box', ()=>{
  const a=bp.samples.filter(x=>near(x.e,102,1e-6))[0];
  const b=bp.samples.filter(x=>near(x.e,108,1e-6))[0];
  return near(a.v,100*25*2,1e-3) && near(b.v,100*25*8,1e-3);
});
t('4 the pond stops at the rim, not beyond it', ()=>
  near(bp.spillElev,120,1e-6) && bp.cells>=100);
t('5 volume is zero at the floor', ()=> near(bp.samples[0].v,0,1e-9));

// 2. a conical pit, z = 100 + 0.1 r, where volume = pi h^3 / (3 k^2)
const cone=surface(80,80,2,(r,c)=>{
  const d=Math.hypot((r-40)*2,(c-40)*2);
  return Math.min(120, 100+0.1*d);
});
const cp=F.pondFill(cone,cone.z,40,40,{step:0.5});
t('6 a cone fills as the cube of depth', ()=>{
  const k=0.1;
  let worst=0;
  [2,4,6,8].forEach(h=>{
    const s=cp.samples.filter(x=>near(x.e,100+h,0.26))[0];
    if(!s) { worst=99; return; }
    const exact=Math.PI*Math.pow(h,3)/(3*k*k);
    worst=Math.max(worst, Math.abs(s.v-exact)/exact);
  });
  return worst<0.10;
});
t('7 the pond area grows as the square of depth', ()=>{
  const s4=cp.samples.filter(x=>near(x.e,104,0.26))[0];
  const s8=cp.samples.filter(x=>near(x.e,108,0.26))[0];
  return s4 && s8 && near(s8.cells/s4.cells, 4, 0.6);
});

// 3. a saddle: two pits, the lower one spills into the higher one
const saddle=surface(40,20,5,(r,c)=>{
  // ring of high ground so the pits are genuinely enclosed
  if(r===0||r===19||c===0||c===39) return 130;
  if(c<18) return 100+Math.abs(c-8)*0.6+Math.abs(r-10)*0.9;     // pit A floor 100
  if(c>22) return 104+Math.abs(c-30)*0.6+Math.abs(r-10)*0.9;    // pit B floor 104
  return 112;                                                    // the divide
});
const sp=F.pondFill(saddle,saddle.z,10,8,{step:0.5});
t('8 a pond stops at its own saddle, not the far basin', ()=>
  sp.spillElev>=108 && sp.spillElev<=113);
t('9 the pond mask stays on its own side of the divide', ()=>{
  let wrongSide=0;
  for(let r=0;r<saddle.nrows;r++) for(let c=23;c<saddle.ncols;c++)
    if(sp.mask[r*saddle.ncols+c]) wrongSide++;
  return wrongSide===0;
});

// 4. behaviour worth pinning down
t('10 a click near the basin settles onto the low point', ()=>{
  const off=F.pondFill(box,box.z,11,18,{step:1});
  return near(off.bottom,100,1e-6);
});
t('11 a pond that reaches the tile edge is flagged', ()=>{
  const slope=surface(20,20,5,(r,c)=>100+c*0.5);
  const p=F.pondFill(slope,slope.z,10,0,{step:1});
  return p.spillsAtEdge===true;
});
t('12 maxRise stops the fill at the level asked for, and says so', ()=>{
  const p=F.pondFill(box,box.z,14,14,{step:1,maxRise:6});
  return p.capped===true && Math.abs(p.spillElev-106)<1e-6 && p.spillsAtEdge===false;
});
t('13 samples run from the floor upward without gaps', ()=>{
  for(let i=1;i<bp.samples.length;i++)
    if(bp.samples[i].e < bp.samples[i-1].e) return false;
  return true;
});
t('14 storage never decreases as the level rises', ()=>{
  for(let i=1;i<cp.samples.length;i++)
    if(cp.samples[i].v < cp.samples[i-1].v-1e-6) return false;
  return true;
});
t('15 nodata is treated as an edge, not as ground', ()=>{
  const g=surface(20,20,5,(r,c)=>(c>15?NaN:(r>=8&&r<12&&c>=8&&c<12)?100:110));
  const p=F.pondFill(g,g.z,10,10,{step:1});
  return p && p.bottom===100;
});

console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
process.exit(fail.length?1:0);
