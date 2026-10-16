import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FF, flowCurve, gasKv, kvOfTravel, liquidKv, reynolds, travel, valve, type ValveIn } from './valve.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);

test('VALIDATION (ANSI/ISA-75.01.01-2002 = IEC 60534-2-1 Mod, Annex F examples 1 and 2): water at 363 K', () => {
  // ρ₁ 965.4 kg/m³, p_v 70.1 kPa, p_c 22 120 kPa, ν 3.26e-7 m²/s, p₁ 680 kPa, p₂ 220 kPa, Q 360 m³/h
  near(FF(70.1, 22120), 0.944, 0.001, 'F_F');
  // example 1: globe, parabolic plug, flow-to-open, F_L 0.90, F_d 0.46, DN 150: not choked (ΔP < 497 kPa), C = 165 Kv, Re_v 2.967e6
  const e1 = liquidKv(360, 680, 220, 965.4, 70.1, 22120, 0.9);
  assert.ok(!e1.choked); near(e1.dpCh, 497.2, 0.5, 'choked limit'); near(e1.Kv, 165, 0.5, 'Kv example 1');
  near(reynolds(360, 3.26e-7, e1.Kv, 0.9, 0.46, 150) / 1e6, 2.967, 0.01, 'Re_v example 1');
  // example 2: segmented ball, F_L 0.60, F_d 0.98, DN 100: choked (limit 221 kPa), C = 238 Kv, Re_v 6.598e6
  const e2 = liquidKv(360, 680, 220, 965.4, 70.1, 22120, 0.6);
  assert.ok(e2.choked); near(e2.dpCh, 221, 0.5, 'choked limit'); near(e2.Kv, 238, 0.5, 'Kv example 2');
  near(reynolds(360, 3.26e-7, e2.Kv, 0.6, 0.98, 100) / 1e6, 6.598, 0.02, 'Re_v example 2');
});

test('gas sizing: mass-flow form agrees with the standard-volume form (N₉ = 24.6), expansion and choking', () => {
  // natural-gas-like: M 17.4, γ 1.31, Z 1, 20 °C, 1000 → 600 kPa abs, x_T 0.72
  const W = 5000, g = gasKv(W, 1000, 600, 20, 17.4, 1.31, 1, 0.72);
  const Qs = W / ((101.325 * 1000 * 17.4) / (8314.462618 * 273.15)); // m³/h at 0 °C, 101.325 kPa
  near(g.Kv, (Qs / (24.6 * 1000 * g.Y)) * Math.sqrt((17.4 * 293.15 * 1) / g.x), g.Kv * 0.005, 'N₆ and N₉ forms');
  near(g.Y, 1 - 0.4 / (3 * (1.31 / 1.4) * 0.72), 1e-12, 'Y');
  const ch = gasKv(W, 1000, 100, 20, 17.4, 1.31, 1, 0.72);
  assert.ok(ch.choked); near(ch.Y, 2 / 3, 1e-12, 'Y = 2/3 when choked');
  // choked: a lower outlet pressure does not need a smaller valve
  near(gasKv(W, 1000, 50, 20, 17.4, 1.31, 1, 0.72).Kv, ch.Kv, 1e-9);
});

test('travel, flow curve and tool checks', () => {
  for (const h of [0.2, 0.5, 0.9]) { near(travel(kvOfTravel(h, 'eq'), 'eq'), h, 1e-12); near(travel(kvOfTravel(h, 'lin'), 'lin'), h, 1e-12); }
  const p: ValveIn = { service: 'liquid', style: 'globeO', dn: 150, char: 'eq', p1: 680, p2: 220, T: 90, Q: 360, rho: 965.4, pv: 70.1, pc: 22120, nu: 0.326, M: 18, k: 1.33, Z: 1 };
  const r = valve(p);
  near(r.Kv, 165, 0.5); near(r.Cv, 1.156 * r.Kv, 1e-9);
  const c = flowCurve(p, r.Kv);
  const at = c.find((x) => Math.abs(x.dp - 460) < 6)!; near(at.q, 360 * Math.sqrt(at.dp / 460), 2, 'flow at the design drop');
  near(c[c.length - 1].q, c[c.length - 2].q, 1e-9, 'flat once choked');
  assert.ok(!valve({ ...p, p2: 60 }).checks.find((x) => x.label.startsWith('No flashing'))!.ok, 'flashing below p_v');
});

test('degenerate inputs give failing checks and a finite flow curve (no NaN reaches a drawing)', () => {
  const base: ValveIn = { service: 'liquid', style: 'globeO', dn: 200, char: 'eq', p1: 680, p2: 220, T: 90, Q: 360, rho: 965.3, pv: 70.1, pc: 22064, nu: 0.326, M: 18, k: 1.33, Z: 1 };
  const cases: Partial<ValveIn>[] = [{ p1: 60, p2: 30 }, { p2: 700 }, { service: 'gas', p2: 700, p1: 600 }, { service: 'gas', p2: 1000, p1: 1000 }];
  for (const c of cases) {
    const p = { ...base, ...c }, r = valve(p);
    assert.ok(r.checks.some((x) => !x.ok), JSON.stringify(c));
    const curve = flowCurve(p, Number.isFinite(r.Kv) ? r.Kv : 1);
    assert.ok(curve.every((x) => Number.isFinite(x.q) && Number.isFinite(x.dp)), JSON.stringify(c));
  }
});
