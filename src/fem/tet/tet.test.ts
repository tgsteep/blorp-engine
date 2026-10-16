import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extrude, sample, volume, type Mesh } from '../../manufacturing/stl.ts';
import { dihedrals, spacingFor, stuff, tetVolume } from './stuff.ts';
import { maxStress, runTetSync } from './run.ts';

type P2 = [number, number];
const STEEL = { E: 210000, nu: 0.3 };
const near = (a: number, b: number, rel: number, what: string) => assert.ok(Math.abs(a / b - 1) <= rel, `${what}: ${a.toFixed(3)} vs ${b.toFixed(3)} (${(100 * (a / b - 1)).toFixed(1)} %)`);

/** Closed prism (along y, width w) between an outer loop and an inner circle sampled at the same N angles around (cx, cz). */
function holed(outer: (a: number) => P2, cx: number, cz: number, R: number, w: number, N: number): Mesh {
  const v: number[] = [], y0 = -w / 2, y1 = w / 2, V = (p: P2, y: number) => [p[0], y, p[1]];
  const o = Array.from({ length: N }, (_, k) => outer((2 * Math.PI * k) / N)), c = Array.from({ length: N }, (_, k) => [cx + R * Math.cos((2 * Math.PI * k) / N), cz + R * Math.sin((2 * Math.PI * k) / N)] as P2);
  const tri = (a: number[], b: number[], d: number[]) => v.push(...a, ...b, ...d);
  for (let k = 0; k < N; k++) {
    const j = (k + 1) % N;
    tri(V(o[k], y0), V(o[j], y0), V(c[j], y0)); tri(V(o[k], y0), V(c[j], y0), V(c[k], y0));
    tri(V(o[k], y1), V(c[j], y1), V(o[j], y1)); tri(V(o[k], y1), V(c[k], y1), V(c[j], y1));
    tri(V(o[k], y0), V(o[k], y1), V(o[j], y1)); tri(V(o[k], y0), V(o[j], y1), V(o[j], y0));
    tri(V(c[k], y0), V(c[j], y1), V(c[k], y1)); tri(V(c[k], y0), V(c[j], y0), V(c[j], y1));
  }
  return { pos: Float32Array.from(v) };
}
const rectAt = (W: number, H: number, cx: number, cz: number) => (a: number): P2 => {
  const dx = Math.cos(a), dz = Math.sin(a); let t = Infinity;
  if (dx > 1e-12) t = Math.min(t, (W - cx) / dx); if (dx < -1e-12) t = Math.min(t, -cx / dx);
  if (dz > 1e-12) t = Math.min(t, (H - cz) / dz); if (dz < -1e-12) t = Math.min(t, -cz / dz);
  return [cx + t * dx, cz + t * dz];
};
const arc = (R: number, a0: number, a1: number, n: number): P2[] => Array.from({ length: n + 1 }, (_, k) => { const a = a0 + ((a1 - a0) * k) / n; return [R * Math.cos(a), R * Math.sin(a)]; });
const all = (cs: number[][], f: (c: number[]) => boolean) => cs.every(f);

test('mesher: closed, conforming, full volume, sharp edges kept', () => {
  for (const m of [extrude([[0, 0], [60, 0], [60, 6], [0, 6]], 6), sample('bracket'), sample('hook')]) {
    const tm = stuff(m, spacingFor(m, 600));
    const faces = new Map<string, number>();
    for (let e = 0; e < tm.tet.length; e += 4) for (const f of [[1, 2, 3], [0, 2, 3], [0, 1, 3], [0, 1, 2]]) { const k = f.map((i) => tm.tet[e + i]).sort((a, b) => a - b).join(','); faces.set(k, (faces.get(k) ?? 0) + 1); }
    for (const n of faces.values()) assert.ok(n <= 2, 'a face shared by more than two tetrahedra');
    near(tetVolume(tm), volume(m), 0.01, 'volume');
    assert.ok(dihedrals(tm).min > 1, 'no flat tetrahedra');
  }
});

test('uniform tension bar: every surface node σ = F/A (sharp edges do not disturb it)', () => {
  const m = extrude([[0, 0], [60, 0], [60, 6], [0, 6]], 6);
  for (const cells of [300, 1000]) {
    const r = runTetSync(m, cells, (cs) => (all(cs, (c) => c[0] < 1e-3) ? 'held' : all(cs, (c) => c[0] > 60 - 1e-3) ? 'load' : null), { kind: 'force', F: 1000, dir: [1, 0, 0] }, STEEL);
    const X = r.t10.X;
    for (let v = 0; v < r.t10.nn; v++) if (r.trusted[v] && X[3 * v] > 20 && X[3 * v] < 40) near(r.vm[v], 1000 / 36, 0.01, `σ at node ${v}`);
  }
});

test('VALIDATION (beam theory) cantilever: bending stress at x = 20 within 3 %', () => {
  const m = extrude([[0, 0], [60, 0], [60, 6], [0, 6]], 6);
  const r = runTetSync(m, 300, (cs) => (all(cs, (c) => c[0] < 1e-3) ? 'held' : all(cs, (c) => c[0] > 60 - 1e-3) ? 'load' : null), { kind: 'force', F: 100, dir: [0, 0, -1] }, STEEL);
  near(maxStress(r, (p) => Math.abs(p[0] - 20) < 0.6 && p[2] > 6 - 1e-3).s, (100 * 40 * 3) / ((6 * 216) / 12), 0.03, 'σ top fibre');
});

test('VALIDATION (Heywood, Peterson’s Stress Concentration Factors) plate with a hole d/W = 0.25: K_t within 5 %', () => {
  const m = holed(rectAt(80, 40, 40, 20), 40, 20, 5, 4, 192);
  const r = runTetSync(m, 300, (cs) => (all(cs, (c) => c[0] < 1e-3) ? 'held' : all(cs, (c) => c[0] > 80 - 1e-3) ? 'load' : null), { kind: 'force', F: 1600, dir: [1, 0, 0] }, STEEL);
  const ref = ((2 + 0.75 ** 3) * 1600) / (30 * 4);
  near(maxStress(r, (p) => Math.abs(p[0] - 40) < 3 && Math.hypot(p[0] - 40, p[2] - 20) < 6).s, ref, 0.05, 'σ at the hole');
  near(maxStress(r).s, ref, 0.05, 'largest σ anywhere');
});

test('VALIDATION (Lamé) thick ring under internal pressure: σ_vM at the bore within 3 %', () => {
  const m = holed((a) => [20 * Math.cos(a), 20 * Math.sin(a)], 0, 0, 10, 6, 192);
  const r = runTetSync(m, 1000, (cs) => (all(cs, (c) => Math.hypot(c[0], c[2]) > 19.9 && c[0] > 0 && Math.abs(c[2]) < 2) ? 'held' : all(cs, (c) => Math.hypot(c[0], c[2]) < 10.1) ? 'load' : null), { kind: 'pressure', p: 10 }, STEEL);
  const st = (10 * 500) / 300, ref = Math.sqrt(st * st + 100 + 10 * st);
  near(maxStress(r, (p) => p[0] < -2 && Math.hypot(p[0], p[2]) < 10.3).s, ref, 0.03, 'σ_vM at the bore');
});

test('VALIDATION (Winkler curved beam, Shigley ch. 3) C-ring pulled apart: inner fibre stress within 3 %', () => {
  const g = (15 * Math.PI) / 180, ri = 20, ro = 30;
  const m = extrude([...arc(ro, g, 2 * Math.PI - g, 120), ...arc(ri, 2 * Math.PI - g, g, 120)], 6);
  const r = runTetSync(m, 300, (cs) => (all(cs, (c) => c[2] > 0 && Math.abs(Math.atan2(c[2], c[0]) - g) < 1e-3) ? 'held' : all(cs, (c) => c[2] < 0 && Math.abs(Math.atan2(c[2], c[0]) + g) < 1e-3) ? 'load' : null), { kind: 'force', F: 200, dir: [0, 0, -1] }, STEEL);
  const A = 60, Rc = 25, rn = (ro - ri) / Math.log(ro / ri), e = Rc - rn, M = 200 * (Rc * Math.cos(g) + Rc), ref = 200 / A + (M * (rn - ri)) / (A * e * ri);
  near(maxStress(r, (p) => p[0] < -15 && Math.abs(p[2]) < 5 && Math.hypot(p[0], p[2]) < ri + 0.3).s, ref, 0.03, 'σ inner fibre');
  near(maxStress(r).s, ref, 0.05, 'largest σ anywhere');
});

test('App path: worker prepares a sample, painted sample marks become faces, solve gives a sensible result', async () => {
  const { prepTet, solveTet } = await import('./worker.ts');
  const { applyFaceStrokes, faceFrames, faceGroups } = await import('./marks.ts');
  const { toB64, fromB64 } = await import('../../manufacturing/b64.ts');
  const { SAMPLE_SETUP } = await import('../../manufacturing/printLab.ts');
  const { STATIC_F } = await import('../static.ts');
  const m = sample('bar');
  const P = prepTet({ mesh: toB64(new Uint8Array(m.pos.buffer, m.pos.byteOffset, m.pos.byteLength)), scale: 1, cells: 400, check: false });
  near(P.volRatio, 1, 0.02, 'meshed volume');
  const f32 = (s: string) => { const b = fromB64(s); return new Float32Array(b.buffer, 0, b.length >> 2); };
  const i32 = (s: string) => { const b = fromB64(s); return new Int32Array(b.buffer, 0, b.length >> 2); };
  const surf = { pos: f32(P.pos), faces: i32(P.faces), nf: P.nf }, fr = faceFrames(surf);
  const mk = applyFaceStrokes(surf, fr, SAMPLE_SETUP.bar.strokes), groups = faceGroups(surf, fr, mk.mark, mk.loadBy);
  assert.ok(mk.nFix > 0 && groups.length === 1, `${mk.nFix} held faces, ${groups.length} load areas`);
  const fixed: number[] = []; mk.mark.forEach((x, i) => { if (x === 1) fixed.push(i); });
  const dir = { '-Z': [0, 0, -1], '+Z': [0, 0, 1], '-X': [-1, 0, 0], '+X': [1, 0, 0], '-Y': [0, -1, 0], '+Y': [0, 1, 0] }[SAMPLE_SETUP.bar.dir] as [number, number, number];
  const gen = solveTet({ fixed, groups: [{ faces: groups[0].faces, F: STATIC_F.bar, dir }], load: 'force', E: 210000, nu: 0.3, rho: 7850, fy: 235, grav: 0, gdir: [0, 0, -1] });
  let s = gen.next(); while (!s.done) s = gen.next();
  const r = s.value;
  assert.ok(r.converged, 'converged');
  near(Math.hypot(...r.fres), STATIC_F.bar, 0.01, 'resultant = applied force');
  assert.ok(235 / r.sMax > 1.8 && 235 / r.sMax < 2.8, `SF ${(235 / r.sMax).toFixed(2)}`);
});

