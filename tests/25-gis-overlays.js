// Reference overlays: FEMA base flood elevations and cross sections, NHD
// flowlines and waterbodies, NWI wetlands, SSURGO soil groups and NLCD.
// The services are stubbed with responses captured from them.
const { JSDOM, VirtualConsole } = require('jsdom');
const fs=require('fs');
const html=fs.readFileSync('../public/index.html','utf8');
const BFE=JSON.parse(fs.readFileSync('../samples/nfhl_bfe_mission_valley.json','utf8'));
const XS=JSON.parse(fs.readFileSync('../samples/nfhl_xs_mission_valley.json','utf8'));
const SDA=JSON.parse(fs.readFileSync('../samples/sda_hsg_alpine.json','utf8'));
const errs=[]; const vc=new VirtualConsole();
vc.on('jsdomError',e=>errs.push(e.detail?e.detail.message:e.message));
const dom=new JSDOM(html,{runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,
  url:'https://hydrorational.web.app/',virtualConsole:vc});
const pass=[],fail=[];
const t=(n,f)=>{try{f()?pass.push(n):fail.push(n);}catch(e){fail.push(n+' -> '+e.message);}};
const wait=ms=>new Promise(r=>setTimeout(r,ms));

const NHD_FL={type:'FeatureCollection',features:[
  {type:'Feature',properties:{gnis_name:'San Diego River',ftype:460},
   geometry:{type:'LineString',coordinates:[[-117.16,32.765],[-117.15,32.768]]}}]};
const NHD_WB={type:'FeatureCollection',features:[
  {type:'Feature',properties:{gnis_name:'Kumeyaay Lake',ftype:390},
   geometry:{type:'Polygon',coordinates:[[[-117.05,32.83],[-117.04,32.83],[-117.04,32.84],[-117.05,32.83]]]}}]};
const NWI={type:'FeatureCollection',features:[
  {type:'Feature',properties:{'Wetlands.ATTRIBUTE':'PUBHh','Wetlands.WETLAND_TYPE':'Freshwater Pond','Wetlands.ACRES':2.9755},
   geometry:{type:'Polygon',coordinates:[[[-117.18,32.76],[-117.17,32.76],[-117.17,32.77],[-117.18,32.76]]]}}]};

setTimeout(async ()=>{
 const w=dom.window,d=dom.window.document;
 w.open=()=>null; w.confirm=()=>true;
 let asked=[], posted=[], hold=null;
 const reply=(body)=>Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(body),
   text:()=>Promise.resolve(JSON.stringify(body))});
 w.fetch=(u,o)=>{ asked.push(u);
   if(o&&o.method==='POST'){ posted.push({u,body:JSON.parse(o.body)}); return reply(SDA); }
   const go=()=>{
     if(/NFHL\/MapServer\/16\/query/.test(u)) return reply(BFE);
     if(/NFHL\/MapServer\/14\/query/.test(u)) return reply(XS);
     if(/NHDPlus_HR\/MapServer\/3\/query/.test(u)) return reply(NHD_FL);
     if(/NHDPlus_HR\/MapServer\/9\/query/.test(u)) return reply(NHD_WB);
     if(/Wetlands\/MapServer\/0\/query/.test(u)) return reply(NWI);
     return reply({error:{code:400,message:'Failed to execute query.'}});
   };
   return hold ? hold.then(go) : go();
 };
 const check=(id,on)=>{ const el=d.getElementById(id); el.checked=on; el.dispatchEvent(new w.Event('change')); };
 const onMap=k=>!!(w.gisGroups[k] && w.map.hasLayer(w.gisGroups[k]));

 t('1 no layer toggle in the panel is a placeholder any more', ()=>
   !/onchange="T\(/.test(html) && /coming soon/i.test(html)===false);
 t('2 every reference toggle has an id the globe button can find', ()=>
   ['tog-fema','tog-bfe','tog-nhd','tog-nhdwb','tog-nwi','tog-nlcd','tog-hsg-A','tog-hsg-B','tog-hsg-C','tog-hsg-D']
     .every(id=>d.getElementById(id)));

 // parsing, against the captured NFHL responses
 const bfes=w.bfeLinesFromEsri(BFE), xss=w.xsFromEsri(XS);
 t('3 BFE lines keep their published elevation, unit and datum', ()=>
   bfes.length===4 && bfes[0].elev===40 && bfes[0].unit==='ft' && bfes[0].datum==='NAVD88');
 t('4 coordinates come back as lat, lng for Leaflet', ()=>{
   const p=bfes[0].paths[0][0]; return p[0]>32 && p[0]<33 && p[1]<-117;
 });
 t('5 the label reads the way a FIRM does', ()=>w.bfeLabel(bfes[0])==='BFE 40 ft NAVD88' &&
   w.bfeLabel({elev:41.5,unit:'ft',datum:''})==='BFE 41.5 ft');
 t('6 NFHL null elevations are dropped, not drawn as -9999', ()=>{
   const r=w.bfeLinesFromEsri({features:[{attributes:{ELEV:-9999,LEN_UNIT:'Feet'},geometry:{paths:[[[-117,32],[-117.1,32.1]]]}},
     {attributes:{ELEV:12,LEN_UNIT:'Feet'},geometry:{paths:[[[-117,32]]]}}]});
   return r.length===0;
 });
 t('7 cross sections carry the regulatory water surface', ()=>{
   const c=xss.filter(x=>x.letter==='C')[0];
   return xss.length===21 && c && c.wsel===28.8 && c.bed===17.2 && c.stream==='San Diego River' &&
     /Cross section C, San Diego River, 1% WSEL 28\.8 ft NAVD88, bed 17\.2/.test(w.xsLabel(c));
 });
 t('8 a blank cross section letter does not print as a space', ()=>{
   const blank=xss.filter(x=>x.letter==='')[0];
   return blank && /^Cross section, San Diego River/.test(w.xsLabel(blank));
 });

 // drawing
 w.map.setView([32.767,-117.155],16);
 asked=[]; check('tog-bfe',true); await wait(50);
 t('9 BFE asks NFHL layers 16 and 14 for the view', ()=>
   asked.some(u=>/NFHL\/MapServer\/16\/query.*outFields=ELEV/.test(u)) &&
   asked.some(u=>/NFHL\/MapServer\/14\/query.*WSEL_REG/.test(u)));
 t('10 the lines and cross sections are drawn and labelled', ()=>{
   const g=w.gisGroups.bfe; if(!g||!onMap('bfe')) return false;
   const ls=g.getLayers();
   const labelled=ls.filter(l=>l.getTooltip()&&l.getTooltip().options.permanent);
   return ls.length===25 && labelled.length===4 && /BFE 40 ft NAVD88/.test(labelled[0].getTooltip().getContent());
 });
 t('11 BFE lines sit above the cross sections', ()=>{
   const ls=w.gisGroups.bfe.getLayers(); return ls[ls.length-1].options.color==='#8e3a9d';
 });
 check('tog-bfe',false);
 t('12 switching off hides the layer and keeps the cache', ()=>!onMap('bfe') && w.gisGroups.bfe);
 asked=[]; check('tog-bfe',true);
 t('13 switching back on shows the cache without asking again', ()=>onMap('bfe') && asked.length===0);

 // a fetch that lands after the toggle went off stays hidden
 let release; hold=new Promise(r=>release=r);
 check('tog-nhd',true); check('tog-nhd',false); release(); await wait(50); hold=null;
 t('14 a late reply does not show a layer the user switched off', ()=>w.gisGroups.nhd && !onMap('nhd'));
 t('15 streams come from NHDPlus HR flowlines, layer 3, not NHDPoint', ()=>
   asked.some(u=>/NHDPlus_HR\/MapServer\/3\/query/.test(u)) && !asked.some(u=>/NHDPlus_HR\/MapServer\/2\//.test(u)));

 check('tog-nhdwb',true); await wait(50);
 t('16 waterbodies come from NHD layer 9 and are named', ()=>
   onMap('nhdwb') && /Kumeyaay Lake/.test(w.gisGroups.nhdwb.getLayers()[0].getTooltip().getContent()));
 check('tog-nwi',true); await wait(50);
 t('17 wetlands show the NWI code, type and acreage', ()=>{
   const l=w.gisGroups.nwi&&w.gisGroups.nwi.getLayers()[0];
   return onMap('nwi') && l.getTooltip().getContent()==='PUBHh, Freshwater Pond, 2.98 ac' &&
          l.options.fillColor==='#2E86C1';
 });

 // soils
 t('18 WKT polygons parse, holes and multipolygons included', ()=>{
   const a=w.parseWKTPolygons('POLYGON ((-117 32, -116 32, -116 33, -117 32), (-116.8 32.2, -116.7 32.2, -116.7 32.3, -116.8 32.2))');
   const b=w.parseWKTPolygons('MULTIPOLYGON (((-117 32, -116 32, -116 33, -117 32)), ((-115 31, -114 31, -114 32, -115 31)))');
   return a.length===1 && a[0].length===2 && a[0][0][0][0]===32 && a[0][0][0][1]===-117 &&
          b.length===2 && b[1][0][1][1]===-114 && w.parseWKTPolygons('POINT (1 2)').length===0;
 });
 t('19 every captured SSURGO polygon parses to a closed ring', ()=>
   SDA.Table.every(r=>{ const p=w.parseWKTPolygons(r[2]); const ring=p[0]&&p[0][0];
     return ring && ring.length>3 && ring[0][0]===ring[ring.length-1][0]; }));
 t('20 soils need the proxy and say so', ()=>{
   d.getElementById('opt-proxy').value=''; posted=[];
   const ok=w.loadSoilsMap(); return ok===false && posted.length===0;
 });
 d.getElementById('opt-proxy').value='https://hydrorational.web.app';
 t('21 a view too large for Soil Data Access is refused, not sent', ()=>{
   const gb=w.map.getBounds; w.map.getBounds=()=>w.L.latLngBounds([32.5,-117.3],[33.0,-116.5]);
   posted=[]; const ok=w.loadSoilsMap(); w.map.getBounds=gb; return ok===false && posted.length===0;
 });
 posted=[]; check('tog-hsg-C',true); await wait(50);
 t('22 one soils query goes through the proxy to SDA with the view polygon', ()=>
   posted.length===1 && /\/api\/proxy\?url=https%3A%2F%2FSDMDataAccess/.test(posted[0].u) &&
   /SDA_Get_Mupolygonkey_from_intersection_with_WktWgs84\('polygon\(\(/.test(posted[0].body.query) &&
   /majcompflag = 'Yes'/.test(posted[0].body.query));
 t('23 the reply fills all four groups and shows only the one switched on', ()=>
   w.gisGroups.hsgC && w.gisGroups.hsgC.getLayers().length===12 &&
   w.gisGroups.hsgD.getLayers().length===1 && w.gisGroups.hsgA.getLayers().length===0 &&
   onMap('hsgC') && !onMap('hsgD'));
 posted=[]; check('tog-hsg-D',true);
 t('24 turning on another group uses the same reply', ()=>posted.length===0 && onMap('hsgD'));
 t('25 dual groups file under the first letter and keep the full label', ()=>{
   const r=w.soilRowsToGroups([['1','A/D','POLYGON ((-117 32, -116 32, -116 33, -117 32))'],
                              ['2','','POLYGON ((-117 32, -116 32, -116 33, -117 32))']]);
   return r.counts.A===1 && r.counts.none===1 &&
          /HSG A\/D, map unit 1/.test(r.groups.A.getLayers()[0].getTooltip().getContent());
 });

 check('tog-nlcd',true);
 t('26 NLCD land cover is the 2021 WMS layer from MRLC', ()=>
   onMap('nlcd') && w.gisGroups.nlcd.wmsParams.layers==='NLCD_2021_Land_Cover_L48' &&
   /mrlc\.gov\/geoserver\/mrlc_display\/wms/.test(w.gisGroups.nlcd._url));

 // the globe button
 const oldBfe=w.gisGroups.bfe; asked=[];
 w.fetchAllGIS(); await wait(80);
 t('27 Fetch refetches what is on and removes the old copy from the map', ()=>
   !w.map.hasLayer(oldBfe) && onMap('bfe') && w.gisGroups.bfe!==oldBfe &&
   asked.some(u=>/MapServer\/16\/query/.test(u)) && asked.some(u=>/Wetlands/.test(u)));
 t('28 Fetch leaves switched off layers alone', ()=>!asked.some(u=>/NHDPlus_HR\/MapServer\/3\//.test(u)));
 let svcErr=null;
 await w.gisJSON('https://x/unknown').then(()=>{ svcErr='resolved'; },e=>{ svcErr=e.message; });
 t('29 a service error comes back as a readable message', ()=>svcErr==='Failed to execute query');
 t('30 existing hydrology is untouched', ()=>{
   const h=w.genHydro(10,0.6,20,34.3,[0.332,0.476,0.576,0.790,1.119,1.518,1.815,4.108]);
   return h.N===36&&h.vol===49.30&&h.Tp===245;
 });
 t('31 no runtime errors beyond the jsdom limits', ()=>
   errs.filter(e=>!/getContext|navigation|Not implemented/.test(e)).length===0);

 console.log('PASS '+pass.length); pass.forEach(x=>console.log('  ok   '+x));
 console.log('FAIL '+fail.length); fail.forEach(x=>console.log('  FAIL '+x));
 errs.filter(e=>!/getContext|navigation|Not implemented/.test(e)).slice(0,3).forEach(e=>console.log('  ERR '+e));
 process.exit(fail.length?1:0);
},7000);
