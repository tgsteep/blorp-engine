import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossGrid, effectiveness, fBowman, lmtd, ntuFor, rateHx, sizeHx, type HxType } from './hx.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const rel = (a: number, b: number, tol: number, msg = '') => near(a / b, 1, tol, msg);

test('VALIDATION (Incropera Example 11.1): oil 0.1 kg/s 100 → 60 °C cooled by water 0.2 kg/s from 30 °C, U = 38.1 W/m²K, counterflow, D = 25 mm → T_c,o = 40.2 °C, ΔT_lm = 43.2 K, L = 65.9 m', () => {
  const hot = { m: 0.1, cp: 2131, Tin: 100 }, cold = { m: 0.2, cp: 4178, Tin: 30 };
  const s = sizeHx('counter', hot, cold, 38.1, 60, 0.025);
  near(s.Q, 8524, 1);
  near(s.TcOut, 40.2, 0.05);
  near(lmtd(100 - s.TcOut, 60 - 30), 43.2, 0.1);
  near(s.L!, 65.9, 0.3);
  // rating with that area gives back the outlet temperatures
  const r = rateHx({ type: 'counter', hot, cold, U: 38.1, A: s.A! });
  near(r.ThOut, 60, 1e-6); near(r.TcOut, 40.2, 0.05);
  near(r.Q, 38.1 * s.A! * r.dTlm, 1e-6, 'Q = U A ΔT_lm in counterflow');
});

test('ε-NTU limits: C_r = 0 gives 1 − e^(−NTU) for every arrangement; counterflow with C_r = 1 gives NTU/(1+NTU); parallel flow tends to 1/(1+C_r)', () => {
  for (const t of ['counter', 'parallel', 'shell', 'cross'] as HxType[]) near(effectiveness(t, 1.5, 1e-12), 1 - Math.exp(-1.5), 1e-6, t);
  near(effectiveness('counter', 2, 1), 2 / 3, 1e-9);
  near(effectiveness('parallel', 50, 0.5), 1 / 1.5, 1e-9);
  near(ntuFor('counter', effectiveness('counter', 1.7, 0.6), 0.6)!, 1.7, 1e-6);
  assert.equal(ntuFor('parallel', 0.7, 0.5), null, 'parallel flow cannot reach ε = 0.7 at C_r = 0.5');
});

test('profiles: integrated energy balances end at the ε-NTU outlet temperatures (counterflow, parallel flow, two-pass shell by shooting)', () => {
  const base = { hot: { m: 0.5, cp: 4180, Tin: 90 }, cold: { m: 0.8, cp: 4180, Tin: 15 }, U: 1000, A: 8 };
  for (const type of ['counter', 'parallel', 'shell'] as HxType[]) {
    const r = rateHx({ ...base, type });
    const hot = r.profile.lines.find((l) => l.id === 'hot')!.T;
    near(hot[hot.length - 1], r.ThOut, 0.02, `${type} hot outlet`);
    if (type === 'counter') near(r.profile.lines[1].T[0], r.TcOut, 1e-9);
    if (type === 'parallel') near(r.profile.lines[1].T[100], r.TcOut, 0.02);
    if (type === 'shell') near(r.profile.lines.find((l) => l.id === 'pass2')!.T[0], r.TcOut, 0.02, 'shell tube outlet');
  }
});

test('shell-and-tube F from ε-NTU equals Bowman’s formula; cross-flow grid agrees with the exact series within 0.2 %', () => {
  const p = { type: 'shell' as const, hot: { m: 1, cp: 2100, Tin: 150 }, cold: { m: 1.2, cp: 4180, Tin: 20 }, U: 400, A: 20 };
  const r = rateHx(p);
  const P = (r.TcOut - 20) / (150 - 20), R = (150 - r.ThOut) / (r.TcOut - 20);
  near(r.F, fBowman(P, R), 1e-6);
  const hot = { m: 0.3, cp: 1007, Tin: 120 }, cold = { m: 0.4, cp: 1007, Tin: 10 };
  for (const UA of [150, 400, 900]) {
    const g = crossGrid(hot, cold, UA, 60);
    const Cmin = 0.3 * 1007, Cr = Cmin / (0.4 * 1007);
    const epsGrid = (120 - g.ThOut) / (120 - 10);
    rel(epsGrid, effectiveness('cross', UA / Cmin, Cr), 0.002, `UA ${UA}`);
  }
});
