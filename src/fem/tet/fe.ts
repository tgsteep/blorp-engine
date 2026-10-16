/**
 * Quadratic tetrahedra (T10) for linear elastic statics on a stuffed tetrahedral mesh: mid-edge nodes added (on the
 * surface they are moved onto the true surface, so curved faces are curved), element stiffness by 4-point Gauss
 * quadrature, sparse assembly without the held nodes, solution by AMG-preconditioned conjugate gradients, and stresses
 * evaluated at the nodes of each element (linear inside a T10) and averaged over the elements sharing a node.
 * Node numbering: corners 0–3, then edges 01, 12, 02, 03, 13, 23.
 */
import { closestPoint, type V3 } from './geom.ts';
import { vol6, type TetMesh } from './stuff.ts';
import { amgSetup, pcg, spgemm, transpose, type Csr } from './amg.ts';

export const EDGES: [number, number][] = [[0, 1], [1, 2], [0, 2], [0, 3], [1, 3], [2, 3]];
/** Faces of a tetrahedron (corner numbers, opposite corner = index), each with its three edge nodes. */
export const FACES = [
  { c: [1, 2, 3], m: [5, 9, 8] }, // opposite 0: edges 12, 23, 13
  { c: [0, 3, 2], m: [7, 9, 6] }, // opposite 1: edges 03, 23, 02
  { c: [0, 1, 3], m: [4, 8, 7] }, // opposite 2: edges 01, 13, 03
  { c: [0, 2, 1], m: [6, 5, 4] }, // opposite 3: edges 02, 12, 01
];

export type T10 = {
  X: Float64Array; nn: number; nv: number; ne: number;
  conn: Int32Array; // 10 per element
  /** Boundary faces: 6 nodes each (3 corners counter-clockwise seen from outside, then edges c0c1, c1c2, c2c0). */
  bf: Int32Array; nbf: number;
  /** Node lies on the surface. */
  onSurf: Uint8Array;
  /** The two corner nodes of each edge node (node nv + i → ends[2i], ends[2i + 1]). */
  ends: Int32Array;
};

/** Volume coordinates' derivatives per node at L = (L1..L4): dN/dL (10 × 4). */
function dNdL(L: number[], out: Float64Array) {
  out.fill(0);
  for (let i = 0; i < 4; i++) out[4 * i + i] = 4 * L[i] - 1;
  EDGES.forEach(([a, b], e) => { const n = 4 + e; out[4 * n + a] = 4 * L[b]; out[4 * n + b] = 4 * L[a]; });
}
const GA = 0.5854101966249685, GB = 0.1381966011250105;
const GAUSS = [[GA, GB, GB, GB], [GB, GA, GB, GB], [GB, GB, GA, GB], [GB, GB, GB, GA]];

/** Cartesian derivatives of the 10 shape functions at L (out 10 × 3) and det J (= 6 × volume-scale). */
function grads(X: Float64Array, nodes: ArrayLike<number>, L: number[], dL: Float64Array, out: Float64Array) {
  dNdL(L, dL);
  // dN/dξ_k with ξ = (L2, L3, L4), L1 = 1 − ξ1 − ξ2 − ξ3
  const J = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const dx = new Float64Array(30);
  for (let n = 0; n < 10; n++) for (let k = 0; k < 3; k++) {
    const g = dL[4 * n + k + 1] - dL[4 * n]; dx[3 * n + k] = g;
    const v = nodes[n];
    for (let r = 0; r < 3; r++) J[3 * r + k] += X[3 * v + r] * g; // J[r][k] = ∂x_r/∂ξ_k
  }
  const det = J[0] * (J[4] * J[8] - J[5] * J[7]) - J[1] * (J[3] * J[8] - J[5] * J[6]) + J[2] * (J[3] * J[7] - J[4] * J[6]);
  const inv = [
    (J[4] * J[8] - J[5] * J[7]) / det, (J[2] * J[7] - J[1] * J[8]) / det, (J[1] * J[5] - J[2] * J[4]) / det,
    (J[5] * J[6] - J[3] * J[8]) / det, (J[0] * J[8] - J[2] * J[6]) / det, (J[2] * J[3] - J[0] * J[5]) / det,
    (J[3] * J[7] - J[4] * J[6]) / det, (J[1] * J[6] - J[0] * J[7]) / det, (J[0] * J[4] - J[1] * J[3]) / det,
  ]; // inv[k][r] = ∂ξ_k/∂x_r
  for (let n = 0; n < 10; n++) for (let r = 0; r < 3; r++) out[3 * n + r] = dx[3 * n] * inv[r] + dx[3 * n + 1] * inv[3 + r] + dx[3 * n + 2] * inv[6 + r];
  return det;
}

/** T10 mesh from a stuffed mesh; surface mid-edge nodes moved onto the true surface where the elements stay valid. */
export function toT10(tm: TetMesh, curve = true): T10 {
  const nv = tm.pos.length / 3, ne = tm.tet.length / 4, T = tm.tet;
  const edgeId = new Map<number, number>(), X: number[] = Array.from(tm.pos), conn = new Int32Array(10 * ne);
  const ekey = (a: number, b: number) => (a < b ? a * nv + b : b * nv + a);
  let nn = nv;
  const ends: number[] = [];
  for (let e = 0; e < ne; e++) {
    for (let i = 0; i < 4; i++) conn[10 * e + i] = T[4 * e + i];
    EDGES.forEach(([a, b], k) => {
      const va = T[4 * e + a], vb = T[4 * e + b], key = ekey(va, vb);
      let id = edgeId.get(key);
      if (id === undefined) { id = nn++; edgeId.set(key, id); ends.push(va, vb); for (let c = 0; c < 3; c++) X.push((X[3 * va + c] + X[3 * vb + c]) / 2); }
      conn[10 * e + 4 + k] = id;
    });
  }
  // boundary faces: faces of exactly one element
  const fcount = new Map<string, number>();
  const fkey = (a: number, b: number, c: number) => [a, b, c].sort((x, y) => x - y).join(',');
  for (let e = 0; e < ne; e++) for (const f of FACES) { const k = fkey(conn[10 * e + f.c[0]], conn[10 * e + f.c[1]], conn[10 * e + f.c[2]]); fcount.set(k, (fcount.get(k) ?? 0) + 1); }
  const bf: number[] = [];
  for (let e = 0; e < ne; e++) for (const f of FACES) {
    const c = f.c.map((i) => conn[10 * e + i]);
    if (fcount.get(fkey(c[0], c[1], c[2])) !== 1) continue;
    // the face's corners in the element's order give the outward normal (FACES lists them so)
    bf.push(c[0], c[1], c[2], conn[10 * e + f.m[0]], conn[10 * e + f.m[1]], conn[10 * e + f.m[2]]);
  }
  const Xa = Float64Array.from(X), nbf = bf.length / 6, onSurf = new Uint8Array(nn);
  for (const v of bf) onSurf[v] = 1;
  if (curve) {
    // move surface mid-edge nodes onto the surface (at most a quarter of the edge), then undo moves that make an
    // element's Jacobian small or negative at a Gauss point or a corner
    const moved = new Map<number, number[]>(), tmp = [0, 0, 0];
    for (let f = 0; f < nbf; f++) for (let k = 0; k < 3; k++) {
      const m = bf[6 * f + 3 + k]; if (moved.has(m)) continue;
      const a = bf[6 * f + k], b = bf[6 * f + ((k + 1) % 3)], len = Math.hypot(Xa[3 * a] - Xa[3 * b], Xa[3 * a + 1] - Xa[3 * b + 1], Xa[3 * a + 2] - Xa[3 * b + 2]);
      const q: V3 = [Xa[3 * m], Xa[3 * m + 1], Xa[3 * m + 2]];
      const r = closestPoint(tm.bvh, q, tmp, 0.25 * len);
      if (r.tri >= 0) { moved.set(m, [q[0], q[1], q[2]]); Xa[3 * m] = tmp[0]; Xa[3 * m + 1] = tmp[1]; Xa[3 * m + 2] = tmp[2]; }
    }
    const dL = new Float64Array(40), g = new Float64Array(30), CHK = [...GAUSS, [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    for (let pass = 0; pass < 3; pass++) {
      let undone = 0;
      for (let e = 0; e < ne; e++) {
        const nodes = conn.subarray(10 * e, 10 * e + 10), v0 = vol6(Xa, nodes[0], nodes[1], nodes[2], nodes[3]);
        let ok = true;
        for (const L of CHK) if (grads(Xa, nodes, L, dL, g) < 0.2 * v0) { ok = false; break; }
        if (ok) continue;
        for (let k = 4; k < 10; k++) { const m = nodes[k], o = moved.get(m); if (o) { Xa[3 * m] = o[0]; Xa[3 * m + 1] = o[1]; Xa[3 * m + 2] = o[2]; moved.delete(m); undone++; } }
      }
      if (!undone) break;
    }
  }
  return { X: Xa, nn, nv, ne, conn, bf: Int32Array.from(bf), nbf, onSurf, ends: Int32Array.from(ends) };
}

export type Iso = { E: number; nu: number };

function Dmat({ E, nu }: Iso) {
  const c = E / ((1 + nu) * (1 - 2 * nu)), a = c * (1 - nu), b = c * nu, s = c * (1 - 2 * nu) / 2;
  return [a, b, b, 0, 0, 0, b, a, b, 0, 0, 0, b, b, a, 0, 0, 0, 0, 0, 0, s, 0, 0, 0, 0, 0, 0, s, 0, 0, 0, 0, 0, 0, s];
}

/** 30 × 30 element stiffness (row-major). */
export function elemK(X: Float64Array, nodes: ArrayLike<number>, D: number[], out: Float64Array) {
  out.fill(0);
  const dL = new Float64Array(40), g = new Float64Array(30), DB = new Float64Array(6 * 30);
  for (const L of GAUSS) {
    const det = grads(X, nodes, L, dL, g), w = det / 24;
    // B (6 × 30): strains xx, yy, zz, yz, xz, xy (engineering shear)
    // DB = D · B, then K += w Bᵀ DB
    for (let r = 0; r < 6; r++) for (let n = 0; n < 10; n++) {
      const gx = g[3 * n], gy = g[3 * n + 1], gz = g[3 * n + 2];
      // column (n, x): B = [gx, 0, 0, 0, gz, gy]; (n, y): [0, gy, 0, gz, 0, gx]; (n, z): [0, 0, gz, gy, gx, 0]
      DB[r * 30 + 3 * n] = D[6 * r] * gx + D[6 * r + 4] * gz + D[6 * r + 5] * gy;
      DB[r * 30 + 3 * n + 1] = D[6 * r + 1] * gy + D[6 * r + 3] * gz + D[6 * r + 5] * gx;
      DB[r * 30 + 3 * n + 2] = D[6 * r + 2] * gz + D[6 * r + 3] * gy + D[6 * r + 4] * gx;
    }
    for (let n = 0; n < 10; n++) {
      const gx = g[3 * n], gy = g[3 * n + 1], gz = g[3 * n + 2];
      for (let j = 0; j < 30; j++) {
        out[(3 * n) * 30 + j] += w * (gx * DB[j] + gz * DB[4 * 30 + j] + gy * DB[5 * 30 + j]);
        out[(3 * n + 1) * 30 + j] += w * (gy * DB[30 + j] + gz * DB[3 * 30 + j] + gx * DB[5 * 30 + j]);
        out[(3 * n + 2) * 30 + j] += w * (gz * DB[2 * 30 + j] + gy * DB[3 * 30 + j] + gx * DB[4 * 30 + j]);
      }
    }
  }
}

export type Model = { t10: T10; free: Int32Array; /** node → free index or −1 */ K: Csr; nodeStart: Int32Array; B: Float64Array; mat: Iso };

/** Sparse stiffness over the free nodes (held nodes removed) and the rigid-body modes for the AMG. */
export function assemble(t10: T10, held: Uint8Array, mat: Iso): Model {
  const { nn, ne, conn, X } = t10, free = new Int32Array(nn).fill(-1);
  let nf = 0; for (let v = 0; v < nn; v++) if (!held[v]) free[v] = nf++;
  // node adjacency (free nodes only), sorted
  const adj: Set<number>[] = Array.from({ length: nf }, () => new Set<number>());
  for (let e = 0; e < ne; e++) for (let a = 0; a < 10; a++) { const fa = free[conn[10 * e + a]]; if (fa < 0) continue; for (let b = 0; b < 10; b++) { const fb = free[conn[10 * e + b]]; if (fb >= 0) adj[fa].add(fb); } }
  const nbr = adj.map((s) => Int32Array.from([...s].sort((x, y) => x - y)));
  const ptr = new Int32Array(3 * nf + 1);
  for (let v = 0; v < nf; v++) for (let c = 0; c < 3; c++) ptr[3 * v + c + 1] = ptr[3 * v + c] + 3 * nbr[v].length;
  const col = new Int32Array(ptr[3 * nf]), val = new Float64Array(ptr[3 * nf]);
  for (let v = 0; v < nf; v++) for (let c = 0; c < 3; c++) { let q = ptr[3 * v + c]; for (const w of nbr[v]) for (let d = 0; d < 3; d++) col[q++] = 3 * w + d; }
  const D = Dmat(mat), Ke = new Float64Array(900);
  const find = (v: number, w: number) => { const a = nbr[v]; let lo = 0, hi = a.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m] < w) lo = m + 1; else if (a[m] > w) hi = m - 1; else return m; } return -1; };
  for (let e = 0; e < ne; e++) {
    const nodes = conn.subarray(10 * e, 10 * e + 10);
    elemK(X, nodes, D, Ke);
    for (let a = 0; a < 10; a++) {
      const fa = free[nodes[a]]; if (fa < 0) continue;
      for (let b = 0; b < 10; b++) {
        const fb = free[nodes[b]]; if (fb < 0) continue;
        const pos = 3 * find(fa, fb);
        for (let i = 0; i < 3; i++) { const base = ptr[3 * fa + i] + pos; for (let j = 0; j < 3; j++) val[base + j] += Ke[(3 * a + i) * 30 + 3 * b + j]; }
      }
    }
  }
  const nodeStart = new Int32Array(nf + 1); for (let v = 0; v <= nf; v++) nodeStart[v] = 3 * v;
  // rigid-body modes about the centroid (rotations scaled by the part size so the columns are of similar size)
  let cx = 0, cy = 0, cz = 0; for (let v = 0; v < nn; v++) { cx += X[3 * v]; cy += X[3 * v + 1]; cz += X[3 * v + 2]; }
  cx /= nn; cy /= nn; cz /= nn;
  let R = 0; for (let v = 0; v < nn; v++) R = Math.max(R, Math.hypot(X[3 * v] - cx, X[3 * v + 1] - cy, X[3 * v + 2] - cz));
  const B = new Float64Array(3 * nf * 6);
  for (let v = 0; v < nn; v++) {
    const f = free[v]; if (f < 0) continue;
    const x = (X[3 * v] - cx) / R, y = (X[3 * v + 1] - cy) / R, z = (X[3 * v + 2] - cz) / R, o = 3 * f * 6;
    B.set([1, 0, 0, 0, z, -y], o); B.set([0, 1, 0, -z, 0, x], o + 6); B.set([0, 0, 1, y, -x, 0], o + 12);
  }
  return { t10, free, K: { n: 3 * nf, m: 3 * nf, ptr, col, val }, nodeStart, B, mat };
}

/** Load vector over the free dofs from per-face tractions [N/mm²] (3 per boundary face; zero = unloaded). */
export function loadVector(md: Model, traction: Float64Array): Float64Array {
  const { t10, free } = md, F = new Float64Array(md.K.n), X = t10.X;
  for (let f = 0; f < t10.nbf; f++) {
    const tx = traction[3 * f], ty = traction[3 * f + 1], tz = traction[3 * f + 2];
    if (!tx && !ty && !tz) continue;
    const A = faceArea(X, t10.bf, f);
    // quadratic triangle under uniform traction: corners take nothing, each edge node a third
    for (let k = 3; k < 6; k++) { const v = free[t10.bf[6 * f + k]]; if (v < 0) continue; F[3 * v] += tx * A / 3; F[3 * v + 1] += ty * A / 3; F[3 * v + 2] += tz * A / 3; }
  }
  return F;
}

/**
 * Own weight as nodal loads: w = ρ g [N/mm³] along unit direction dir on every element; for a T10 with straight edges
 * the consistent loads are −1/20 of the element's weight at each corner and 1/5 at each edge node.
 */
export function weightVector(md: Model, w: number, dir: number[], F: Float64Array) {
  const { t10, free } = md, X = t10.X;
  let W = 0;
  for (let e = 0; e < t10.ne; e++) {
    const n = t10.conn.subarray(10 * e, 10 * e + 10), We = (w * vol6(X, n[0], n[1], n[2], n[3])) / 6;
    W += We;
    for (let k = 0; k < 10; k++) {
      const v = free[n[k]]; if (v < 0) continue;
      const s = k < 4 ? -We / 20 : We / 5;
      F[3 * v] += s * dir[0]; F[3 * v + 1] += s * dir[1]; F[3 * v + 2] += s * dir[2];
    }
  }
  return W;
}

/** Area of boundary face f (flat triangle through its corners) and its outward unit normal in n. */
export function faceArea(X: Float64Array, bf: Int32Array, f: number, n?: number[]) {
  const a = bf[6 * f], b = bf[6 * f + 1], c = bf[6 * f + 2];
  const ux = X[3 * b] - X[3 * a], uy = X[3 * b + 1] - X[3 * a + 1], uz = X[3 * b + 2] - X[3 * a + 2], vx = X[3 * c] - X[3 * a], vy = X[3 * c + 1] - X[3 * a + 1], vz = X[3 * c + 2] - X[3 * a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
  if (n) { n[0] = nx / l; n[1] = ny / l; n[2] = nz / l; }
  return l / 2;
}

/** Solves K u = F; yields progress; returns the displacement of every node (held ones zero). */
/**
 * Multigrid hierarchy: the first coarse level is the linear (T4) field on the same mesh — edge nodes interpolated from
 * their two corners, so Pᵀ K P is the T4 stiffness — and smoothed aggregation goes on from there.
 */
export function hierarchy(md: Model, theta = 0.08) {
  const { t10, free } = md, nv = t10.nv;
  const vf = new Int32Array(nv).fill(-1); let n4 = 0;
  for (let v = 0; v < nv; v++) if (free[v] >= 0) vf[v] = n4++;
  const ptr = new Int32Array(md.K.n + 1), col: number[] = [], val: number[] = [];
  const rowOf = new Int32Array(md.K.n / 3);
  for (let v = 0; v < t10.nn; v++) if (free[v] >= 0) rowOf[free[v]] = v;
  for (let f = 0; f < md.K.n / 3; f++) {
    const v = rowOf[f];
    for (let c = 0; c < 3; c++) {
      if (v < nv) { col.push(3 * vf[v] + c); val.push(1); }
      else { const a = t10.ends[2 * (v - nv)], b = t10.ends[2 * (v - nv) + 1]; if (vf[a] >= 0) { col.push(3 * vf[a] + c); val.push(0.5); } if (vf[b] >= 0) { col.push(3 * vf[b] + c); val.push(0.5); } }
      ptr[3 * f + c + 1] = col.length;
    }
  }
  const P: Csr = { n: md.K.n, m: 3 * n4, ptr, col: Int32Array.from(col), val: Float64Array.from(val) }, R = transpose(P);
  const K4 = spgemm(R, spgemm(md.K, P));
  const ns4 = new Int32Array(n4 + 1); for (let i = 0; i <= n4; i++) ns4[i] = 3 * i;
  const B4 = new Float64Array(3 * n4 * 6);
  for (let v = 0; v < nv; v++) if (vf[v] >= 0) B4.set(md.B.subarray(18 * free[v], 18 * free[v] + 18), 18 * vf[v]);
  const d = new Float64Array(md.K.n); for (let i = 0; i < md.K.n; i++) for (let k = md.K.ptr[i]; k < md.K.ptr[i + 1]; k++) if (md.K.col[k] === i) d[i] = md.K.val[k];
  return [{ A: md.K, d, P, R }, ...amgSetup(K4, ns4, B4, 6, 600, theta)];
}

export function* solve(md: Model, F: Float64Array, tol = 1e-8, theta = 0.08) {
  const L = hierarchy(md, theta);
  const g = pcg(md.K, F, L, tol);
  let r = g.next(); while (!r.done) { yield r.value; r = g.next(); }
  const { x, it, res } = r.value, u = new Float64Array(3 * md.t10.nn);
  for (let v = 0; v < md.t10.nn; v++) { const f = md.free[v]; if (f >= 0) { u[3 * v] = x[3 * f]; u[3 * v + 1] = x[3 * f + 1]; u[3 * v + 2] = x[3 * f + 2]; } }
  return { u, it, res, levels: L.length, sizes: L.map((l) => l.A.n), coarse: L[L.length - 1].A.n };
}

const NODE_L = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [0.5, 0.5, 0, 0], [0, 0.5, 0.5, 0], [0.5, 0, 0.5, 0], [0.5, 0, 0, 0.5], [0, 0.5, 0, 0.5], [0, 0, 0.5, 0.5]];

/** Stress (6 per node: xx, yy, zz, yz, xz, xy) averaged over the elements at each node, and von Mises per node. */
export function nodalStress(t10: T10, u: Float64Array, mat: Iso) {
  const { nn, ne, conn, X } = t10, S = new Float64Array(6 * nn), cnt = new Float64Array(nn), D = Dmat(mat);
  const dL = new Float64Array(40), g = new Float64Array(30), eps = [0, 0, 0, 0, 0, 0];
  for (let e = 0; e < ne; e++) {
    const nodes = conn.subarray(10 * e, 10 * e + 10);
    const w = vol6(X, nodes[0], nodes[1], nodes[2], nodes[3]);
    for (let k = 0; k < 10; k++) {
      grads(X, nodes, NODE_L[k], dL, g);
      eps.fill(0);
      for (let n = 0; n < 10; n++) {
        const ux = u[3 * nodes[n]], uy = u[3 * nodes[n] + 1], uz = u[3 * nodes[n] + 2], gx = g[3 * n], gy = g[3 * n + 1], gz = g[3 * n + 2];
        eps[0] += gx * ux; eps[1] += gy * uy; eps[2] += gz * uz; eps[3] += gz * uy + gy * uz; eps[4] += gz * ux + gx * uz; eps[5] += gy * ux + gx * uy;
      }
      const v = nodes[k];
      for (let r = 0; r < 6; r++) { let s = 0; for (let c = 0; c < 6; c++) s += D[6 * r + c] * eps[c]; S[6 * v + r] += w * s; }
      cnt[v] += w;
    }
  }
  const vm = new Float64Array(nn);
  for (let v = 0; v < nn; v++) {
    if (!cnt[v]) continue;
    for (let r = 0; r < 6; r++) S[6 * v + r] /= cnt[v];
    const [a, b, c, yz, xz, xy] = S.subarray(6 * v, 6 * v + 6);
    vm[v] = Math.sqrt(0.5 * ((a - b) ** 2 + (b - c) ** 2 + (c - a) ** 2) + 3 * (yz * yz + xz * xz + xy * xy));
  }
  return { S, vm };
}
