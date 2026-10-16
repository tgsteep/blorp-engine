/**
 * The whole tetrahedral static analysis as one generator: stuffed mesh → T10 → held faces and loaded faces → stiffness
 * → AMG-preconditioned CG → nodal stresses. Faces are chosen by a callback on their corners and outward normal, so the
 * app (painted areas) and the tests (geometric rules) share the same path.
 */
import type { Mesh } from '../../manufacturing/stl.ts';
import { closestPoint } from './geom.ts';
import { spacingFor, stuff, type TetMesh } from './stuff.ts';
import { assemble, faceArea, loadVector, nodalStress, solve, toT10, type Iso, type T10 } from './fe.ts';

export type FaceRole = 'held' | 'load' | null;
export type TetLoad = { kind: 'force'; F: number; dir: [number, number, number] } | { kind: 'pressure'; p: number };

export type TetResult = {
  tm: TetMesh; t10: T10; u: Float64Array; vm: Float64Array; held: Uint8Array;
  /** Surface nodes that lie on the true surface (not on a bevel the mesher could not remove). */
  trusted: Uint8Array;
  it: number; res: number; dof: number; ms: number;
};

export function* runTet(m: Mesh, cells: number, role: (corners: number[][], n: number[]) => FaceRole, load: TetLoad, mat: Iso):
  Generator<{ stage: 'mesh' | 'solve'; it: number; res: number }, TetResult, unknown> {
  const t0 = Date.now();
  yield { stage: 'mesh', it: 0, res: 1 };
  const tm = stuff(m, spacingFor(m, cells)), t10 = toT10(tm), X = t10.X;
  const held = new Uint8Array(t10.nn), loaded: number[] = [], n = [0, 0, 0];
  let area = 0;
  for (let f = 0; f < t10.nbf; f++) {
    const cs = [0, 1, 2].map((k) => { const v = t10.bf[6 * f + k]; return [X[3 * v], X[3 * v + 1], X[3 * v + 2]]; });
    const a = faceArea(X, t10.bf, f, n), r = role(cs, n.slice());
    if (r === 'held') for (let k = 0; k < 6; k++) held[t10.bf[6 * f + k]] = 1;
    else if (r === 'load') { loaded.push(f); area += a; }
  }
  const trac = new Float64Array(3 * t10.nbf);
  for (const f of loaded) {
    faceArea(X, t10.bf, f, n);
    for (let c = 0; c < 3; c++) trac[3 * f + c] = load.kind === 'pressure' ? -load.p * n[c] : (load.F * load.dir[c]) / (area || 1);
  }
  const md = assemble(t10, held, mat), F = loadVector(md, trac);
  const g = solve(md, F);
  let r = g.next();
  while (!r.done) { yield { stage: 'solve', it: r.value.it, res: r.value.res }; r = g.next(); }
  const { u, it, res } = r.value, { vm } = nodalStress(t10, u, mat);
  const trusted = new Uint8Array(t10.nn), q = [0, 0, 0];
  for (let v = 0; v < t10.nn; v++) if (t10.onSurf[v] && closestPoint(tm.bvh, [X[3 * v], X[3 * v + 1], X[3 * v + 2]], q, tm.h).d <= 0.05 * tm.h) trusted[v] = 1;
  return { tm, t10, u, vm, held, trusted, it, res, dof: md.K.n, ms: Date.now() - t0 };
}

/** Runs the generator to the end. */
export function runTetSync(...a: Parameters<typeof runTet>): TetResult { const g = runTet(...a); let r = g.next(); while (!r.done) r = g.next(); return r.value; }

/** Largest von Mises stress on trusted surface nodes that satisfy `where` (node position). */
export function maxStress(r: TetResult, where: (p: number[]) => boolean = () => true) {
  let best = 0, at = -1;
  const X = r.t10.X;
  for (let v = 0; v < r.t10.nn; v++) {
    if (!r.trusted[v] || r.held[v]) continue;
    const p = [X[3 * v], X[3 * v + 1], X[3 * v + 2]];
    if (where(p) && r.vm[v] > best) { best = r.vm[v]; at = v; }
  }
  return { s: best, at: at < 0 ? null : [X[3 * at], X[3 * at + 1], X[3 * at + 2]] };
}
