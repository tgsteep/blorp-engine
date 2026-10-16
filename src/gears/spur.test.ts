import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSpur, inv, invInverse } from './spur.ts';

const near = (a: number, b: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

const base = { m: 3, z1: 18, z2: 45, alphaDeg: 20, x1: 0, x2: 0, n1: 1450, T1: 50 };

test('involute function: inv 20° = 0.014904', () => {
  near(inv((20 * Math.PI) / 180), 0.014904, 1e-6);
  near((invInverse(0.014904) * 180) / Math.PI, 20, 1e-3);
});

test('standard pair: a = m(z1+z2)/2, αw = α', () => {
  const r = computeSpur(base);
  near(r.a, 94.5, 1e-9);
  near(r.aw, 94.5, 1e-9);
  near((r.alphaW * 180) / Math.PI, 20, 1e-9);
  near(r.u, 2.5, 1e-12);
});

test('contact ratio z 18/45, m 3, α 20° ≈ 1.633 (hand calculation)', () => {
  near(computeSpur(base).epsAlpha, 1.633, 0.002);
});

test('profile-shifted pair: KHK example m3, z 12/24, x 0.6/0.36 → αw 26.0886°, a 56.4999 mm (y = 0.8333)', () => {
  const r = computeSpur({ ...base, z1: 12, z2: 24, x1: 0.6, x2: 0.36 });
  near((r.alphaW * 180) / Math.PI, 26.0886, 1e-3);
  near(r.aw, 56.4999, 2e-3);
});

test('undercut limit: z = 17 undercuts at x = 0, z = 18 does not (α = 20°)', () => {
  assert.equal(computeSpur({ ...base, z1: 17 }).checks[1].ok, false);
  assert.equal(computeSpur({ ...base, z1: 18 }).checks[1].ok, true);
});

test('forces: Ft = 2T/d, Fr = Ft tan αw', () => {
  const r = computeSpur(base);
  near(r.Ft, (2000 * 50) / 54, 1e-9);
  near(r.Fr, r.Ft * Math.tan((20 * Math.PI) / 180), 1e-9);
});

test('outline: every tooth tip at r_a, every root at r_f', async () => {
  const { gearOutline } = await import('./spur.ts');
  const o = gearOutline(20, 2, 20, 0);
  let rmax = 0, rmin = Infinity;
  for (let i = 0; i < o.length; i += 2) { rmax = Math.max(rmax, o[i]); rmin = Math.min(rmin, o[i]); }
  near(rmax, 22, 1e-9); // r + m
  near(rmin, 17.5, 1e-9); // r − 1.25 m
});

/* ---- Validation: KHK Gear Technical Reference, worked examples for spur gears (same formulas as ISO 21771) ---- */

test('VALIDATION (KHK, standard spur pair m 3, α 20°, z 12/24): d 36/72, d_b 33.829/67.658, d_a 42/78, d_f 28.5/64.5, h 6.75, a 54', () => {
  const r = computeSpur({ m: 3, z1: 12, z2: 24, alphaDeg: 20, x1: 0, x2: 0, n1: 1000, T1: 10 });
  near(r.d1, 36, 1e-9); near(r.d2, 72, 1e-9);
  near(r.db1, 33.829, 5e-4); near(r.db2, 67.658, 5e-4);
  near(r.da1, 42, 1e-9); near(r.da2, 78, 1e-9);
  near(r.df1, 28.5, 1e-9); near(r.df2, 64.5, 1e-9);
  near(r.h, 6.75, 1e-9); near(r.aw, 54, 1e-9);
});

test('VALIDATION (KHK, profile-shifted spur pair m 3, α 20°, z 12/24, x 0.6/0.36): inv α_w 0.034316, α_w 26.0886°, y 0.83329, a_w 56.4999, d_w 37.667/75.333, d_a 44.840/79.400, d_f 32.100/66.660, h 6.370', () => {
  const r = computeSpur({ m: 3, z1: 12, z2: 24, alphaDeg: 20, x1: 0.6, x2: 0.36, n1: 1000, T1: 10 });
  near(inv(r.alphaW), 0.034316, 1e-6);
  near((r.alphaW * 180) / Math.PI, 26.0886, 1e-4);
  near(r.y, 0.83329, 1e-5);
  near(r.aw, 56.4999, 1e-3);
  near(r.dw1, 37.667, 1e-3); near(r.dw2, 75.333, 1e-3);
  near(r.da1, 44.840, 1e-3); near(r.da2, 79.400, 1e-3);
  near(r.df1, 32.1, 1e-9); near(r.df2, 66.66, 1e-9);
  near(r.h, 6.370, 1e-3);
  // tip shortening keeps the standard clearance 0.25 m on both sides
  near(r.c1, 0.75, 1e-9); near(r.c2, 0.75, 1e-9);
});
