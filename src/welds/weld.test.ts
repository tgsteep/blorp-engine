import { test } from 'node:test';
import assert from 'node:assert/strict';
import { betaLw, STEELS, weld } from './weld.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const S235 = STEELS[0], S355 = STEELS[2];

test('design shear strength of a fillet weld f_vw,d = f_u/(√3·β_w·γ_M2): S235 → 207.8 MPa, S355 → 251.5 MPa (EN 1993-1-8 §4.5.3.3, tabulated values)', () => {
  near(360 / (Math.sqrt(3) * 0.8 * 1.25), 207.8, 0.05);
  // longitudinal welds at exactly that capacity are fully used
  const A = 2 * 5 * 100;
  near(weld({ kind: 'longitudinal', F: A * 207.85, l: 100, a: 5, t: 10, e: 0, steel: S235 }).use, 1, 0.001);
  near(490 / (Math.sqrt(3) * S355.bw * 1.25), 251.5, 0.1);
});

test('directional method: transverse fillet welds carry √(3/2) = 1.22 × the load of longitudinal ones (σ⊥ = τ⊥ = F/(√2·A))', () => {
  const lo = weld({ kind: 'longitudinal', F: 100000, l: 100, a: 5, t: 10, e: 0, steel: S235 });
  const tr = weld({ kind: 'transverse', F: 100000, l: 100, a: 5, t: 10, e: 0, steel: S235 });
  near(lo.use / tr.use, Math.sqrt(1.5), 1e-9);
  near(tr.sp, 100000 / (Math.SQRT2 * 1000), 1e-9);
  near(tr.sigEq, 2 * tr.sp, 1e-9);
});

test('long lap joints: β_Lw = 1.2 − 0.2·l/(150a) ≤ 1 (EN 1993-1-8 §4.11): l = 1500, a = 5 → 0.8; short joints 1', () => {
  near(betaLw(1500, 5), 0.8, 1e-12);
  assert.equal(betaLw(500, 5), 1);
});

test('bracket: τ∥ = F/(2al), σ_w = F·e/(2al²/6), σ⊥ = τ⊥ = σ_w/√2; throat needed scales with the utilisation', () => {
  const r = weld({ kind: 'bracket', F: 20000, l: 200, a: 4, t: 10, e: 150, steel: S235 });
  near(r.tl, 20000 / 1600, 1e-9);
  near(r.sigW, (20000 * 150) / ((2 * 4 * 200 * 200) / 6), 1e-9);
  near(r.sp, r.sigW / Math.SQRT2, 1e-9);
  const again = weld({ kind: 'bracket', F: 20000, l: 200, a: r.aReq, t: 10, e: 150, steel: S235 });
  near(again.use, 1, 1e-9);
});

test('full-penetration butt weld is checked as the plate: σ = F/(t·l) ≤ f_y', () => {
  const r = weld({ kind: 'butt', F: 235 * 10 * 100, l: 100, a: 0, t: 10, e: 0, steel: S235 });
  near(r.use, 1, 1e-12);
});
