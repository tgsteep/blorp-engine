import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dewPoint, humidityRatio, pressureAt, pws, pwsMoist, runProcess, saturated, stateTPhi, stateTW, tFromHW, wetBulb, wFromWetBulb, type ProcessIn } from './psychro.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const P = 101.325;

test('VALIDATION (ASHRAE Fundamentals 2017, ch. 1 Table 3): saturation pressure of water vapour', () => {
  for (const [t, p] of [[-20, 0.10326], [-10, 0.25990], [0, 0.61115], [10, 1.2282], [20, 2.3393], [30, 4.2470], [40, 7.3849], [50, 12.352]] as const) near(pws(t), p, p * 0.0015, `${t} °C`);
});

test('VALIDATION (ASHRAE Fundamentals 2017, ch. 1 Table 2): saturation humidity ratio at 101.325 kPa', () => {
  near(humidityRatio(pwsMoist(20, P), P), 0.014758, 1e-5, '20 °C');
  near(humidityRatio(pwsMoist(10, P), P), 0.007659, 1e-5, '10 °C');
  near(humidityRatio(pwsMoist(30, P), P), 0.027329, 3e-5, '30 °C');
  near(saturated(20, P).h, 57.55, 0.1, 'h_s at 20 °C');
});

test('VALIDATION (ASHRAE Fundamentals 2017, ch. 1 Example 2): 40 °C dry bulb, 20 °C wet bulb → W 0.00646, φ 14 %, v 0.896', () => {
  const W = wFromWetBulb(40, 20, P);
  near(W, 0.00646, 1e-5);
  const s = stateTW(40, W, P);
  near(s.phi, 0.14, 0.005); near(s.v, 0.896, 0.001);
  // consistency: eq. 32 and the dew point of the same vapour pressure
  near(s.h, 1.006 * 40 + W * (2501 + 1.86 * 40), 1e-12);
  near(pwsMoist(s.td, P), s.pw, 1e-9);
  near(wetBulb(40, W, P), 20, 0.01, 'wet bulb recovered');
});

test('pressure at altitude (eq. 3), dew point inverts p_ws, t from h and W', () => {
  near(pressureAt(0), 101.325, 1e-9); near(pressureAt(1000), 89.875, 0.01);
  near(dewPoint(pwsMoist(12.3, P), P), 12.3, 1e-6);
  near(tFromHW(stateTPhi(24, 0.5, P).h, stateTPhi(24, 0.5, P).W), 24, 1e-9);
});

const base: ProcessIn = { process: 'heating', p: P, t1: 5, phi1: 0.8, V1: 1000, t2: 22, adp: 10, bf: 0.15, tB: 0, phiB: 0.8, VB: 300, humid: 'steam', phiTarget: 0.45, tSteam: 100 };

test('heating: W constant, Q = ṁ c_p,moist ΔT, φ falls', () => {
  const r = runProcess(base);
  near(r.s2.W, r.s1.W, 1e-15);
  near(r.Q, r.ma * (1.006 + 1.86 * r.s1.W) * 17, 1e-9);
  assert.ok(r.s2.phi < 0.4);
  near(r.Ql, 0, 1e-12);
});

test('cooling coil: leaving state on the line to the ADP, condensate = ṁ ΔW', () => {
  const r = runProcess({ ...base, process: 'cooling', t1: 30, phi1: 0.5, adp: 10, bf: 0.15 });
  near(r.s2.t, 10 + 0.15 * 20, 1e-12);
  const Wadp = humidityRatio(pwsMoist(10, P), P);
  near(r.s2.W, Wadp + 0.15 * (r.s1.W - Wadp), 1e-12);
  near(r.water, -r.ma * (r.s1.W - r.s2.W) * 3600, 1e-9);
  assert.ok(r.Q < 0 && r.Ql < 0 && r.SHR > 0.5 && r.SHR < 1);
});

test('mixing: mass and energy balance, mixed point between the streams', () => {
  const r = runProcess({ ...base, process: 'mixing', t1: 24, phi1: 0.5, V1: 2000, tB: -5, phiB: 0.8, VB: 500 });
  const m1 = 2000 / 3600 / r.s1.v, mB = 500 / 3600 / r.sB!.v;
  near(r.s2.W, (m1 * r.s1.W + mB * r.sB!.W) / (m1 + mB), 1e-15);
  near(r.s2.h, (m1 * r.s1.h + mB * r.sB!.h) / (m1 + mB), 1e-9);
  assert.ok(r.s2.t < 24 && r.s2.t > -5);
});

test('humidifying: steam keeps the dry bulb nearly constant; spray follows the wet bulb and cools', () => {
  const st = runProcess({ ...base, process: 'humidifying', t1: 22, phi1: 0.2, humid: 'steam', phiTarget: 0.45 });
  near(st.s2.phi, 0.45, 1e-4); assert.ok(st.s2.t > 22 && st.s2.t < 23, 'steam at 100 °C warms the air slightly');
  const sp = runProcess({ ...base, process: 'humidifying', t1: 22, phi1: 0.2, humid: 'spray', phiTarget: 0.45 });
  near(sp.s2.phi, 0.45, 1e-3); near(sp.s2.tw, sp.s1.tw, 0.05); assert.ok(sp.s2.t < 22 - 3);
  near(sp.Q, 0, 0.05 * sp.ma * 10, 'adiabatic: h nearly constant');
});
