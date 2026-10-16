/**
 * Geometry queries on a closed triangle mesh for the tetrahedral mesher: a bounding-volume tree over the triangles
 * (median split, 4 triangles per leaf), the first crossing of a segment with the surface (Möller–Trumbore) and the
 * closest surface point (Ericson, Real-Time Collision Detection 5.1.5). Inside/outside of many points at once is decided
 * by rays along +z through the points' columns (parity of crossings, like the voxeliser).
 */
import type { Mesh } from '../../manufacturing/stl.ts';

export type V3 = [number, number, number];

export type Bvh = {
  pos: Float32Array; tri: Int32Array; // triangle order of the leaves
  lo: Float64Array; hi: Float64Array; // node boxes (3 per node)
  left: Int32Array; start: Int32Array; count: Int32Array; // inner node: left child (right = left + 1); leaf: start/count into tri
  n: number;
};

export function buildBvh(m: Mesh): Bvh {
  const p = m.pos, nt = p.length / 9, tri = new Int32Array(nt), cen = new Float64Array(3 * nt);
  for (let t = 0; t < nt; t++) { tri[t] = t; for (let a = 0; a < 3; a++) cen[3 * t + a] = (p[9 * t + a] + p[9 * t + 3 + a] + p[9 * t + 6 + a]) / 3; }
  const cap = 2 * Math.max(1, nt), lo = new Float64Array(3 * cap), hi = new Float64Array(3 * cap);
  const left = new Int32Array(cap).fill(-1), start = new Int32Array(cap), count = new Int32Array(cap);
  let n = 0;
  const box = (node: number, s: number, c: number) => {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = s; i < s + c; i++) {
      const o = 9 * tri[i];
      for (let k = 0; k < 9; k += 3) {
        const x = p[o + k], y = p[o + k + 1], z = p[o + k + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
    }
    lo[3 * node] = x0; lo[3 * node + 1] = y0; lo[3 * node + 2] = z0; hi[3 * node] = x1; hi[3 * node + 1] = y1; hi[3 * node + 2] = z1;
  };
  // iterative build: split along the longest axis of the centroid box at the median
  const stack: [number, number, number][] = [[n++, 0, nt]];
  while (stack.length) {
    const [node, s, c] = stack.pop()!;
    box(node, s, c);
    if (c <= 4) { start[node] = s; count[node] = c; continue; }
    let ax = 0, best = -1;
    for (let a = 0; a < 3; a++) {
      let mn = Infinity, mx = -Infinity;
      for (let i = s; i < s + c; i++) { const v = cen[3 * tri[i] + a]; if (v < mn) mn = v; if (v > mx) mx = v; }
      if (mx - mn > best) { best = mx - mn; ax = a; }
    }
    const seg = Array.from(tri.subarray(s, s + c)).sort((u, v) => cen[3 * u + ax] - cen[3 * v + ax]);
    tri.set(seg, s);
    const h = c >> 1, l = n; n += 2;
    left[node] = l;
    stack.push([l, s, h], [l + 1, s + h, c - h]);
  }
  return { pos: p, tri, lo, hi, left, start, count, n };
}

/** Parameter t ∈ [0, 1] of the crossing of segment a→b with the surface nearest to a (or −1). */
export function segmentHit(b: Bvh, a: V3, q: V3): number {
  const d = [q[0] - a[0], q[1] - a[1], q[2] - a[2]], inv = d.map((x) => (Math.abs(x) < 1e-300 ? 1e300 : 1 / x));
  const p = b.pos;
  let best = Infinity;
  const stack = [0];
  while (stack.length) {
    const node = stack.pop()!;
    // slab test of the node box against the segment
    let t0 = 0, t1 = Math.min(1, best);
    for (let k = 0; k < 3; k++) {
      let ta = (b.lo[3 * node + k] - a[k]) * inv[k], tb = (b.hi[3 * node + k] - a[k]) * inv[k];
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
      if (t0 > t1 + 1e-12) break;
    }
    if (t0 > t1 + 1e-12) continue;
    if (b.left[node] >= 0) { stack.push(b.left[node], b.left[node] + 1); continue; }
    for (let i = b.start[node]; i < b.start[node] + b.count[node]; i++) {
      const o = 9 * b.tri[i];
      const e1x = p[o + 3] - p[o], e1y = p[o + 4] - p[o + 1], e1z = p[o + 5] - p[o + 2];
      const e2x = p[o + 6] - p[o], e2y = p[o + 7] - p[o + 1], e2z = p[o + 8] - p[o + 2];
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-20) continue;
      const tx = a[0] - p[o], ty = a[1] - p[o + 1], tz = a[2] - p[o + 2], f = 1 / det;
      const u = (tx * px + ty * py + tz * pz) * f; if (u < -1e-9 || u > 1 + 1e-9) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) * f; if (v < -1e-9 || u + v > 1 + 1e-9) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * f;
      if (t >= -1e-9 && t <= 1 + 1e-9 && t < best) best = t;
    }
  }
  return best === Infinity ? -1 : Math.min(1, Math.max(0, best));
}

/** Closest point on triangle (a, b, c) to point p, written into out; returns the squared distance. */
function closestOnTri(p: Float32Array, o: number, x: number, y: number, z: number, out: number[]) {
  const ax = p[o], ay = p[o + 1], az = p[o + 2], bx = p[o + 3], by = p[o + 4], bz = p[o + 5], cx = p[o + 6], cy = p[o + 7], cz = p[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = x - ax, apy = y - ay, apz = z - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  const set = (u: number, v: number, w: number) => { out[0] = u; out[1] = v; out[2] = w; const dx = x - u, dy = y - v, dz = z - w; return dx * dx + dy * dy + dz * dz; };
  if (d1 <= 0 && d2 <= 0) return set(ax, ay, az);
  const bpx = x - bx, bpy = y - by, bpz = z - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return set(bx, by, bz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return set(ax + v * abx, ay + v * aby, az + v * abz); }
  const cpx = x - cx, cpy = y - cy, cpz = z - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return set(cx, cy, cz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return set(ax + w * acx, ay + w * acy, az + w * acz); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return set(bx + w * (cx - bx), by + w * (cy - by), bz + w * (cz - bz)); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return set(ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w);
}

/** Closest surface point to q (written into out) and the triangle it lies on; returns the distance. */
export function closestPoint(b: Bvh, q: V3, out: number[], maxDist = Infinity): { d: number; tri: number } {
  const p = b.pos, tmp = [0, 0, 0];
  let best = maxDist * maxDist, bt = -1;
  const stack = [0];
  const boxD = (node: number) => {
    let s = 0;
    for (let k = 0; k < 3; k++) { const v = q[k] < b.lo[3 * node + k] ? b.lo[3 * node + k] - q[k] : q[k] > b.hi[3 * node + k] ? q[k] - b.hi[3 * node + k] : 0; s += v * v; }
    return s;
  };
  while (stack.length) {
    const node = stack.pop()!;
    if (boxD(node) >= best) continue;
    const l = b.left[node];
    if (l >= 0) { const da = boxD(l), db = boxD(l + 1); if (da < db) stack.push(l + 1, l); else stack.push(l, l + 1); continue; }
    for (let i = b.start[node]; i < b.start[node] + b.count[node]; i++) {
      const d = closestOnTri(p, 9 * b.tri[i], q[0], q[1], q[2], tmp);
      if (d < best) { best = d; bt = b.tri[i]; out[0] = tmp[0]; out[1] = tmp[1]; out[2] = tmp[2]; }
    }
  }
  return { d: Math.sqrt(best), tri: bt };
}

/** Unit normal of triangle t (outward for a mesh with counter-clockwise faces seen from outside). */
export function triNormal(m: Mesh, t: number): V3 {
  const p = m.pos, o = 9 * t;
  const ux = p[o + 3] - p[o], uy = p[o + 4] - p[o + 1], uz = p[o + 5] - p[o + 2], vx = p[o + 6] - p[o], vy = p[o + 7] - p[o + 1], vz = p[o + 8] - p[o + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/**
 * Inside test for the points of a regular grid (x0 + i·h, y0 + j·h, z0 + k·h), i < ni, j < nj, k < nk: one ray along z
 * per column, inside where an odd number of crossings lies below. Returns a byte per point (index i + ni (j + nj k)).
 */
export function insideGrid(m: Mesh, x0: number, y0: number, z0: number, h: number, ni: number, nj: number, nk: number): Uint8Array {
  const p = m.pos, nt = p.length / 9, out = new Uint8Array(ni * nj * nk);
  const bins: number[][] = Array.from({ length: ni * nj }, () => []);
  for (let t = 0; t < nt; t++) {
    const o = 9 * t, xa = Math.min(p[o], p[o + 3], p[o + 6]), xb = Math.max(p[o], p[o + 3], p[o + 6]), ya = Math.min(p[o + 1], p[o + 4], p[o + 7]), yb = Math.max(p[o + 1], p[o + 4], p[o + 7]);
    const i0 = Math.max(0, Math.ceil((xa - x0) / h - 1e-9)), i1 = Math.min(ni - 1, Math.floor((xb - x0) / h + 1e-9)), j0 = Math.max(0, Math.ceil((ya - y0) / h - 1e-9)), j1 = Math.min(nj - 1, Math.floor((yb - y0) / h + 1e-9));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) bins[i + ni * j].push(t);
  }
  const zs: number[] = [];
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
    const bin = bins[i + ni * j]; if (!bin.length) continue;
    const x = x0 + i * h + 1.37e-7 * h, y = y0 + j * h + 2.11e-7 * h; // keep the ray off shared edges
    zs.length = 0;
    for (const t of bin) {
      const o = 9 * t, ax = p[o], ay = p[o + 1], bx = p[o + 3], by = p[o + 4], cx = p[o + 6], cy = p[o + 7];
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(d) < 1e-18) continue;
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d, l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d, l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      zs.push(l1 * p[o + 2] + l2 * p[o + 5] + l3 * p[o + 8]);
    }
    if (zs.length < 2) continue;
    zs.sort((a, b) => a - b);
    for (let c = 0; c + 1 < zs.length; c += 2) {
      const k0 = Math.max(0, Math.ceil((zs[c] - z0) / h)), k1 = Math.min(nk - 1, Math.floor((zs[c + 1] - z0) / h));
      for (let k = k0; k <= k1; k++) out[i + ni * (j + nj * k)] = 1;
    }
  }
  return out;
}
