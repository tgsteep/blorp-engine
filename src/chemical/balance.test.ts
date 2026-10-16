import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaporator, mixer, steam } from './balance.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);

test('VALIDATION (Geankoplis, Transport Processes, Example 8.4-1): single-effect evaporator', () => {
  // 9072 kg/h, 1.0 → 1.5 wt %, feed 311.0 K, body 101.325 kPa, steam 143.3 kPa (383.2 K), U 1704 W/(m² K), c_p 4.14 kJ/(kg K)
  const r = evaporator({ F: 9072, xF: 0.01, TF: 311 - 273.15, xP: 0.015, P1: 101.325, bpr: 0, ps: 143.3, U: 1704, cp: 4.14 });
  near(r.L, 6048, 0.5, 'L'); near(r.V, 3024, 0.5, 'V');
  near(r.T1, 100, 0.05, 'boiling at 373.2 K'); near(r.ss.T + 273.15, 383.2, 0.1, 'steam temperature');
  near(r.lam1, 2257, 2, 'λ at 373.2 K'); near(r.ss.lambda, 2230, 2, 'λ of the steam');
  near(r.A, 149.3, 0.5, 'area');
  assert.ok(r.checks.every((c) => c.ok));
});

test('mixer: mass, solute and enthalpy balances; heater steam', () => {
  const r = mixer({ m1: 1000, x1: 0.2, T1: 80, m2: 3000, x2: 0, T2: 20, cp: 4.18, Tt: 60, ps: 300 });
  near(r.m3, 4000, 1e-9); near(r.x3, 0.05, 1e-12); near(r.T3, 35, 1e-12);
  near(r.Q, (4000 * 4.18 * 25) / 3600, 1e-9, 'heater duty');
  near(r.ms, (r.Q * 3600) / steam(300).lambda, 1e-9); near(steam(300).T, 133.5, 0.2, 'steam at 3 bar abs');
  // the enthalpy balance closes: in + heat = out
  near(1000 * 4.18 * 80 + 3000 * 4.18 * 20 + r.Q * 3600, 4000 * 4.18 * 60, 1e-6);
});

test('evaporator checks fail for nonphysical inputs instead of passing a negative area or a flashing feed', () => {
  const base = { F: 9072, xF: 0.01, TF: 37.85, xP: 0.015, P1: 101.325, bpr: 0, ps: 143.3, U: 1704, cp: 4.14 };
  const area = (r: ReturnType<typeof evaporator>) => r.checks.find((c) => c.label.startsWith('Heating area'))!;
  const flash = (r: ReturnType<typeof evaporator>) => r.checks.find((c) => c.label.startsWith('Feed not hotter'))!;
  const cold = evaporator({ ...base, ps: 100 }); // steam colder than the boiling liquid
  assert.ok(cold.dT < 0 && cold.A < 0);
  assert.equal(area(cold).ok, false);
  const hot = evaporator({ ...base, TF: 120, P1: 5 }); // feed above the boiling point at 5 kPa
  assert.ok(hot.qSens < 0);
  assert.equal(flash(hot).ok, false);
  assert.ok(flash(evaporator(base)).ok && area(evaporator(base)).ok);
});
