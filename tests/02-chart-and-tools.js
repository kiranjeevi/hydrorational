const { JSDOM, VirtualConsole } = require('jsdom');
const fs_=require('fs');
const html=fs_.readFileSync('../public/index.html','utf8');
const CSV =fs_.readFileSync('../samples/PF_Depth_English_PDS.csv','utf8');
const errs=[]; const vc=new VirtualConsole();
vc.on('jsdomError',e=>errs.push(e.detail?e.detail.message:e.message));
const dom=new JSDOM(html,{runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,
  url:'https://local.test/',virtualConsole:vc});
const pass=[],fail=[];
const t=(n,f)=>{try{f()?pass.push(n):fail.push(n);}catch(e){fail.push(n+' -> THREW: '+e.message);}};

function recorder(){
  const R={texts:[],rects:[],pts:[],font:'10px',fontPx:10};
  const push=(x,y)=>{ if(isFinite(x)&&isFinite(y)) R.pts.push([x,y]); };
  const ctx={
    set font(v){ R.font=v; const m=String(v).match(/(\d+(?:\.\d+)?)px/); R.fontPx=m?+m[1]:10; },
    get font(){ return R.font; },
    fillStyle:'',strokeStyle:'',lineWidth:1,textAlign:'left',
    scale(){},save(){},restore(){},translate(){},rotate(){},
    beginPath(){},closePath(){},fill(){},stroke(){},clearRect(){},
    createLinearGradient(){return{addColorStop(){}};},
    measureText(s){return{width:String(s).length*R.fontPx*0.56};},
    fillRect(x,y,w,h){R.rects.push({x,y,w,h});push(x,y);push(x+w,y+h);},
    strokeRect(x,y,w,h){R.rects.push({x,y,w,h});push(x,y);push(x+w,y+h);},
    fillText(s,x,y){R.texts.push({s:String(s),x,y,px:R.fontPx,align:this.textAlign});push(x,y);},
    moveTo(x,y){push(x,y);},lineTo(x,y){push(x,y);},
    arc(x,y,r){push(x-r,y-r);push(x+r,y+r);}
  };
  return {R,ctx};
}

function render(w,W,H){
  const cv=w.document.getElementById('hydro-canvas');
  Object.defineProperty(cv,'offsetWidth',{value:W,configurable:true});
  Object.defineProperty(cv,'offsetHeight',{value:H,configurable:true});
  const {R,ctx}=recorder();
  cv.getContext=()=>ctx;
  w.drawHydroChart(w.appState.lastHydro);
  return R;
}
const inBounds=(R,W,H,slack)=>R.pts.every(([x,y])=>x>=-(slack||1)&&x<=W+(slack||1)&&y>=-(slack||1)&&y<=H+(slack||1));

setTimeout(()=>{
 const w=dom.window,d=dom.window.document; w.open=()=>null; w.fetch=()=>Promise.reject(new Error('offline'));
 const TX=id=>d.getElementById(id).textContent;

 // toolbar naming
 t('1 toolbar says Junction / Node', ()=> /Junction \/ Node/.test(d.getElementById('dt-jct').textContent));
 t('2 toolbar says Link / Flow path', ()=> /Link \/ Flow path/.test(d.getElementById('dt-lnk').textContent));
 t('3 status bar label updated', ()=>{ w.setTool('link');
   const ok=/Link \/ Flow path/.test(TX('stool')); w.setTool('select'); return ok; });
 t('4 node tool status label', ()=>{ w.setTool('junction');
   const ok=/Junction \/ Node/.test(TX('stool')); w.setTool('select'); return ok; });

 // build a real hydrograph
 w.loadNOAAText(CSV,'noaa.csv');
 const p=w.L.polygon([[32.720,-117.170],[32.725,-117.165],[32.722,-117.160],[32.718,-117.166]]);
 w.curTool='subcatchment'; w.onDrawCreated({layer:p,layerType:'polygon'});
 w.runAnalysis();
 t('5 hydrograph generated', ()=> w.appState.lastHydro && w.appState.lastHydro.Qp>0);

 // chart geometry at many sizes
 const sizes=[[600,150],[900,232],[1280,232],[1900,232],[2560,232],[1900,140],[1900,600],[3400,300]];
 sizes.forEach(([W,H],i)=>{
   t('6.'+(i+1)+' chart fits inside '+W+'x'+H, ()=>{
     const R=render(w,W,H);
     return R.pts.length>10 && inBounds(R,W,H);
   });
 });

 t('7 font never exceeds 12px at any width', ()=>
   sizes.every(([W,H])=> render(w,W,H).texts.every(t2=>t2.px<=12)));

 t('8 stats box lines do not overlap', ()=>{
   const R=render(w,1900,232);
   const box=R.rects.filter(r=>r.w>60&&r.w<600&&r.h>20&&r.h<90).pop();
   if(!box) return false;
   const inside=R.texts.filter(t2=>t2.x>=box.x-1&&t2.x<=box.x+box.w&&t2.y>=box.y&&t2.y<=box.y+box.h+2);
   if(inside.length!==3) return false;
   inside.sort((a,b)=>a.y-b.y);
   return (inside[1].y-inside[0].y)>=inside[0].px && (inside[2].y-inside[1].y)>=inside[1].px;
 });
 t('9 stats box text stays inside its own box', ()=>{
   const R=render(w,1900,232);
   const box=R.rects.filter(r=>r.w>60&&r.w<600&&r.h>20&&r.h<90).pop();
   const inside=R.texts.filter(t2=>t2.y>=box.y&&t2.y<=box.y+box.h+2&&t2.x>=box.x-1);
   return inside.every(t2=> t2.x + t2.s.length*t2.px*0.56 <= box.x+box.w+1);
 });
 t('10 stats box never runs off the right edge', ()=>
   sizes.every(([W,H])=>{
     const R=render(w,W,H);
     const box=R.rects.filter(r=>r.w>60&&r.w<700&&r.h>20&&r.h<90).pop();
     return !box || (box.x+box.w<=W);
   }));
 t('11 stats box suppressed when the drawer is very short', ()=>{
   const R=render(w,1900,95);
   const box=R.rects.filter(r=>r.w>60&&r.w<700&&r.h>20&&r.h<90).pop();
   return !box;
 });
 t('12 tiny canvas bails out instead of drawing garbage', ()=>
   render(w,60,40).pts.length===0);
 t('13 axis titles still drawn at normal size', ()=>{
   const R=render(w,1280,232);
   return R.texts.some(t2=>/Flow \(cfs\)/.test(t2.s)) && R.texts.some(t2=>/Time \(min\)/.test(t2.s));
 });
 t('14 peak marker sits inside the plot area', ()=>{
   const R=render(w,1280,232);
   return inBounds(R,1280,232,0.5);
 });

 // drawer chrome
 t('15 drawer resize grip exists', ()=> d.getElementById('dr-grip')!==null);
 t('16 canvas absolutely fills the drawer body', ()=>{
   const st=d.getElementById('hydro-canvas').getAttribute('style');
   return /position:absolute/.test(st) && /inset:0/.test(st);
 });

 // regressions
 t('17 flow path chain Tt still works', ()=>{
   w.curTool='junction'; w.onDrawCreated({layer:w.L.marker([32.7185,-117.1715]),layerType:'marker'});
   w.curTool='junction'; w.onDrawCreated({layer:w.L.marker([32.7185,-117.1655]),layerType:'marker'});
   const ids=Object.keys(w.appState.nodes);
   w.appState.nodes[ids[0]].elev=1706; w.appState.nodes[ids[1]].elev=1690;
   w.curTool='link';
   w.onDrawCreated({layer:w.L.polyline([[32.7185,-117.1715],[32.7185,-117.1655]]),layerType:'polyline'});
   const fp=Object.values(w.appState.flowpaths)[0];
   return fp.Tt>0 && fp.slopeSrc==='from node elevations';
 });
 t('18 genHydro benchmark unchanged', ()=>{
   const h=w.genHydro(10,0.6,20,34.3,[0.332,0.476,0.576,0.790,1.119,1.518,1.815,4.108]);
   return h.N===36&&h.vol===49.30&&h.Tp===245; });
 t('19 basemaps switch', ()=>{ w.switchBasemap('sat');
   const ok=TX('sbm')==='Satellite'; w.switchBasemap('esritopo'); return ok; });
 t('20 NOAA CSV still loads', ()=> w.loadNOAAText(CSV,'x.csv')===true);
 t('21 no 4-hr field', ()=> d.getElementById('n240')===null);
 t('22 no em dash', ()=> html.indexOf('\u2014')===-1);
 t('23 zero runtime errors', ()=> errs.length===0);

 console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
 console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
 errs.slice(0,4).forEach(e=>console.log('  ERR '+e));
 process.exit(0);
},6000);
