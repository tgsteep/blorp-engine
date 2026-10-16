import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseCapacity, groupFactor, resistance, sizeCable, tempFactor, voltageDrop, type CableIn } from './cables.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const base: CableIn = { system: '1ph', U: 230, P: 3.5, cosphi: 0.95, L: 25, method: 'C', ins: 'PVC', metal: 'Cu', Tamb: 30, groups: 1, dUmax: 5, Ik: 0, tk: 0.1 };

test('IEC 60364-5-52 B.52.2 / B.52.4, Cu PVC: 2.5 mm² method C → 27 A (2 loaded), 24 A (3 loaded); 10 mm² B1 → 57 / 50 A', () => {
  assert.equal(baseCapacity(2.5, 'C', 2, 'PVC', 'Cu'), 27);
  assert.equal(baseCapacity(2.5, 'C', 3, 'PVC', 'Cu'), 24);
  assert.equal(baseCapacity(10, 'B1', 2, 'PVC', 'Cu'), 57);
  assert.equal(baseCapacity(10, 'B1', 3, 'PVC', 'Cu'), 50);
});

test('correction factors (B.52.14, B.52.17): PVC 40 °C → 0.87, XLPE 40 °C → 0.91, 3 bunched circuits → 0.70', () => {
  near(tempFactor('PVC', 40), 0.87, 1e-12);
  near(tempFactor('XLPE', 40), 0.91, 1e-12);
  near(tempFactor('PVC', 37.5), (0.94 + 0.87) / 2, 1e-12);
  near(groupFactor(3), 0.7, 1e-12);
});

test('voltage drop, 1 phase 230 V, 16 A, 30 m, 2.5 mm² Cu PVC, cos φ 1 → R = 0.017241·1.1965/2.5 = 0.008251 Ω/m, ΔU = 2·30·16·0.008251 = 7.92 V = 3.44 % (hand calculation)', () => {
  near(resistance(2.5, 'Cu', 'PVC'), (0.017241 * (1 + 0.00393 * 50)) / 2.5, 1e-12);
  const v = voltageDrop({ ...base, cosphi: 1, L: 30 }, 2.5, 16);
  near(v.dU, 2 * 30 * 16 * resistance(2.5, 'Cu', 'PVC'), 1e-9);
  near(v.pct, 3.44, 0.01);
});

test('adiabatic short circuit: 6 kA for 0.1 s, Cu PVC k = 115 → S_min = 6000·√0.1/115 = 16.5 mm²', () => {
  const r = sizeCable({ ...base, P: 1, Ik: 6, tk: 0.1 });
  near(r.Ssc, 16.5, 0.05);
  assert.ok(r.pick && r.pick.S >= 16.5);
});

test('3.5 kW single phase, 25 m, method C: I_b = 16.0 A → 20 A breaker → 2.5 mm²; at 80 m the voltage drop decides, not ampacity', () => {
  const r = sizeCable(base);
  near(r.Ib, 3500 / (230 * 0.95), 1e-9);
  assert.equal(r.In, 20);
  assert.equal(r.pick!.S, 2.5); // 27 A ≥ 20 A, ΔU ≈ 2.9 %
  const long = sizeCable({ ...base, L: 80 });
  assert.ok(long.pick!.S > r.pick!.S && long.byCurrent!.S === 2.5); // voltage drop decides, not ampacity
});
