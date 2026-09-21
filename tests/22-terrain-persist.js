const T = require('../src/terrain-core.js');
const pass=[],fail=[];
const t=(n,f)=>{try{f()?pass.push(n):fail.push(n);}catch(e){fail.push(n+' -> '+e.message);}};

function surface(nc,nr,cell,fn){
  const g=T.makeGrid({crs:'EPSG:2230',x0:6300000,y0:1840000,cell,ncols:nc,nrows:nr,name:'survey'});
  for(let r=0;r<nr;r++)for(let c=0;c<nc;c++)g.z[T.gridIndex(g,r,c)]=fn(r,c);
  g.id='tl-1'; g.kind='survey'; g.priority=2; g.vSrc='feet as supplied';
  return g;
}
const S=surface(120,90,2.5,(r,c)=>1780+c*0.08-r*0.05);

t('1 a survey grid round trips', ()=>{
  const o=T.encodeGrid(S,{});
  const g=T.decodeGrid(o);
  return g && g.ncols===120 && g.nrows===90 && g.cell===2.5 &&
         g.x0===S.x0 && g.y0===S.y0 && g.crs==='EPSG:2230';
});
t('2 elevations survive to a hundredth of a foot', ()=>{
  const g=T.decodeGrid(T.encodeGrid(S,{}));
  let worst=0;
  for(let i=0;i<S.z.length;i++) worst=Math.max(worst,Math.abs(g.z[i]-S.z[i]));
  return worst<=0.005;
});
t('3 identity, name, kind and priority come back', ()=>{
  const g=T.decodeGrid(T.encodeGrid(S,{}));
  return g.id==='tl-1' && g.name==='survey' && g.kind==='survey' &&
         g.priority===2 && g.vSrc==='feet as supplied';
});
t('4 holes stay holes, they do not become zero', ()=>{
  const H=surface(40,40,5,(r,c)=>(r>20&&c>20)?NaN:100+c*0.1);
  const g=T.decodeGrid(T.encodeGrid(H,{}));
  let nan=0,bad=0;
  for(let i=0;i<H.z.length;i++){
    if(isNaN(H.z[i])){ nan++; if(!isNaN(g.z[i])) bad++; }
    else if(isNaN(g.z[i])) bad++;
  }
  return nan>300 && bad===0;
});
t('5 quantised storage is smaller than raw float32', ()=>{
  const o=T.encodeGrid(S,{});
  const raw=S.z.length*4;
  return o.enc==='i16' && o.data.length < raw*0.75;
});
t('6 a tall range falls back to float32 rather than clipping', ()=>{
  const tall=surface(30,30,10,(r,c)=>100+c*40);     // spans 1160 ft
  const o=T.encodeGrid(tall,{});
  const g=T.decodeGrid(o);
  let worst=0;
  for(let i=0;i<tall.z.length;i++) worst=Math.max(worst,Math.abs(g.z[i]-tall.z[i]));
  return o.enc==='f32' && worst<0.01;
});
t('7 exactly at the quantisation limit it still round trips', ()=>{
  const edge=surface(20,20,5,(r,c)=>1000+(c/19)*319);
  const g=T.decodeGrid(T.encodeGrid(edge,{}));
  let worst=0;
  for(let i=0;i<edge.z.length;i++) worst=Math.max(worst,Math.abs(g.z[i]-edge.z[i]));
  return worst<=0.006;
});
t('8 3DEP is stored as a stub, not as a payload', ()=>{
  const d=surface(512,512,6,(r,c)=>1700+c*0.01);
  d.kind='3dep'; d.name='USGS 3DEP';
  const o=T.encodeGrid(d,{stubOnly:true});
  return o.enc==='stub' && !o.data && o.ncols===512 && o.cell===6 &&
         o.x0===d.x0 && o.y0===d.y0;
});
t('9 decoding a stub returns nothing, so the caller re-fetches', ()=>
  T.decodeGrid({enc:'stub',ncols:10,nrows:10})===null);
t('10 an all nodata grid encodes without a payload', ()=>{
  const empty=surface(20,20,5,()=>NaN);
  const o=T.encodeGrid(empty,{});
  const g=T.decodeGrid(o);
  return o.enc==='empty' && g && g.z.every(v=>isNaN(v));
});
t('11 sampling the decoded grid matches the original', ()=>{
  const g=T.decodeGrid(T.encodeGrid(S,{}));
  const b=T.gridBounds(S), x=(b.xmin+b.xmax)/2, y=(b.ymin+b.ymax)/2;
  return Math.abs(T.gridSample(g,x,y)-T.gridSample(S,x,y))<0.01;
});
t('12 the payload survives JSON, which is how it is stored', ()=>{
  const o=JSON.parse(JSON.stringify(T.encodeGrid(S,{})));
  const g=T.decodeGrid(o);
  let worst=0;
  for(let i=0;i<S.z.length;i++) worst=Math.max(worst,Math.abs(g.z[i]-S.z[i]));
  return worst<=0.005;
});
t('13 base64 helpers are exact for a long buffer', ()=>{
  const u=new Uint8Array(70000);
  for(let i=0;i<u.length;i++) u[i]=i%256;
  const back=T.b64ToBytes(T.bytesToB64(u));
  if(back.length!==u.length) return false;
  for(let i=0;i<u.length;i++) if(back[i]!==u[i]) return false;
  return true;
});

console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
process.exit(fail.length?1:0);
