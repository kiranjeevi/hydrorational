// Builders for synthetic DXF drawings and LAS point clouds whose ground
// is a known plane, so a recovered surface can be checked arithmetically.
const X0 = 6300000, Y0 = 1850000;                 // CA State Plane 6, ft
const PLANE = (x, y) => 500 + 0.02 * (x - X0) - 0.01 * (y - Y0);

function g(code, v) { return code + '\n' + v + '\n'; }

/* A drawing with what a real topo carries:
   contours as LWPOLYLINE at elevation, a 3D breakline, spot POINTs,
   a 3DFACE, a 2D POLYLINE with its elevation on the header,
   a flat property line layer, a storm drain in 3D at its inverts,
   and one mirrored LWPOLYLINE with extrusion (0,0,-1). */
function topoDXF(opts) {
  opts = opts || {};
  let s = g(0, 'SECTION') + g(2, 'HEADER') + g(9, '$INSUNITS') + g(70, opts.insunits || 2) + g(0, 'ENDSEC');
  s += g(0, 'SECTION') + g(2, 'ENTITIES');
  // contours every 2 ft of elevation: z = PLANE is constant along a line
  // 0.02 dx - 0.01 dy = const, i.e. lines of slope 2 in plan.
  for (let lev = 494; lev <= 512; lev += 2) {
    const pts = [];
    for (let t = -400; t <= 400; t += 40) {
      // pick y along the strip, solve x on the plane
      const y = Y0 + 200 + t;
      const x = X0 + (lev - 500 + 0.01 * (y - Y0)) / 0.02;
      pts.push([x, y]);
    }
    s += g(0, 'LWPOLYLINE') + g(8, 'C-TOPO-MAJR') + g(90, pts.length) + g(70, 0) + g(38, lev.toFixed(2));
    pts.forEach(p => { s += g(10, p[0].toFixed(3)) + g(20, p[1].toFixed(3)); });
  }
  // 3D breakline (flow line) on the plane
  s += g(0, 'POLYLINE') + g(8, 'C-TOPO-BRKL') + g(66, 1) + g(70, 8) + g(10, 0) + g(20, 0) + g(30, 0);
  for (let k = 0; k <= 6; k++) {
    const x = X0 + 50 + 40 * k, y = Y0 + 100 + 30 * k;
    s += g(0, 'VERTEX') + g(8, 'C-TOPO-BRKL') + g(10, x) + g(20, y) + g(30, PLANE(x, y).toFixed(3)) + g(70, 32);
  }
  s += g(0, 'SEQEND') + g(8, 'C-TOPO-BRKL');
  // spot elevations
  [[X0 + 120, Y0 + 260], [X0 + 260, Y0 + 330]].forEach(p => {
    s += g(0, 'POINT') + g(8, 'V-TOPO-SPOT') + g(10, p[0]) + g(20, p[1]) + g(30, PLANE(p[0], p[1]).toFixed(3));
  });
  // a 3DFACE with the 4th corner repeating the 3rd
  const F = [[X0 + 10, Y0 + 400], [X0 + 60, Y0 + 400], [X0 + 60, Y0 + 450]];
  s += g(0, '3DFACE') + g(8, 'C-TOPO-FACE');
  F.concat([F[2]]).forEach((p, j) => { s += g(10 + j, p[0]) + g(20 + j, p[1]) + g(30 + j, PLANE(p[0], p[1]).toFixed(3)); });
  // a 2D polyline: vertices carry x, y; elevation sits on the POLYLINE
  const lev2 = 503, y2a = Y0 + 150, y2b = Y0 + 250;
  const xs = y => X0 + (lev2 - 500 + 0.01 * (y - Y0)) / 0.02;
  s += g(0, 'POLYLINE') + g(8, 'C-TOPO-MINR') + g(66, 1) + g(70, 0) + g(10, 0) + g(20, 0) + g(30, lev2);
  [y2a, y2b].forEach(y => { s += g(0, 'VERTEX') + g(8, 'C-TOPO-MINR') + g(10, xs(y)) + g(20, y) + g(30, 0); });
  s += g(0, 'SEQEND');
  // mirrored contour: OCS normal (0,0,-1), so world x = -ocs x and z = -elevation
  const lev3 = 505, ym = [Y0 + 300, Y0 + 340];
  s += g(0, 'LWPOLYLINE') + g(8, 'C-TOPO-MIRR') + g(90, 2) + g(70, 0) + g(38, (-lev3).toFixed(2));
  ym.forEach(y => { s += g(10, (-(X0 + (lev3 - 500 + 0.01 * (y - Y0)) / 0.02)).toFixed(3)) + g(20, y); });
  s += g(210, 0) + g(220, 0) + g(230, -1);
  // flat 2D property line, z = 0 everywhere
  s += g(0, 'LWPOLYLINE') + g(8, 'V-PROP-LINE') + g(90, 2) + g(70, 0);
  s += g(10, X0) + g(20, Y0) + g(10, X0 + 500) + g(20, Y0);
  // storm drain drawn at inverts, 8 ft below ground
  s += g(0, 'POLYLINE') + g(8, 'C-STRM-PIPE') + g(66, 1) + g(70, 8) + g(10, 0) + g(20, 0) + g(30, 0);
  [[X0 + 100, Y0 + 200], [X0 + 300, Y0 + 220]].forEach(p => {
    s += g(0, 'VERTEX') + g(8, 'C-STRM-PIPE') + g(10, p[0]) + g(20, p[1]) + g(30, (PLANE(p[0], p[1]) - 8).toFixed(3)) + g(70, 32);
  });
  s += g(0, 'SEQEND');
  // text is ignored
  s += g(0, 'TEXT') + g(8, 'V-TOPO-TEXT') + g(10, X0) + g(20, Y0) + g(30, 999) + g(40, 2) + g(1, '999.0');
  s += g(0, 'ENDSEC') + g(0, 'EOF');
  return s;
}

/* A LAS file. fmt 1 (LAS 1.2) or 6 (LAS 1.4). Ground on the plane is
   class 2, a "building" 25 ft above it is class 6, noise class 7. */
function makeLAS(opts) {
  opts = opts || {};
  const fmt = opts.fmt === undefined ? 1 : opts.fmt;
  const v14 = fmt >= 6;
  const headerSize = v14 ? 375 : 227;
  const recLen = v14 ? 30 : 28;
  const pts = [];
  const spacing = opts.spacing || 6;
  for (let x = X0; x <= X0 + 300; x += spacing) {
    for (let y = Y0; y <= Y0 + 300; y += spacing) {
      const inBldg = x > X0 + 100 && x < X0 + 160 && y > Y0 + 100 && y < Y0 + 160;
      const cls = opts.unclassified ? 1 : (inBldg ? 6 : 2);
      pts.push([x, y, PLANE(x, y) + (inBldg ? 25 : 0), cls]);
    }
  }
  pts.push([X0 + 150, Y0 + 150, 9999, 7]);           // a bird
  let vlr = new Uint8Array(0);
  if (opts.epsg || opts.wkt) {
    const body = opts.wkt ? new TextEncoder().encode(opts.wkt + '\0')
                          : (() => { const b = new DataView(new ArrayBuffer(8 + 2 * 8));
                                     b.setUint16(0, 1, true); b.setUint16(2, 1, true); b.setUint16(4, 0, true); b.setUint16(6, 2, true);
                                     b.setUint16(8, 3072, true); b.setUint16(10, 0, true); b.setUint16(12, 1, true); b.setUint16(14, opts.epsg, true);
                                     b.setUint16(16, 4099, true); b.setUint16(18, 0, true); b.setUint16(20, 1, true); b.setUint16(22, opts.vcode || 9003, true);
                                     return new Uint8Array(b.buffer); })();
    vlr = new Uint8Array(54 + body.length);
    const d = new DataView(vlr.buffer);
    'LASF_Projection'.split('').forEach((c, i) => d.setUint8(2 + i, c.charCodeAt(0)));
    d.setUint16(18, opts.wkt ? 2112 : 34735, true); d.setUint16(20, body.length, true);
    vlr.set(body, 54);
  }
  const offset = headerSize + vlr.length;
  const buf = new ArrayBuffer(offset + pts.length * recLen);
  const dv = new DataView(buf);
  'LASF'.split('').forEach((c, i) => dv.setUint8(i, c.charCodeAt(0)));
  dv.setUint8(24, 1); dv.setUint8(25, v14 ? 4 : 2);
  dv.setUint16(94, headerSize, true); dv.setUint32(96, offset, true);
  dv.setUint32(100, vlr.length ? 1 : 0, true);
  dv.setUint8(104, fmt | (opts.laz ? 0x80 : 0)); dv.setUint16(105, recLen, true);
  dv.setUint32(107, v14 ? 0 : pts.length, true);
  const sc = 0.01, off = [X0, Y0, 0];
  [sc, sc, sc].forEach((v, i) => dv.setFloat64(131 + 8 * i, v, true));
  off.forEach((v, i) => dv.setFloat64(155 + 8 * i, v, true));
  if (v14) { dv.setUint32(247, pts.length, true); dv.setUint32(251, 0, true); }
  new Uint8Array(buf).set(vlr, headerSize);
  pts.forEach((p, k) => {
    const o = offset + k * recLen;
    dv.setInt32(o, Math.round((p[0] - off[0]) / sc), true);
    dv.setInt32(o + 4, Math.round((p[1] - off[1]) / sc), true);
    dv.setInt32(o + 8, Math.round((p[2] - off[2]) / sc), true);
    dv.setUint8(o + (v14 ? 16 : 15), p[3]);
  });
  return { buf, pts };
}

module.exports = { X0, Y0, PLANE, topoDXF, makeLAS };
