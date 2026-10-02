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
               '+datum=NAD83 +units=us-ft +no_defs',
  /* NAD83(2011) realisation of zone 6, which newer surveys and lidar
     tiles declare. At drainage scale it is the same grid as 2230. */
  'EPSG:6426': '+proj=lcc +lat_0=32.1666666666667 +lon_0=-116.25 ' +
               '+lat_1=33.8833333333333 +lat_2=32.7833333333333 ' +
               '+x_0=2000000.0001016 +y_0=500000.0001016 ' +
               '+datum=NAD83 +units=us-ft +no_defs',
  /* UTM zone 11 north in metres, the grid USGS 3DEP lidar is delivered in */
  'EPSG:26911': '+proj=utm +zone=11 +datum=NAD83 +units=m +no_defs',
  'EPSG:6340':  '+proj=utm +zone=11 +datum=NAD83 +units=m +no_defs'
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
           priority: g.priority, vSrc: g.vSrc, edit: g.edit || undefined };
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
  if (o.edit) g.edit = o.edit;
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

/* ═══════════════════════════════════════════════════════════════
   POINT SOURCES: CAD DRAWINGS AND LIDAR
   Both end as x, y, z points that go through the same Delaunay TIN
   as survey points. Nothing here guesses a unit or a datum; what a
   file declares is reported back so the app can check it against
   what the engineer selected.
   ═══════════════════════════════════════════════════════════════ */

/* ── TIN helpers ─────────────────────────────────────────────── */
function triEdgeLengths(pts, tri, t) {
  var a = pts[tri[t]], b = pts[tri[t + 1]], c = pts[tri[t + 2]];
  return [Math.hypot(a[0] - b[0], a[1] - b[1]),
          Math.hypot(b[0] - c[0], b[1] - c[1]),
          Math.hypot(c[0] - a[0], c[1] - a[1])];
}

/* Median edge length of a triangulation, the yardstick for trimming */
function medianTriEdge(pts, tri) {
  var e = [];
  for (var t = 0; t < tri.length; t += 3) {
    var l = triEdgeLengths(pts, tri, t);
    e.push(l[0], l[1], l[2]);
  }
  if (!e.length) return 0;
  e.sort(function (x, y) { return x - y; });
  return e[Math.floor(e.length / 2)];
}

/* Drop triangles with any edge longer than maxEdge. A Delaunay TIN
   always fills the convex hull, so across a concave site edge or a
   gap between drawings it invents ground. Those triangles are long. */
function trimTIN(pts, tri, maxEdge) {
  if (!(maxEdge > 0)) return { triangles: tri, dropped: 0 };
  var out = [], dropped = 0;
  for (var t = 0; t < tri.length; t += 3) {
    var l = triEdgeLengths(pts, tri, t);
    if (l[0] > maxEdge || l[1] > maxEdge || l[2] > maxEdge) { dropped++; continue; }
    out.push(tri[t], tri[t + 1], tri[t + 2]);
  }
  return { triangles: out, dropped: dropped };
}

/* Remove repeated x, y. The first elevation found at a location wins,
   and how many disagreed is counted rather than averaged away. */
function dedupePoints(pts, tol) {
  tol = tol || 1e-3;
  var seen = {}, out = [], conflicts = 0;
  for (var i = 0; i < pts.length; i++) {
    var p = pts[i];
    var k = Math.round(p[0] / tol) + ',' + Math.round(p[1] / tol);
    if (seen[k] === undefined) { seen[k] = p[2]; out.push(p); }
    else if (Math.abs(seen[k] - p[2]) > 0.01) conflicts++;
  }
  return { points: out, conflicts: conflicts };
}

/* Add vertices along a polyline so no segment is longer than maxSeg.
   z is interpolated linearly, which is exact for a contour (constant
   z) and for a 3D breakline between its vertices. */
function densifyLine(line, maxSeg) {
  if (!(maxSeg > 0) || line.length < 2) return line.slice();
  var out = [line[0]];
  for (var i = 1; i < line.length; i++) {
    var a = line[i - 1], b = line[i];
    var d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    var n = Math.ceil(d / maxSeg);
    for (var k = 1; k < n; k++) {
      var f = k / n;
      out.push([a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])]);
    }
    out.push(b);
  }
  return out;
}

/* ── INGEST: DXF ─────────────────────────────────────────────────
   ASCII DXF only. Reads elevations from POINT, LINE, 3DFACE,
   LWPOLYLINE (elevation in group 38), and POLYLINE with its VERTEX
   records: 3D polylines carry z per vertex, 2D polylines carry one
   elevation on the POLYLINE itself. Entities whose every z is zero are
   2D linework and are skipped and counted, not read as sea level.
   Text, blocks and Civil 3D objects are not read. */
var DXF_INSUNITS = { 1: 'in', 2: 'ft', 3: 'mi', 4: 'mm', 5: 'cm', 6: 'm', 21: 'ft' };

function dxfPairs(text) {
  var lines = String(text).split(/\r\n|\r|\n/), out = [];
  for (var i = 0; i + 1 < lines.length; i += 2) {
    var code = parseInt(lines[i].trim(), 10);
    if (isNaN(code)) { i -= 1; continue; }            // resync on a stray line
    out.push([code, lines[i + 1].replace(/\s+$/, '').replace(/^\s+/, '')]);
  }
  return out;
}

function dxfNum(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

/* The arbitrary axis algorithm for the one non-trivial case drawings
   contain in practice, a mirrored object with extrusion (0, 0, -1).
   Anything tilted is reported as skipped rather than projected. */
function dxfOCS(ent) {
  var nx = ent.n[0], ny = ent.n[1], nz = ent.n[2];
  if (Math.abs(nx) < 1e-9 && Math.abs(ny) < 1e-9) return nz > 0 ? 1 : -1;
  return 0;
}

function parseDXFTerrain(text, opts) {
  opts = opts || {};
  var res = { points: [], layers: {}, insunits: null, units: null,
              skippedFlat: 0, skippedTilted: 0, entities: 0, binary: false };
  if (/^AutoCAD Binary DXF/.test(String(text).slice(0, 22))) { res.binary = true; return res; }
  var pr = dxfPairs(text), section = null, i = 0;

  function layerOf(name) {
    var k = name || '0';
    if (!res.layers[k]) res.layers[k] = { name: k, count: 0, zmin: Infinity, zmax: -Infinity,
                                          entities: 0, flat: 0, types: {} };
    return res.layers[k];
  }
  function emit(layer, type, verts, isLine) {
    var L = layerOf(layer);
    var allZero = verts.every(function (v) { return v[2] === 0; });
    if (allZero) { L.flat++; res.skippedFlat++; return; }
    if (isLine && opts.maxSeg) verts = densifyLine(verts, opts.maxSeg);
    L.entities++; res.entities++;
    L.types[type] = (L.types[type] || 0) + 1;
    verts.forEach(function (v) {
      res.points.push([v[0], v[1], v[2], L.name]);
      L.count++;
      if (v[2] < L.zmin) L.zmin = v[2];
      if (v[2] > L.zmax) L.zmax = v[2];
    });
  }
  function readEntity() {                  // pr[i] is [0, TYPE]
    var ent = { type: pr[i][1], layer: '0', c: {}, list: [], n: [0, 0, 1] };
    i++;
    while (i < pr.length && pr[i][0] !== 0) {
      var code = pr[i][0], v = pr[i][1];
      if (code === 8) ent.layer = v;
      else if (code === 210) ent.n[0] = dxfNum(v);
      else if (code === 220) ent.n[1] = dxfNum(v);
      else if (code === 230) ent.n[2] = dxfNum(v);
      if (ent.c[code] === undefined) ent.c[code] = v;
      ent.list.push([code, v]);
      i++;
    }
    return ent;
  }
  function xyz(ent, cx, cy, cz) {
    return [dxfNum(ent.c[cx]), dxfNum(ent.c[cy]), dxfNum(ent.c[cz])];
  }

  while (i < pr.length) {
    var p = pr[i];
    if (p[0] === 0 && p[1] === 'SECTION') {
      section = (pr[i + 1] && pr[i + 1][0] === 2) ? pr[i + 1][1] : null;
      i += 2; continue;
    }
    if (p[0] === 0 && p[1] === 'ENDSEC') { section = null; i++; continue; }
    if (section === 'HEADER' && p[0] === 9 && p[1] === '$INSUNITS') {
      if (pr[i + 1] && pr[i + 1][0] === 70) res.insunits = parseInt(pr[i + 1][1], 10);
      i += 2; continue;
    }
    if (section !== 'ENTITIES' || p[0] !== 0) { i++; continue; }

    var ent = readEntity(), t = ent.type;
    if (t === 'POINT') {
      emit(ent.layer, t, [xyz(ent, 10, 20, 30)], false);
    } else if (t === 'LINE') {
      emit(ent.layer, t, [xyz(ent, 10, 20, 30), xyz(ent, 11, 21, 31)], true);
    } else if (t === '3DFACE') {
      var f = [xyz(ent, 10, 20, 30), xyz(ent, 11, 21, 31), xyz(ent, 12, 22, 32), xyz(ent, 13, 23, 33)];
      if (f[3][0] === f[2][0] && f[3][1] === f[2][1] && f[3][2] === f[2][2]) f.pop();
      emit(ent.layer, t, f, false);
    } else if (t === 'LWPOLYLINE') {
      var o = dxfOCS(ent);
      if (!o) { res.skippedTilted++; continue; }
      var elev = dxfNum(ent.c[38]) * o, verts = [], cur = null;
      ent.list.forEach(function (q) {
        if (q[0] === 10) { cur = [dxfNum(q[1]) * o, 0, elev]; verts.push(cur); }
        else if (q[0] === 20 && cur) cur[1] = dxfNum(q[1]);
      });
      if ((parseInt(ent.c[70], 10) & 1) && verts.length > 2) verts.push(verts[0].slice());
      if (verts.length) emit(ent.layer, t, verts, true);
    } else if (t === 'POLYLINE') {
      var flags = parseInt(ent.c[70], 10) || 0;
      var is3d = !!(flags & 8), mesh = !!(flags & 16) || !!(flags & 64);
      var o2 = is3d || mesh ? 1 : dxfOCS(ent);
      var pelev = dxfNum(ent.c[30]) * (o2 || 1), vs = [];
      while (i < pr.length && pr[i][0] === 0 && pr[i][1] === 'VERTEX') {
        var v = readEntity(), vf = parseInt(v.c[70], 10) || 0;
        if (vf & 128 && !(vf & 64)) continue;           // polyface face record, no position
        if (vf & 16) continue;                          // spline frame control point
        var vx = dxfNum(v.c[10]), vy = dxfNum(v.c[20]);
        if (is3d || mesh) vs.push([vx, vy, dxfNum(v.c[30])]);
        else vs.push([vx * (o2 || 1), vy, pelev]);
      }
      if (i < pr.length && pr[i][0] === 0 && pr[i][1] === 'SEQEND') readEntity();
      if (!is3d && !mesh && !o2) { res.skippedTilted++; continue; }
      if ((flags & 1) && vs.length > 2 && !mesh) vs.push(vs[0].slice());
      if (vs.length) emit(ent.layer, t, vs, !mesh);
    }
  }
  res.units = DXF_INSUNITS[res.insunits] || null;
  return res;
}

/* Pick the points on the chosen layers, ready for the TIN */
function dxfPointsOnLayers(parsed, layerNames) {
  var want = {};
  (layerNames || []).forEach(function (n) { want[n] = true; });
  var out = [];
  parsed.points.forEach(function (p) { if (want[p[3]]) out.push([p[0], p[1], p[2]]); });
  return out;
}

/* Layers that look like utilities rather than ground. Pipes are drawn
   in 3D at their inverts, which would cut trenches into the surface. */
var DXF_NOT_GROUND = /(^|[-_ ])(PIPE|SD|SS|SEW|SEWER|STORM|WATER|WTR|W|GAS|ELEC|UTIL|UTILITY|INV|INVERT|CONDUIT|TEL|FO)([-_ ]|$)/i;
function dxfDefaultLayers(parsed) {
  return Object.keys(parsed.layers).filter(function (k) {
    var L = parsed.layers[k];
    return L.count > 0 && !DXF_NOT_GROUND.test(k);
  });
}

/* ── INGEST: LAS lidar ──────────────────────────────────────────
   LAS 1.0 to 1.4, point formats 0 to 10. Ground is class 2. When a
   file carries no class 2 points it is unclassified, and every point
   is used with a warning, since buildings and trees then sit in the
   surface. LAZ is compressed and is refused with a pointer to the fix. */
function parseLASHeader(buf) {
  var dv = new DataView(buf);
  if (buf.byteLength < 227) return { error: 'too short to be a LAS file' };
  var sig = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (sig !== 'LASF') return { error: 'not a LAS file' };
  var h = {
    major: dv.getUint8(24), minor: dv.getUint8(25),
    headerSize: dv.getUint16(94, true), offset: dv.getUint32(96, true),
    nvlr: dv.getUint32(100, true), formatRaw: dv.getUint8(104),
    recLen: dv.getUint16(105, true), count: dv.getUint32(107, true),
    scale: [dv.getFloat64(131, true), dv.getFloat64(139, true), dv.getFloat64(147, true)],
    off: [dv.getFloat64(155, true), dv.getFloat64(163, true), dv.getFloat64(171, true)],
    max: [dv.getFloat64(179, true), dv.getFloat64(195, true), dv.getFloat64(211, true)],
    min: [dv.getFloat64(187, true), dv.getFloat64(203, true), dv.getFloat64(219, true)]
  };
  h.compressed = !!(h.formatRaw & 0xC0);
  h.format = h.formatRaw & 0x3F;
  if (h.minor >= 4 && buf.byteLength >= 255 && h.headerSize >= 375) {
    var big = dv.getUint32(247, true) + dv.getUint32(251, true) * 4294967296;
    if (big > 0) h.count = big;
  }
  return h;
}

/* The whole KEY[...] block from a WKT string, brackets matched */
function wktBlock(w, key) {
  var i = w.indexOf(key + '[');
  if (i < 0) return null;
  var depth = 0;
  for (var j = i + key.length; j < w.length; j++) {
    if (w[j] === '[') depth++;
    else if (w[j] === ']') { depth--; if (!depth) return w.slice(i, j + 1); }
  }
  return null;
}

/* The CRS and vertical unit the file declares, from its GeoKey or WKT
   record. Returned as found; the app decides what to do with it. */
var GEO_VUNITS = { 9001: 'm', 9002: 'ft', 9003: 'ft' };
function lasGeoref(buf, h) {
  var dv = new DataView(buf), pos = h.headerSize, out = { epsg: null, vUnits: null, hUnits: null, wkt: null };
  for (var k = 0; k < h.nvlr && pos + 54 <= buf.byteLength; k++) {
    var uid = '';
    for (var j = 0; j < 16; j++) { var ch = dv.getUint8(pos + 2 + j); if (ch) uid += String.fromCharCode(ch); }
    var rid = dv.getUint16(pos + 18, true), len = dv.getUint16(pos + 20, true), body = pos + 54;
    if (uid === 'LASF_Projection' && rid === 34735 && body + 8 <= buf.byteLength) {
      var nkeys = dv.getUint16(body + 6, true);
      for (var q = 0; q < nkeys; q++) {
        var e = body + 8 + q * 8;
        if (e + 8 > buf.byteLength) break;
        var id = dv.getUint16(e, true), loc = dv.getUint16(e + 2, true), val = dv.getUint16(e + 6, true);
        if (loc !== 0) continue;
        if (id === 3072) out.epsg = 'EPSG:' + val;
        else if (id === 4099) out.vUnits = GEO_VUNITS[val] || null;
        else if (id === 3076) out.hUnits = GEO_VUNITS[val] || null;
      }
    } else if (uid === 'LASF_Projection' && rid === 2112) {
      var w = '';
      for (var b = 0; b < len && body + b < buf.byteLength; b++) {
        var c = dv.getUint8(body + b); if (c) w += String.fromCharCode(c);
      }
      out.wkt = w;
      var pj = wktBlock(w, 'PROJCS') || wktBlock(w, 'PROJCRS');
      var pe = pj && pj.match(/(?:AUTHORITY|ID)\["EPSG",\s*"?(\d+)"?\]\]\s*$/);
      if (pe) out.epsg = 'EPSG:' + pe[1];
      var vb = wktBlock(w, 'VERT_CS') || wktBlock(w, 'VERTCRS');
      var vu = vb && vb.match(/(?:UNIT|LENGTHUNIT)\["([^"]+)"/);
      if (vu) out.vUnits = /met/i.test(vu[1]) ? 'm' : (/f(oo|ee)t/i.test(vu[1]) ? 'ft' : null);
    }
    pos = body + len;
  }
  return out;
}

function parseLAS(buf, opts) {
  opts = opts || {};
  var h = parseLASHeader(buf);
  if (h.error) return { error: h.error };
  if (h.compressed) return { error: 'compressed (LAZ)', header: h };
  if (h.format > 10) return { error: 'point format ' + h.format + ' is not a LAS format', header: h };
  var dv = new DataView(buf), classAt = h.format >= 6 ? 16 : 15;
  var n = Math.min(h.count, Math.floor((buf.byteLength - h.offset) / h.recLen));
  var cls = {}, ground = [], all = [], want = opts.classes || [2];
  var wantSet = {}; want.forEach(function (c) { wantSet[c] = true; });
  var step = Math.max(1, opts.stride || 1);
  for (var k = 0; k < n; k++) {
    var p = h.offset + k * h.recLen;
    var cl = dv.getUint8(p + classAt);
    if (h.format < 6) cl = cl & 31;
    cls[cl] = (cls[cl] || 0) + 1;
    if (k % step) continue;
    var x = dv.getInt32(p, true) * h.scale[0] + h.off[0];
    var y = dv.getInt32(p + 4, true) * h.scale[1] + h.off[1];
    var z = dv.getInt32(p + 8, true) * h.scale[2] + h.off[2];
    if (wantSet[cl]) ground.push([x, y, z]);
    else if (cl !== 7 && cl !== 18) all.push([x, y, z]);  // keep noise out of the fallback
  }
  var unclassified = !ground.length;
  return { header: h, georef: lasGeoref(buf, h), classes: cls, read: n,
           points: unclassified ? all : ground, unclassified: unclassified };
}

/* Thin points to one per bin, the bin mean. Lidar ground runs to many
   points per square foot; the composite works far coarser than that. */
function binPoints(pts, cell) {
  if (!pts.length || !(cell > 0)) return pts;
  var xmin = Infinity, ymin = Infinity;
  pts.forEach(function (p) { if (p[0] < xmin) xmin = p[0]; if (p[1] < ymin) ymin = p[1]; });
  var bins = {};
  pts.forEach(function (p) {
    var k = Math.floor((p[0] - xmin) / cell) + ',' + Math.floor((p[1] - ymin) / cell);
    var b = bins[k] || (bins[k] = [0, 0, 0, 0]);
    b[0] += p[0]; b[1] += p[1]; b[2] += p[2]; b[3]++;
  });
  return Object.keys(bins).map(function (k) {
    var b = bins[k]; return [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
  });
}

if (typeof module !== 'undefined') {
  module.exports.medianTriEdge = medianTriEdge;
  module.exports.trimTIN = trimTIN;
  module.exports.dedupePoints = dedupePoints;
  module.exports.densifyLine = densifyLine;
  module.exports.dxfPairs = dxfPairs;
  module.exports.parseDXFTerrain = parseDXFTerrain;
  module.exports.dxfPointsOnLayers = dxfPointsOnLayers;
  module.exports.dxfDefaultLayers = dxfDefaultLayers;
  module.exports.parseLASHeader = parseLASHeader;
  module.exports.lasGeoref = lasGeoref;
  module.exports.parseLAS = parseLAS;
  module.exports.binPoints = binPoints;
}

/* ═══════════════════════════════════════════════════════════════
   GRADING EDITS
   A pad or basin drawn in the app, or a footprint raised or lowered,
   becomes its own layer on top of the stack. The layers underneath
   are never written to; removing the edit layer restores them.

   A pad sits at one elevation inside its outline and daylights to
   the ground at H:1 outside it. Per cell outside the outline, at a
   distance d from it, the slope surfaces are elev - d/H (fill) and
   elev + d/H (cut). Ground above the cut surface is cut down to it,
   ground below the fill surface is filled up to it, and ground in
   between is untouched. That one rule covers fill pads, cut basins
   and pads that are part cut and part fill. Corners come out rounded,
   as a daylight offset from a polygon does.
   ═══════════════════════════════════════════════════════════════ */
function pointInPolyXY(x, y, ring) {
  var inside = false;
  for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function distToRingXY(x, y, ring) {
  var best = Infinity;
  for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    var ax = ring[j][0], ay = ring[j][1], bx = ring[i][0], by = ring[i][1];
    var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    var t = L2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    var ex = ax + t * dx - x, ey = ay + t * dy - y, d = ex * ex + ey * ey;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/* base: a grid in the working CRS (the composite). ring: [[x, y]] in
   the same CRS. spec: { mode: 'pad' | 'offset', elev, delta, slope }.
   Returns { grid, cut, fill, changed, footprint } with volumes in
   cubic feet and the footprint in square feet, or null when the
   outline misses the base entirely. */
function gradeEdit(base, ring, spec) {
  if (!ring || ring.length < 3) return null;
  var mode = spec.mode === 'offset' ? 'offset' : 'pad';
  var H = Math.max(0, +spec.slope || 0), elev = +spec.elev, delta = +spec.delta || 0;
  if (mode === 'pad' && !isFinite(elev)) return null;

  var rx0 = Infinity, rx1 = -Infinity, ry0 = Infinity, ry1 = -Infinity;
  ring.forEach(function (p) {
    if (p[0] < rx0) rx0 = p[0]; if (p[0] > rx1) rx1 = p[0];
    if (p[1] < ry0) ry0 = p[1]; if (p[1] > ry1) ry1 = p[1];
  });
  // how far a slope can run: the full relief of the base at H:1
  var reach = 0;
  if (mode === 'pad' && H > 0) {
    var zmn = Infinity, zmx = -Infinity;
    for (var q = 0; q < base.z.length; q++) {
      var vq = base.z[q]; if (isNaN(vq)) continue;
      if (vq < zmn) zmn = vq; if (vq > zmx) zmx = vq;
    }
    if (isFinite(zmn)) reach = H * Math.max(Math.abs(elev - zmn), Math.abs(elev - zmx));
  }
  var cell = base.cell, top = base.y0 + base.nrows * base.cell;
  var c0 = Math.max(0, Math.floor((rx0 - reach - base.x0) / cell) - 1);
  var c1 = Math.min(base.ncols - 1, Math.ceil((rx1 + reach - base.x0) / cell) + 1);
  var r0 = Math.max(0, Math.floor((top - (ry1 + reach)) / cell) - 1);
  var r1 = Math.min(base.nrows - 1, Math.ceil((top - (ry0 - reach)) / cell) + 1);
  if (c1 < c0 || r1 < r0) return null;

  var ncols = c1 - c0 + 1, nrows = r1 - r0 + 1;
  var g = makeGrid({ crs: base.crs, x0: base.x0 + c0 * cell,
                     y0: top - (r1 + 1) * cell, cell: cell,
                     ncols: ncols, nrows: nrows, name: 'grading edit', kind: 'edit' });
  var changed = new Uint8Array(ncols * nrows);
  var cut = 0, fill = 0, nChanged = 0, inside = 0, a = cell * cell;
  for (var r = 0; r < nrows; r++) {
    for (var c = 0; c < ncols; c++) {
      var k = r * ncols + c;
      var zb = base.z[(r + r0) * base.ncols + (c + c0)];
      var p = cellCentre(g, r, c), zn = zb;
      var isIn = pointInPolyXY(p.x, p.y, ring);
      if (isIn) {
        inside++;
        zn = mode === 'pad' ? elev : (isNaN(zb) ? NaN : zb + delta);
      } else if (mode === 'pad' && !isNaN(zb)) {
        if (H > 0) {
          var d = distToRingXY(p.x, p.y, ring);
          var up = elev + d / H, dn = elev - d / H;
          if (zb > up) zn = up; else if (zb < dn) zn = dn;
        }
      }
      g.z[k] = zn;
      if (!isNaN(zn) && (isNaN(zb) || Math.abs(zn - zb) > 1e-6)) {
        changed[k] = 1; nChanged++;
        if (!isNaN(zb)) { if (zn > zb) fill += (zn - zb) * a; else cut += (zb - zn) * a; }
      }
    }
  }
  if (!inside && !nChanged) return null;
  // keep the changed cells and a one cell margin of untouched ground, so
  // the bilinear sampler has neighbours at the edge; blank the rest
  for (var r2 = 0; r2 < nrows; r2++) {
    for (var c2 = 0; c2 < ncols; c2++) {
      var k2 = r2 * ncols + c2;
      if (changed[k2]) continue;
      var near = false;
      for (var dr = -1; dr <= 1 && !near; dr++) {
        for (var dc = -1; dc <= 1; dc++) {
          var rr = r2 + dr, cc = c2 + dc;
          if (rr >= 0 && rr < nrows && cc >= 0 && cc < ncols && changed[rr * ncols + cc]) { near = true; break; }
        }
      }
      if (!near) g.z[k2] = NaN;
    }
  }
  return { grid: g, cut: cut, fill: fill, changed: nChanged, footprint: inside * a };
}

if (typeof module !== 'undefined') {
  module.exports.pointInPolyXY = pointInPolyXY;
  module.exports.distToRingXY = distToRingXY;
  module.exports.gradeEdit = gradeEdit;
}
