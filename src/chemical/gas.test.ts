import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gasState, MIXES, pSatWater, virialZ } from './gas.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);

test('VALIDATION (Smith, Van Ness & Abbott, generalized virial correlation): n-butane at 510 K and 25 bar', () => {
  // T_c 425.1 K, P_c 37.96 bar, ω 0.200: T_r 1.200, P_r 0.659, B⁰ −0.232, B¹ 0.059, Z 0.879, V 1489 cm³/mol (ideal 1696 cm³/mol)
  const v = virialZ(510 / 425.1, 25 / 37.96, 0.2);
  near(v.B0, -0.232, 0.001, 'B⁰'); near(v.B1, 0.059, 0.001, 'B¹'); near(v.Z, 0.879, 0.001, 'Z');
  const r = gasState({ y: { C4H10: 1 }, P: 25, T: 510 - 273.15, V: 1 });
  near(r.vMolar * 1e6, 1489, 2.5, 'molar volume'); near((r.vMolar * 1e6) / r.Z, 1696.1, 0.5, 'ideal molar volume');
});

test('ideal-gas mixtures: air density, molar mass, Dalton, sound speed, water dew point', () => {
  const air = MIXES.find((m) => m.id === 'air')!.y, r = gasState({ y: air, P: 1.01325, T: 0, V: 1 });
  near(r.M, 28.96, 0.01, 'molar mass of air'); near(r.rho, 1.292, 0.003, 'air density at 0 °C (Z ≈ 0.9995)');
  near(r.parts.reduce((a, x) => a + x.p, 0), 1.01325, 1e-12, 'Σ p_i = p');
  near(r.parts.reduce((a, x) => a + x.wmass, 0), 1, 1e-12, 'Σ mass fractions');
  near(gasState({ y: air, P: 1.01325, T: 20, V: 1 }).a, 343, 1.5, 'speed of sound in air at 20 °C');
  near(r.k, 1.40, 0.005, 'k of air');
  near(pSatWater(100), 1.01325, 0.002, 'water boils at 100 °C'); near(pSatWater(20), 0.02339, 0.0003, 'p_sat at 20 °C');
  // flue gas with 17.5 % water at 1 bar: dew point ≈ 57.5 °C (p_H₂O 0.175 bar)
  const fl = gasState({ y: MIXES.find((m) => m.id === 'flue')!.y, P: 1, T: 120, V: 1 });
  near(pSatWater(fl.tDew), 0.175, 1e-6); assert.ok(fl.checks[2].ok); assert.ok(!gasState({ ...{ y: fl.c.reduce((o, x) => ({ ...o, [x.id]: x.y }), {}) }, P: 1, T: 40, V: 1 }).checks[2].ok, 'condenses at 40 °C');
});

test('every preset mixture passes its checks at its own temperature and 1 atm', () => {
  for (const m of MIXES) {
    const bad = gasState({ y: m.y, P: 1.01325, T: m.T ?? 20, V: 1 }).checks.filter((c) => !c.ok).map((c) => `${c.label} (${c.detail})`);
    assert.deepEqual(bad, [], m.id);
  }
});
