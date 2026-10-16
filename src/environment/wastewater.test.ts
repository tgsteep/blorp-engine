import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activatedSludge, cs, effluentN, effluentS, nitri, type WwIn } from './wastewater.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const base: WwIn = { Q: 10000, S0: 200, TKN: 40, alk: 300, T: 20, srt: 10, X: 2500, Xr: 10000, DO: 2, h: 5, diff: 'fine', TSSe: 15, nC: 2, D: 20, nitrify: true };

test('oxygen saturation against the APHA table', () => {
  near(cs(0), 14.62, 0.05); near(cs(20), 9.09, 0.03); near(cs(30), 7.56, 0.05);
});

test('kinetics at 20 °C (hand calculation)', () => {
  near(effluentS(200, 20, 10), (60 * 1.6) / (10 * 2.94 - 1), 1e-9, 'S = K_s(1 + k_d θc)/(θc(Yk − k_d) − 1)');
  near(effluentS(200, 20, 0.3), 200, 1e-12, 'washout');
  const n = nitri(20, 2); near(n.mu, 0.75 * 0.8, 1e-12); near(n.srtMin, 1 / (0.6 - 0.08), 1e-9, 'minimum SRT for nitrification');
  near(effluentN(40, 20, 2, 10), (0.74 * 1.8) / (10 * 0.52 - 1), 1e-9);
  near(effluentN(40, 20, 2, 1.5), 40, 1e-12, 'nitrifiers wash out');
  assert.ok(nitri(10, 2).srtMin > 2 * nitri(20, 2).srtMin * 0.9, 'cold water needs a much older sludge');
});

test('activated sludge mass balances (hand calculation)', () => {
  const r = activatedSludge(base), S = effluentS(200, 20, 10), dS = 200 - S;
  const Px = (0.6 * 10000 * dS) / 1.6 / 1000;
  near(r.Px, Px, 1e-9, 'P_x'); near(r.V, (10 * Px * 1000) / 2500, 1e-6, 'V = θc P_x/X');
  near(r.FM, (10000 * 200) / (r.V * 2500), 1e-12); near(r.hrt, (r.V / 10000) * 24, 1e-12);
  const Ne = effluentN(40, 20, 2, 10), dN = 40 - (0.12 * Px * 1000) / 10000 - Ne;
  near(r.dN, dN, 1e-9, 'ΔN'); near(r.O2, (10000 * dS) / 0.68 / 1000 - 1.42 * Px + (4.57 * 10000 * dN) / 1000, 1e-6, 'O₂');
  near(r.alkOut, 300 - 7.14 * dN, 1e-9);
  near(r.R, 3125 / (10000 - 3125), 1e-12, 'return ratio'); near(r.SOR, 10000 / (2 * Math.PI * 100), 1e-9, 'overflow rate');
  // sludge balance: what is wasted plus what leaves with the effluent equals the growth
  near(r.Qw * 10000 * 0.8 + (10000 - r.Qw) * 15 * 0.8, (r.V * 2500) / 10, 1e-6, 'VSS balance');
  assert.ok(r.checks.every((c) => c.ok), r.checks.filter((c) => !c.ok).map((c) => `${c.label} ${c.detail}`).join('; '));
});

test('aeration: field/standard ratio, blower power and aeration efficiency in the usual range', () => {
  const r = activatedSludge(base);
  const dF = 1 + (0.5 * 9.81 * 4.7) / 101.325; near(r.ratio, (0.5 * (0.95 * 9.09 * dF - 2)) / (9.09 * dF), 0.005, 'α(βC̄_s − C)/C̄_s at 20 °C');
  assert.ok(r.AE > 1 && r.AE < 3, `fine bubble field efficiency ${r.AE.toFixed(2)} kg O₂/kWh`);
  const c = activatedSludge({ ...base, diff: 'coarse' });
  assert.ok(c.Pbl > r.Pbl * 1.3, 'coarse bubbles need more blower power');
  assert.ok(activatedSludge({ ...base, srt: 3, T: 12 }).checks.some((x) => !x.ok), 'short sludge age in cold water fails nitrification');
});
