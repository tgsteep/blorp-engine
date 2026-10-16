import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AC_PRESETS, dcMotor, induction } from './motors.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);

test('DC motor, U 24 V, R 1 Ω, k 0.1, T_f 0.02, T_L 0.5 N·m → I 5.2 A, ω 188 rad/s, η 75.3 % (hand calculation)', () => {
  const r = dcMotor({ U: 24, R: 1, k: 0.1, Tf: 0.02, TL: 0.5 });
  near(r.op.I, 5.2, 1e-9);
  near(r.op.w, 188, 1e-9);
  near(r.op.Pout, 94, 1e-9);
  near(r.op.eta, 94 / (24 * 5.2), 1e-12);
  near(r.Is, 24, 1e-12);
  near(r.Ts, 0.1 * (24 - 0.2), 1e-12); // 2.38 N·m
  near(r.n0, ((24 - 0.2) / 0.1) * 60 / (2 * Math.PI), 1e-9);
});

test('DC motor: maximum efficiency (1 − √(I₀/I_s))² is the true maximum of η(T)', () => {
  const r = dcMotor({ U: 24, R: 1, k: 0.1, Tf: 0.02, TL: 0.5 });
  let best = 0;
  for (let T = 0; T < r.Ts; T += r.Ts / 2000) best = Math.max(best, r.at(T).eta);
  near(best, r.etaMax, 1e-3);
});

test('VALIDATION (Chapman, Electric Machinery Fundamentals, 25 hp example): induction motor s_max 0.198, T_max ≈ 229 N·m, T_start ≈ 104 N·m (published answers)', () => {
  const p = AC_PRESETS.chap;
  const r = induction({ ...p, load: 'constant', TL: 100 });
  near(r.ns, 1800, 1e-9);
  near(r.sMax, 0.198, 0.004);
  near(r.Tmax, 229, 229 * 0.02);
  near(r.Tstart, 104, 104 * 0.03);
});

test('induction operating point: motor torque equals load torque; fan load gives less slip than constant load', () => {
  const p = AC_PRESETS.tr75;
  const c = induction({ ...p, load: 'constant', TL: 49 }), fan = induction({ ...p, load: 'fan', TL: 49 });
  assert.ok(c.op && fan.op);
  near(c.op!.T, 49, 1e-3);
  assert.ok(fan.op!.s < c.op!.s);
  near(c.op!.Pag * c.op!.s + c.op!.Pconv, c.op!.Pag, 1e-6); // P_ag = P_rotor-copper + P_conv
  assert.ok(c.op!.n > 1400 && c.op!.n < 1500, `n ${c.op!.n}`);
});
