import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAxial } from './axial.ts';
import { computeShear } from './shear.ts';
import { THREADS } from './data.ts';

const near = (a: number, b: number, tol: number, msg = '') =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const M12 = THREADS.find((t) => t.name === 'M12')!;
const base = { thread: M12, pc: '10.9' as const, mu: 0.12, alphaA: 1.6, lk: 40, DA: 36, FA: 15000, FKerf: 2000 };

test('assembly preload M12 10.9, μ 0.12, ν 0.9 ≈ 63.3 kN (VDI 2230 table value 63.4 kN)', () => {
  near(computeAxial(base).FMzul / 1000, 63.4, 0.5);
});

test('preload scales with yield: 8.8 / 10.9 = 640 / 940', () => {
  const a = computeAxial({ ...base, pc: '8.8' }).FMzul, b = computeAxial(base).FMzul;
  near(a / b, 640 / 940, 1e-9);
});

test('load split: F_SA + F_PA = F_A and 0 < Φ_n < n', () => {
  const r = computeAxial(base);
  near(r.FSA + r.FPA, 15000, 1e-6);
  assert.ok(r.Phi > 0 && r.Phi < 0.5);
});

test('clevis: M_max = F(t_S + 2t_G)/8 matches integrated moment, V_max = F/2', () => {
  const r = computeShear({ d: 12, F: 10000, tS: 15, tG: 10, Rp: 940, ReP: 235, S: 1.5 });
  near(r.Mmax, 43750, 1e-9);
  near(Math.max(...r.Ms), 43750, 1);
  near(Math.max(...r.Vs), 5000, 1e-9);
  near(r.Ms[0], 0, 1e-9);
  near(r.Ms[r.Ms.length - 1], 0, 1e-9);
});

test('bracket: textbook check — 4 bolts square, P at e: F_max = |direct + moment| vector sum', async () => {
  const { computeBracket } = await import('./joints.ts');
  // 2×2 group, p = g = 100 → r = 70.71, Σr² = 20000; P = 10 kN, e = 200 → M = 2e6 N·mm
  const r = computeBracket({ thread: M12, pc: '8.8', mu: 0.12, alphaA: 1.6, S: 1.5, ReP: 235, rows: 2, cols: 2, p: 100, g: 100, P: 10000, e: 200, t: 10 });
  // secondary = 2e6·70.71/20000 = 7071 N at 45°; direct 2500 N down; worst bolt (right side): |(−5000, −2500−5000)| = 9014 N
  near(r.Fmax, Math.hypot(5000, 7500), 1e-6);
});

test('lap: V and M antisymmetric, |M| max = F_b·t/2 at head and nut, zero at the shear plane', async () => {
  const { computeLap } = await import('./joints.ts');
  const r = computeLap({ thread: M12, pc: '8.8', mu: 0.12, alphaA: 1.6, S: 1.5, ReP: 235, n: 2, t: 10, FQ: 10000, muT: 0.2 });
  near(r.Ms[0], -25000, 1e-6);
  near(r.Ms[r.Ms.length - 1], 25000, 1e-6);
  near(r.Ms[r.xs.indexOf(10)], 0, 1e-6);
});
