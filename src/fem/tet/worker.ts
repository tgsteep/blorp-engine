/**
 * The static analysis's tetrahedral solver as a message-driven worker (hidden WebView on phones, Web Worker on the
 * web; bundled into `tetWorkerBundle.ts` by `scripts/build-tet-worker.mjs`). The worker keeps the prepared model, so a
 * new load case sends only face numbers and numbers. Messages in: {type: 'prep', id, prep} / {type: 'solve', id, job}
 * / {type: 'cancel', id}; out: {type: 'prepped' | 'prepError' | 'progress' | 'result' | 'error', id, …}. Arrays travel
 * as base64.
 */
import { fromB64, toB64 } from '../../manufacturing/b64.ts';
import { bounds, meshCheck, volume, type Mesh } from '../../manufacturing/stl.ts';
import { closestPoint } from './geom.ts';
import { dihedrals, featureEdges, spacingFor, stuff, tetVolume, vol6, type TetMesh } from './stuff.ts';
import { assemble, faceArea, loadVector, nodalStress, solve, toT10, weightVector, type T10 } from './fe.ts';

type V3 = [number, number, number];
export type TetPrepJob = { mesh: string; scale: number; cells: number; check: boolean };
export type TetPrep = {
  /** surface nodes (x, y, z as Float32) and boundary faces (6 surface-node numbers each, Int32) */
  pos: string; faces: string; nf: number;
  ne: number; nodes: number; h: number; vol: number; volRatio: number; minDih: number; size: number; tris: number;
  info: { openEdges: number; edges: number; bodies: number } | null; ms: number;
};
export type TetLoadGroup = { faces: number[]; F: number; dir: V3 };
export type TetSolveJob = { fixed: number[]; groups: TetLoadGroup[]; load: 'force' | 'pressure'; E: number; nu: number; rho: number; fy: number; grav: number; gdir: V3 };
export type TetResult = {
  vm: string; u: string; maxDisp: number; sMax: number; at: V3 | null; sAll: number; nearSupport: boolean; sharp: boolean;
  bands: number[]; mass: number; weight: number; fres: V3; it: number; res: number; converged: boolean; ne: number; ndof: number; nFixed: number; ms: number;
  section: { axis: number; value: number; tris: string; util: string };
};

/** What the worker keeps between messages. */
type Held = { m: Mesh; tm: TetMesh; t10: T10; local: Int32Array; surfNodes: Int32Array; trusted: Uint8Array; concave: Float64Array; size: number };
let cur: Held | null = null;

export function prepTet(job: TetPrepJob): TetPrep {
  const t0 = Date.now(), b = fromB64(job.mesh), raw = new Float32Array(b.buffer, 0, b.length >> 2);
  const m: Mesh = { pos: job.scale === 1 ? raw : raw.map((x) => x * job.scale) };
  const info = job.check ? meshCheck(m) : null, V = volume(m), B = bounds(m), size = Math.max(...B.size);
  // a finer lattice when the first one misses part of the volume (thin walls): up to three times, 0.8 h each
  let h = spacingFor(m, job.cells), tm = stuff(m, h);
  for (let k = 0; k < 3 && tetVolume(tm) < 0.98 * V && tm.tet.length / 4 < 60000; k++) { h *= 0.8; tm = stuff(m, h); }
  const t10 = toT10(tm), X = t10.X;
  // surface nodes in a local numbering
  const local = new Int32Array(t10.nn).fill(-1), sn: number[] = [];
  for (let v = 0; v < t10.nn; v++) if (t10.onSurf[v]) { local[v] = sn.length; sn.push(v); }
  const pos = new Float32Array(3 * sn.length), trusted = new Uint8Array(sn.length), q = [0, 0, 0];
  sn.forEach((v, i) => {
    pos[3 * i] = X[3 * v]; pos[3 * i + 1] = X[3 * v + 1]; pos[3 * i + 2] = X[3 * v + 2];
    if (closestPoint(tm.bvh, [X[3 * v], X[3 * v + 1], X[3 * v + 2]], q, tm.h).d <= 0.05 * tm.h) trusted[i] = 1;
  });
  const faces = new Int32Array(6 * t10.nbf); for (let i = 0; i < faces.length; i++) faces[i] = local[t10.bf[i]];
  cur = { m, tm, t10, local, surfNodes: Int32Array.from(sn), trusted, concave: featureEdges(m).concave, size };
  return {
    pos: toB64(new Uint8Array(pos.buffer)), faces: toB64(new Uint8Array(faces.buffer)), nf: t10.nbf,
    ne: t10.ne, nodes: t10.nn, h: tm.h, vol: tetVolume(tm), volRatio: tetVolume(tm) / (V || 1), minDih: dihedrals(tm).min, size, tris: m.pos.length / 9, info, ms: Date.now() - t0,
  };
}

/** Piece number of every node (elements joined through shared corners). */
export function components(t10: T10) {
  const par = new Int32Array(t10.nv).map((_, i) => i);
  const find = (a: number): number => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  for (let e = 0; e < t10.ne; e++) { const r = find(t10.conn[10 * e]); for (let k = 1; k < 4; k++) { const q = find(t10.conn[10 * e + k]); if (q !== r) par[q] = r; } }
  const comp = new Int32Array(t10.nn);
  for (let v = 0; v < t10.nv; v++) comp[v] = find(v);
  for (let i = 0; i < t10.nn - t10.nv; i++) comp[t10.nv + i] = comp[t10.ends[2 * i]];
  return comp;
}

/** Distance from point p to the nearest segment of a list (6 numbers per segment); Infinity when there is none. */
function segDist(S: Float64Array, p: number[]) {
  let best = Infinity;
  for (let o = 0; o < S.length; o += 6) {
    const ex = S[o + 3] - S[o], ey = S[o + 4] - S[o + 1], ez = S[o + 5] - S[o + 2], ee = ex * ex + ey * ey + ez * ez;
    const t = Math.max(0, Math.min(1, ((p[0] - S[o]) * ex + (p[1] - S[o + 1]) * ey + (p[2] - S[o + 2]) * ez) / (ee || 1)));
    best = Math.min(best, Math.hypot(S[o] + t * ex - p[0], S[o + 1] + t * ey - p[1], S[o + 2] + t * ez - p[2]));
  }
  return best;
}

/** Cut of the linear tetrahedra by the plane x_axis = value: triangles in the other two coordinates (6 numbers each)
 *  and their mean σ_vM/f_y (or −1 before a result). */
export function sectionOf(t10: T10, axis: number, value: number, util: Float64Array | null) {
  const X = t10.X, [pa, qa] = [0, 1, 2].filter((a) => a !== axis), tris: number[] = [], us: number[] = [];
  const E = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
  for (let e = 0; e < t10.ne; e++) {
    const c = [0, 1, 2, 3].map((k) => t10.conn[10 * e + k]), d = c.map((v) => X[3 * v + axis] - value);
    if (Math.min(...d) >= 0 || Math.max(...d) <= 0) continue;
    const pts: number[][] = [];
    for (const [i, j] of E) if ((d[i] < 0) !== (d[j] < 0)) { const f = d[i] / (d[i] - d[j]), a = c[i], b = c[j]; pts.push([X[3 * a + pa] + f * (X[3 * b + pa] - X[3 * a + pa]), X[3 * a + qa] + f * (X[3 * b + qa] - X[3 * a + qa])]); }
    if (pts.length < 3) continue;
    // order around the middle (a quadrilateral when the plane splits the corners two and two)
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    pts.sort((a, b) => Math.atan2(a[1] - my, a[0] - mx) - Math.atan2(b[1] - my, b[0] - mx));
    let u = -1; if (util) { u = 0; for (let k = 0; k < 10; k++) u += util[t10.conn[10 * e + k]] / 10; }
    for (let k = 1; k + 1 < pts.length; k++) { tris.push(pts[0][0], pts[0][1], pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]); us.push(u); }
  }
  return { axis, value, tris: Float32Array.from(tris), util: Float32Array.from(us) };
}

/** The axis along which the part is thinnest (its section shows the profile of a bracket, hook or plate). */
export function thinAxis(t10: T10) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < t10.nv; v++) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], t10.X[3 * v + a]); hi[a] = Math.max(hi[a], t10.X[3 * v + a]); }
  const ext = hi.map((x, a) => x - lo[a]);
  return { axis: ext.indexOf(Math.min(...ext)), mid: lo.map((x, a) => (x + hi[a]) / 2), lo, hi };
}

/** The section of the prepared part through its middle (before a result). */
export function prepSection() {
  if (!cur) return null;
  const { axis, mid } = thinAxis(cur.t10), s = sectionOf(cur.t10, axis, mid[axis], null);
  return { axis, value: mid[axis], tris: toB64(new Uint8Array(s.tris.buffer)), util: toB64(new Uint8Array(s.util.buffer)) };
}

export function* solveTet(job: TetSolveJob): Generator<{ it: number; res: number; stage: 'solve' }, TetResult, unknown> {
  if (!cur) throw new Error('no part');
  const t0 = Date.now(), { t10, tm, local, surfNodes, trusted } = cur, X = t10.X;
  const held = new Uint8Array(t10.nn);
  for (const f of job.fixed) for (let k = 0; k < 6; k++) held[t10.bf[6 * f + k]] = 1;
  let nFixed = 0; for (let v = 0; v < t10.nn; v++) nFixed += held[v];
  if (!nFixed) throw new Error('no supported part');
  // separate pieces of the model: a piece without a support but with a load cannot be solved; a piece with neither is
  // held still (it carries nothing)
  const comp = components(t10), hasHeld = new Set<number>(), hasLoad = new Set<number>();
  for (let v = 0; v < t10.nn; v++) if (held[v]) hasHeld.add(comp[v]);
  for (const g of job.groups) for (const f of g.faces) hasLoad.add(comp[t10.bf[6 * f]]);
  if (job.grav > 0) for (let v = 0; v < t10.nv; v++) hasLoad.add(comp[v]);
  for (const c of hasLoad) if (!hasHeld.has(c)) throw new Error('load not connected');
  for (let v = 0; v < t10.nn; v++) if (!hasHeld.has(comp[v])) held[v] = 1;
  // tractions per face: a force shared by its area's faces in proportion to their areas, or a pressure into each face
  const trac = new Float64Array(3 * t10.nbf), n = [0, 0, 0], fres: V3 = [0, 0, 0];
  for (const g of job.groups) {
    let A = 0; for (const f of g.faces) A += faceArea(X, t10.bf, f);
    for (const f of g.faces) {
      const a = faceArea(X, t10.bf, f, n);
      for (let c = 0; c < 3; c++) { const t = job.load === 'pressure' ? -g.F * n[c] : (g.F * g.dir[c]) / (A || 1); trac[3 * f + c] += t; fres[c] += t * a; }
    }
  }
  const mat = { E: job.E, nu: job.nu }, md = assemble(t10, held, mat), F = loadVector(md, trac);
  let weight = 0;
  if (job.grav > 0) { weight = weightVector(md, job.grav * job.rho * 1e-9 * 9.81, job.gdir, F); for (let c = 0; c < 3; c++) fres[c] += weight * job.gdir[c]; }
  let fn = 0; for (let i = 0; i < F.length; i++) fn += F[i] * F[i];
  if (!(fn > 0)) throw new Error('load not connected');
  const g = solve(md, F);
  let r = g.next();
  while (!r.done) { yield { it: r.value.it, res: r.value.res, stage: 'solve' }; r = g.next(); }
  const { u, it, res } = r.value, { vm } = nodalStress(t10, u, mat);
  // nodes near a support (clamped: the stress there depends on the mesh) are left out of the largest stress
  const dEx = Math.max(1.5 * tm.h, Math.min(2, 0.05 * cur.size)), cell = dEx, hash = new Map<string, number[]>();
  for (let v = 0; v < t10.nn; v++) if (held[v]) { const k = `${Math.floor(X[3 * v] / cell)},${Math.floor(X[3 * v + 1] / cell)},${Math.floor(X[3 * v + 2] / cell)}`; const l = hash.get(k); if (l) l.push(v); else hash.set(k, [v]); }
  const nearHeld = (v: number) => {
    const i = Math.floor(X[3 * v] / cell), j = Math.floor(X[3 * v + 1] / cell), k = Math.floor(X[3 * v + 2] / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (const w of hash.get(`${i + a},${j + b},${k + c}`) ?? []) if (Math.hypot(X[3 * w] - X[3 * v], X[3 * w + 1] - X[3 * v + 1], X[3 * w + 2] - X[3 * v + 2]) < dEx) return true;
    return false;
  };
  let sMax = 0, atV = -1, sAll = 0;
  for (let i = 0; i < surfNodes.length; i++) {
    const v = surfNodes[i]; if (!trusted[i] || held[v]) continue;
    if (vm[v] > sAll) sAll = vm[v];
    if (vm[v] > sMax && !nearHeld(v)) { sMax = vm[v]; atV = v; }
  }
  const at: V3 | null = atV >= 0 ? [X[3 * atV], X[3 * atV + 1], X[3 * atV + 2]] : null;
  const sharp = !!at && segDist(cur.concave, at) < 1.5 * tm.h;
  // results per surface node for the drawing
  const vmS = new Float32Array(surfNodes.length), uS = new Float32Array(3 * surfNodes.length);
  let maxDisp = 0; for (let v = 0; v < t10.nn; v++) maxDisp = Math.max(maxDisp, Math.hypot(u[3 * v], u[3 * v + 1], u[3 * v + 2]));
  surfNodes.forEach((v, i) => { vmS[i] = vm[v]; uS[3 * i] = u[3 * v]; uS[3 * i + 1] = u[3 * v + 1]; uS[3 * i + 2] = u[3 * v + 2]; });
  // share of the volume per band of σ_vM/f_y (mean over each element's nodes)
  const bands = new Array(11).fill(0), util = new Float64Array(t10.nn); let Vt = 0;
  for (let v = 0; v < t10.nn; v++) util[v] = vm[v] / job.fy;
  for (let e = 0; e < t10.ne; e++) {
    const c = t10.conn.subarray(10 * e, 10 * e + 10), Ve = vol6(X, c[0], c[1], c[2], c[3]) / 6;
    let m = 0; for (let k = 0; k < 10; k++) m += util[c[k]] / 10;
    bands[Math.min(10, Math.floor(m * 10))] += Ve; Vt += Ve;
  }
  for (let i = 0; i < 11; i++) bands[i] /= Vt || 1;
  // through the most stressed point, but at least a fifth of the thickness inside (a cut at the surface shows nothing)
  const { axis, mid, lo, hi } = thinAxis(t10), w = 0.2 * (hi[axis] - lo[axis]);
  const sec = sectionOf(t10, axis, at ? Math.min(hi[axis] - w, Math.max(lo[axis] + w, at[axis])) : mid[axis], util);
  void local;
  return {
    vm: toB64(new Uint8Array(vmS.buffer)), u: toB64(new Uint8Array(uS.buffer)), maxDisp, sMax, at, sAll, nearSupport: sAll > 1.15 * sMax, sharp,
    bands, mass: Vt * job.rho * 1e-6, weight, fres, it, res, converged: res < 1e-6, ne: t10.ne, ndof: md.K.n, nFixed, ms: Date.now() - t0,
    section: { axis: sec.axis, value: sec.value, tris: toB64(new Uint8Array(sec.tris.buffer)), util: toB64(new Uint8Array(sec.util.buffer)) },
  };
}

/** Worker glue: a solve runs in 25 ms slices so a newer job or a cancel can get in between. */
export function startTetWorker(post: (m: unknown) => void, listen: (f: (m: { type: string; id: number; job?: TetSolveJob; prep?: TetPrepJob }) => void) => void) {
  let current = -1, last = -1, lastPrep = -1;
  listen((m) => {
    if (m.type === 'cancel') { if (m.id === current) current = -1; return; }
    if (m.type === 'prep') {
      if (!m.prep || m.id === lastPrep) return;
      lastPrep = m.id; current = -1; // a new part stops a running solve
      try { const p = prepTet(m.prep); post({ type: 'prepped', id: m.id, prep: p, section: prepSection() }); } catch (e) { post({ type: 'prepError', id: m.id, message: String((e as Error).message ?? e) }); }
      return;
    }
    if (m.type !== 'solve' || !m.job || m.id === last) return; // a WebView may deliver one message twice
    const id = m.id; current = id; last = id;
    let gen: Generator<{ it: number; res: number; stage: string }, TetResult, unknown>;
    try { gen = solveTet(m.job); } catch (e) { post({ type: 'error', id, message: String((e as Error).message ?? e) }); return; }
    const step = () => {
      if (current !== id) return;
      const t = Date.now();
      try {
        while (Date.now() - t < 25) {
          const r = gen.next();
          if (r.done) { post({ type: 'result', id, result: r.value }); current = -1; return; }
          post({ type: 'progress', id, ...r.value });
        }
      } catch (e) { post({ type: 'error', id, message: String((e as Error).message ?? e) }); current = -1; return; }
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  });
}
