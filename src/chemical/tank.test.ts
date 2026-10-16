import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atLevel, drainTime, headDepth, segArea, tank, tankProfile } from './tank.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const IN = 0.0254, GAL = 3.785411784e-3;

test('VALIDATION (Crookston & Crookston, Chemical Engineering, Sept. 2011): ASME F&D tanks, 100 in Ø, 120 in overall', () => {
  // head length: α₂ D = 16.934 in
  near(headDepth('asme', 50 * IN) / IN, 16.934, 0.001, 'head depth');
  const pf = tankProfile({ head: 'asme', D: 100 * IN, H: 120 * IN });
  // vertical T-1000: 12 in → 187.99 gal, 40 in → 1135 gal, full 3629.8 gal; regions V1 + V2 = 350.7 gal per head
  near(atLevel(pf, 'vertical', 12 * IN).V / GAL, 187.99, 0.2, 'vertical 12 in');
  near(atLevel(pf, 'vertical', 40 * IN).V / GAL, 1135, 1, 'vertical 40 in');
  near(atLevel(pf, 'vertical', 120 * IN).V / GAL, 3629.8, 1, 'full');
  near(tank({ orient: 'vertical', head: 'asme', D: 100 * IN, H: 120 * IN, h: 1, rho: 1180, dOut: 0.05 }).head / GAL, 350.7, 0.2, 'one head');
  // horizontal T-1001: 40 in → 1338 gal, 50 in → 1814.89 gal (cylinder 1464.25 + heads 350.65)
  near(atLevel(pf, 'horizontal', 40 * IN).V / GAL, 1338, 1, 'horizontal 40 in');
  near(atLevel(pf, 'horizontal', 50 * IN).V / GAL, 1814.89, 0.2, 'horizontal 50 in');
  // mass at 40 in, SG 1.18: 13 160 lb
  near(atLevel(pf, 'horizontal', 40 * IN).V * 1180 / 0.45359237, 13160, 15, 'mass');
});

test('closed forms: sphere, ellipsoidal and torispherical heads, cylinder, segment', () => {
  const R = 1.3, sph = tankProfile({ head: 'hemi', D: 2 * R, H: 2 * R });
  for (const h of [0.2, 1, 1.9, 2.6]) {
    const exact = (Math.PI * h * h * (3 * R - h)) / 3;
    near(atLevel(sph, 'horizontal', h).V, exact, exact * 1e-4, `sphere horizontal ${h}`);
    near(atLevel(sph, 'vertical', h).V, exact, exact * 1e-4, `sphere vertical ${h}`);
    near(atLevel(sph, 'vertical', h).Aw, 2 * Math.PI * R * h, 1e-3, 'sphere zone area 2πRh');
  }
  // two 2:1 ellipsoidal heads = an ellipsoid with semi-axis R/2: V(h) = ½ π h²(3R − h)/3 for a horizontal tank
  const el = tankProfile({ head: 'ellip', D: 2, H: 1 });
  for (const h of [0.5, 1, 1.5]) near(atLevel(el, 'horizontal', h).V, (0.5 * Math.PI * h * h * (3 - h)) / 3, 1e-4, `ellipsoid ${h}`);
  // head volumes per D³: 2:1 ellipsoidal π/24, Klöpper ≈ 0.0990, ASME F&D ≈ 0.0809
  for (const [hd, v, tol] of [['ellip', Math.PI / 24, 1e-5], ['klopper', 0.099, 0.0005], ['asme', 0.0809, 0.0003]] as const)
    near(atLevel(tankProfile({ head: hd, D: 1, H: 0 }), 'vertical', 2).V / 2, v, tol, `${hd} head volume`);
  // flat-ended horizontal cylinder: L × segment area; vertical: π R² h
  const cyl = tankProfile({ head: 'flat', D: 2, H: 5 });
  near(atLevel(cyl, 'horizontal', 0.6).V, 5 * segArea(1, -0.4), 1e-9, 'horizontal cylinder');
  near(segArea(1, -0.4), Math.acos(0.4) - 0.4 * Math.sqrt(1 - 0.16), 1e-12, 'segment R² acos((R − h)/R) − (R − h)√(2Rh − h²)');
  near(atLevel(cyl, 'vertical', 3).V, Math.PI * 3, 1e-9, 'vertical cylinder');
  near(atLevel(cyl, 'vertical', 3).Aw, Math.PI + 2 * Math.PI * 3, 1e-9, 'wetted: bottom + wall');
});

test('draining (Torricelli) and the tool result', () => {
  // flat-bottomed vertical cylinder: t = (A/(C_d a)) √(2h/g)
  const cyl = tankProfile({ head: 'flat', D: 2, H: 5 }), a = (Math.PI * 0.05 ** 2) / 4;
  near(drainTime(cyl, 'vertical', 4, 0.05).t, (Math.PI / (0.61 * a)) * Math.sqrt((2 * 4) / 9.81), 0.5, 'drain time');
  const r = tank({ orient: 'horizontal', head: 'klopper', D: 2.4, H: 9, h: 1.6, rho: 840, dOut: 0.08 });
  near(r.m, 840 * r.at.V, 1e-9); near(r.pBot, 840 * 9.81 * 1.6, 1e-9);
  near(r.table[10].V, r.full.V, 1e-9); assert.ok(r.table.every((x, i) => i === 0 || x.V > r.table[i - 1].V), 'volume rises with the level');
  assert.ok(r.checks.every((c) => c.ok), r.checks.filter((c) => !c.ok).map((c) => c.label).join('; '));
  assert.ok(!tank({ orient: 'horizontal', head: 'klopper', D: 2.4, H: 9, h: 2.35, rho: 840, dOut: 0.08 }).checks[1].ok, 'overfilled');
});
