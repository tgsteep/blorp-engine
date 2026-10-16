import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GROUPS, groupsOf, inhourOmega, kinetics, rodS, rodX, simulate, type KinIn } from './kinetics.ts';

const near = (a: number, b: number, rel: number, msg = '') => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg} ${a} vs ${b}`);
const base: KinIn = { reactor: 'pwr', event: 'step', rho: 100, rate: 10, scram: -6000, p0: 1e-4, alpha: -2.5, feedback: false, trip: false, window: 200 };

test('Keepin six-group yields add up to one', () => {
  for (const g of Object.values(GROUPS)) near(g.a.reduce((s, x) => s + x, 0), 1, 0.002);
});

test('Inhour equation: root satisfies it; prompt critical limit ω → (ρ − β)/Λ', () => {
  const { b, lam, Lambda, beta } = groupsOf('pwr');
  for (const rho of [-0.003, 0.0005, 0.002, 0.006]) { const w = inhourOmega(rho, b, lam, Lambda); near(w * Lambda + b.reduce((s, bi, i) => s + (bi * w) / (w + lam[i]), 0), rho, 1e-6, 'residual'); }
  const rho = beta + 0.005; near(inhourOmega(rho, b, lam, Lambda), (rho - beta) / Lambda, 0.02, 'prompt');
});

test('Simulation: steady at ρ = 0, prompt jump β/(β − ρ), then the inhour period', () => {
  const s0 = simulate({ ...base, rho: 0 }); near(s0.final, base.p0, 1e-9, 'steady');
  const { b, lam, Lambda, beta } = groupsOf('pwr'), rho = 100e-5;
  const s = simulate(base);
  const i = s.t.findIndex((x) => x >= 0.05); near(s.p[i] / base.p0, beta / (beta - rho), 0.03, 'prompt jump');
  const T = 1 / inhourOmega(rho, b, lam, Lambda);
  const i1 = s.t.findIndex((x) => x >= 150), i2 = s.t.length - 1;
  near((s.t[i2] - s.t[i1]) / Math.log(s.p[i2] / s.p[i1]), T, 0.02, 'period');
});

test('Feedback: the power settles where the temperature feedback cancels the step', () => {
  const p: KinIn = { ...base, p0: 0.5, feedback: true, rho: 50, window: 300 };
  const r = kinetics(p); near(r.sim.final, r.pFinalEq, 0.01, 'final power');
});

test('Scram: prompt drop then slow decay; rod S-curve inverse', () => {
  const r = kinetics({ ...base, event: 'scram', p0: 1, window: 60, feedback: true });
  assert.ok(r.sim.final < 0.05, `${r.sim.final}`);
  for (const x of [0.1, 0.5, 0.83]) near(rodX(rodS(x)), x, 1e-6);
});

test('TRIGA pulse: $2 gives a millisecond spike limited by the fuel coefficient', () => {
  const r = kinetics({ ...base, reactor: 'triga', rho: 1400, p0: 1e-6, feedback: true, window: 0.5 });
  assert.ok(r.sim.peak > 100 && r.sim.tPeak < 0.2, `${r.sim.peak} at ${r.sim.tPeak}`);
  assert.ok(r.sim.final < r.sim.peak / 10);
});
