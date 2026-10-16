import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLANT_DEFAULTS, analyse, expm, massSpring, fitFopdt, freqGrid, margins, metrics, plantTF, simulate, tuneGains, ultimate, type Ctrl, type PlantSpec,
} from './pid.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const rel = (a: number, b: number, tol: number, msg = '') => near(a / b, 1, tol, msg);
const spec = (o: Partial<PlantSpec>): PlantSpec => ({ ...PLANT_DEFAULTS.first.spec, thetaRatio: 0, ...o });
const P = (Kp: number): Ctrl => ({ type: 'P', Kp, Ti: 1, Td: 0, N: 10 });

test('first order with P control: y(t) = K Kp/(1+K Kp) (1 − e^(−(1+K Kp) t/τ)) and offset 1/(1+K Kp)', () => {
  const p = plantTF(spec({ id: 'first', K: 2, tau: 5 }));
  const sim = simulate(p, P(1.5), { mode: 'setpoint', Tend: 12 });
  const kk = 3, yinf = kk / (1 + kk);
  for (const tt of [1, 3, 6, 12]) {
    const i = Math.round((tt / 12) * 1200);
    near(sim.y[i], yinf * (1 - Math.exp(-((1 + kk) * sim.t[i]) / 5)), 1e-5, `t=${tt}`);
  }
  near(metrics(simulate(p, P(1.5), { mode: 'setpoint', Tend: 60 }), 'setpoint').ess, 1 / (1 + kk), 1e-4);
});

test('integrator with P control: y = 1 − e^(−Kp K t), 10–90 % rise time = ln 9/(Kp K), phase margin 90°, no gain margin', () => {
  const p = plantTF(spec({ id: 'integrator', K: 0.5 }));
  const c = P(2); // Kp K = 1
  const sim = simulate(p, c, { mode: 'setpoint', Tend: 8 });
  near(sim.y[600], 1 - Math.exp(-4), 1e-6);
  near(metrics(simulate(p, c, { mode: 'setpoint', Tend: 25 }), 'setpoint').rise, Math.log(9), 2e-3);
  const m = margins(p, c, freqGrid(p));
  near(m.wgc!, 1, 1e-3); near(m.pm!, 90, 0.05);
  assert.equal(m.gm, null);
});

test('integrator with dead time θ = 1 s, Kp K = 1: ω_gc = 1 rad/s, PM = 90° − 57.3° = 32.7°', () => {
  const p = plantTF(spec({ id: 'integrator', K: 1 }));
  p.theta = 1;
  const m = margins(p, P(1), freqGrid(p));
  near(m.wgc!, 1, 1e-3); near(m.pm!, 90 - 180 / Math.PI, 0.05);
});

test('open-loop step of a second-order plant: overshoot exp(−πζ/√(1−ζ²)) = 16.3 % for ζ = 0.5', () => {
  const p = plantTF(spec({ id: 'second', K: 1, wn: 2, zeta: 0.5 }));
  const sim = simulate(p, null, { mode: 'setpoint', Tend: 12 });
  const peak = Math.max(...sim.y);
  near((peak - 1) * 100, 100 * Math.exp((-Math.PI * 0.5) / Math.sqrt(0.75)), 0.05);
  near(sim.y[sim.y.length - 1], 1, 1e-3);
});

test('ultimate gain of e^(−s)/(s + 1): ω₁₈₀ = 2.0288 rad/s, K_u = √(1+ω²) = 2.2620, P_u = 3.097 s', () => {
  const p = plantTF(spec({ id: 'first', K: 1, tau: 1 }));
  p.theta = 1;
  const u = ultimate(p)!;
  near(u.Ku, 2.262, 2e-3); near(u.Pu, (2 * Math.PI) / 2.0288, 2e-3);
  const m = margins(p, P(1.5), freqGrid(p));
  near(m.gm!, 20 * Math.log10(2.262 / 1.5), 0.02);
});

test('stability boundary: K_p just below K_u is stable, just above is not (simulation agrees with the margins)', () => {
  const s = spec({ id: 'first', K: 1, tau: 1, thetaRatio: 1 });
  const lim = { overshoot: 20, settle: 100 };
  assert.equal(analyse(s, P(2.1), 'setpoint', lim).stable, true);
  assert.equal(analyse(s, P(2.5), 'setpoint', lim).stable, false);
});

test('tangent fit recovers K = 1, T = 10, L = 2 of a first-order plant with dead time', () => {
  const p = plantTF(spec({ id: 'first', K: 1, tau: 10 }));
  p.theta = 2;
  const f = fitFopdt(p);
  rel(f.L, 2, 0.03); rel(f.T, 10, 0.03); rel(f.dc, 1, 1e-12);
});

test('Ziegler–Nichols reaction curve (PID: 1.2 T/(K L), 2 L, 0.5 L) and Cohen–Coon on K = 1, T = 10, L = 2', () => {
  const p = plantTF(spec({ id: 'first', K: 1, tau: 10 }));
  p.theta = 2;
  const z = tuneGains('zn', 'PID', p) as { Kp: number; Ti: number; Td: number };
  rel(z.Kp, 6, 0.04); rel(z.Ti, 4, 0.04); rel(z.Td, 1, 0.04);
  const c = tuneGains('cc', 'PID', p) as { Kp: number; Ti: number; Td: number };
  // Cohen–Coon: Kp = (T/KL)(4/3 + L/4T) = 5 (1.3333 + 0.05), Ti = L (32+6r)/(13+8r), Td = 4L/(11+2r), r = L/T = 0.2
  rel(c.Kp, 5 * (4 / 3 + 0.05), 0.04); rel(c.Ti, (2 * (32 + 1.2)) / (13 + 1.6), 0.04); rel(c.Td, 8 / 11.4, 0.04);
  const pi = tuneGains('zn', 'PI', p) as { Kp: number; Ti: number };
  rel(pi.Kp, 0.9 * 5, 0.04); rel(pi.Ti, 3.33 * 2, 0.04);
});

test('Ziegler–Nichols ultimate gain: PID 0.6 K_u, P_u/2, P_u/8; not available for a plant without −180° crossing', () => {
  const p = plantTF(spec({ id: 'first', K: 1, tau: 1 }));
  p.theta = 1;
  const t = tuneGains('znu', 'PID', p) as { Kp: number; Ti: number; Td: number };
  near(t.Kp, 0.6 * 2.262, 0.01); near(t.Ti, 3.097 / 2, 0.01); near(t.Td, 3.097 / 8, 0.01);
  const na = tuneGains('znu', 'PI', plantTF(spec({ id: 'first', K: 1, tau: 1 })));
  assert.ok('na' in na);
});

test('DC motor: DC gain K_t/(b R + K_t²), poles are the roots of J L s² + (J R + b L) s + b R + K_t²', () => {
  const p = plantTF(PLANT_DEFAULTS.motor.spec);
  rel(p.dc, 0.1 / (0.001 * 1 + 0.01), 1e-12);
  for (const [re] of p.poles) near(p.a2 * re * re + p.a1 * re + p.a0, 0, 1e-6);
  assert.ok(p.T0 > 0.4 && p.T0 < 0.6, `T0 = ${p.T0}`);
});

test('PI control removes the offset; load disturbance on a plant with integral action returns to zero', () => {
  const lim = { overshoot: 50, settle: 1000 };
  const a = analyse(PLANT_DEFAULTS.first.spec, PLANT_DEFAULTS.first.ctrl, 'setpoint', lim);
  near(a.met.yf, 1, 2e-3); assert.ok(a.stable && a.met.settled);
  const d = analyse(PLANT_DEFAULTS.first.spec, PLANT_DEFAULTS.first.ctrl, 'disturbance', lim);
  near(d.met.yf, 0, 2e-3); assert.ok(d.met.peak > 0.1);
});

test('default settings of every plant give a stable, settled loop with reasonable margins', () => {
  for (const id of ['first', 'second', 'integrator', 'motor'] as const) {
    const d = PLANT_DEFAULTS[id];
    const a = analyse(d.spec, d.ctrl, 'setpoint', { overshoot: 30, settle: d.tLimit });
    assert.ok(a.stable && a.met.settled, `${id} stable/settled`);
    assert.ok(a.mar.pm === null || a.mar.pm > 30, `${id} PM ${a.mar.pm}`);
    assert.ok(a.met.overshoot < 40, `${id} overshoot ${a.met.overshoot}`);
  }
});

test('mass–spring–damper: m = 1 kg, k = 4 N/m, c = 1.6 N·s/m, K_a = 4 N → ω_n = 2 rad/s, ζ = 0.4, K = 1 (the default second-order plant)', () => {
  const r = massSpring(1, 1.6, 4, 4);
  near(r.wn, 2, 1e-12); near(r.zeta, 0.4, 1e-12); near(r.K, 1, 1e-12);
  const p = plantTF(spec({ id: 'second', ...r }));
  for (const [re] of p.poles) near(re, -0.8, 1e-9); // −ζω_n
  rel(p.dc, 1, 1e-12);
});

test('matrix exponential: rotation exp([[0, −1], [1, 0]]·π/2) and a stiff diagonal exp(−10⁴) → 0 without overflow', () => {
  const R = expm([[0, -Math.PI / 2], [Math.PI / 2, 0]]);
  near(R[0][0], 0, 1e-12); near(R[1][0], 1, 1e-12);
  const D = expm([[-1e4, 0], [0, -1]]);
  near(D[0][0], 0, 1e-12); near(D[1][1], Math.exp(-1), 1e-12);
});

test('stiff loops stay finite: motor with L/R = 4 ms and J/b = 10⁴ s, PID with T_d/N = 10⁻⁴ s on a slow tank', () => {
  const lim = { overshoot: 50, settle: 1e6 };
  const m = analyse({ ...PLANT_DEFAULTS.motor.spec, Rm: 9.6, Lm: 0.0366, J: 0.282, b: 2.6e-5, Kt: 0.0127 }, { type: 'PI', Kp: 0.0277, Ti: 0.023, Td: 1, N: 10 }, 'setpoint', lim);
  assert.ok(m.sim.y.every(Number.isFinite) && m.sim.u.every(Number.isFinite));
  const f = analyse({ ...PLANT_DEFAULTS.first.spec, K: 2, tau: 60, thetaRatio: 0 }, { type: 'PID', Kp: 1, Ti: 30, Td: 0.001, N: 10 }, 'setpoint', lim);
  assert.ok(f.sim.y.every(Number.isFinite) && !f.met.unstable);
  near(f.met.yf, 1, 2e-3);
});
