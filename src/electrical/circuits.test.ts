import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveCircuit } from './circuits.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const base = { E: 12, r: 0, R1: 4, R2: 6, R3: 3, Prated: 50 };

test('mixed: R1 4 Ω + (6 ∥ 3) Ω on 12 V → R = 6 Ω, I = 2 A, U1 = 8 V, U23 = 4 V, I2 = 0.667 A, I3 = 1.333 A (hand calculation)', () => {
  const r = solveCircuit({ ...base, topo: 'mixed' });
  near(r.Rext, 6, 1e-12); near(r.I, 2, 1e-12); near(r.V[0], 8, 1e-12); near(r.V[1], 4, 1e-12);
  near(r.Ib[1], 2 / 3, 1e-12); near(r.Ib[2], 4 / 3, 1e-12);
  near(r.kcl, 0, 1e-12); near(r.kvl, 0, 1e-12);
});

test('series: 4 + 6 + 3 = 13 Ω, I = 12/13 A; voltages split in proportion to R', () => {
  const r = solveCircuit({ ...base, topo: 'series' });
  near(r.I, 12 / 13, 1e-12);
  near(r.V[1] / r.V[0], 6 / 4, 1e-12);
});

test('parallel: 1/R = 1/4 + 1/6 + 1/3 → R = 4/3 Ω, I = 9 A, branch currents 3, 2, 4 A', () => {
  const r = solveCircuit({ ...base, topo: 'parallel' });
  near(r.Rext, 4 / 3, 1e-12); near(r.I, 9, 1e-12);
  near(r.Ib[0], 3, 1e-12); near(r.Ib[1], 2, 1e-12); near(r.Ib[2], 4, 1e-12);
});

test('internal resistance: E 12 V, r 1 Ω, load 5 Ω → I = 2 A, terminal voltage 10 V; power balance E·I = ΣP + I²r', () => {
  const r = solveCircuit({ E: 12, r: 1, R1: 5, R2: 0, R3: 0, topo: 'series', Prated: 50 });
  near(r.I, 2, 1e-6); near(r.Uterm, 10, 1e-5);
  near(r.Ptot, r.P.reduce((a, b) => a + b, 0) + r.Pint, 1e-6);
});
