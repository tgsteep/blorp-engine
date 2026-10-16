import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brayton, diesel, otto, rankine, refrigeration, tsat } from './cycles.ts';
import { satP, statePT } from './props.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);

test('steam tables (Çengel A-5/A-6): 75 kPa → T_sat 91.76 °C, h_f 384.44, s_g 7.4558; 3 MPa 350 °C → h 3116.1, s 6.7450', () => {
  const s = satP('water', 75);
  near(s.T, 91.76, 0.02); near(s.hf, 384.44, 0.05); near(s.sg, 7.4558, 0.0005);
  const v = statePT('water', 3000, 350);
  near(v.h, 3116.1, 0.6); near(v.s, 6.745, 0.002);
});

test('Otto: r = 8, T₁ = 17 °C, q_in = 800 kJ/kg → η = 1 − 8^−0.4 = 0.5647, T₂ = 666.2 K (hand calculation)', () => {
  const r = otto({ r: 8, T1: 16.85, p1: 100, qin: 800 });
  near(r.eta, 1 - Math.pow(8, -0.4), 1e-9); near(r.eta, 0.5647, 1e-4);
  near(r.S[1].T + 273.15, 666.2, 0.1);
  near(r.wnet, 0.5647 * 800, 0.1);
});

test('Diesel: state-by-state efficiency equals the closed-form 1 − (r_c^k − 1)/(r^(k−1)·k·(r_c − 1))', () => {
  const r = diesel({ r: 18, T1: 27, p1: 100, qin: 1500 });
  near(r.eta, r.etaFormula, 1e-9);
  assert.ok(r.eta < 1 - Math.pow(18, -0.4)); // below Otto at the same r
});

test('Brayton: r_p = 8, T₁ = 300 K, T₃ = 1300 K, η_c 0.80, η_t 0.85 → w_net ≈ 191.7 kJ/kg, η ≈ 0.274 (hand calculation, cold-air standard)', () => {
  const r = brayton({ rp: 8, T1: 26.85, p1: 100, T3: 1026.85, etaC: 0.8, etaT: 0.85, regen: 0 });
  near(r.wnet, 191.7, 0.5); near(r.eta, 0.274, 0.001);
  const ideal = brayton({ rp: 8, T1: 26.85, p1: 100, T3: 1026.85, etaC: 1, etaT: 1, regen: 0 });
  near(ideal.eta, 1 - Math.pow(8, -0.4 / 1.4), 1e-9);
});

test('VALIDATION (Çengel Example 10-1): Rankine 3 MPa / 350 °C, condenser 75 kPa, ideal → η = 26.0 %, x₄ = 0.886, w_pump = 3.03 kJ/kg', () => {
  const r = rankine({ pB: 3000, T1: 350, pC: 75, etaT: 1, etaP: 1, Pnet: 1000 });
  near(r.eta, 0.26, 0.002); near(r.S[1].x!, 0.8861, 0.002); near(r.wp, 3.03, 0.02); near(r.qin, 2728.6, 1.5);
});

test('VALIDATION (Çengel Example 11-1): refrigeration, R-134a between 0.14 and 0.8 MPa, ideal → q_L = 143.7 kJ/kg, COP = 3.97', () => {
  const r = refrigeration({ fluid: 'R134a', Te: tsat('R134a', 140), Tc: tsat('R134a', 800), sh: 0, sc: 0, etaC: 1, QL: 7.18 });
  near(r.qL, 143.7, 0.4); near(r.cop, 3.97, 0.03); near(r.mdot, 0.05, 0.001); near(r.S[1].h, 275.4, 0.5);
});
