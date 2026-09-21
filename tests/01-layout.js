const { JSDOM, VirtualConsole } = require('jsdom');
const html=require('fs').readFileSync('../public/index.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,
  url:'https://local.test/',virtualConsole:new VirtualConsole()});
const pass=[],fail=[];
const t=(n,f)=>{try{f()?pass.push(n):fail.push(n);}catch(e){fail.push(n+' -> '+e.message);}};
setTimeout(()=>{
 const d=dom.window.document;
 const par=id=>{const e=d.getElementById(id);return e&&e.parentElement?e.parentElement.id:null;};
 t('1 left panel is inside main',   ()=> par('lp')==='main');
 t('2 map wrapper is inside main',  ()=> par('mw')==='main');
 t('3 properties panel is inside main', ()=> par('rp')==='main');
 t('4 main has exactly three children', ()=> d.getElementById('main').children.length===3);
 t('5 main is a direct child of app',()=> par('main')==='app');
 t('6 drawer is a direct child of app', ()=> par('dr')==='app');
 t('7 toolbar is a direct child of app', ()=> par('tb')==='app');
 t('8 app has toolbar, main and drawer', ()=>{
   const k=[...d.getElementById('app').children].map(e=>e.id);
   return k.join(',')==='tb,main,dr';
 });
 t('9 layer tree is inside the left panel', ()=> par('ltree')==='lp');
 t('10 user layers group is inside the layer tree', ()=>
   d.getElementById('lg-user').closest('#ltree')!==null);
 t('11 basemap bar and status bar are inside the map wrapper', ()=>
   par('bmbar')==='mw' && par('stbar')==='mw');
 t('12 properties body is inside the properties panel', ()=> par('pb')==='rp');
 t('13 every properties view is inside the properties body', ()=>
   ['v-welcome','v-proj','v-sc','v-jct','v-basin','v-link'].every(v=>par(v)==='pb'));
 t('14 canvas and panels are inside the drawer body', ()=>
   par('hydro-canvas')==='dr-body' && par('report-panel')==='dr-body' && par('summary-panel')==='dr-body');
 console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
 console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
 process.exit(fail.length?1:0);
},5000);
