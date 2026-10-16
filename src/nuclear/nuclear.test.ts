import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decayHeat, feedPerProduct, fissionRate, ignitionNTau, sigmaV_DT, tokamak, TOKAMAKS } from './nuclear.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);

test('fission: 1 MW thermal → 3.12·10¹⁶ fissions/s, ≈ 1.05 g U-235 fissioned per day (classic "1 gram per megawatt-day")', () => {
  const r = fissionRate(1e6);
  near(r.rate, 3.12e16, 0.01e16);
  near(r.gPerDay, 1.053, 0.005);
});

test('decay heat (Way–Wigner) after one year at power: ≈ 6 % at 1 s, ≈ 1 % at 1 h, ≈ 0.4 % at 1 day', () => {
  const T = 365 * 86400;
  near(decayHeat(1, T), 0.0602, 0.001);
  near(decayHeat(3600, T), 0.0101, 0.0005);
  near(decayHeat(86400, T), 0.0622 * (86400 ** -0.2 - (86400 + T) ** -0.2), 1e-12);
  assert.ok(decayHeat(86400, T) > 0.003 && decayHeat(86400, T) < 0.006);
});

test('enrichment balance: 4 % product, 0.25 % tails → 8.13 kg natural uranium per kg (hand calculation)', () => {
  near(feedPerProduct(4), (4 - 0.25) / (0.711 - 0.25), 1e-12);
  near(feedPerProduct(4), 8.134, 0.001);
});

test('Bosch–Hale D–T reactivity: ⟨σv⟩(10 keV) = 1.136·10⁻²² m³/s, (20 keV) = 4.33·10⁻²² m³/s (published table)', () => {
  near(sigmaV_DT(10), 1.136e-22, 0.01e-22);
  near(sigmaV_DT(20), 4.33e-22, 0.05e-22);
});

test('Lawson ignition curve has its minimum n·T·τ_E ≈ 3·10²¹ keV·s/m³ near 13…15 keV', () => {
  let best = { T: 0, v: Infinity };
  for (let T = 3; T <= 60; T += 0.25) { const v = ignitionNTau(T) * T; if (v < best.v) best = { T, v }; }
  assert.ok(best.T >= 12 && best.T <= 16, `T_min ${best.T}`);
  assert.ok(best.v > 2.5e21 && best.v < 3.5e21, `triple ${best.v}`);
});

test('ITER-like plasma: volume 2π²Ra²κ ≈ 832 m³, fusion power of the order of 500 MW, Q > 1', () => {
  const r = tokamak(TOKAMAKS.iter);
  near(r.V, 2 * Math.PI ** 2 * 6.2 * 4 * 1.7, 1e-9);
  near(r.V, 832, 1);
  assert.ok(r.Pfus > 300e6 && r.Pfus < 700e6, `P_fus ${r.Pfus}`);
  assert.ok(r.Q > 1);
  near(r.Palpha / r.Pfus, 3.52 / 17.59, 1e-12);
});
