// Validate the terrain core against a real 3DEP tile over Alpine, CA.
const T = require('../src/terrain-core.js');
const { fromFile } = require('geotiff');
const pass=[],fail=[];
const t=(n,f)=>{try{f()?pass.push(n):fail.push(n);}catch(e){fail.push(n+' -> '+e.message);}};

(async ()=>{
  const tif = await fromFile('../samples/alpine_3dep.tif');
  const img = await tif.getImage();
  const parts = {
    width: img.getWidth(), height: img.getHeight(),
    resolution: img.getResolution(), origin: img.getOrigin(),
    geoKeys: img.getGeoKeys(), data: (await img.readRasters())[0]
  };

  const wrong = T.gridFromGeoTIFFParts(parts, {name:'3DEP as feet'});           // no conversion
  const right = T.gridFromGeoTIFFParts(parts, {vUnits:'m', name:'3DEP'});       // metres declared

  const EPQS_CENTRE = 1789.98;   // ft, from the USGS point service
  const b = T.gridBounds(right);
  const cx = (b.xmin+b.xmax)/2, cy = (b.ymin+b.ymax)/2;

  t('1 CRS is read from the GeoTIFF geokeys', ()=> right.crs==='EPSG:2230');
  t('2 grid dimensions match the image', ()=> right.ncols===512 && right.nrows===512);
  t('3 cell size is square and in feet', ()=> Math.abs(right.cell-6.0285)<0.01);
  t('4 origin converts from top edge to lower left', ()=>
    Math.abs(right.y0 - (parts.origin[1] - 512*right.cell)) < 1e-6);
  t('5 declaring metres matches the USGS point service', ()=>
    Math.abs(T.gridSample(right,cx,cy) - EPQS_CENTRE) < 1.0);
  t('6 NOT declaring metres is wrong by the foot factor', ()=>{
    const v=T.gridSample(wrong,cx,cy);
    return Math.abs(v*T.M_TO_USFT - EPQS_CENTRE) < 1.0 && Math.abs(v-EPQS_CENTRE) > 1000;
  });
  t('7 elevations are plausible for Alpine', ()=>{
    let mn=Infinity,mx=-Infinity;
    for(const v of right.z){ if(isNaN(v))continue; if(v<mn)mn=v; if(v>mx)mx=v; }
    return mn>1600 && mx<1950;
  });
  t('8 the tile has no holes', ()=>{
    let nan=0; for(const v of right.z) if(isNaN(v)) nan++;
    return nan===0;
  });
  t('9 contours over real ground come out at sane intervals', ()=>{
    const cs=T.contourLines(right,5);
    return cs.length>8 && cs.every(c=>Math.abs(c.level%5)<1e-6) && cs[0].lines.length>0;
  });
  t('10 a profile across the tile returns a real gradient', ()=>{
    const s=(x,y)=>T.gridSample(right,x,y);
    const prof=T.profileAlong([[b.xmin+50,cy],[b.xmax-50,cy]], s, 10);
    const st=T.profileStats(prof);
    return st.gaps===0 && st.samples>250 && Math.abs(st.slopePct)<40 && st.max>st.min;
  });
  t('11 the request URL asks for the working CRS both ways', ()=>{
    const u=T.dep3Url({xmin:1,ymin:2,xmax:3,ymax:4},'EPSG:2230',[512,512]);
    return /bboxSR=2230/.test(u) && /imageSR=2230/.test(u) && /pixelType=F32/.test(u);
  });
  t('12 tile size honours the pixel budget', ()=>{
    const s=T.tileSize({xmin:0,ymin:0,xmax:10000,ymax:5000}, 1, 2048);
    return s[0]===2048 && s[1]===1024;
  });
  t('13 survey on top of 3DEP composites and reports the seam', ()=>{
    // a fake survey patch 0.75 ft above the real ground, in the middle of the tile
    const st=T.makeTarget({xmin:cx-200,ymin:cy-200,xmax:cx+200,ymax:cy+200}, 4, 'EPSG:2230');
    const sz=new Float32Array(st.ncols*st.nrows);
    for(let r=0;r<st.nrows;r++) for(let c=0;c<st.ncols;c++){
      const p=T.cellCentre(st,r,c);
      sz[T.gridIndex(st,r,c)] = T.gridSample(right,p.x,p.y)+0.75;
    }
    const surv=T.makeGrid({crs:'EPSG:2230',x0:st.x0,y0:st.y0,cell:st.cell,
      ncols:st.ncols,nrows:st.nrows,z:sz,name:'survey',priority:2});
    const tgt=T.makeTarget({xmin:cx-600,ymin:cy-600,xmax:cx+600,ymax:cy+600}, 5, 'EPSG:2230');
    const comp=T.compositeStack([right,surv],tgt,null);
    const seam=T.seamStats(comp,0,1);
    return seam.overlap>1000 && Math.abs(seam.mean-0.75)<0.05 && comp.order[0].name==='survey';
  });

  console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
  console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
  process.exit(fail.length?1:0);
})();
