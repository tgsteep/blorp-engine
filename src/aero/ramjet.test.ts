import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaRatio, FUELS, idealRamjet, isa, ramjetLayout, shockAngle } from './ramjet.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const kero = FUELS[0];

test('ISA: sea level 288.15 K / 101325 Pa / 1.225 kg/m³; 11 km 216.65 K / 22 632 Pa; 15 km 12 045 Pa (ISA table)', () => {
  const s = isa(0);
  near(s.T, 288.15, 1e-9); near(s.p, 101325, 1e-6); near(s.rho, 1.225, 0.001);
  near(isa(11000).T, 216.65, 1e-9); near(isa(11000).p, 22632, 5);
  near(isa(15000).p, 12045, 15);
  // upper layers (US Standard Atmosphere 1976 base pressures): 20 km 5474.9, 32 km 868.02, 47 km 110.91, 51 km 66.939, 71 km 3.9564 Pa
  near(isa(20000).p, 5474.9, 3); near(isa(32000).p, 868.02, 0.6); near(isa(47000).p, 110.91, 0.1); near(isa(51000).p, 66.939, 0.06); near(isa(71000).p, 3.9564, 0.005);
  near(isa(32000).T, 228.65, 1e-9); near(isa(80000).T, 214.65 - 0.002 * 9000, 1e-9);
});

test('ideal ramjet, M₀ 3, 11 km (T₀ 216.65 K), T_t4 1800 K, kerosene — hand calculation with Mattingly’s equations', () => {
  // τ_r = 1 + 0.2·9 = 2.8; τ_λ = 1800/216.65 = 8.3083; V₉/a₀ = 3·√(8.3083/2.8) = 5.1678
  // a₀ = √(1.4·287.05·216.65) = 295.07 m/s; F/ṁ₀ = 295.07·(5.1678 − 3) = 639.7 N·s/kg
  // f = 1004·216.65·(8.3083 − 2.8)/42.8e6 = 0.02799; S = f/(F/ṁ₀) = 43.76 mg/(N·s)
  const r = idealRamjet({ M0: 3, altitude: 11000, Tt4: 1800, Dinlet: 0.5, fuel: kero });
  near(r.tauR, 2.8, 1e-12);
  near(r.tauL, 8.3083, 1e-4);
  near(r.a0, 295.07, 0.01);
  near(r.Fm, 639.7, 0.3);
  near(r.f, 0.02799, 1e-5);
  near(r.S * 1e6, 43.76, 0.05);
  near(r.etaT, 1 - 1 / 2.8, 1e-12);
  near(r.etaP, 2 / (Math.sqrt(8.3083 / 2.8) + 1), 1e-4);
});

test('thrust = specific thrust × captured air mass flow ρ₀V₀A; no thrust when τ_λ ≤ τ_r', () => {
  const r = idealRamjet({ M0: 3, altitude: 11000, Tt4: 1800, Dinlet: 0.5, fuel: kero });
  near(r.mdot0, isa(11000).rho * r.V0 * Math.PI * 0.0625, 1e-9);
  near(r.F, r.Fm * r.mdot0, 1e-9);
  const hot = idealRamjet({ M0: 8, altitude: 11000, Tt4: 1200, Dinlet: 0.5, fuel: kero }); // τ_r = 13.8 > τ_λ
  assert.equal(hot.Fm, 0);
  assert.equal(hot.ok, false);
});

test('hydrogen burns the same heat with ~2.8× less fuel mass (h_PR 120 vs 42.8 MJ/kg)', () => {
  const k = idealRamjet({ M0: 3, altitude: 11000, Tt4: 1800, Dinlet: 0.5, fuel: kero });
  const h = idealRamjet({ M0: 3, altitude: 11000, Tt4: 1800, Dinlet: 0.5, fuel: FUELS[1] });
  near(k.f / h.f, 120 / 42.8, 1e-9);
  near(h.Fm, k.Fm, 1e-9);
});

test('isentropic A/A*: M 1 → 1, M 2 → 1.6875, M 0.25 → 2.4027 (gas tables, γ = 1.4)', () => {
  near(areaRatio(1), 1, 1e-12);
  near(areaRatio(2), 1.6875, 1e-4);
  near(areaRatio(0.25), 2.4027, 1e-3);
});

test('oblique shock: M 2, θ 15° → weak β = 45.34° (NACA 1135 chart)', () => {
  near((shockAngle(2, (15 * Math.PI) / 180) * 180) / Math.PI, 45.34, 0.05);
  assert.ok(Number.isNaN(shockAngle(1.2, (15 * Math.PI) / 180))); // detached
});

test('layout follows the ideal cycle: A₉/A₀ = √(τ_λ/τ_r); hotter combustor → bigger throat and exit', () => {
  const q = { M0: 3, altitude: 11000, Tt4: 1800, Dinlet: 0.5, fuel: kero };
  const r = idealRamjet(q), L = ramjetLayout(q, r);
  near(L.A9, Math.sqrt(r.tauL / r.tauR), 1e-12);
  near(L.A8, Math.sqrt(r.tauL / r.tauR) / areaRatio(3), 1e-12);
  const hot = ramjetLayout({ ...q, Tt4: 2300 }, idealRamjet({ ...q, Tt4: 2300 }));
  assert.ok(hot.r8 > L.r8 && hot.r9 > L.r9);
});
