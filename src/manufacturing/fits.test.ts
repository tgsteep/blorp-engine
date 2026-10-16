import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactPressure, fit, FIT_MATERIALS, holeDeviations, it, lameProfile, pressFit, shaftDeviations } from './fits.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const lim = (x: { es?: number; ei?: number; ES?: number; EI?: number }) => ('ES' in x ? [x.ES, x.EI] : [x.es, x.ei]);
const steel = FIT_MATERIALS.find((m) => m.id === 'steel')!;

test('VALIDATION (ISO 286-1 Table 1): standard tolerances IT6, IT7, IT8, IT11 at 25, 50, 100, 200 mm', () => {
  assert.deepEqual([6, 7, 8, 11].map((g) => it(g, 25)), [13, 21, 33, 130]);
  assert.deepEqual([6, 7, 8, 11].map((g) => it(g, 50)), [16, 25, 39, 160]);
  assert.deepEqual([6, 7, 8, 11].map((g) => it(g, 100)), [22, 35, 54, 220]);
  assert.deepEqual([6, 7, 8, 11].map((g) => it(g, 200)), [29, 46, 72, 290]);
  assert.equal(it(7, 3), 10, '3 mm belongs to the step 0–3'); assert.equal(it(7, 3.01), 12);
});

test('VALIDATION (ISO 286-2 tables): shaft limits 25 g6, k6, p6, s6; 40 f7; 18 js6; 200 u6', () => {
  assert.deepEqual(lim(shaftDeviations('g', 6, 25)), [-7, -20]);
  assert.deepEqual(lim(shaftDeviations('k', 6, 25)), [15, 2]);
  assert.deepEqual(lim(shaftDeviations('p', 6, 25)), [35, 22]);
  assert.deepEqual(lim(shaftDeviations('s', 6, 25)), [48, 35]);
  assert.deepEqual(lim(shaftDeviations('f', 7, 40)), [-25, -50]);
  assert.deepEqual(lim(shaftDeviations('js', 6, 18)), [5.5, -5.5]);
  assert.deepEqual(lim(shaftDeviations('u', 6, 200)), [265, 236]);
  assert.deepEqual(lim(shaftDeviations('h', 6, 100)), [0, -22]);
  assert.deepEqual(lim(shaftDeviations('k', 9, 25)), [52, 0], 'k above IT7: ei = 0');
});

test('VALIDATION (ISO 286-2 tables): hole limits 25 H7, P7; 10 K7; 60 M7; 100 F8; 50 N7; 30 S7; 25 JS7', () => {
  assert.deepEqual(lim(holeDeviations('H', 7, 25)), [21, 0]);
  assert.deepEqual(lim(holeDeviations('P', 7, 25)), [-14, -35]);
  assert.deepEqual(lim(holeDeviations('K', 7, 10)), [5, -10]);
  assert.deepEqual(lim(holeDeviations('M', 7, 60)), [0, -30]);
  assert.deepEqual(lim(holeDeviations('F', 8, 100)), [90, 36]);
  assert.deepEqual(lim(holeDeviations('N', 7, 50)), [-8, -33]);
  assert.deepEqual(lim(holeDeviations('S', 7, 30)), [-27, -48]);
  assert.deepEqual(lim(holeDeviations('JS', 7, 25)), [10, -10], 'IT7 = 21 is odd: ±10');
  assert.deepEqual(lim(holeDeviations('K', 7, 2)), [0, -10], 'up to 3 mm: no Δ');
});

test('fit classes: 25 H7/g6 clearance 7…41 µm, H7/k6 transition, H7/p6 interference 1…35 µm', () => {
  const g = fit(25, { letter: 'H', grade: 7 }, { letter: 'g', grade: 6 });
  assert.equal(g.kind, 'clearance'); assert.equal(g.Cmin, 7); assert.equal(g.Cmax, 41);
  assert.equal(fit(25, { letter: 'H', grade: 7 }, { letter: 'k', grade: 6 }).kind, 'transition');
  const p = fit(25, { letter: 'H', grade: 7 }, { letter: 'p', grade: 6 });
  assert.equal(p.kind, 'interference'); assert.equal(p.Imin, 1); assert.equal(p.Imax, 35);
  // shaft basis: same clearance as hole basis for the "equivalent" fit G7/h6
  const s = fit(25, { letter: 'G', grade: 7 }, { letter: 'h', grade: 6 });
  assert.equal(s.Cmin, 7); assert.equal(s.Cmax, 7 + 21 + 13);
});

test('press fit, hand calculation: steel hub D 100 on solid steel shaft d 50, δ = 30 µm → p = 47.25 MPa', () => {
  const geo = { d: 50, D: 100, di: 0, hub: steel, shaft: steel };
  near(contactPressure(geo, 30), (210000 * 0.03 * (100 ** 2 - 50 ** 2)) / (2 * 50 * 100 ** 2), 1e-9, 'same-material closed form');
  near(contactPressure(geo, 30), 47.25, 1e-9);
  const r = pressFit({ ...geo, L: 40, mu: 0.1, RzHub: 0, RzShaft: 0, T: 500, Imax: 30, Imin: 30 });
  near(r.Tcap, (0.1 * 47.25 * Math.PI * 50 * 40 * 25) / 1000, 1e-9); // 742.2 N·m
  near(r.Fpress, 0.1 * 47.25 * Math.PI * 50 * 40, 1e-9);
  near(r.sHubT, 47.25 * (1 + 0.25) / (1 - 0.25), 1e-9); // 78.75 MPa
  assert.ok(r.checks.every((c) => c.ok));
});

test('press fit: smoothing removes interference; a hollow shaft carries more stress', () => {
  const geo = { d: 50, D: 100, L: 40, hub: steel, shaft: steel, mu: 0.1, T: 0 };
  const r = pressFit({ ...geo, di: 0, RzHub: 6.3, RzShaft: 4, Imax: 35, Imin: 1 });
  near(r.G, 0.8 * 10.3, 1e-12); near(r.dMin, 1 - 8.24, 1e-12);
  assert.equal(r.pMin, 0, 'no pressure when nothing is left');
  const hollow = pressFit({ ...geo, di: 30, RzHub: 0, RzShaft: 0, Imax: 35, Imin: 35 });
  assert.ok(hollow.pMax < contactPressure({ ...geo, di: 0 }, 35), 'a hollow shaft is softer');
  assert.ok(hollow.sShaft > hollow.pMax);
});

test('Lamé profile: σ_r = −p at the joint on both sides, 0 at the hub outside; hub hoop stress at the bore as in pressFit', () => {
  const pr = lameProfile(50, 100, 0, 47.25);
  const joint = pr.filter((x) => Math.abs(x.r - 25) < 1e-9);
  joint.forEach((x) => near(x.sr, -47.25, 1e-9));
  near(pr[pr.length - 1].sr, 0, 1e-9);
  near(joint.find((x) => x.part === 'hub')!.st, 78.75, 1e-9);
  const hollow = lameProfile(50, 100, 30, 40);
  near(hollow[0].sr, 0, 1e-9, 'free shaft bore');
});
