import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aISO, CATALOGUE, computeLife, equivalentLoad, nu1, selectBearings } from './iso281.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const b6205 = CATALOGUE.find((b) => b.name === '6205')!;

test('basic life: L10 = (C/P)³ for ball bearings, L10h = 10⁶·L10/(60 n)', () => {
  const r = computeLife({ b: b6205, Fr: 2, Fa: 0, n: 1500, nu: 32, ec: 0.5, rel: 90, Lreq: 20000 });
  near(r.L10, (14.8 / 2) ** 3, 1e-9);
  near(r.L10h, ((14.8 / 2) ** 3 * 1e6) / (60 * 1500), 1e-6);
});

test('equivalent load: ISO 281 Table 3 point f₀F_a/C₀ = 0.345 → e = 0.22, Y = 1.99', () => {
  const Fa = (0.345 * b6205.C0) / 13; // gives the table ratio exactly
  const eq = equivalentLoad(b6205, 0.5, Fa);
  near(eq.e, 0.22, 1e-9); near(eq.Y, 1.99, 1e-9);
  near(eq.P, 0.56 * 0.5 + 1.99 * Fa, 1e-9);
});

test('a_ISO, ball, κ = 1, e_c·P_u/P = 0.1 ≈ 2.43 (hand calculation of ISO 281 Eq.)', () => {
  near(aISO('ball', 1, 0.1), 2.43, 0.03);
});

test('rated viscosity ν₁ at n = 1500 rpm, d_m = 38.5 mm ≈ 18.7 mm²/s', () => {
  near(nu1(1500, 38.5), 4500 / Math.sqrt(1500 * 38.5), 1e-9);
});

test('design mode ranks a passing bearing first', () => {
  const list = selectBearings({ d: 25, type: 'any', Fr: 2, Fa: 0, n: 1500, nu: 32, ec: 0.5, rel: 90, Lreq: 10000 });
  assert.ok(list.length >= 2);
  assert.ok(list[0].ok);
});

const byName = (n: string) => CATALOGUE.find((x) => x.name === n)!;

test('angular contact 40° (ISO 281): F_a/F_r = 2 > e = 1.14 → P = 0.35·F_r + 0.57·F_a; P₀ = 0.5·F_r + 0.26·F_a', () => {
  const eq = equivalentLoad(byName('7205 B'), 2, 4);
  near(eq.P, 0.35 * 2 + 0.57 * 4, 1e-12); // 2.98 kN
  near(eq.P0, 0.5 * 2 + 0.26 * 4, 1e-12);
  near(equivalentLoad(byName('7205 B'), 2, 1).P, 2, 1e-12); // F_a/F_r = 0.5 ≤ e → P = F_r
});

test('tapered roller 30205 (e 0.37, Y 1.6): F_r 5, F_a 3 → P = 0.4·5 + 1.6·3 = 6.8 kN; F_a 1 → P = F_r', () => {
  near(equivalentLoad(byName('30205'), 5, 3).P, 6.8, 1e-12);
  near(equivalentLoad(byName('30205'), 5, 1).P, 5, 1e-12);
});

test('spherical roller 22210 (e 0.24, Y₁ 2.8, Y₂ 4.2): F_r 10, F_a 1 → P = 10 + 2.8 = 12.8; F_a 4 → 0.67·10 + 4.2·4 = 23.5 kN', () => {
  near(equivalentLoad(byName('22210'), 10, 1).P, 12.8, 1e-12);
  near(equivalentLoad(byName('22210'), 10, 4).P, 23.5, 1e-12);
});

test('roller life exponent 10/3 for tapered and spherical; application factor f_d multiplies P', () => {
  const r = computeLife({ b: byName('22210'), Fr: 10, Fa: 0, n: 1000, nu: 30, ec: 0.5, rel: 90, Lreq: 20000, fd: 1.8 });
  near(r.P, 18, 1e-12);
  near(r.L10, Math.pow(104 / 18, 10 / 3), 1e-9);
});

test('design mode, harsh duty: a working spherical roller bearing is ranked before other working types', () => {
  const list = selectBearings({ d: 50, type: 'any', Fr: 4, Fa: 0.4, n: 800, nu: 68, ec: 0.5, rel: 90, Lreq: 20000, app: 'harsh' });
  const firstOk = list.find((x) => x.ok)!;
  assert.equal(firstOk.b.type, 'spherical');
  const light = selectBearings({ d: 50, type: 'any', Fr: 1, Fa: 0, n: 800, nu: 68, ec: 0.5, rel: 90, Lreq: 20000, app: 'light' });
  const oks = light.filter((x) => x.ok);
  assert.equal(oks[0].priceIdx, Math.min(...oks.map((x) => x.priceIdx))); // cheapest working one first
});

test('self-aligning ball 1205 (e 0.27, Y₁ 2.3, Y₂ 3.6): F_r 3, F_a 0.5 → P = 3 + 2.3·0.5 = 4.15; F_a 2 → 0.65·3 + 3.6·2 = 9.15 kN', () => {
  near(equivalentLoad(byName('1205'), 3, 0.5).P, 4.15, 1e-12);
  near(equivalentLoad(byName('1205'), 3, 2).P, 9.15, 1e-12);
});

test('thrust ball 51105: P = F_a, radial load flagged as not allowed', () => {
  near(equivalentLoad(byName('51105'), 0, 4).P, 4, 1e-12);
  const r = computeLife({ b: byName('51105'), Fr: 1, Fa: 4, n: 500, nu: 30, ec: 0.5, rel: 90, Lreq: 10000 });
  assert.ok(r.checks.some((c) => !c.ok && c.label.startsWith('Thrust ball')));
  near(r.L10, Math.pow(19.5 / 4, 3), 1e-9);
});
