import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consolidation, cornerFactor, dSigma, dSigma21, elastic, layerSettle, newmark, TvOf, U, uRatio, type ConsolIn } from './settle.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);

test('VALIDATION (Newmark influence factor, Das table): m = n = 1 → 0.1752, m = n = 2 → 0.2325, m = n → ∞ → 0.25; under the centre of a square at z = B: 4 × I(m = n = 0.5)', () => {
  near(newmark(1, 1, 1), 0.1752, 1e-4);
  near(newmark(2, 2, 1), 0.2325, 1e-4);
  near(newmark(1e4, 1e4, 1), 0.25, 1e-4);
  near(newmark(0.5, 0.5, 1), 0.0840, 1e-4);
  near(dSigma(100, 2, 2, 0, 0, 2), 400 * newmark(1, 1, 2), 1e-9, 'centre by superposition');
  // point outside the footing: superposition with negative rectangles stays ≥ 0 and small
  const out = dSigma(100, 2, 2, 3, 0, 1); assert.ok(out > 0 && out < 5);
  near(dSigma21(100, 2, 2, 2), 25, 1e-12);
});

test('VALIDATION (Das, flexible square on an elastic half-space): s = α q B (1 − ν²)/E with α = 1.12 at the centre, 0.56 at the corner, about 0.95 on average', () => {
  const r = elastic({ shape: 'square', B: 2, L: 2, q: 100, E: 20, nu: 0.5, H: 1e4, sAllow: 25 });
  near(r.Is, 1.122, 0.002, 'centre');
  near(r.sEdge / (r.k * 2), 0.561, 0.002, 'corner');
  near(r.sAvg / (r.k * 2), 0.95, 0.01, 'average');
  // F2 vanishes for ν = 0.5; a thin layer settles less than the half-space
  assert.ok(elastic({ shape: 'square', B: 2, L: 2, q: 100, E: 20, nu: 0.3, H: 2, sAllow: 25 }).sC < elastic({ shape: 'square', B: 2, L: 2, q: 100, E: 20, nu: 0.3, H: 1e4, sAllow: 25 }).sC);
  near(cornerFactor(1, 2, 5, 0.3), cornerFactor(2, 1, 5, 0.3), 1e-12, 'symmetric in a, b');
});

test('VALIDATION (Terzaghi one-dimensional consolidation): T_v = 0.197 for U = 50 %, 0.848 for 90 %; pore pressure ratio 0 at the drained face', () => {
  near(TvOf(0.5), 0.197, 0.001);
  near(TvOf(0.9), 0.848, 0.001);
  near(U(0.287), 0.6, 0.002);
  near(U(0.0177), Math.sqrt((4 * 0.0177) / Math.PI), 1e-3, 'small T_v');
  assert.equal(uRatio(0, 0.1), 0);
  assert.ok(uRatio(1, 0.05) > 0.95);
});

test('consolidation, hand calculation: normally consolidated sublayer and over-consolidated branches', () => {
  // NC: C_c 0.3, h 1, e0 1, σ′0 100 → 150: 0.15 log10(1.5) = 0.026414
  near(layerSettle(1, 1, 0.3, 0.05, 100, 50, 100), 0.15 * Math.log10(1.5), 1e-12);
  near(layerSettle(1, 1, 0.3, 0.05, 100, 50, 200), 0.025 * Math.log10(1.5), 1e-12, 'stays below σ′p');
  near(layerSettle(1, 1, 0.3, 0.05, 100, 50, 120), 0.025 * Math.log10(1.2) + 0.15 * Math.log10(150 / 120), 1e-12, 'crosses σ′p');
  const p: ConsolIn = { shape: 'square', B: 3, L: 3, Df: 1.5, q: 150, gamma: 17, gammaSat: 19, Dw: 2, zc: 4, Hc: 4, gammaC: 18, e0: 0.9, Cc: 0.3, Cs: 0.05, OCR: 1, cv: 2, drain: 'double', t: 1, sAllow: 50 };
  const r = consolidation(p);
  // sixth sublayer, z = 6.2 m: σ′0 = 17·2 + (19 − 9.81)·2 + (18 − 9.81)·2.2 = 70.398 kPa
  near(r.mid.z, 6.2, 1e-12); near(r.mid.s0, 34 + 2 * (19 - 9.81) + 2.2 * (18 - 9.81), 1e-9);
  assert.ok(r.c.s > 0.05 && r.c.s < 0.3, `s_c ${r.c.s}`);
  near(r.t90, (0.848 * 2 * 2) / 2, 0.002);
  assert.ok(consolidation({ ...p, OCR: 3 }).c.s < r.c.s / 2);
  assert.ok(consolidation({ ...p, drain: 'single' }).t90 > 3.9 * r.t90);
});
