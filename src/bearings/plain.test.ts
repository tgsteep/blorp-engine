import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bushing, filmPressureShape, journal, OILS, PLAIN_MATERIALS, raimondiBoyd, viscosity } from './plain.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const mat = (id: string) => PLAIN_MATERIALS.find((m) => m.id === id)!;

test('bushing: d 20, L 20 mm, F 2 kN, 300 rpm → p = 5 MPa, v = 0.314 m/s, pv = 1.57 MPa·m/s (hand calculation)', () => {
  const r = bushing({ d: 20, L: 20, F: 2000, n: 300, mat: mat('sinter') });
  near(r.p, 5, 1e-12);
  near(r.v, (Math.PI * 20 * 300) / 60000, 1e-12);
  near(r.pv, 5 * 0.31416, 1e-4);
  assert.ok(r.checks.every((c) => c.ok)); // sintered bronze: 10 MPa, 6 m/s, 1.8 → ok
  assert.ok(!bushing({ d: 20, L: 20, F: 2000, n: 300, mat: mat('polymer') }).checks[2].ok); // POM pv 0.15 → fails
});

test('VALIDATION (Shigley Example 12-1): Raimondi–Boyd (L/D = 1) table points returned exactly; S = 0.135 → h₀/c ≈ 0.42, (r/c)f ≈ 3.5', () => {
  const t = raimondiBoyd(0.121);
  near(t.h0c, 0.4, 1e-9); near(t.rcf, 3.22, 1e-9);
  const e = raimondiBoyd(0.135);
  near(e.h0c, 0.42, 0.015);
  near(e.rcf, 3.5, 0.12);
});

test('Walther viscosity through the ISO VG points: VG46 → 46 mm²/s at 40 °C, 6.8 at 100 °C, between at 70 °C', () => {
  near(viscosity(OILS.VG46, 40), 46, 0.01);
  near(viscosity(OILS.VG46, 100), 6.8, 0.01);
  const v70 = viscosity(OILS.VG46, 70);
  assert.ok(v70 > 13 && v70 < 18, `ν70 ${v70}`);
});

test('journal: Sommerfeld number S = (r/c)²·μN/P (hand check) and h₀ = (h₀/c)·c', () => {
  const r = journal({ D: 50, cr: 25, W: 5000, n: 1500, oil: 'VG46', T: 60 });
  const mu = 870 * viscosity(OILS.VG46, 60) * 1e-6, P = 5000 / (0.05 * 0.05);
  near(r.S, (0.025 / 25e-6) ** 2 * ((mu * 25) / P), 1e-12);
  near(r.h0, r.h0c * 25e-6, 1e-15);
  assert.ok(r.f > 0 && r.f < 0.05);
});

test('attitude angle (Raimondi–Boyd L/D = 1): 50.58° at ε = 0.6; film pressure peak lies after the thickest film, before the thinnest (θ < π)', () => {
  near(raimondiBoyd(0.121).phi, 50.58, 1e-9);
  const sh = filmPressureShape(0.6, 360);
  const pk = sh.reduce((a, c) => (c.p > a.p ? c : a));
  assert.ok(pk.th > Math.PI / 2 && pk.th < Math.PI, `peak at ${pk.th}`);
  // analytic peak of sin θ/(1+ε cos θ)³: cos θ = (√(1+24ε²) − 1)/(4ε)
  near(Math.cos(pk.th), -(Math.sqrt(1 + 24 * 0.36) - 1) / (4 * 0.6), 0.02);
});
