/**
 * Preparing a part for the print lab and the static analysis, once per part and cube size, in the worker (its engine
 * compiles the loops; the phone's own interpreter is many times slower): the cubes, the surface cubes with their
 * outward normals, the share of one-cube-thin walls, the mesh check of a file, and the surface to draw — simplified
 * when the file has very many triangles, refined where its triangles are larger than a cube so the colours can follow
 * the stress field. `unprep` turns the worker's answer back into arrays on the app's side.
 */
import { fromB64, toB64 } from './b64.ts';
import { bounds, meshCheck } from './stl.ts';
import { depthAndNormals, surfaceVoxels, voxAt, vIdx, voxelize, type Vox } from './voxel.ts';

/** Largest number of triangles drawn (phones draw and colour a few tens of thousands quickly). */
export const DRAW_TRIS = 40000;

/** Share of solid cubes that are only one cube thick along some axis (walls the grid hardly resolves). */
export function thinShare(v: Vox) {
  let n = 0, thin = 0;
  const at = (i: number, j: number, k: number) => (i < 0 || j < 0 || k < 0 || i >= v.nx || j >= v.ny || k >= v.nz ? 0 : v.solid[vIdx(v, i, j, k)]);
  for (let k = 0; k < v.nz; k++) for (let j = 0; j < v.ny; j++) for (let i = 0; i < v.nx; i++) {
    if (!at(i, j, k)) continue; n++;
    if ((!at(i - 1, j, k) && !at(i + 1, j, k)) || (!at(i, j - 1, k) && !at(i, j + 1, k)) || (!at(i, j, k - 1) && !at(i, j, k + 1))) thin++;
  }
  return n ? thin / n : 0;
}

/** Triangles split (at the middle of the longest edge) until no edge is longer than maxEdge, so per-vertex colours
 *  can show the stress field on the large flat triangles CAD programs export. The edge limit grows when the result
 *  would pass `cap` triangles. */
export function refine(pos: Float32Array, maxEdge: number, cap = 300000): Float32Array {
  const stack = new Float64Array(9 * 128);
  for (let lim = maxEdge; ; lim *= 1.5) {
    const L2 = lim * lim;
    let out = new Float32Array(Math.min(9 * cap + 9, Math.max(pos.length * 2, 9 * 1024))), n = 0, over = false;
    for (let t = 0; t < pos.length && !over; t += 9) {
      for (let k = 0; k < 9; k++) stack[k] = pos[t + k];
      let sp = 1;
      while (sp > 0) {
        sp--;
        const o = 9 * sp;
        const e0 = (stack[o] - stack[o + 3]) ** 2 + (stack[o + 1] - stack[o + 4]) ** 2 + (stack[o + 2] - stack[o + 5]) ** 2;
        const e1 = (stack[o + 3] - stack[o + 6]) ** 2 + (stack[o + 4] - stack[o + 7]) ** 2 + (stack[o + 5] - stack[o + 8]) ** 2;
        const e2 = (stack[o + 6] - stack[o]) ** 2 + (stack[o + 7] - stack[o + 1]) ** 2 + (stack[o + 8] - stack[o + 2]) ** 2;
        const k = e0 >= e1 && e0 >= e2 ? 0 : e1 >= e2 ? 1 : 2, e = k === 0 ? e0 : k === 1 ? e1 : e2;
        if (e <= L2 || sp + 2 > 127) {
          if (n + 9 > out.length) { if (n / 9 >= cap) { over = true; break; } const g = new Float32Array(Math.min(9 * cap + 9, 2 * out.length)); g.set(out); out = g; }
          for (let q = 0; q < 9; q++) out[n + q] = stack[o + q];
          n += 9;
          if (n / 9 > cap) { over = true; break; }
          continue;
        }
        // split edge (a, b) at its middle m: triangles (a, m, c) and (m, b, c)
        const a = o + 3 * k, b = o + 3 * ((k + 1) % 3), c = o + 3 * ((k + 2) % 3);
        const ax = stack[a], ay = stack[a + 1], az = stack[a + 2], bx = stack[b], by = stack[b + 1], bz = stack[b + 2], cx = stack[c], cy = stack[c + 1], cz = stack[c + 2];
        const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2, p = 9 * sp, r = p + 9;
        stack[p] = ax; stack[p + 1] = ay; stack[p + 2] = az; stack[p + 3] = mx; stack[p + 4] = my; stack[p + 5] = mz; stack[p + 6] = cx; stack[p + 7] = cy; stack[p + 8] = cz;
        stack[r] = mx; stack[r + 1] = my; stack[r + 2] = mz; stack[r + 3] = bx; stack[r + 4] = by; stack[r + 5] = bz; stack[r + 6] = cx; stack[r + 7] = cy; stack[r + 8] = cz;
        sp += 2;
      }
    }
    if (!over) return out.slice(0, n);
  }
}

/** Simplified surface by vertex clustering: vertices in the same cell of side `cell` become their average, triangles
 *  that collapse (or repeat) are dropped. Only for drawing — the cubes are cut from the full mesh. */
export function decimate(pos: Float32Array, cell: number): Float32Array {
  const B = bounds({ pos }), nx = Math.ceil(B.size[0] / cell) + 1, ny = Math.ceil(B.size[1] / cell) + 1, nv = pos.length / 3;
  const map = new Map<number, number>(), ids = new Int32Array(nv), sum: number[] = [];
  for (let v = 0; v < nv; v++) {
    const x = pos[3 * v], y = pos[3 * v + 1], z = pos[3 * v + 2];
    const key = Math.floor((x - B.lo[0]) / cell) + nx * (Math.floor((y - B.lo[1]) / cell) + ny * Math.floor((z - B.lo[2]) / cell));
    let id = map.get(key);
    if (id === undefined) { id = map.size; map.set(key, id); sum.push(0, 0, 0, 0); }
    ids[v] = id; sum[4 * id] += x; sum[4 * id + 1] += y; sum[4 * id + 2] += z; sum[4 * id + 3]++;
  }
  const m = map.size, seen = m < 200000 ? new Set<number>() : null, out: number[] = [];
  for (let t = 0; t < nv; t += 3) {
    const a = ids[t], b = ids[t + 1], c = ids[t + 2];
    if (a === b || b === c || a === c) continue;
    if (seen) { const lo = Math.min(a, b, c), hi = Math.max(a, b, c), md = a + b + c - lo - hi, key = (lo * m + md) * m + hi; if (seen.has(key)) continue; seen.add(key); }
    for (const q of [a, b, c]) out.push(sum[4 * q] / sum[4 * q + 3], sum[4 * q + 1] / sum[4 * q + 3], sum[4 * q + 2] / sum[4 * q + 3]);
  }
  return Float32Array.from(out);
}

/** The surface to draw and, for every vertex, the cube just under it (for its colour and deflection). */
export function drawnSurface(pos: Float32Array, v: Vox) {
  let p = pos, simplified = false;
  if (p.length / 9 > DRAW_TRIS) {
    for (let cell = 0.35 * v.h; ; cell *= 1.35) { const q = decimate(pos, cell); if (q.length / 9 <= DRAW_TRIS || cell > 6 * v.h) { p = q; break; } }
    simplified = true;
  }
  p = refine(p, 1.2 * v.h, DRAW_TRIS);
  const n = p.length / 3, vid = new Int32Array(n), h = v.h;
  for (let t = 0; t < n; t += 3) {
    const o = 3 * t, ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2], bx = p[o + 6] - p[o], by = p[o + 7] - p[o + 1], bz = p[o + 8] - p[o + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 3; k++) { const q = o + 3 * k; vid[t + k] = voxAt(v, p[q] - 0.35 * h * nx, p[q + 1] - 0.35 * h * ny, p[q + 2] - 0.35 * h * nz); }
  }
  return { pos: p, vid, simplified };
}

/** What the worker is asked: the part's triangles (Float32, base64, file units), the factor to mm, the cube target. */
export type PrepJob = { mesh: string; scale: number; target: number; check: boolean };
export type MeshInfo = { openEdges: number; edges: number; bodies: number };
export type PrepResult = {
  nx: number; ny: number; nz: number; h: number; org: [number, number, number]; solid: string; fill: string; surf: string; snrm: string; thin: number; info: MeshInfo | null;
  /** drawn surface: positions as uint16 over the box lo … lo + sz, cube under each vertex */
  draw: string; dlo: [number, number, number]; dsz: [number, number, number]; vid: string; tris: number; simplified: boolean; ms: number;
};

export function prepPart(job: PrepJob): PrepResult {
  const t0 = Date.now(), b = fromB64(job.mesh), raw = new Float32Array(b.buffer, 0, b.length >> 2);
  const pos = job.scale === 1 ? raw : raw.map((x) => x * job.scale), m = { pos };
  const info = job.check ? meshCheck(m) : null, v = voxelize(m, job.target), surf = Int32Array.from(surfaceVoxels(v)), { nrm } = depthAndNormals(v);
  const sn = new Int8Array(3 * surf.length);
  for (let i = 0; i < surf.length; i++) for (let k = 0; k < 3; k++) sn[3 * i + k] = Math.round(127 * nrm[3 * surf[i] + k]);
  const dr = drawnSurface(pos, v), B = bounds({ pos: dr.pos }), sz = B.size.map((x) => Math.max(x, 1e-9)) as [number, number, number];
  const q = new Uint16Array(dr.pos.length);
  for (let i = 0; i < dr.pos.length; i += 3) for (let k = 0; k < 3; k++) q[i + k] = Math.round((65535 * (dr.pos[i + k] - B.lo[k])) / sz[k]);
  return {
    nx: v.nx, ny: v.ny, nz: v.nz, h: v.h, org: v.org, solid: toB64(v.solid), fill: toB64(v.fill!), surf: toB64(new Uint8Array(surf.buffer)), snrm: toB64(new Uint8Array(sn.buffer)), thin: thinShare(v), info,
    draw: toB64(new Uint8Array(q.buffer)), dlo: [B.lo[0], B.lo[1], B.lo[2]], dsz: sz, vid: toB64(new Uint8Array(dr.vid.buffer)), tris: pos.length / 9, simplified: dr.simplified, ms: Date.now() - t0,
  };
}

/** The drawn surface on the app's side: positions, flat normals (one per triangle, repeated), cube under each vertex. */
export type Drawn = { pos: Float32Array; nrm: Float32Array; vid: Int32Array; simplified: boolean; tris: number };

/** The worker's answer as arrays: cubes, surface cubes with outward normals (zero inside), thin share, mesh check, drawing. */
export function unprep(r: PrepResult) {
  const vox: Vox = { nx: r.nx, ny: r.ny, nz: r.nz, h: r.h, org: r.org, solid: fromB64(r.solid), fill: r.fill ? fromB64(r.fill) : undefined };
  const sb = fromB64(r.surf), surf = new Int32Array(sb.buffer, 0, sb.length >> 2), snb = fromB64(r.snrm), sn = new Int8Array(snb.buffer, 0, snb.length);
  const nrm = new Float32Array(3 * r.nx * r.ny * r.nz);
  for (let i = 0; i < surf.length; i++) {
    const a = sn[3 * i], b = sn[3 * i + 1], c = sn[3 * i + 2], l = Math.hypot(a, b, c) || 1, o = 3 * surf[i];
    nrm[o] = a / l; nrm[o + 1] = b / l; nrm[o + 2] = c / l;
  }
  const qb = fromB64(r.draw), q = new Uint16Array(qb.buffer, 0, qb.length >> 1), pos = new Float32Array(q.length), dn = new Float32Array(q.length);
  const [lx, ly, lz] = r.dlo, sx = r.dsz[0] / 65535, sy = r.dsz[1] / 65535, sz = r.dsz[2] / 65535;
  for (let i = 0; i < q.length; i += 3) { pos[i] = lx + q[i] * sx; pos[i + 1] = ly + q[i + 1] * sy; pos[i + 2] = lz + q[i + 2] * sz; }
  for (let o = 0; o < pos.length; o += 9) {
    const ax = pos[o + 3] - pos[o], ay = pos[o + 4] - pos[o + 1], az = pos[o + 5] - pos[o + 2], bx = pos[o + 6] - pos[o], by = pos[o + 7] - pos[o + 1], bz = pos[o + 8] - pos[o + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 9; k += 3) { dn[o + k] = nx; dn[o + k + 1] = ny; dn[o + k + 2] = nz; }
  }
  const vb = fromB64(r.vid), vid = new Int32Array(vb.buffer, 0, vb.length >> 2);
  const draw: Drawn = { pos, nrm: dn, vid, simplified: r.simplified, tris: r.tris };
  return { vox, surf, nrm, thin: r.thin, info: r.info, draw, ms: r.ms };
}
export type Prepared = ReturnType<typeof unprep>;
