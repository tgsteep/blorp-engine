import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucklingDeflection, compression, ends, gerberShear, kBergstrasser, kInner, SEATS, SPRING_WIRES, sseGerber, tensile, torsion } from './spring.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const w = (id: string) => SPRING_WIRES.find((x) => x.id === id)!;

test('wire strength R_m = A/d^m (Shigley Table 10-4): music wire 2211 MPa at d = 1 mm, 1790 MPa at 4.3 mm; hard-drawn 1783/2^0.19 = 1563 MPa', () => {
  near(tensile(w('music'), 1), 2211, 1e-9);
  near(tensile(w('music'), 4.3), 2211 / 4.3 ** 0.145, 1e-9);
  near(tensile(w('hd'), 2), 1563, 1);
});

test('factors: Bergsträsser K_B(C = 8) = 34/29 = 1.172, inner-fibre K_i(C = 8) = 247/224 = 1.103', () => {
  near(kBergstrasser(8), 34 / 29, 1e-12);
  near(kInner(8), 247 / 224, 1e-12);
});

test('end types (Shigley Table 10-1) for 10 active coils, d = 2: squared & ground N_t 12, L_s 24; squared 12, 26; plain 10, 22; plain ground 11, 22', () => {
  assert.deepEqual(ends('squaredGround', 10, 2), { Nt: 12, Ls: 24 });
  assert.deepEqual(ends('squared', 10, 2), { Nt: 12, Ls: 26 });
  assert.deepEqual(ends('plain', 10, 2), { Nt: 10, Ls: 22 });
  assert.deepEqual(ends('plainGround', 10, 2), { Nt: 11, Ls: 22 });
});

test('rate k = G·d⁴/(8D³n): d 2, D 16, n 8, G 81 GPa → 81000·16/(8·4096·8) = 4.944 N/mm; τ = 8FD/(πd³)', () => {
  const r = compression({ d: 2, D: 16, n: 8, L0: 50, endType: 'squaredGround', F1: 20, F2: 80, cyclic: false, f: 0, nu: 0.5, wire: w('music') });
  near(r.k, (81000 * 16) / (8 * 4096 * 8), 1e-9);
  near(r.t2, (8 * 80 * 16) / (Math.PI * 8), 1e-9);
  near(r.L2, 50 - 80 / r.k, 1e-9);
});

test('buckling (EN 13906-1): steel with flat parallel ends (ν = 0.5) cannot buckle below L₀/D ≈ 2.63/ν = 5.26 (Shigley eq. 10-10); a slender spring buckles at a finite deflection', () => {
  const g = SPRING_WIRES[2];
  assert.equal(bucklingDeflection(5.2 * 10, 10, 0.5, g.G, g.E), Infinity);
  const sK = bucklingDeflection(5.4 * 10, 10, 0.5, g.G, g.E);
  assert.ok(Number.isFinite(sK) && sK > 0 && sK < 54);
  assert.ok(bucklingDeflection(80, 10, SEATS[2].nu, g.G, g.E) < bucklingDeflection(80, 10, SEATS[0].nu, g.G, g.E));
});

test('Zimmerli–Gerber: S_se = 241/(1 − (379/0.67R_m)²); R_m 1645 MPa (238.6 kpsi) → S_se = 273.7 MPa (39.7 kpsi, Shigley Ex. 10-4); Gerber n with τ_a = 0 → S_su/τ_m', () => {
  near(sseGerber(1645), 241 / (1 - (379 / (0.67 * 1645)) ** 2), 1e-9);
  near(sseGerber(1645) / 6.894757, 39.7, 0.15);
  near(gerberShear(0, 400, 300, 1100), 1100 / 400, 1e-12);
  // a point on the Gerber line has n = 1
  const Ssu = 1100, Sse = 300, tm = 500, ta = Sse * (1 - (tm / Ssu) ** 2);
  near(gerberShear(ta, tm, Sse, Ssu), 1, 1e-9);
});

test('torsion spring: M = F·l, rate d⁴E/(10.8·D·N_e) per turn with N_e = N_b + 2l/(3πD); σ = K_i·32M/(πd³)', () => {
  const r = torsion({ d: 2, D: 14, Nb: 6, l: 30, F: 10, wire: w('music') });
  const Ne = 6 + 60 / (3 * Math.PI * 14);
  near(r.kTurn, (16 * 203400) / (10.8 * 14 * Ne), 1e-9);
  near(r.angle, (300 / r.kTurn) * 360, 1e-9);
  near(r.sigma, (kInner(7) * 32 * 300) / (Math.PI * 8), 1e-9);
  assert.ok(r.Dafter < 14);
});
