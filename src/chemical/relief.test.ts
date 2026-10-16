import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criticalRatio, gasC, P_ATM, relief, type ReliefIn } from './relief.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const base: ReliefIn = { service: 'gas', flow: 10000, pSet: 1000, over: 0.1, pBack: 0, T: 20, M: 28.96, k: 1.4, Z: 1, G: 1, mu: 1, disk: false };

test('gas coefficient C(k = 1.4) = 0.0270 (API 520 table, SI) and critical ratio 0.528', () => {
  near(gasC(1.4), 0.02703, 0.00002);
  near(criticalRatio(1.4), 0.5283, 0.0001);
});

test('air 10 000 kg/h, set 10 bar g, 10 % over, 20 °C → A ≈ 1005 mm², orifice K (hand calculation)', () => {
  const r = relief(base);
  const P1 = 1100 + P_ATM;
  near(r.A, (10000 / (gasC(1.4) * 0.975 * P1)) * Math.sqrt(293.15 / 28.96), 1e-6);
  near(r.A, 1005, 3);
  assert.equal(r.orifice?.letter, 'K');
});

test('subcritical equation meets the critical one at the critical pressure ratio (continuity)', () => {
  const P1 = 1100 + P_ATM, rc = criticalRatio(1.4);
  const crit = relief({ ...base, pBack: 0 }).A;
  const sub = relief({ ...base, pBack: rc * P1 * 1.0001 - P_ATM }).A;
  near(sub / crit, 1, 0.01);
});

test('saturated steam 10 000 kg/h, set 10 bar g, 10 % → A = 190.5·W/(P1·K_d) ≈ 1626 mm², orifice L', () => {
  const r = relief({ ...base, service: 'steam' });
  near(r.A, (190.5 * 10000) / ((1100 + P_ATM) * 0.975), 1e-6);
  near(r.A, 1626, 2);
  assert.equal(r.orifice?.letter, 'L');
});

test('water 1000 L/min, set 10 bar g, 10 % → A = 11.78·Q/K_d·√(G/Δp) ≈ 546 mm², K_v = 1, orifice J', () => {
  const r = relief({ ...base, service: 'liquid', flow: 1000 });
  near(r.A, ((11.78 * 1000) / 0.65) * Math.sqrt(1 / 1100), 1e-6);
  near(r.A, 546.4, 0.5);
  assert.equal(r.orifice?.letter, 'J');
});

test('capacity use = A_req / A_orifice; a small flow in a big orifice fails the chatter check', () => {
  const r = relief(base); // 1005 mm² in K (1186 mm²)
  near(r.used, r.A / 1186, 1e-9);
  assert.ok(r.checks.find((c) => c.label.includes('chatter'))!.ok);
  // 10 kg/h of air needs well under 1 mm² — even orifice D is far too big, and A is below the smallest orifice
  const s = relief({ ...base, flow: 10 });
  assert.equal(s.orifice?.letter, 'D');
  assert.ok(s.used < 0.25 && !s.checks.find((c) => c.label.includes('chatter'))!.ok);
});

test('back pressure at or above the relieving pressure: no flow, a failing check, no NaN orifice choice', () => {
  for (const service of ['gas', 'liquid'] as const) {
    const r = relief({ ...base, service, pBack: 1500 }); // set 10 bar g, relieving 11 bar g
    assert.equal(r.noFlow, true);
    assert.equal(r.orifice, undefined);
    assert.equal(r.nValves, 0);
    assert.equal(r.checks[0].ok, false);
    assert.ok(r.checks[0].label.startsWith('Back pressure below the relieving pressure'));
  }
  assert.equal(relief({ ...base, pBack: 50 }).noFlow, false);
});
