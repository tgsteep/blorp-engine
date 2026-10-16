import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BETZ, CP_OPT, airDensity, computeTurbine, cpHeier, induction, operatingPoint, ratedWindSpeed, shear, type TurbineIn } from './turbine.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const base: TurbineIn = { D: 33, H: 40, Pr: 300e3, v10: 7, alpha: 0.14, altitude: 0, tempC: 15 };

test('air density: ISA sea level 15 °C → 1.225 kg/m³; ISA 1000 m, 8.5 °C → 1.112 kg/m³ (ISA table)', () => {
  near(airDensity(0, 15).rho, 1.225, 0.0005);
  near(airDensity(1000, 8.5).p, 89875, 5);
  near(airDensity(1000, 8.5).rho, 1.1117, 0.0005);
});

test('Betz limit 16/27 = 0.5926; momentum theory at the limit: a = 1/3, C_T = 8/9', () => {
  near(BETZ, 0.59259, 1e-5);
  const r = induction(BETZ);
  near(r.a, 1 / 3, 1e-6);
  near(r.CT, 8 / 9, 1e-6);
});

test('Heier C_P curve: published peak C_P,max ≈ 0.48 at λ ≈ 8.1, β = 0', () => {
  near(CP_OPT.cp, 0.48, 0.002);
  near(CP_OPT.lambda, 8.1, 0.05);
  assert.ok(cpHeier(CP_OPT.lambda, 5) < CP_OPT.cp); // pitching sheds power
});

test('power-law shear: v₁₀ = 7 m/s, H = 40 m, α = 0.14 → 7·4^0.14 = 8.50 m/s (hand calculation)', () => {
  near(shear(7, 40, 0.14), 8.499, 0.001);
});

test('wind power ½ρAv³: D = 33 m, ρ = 1.225, v = 8.499 → 0.6125·855.30·613.9 = 321.6 kW (hand calculation)', () => {
  const r = computeTurbine(base);
  near(r.A, 855.30, 0.01);
  near(r.Pwind, 0.5 * 1.225 * 855.30 * 8.499 ** 3, 200);
  near(r.Pwind / 1000, 321.6, 0.3);
  // partial load at λ_opt: P_el = η_m·η_e·C_P,max·P_wind, defaults 0.97·0.95
  near(r.eta, 0.9215, 1e-12);
  near(r.op.Pel, 0.97 * 0.95 * CP_OPT.cp * r.Pwind, 1);
  near(r.op.Pgen, 0.97 * r.op.Pmech, 1e-6);
  near(r.op.lambda, CP_OPT.lambda, 1e-9);
});

test('rated region: P_el = P_r, rotor speed fixed, pitch increases with wind', () => {
  const rho = 1.225;
  const vr = ratedWindSpeed(base, rho);
  assert.ok(vr > 9 && vr < 15, `v_rated ${vr}`);
  const a = operatingPoint(base, rho, vr + 2, vr), b = operatingPoint(base, rho, vr + 6, vr);
  near(a.Pel, 300e3, 1e-6); near(b.Pel, 300e3, 1e-6);
  near(a.rpm, b.rpm, 1e-9);
  assert.ok(b.beta > a.beta && a.beta > 0);
});

test('never above Betz, tip speed never above the limit, stopped outside cut-in/cut-out', () => {
  const r = computeTurbine({ ...base, vTipMax: 70 });
  for (const p of r.curve) assert.ok(p.cp <= BETZ);
  for (let v = 0; v <= 30; v += 0.5) assert.ok(operatingPoint({ ...base, vTipMax: 70 }, r.rho, v, r.vRated).vTip <= 70 + 1e-9);
  assert.equal(operatingPoint(base, 1.225, 2).Pel, 0);
  assert.equal(operatingPoint(base, 1.225, 26).Pel, 0);
});

test('rotor speed n = 60·λ·v/(2πR): λ 8.1, v 8.5 m/s, R 16.5 m → ≈ 39.8 rpm', () => {
  const r = computeTurbine(base);
  near(r.op.rpm, (60 * CP_OPT.lambda * r.vHub) / (2 * Math.PI * 16.5), 1e-9);
  near(r.op.rpm, 39.8, 0.3);
});

test('user C_P,max scales the curve: 0.40 → C_P = 0.40 at λ_opt, power × 0.40/0.48; never above Betz', () => {
  const a = computeTurbine(base), b = computeTurbine({ ...base, cpMax: 0.4 });
  near(b.op.cp, 0.4, 1e-9);
  near(b.op.Pel / a.op.Pel, 0.4 / CP_OPT.cp, 1e-9);
  near(computeTurbine({ ...base, cpMax: 0.9 }).cpMax, BETZ, 1e-12);
});

test('efficiencies multiply: η_m 0.95, η_e 0.90 → P_el = 0.855·P_mech', () => {
  const r = computeTurbine({ ...base, etaMech: 0.95, etaEl: 0.9 });
  near(r.op.Pel, 0.855 * r.op.Pmech, 1e-6);
});

test('why C_P changes with wind: λ_opt tracking keeps C_P,max up to v = v_tip,max/λ_opt; then the tip-speed limit lowers λ; above rated C_P = P_r/(η·½ρAv³) falls as 1/v³', () => {
  const t = { ...base, D: 73.5, H: 10, Pr: 2e6, alpha: 0.14, vTipMax: 80 };
  const at = (v10: number) => computeTurbine({ ...t, v10 });
  near(at(8).vTipLimit, 80 / CP_OPT.lambda, 1e-9);
  const a = at(7), b = at(11), c = at(14), d = at(18);
  assert.equal(a.limit, 'optimum'); near(a.op.cp, a.cpMax, 1e-9);
  assert.equal(b.limit, 'tip'); assert.ok(b.op.cp < b.cpMax && b.op.lambda < CP_OPT.lambda);
  assert.equal(c.limit, 'rated'); assert.equal(d.limit, 'rated');
  near(d.op.cp / c.op.cp, (14 / 18) ** 3, 1e-9);
});
