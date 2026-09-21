// The app ships as one file, but the terrain core is developed and tested as
// a module. This guards against the two copies drifting apart.
const fs = require('fs');
const pass=[],fail=[];
const t=(n,f)=>{try{f()?pass.push(n):fail.push(n);}catch(e){fail.push(n+' -> '+e.message);}};

const html = fs.readFileSync('../public/index.html','utf8');
const src  = fs.readFileSync('../src/terrain-core.js','utf8');
const fsrc = fs.readFileSync('../src/flow-core.js','utf8');
const BEGIN='/* ===== BEGIN terrain-core (generated from src/terrain-core.js, do not edit here) ===== */';
const END  ='/* ===== END terrain-core ===== */';

t('1 the inlined block is present and delimited', ()=>
  html.indexOf(BEGIN)>0 && html.indexOf(END)>html.indexOf(BEGIN));

const inlined = html.slice(html.indexOf(BEGIN)+BEGIN.length, html.indexOf(END)).trim();
const expected = src.replace(/\nif \(typeof module !== 'undefined'\) \{[\s\S]*?\n\}\n/g,'\n').trim();

t('2 the inlined copy matches src/terrain-core.js exactly', ()=> inlined===expected);
t('3 node exports are stripped from the browser copy', ()=> !/module\.exports/.test(inlined));
t('4 every core function survived the inlining', ()=>{
  const names=[...src.matchAll(/^function (\w+)/gm)].map(m=>m[1]);
  return names.length>18 && names.every(n=>inlined.indexOf('function '+n)>=0);
});
t('5 no function is declared twice in the page', ()=>{
  const js=html.slice(html.indexOf('<script>')+8, html.lastIndexOf('</script>'));
  const names=[...src.matchAll(/^function (\w+)/gm)].map(m=>m[1]);
  return names.every(n=>(js.match(new RegExp('\\bfunction '+n+'\\s*\\(','g'))||[]).length===1);
});
t('6 the metre to foot constant is the US survey foot', ()=>
  /M_TO_USFT = 3\.2808333333333/.test(inlined));
t('7 State Plane zone 6 is defined for San Diego County', ()=>
  /EPSG:2230/.test(inlined) && /lat_0=32\.1666666666667/.test(inlined));

const FB='/* ===== BEGIN flow-core (generated from src/flow-core.js, do not edit here) ===== */';
const FE='/* ===== END flow-core ===== */';
t('8 the flow core is inlined too', ()=> html.indexOf(FB)>0 && html.indexOf(FE)>html.indexOf(FB));
t('9 the inlined flow core matches src/flow-core.js exactly', ()=>{
  const inl=html.slice(html.indexOf(FB)+FB.length, html.indexOf(FE)).trim();
  const exp=fsrc.replace(/\nif \(typeof module !== 'undefined'\) \{[\s\S]*?\n\}\n/g,'\n').trim();
  return inl===exp;
});
t('10 no flow function is declared twice in the page', ()=>{
  const js=html.slice(html.indexOf('<script>')+8, html.lastIndexOf('</script>'));
  const names=[...fsrc.matchAll(/^function (\w+)/gm)].map(m=>m[1]);
  return names.every(n=>(js.match(new RegExp('\\bfunction '+n+'\\s*\\(','g'))||[]).length===1);
});

console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
process.exit(fail.length?1:0);
