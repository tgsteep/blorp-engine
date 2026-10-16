import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IPE, MATERIALS } from './beam.ts';
import {
  END_K, IPE_IZ, analyseColumn, analyseEccentric, criticalStress, eulerLoad, lambdaC, minorSection, modeShape, secant, secantYieldLoad,
} from './column.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const rel = (a: number, b: number, tol: number, msg = '') => near(a / b, 1, tol, msg);

test('VALIDATION (Hibbeler, Mechanics of Materials, example 13.1): W8×40, A-36 steel, 20 ft pin-ended, I_y = 49.1 in⁴ → P_cr = 244 kip, below yield (20.9 ksi < 36 ksi)', () => {
  const E = 29000, I = 49.1, A = 11.7, L = 20 * 12; // ksi, in⁴, in², in
  const Pcr = eulerLoad(E, I, 1 * L);
  near(Pcr, 244, 0.5);
  near(Pcr / A, 20.9, 0.1);
  assert.ok(Pcr / A < 36);
});

test('effective length factors and the buckling load ratios: fixed–fixed 4×, fixed–pinned ≈ 2.04×, fixed–free ¼ of pinned–pinned', () => {
  const E = 210e9, I = 1e-6, L = 3;
  const P = (k: number) => eulerLoad(E, I, k * L);
  rel(P(END_K.fixedFixed) / P(END_K.pinned), 4, 1e-12);
  rel(P(END_K.fixedPinned) / P(END_K.pinned), 1 / 0.49, 1e-12); // 2.04
  rel(P(END_K.fixedFree) / P(END_K.pinned), 0.25, 1e-12);
});

test('Johnson parabola meets the Euler hyperbola at λ_c with σ_cr = σ_y/2, and both have the same slope there', () => {
  const E = 200e9, sy = 250e6, lc = lambdaC(E, sy);
  near(lc, 125.7, 0.1); // √(2π²·200e9/250e6)
  rel(criticalStress(E, sy, lc - 1e-9), sy / 2, 1e-9);
  rel(criticalStress(E, sy, lc + 1e-9), sy / 2, 1e-9);
  const d = 1e-4, s1 = (criticalStress(E, sy, lc - d) - criticalStress(E, sy, lc - 2 * d)) / d, s2 = (criticalStress(E, sy, lc + 2 * d) - criticalStress(E, sy, lc + d)) / d;
  rel(s1, s2, 1e-3);
  near(criticalStress(E, sy, 0), sy, 1e-6); // a stocky column crushes at σ_y
});

test('minor section: rectangle buckles about the smaller dimension; IPE minor-axis table I_z matches the plain I-shape within fillets', () => {
  const r = minorSection({ kind: 'rect', b: 100, h: 40 });
  rel(r.I, (0.1 * 0.04 ** 3) / 12, 1e-12); rel(r.c, 0.02, 1e-12); assert.equal(r.bowZ, false);
  assert.equal(minorSection({ kind: 'rect', b: 40, h: 100 }).bowZ, true);
  for (const e of IPE) {
    const plain = (2 * e.tf * e.b ** 3 + (e.h - 2 * e.tf) * e.tw ** 3) / 12;
    const table = IPE_IZ[e.name] * 1e4;
    assert.ok(table > plain * 0.99 && table < plain * 1.1, `${e.name} ${table} vs ${plain}`);
  }
});

test('analysis: IPE 160 S235, 3 m pinned: P_e = π²EI_z/L² = 157 kN, λ = 163 (Euler regime), allowable = P_cr/n', () => {
  const a = analyseColumn({ L: 3, end: 'pinned', sect: { kind: 'ipe', name: 'IPE 160' }, mat: MATERIALS[0], n: 2, P: 60e3 });
  rel(a.Pe, (Math.PI ** 2 * 210e9 * 68.3e-8) / 9, 1e-9);
  near(a.lam, 3 / Math.sqrt(68.3e-8 / 20.1e-4), 1e-6);
  assert.equal(a.regime, 'euler');
  rel(a.Pcr, a.Pe, 1e-9); rel(a.Pallow, a.Pe / 2, 1e-9);
  assert.ok(a.checks.every((c) => c.ok));
  const stocky = analyseColumn({ L: 0.5, end: 'pinned', sect: { kind: 'ipe', name: 'IPE 160' }, mat: MATERIALS[0], n: 2, P: 60e3 });
  assert.equal(stocky.regime, 'johnson');
  assert.ok(stocky.Pcr < stocky.A * 235e6 && stocky.Pcr > stocky.A * 235e6 / 2);
  const over = analyseColumn({ L: 3, end: 'pinned', sect: { kind: 'ipe', name: 'IPE 160' }, mat: MATERIALS[0], n: 2, P: 100e3 });
  assert.ok(over.checks.some((c) => !c.ok));
});

test('secant formula: e → 0 gives P/A; small P gives δ ≈ e (π²/8) P/P_e; diverges at P_e; hand calc', () => {
  const m = minorSection({ kind: 'rect', b: 50, h: 100 });
  const E = 210e9, Le = 2;
  const Pe = eulerLoad(E, m.I, Le);
  rel(secant(m, E, Le, 10e3, 0).sigma, 10e3 / m.A, 1e-12);
  const P = 0.0002 * Pe, e = 0.01;
  rel(secant(m, E, Le, P, e).delta, e * (Math.PI ** 2 / 8) * (P / Pe), 2e-3);
  assert.equal(secant(m, E, Le, Pe, e).sigma, Infinity);
  // hand: P = 0.25 Pe → x = π/4, sec = √2: σ = P/A [1 + (e c/r²)√2]
  const s = secant(m, E, Le, 0.25 * Pe, e);
  rel(s.sigma, (0.25 * Pe / m.A) * (1 + ((e * m.c) / (m.r * m.r)) * Math.SQRT2), 1e-12);
  rel(s.delta, e * (Math.SQRT2 - 1), 1e-12);
});

test('secant yield load: stress at that load equals σ_y; more eccentricity lowers it; it stays below P_e', () => {
  const m = minorSection({ kind: 'rect', b: 50, h: 100 });
  const E = 210e9, Le = 2, sy = 235e6;
  const P1 = secantYieldLoad(m, E, Le, sy, 0.01), P2 = secantYieldLoad(m, E, Le, sy, 0.03);
  rel(secant(m, E, Le, P1, 0.01).sigma, sy, 1e-6);
  assert.ok(P2 < P1 && P1 < eulerLoad(E, m.I, Le));
  const a = analyseEccentric({ L: 2, end: 'pinned', sect: { kind: 'rect', b: 50, h: 100 }, mat: MATERIALS[0], n: 1.5, P: 20e3, e: 0.01 });
  rel(a.Py, P1, 1e-9);
});

test('mode shapes: zero at fixed ends, maximum 1, fixed–pinned peak 0.4 L from the pinned end, free end of the cantilever at 1', () => {
  near(modeShape('pinned', 0), 0, 1e-12); near(modeShape('pinned', 0.5), 1, 1e-12); near(modeShape('pinned', 1), 0, 1e-12);
  near(modeShape('fixedFree', 0), 0, 1e-12); near(modeShape('fixedFree', 1), 1, 1e-12);
  near(modeShape('fixedFixed', 0), 0, 1e-12); near(modeShape('fixedFixed', 0.5), 1, 1e-12);
  near(modeShape('fixedPinned', 0), 0, 1e-9); near(modeShape('fixedPinned', 1), 0, 1e-9);
  let mx = 0, at = 0; for (let i = 0; i <= 100; i++) { const w = Math.abs(modeShape('fixedPinned', i / 100)); if (w > mx) { mx = w; at = i / 100; } }
  near(mx, 1, 1e-6); near(at, 0.6, 0.03); // 0.4 L from the pinned end
});
