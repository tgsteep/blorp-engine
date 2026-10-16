import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hOuter, insulation, lambdaOf, lossPerMetre, type InsIn } from './insulation.ts';

const near = (a: number, b: number, tol: number, w = '') => assert.ok(Math.abs(a - b) <= tol, `${w}: ${a} vs ${b}`);
export const INS_DEF: InsIn = { dn: 50, tm: 70, ta: 20, rh: 0.6, mat: 'mw', s: 0.04, clad: 'paint', wind: 0, L: 50, hours: 5000, price: 0.08 };

test('insulated pipe by hand: resistances in series, surface balance, typical values', () => {
  const r = insulation(INS_DEF);
  const Rins = Math.log(r.D2 / r.D1) / (2 * Math.PI * r.lam), Rs = 1 / (r.h * Math.PI * r.D2);
  near(r.q, 50 / (Rins + Rs), 1e-6, 'q series'); near(r.ts, 20 + r.q * Rs, 1e-4, 'surface balance');
  near(r.lam, lambdaOf('mw', (70 + r.ts) / 2), 1e-6, 'λ at mean temperature');
  assert.ok(r.q > 10 && r.q < 16, `DN50, 40 mm mineral wool, ΔT 50 K: about 13 W/m (got ${r.q})`);
  assert.ok(r.bare.q > 100 && r.bare.q < 140, `bare DN50 about 120 W/m (got ${r.bare.q})`);
  assert.ok(r.checks.every((c) => c.ok), JSON.stringify(r.checks.filter((c) => !c.ok)));
});

test('outer coefficient: Churchill–Chu by hand, wind raises it, radiation by emissivity', () => {
  // D 0.1 m, surface 40 °C, air 20 °C, still: Nu from Churchill–Chu with film properties at 30 °C
  const T = 303.15, mu = (1.458e-6 * T ** 1.5) / (T + 110.4), rho = 101325 / (287.05 * T), nu = mu / rho, k = 0.02436 + 7.6e-5 * 30;
  const Ra = (9.81 / T * 20 * 0.1 ** 3) / (nu * nu) * 0.71;
  const Nu = (0.6 + (0.387 * Ra ** (1 / 6)) / (1 + (0.559 / 0.71) ** (9 / 16)) ** (8 / 27)) ** 2;
  near(hOuter(0.1, 40, 20, 0, 0).hc, (Nu * k) / 0.1, 1e-9, 'h_c'); near(hOuter(0.1, 40, 20, 0, 0).hc, 4.5, 0.6, 'about 4.5 W/m²K');
  assert.ok(hOuter(0.1, 40, 20, 5, 0).hc > 3 * hOuter(0.1, 40, 20, 0, 0).hc);
  near(hOuter(0.1, 40, 20, 0, 0.9).hr, (0.9 * 5.670374e-8 * (313.15 ** 4 - 293.15 ** 4)) / 20, 1e-9, 'h_r');
});

test('critical radius, cold pipe condensation, thickness needed', () => {
  // critical radius λ/h; on a 6 mm tube the first millimetres of a poor insulator save far less than on a big pipe
  const r = insulation(INS_DEF); near(r.rCrit, r.lam / r.h, 1e-12, 'r_crit');
  const small = 1 - lossPerMetre(0.006, 0.004, 60, 20, 0, 'casi', 0.9).q / lossPerMetre(0.006, 0, 60, 20, 0, 'casi', 0.9).q;
  const big = 1 - lossPerMetre(0.1143, 0.004, 60, 20, 0, 'casi', 0.9).q / lossPerMetre(0.1143, 0, 60, 20, 0, 'casi', 0.9).q;
  assert.ok(small < 0.7 * big, `small tube saves ${small}, big pipe ${big}`);
  const cold = insulation({ ...INS_DEF, tm: 5, ta: 25, rh: 0.8, mat: 'fef', s: 0.005 });
  assert.equal(cold.hot, false); assert.ok(cold.q < 0, 'heat flows in');
  assert.equal(cold.checks[1].ok, false, 'too thin: sweats');
  near(insulation({ ...INS_DEF, tm: 5, ta: 25, rh: 0.8, mat: 'fef', s: cold.sNeed }).ts, cold.tdew + 1, 0.01, 'thickness for dew point + 1 K');
  const hot = insulation({ ...INS_DEF, tm: 300, mat: 'casi', s: 0.02 });
  near(insulation({ ...INS_DEF, tm: 300, mat: 'casi', s: hot.sNeed }).ts, 55, 0.01, 'thickness for 55 °C');
});

test('slider ends give numbers', () => {
  for (const e of [{ dn: 15 }, { dn: 300 }, { tm: -40 }, { tm: 400 }, { s: 0 }, { s: 0.2 }, { wind: 10 }, { ta: 0 }, { ta: 40, tm: 40 }, { rh: 0.95 }] as Partial<InsIn>[]) {
    const r = insulation({ ...INS_DEF, ...e }); for (const v of [r.q, r.ts, r.bare.q, r.rCrit, r.tdew, r.E]) assert.ok(Number.isFinite(v), JSON.stringify(e));
  }
});
