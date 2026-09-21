/* ═══════════════════════════════════════════════════════════════
   FLOW ROUTING OVER A GRID
   Priority flood depression filling, D8 direction, accumulation,
   watershed delineation from a pour point, and downslope tracing.

   The epsilon fill matters more than it looks. A raw DEM is full of
   one cell pits, and a single unfilled pit will terminate a traced
   flow path halfway down a hillside and understate Tc.
   ═══════════════════════════════════════════════════════════════ */

var D8_DR = [-1,-1, 0, 1, 1, 1, 0,-1];     // N, NE, E, SE, S, SW, W, NW
var D8_DC = [ 0, 1, 1, 1, 0,-1,-1,-1];

/* minimal binary heap keyed on elevation */
function MinHeap() { this.a = []; }
MinHeap.prototype.push = function (k, v) {
  var a = this.a; a.push([k, v]);
  var i = a.length - 1;
  while (i > 0) { var p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; var t = a[p]; a[p] = a[i]; a[i] = t; i = p; }
};
MinHeap.prototype.pop = function () {
  var a = this.a; if (!a.length) return null;
  var top = a[0], last = a.pop();
  if (a.length) {
    a[0] = last; var i = 0;
    for (;;) {
      var l = 2*i+1, r = l+1, s = i;
      if (l < a.length && a[l][0] < a[s][0]) s = l;
      if (r < a.length && a[r][0] < a[s][0]) s = r;
      if (s === i) break;
      var t = a[s]; a[s] = a[i]; a[i] = t; i = s;
    }
  }
  return top;
};
MinHeap.prototype.size = function () { return this.a.length; };

/* ── PRIORITY FLOOD ───────────────────────────────────────────── */
function fillDepressions(g, z, eps) {
  eps = (eps === undefined) ? 0.001 : eps;
  var n = g.ncols * g.nrows;
  var out = new Float32Array(n);
  var closed = new Uint8Array(n);
  var h = new MinHeap();
  for (var i = 0; i < n; i++) out[i] = z[i];

  for (var r = 0; r < g.nrows; r++) {
    for (var c = 0; c < g.ncols; c++) {
      var i2 = r * g.ncols + c;
      var edge = (r === 0 || c === 0 || r === g.nrows - 1 || c === g.ncols - 1);
      if (isNaN(z[i2])) { closed[i2] = 1; continue; }
      var beside = false;
      if (!edge) {
        for (var k = 0; k < 8; k++) {
          var j = (r + D8_DR[k]) * g.ncols + (c + D8_DC[k]);
          if (isNaN(z[j])) { beside = true; break; }
        }
      }
      if (edge || beside) { closed[i2] = 1; h.push(z[i2], i2); }
    }
  }

  while (h.size()) {
    var top = h.pop(), ci = top[1];
    var cr = (ci / g.ncols) | 0, cc = ci % g.ncols;
    for (var k2 = 0; k2 < 8; k2++) {
      var nr = cr + D8_DR[k2], nc = cc + D8_DC[k2];
      if (nr < 0 || nc < 0 || nr >= g.nrows || nc >= g.ncols) continue;
      var ni = nr * g.ncols + nc;
      if (closed[ni] || isNaN(z[ni])) continue;
      closed[ni] = 1;
      if (out[ni] <= out[ci] + eps) out[ni] = out[ci] + eps;
      h.push(out[ni], ni);
    }
  }
  return out;
}

/* count of cells that still have no downslope neighbour */
function countSinks(g, z) {
  var n = 0;
  for (var r = 1; r < g.nrows - 1; r++) {
    for (var c = 1; c < g.ncols - 1; c++) {
      var i = r * g.ncols + c;
      if (isNaN(z[i])) continue;
      var lower = false, edgeTouch = false;
      for (var k = 0; k < 8; k++) {
        var j = (r + D8_DR[k]) * g.ncols + (c + D8_DC[k]);
        if (isNaN(z[j])) { edgeTouch = true; break; }
        if (z[j] < z[i]) { lower = true; break; }
      }
      if (!lower && !edgeTouch) n++;
    }
  }
  return n;
}

/* ── D8 DIRECTION ─────────────────────────────────────────────── */
function flowDirD8(g, z) {
  var n = g.ncols * g.nrows;
  var dir = new Int8Array(n);
  var diag = Math.SQRT2;
  for (var r = 0; r < g.nrows; r++) {
    for (var c = 0; c < g.ncols; c++) {
      var i = r * g.ncols + c;
      if (isNaN(z[i])) { dir[i] = -1; continue; }
      var best = -1, bestSlope = 0;
      for (var k = 0; k < 8; k++) {
        var nr = r + D8_DR[k], nc = c + D8_DC[k];
        if (nr < 0 || nc < 0 || nr >= g.nrows || nc >= g.ncols) continue;
        var j = nr * g.ncols + nc;
        if (isNaN(z[j])) continue;
        var d = (k % 2 === 0) ? 1 : diag;
        var s = (z[i] - z[j]) / d;
        if (s > bestSlope) { bestSlope = s; best = k; }
      }
      dir[i] = best;
    }
  }
  return dir;
}

/* ── ACCUMULATION ─────────────────────────────────────────────── */
function flowAccum(g, z, dir) {
  var n = g.ncols * g.nrows;
  var acc = new Float32Array(n);
  var order = [];
  for (var i = 0; i < n; i++) { if (!isNaN(z[i])) { acc[i] = 1; order.push(i); } }
  order.sort(function (a, b) { return z[b] - z[a]; });          // highest first
  for (var q = 0; q < order.length; q++) {
    var ci = order[q], k = dir[ci];
    if (k < 0) continue;
    var cr = (ci / g.ncols) | 0, cc = ci % g.ncols;
    var ni = (cr + D8_DR[k]) * g.ncols + (cc + D8_DC[k]);
    acc[ni] += acc[ci];
  }
  return acc;
}

/* ── WATERSHED ────────────────────────────────────────────────── */
function watershedFrom(g, dir, r0, c0) {
  var n = g.ncols * g.nrows;
  var mask = new Uint8Array(n);
  var stack = [r0 * g.ncols + c0];
  mask[stack[0]] = 1;
  while (stack.length) {
    var ci = stack.pop();
    var cr = (ci / g.ncols) | 0, cc = ci % g.ncols;
    for (var k = 0; k < 8; k++) {
      var nr = cr + D8_DR[k], nc = cc + D8_DC[k];
      if (nr < 0 || nc < 0 || nr >= g.nrows || nc >= g.ncols) continue;
      var ni = nr * g.ncols + nc;
      if (mask[ni] || dir[ni] < 0) continue;
      // does the neighbour drain into this cell?
      var tr = nr + D8_DR[dir[ni]], tc = nc + D8_DC[dir[ni]];
      if (tr === cr && tc === cc) { mask[ni] = 1; stack.push(ni); }
    }
  }
  return mask;
}

function maskArea(g, mask) {
  var n = 0;
  for (var i = 0; i < mask.length; i++) if (mask[i]) n++;
  return n * g.cell * g.cell;                 // square working units
}
function maskAreaAcres(g, mask) { return maskArea(g, mask) / 43560; }

/* Snap a pour point to the largest accumulation nearby, so a click
   that lands a cell off the channel still picks up the watershed. */
function snapToChannel(g, acc, r0, c0, radius) {
  radius = radius || 3;
  var best = { r: r0, c: c0, a: acc[r0 * g.ncols + c0] };
  for (var r = Math.max(0, r0 - radius); r <= Math.min(g.nrows - 1, r0 + radius); r++) {
    for (var c = Math.max(0, c0 - radius); c <= Math.min(g.ncols - 1, c0 + radius); c++) {
      var a = acc[r * g.ncols + c];
      if (a > best.a) best = { r: r, c: c, a: a };
    }
  }
  return best;
}

/* ── TRACING ──────────────────────────────────────────────────── */
function traceDownslope(g, dir, r0, c0, maxSteps) {
  maxSteps = maxSteps || (g.ncols * g.nrows);
  var cells = [[r0, c0]], seen = {}, r = r0, c = c0;
  for (var s = 0; s < maxSteps; s++) {
    var i = r * g.ncols + c;
    if (seen[i]) break;
    seen[i] = 1;
    var k = dir[i];
    if (k < 0) break;
    r += D8_DR[k]; c += D8_DC[k];
    if (r < 0 || c < 0 || r >= g.nrows || c >= g.ncols) break;
    cells.push([r, c]);
  }
  return cells;
}

function pathLengthCells(g, cells) {
  var L = 0;
  for (var i = 1; i < cells.length; i++) {
    var dr = Math.abs(cells[i][0] - cells[i-1][0]), dc = Math.abs(cells[i][1] - cells[i-1][1]);
    L += (dr && dc) ? g.cell * Math.SQRT2 : g.cell;
  }
  return L;
}

/* Downslope distance from every cell in the mask to the outlet */
function flowLengthTo(g, dir, mask, outletIdx) {
  var n = g.ncols * g.nrows;
  var len = new Float32Array(n);
  for (var i = 0; i < n; i++) len[i] = NaN;
  len[outletIdx] = 0;
  var idxs = [];
  for (var j = 0; j < n; j++) if (mask[j]) idxs.push(j);
  // resolve by walking each cell down to a cell that already has a length
  for (var q = 0; q < idxs.length; q++) {
    var stack = [], ci = idxs[q], guard = 0;
    while (!isNaN(len[ci]) === false && guard++ < n) {
      stack.push(ci);
      var k = dir[ci];
      if (k < 0) break;
      var cr = (ci / g.ncols) | 0, cc = ci % g.ncols;
      var nr = cr + D8_DR[k], nc = cc + D8_DC[k];
      if (nr < 0 || nc < 0 || nr >= g.nrows || nc >= g.ncols) break;
      ci = nr * g.ncols + nc;
      if (!isNaN(len[ci])) break;
    }
    if (isNaN(len[ci])) continue;
    for (var s = stack.length - 1; s >= 0; s--) {
      var cur = stack[s], k2 = dir[cur];
      if (k2 < 0) { len[cur] = len[ci]; continue; }
      var r2 = (cur / g.ncols) | 0, c2 = cur % g.ncols;
      var d = (k2 % 2 === 0) ? g.cell : g.cell * Math.SQRT2;
      var down = (r2 + D8_DR[k2]) * g.ncols + (c2 + D8_DC[k2]);
      len[cur] = len[down] + d;
    }
  }
  return len;
}

/* The hydraulically longest path in a watershed, which is what
   Table 3-2 and Section 3.1.4.2 want the lengths measured along. */
function longestFlowPath(g, dir, mask, outletIdx) {
  var len = flowLengthTo(g, dir, mask, outletIdx);
  var best = -1, bestLen = -1;
  for (var i = 0; i < len.length; i++) {
    if (!mask[i] || isNaN(len[i])) continue;
    if (len[i] > bestLen) { bestLen = len[i]; best = i; }
  }
  if (best < 0) return null;
  var r = (best / g.ncols) | 0, c = best % g.ncols;
  var cells = traceDownslope(g, dir, r, c);
  // stop at the outlet
  var cut = cells.length;
  for (var q = 0; q < cells.length; q++) {
    if (cells[q][0] * g.ncols + cells[q][1] === outletIdx) { cut = q + 1; break; }
  }
  cells = cells.slice(0, cut);
  return { cells: cells, length: pathLengthCells(g, cells), headIdx: best };
}

/* ── MASK TO POLYGON ──────────────────────────────────────────── */
/* Reuses the marching squares from the terrain core by treating the
   mask as a field and cutting it at 0.5. */
function maskToRings(g, mask, marchFn, joinFn, makeGridFn) {
  // Pad with a ring of zeros so a watershed that reaches the tile edge
  // still produces a closed outline instead of an open line.
  var nc = g.ncols + 2, nr = g.nrows + 2;
  var z = new Float32Array(nc * nr);
  for (var r = 0; r < g.nrows; r++) {
    for (var c = 0; c < g.ncols; c++) {
      z[(r + 1) * nc + (c + 1)] = mask[r * g.ncols + c] ? 1 : 0;
    }
  }
  var pg = makeGridFn({ crs: g.crs, x0: g.x0 - g.cell, y0: g.y0 - g.cell,
                        cell: g.cell, ncols: nc, nrows: nr, z: z });
  var segs = marchFn(pg, z, 0.5);
  var lines = joinFn(segs, g.cell * 0.01);
  lines.sort(function (a, b) { return b.length - a.length; });
  return lines;
}

/* ── SEGMENT A PATH BY SLOPE ──────────────────────────────────── */
/* Splits a traced path into an initial overland reach and the
   remainder, which is what the manual asks for: Ti over the first
   length, then travel time along the watercourse. */
function splitInitialReach(g, z, cells, overlandFt) {
  var head = [cells[0]], rest = [], acc = 0;
  for (var i = 1; i < cells.length; i++) {
    var dr = Math.abs(cells[i][0] - cells[i-1][0]), dc = Math.abs(cells[i][1] - cells[i-1][1]);
    var d = (dr && dc) ? g.cell * Math.SQRT2 : g.cell;
    if (acc < overlandFt) { head.push(cells[i]); acc += d; }
    else { if (!rest.length) rest.push(cells[i-1]); rest.push(cells[i]); }
  }
  return { overland: head, overlandLength: acc, channel: rest,
           channelLength: rest.length ? pathLengthCells(g, rest) : 0 };
}

function reachSlopePct(g, z, cells) {
  if (!cells || cells.length < 2) return 0;
  var a = cells[0], b = cells[cells.length - 1];
  var za = z[a[0] * g.ncols + a[1]], zb = z[b[0] * g.ncols + b[1]];
  var L = pathLengthCells(g, cells);
  if (!(L > 0) || isNaN(za) || isNaN(zb)) return 0;
  return ((za - zb) / L) * 100;
}

if (typeof module !== 'undefined') {
  module.exports = { D8_DR, D8_DC, MinHeap, fillDepressions, countSinks, flowDirD8,
    flowAccum, watershedFrom, maskArea, maskAreaAcres, snapToChannel, traceDownslope,
    pathLengthCells, flowLengthTo, longestFlowPath, maskToRings, splitInitialReach,
    reachSlopePct };
}

/* ── POND FILL, STAGE AND STORAGE FROM THE GROUND ──────────────
   Flood upward from the low point of a basin, taking the lowest
   boundary cell each time. That gives storage against elevation and,
   at the moment the pond first reaches a cell it cannot contain, the
   spill elevation. Volumes are cubic working units.
   ────────────────────────────────────────────────────────────── */
function pondFill(g, z, r0, c0, opts) {
  opts = opts || {};
  var maxRise = (opts.maxRise === undefined) ? 1e9 : opts.maxRise;
  var step    = opts.step || 0.5;
  var n = g.ncols * g.nrows;
  var inPond = new Uint8Array(n);
  var queued = new Uint8Array(n);

  var start = r0 * g.ncols + c0;
  if (isNaN(z[start])) return null;

  // settle onto the local low point so a click near the basin still works
  for (var hop = 0; hop < 200; hop++) {
    var cr = (start / g.ncols) | 0, cc = start % g.ncols, moved = false;
    for (var k = 0; k < 8; k++) {
      var nr = cr + D8_DR[k], nc = cc + D8_DC[k];
      if (nr < 0 || nc < 0 || nr >= g.nrows || nc >= g.ncols) continue;
      var ni = nr * g.ncols + nc;
      if (isNaN(z[ni])) continue;
      if (z[ni] < z[start]) { start = ni; moved = true; }
    }
    if (!moved) break;
  }

  var bottom = z[start];
  var h = new MinHeap();
  inPond[start] = 1; queued[start] = 1;
  var count = 1, sumZ = bottom, level = bottom;
  var cellArea = g.cell * g.cell;

  function pushNeighbours(i) {
    var cr = (i / g.ncols) | 0, cc = i % g.ncols;
    for (var k = 0; k < 8; k++) {
      var nr = cr + D8_DR[k], nc = cc + D8_DC[k];
      if (nr < 0 || nc < 0 || nr >= g.nrows || nc >= g.ncols) return 'edge';
      var ni = nr * g.ncols + nc;
      if (isNaN(z[ni])) return 'edge';
      if (queued[ni]) continue;
      queued[ni] = 1; h.push(z[ni], ni);
    }
    return null;
  }

  var hitEdge = pushNeighbours(start) === 'edge';
  var samples = [{ e: +bottom.toFixed(3), v: 0, cells: 1 }];
  var nextSample = bottom + step;
  var spillElev = null, capped = false, spilled = false;

  while (h.size() && !hitEdge) {
    var top = h.pop(), zi = top[0], i2 = top[1];
    if (zi > bottom + maxRise) {
      // stopped by the requested depth, not by a real spill
      capped = true; level = bottom + maxRise; spillElev = level; break;
    }
    if (zi < level - 1e-9) {
      // the next cell is below the level already reached, so the pond has
      // crossed its rim into lower ground. That rim is the spill point.
      spillElev = level; spilled = true; break;
    }
    // record storage at sample levels below this cell
    while (nextSample < zi) {
      samples.push({ e: +nextSample.toFixed(3),
                     v: +((count * nextSample - sumZ) * cellArea).toFixed(4),
                     cells: count });
      nextSample += step;
    }
    level = zi;
    inPond[i2] = 1; count++; sumZ += zi;
    if (pushNeighbours(i2) === 'edge') { hitEdge = true; spillElev = zi; break; }
  }
  if (spillElev === null) spillElev = level;

  samples.push({ e: +spillElev.toFixed(3),
                 v: +((count * spillElev - sumZ) * cellArea).toFixed(4),
                 cells: count });

  return { bottom: +bottom.toFixed(3), spillElev: +spillElev.toFixed(3),
           spillsAtEdge: hitEdge, capped: capped, spilled: spilled,
           samples: samples, mask: inPond,
           cells: count, area: count * cellArea };
}

if (typeof module !== 'undefined') { module.exports.pondFill = pondFill; }
