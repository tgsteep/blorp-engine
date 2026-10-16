/**
 * Tetrahedral mesh of a closed triangle mesh by isosurface stuffing (Labelle & Shewchuk, "Isosurface stuffing: fast
 * tetrahedral meshes with good dihedral angles", SIGGRAPH 2007), uniform version:
 *  - body-centred cubic lattice: cube corners and cube centres, spacing h; each pair of face-neighbouring cubes gives
 *    four tetrahedra (the two centres + one edge of the shared square);
 *  - every lattice point is inside (+) or outside (−) the surface; on each edge from + to − the surface crossing is a
 *    cut point;
 *  - warping: a lattice point closer to a cut point than α of the edge (α 0.25 on the long edges, 0.41 on the short
 *    ones, the paper's values) moves onto that cut point and becomes a surface point (0), which removes the slivers;
 *  - each lattice tetrahedron keeps its inside part: whole, a smaller tetrahedron, a pyramid (2 tetrahedra) or a
 *    prism (3 tetrahedra). Quadrilaterals are split along the diagonal through their lowest-numbered vertex, so the
 *    tetrahedra on both sides of a shared face agree (Dompierre et al. 1999) — this replaces the paper's parity rule
 *    and keeps the mesh conforming, without its formal angle bounds (the mesher's tests report the angles reached).
 * The surface is followed to the cut points (exact crossings with the triangles). Sharp edges and corners of the input
 * (faces meeting at more than 40°, `featureEdges`) are kept: lattice points within 0.25 h of them move onto them before
 * cutting, surface vertices near them are moved onto them afterwards (`snapFeatures`), and surface edges that still cut
 * a corner off are split with the new vertex on the edge (`splitBevels`). Without this the lattice bevels every sharp
 * edge unevenly, and the small notches that leaves raised surface stresses by 10–20 % in a plain tension bar.
 */
import type { Mesh } from '../../manufacturing/stl.ts';
import { bounds, volume } from '../../manufacturing/stl.ts';
import { buildBvh, closestPoint, insideGrid, segmentHit, type Bvh, type V3 } from './geom.ts';

export type TetMesh = {
  /** Vertex positions (x, y, z per vertex). */
  pos: Float64Array;
  /** Four vertex numbers per tetrahedron, positive volume. */
  tet: Int32Array;
  /** 1 for vertices on the surface (warped lattice points and cut points). */
  surf: Uint8Array;
  h: number;
  bvh: Bvh;
  /** Surface vertices moved onto sharp edges after cutting, and corner-cutting edges split. */
  stats?: { snapped: number; split: number };
};

const ALPHA_LONG = 0.25, ALPHA_SHORT = 0.41;

/** Lattice spacing for about `cells` cubes inside the part. */
export const spacingFor = (m: Mesh, cells: number) => Math.cbrt((volume(m) || 1) / Math.max(1, cells));

export function stuff(m: Mesh, h: number): TetMesh {
  const B = bounds(m), bvh = buildBvh(m);
  // lattice box with one cube of margin all round so every boundary cube has outside corners
  const nx = Math.ceil(B.size[0] / h) + 2, ny = Math.ceil(B.size[1] / h) + 2, nz = Math.ceil(B.size[2] / h) + 2;
  // the lattice is shifted by odd fractions of h so its points do not fall exactly on axis-aligned faces at round
  // coordinates (a point on the surface has no clear inside/outside)
  const ox = B.lo[0] - (nx * h - B.size[0]) / 2 + 0.0371 * h, oy = B.lo[1] - (ny * h - B.size[1]) / 2 + 0.0613 * h, oz = B.lo[2] - (nz * h - B.size[2]) / 2 + 0.0827 * h;
  const cx = nx + 1, cy = ny + 1, NC = cx * cy * (nz + 1), NM = nx * ny * nz, NV = NC + NM;
  const cor = (i: number, j: number, k: number) => i + cx * (j + cy * k);
  const cen = (i: number, j: number, k: number) => NC + i + nx * (j + ny * k);
  // positions and signs of the lattice points
  const pos: number[] = new Array(3 * NV);
  for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const v = cor(i, j, k); pos[3 * v] = ox + i * h; pos[3 * v + 1] = oy + j * h; pos[3 * v + 2] = oz + k * h; }
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const v = cen(i, j, k); pos[3 * v] = ox + (i + 0.5) * h; pos[3 * v + 1] = oy + (j + 0.5) * h; pos[3 * v + 2] = oz + (k + 0.5) * h; }
  const inC = insideGrid(m, ox, oy, oz, h, cx, cy, nz + 1), inM = insideGrid(m, ox + h / 2, oy + h / 2, oz + h / 2, h, nx, ny, nz);
  const sign = new Int8Array(NV);
  for (let v = 0; v < NC; v++) sign[v] = inC[v] ? 1 : -1;
  for (let v = 0; v < NM; v++) sign[NC + v] = inM[v] ? 1 : -1;
  // sharp edges and corners of the input: lattice points close to them move onto them (and lie on the surface) while
  // the lattice is still regular, so the corner region is filled by whole tetrahedra instead of being cut off
  const FE = featureEdges(m), PRE = 0.25;
  if (FE.seg.length && PRE > 0) {
    const q = [0, 0, 0];
    for (let v = 0; v < NV; v++) {
      const d = nearestOnFeatures(FE, pos[3 * v], pos[3 * v + 1], pos[3 * v + 2], PRE * h, q);
      if (d < 0) continue;
      pos[3 * v] = q[0]; pos[3 * v + 1] = q[1]; pos[3 * v + 2] = q[2]; sign[v] = 0;
    }
  }

  // lattice tetrahedra: for every pair of face-neighbouring cubes, (centre a, centre b, edge of the shared square)
  const lat: number[] = [];
  const square = (a: number, b: number, q: [number, number, number, number]) => { for (let e = 0; e < 4; e++) lat.push(a, b, q[e], q[(e + 1) & 3]); };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = cen(i, j, k);
    if (i + 1 < nx) square(a, cen(i + 1, j, k), [cor(i + 1, j, k), cor(i + 1, j + 1, k), cor(i + 1, j + 1, k + 1), cor(i + 1, j, k + 1)]);
    if (j + 1 < ny) square(a, cen(i, j + 1, k), [cor(i, j + 1, k), cor(i + 1, j + 1, k), cor(i + 1, j + 1, k + 1), cor(i, j + 1, k + 1)]);
    if (k + 1 < nz) square(a, cen(i, j, k + 1), [cor(i, j, k + 1), cor(i + 1, j, k + 1), cor(i + 1, j + 1, k + 1), cor(i, j + 1, k + 1)]);
  }
  // keep only lattice tetrahedra that touch the inside
  const nl = lat.length / 4, keepL: number[] = [];
  for (let t = 0; t < nl; t++) { const o = 4 * t; if (sign[lat[o]] > 0 || sign[lat[o + 1]] > 0 || sign[lat[o + 2]] > 0 || sign[lat[o + 3]] > 0) keepL.push(t); }

  // cut points on edges from + to −: parameter from the + end; keyed by the edge (lower, higher vertex)
  const key = (a: number, b: number) => (a < b ? a * NV + b : b * NV + a);
  const cut = new Map<number, number>(); // key → t measured from the lower-numbered vertex
  const isLong = (a: number, b: number) => (a < NC) === (b < NC); // corner–corner or centre–centre
  const P = (v: number): V3 => [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]];
  const cutOf = (a: number, b: number) => {
    const kk = key(a, b); let t = cut.get(kk);
    if (t === undefined) {
      const [ip, im] = sign[a] > 0 ? [a, b] : [b, a];
      let s = segmentHit(bvh, P(ip), P(im)); if (s < 0) s = 0.5; // parity said there is a crossing; fall back to the middle
      t = ip < im ? s : 1 - s; cut.set(kk, t);
    }
    return t;
  };
  const E = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
  // warping: each lattice point takes the closest cut point that violates its α
  const warp = new Map<number, { d: number; a: number; b: number }>();
  for (const t of keepL) {
    const o = 4 * t;
    for (const [x, y] of E) {
      const a = lat[o + x], b = lat[o + y];
      if (sign[a] * sign[b] >= 0) continue;
      const s = cutOf(a, b), lo = Math.min(a, b), hi = Math.max(a, b), al = isLong(a, b) ? ALPHA_LONG : ALPHA_SHORT;
      // distance (as share of the edge) from each end
      for (const [v, f] of [[lo, s], [hi, 1 - s]] as const) if (f < al) { const w = warp.get(v); if (!w || f < w.d) warp.set(v, { d: f, a: lo, b: hi }); }
    }
  }
  for (const [v, w] of warp) {
    // the cut point may already be gone (an end warped onto an earlier point)
    if (sign[w.a] === 0 || sign[w.b] === 0 || sign[w.a] * sign[w.b] >= 0) continue;
    const s = cut.get(key(w.a, w.b))!;
    for (let c = 0; c < 3; c++) pos[3 * v + c] = pos[3 * w.a + c] + s * (pos[3 * w.b + c] - pos[3 * w.a + c]);
    sign[v] = 0;
  }

  // output vertices: lattice points with sign ≥ 0 that are used, plus the remaining cut points
  const outPos: number[] = [], surf: number[] = [], map = new Int32Array(NV).fill(-1), cutId = new Map<number, number>();
  const vid = (v: number) => {
    if (map[v] < 0) { map[v] = outPos.length / 3; outPos.push(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]); surf.push(sign[v] === 0 ? 1 : 0); }
    return map[v];
  };
  const cid = (a: number, b: number) => {
    const kk = key(a, b); let id = cutId.get(kk);
    if (id === undefined) {
      const lo = Math.min(a, b), hi = Math.max(a, b), s = cut.get(kk) ?? cutOf(a, b);
      id = outPos.length / 3; cutId.set(kk, id);
      for (let c = 0; c < 3; c++) outPos.push(pos[3 * lo + c] + s * (pos[3 * hi + c] - pos[3 * lo + c]));
      surf.push(1);
    }
    return id;
  };
  const tets: number[] = [];
  const add = (a: number, b: number, c: number, d: number) => tets.push(a, b, c, d);
  const pyramid = (b0: number, b1: number, b2: number, b3: number, apex: number) => {
    const mn = Math.min(b0, b1, b2, b3);
    if (mn === b0 || mn === b2) { add(b0, b1, b2, apex); add(b0, b2, b3, apex); } else { add(b1, b2, b3, apex); add(b1, b3, b0, apex); }
  };
  const ROT = [[0, 1, 2, 3, 4, 5], [1, 2, 0, 4, 5, 3], [2, 0, 1, 5, 3, 4], [3, 5, 4, 0, 2, 1], [4, 3, 5, 1, 0, 2], [5, 4, 3, 2, 1, 0]];
  /** Prism with triangles (v0 v1 v2), (v3 v4 v5) and edges v0–v3, v1–v4, v2–v5. */
  const prism = (u: number[]) => {
    let im = 0; for (let i = 1; i < 6; i++) if (u[i] < u[im]) im = i;
    const V = ROT[im].map((i) => u[i]);
    if (Math.min(V[1], V[5]) < Math.min(V[2], V[4])) { add(V[0], V[1], V[2], V[5]); add(V[0], V[1], V[5], V[4]); add(V[0], V[4], V[5], V[3]); }
    else { add(V[0], V[1], V[2], V[4]); add(V[0], V[4], V[2], V[5]); add(V[0], V[4], V[5], V[3]); }
  };
  for (const t of keepL) {
    const q = [lat[4 * t], lat[4 * t + 1], lat[4 * t + 2], lat[4 * t + 3]];
    const Pp = q.filter((v) => sign[v] > 0), Z = q.filter((v) => sign[v] === 0), M = q.filter((v) => sign[v] < 0);
    if (!Pp.length) continue;
    if (!M.length) { add(vid(q[0]), vid(q[1]), vid(q[2]), vid(q[3])); continue; }
    const p = Pp.length, z = Z.length;
    if (p === 1 && z === 0) add(vid(Pp[0]), cid(Pp[0], M[0]), cid(Pp[0], M[1]), cid(Pp[0], M[2]));
    else if (p === 1 && z === 1) add(vid(Pp[0]), vid(Z[0]), cid(Pp[0], M[0]), cid(Pp[0], M[1]));
    else if (p === 1 && z === 2) add(vid(Pp[0]), vid(Z[0]), vid(Z[1]), cid(Pp[0], M[0]));
    else if (p === 2 && z === 0) prism([vid(Pp[0]), cid(Pp[0], M[0]), cid(Pp[0], M[1]), vid(Pp[1]), cid(Pp[1], M[0]), cid(Pp[1], M[1])]);
    else if (p === 2 && z === 1) pyramid(vid(Pp[0]), vid(Pp[1]), cid(Pp[1], M[0]), cid(Pp[0], M[0]), vid(Z[0]));
    else if (p === 3) prism([vid(Pp[0]), vid(Pp[1]), vid(Pp[2]), cid(Pp[0], M[0]), cid(Pp[1], M[0]), cid(Pp[2], M[0])]);
  }
  // orient every tetrahedron positively; drop flat ones
  const X = Float64Array.from(outPos), out: number[] = [];
  const tol = 1e-9 * h * h * h;
  for (let e = 0; e < tets.length; e += 4) {
    let [a, b, c, d] = [tets[e], tets[e + 1], tets[e + 2], tets[e + 3]];
    const v = vol6(X, a, b, c, d);
    if (Math.abs(v) < tol) continue;
    if (v < 0) { const s = c; c = d; d = s; }
    out.push(a, b, c, d);
  }
  const tm: TetMesh = { pos: X, tet: Int32Array.from(out), surf: Uint8Array.from(surf), h, bvh };
  const sn = snapFeatures(tm, m), sp = splitBevels(tm, m);
  tm.stats = { snapped: sn.moved, split: sp.split };
  return tm;
}

/** Feature lines of a closed triangle mesh: edges whose two faces meet at more than `angle` degrees (6 numbers each). */
export function featureEdges(m: Mesh, angle = 40) {
  const p = m.pos, nt = p.length / 9, B = bounds(m), tol = 1e-6 * Math.max(...B.size, 1e-9);
  const ids = new Map<string, number>(), pts: number[] = [];
  const vid = (o: number) => { const k = `${Math.round(p[o] / tol)},${Math.round(p[o + 1] / tol)},${Math.round(p[o + 2] / tol)}`; let id = ids.get(k); if (id === undefined) { id = pts.length / 3; ids.set(k, id); pts.push(p[o], p[o + 1], p[o + 2]); } return id; };
  const nrm: number[][] = [], edges = new Map<number, number[]>();
  for (let t = 0; t < nt; t++) {
    const o = 9 * t, a = vid(o), b = vid(o + 3), c = vid(o + 6);
    const ux = p[o + 3] - p[o], uy = p[o + 4] - p[o + 1], uz = p[o + 5] - p[o + 2], vx = p[o + 6] - p[o], vy = p[o + 7] - p[o + 1], vz = p[o + 8] - p[o + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    nrm.push([nx / l, ny / l, nz / l]);
    for (const [u, w] of [[a, b], [b, c], [c, a]]) { const k = Math.min(u, w) * 1e9 + Math.max(u, w); const e = edges.get(k); if (e) e.push(t); else edges.set(k, [t]); }
  }
  const cosA = Math.cos((angle * Math.PI) / 180), seg: number[] = [], concave: number[] = [], deg = new Map<number, number>();
  const cen = (t: number) => [0, 1, 2].map((a) => (p[9 * t + a] + p[9 * t + 3 + a] + p[9 * t + 6 + a]) / 3);
  for (const [k, ts] of edges) {
    if (ts.length !== 2) continue;
    const [n1, n2] = [nrm[ts[0]], nrm[ts[1]]];
    if (n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] > cosA) continue;
    const u = Math.floor(k / 1e9), w = k - u * 1e9;
    seg.push(pts[3 * u], pts[3 * u + 1], pts[3 * u + 2], pts[3 * w], pts[3 * w + 1], pts[3 * w + 2]);
    // an inner (re-entrant) edge: the second face lies on the outer side of the first one's plane
    const c1 = cen(ts[0]), c2 = cen(ts[1]);
    if (n1[0] * (c2[0] - c1[0]) + n1[1] * (c2[1] - c1[1]) + n1[2] * (c2[2] - c1[2]) > 0) concave.push(pts[3 * u], pts[3 * u + 1], pts[3 * u + 2], pts[3 * w], pts[3 * w + 1], pts[3 * w + 2]);
    deg.set(u, (deg.get(u) ?? 0) + 1); deg.set(w, (deg.get(w) ?? 0) + 1);
  }
  // corners: points where three or more feature lines meet
  const corners: number[] = [];
  for (const [v, d] of deg) if (d >= 3) corners.push(pts[3 * v], pts[3 * v + 1], pts[3 * v + 2]);
  return { seg: Float64Array.from(seg), corners: Float64Array.from(corners), concave: Float64Array.from(concave) };
}

/**
 * Moves surface vertices near sharp edges and corners of the input onto them, so a box stays a box instead of having
 * its edges bevelled by the lattice. Closest vertices first; a vertex is not moved onto a spot another vertex already
 * took (within 0.45 h), and a move is undone when any tetrahedron at the vertex would become flat or turned over.
 */
export function snapFeatures(tm: TetMesh, m: Mesh, angle = 40) {
  const { seg, corners } = featureEdges(m, angle);
  if (!seg.length) return { moved: 0 };
  const X = tm.pos, T = tm.tet, h = tm.h, nv = X.length / 3;
  // tetrahedra at each vertex
  const cnt = new Int32Array(nv + 1); for (let i = 0; i < T.length; i++) cnt[T[i] + 1]++;
  for (let v = 0; v < nv; v++) cnt[v + 1] += cnt[v];
  const at = new Int32Array(T.length), fillp = cnt.slice(0, nv); for (let i = 0; i < T.length; i++) at[fillp[T[i]]++] = i >> 2;
  // spatial hash of the feature segments (cells of size h)
  const cell = (x: number, y: number, z: number) => `${Math.floor(x / h)},${Math.floor(y / h)},${Math.floor(z / h)}`;
  const grid = new Map<string, number[]>();
  const ns = seg.length / 6;
  for (let s = 0; s < ns; s++) {
    const o = 6 * s, L = Math.hypot(seg[o + 3] - seg[o], seg[o + 4] - seg[o + 1], seg[o + 5] - seg[o + 2]), n = Math.max(1, Math.ceil(L / (0.5 * h)));
    const seen = new Set<string>();
    for (let k = 0; k <= n; k++) { const t = k / n, c = cell(seg[o] + t * (seg[o + 3] - seg[o]), seg[o + 1] + t * (seg[o + 4] - seg[o + 1]), seg[o + 2] + t * (seg[o + 5] - seg[o + 2])); if (!seen.has(c)) { seen.add(c); const g = grid.get(c); if (g) g.push(s); else grid.set(c, [s]); } }
  }
  const near = (x: number, y: number, z: number) => {
    const i = Math.floor(x / h), j = Math.floor(y / h), k = Math.floor(z / h), out: number[] = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const g = grid.get(`${i + a},${j + b},${k + c}`); if (g) out.push(...g); }
    return out;
  };
  type Cand = { v: number; d: number; q: number[]; corner: boolean };
  const cands: Cand[] = [];
  for (let v = 0; v < nv; v++) {
    if (!tm.surf[v]) continue;
    const x = X[3 * v], y = X[3 * v + 1], z = X[3 * v + 2];
    // corners first (a vertex near a corner goes to the corner)
    let best: Cand | null = null;
    for (let c = 0; c < corners.length; c += 3) { const d = Math.hypot(corners[c] - x, corners[c + 1] - y, corners[c + 2] - z); if (d < 0.6 * h && (!best || d < best.d)) best = { v, d, q: [corners[c], corners[c + 1], corners[c + 2]], corner: true }; }
    if (!best) for (const s of new Set(near(x, y, z))) {
      const o = 6 * s, ex = seg[o + 3] - seg[o], ey = seg[o + 4] - seg[o + 1], ez = seg[o + 5] - seg[o + 2], ee = ex * ex + ey * ey + ez * ez;
      const t = Math.max(0, Math.min(1, ((x - seg[o]) * ex + (y - seg[o + 1]) * ey + (z - seg[o + 2]) * ez) / (ee || 1)));
      const qx = seg[o] + t * ex, qy = seg[o + 1] + t * ey, qz = seg[o + 2] + t * ez, d = Math.hypot(qx - x, qy - y, qz - z);
      if (d < 0.6 * h && (!best || d < best.d)) best = { v, d, q: [qx, qy, qz], corner: false };
    }
    if (best && best.d > 1e-9 * h) cands.push(best);
  }
  cands.sort((a, b) => (a.corner === b.corner ? a.d - b.d : a.corner ? -1 : 1));
  const taken = new Map<string, number[][]>(), r2 = (0.45 * h) ** 2;
  const takenNear = (q: number[]) => { const i = Math.floor(q[0] / h), j = Math.floor(q[1] / h), k = Math.floor(q[2] / h); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (const p of taken.get(`${i + a},${j + b},${k + c}`) ?? []) if ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 < r2) return true; return false; };
  const minVol = 0.02 * h * h * h; // 6 × volume floor (a regular tetrahedron of edge h has 6V = 0.71 h³)
  let moved = 0, skipTaken = 0, skipBad = 0;
  for (const c of cands) {
    if (takenNear(c.q)) { skipTaken++; continue; }
    const v = c.v, old = [X[3 * v], X[3 * v + 1], X[3 * v + 2]];
    X[3 * v] = c.q[0]; X[3 * v + 1] = c.q[1]; X[3 * v + 2] = c.q[2];
    let ok = true;
    for (let k = cnt[v]; k < cnt[v + 1]; k++) { const e = 4 * at[k]; if (vol6(X, T[e], T[e + 1], T[e + 2], T[e + 3]) < minVol) { ok = false; break; } }
    if (!ok) { X[3 * v] = old[0]; X[3 * v + 1] = old[1]; X[3 * v + 2] = old[2]; skipBad++; continue; }
    moved++;
    const key = cell(c.q[0], c.q[1], c.q[2]); const g = taken.get(key); if (g) g.push(c.q); else taken.set(key, [c.q]);
  }
  return { moved, skipTaken, skipBad, cands: cands.length };
}

/** Six times the signed volume of tetrahedron (a, b, c, d). */
export function vol6(X: Float64Array, a: number, b: number, c: number, d: number) {
  const ax = X[3 * a], ay = X[3 * a + 1], az = X[3 * a + 2];
  const bx = X[3 * b] - ax, by = X[3 * b + 1] - ay, bz = X[3 * b + 2] - az, cx = X[3 * c] - ax, cy = X[3 * c + 1] - ay, cz = X[3 * c + 2] - az, dx = X[3 * d] - ax, dy = X[3 * d + 1] - ay, dz = X[3 * d + 2] - az;
  return bx * (cy * dz - cz * dy) - by * (cx * dz - cz * dx) + bz * (cx * dy - cy * dx);
}

/** Smallest and largest dihedral angle [°] over all tetrahedra, and the share below 10°. */
export function dihedrals(tm: TetMesh) {
  const X = tm.pos, T = tm.tet;
  let mn = 180, mx = 0, bad = 0;
  const face = [[1, 2, 3], [0, 2, 3], [0, 1, 3], [0, 1, 2]];
  const nrm = (a: number, b: number, c: number, opp: number) => {
    const ux = X[3 * b] - X[3 * a], uy = X[3 * b + 1] - X[3 * a + 1], uz = X[3 * b + 2] - X[3 * a + 2], vx = X[3 * c] - X[3 * a], vy = X[3 * c + 1] - X[3 * a + 1], vz = X[3 * c + 2] - X[3 * a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    // point outwards (away from the opposite vertex)
    const s = nx * (X[3 * opp] - X[3 * a]) + ny * (X[3 * opp + 1] - X[3 * a + 1]) + nz * (X[3 * opp + 2] - X[3 * a + 2]);
    return s > 0 ? [-nx, -ny, -nz] : [nx, ny, nz];
  };
  for (let e = 0; e < T.length; e += 4) {
    const q = [T[e], T[e + 1], T[e + 2], T[e + 3]], n = face.map((f, i) => nrm(q[f[0]], q[f[1]], q[f[2]], q[i]));
    let lo = 180;
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      const a = 180 - (Math.acos(Math.max(-1, Math.min(1, n[i][0] * n[j][0] + n[i][1] * n[j][1] + n[i][2] * n[j][2]))) * 180) / Math.PI;
      if (a < lo) lo = a; if (a < mn) mn = a; if (a > mx) mx = a;
    }
    if (lo < 10) bad++;
  }
  return { min: mn, max: mx, below10: bad / Math.max(1, T.length / 4) };
}

/** Total volume of the tetrahedra. */
export function tetVolume(tm: TetMesh) { let s = 0; for (let e = 0; e < tm.tet.length; e += 4) s += vol6(tm.pos, tm.tet[e], tm.tet[e + 1], tm.tet[e + 2], tm.tet[e + 3]) / 6; return s; }

/**
 * After snapping, surface edges can still run from one face of a sharp edge to the other, cutting the corner off. Such
 * an edge (its middle lies inside the part, more than 4 % of its length below the surface, with a feature line within
 * 0.6 h) is split at the point nearest the feature line, every tetrahedron on it is split in two, and the new vertex is
 * moved onto the feature line (kept on the edge if a tetrahedron would turn flat). Repeated a few times.
 */
export function splitBevels(tm: TetMesh, m: Mesh, angle = 40, passes = 4) {
  const { seg } = featureEdges(m, angle);
  if (!seg.length) return { split: 0 };
  const h = tm.h, ns = seg.length / 6, tmp = [0, 0, 0];
  let X = Array.from(tm.pos), T = Array.from(tm.tet), surf = Array.from(tm.surf), total = 0;
  const minVol = 0.01 * h * h * h;
  const v6 = (a: number, b: number, c: number, d: number) => {
    const ax = X[3 * a], ay = X[3 * a + 1], az = X[3 * a + 2];
    const bx = X[3 * b] - ax, by = X[3 * b + 1] - ay, bz = X[3 * b + 2] - az, cx = X[3 * c] - ax, cy = X[3 * c + 1] - ay, cz = X[3 * c + 2] - az, dx = X[3 * d] - ax, dy = X[3 * d + 1] - ay, dz = X[3 * d + 2] - az;
    return bx * (cy * dz - cz * dy) - by * (cx * dz - cz * dx) + bz * (cx * dy - cy * dx);
  };
  /** Closest points between segment AB and the nearest feature segment: parameter on AB, feature point, distance. */
  const nearestFeature = (a: number, b: number) => {
    let best = { s: 0.5, q: [0, 0, 0], d: Infinity };
    const P = [X[3 * a], X[3 * a + 1], X[3 * a + 2]], D = [X[3 * b] - P[0], X[3 * b + 1] - P[1], X[3 * b + 2] - P[2]];
    for (let k = 0; k < ns; k++) {
      const o = 6 * k, Q = [seg[o], seg[o + 1], seg[o + 2]], E = [seg[o + 3] - Q[0], seg[o + 4] - Q[1], seg[o + 5] - Q[2]];
      // quick reject by distance of the midpoint to the segment's box
      const mx = P[0] + D[0] / 2, my = P[1] + D[1] / 2, mz = P[2] + D[2] / 2;
      if (mx < Math.min(Q[0], Q[0] + E[0]) - h || mx > Math.max(Q[0], Q[0] + E[0]) + h || my < Math.min(Q[1], Q[1] + E[1]) - h || my > Math.max(Q[1], Q[1] + E[1]) + h || mz < Math.min(Q[2], Q[2] + E[2]) - h || mz > Math.max(Q[2], Q[2] + E[2]) + h) continue;
      const r = [P[0] - Q[0], P[1] - Q[1], P[2] - Q[2]], dd = D[0] * D[0] + D[1] * D[1] + D[2] * D[2], ee = E[0] * E[0] + E[1] * E[1] + E[2] * E[2], de = D[0] * E[0] + D[1] * E[1] + D[2] * E[2], dr = D[0] * r[0] + D[1] * r[1] + D[2] * r[2], er = E[0] * r[0] + E[1] * r[1] + E[2] * r[2];
      const den = dd * ee - de * de;
      let sp = den > 1e-12 * dd * ee ? (de * er - ee * dr) / den : 0.5; sp = Math.max(0, Math.min(1, sp));
      let tq = (de * sp + er) / (ee || 1); tq = Math.max(0, Math.min(1, tq));
      sp = Math.max(0, Math.min(1, (de * tq - dr) / (dd || 1)));
      const p1 = [P[0] + sp * D[0], P[1] + sp * D[1], P[2] + sp * D[2]], q1 = [Q[0] + tq * E[0], Q[1] + tq * E[1], Q[2] + tq * E[2]];
      const d = Math.hypot(p1[0] - q1[0], p1[1] - q1[1], p1[2] - q1[2]);
      if (d < best.d) best = { s: sp, q: q1, d };
    }
    return best;
  };
  for (let pass = 0; pass < passes; pass++) {
    // boundary faces → boundary edges, and edge → tetrahedra
    const nt = T.length / 4, fc = new Map<string, number>();
    const F4 = [[1, 2, 3], [0, 2, 3], [0, 1, 3], [0, 1, 2]];
    for (let t = 0; t < nt; t++) for (const f of F4) { const k = f.map((i) => T[4 * t + i]).sort((x, y) => x - y).join(','); fc.set(k, (fc.get(k) ?? 0) + 1); }
    const bedge = new Set<string>();
    for (const [k, c] of fc) if (c === 1) { const [a, b, d] = k.split(',').map(Number); bedge.add(`${a},${b}`); bedge.add(`${b},${d}`); bedge.add(`${a},${d}`); }
    const etets = new Map<string, number[]>();
    for (let t = 0; t < nt; t++) for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) { const a = T[4 * t + i], b = T[4 * t + j], k = a < b ? `${a},${b}` : `${b},${a}`; if (!bedge.has(k)) continue; const l = etets.get(k); if (l) l.push(t); else etets.set(k, [t]); }
    const busy = new Uint8Array(nt);
    let n = 0;
    for (const [k, tets] of etets) {
      if (tets.some((t) => busy[t])) continue;
      const [a, b] = k.split(',').map(Number), L = Math.hypot(X[3 * a] - X[3 * b], X[3 * a + 1] - X[3 * b + 1], X[3 * a + 2] - X[3 * b + 2]);
      if (L < 0.3 * h) continue;
      const mid: V3 = [(X[3 * a] + X[3 * b]) / 2, (X[3 * a + 1] + X[3 * b + 1]) / 2, (X[3 * a + 2] + X[3 * b + 2]) / 2];
      if (closestPoint(tm.bvh, mid, tmp, h).d < 0.04 * L) continue; // the edge lies on the surface
      const f = nearestFeature(a, b);
      if (f.d > 0.6 * h || f.s < 0.1 || f.s > 0.9) continue;
      // split
      const mId = X.length / 3;
      X.push(X[3 * a] + f.s * (X[3 * b] - X[3 * a]), X[3 * a + 1] + f.s * (X[3 * b + 1] - X[3 * a + 1]), X[3 * a + 2] + f.s * (X[3 * b + 2] - X[3 * a + 2]));
      surf.push(1);
      for (const t of tets) {
        busy[t] = 1;
        const q = T.slice(4 * t, 4 * t + 4), q2 = q.slice();
        for (let i = 0; i < 4; i++) { if (q[i] === b) q[i] = mId; if (q2[i] === a) q2[i] = mId; }
        for (let i = 0; i < 4; i++) T[4 * t + i] = q[i];
        T.push(...q2);
      }
      // move the new vertex onto the feature line if every tetrahedron at it stays valid
      const on = [X[3 * mId], X[3 * mId + 1], X[3 * mId + 2]];
      X[3 * mId] = f.q[0]; X[3 * mId + 1] = f.q[1]; X[3 * mId + 2] = f.q[2];
      let ok = true;
      for (let t = 0; t < T.length / 4 && ok; t++) { const e = 4 * t; if ((T[e] === mId || T[e + 1] === mId || T[e + 2] === mId || T[e + 3] === mId) && v6(T[e], T[e + 1], T[e + 2], T[e + 3]) < minVol) ok = false; }
      if (!ok) { X[3 * mId] = on[0]; X[3 * mId + 1] = on[1]; X[3 * mId + 2] = on[2]; }
      n++;
    }
    total += n;
    if (!n) break;
  }
  tm.pos = Float64Array.from(X); tm.tet = Int32Array.from(T); tm.surf = Uint8Array.from(surf);
  return { split: total };
}

/** Closest point on the feature lines (corners preferred within 1.3 r) within r of (x, y, z); −1 when none. */
export function nearestOnFeatures(FE: { seg: Float64Array; corners: Float64Array; grid?: Map<string, number[]>; cell?: number }, x: number, y: number, z: number, r: number, out: number[]) {
  const C = FE.corners;
  let best = -1, bd = Infinity;
  for (let c = 0; c < C.length; c += 3) { const d = Math.hypot(C[c] - x, C[c + 1] - y, C[c + 2] - z); if (d < 1.3 * r && d < bd) { bd = d; best = c; } }
  if (best >= 0) { out[0] = C[best]; out[1] = C[best + 1]; out[2] = C[best + 2]; return bd; }
  // spatial hash of the segments, built on first use for this cell size
  const cs = 2 * r;
  if (!FE.grid || FE.cell !== cs) {
    const g = new Map<string, number[]>(), S = FE.seg;
    for (let s = 0; s < S.length / 6; s++) {
      const o = 6 * s, L = Math.hypot(S[o + 3] - S[o], S[o + 4] - S[o + 1], S[o + 5] - S[o + 2]), n = Math.max(1, Math.ceil(L / (0.5 * cs))), seen = new Set<string>();
      for (let k = 0; k <= n; k++) { const t = k / n, key = `${Math.floor((S[o] + t * (S[o + 3] - S[o])) / cs)},${Math.floor((S[o + 1] + t * (S[o + 4] - S[o + 1])) / cs)},${Math.floor((S[o + 2] + t * (S[o + 5] - S[o + 2])) / cs)}`; if (!seen.has(key)) { seen.add(key); const l = g.get(key); if (l) l.push(s); else g.set(key, [s]); } }
    }
    FE.grid = g; FE.cell = cs;
  }
  const S = FE.seg, i0 = Math.floor(x / cs), j0 = Math.floor(y / cs), k0 = Math.floor(z / cs);
  let found = -1;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (const s of FE.grid!.get(`${i0 + a},${j0 + b},${k0 + c}`) ?? []) {
    const o = 6 * s, ex = S[o + 3] - S[o], ey = S[o + 4] - S[o + 1], ez = S[o + 5] - S[o + 2], ee = ex * ex + ey * ey + ez * ez;
    const t = Math.max(0, Math.min(1, ((x - S[o]) * ex + (y - S[o + 1]) * ey + (z - S[o + 2]) * ez) / (ee || 1)));
    const qx = S[o] + t * ex, qy = S[o + 1] + t * ey, qz = S[o + 2] + t * ez, d = Math.hypot(qx - x, qy - y, qz - z);
    if (d < r && d < bd) { bd = d; found = s; out[0] = qx; out[1] = qy; out[2] = qz; }
  }
  return found >= 0 ? bd : -1;
}
