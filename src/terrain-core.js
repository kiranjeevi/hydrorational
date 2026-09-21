/* ═══════════════════════════════════════════════════════════════
   TERRAIN ENGINE, PHASE A
   A Grid is a regular raster in one working CRS with elevations in
   one working vertical unit (US survey feet for San Diego County).

   Two facts that drive the whole design, both verified against the
   services rather than assumed:
     1. 3DEP exportImage returns the raster in whatever CRS you ask
        for, so the base terrain can arrive already in State Plane.
     2. Its elevation values are always METRES, whatever the
        horizontal unit is. Treating them as feet understates the
        ground by a factor of 3.28.
   ═══════════════════════════════════════════════════════════════ */

var M_TO_USFT = 3.2808333333333;      // US survey foot
var M_TO_IFT  = 3.280839895;          // international foot

/* San Diego County work sits in California State Plane Zone 6. */
var CRS_DEFS = {
  'EPSG:2230': '+proj=lcc +lat_0=32.1666666666667 +lon_0=-116.25 ' +
               '+lat_1=33.8833333333333 +lat_2=32.7833333333333 ' +
               '+x_0=2000000.0001016 +y_0=500000.0001016 ' +
               '+datum=NAD83 +units=us-ft +no_defs',
  'EPSG:2229': '+proj=lcc +lat_0=33.5 +lon_0=-118 +lat_1=35.4666666666667 ' +
               '+lat_2=34.0333333333333 +x_0=2000000.0001016 +y_0=500000.0001016 ' +
               '+datum=NAD83 +units=us-ft +no_defs'
};
var WORKING_CRS = 'EPSG:2230';

function registerCRS(proj4) {
  if (!proj4) return false;
  Object.keys(CRS_DEFS).forEach(function (k) {
    if (!proj4.defs(k)) proj4.defs(k, CRS_DEFS[k]);
  });
  return true;
}

/* ── GRID ──────────────────────────────────────────────────────
   x0, y0 are the LOWER LEFT corner. Row 0 is the NORTH row, which
   matches both GeoTIFF and ESRI ASCII ordering.
   ────────────────────────────────────────────────────────────── */
function makeGrid(o) {
  return {
    crs: o.crs || WORKING_CRS,
    x0: o.x0, y0: o.y0, cell: o.cell,
    ncols: o.ncols, nrows: o.nrows,
    z: o.z || new Float32Array(o.ncols * o.nrows),
    name: o.name || 'grid',
    kind: o.kind || 'grid',
    vUnits: 'ft',                 // always feet once ingested
    priority: o.priority || 0
  };
}

function gridBounds(g) {
  return { xmin: g.x0, ymin: g.y0,
           xmax: g.x0 + g.ncols * g.cell,
           ymax: g.y0 + g.nrows * g.cell };
}

function gridIndex(g, r, c) { return r * g.ncols + c; }

/* Bilinear sample at a point in grid CRS. NaN outside or on nodata. */
function gridSample(g, x, y) {
  var fx = (x - g.x0) / g.cell - 0.5;
  var fy = (g.y0 + g.nrows * g.cell - y) / g.cell - 0.5;   // row space, down positive
  if (!(fx >= -0.5) || !(fy >= -0.5)) return NaN;
  if (fx > g.ncols - 0.5 || fy > g.nrows - 0.5) return NaN;
  var c0 = Math.floor(fx), r0 = Math.floor(fy);
  var tx = fx - c0, ty = fy - r0;
  var c1 = c0 + 1, r1 = r0 + 1;
  c0 = Math.max(0, Math.min(g.ncols - 1, c0)); c1 = Math.max(0, Math.min(g.ncols - 1, c1));
  r0 = Math.max(0, Math.min(g.nrows - 1, r0)); r1 = Math.max(0, Math.min(g.nrows - 1, r1));
  var z00 = g.z[gridIndex(g, r0, c0)], z01 = g.z[gridIndex(g, r0, c1)];
  var z10 = g.z[gridIndex(g, r1, c0)], z11 = g.z[gridIndex(g, r1, c1)];
  if (isNaN(z00) || isNaN(z01) || isNaN(z10) || isNaN(z11)) return NaN;
  var a = z00 + (z01 - z00) * tx;
  var b = z10 + (z11 - z10) * tx;
  return a + (b - a) * ty;
}

/* Target grid covering bounds at a given cell size */
function makeTarget(bounds, cell, crs) {
  var ncols = Math.max(2, Math.ceil((bounds.xmax - bounds.xmin) / cell));
  var nrows = Math.max(2, Math.ceil((bounds.ymax - bounds.ymin) / cell));
  return makeGrid({ crs: crs || WORKING_CRS, x0: bounds.xmin, y0: bounds.ymin,
                    cell: cell, ncols: ncols, nrows: nrows, name: 'target' });
}

function cellCentre(g, r, c) {
  return { x: g.x0 + (c + 0.5) * g.cell,
           y: g.y0 + (g.nrows - 1 - r + 0.5) * g.cell };
}

/* Resample a source grid onto the target. Returns a Float32Array of
   target size, NaN where the source has nothing. Reprojects when the
   source CRS differs and proj4 is available. */
function resampleOnto(src, target, proj4) {
  var out = new Float32Array(target.ncols * target.nrows);
  var needProj = src.crs !== target.crs;
  for (var r = 0; r < target.nrows; r++) {
    for (var c = 0; c < target.ncols; c++) {
      var p = cellCentre(target, r, c);
      var x = p.x, y = p.y;
      if (needProj && proj4) {
        try { var t = proj4(target.crs, src.crs, [x, y]); x = t[0]; y = t[1]; }
        catch (e) { out[gridIndex(target, r, c)] = NaN; continue; }
      }
      out[gridIndex(target, r, c)] = gridSample(src, x, y);
    }
  }
  return out;
}

/* ── COMPOSITE ────────────────────────────────────────────────
   Highest priority layer wins wherever it has data. Returns the
   surface plus which layer supplied each cell, so the seam can be
   reported and drawn.
   ────────────────────────────────────────────────────────────── */
function compositeStack(layers, target, proj4) {
  var n = target.ncols * target.nrows;
  var z = new Float32Array(n), src = new Int16Array(n);
  for (var i = 0; i < n; i++) { z[i] = NaN; src[i] = -1; }

  var ordered = layers.slice().sort(function (a, b) { return b.priority - a.priority; });
  var bands = ordered.map(function (L) { return resampleOnto(L, target, proj4); });

  for (var k = 0; k < ordered.length; k++) {
    var band = bands[k];
    for (var j = 0; j < n; j++) {
      if (src[j] === -1 && !isNaN(band[j])) { z[j] = band[j]; src[j] = k; }
    }
  }
  return { z: z, src: src, order: ordered, bands: bands, target: target };
}

/* Where two layers overlap, how far apart are they vertically?
   A seam that is out by more than a few tenths will push flow the
   wrong way once D8 routing runs over it. */
function seamStats(comp, hiIndex, loIndex) {
  var a = comp.bands[hiIndex], b = comp.bands[loIndex];
  if (!a || !b) return null;
  var n = 0, sum = 0, sumAbs = 0, mx = 0, mn = Infinity;
  for (var i = 0; i < a.length; i++) {
    if (isNaN(a[i]) || isNaN(b[i])) continue;
    var d = a[i] - b[i];
    n++; sum += d; sumAbs += Math.abs(d);
    if (Math.abs(d) > Math.abs(mx)) mx = d;
    if (Math.abs(d) < mn) mn = Math.abs(d);
  }
  if (!n) return { overlap: 0 };
  return { overlap: n, mean: sum / n, meanAbs: sumAbs / n, max: mx,
           hi: comp.order[hiIndex].name, lo: comp.order[loIndex].name };
}

/* Cells on the boundary between two different sources */
function seamCells(comp) {
  var t = comp.target, out = [];
  for (var r = 1; r < t.nrows - 1; r++) {
    for (var c = 1; c < t.ncols - 1; c++) {
      var i = gridIndex(t, r, c), s = comp.src[i];
      if (s < 0) continue;
      if (comp.src[i - 1] !== s || comp.src[i + 1] !== s ||
          comp.src[i - t.ncols] !== s || comp.src[i + t.ncols] !== s) {
        out.push({ r: r, c: c });
      }
    }
  }
  return out;
}

/* ── INGEST: ESRI ASCII ───────────────────────────────────────── */
function gridFromAscii(text, opts) {
  opts = opts || {};
  var lines = text.split(/[\r\n]+/), hdr = {}, row = 0;
  var keys = ['ncols','nrows','xllcorner','yllcorner','xllcenter','yllcenter','cellsize','nodata_value'];
  while (row < lines.length && row < 12) {
    var m = lines[row].trim().match(/^([A-Za-z_]+)\s+(-?[\d.eE+]+)/);
    if (!m || keys.indexOf(m[1].toLowerCase()) < 0) break;
    hdr[m[1].toLowerCase()] = parseFloat(m[2]); row++;
  }
  if (!hdr.ncols || !hdr.nrows || !hdr.cellsize) return null;
  var ncols = hdr.ncols, nrows = hdr.nrows;
  var z = new Float32Array(ncols * nrows);
  var nodata = hdr.nodata_value !== undefined ? hdr.nodata_value : -9999;
  var vf = (opts.vUnits === 'm') ? M_TO_USFT : 1;
  var shift = opts.vShift || 0;
  var filled = 0;
  for (var r = row, gr = 0; r < lines.length && gr < nrows; r++) {
    var s = lines[r].trim(); if (!s) continue;
    var vals = s.split(/\s+/);
    for (var c = 0; c < ncols; c++) {
      var v = parseFloat(vals[c]);
      z[gr * ncols + c] = (isNaN(v) || v === nodata) ? NaN : v * vf + shift;
    }
    gr++; filled++;
  }
  if (filled < nrows) return null;
  return makeGrid({
    crs: opts.crs || WORKING_CRS,
    x0: hdr.xllcorner !== undefined ? hdr.xllcorner : (hdr.xllcenter - hdr.cellsize / 2),
    y0: hdr.yllcorner !== undefined ? hdr.yllcorner : (hdr.yllcenter - hdr.cellsize / 2),
    cell: hdr.cellsize, ncols: ncols, nrows: nrows, z: z,
    name: opts.name || 'ASCII grid', kind: 'asc', priority: opts.priority || 1
  });
}

/* ── INGEST: XYZ survey points, gridded through a Delaunay TIN ── */
function parseXYZPoints(text) {
  var pts = [], lines = text.split(/[\r\n]+/);
  for (var i = 0; i < lines.length; i++) {
    var s = lines[i].trim();
    if (!s || /^[A-Za-z]/.test(s)) continue;          // skip headers
    var p = s.split(/[,;\t\s]+/).map(Number);
    if (p.length >= 3 && isFinite(p[0]) && isFinite(p[1]) && isFinite(p[2])) {
      pts.push([p[0], p[1], p[2]]);
    }
  }
  return pts;
}

/* Rasterize a TIN by scanning each triangle, barycentric interpolation */
function rasterizeTIN(pts, triangles, target, opts) {
  opts = opts || {};
  var vf = (opts.vUnits === 'm') ? M_TO_USFT : 1, shift = opts.vShift || 0;
  var z = new Float32Array(target.ncols * target.nrows);
  for (var i = 0; i < z.length; i++) z[i] = NaN;

  for (var t = 0; t < triangles.length; t += 3) {
    var a = pts[triangles[t]], b = pts[triangles[t+1]], c = pts[triangles[t+2]];
    var minX = Math.min(a[0], b[0], c[0]), maxX = Math.max(a[0], b[0], c[0]);
    var minY = Math.min(a[1], b[1], c[1]), maxY = Math.max(a[1], b[1], c[1]);
    var c0 = Math.max(0, Math.floor((minX - target.x0) / target.cell - 0.5));
    var c1 = Math.min(target.ncols - 1, Math.ceil((maxX - target.x0) / target.cell));
    var top = target.y0 + target.nrows * target.cell;
    var r0 = Math.max(0, Math.floor((top - maxY) / target.cell - 0.5));
    var r1 = Math.min(target.nrows - 1, Math.ceil((top - minY) / target.cell));
    var d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(d) < 1e-12) continue;
    for (var r = r0; r <= r1; r++) {
      for (var cc = c0; cc <= c1; cc++) {
        var p = cellCentre(target, r, cc);
        var w0 = ((b[1] - c[1]) * (p.x - c[0]) + (c[0] - b[0]) * (p.y - c[1])) / d;
        var w1 = ((c[1] - a[1]) * (p.x - c[0]) + (a[0] - c[0]) * (p.y - c[1])) / d;
        var w2 = 1 - w0 - w1;
        if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
        z[gridIndex(target, r, cc)] = (w0 * a[2] + w1 * b[2] + w2 * c[2]) * vf + shift;
      }
    }
  }
  return z;
}

/* ── CONTOURS, marching squares ───────────────────────────────── */
function contourLines(g, interval, zArr) {
  var z = zArr || g.z;
  var mn = Infinity, mx = -Infinity;
  for (var i = 0; i < z.length; i++) {
    var v = z[i]; if (isNaN(v)) continue;
    if (v < mn) mn = v; if (v > mx) mx = v;
  }
  if (!isFinite(mn) || !isFinite(mx)) return [];
  var out = [];
  var start = Math.ceil(mn / interval) * interval;
  for (var lev = start; lev <= mx; lev += interval) {
    var segs = marchLevel(g, z, lev);
    if (segs.length) out.push({ level: +lev.toFixed(4), lines: joinSegments(segs, g.cell * 0.01) });
  }
  return out;
}

function marchLevel(g, z, lev) {
  var segs = [];
  function ip(x1, y1, v1, x2, y2, v2) {
    var t = (lev - v1) / (v2 - v1);
    return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
  }
  for (var r = 0; r < g.nrows - 1; r++) {
    for (var c = 0; c < g.ncols - 1; c++) {
      var tl = z[gridIndex(g, r, c)],     tr = z[gridIndex(g, r, c + 1)];
      var bl = z[gridIndex(g, r + 1, c)], br = z[gridIndex(g, r + 1, c + 1)];
      if (isNaN(tl) || isNaN(tr) || isNaN(bl) || isNaN(br)) continue;
      var pTL = cellCentre(g, r, c),     pTR = cellCentre(g, r, c + 1);
      var pBL = cellCentre(g, r + 1, c), pBR = cellCentre(g, r + 1, c + 1);
      var idx = (tl > lev ? 8 : 0) | (tr > lev ? 4 : 0) | (br > lev ? 2 : 0) | (bl > lev ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      var T = ip(pTL.x, pTL.y, tl, pTR.x, pTR.y, tr);
      var R = ip(pTR.x, pTR.y, tr, pBR.x, pBR.y, br);
      var B = ip(pBL.x, pBL.y, bl, pBR.x, pBR.y, br);
      var Lf = ip(pTL.x, pTL.y, tl, pBL.x, pBL.y, bl);
      switch (idx) {
        case 1: case 14: segs.push([Lf, B]); break;
        case 2: case 13: segs.push([B, R]); break;
        case 3: case 12: segs.push([Lf, R]); break;
        case 4: case 11: segs.push([T, R]); break;
        case 6: case 9:  segs.push([T, B]); break;
        case 7: case 8:  segs.push([Lf, T]); break;
        case 5:  segs.push([Lf, T]); segs.push([B, R]); break;
        case 10: segs.push([Lf, B]); segs.push([T, R]); break;
      }
    }
  }
  return segs;
}

function joinSegments(segs, tol) {
  var key = function (p) { return Math.round(p[0] / tol) + ',' + Math.round(p[1] / tol); };
  var map = {};
  segs.forEach(function (s, i) {
    [key(s[0]), key(s[1])].forEach(function (k) {
      (map[k] = map[k] || []).push(i);
    });
  });
  var used = new Array(segs.length).fill(false), lines = [];
  for (var i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    var line = [segs[i][0], segs[i][1]];
    for (var end = 0; end < 2; end++) {
      var grow = true;
      while (grow) {
        grow = false;
        var tip = end === 0 ? line[line.length - 1] : line[0];
        var cand = map[key(tip)] || [];
        for (var j = 0; j < cand.length; j++) {
          var s = cand[j]; if (used[s]) continue;
          var a = segs[s][0], b = segs[s][1];
          var next = (key(a) === key(tip)) ? b : (key(b) === key(tip) ? a : null);
          if (!next) continue;
          used[s] = true;
          if (end === 0) line.push(next); else line.unshift(next);
          grow = true; break;
        }
      }
    }
    if (line.length > 1) lines.push(line);
  }
  return lines;
}

/* ── PROFILE ──────────────────────────────────────────────────── */
function profileAlong(pointsXY, sampler, step) {
  var out = [], dist = 0;
  for (var i = 0; i < pointsXY.length - 1; i++) {
    var a = pointsXY[i], b = pointsXY[i + 1];
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var len = Math.sqrt(dx * dx + dy * dy);
    var n = Math.max(1, Math.ceil(len / step));
    for (var k = 0; k < n; k++) {
      var t = k / n;
      var x = a[0] + dx * t, y = a[1] + dy * t;
      out.push({ d: dist + len * t, x: x, y: y, z: sampler(x, y) });
    }
    dist += len;
  }
  var last = pointsXY[pointsXY.length - 1];
  out.push({ d: dist, x: last[0], y: last[1], z: sampler(last[0], last[1]) });
  return out;
}

/* Overall and segment gradients from a profile */
function profileStats(prof) {
  var valid = prof.filter(function (p) { return !isNaN(p.z); });
  if (valid.length < 2) return null;
  var a = valid[0], b = valid[valid.length - 1];
  var drop = a.z - b.z, run = b.d - a.d;
  var mn = Infinity, mx = -Infinity;
  valid.forEach(function (p) { if (p.z < mn) mn = p.z; if (p.z > mx) mx = p.z; });
  return {
    length: run, zStart: a.z, zEnd: b.z, drop: drop,
    slopePct: run > 0 ? (drop / run) * 100 : 0,
    min: mn, max: mx, samples: valid.length, gaps: prof.length - valid.length
  };
}

if (typeof module !== 'undefined') {
  module.exports = { M_TO_USFT, CRS_DEFS, WORKING_CRS, registerCRS, makeGrid, gridBounds,
    gridIndex, gridSample, makeTarget, cellCentre, resampleOnto, compositeStack, seamStats,
    seamCells, gridFromAscii, parseXYZPoints, rasterizeTIN, contourLines, marchLevel,
    joinSegments, profileAlong, profileStats };
}

/* ── INGEST: GeoTIFF ───────────────────────────────────────────
   Takes the pieces a decoded GeoTIFF gives us, so the same code
   serves the browser build and the test harness. 3DEP elevations
   are metres regardless of the horizontal unit, which is why
   vUnits has to be stated by the caller rather than guessed.
   ────────────────────────────────────────────────────────────── */
function gridFromGeoTIFFParts(parts, opts) {
  opts = opts || {};
  var w = parts.width, h = parts.height;
  var res = parts.resolution;            // [dx, dy] with dy negative
  var org = parts.origin;                // [x of left edge, y of top edge]
  var data = parts.data;
  if (!w || !h || !res || !org || !data) return null;

  var cell = Math.abs(res[0]);
  if (Math.abs(Math.abs(res[1]) - cell) > cell * 0.02) return null;   // must be square

  var crs = opts.crs;
  if (!crs && parts.geoKeys && parts.geoKeys.ProjectedCSTypeGeoKey) {
    crs = 'EPSG:' + parts.geoKeys.ProjectedCSTypeGeoKey;
  }
  if (!crs && parts.geoKeys && parts.geoKeys.GeographicTypeGeoKey) {
    crs = 'EPSG:' + parts.geoKeys.GeographicTypeGeoKey;
  }

  var vf = (opts.vUnits === 'm') ? M_TO_USFT : 1;
  var shift = opts.vShift || 0;
  var nodata = (opts.nodata === undefined) ? -9999 : opts.nodata;

  var z = new Float32Array(w * h);
  for (var i = 0; i < w * h; i++) {
    var v = data[i];
    z[i] = (v === null || v === undefined || isNaN(v) || v <= nodata + 1e-6) ? NaN : v * vf + shift;
  }
  return makeGrid({
    crs: crs || WORKING_CRS,
    x0: org[0], y0: org[1] - h * cell,
    cell: cell, ncols: w, nrows: h, z: z,
    name: opts.name || 'GeoTIFF', kind: opts.kind || 'geotiff',
    priority: opts.priority === undefined ? 1 : opts.priority
  });
}

/* Bounds of a working-CRS box expanded by a margin, for tile requests */
function expandBounds(b, margin) {
  return { xmin: b.xmin - margin, ymin: b.ymin - margin,
           xmax: b.xmax + margin, ymax: b.ymax + margin };
}

/* 3DEP request URL. The service reprojects for us, so the tile can
   arrive already in the working CRS. Elevations come back in metres. */
function dep3Url(bounds, crsCode, size) {
  var epsg = String(crsCode).replace(/^EPSG:/i, '');
  return 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage' +
    '?bbox=' + [bounds.xmin, bounds.ymin, bounds.xmax, bounds.ymax].join(',') +
    '&bboxSR=' + epsg + '&imageSR=' + epsg +
    '&size=' + size[0] + ',' + size[1] +
    '&format=tiff&pixelType=F32&noData=-9999' +
    '&interpolation=RSP_BilinearInterpolation&f=image';
}

/* Pick a request size that respects the service cap and a memory budget */
function tileSize(bounds, cell, maxPx) {
  maxPx = maxPx || 2048;
  var w = Math.ceil((bounds.xmax - bounds.xmin) / cell);
  var h = Math.ceil((bounds.ymax - bounds.ymin) / cell);
  var s = Math.max(w, h);
  if (s > maxPx) { var f = maxPx / s; w = Math.floor(w * f); h = Math.floor(h * f); }
  return [Math.max(2, w), Math.max(2, h)];
}

if (typeof module !== 'undefined') {
  module.exports.gridFromGeoTIFFParts = gridFromGeoTIFFParts;
  module.exports.expandBounds = expandBounds;
  module.exports.dep3Url = dep3Url;
  module.exports.tileSize = tileSize;
}

/* ── PERSISTING A GRID ─────────────────────────────────────────
   Survey and proposed surfaces have to travel with the project,
   because they are the one thing a user cannot get back. 3DEP is
   stored as a stub, since it can be re-fetched from its bounds.

   Elevations are quantised to 0.01 ft when the range allows, which
   halves the payload against raw float32 and is far finer than any
   survey tolerance.
   ────────────────────────────────────────────────────────────── */
var GRID_NODATA_I16 = -32768;

function bytesToB64(u8) {
  var s = '', chunk = 0x8000;
  for (var i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  }
  return btoa(s);
}
function b64ToBytes(b64) {
  var s = atob(b64), u8 = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

function gridMeta(g) {
  return { id: g.id, name: g.name, kind: g.kind, crs: g.crs,
           x0: g.x0, y0: g.y0, cell: g.cell,
           ncols: g.ncols, nrows: g.nrows,
           priority: g.priority, vSrc: g.vSrc };
}

function encodeGrid(g, opts) {
  opts = opts || {};
  var meta = gridMeta(g);
  if (opts.stubOnly) { meta.enc = 'stub'; return meta; }

  var n = g.ncols * g.nrows, mn = Infinity, mx = -Infinity, any = false;
  for (var i = 0; i < n; i++) {
    var v = g.z[i];
    if (isNaN(v)) continue;
    any = true;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  if (!any) { meta.enc = 'empty'; return meta; }

  meta.zmin = +mn.toFixed(4);
  if (mx - mn <= 320) {
    meta.enc = 'i16'; meta.scale = 0.01;
    var a = new Int16Array(n);
    for (var j = 0; j < n; j++) {
      var z = g.z[j];
      a[j] = isNaN(z) ? GRID_NODATA_I16 : Math.round((z - mn) / meta.scale);
    }
    meta.data = bytesToB64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  } else {
    meta.enc = 'f32';
    var f = new Float32Array(g.z);
    meta.data = bytesToB64(new Uint8Array(f.buffer, f.byteOffset, f.byteLength));
  }
  return meta;
}

function decodeGrid(o) {
  if (!o || !o.ncols || !o.nrows) return null;
  var n = o.ncols * o.nrows;
  var g = makeGrid({ crs: o.crs, x0: o.x0, y0: o.y0, cell: o.cell,
                     ncols: o.ncols, nrows: o.nrows,
                     name: o.name, kind: o.kind, priority: o.priority });
  g.id = o.id; g.vSrc = o.vSrc;
  if (o.enc === 'stub') return null;          // caller re-fetches these
  if (o.enc === 'empty' || !o.data) {
    for (var e = 0; e < n; e++) g.z[e] = NaN;
    return g;
  }
  var bytes = b64ToBytes(o.data);
  if (o.enc === 'i16') {
    var a = new Int16Array(bytes.buffer, bytes.byteOffset, n);
    for (var i = 0; i < n; i++) {
      g.z[i] = (a[i] === GRID_NODATA_I16) ? NaN : o.zmin + a[i] * o.scale;
    }
  } else {
    var f = new Float32Array(bytes.buffer, bytes.byteOffset, n);
    for (var k = 0; k < n; k++) g.z[k] = f[k];
  }
  return g;
}

if (typeof module !== 'undefined') {
  module.exports.encodeGrid = encodeGrid;
  module.exports.decodeGrid = decodeGrid;
  module.exports.gridMeta = gridMeta;
  module.exports.bytesToB64 = bytesToB64;
  module.exports.b64ToBytes = b64ToBytes;
}
