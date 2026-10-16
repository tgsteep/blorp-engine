import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kaCoulomb, kaRankine, kpRankine, thrust, wall, type WallIn } from './wall.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const base: WallIn = { type: 'cantilever', method: 'rankine', H: 5, B: 3, toe: 0.8, tb: 0.5, tTop: 0.3, tBot: 0.3, gammaC: 24, gamma: 18, phi: 30, beta: 0, q: 0, hw: 0, phiF: 30, cF: 0, gammaF: 18, D: 0.8, passive: false, approach: 'DA1' };

test('VALIDATION (earth pressure coefficient tables, Das): Rankine φ 30°, β 10° → 0.3495; Coulomb vertical back φ 30°, δ 20°, β 0 → 0.2973', () => {
  near(kaRankine(30, 0), 1 / 3, 1e-12);
  near(kaRankine(30, 10), 0.3495, 1e-4);
  near(kaCoulomb(30, 20, 0), 0.2973, 1e-4);
  near(kaCoulomb(30, 0, 0), 1 / 3, 1e-12, 'Coulomb = Rankine for δ = β = 0');
  near(kpRankine(30), 3, 1e-12);
});

test('cantilever wall, hand calculation: H 5 m, B 3 m, toe 0.8 m, stem 0.3 m, base 0.5 m, γ 18, φ 30°', () => {
  // P_a = ½·⅓·18·5² = 75 kN/m at 5/3 m → M_O = 125; weights 32.4 (x 0.95) + 36 (x 1.5) + 153.9 (x 2.05) = 222.3 kN/m, M_R = 400.275
  const r = wall(base);
  near(r.t.Pah, 75, 1e-9); near(r.t.Mo, 125, 1e-9);
  near(r.V, 222.3, 1e-9); near(r.MR, 400.275, 1e-9);
  near(r.FSo, 3.2022, 1e-4);
  near(r.FSs, (222.3 * Math.tan((20 * Math.PI) / 180)) / 75, 1e-9);
  near(r.e, 1.5 - (400.275 - 125) / 222.3, 1e-9);
  near(r.qmax, 112.89, 0.01);
  assert.equal(r.checks[0].ok, true); assert.equal(r.checks[1].ok, false);
});

test('surcharge and water raise the thrust; passive resistance helps sliding', () => {
  const dry = thrust(base).Pah;
  near(thrust({ ...base, q: 10 }).Pah - dry, (1 / 3) * 10 * 5, 1e-9);
  assert.ok(thrust({ ...base, hw: 3 }).Pah > dry);
  assert.ok(wall({ ...base, passive: true }).FSs > wall(base).FSs);
  // gravity wall: Coulomb with δ = ⅔φ gives a smaller horizontal thrust than Rankine
  const g: WallIn = { ...base, type: 'gravity', tTop: 0.6, tBot: 2.2, B: 2.6 };
  assert.ok(thrust({ ...g, method: 'coulomb' }).Pah < thrust(g).Pah);
});
