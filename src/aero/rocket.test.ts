import { test } from 'node:test';
import assert from 'node:assert/strict';
import { burnProfile, G0, optimalStaging, rocket, structMass } from './rocket.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);

test('single stage, hand calculation: I_sp 300 s, m_p 20 t, ε 0.08, payload 1 t → m_s 1739.1 kg, m₀ 22 739 kg, Δv = 2942.0·ln 8.3016 = 6226.6 m/s', () => {
  near(structMass(20000, 0.08), 1739.13, 0.01);
  const r = rocket({ stages: [{ prop: 'kerolox', isp: 300, mp: 20000, eps: 0.08 }], payload: 1000, tw: 1.3, target: 9400 });
  near(r.m0, 22739.13, 0.01);
  near(r.stages[0].R, 8.30159, 1e-4);
  near(r.dv, 6226.6, 0.2);
  near(r.stages[0].dvMax, 300 * G0 * Math.log(1 / 0.08), 1e-9, 'limit v_e ln(1/ε)');
  // burn time t_b = m_p v_e/(T/W·m₀·g₀) = 20000·2941.995/(1.3·22739.13·9.80665) = 202.97 s
  near(r.stages[0].tb, 202.97, 0.01);
  assert.equal(r.checks[0].ok, false, 'one stage cannot reach LEO');
});

test('two stages beat one stage with the same propellant and structure ratio', () => {
  const one = rocket({ stages: [{ prop: 'kerolox', isp: 311, mp: 100000, eps: 0.07 }], payload: 2000, tw: 1.3, target: 0 });
  const two = rocket({ stages: [{ prop: 'kerolox', isp: 311, mp: 80000, eps: 0.07 }, { prop: 'kerolox', isp: 311, mp: 20000, eps: 0.07 }], payload: 2000, tw: 1.3, target: 0 });
  near(one.m0, two.m0, 1e-6);
  assert.ok(two.dv > one.dv * 1.2, `${two.dv} vs ${one.dv}`);
  near(two.dv, two.stages[0].dv + two.stages[1].dv, 1e-9);
  near(two.stages[0].m0, two.stages[1].m0 + 80000 + structMass(80000, 0.07), 1e-6);
});

test('burn profile ends at the sum of stage Δv; vertical flight loses g₀·t_b', () => {
  const r = rocket({ stages: [{ prop: 'kerolox', isp: 300, mp: 300000, eps: 0.06 }, { prop: 'kerolox', isp: 345, mp: 75000, eps: 0.07 }], payload: 10000, tw: 1.3, target: 9400 });
  const p = burnProfile(r);
  near(p.v[p.v.length - 1], r.dv, 1e-6);
  near(p.t[p.t.length - 1], r.tb, 1e-9);
  near(p.v[p.v.length - 1] - p.vg[p.vg.length - 1], r.gravLoss, 1e-6);
  near(p.m[p.m.length - 1], r.stages[1].mf, 1e-6);
});

test('optimal staging, identical stages: equal mass ratios n = e^(Δv/(N v_e)) (analytical)', () => {
  const ve = 3000, eps = 0.1, dv = 7000;
  const o = optimalStaging([ve, ve, ve], [eps, eps, eps], dv, 1000)!;
  for (const n of o.n) near(n, Math.exp(dv / (3 * ve)), 1e-9);
  // rebuilding the rocket from the optimum gives the target Δv
  const r = rocket({ stages: o.mp.map((mp) => ({ prop: 'kerolox' as const, isp: ve / G0, mp, eps })), payload: 1000, tw: 1.3, target: dv });
  near(r.dv, dv, 1e-6);
  near(r.m0, o.m0, 1e-6);
  assert.equal(optimalStaging([ve], [eps], ve * Math.log(1 / eps) + 1, 1000), null, 'beyond the limit');
});

test('optimal staging cross-check: published Lagrange solution, Δv 10.42 km/s, v_e 3.7/3.7/4.2 km/s, ε 0.08/0.09/0.10, payload 1000 kg → m_p 13 573.73 / 4557.19 / 2360.85 kg, m_s 1180.32 / 450.71 / 262.32 kg', () => {
  const o = optimalStaging([3700, 3700, 4200], [0.08, 0.09, 0.1], 10420, 1000)!;
  [13573.73, 4557.19, 2360.85].forEach((v, i) => near(o.mp[i], v, 0.05, `m_p${i + 1}`));
  [1180.32, 450.71, 262.32].forEach((v, i) => near(o.ms[i], v, 0.01, `m_s${i + 1}`));
  [2.38, 2.12, 2.87].forEach((v, i) => near(o.n[i], v, 0.005, `n${i + 1}`));
});
