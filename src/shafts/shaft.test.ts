import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beam, rayleigh, DETAILS, E_STEEL, enduranceLimit, goodmanDE, kaMachined, kbSize, shaft, SHAFT_MATERIALS } from './shaft.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const rel = (a: number, b: number, r: number, msg = '') => near(a, b, Math.abs(b) * r, msg);

test('simply supported point load: reactions, deflection P·a²b²/(3EIL), end slopes P·b(L²−b²)/(6EIL) and P·a(L²−a²)/(6EIL)', () => {
  const L = 300, a = 100, b = 200, P = 5000, EI = E_STEEL * (Math.PI * 40 ** 4) / 64;
  const r = beam(L, L, EI, { points: [[a, P]] }, 600);
  rel(r.RA, (P * b) / L, 1e-9); rel(r.RB, (P * a) / L, 1e-9);
  const iA = Math.round((a / L) * 600);
  rel(r.y[iA], (P * a * a * b * b) / (3 * EI * L), 2e-4, 'y(a)');
  rel(Math.abs(r.slope[0]), (P * b * (L * L - b * b)) / (6 * EI * L), 2e-3, 'θA');
  rel(Math.abs(r.slope[600]), (P * a * (L * L - a * a)) / (6 * EI * L), 2e-3, 'θB');
  rel(Math.max(...r.M), (P * a * b) / L, 1e-9, 'M max');
});

test('overhung load at distance c past B: tip deflection P·c²(L + c)/(3EI), reaction R_A pulls the other way', () => {
  const L = 200, c = 80, P = 2000, EI = E_STEEL * (Math.PI * 30 ** 4) / 64;
  const r = beam(L, L + c, EI, { points: [[L + c, P]] }, 560);
  rel(r.y[560], (P * c * c * (L + c)) / (3 * EI), 2e-3);
  rel(r.RA, -(P * c) / L, 1e-9);
  rel(Math.min(...r.M), -P * c, 1e-9);
});

test('VALIDATION (Shigley Examples 6-3, 6-4, 7-1): Marin factors k_a(520 MPa, machined) = 0.860 (Ex. 6-3), k_b(32 mm) = 0.856 (Ex. 6-4), k_a(735) = 0.787, k_b(28) = 0.870 (Ex. 7-1)', () => {
  near(kaMachined(520), 0.86, 0.003);
  near(kbSize(32), 0.856, 0.002);
  near(kaMachined(735), 0.787, 0.004);
  near(kbSize(28), 0.870, 0.003);
  near(enduranceLimit(735, 28), 0.787 * 0.870 * 0.814 * 367.5, 1.5);
});

test('DE-Goodman with the Shigley Ex. 7-1 inputs (d 28 mm, M_a 142.4 N·m, T_m 124.3 N·m, K_f 1.58, K_fs 1.39, S_e 205, S_ut 735) → n = 1.656 (hand calculation)', () => {
  near(goodmanDE(28, 142.4e3, 0, 0, 124.3e3, 1.58, 1.39, 205, 735), 1.656, 0.002);
});

test('critical speed: Rayleigh for a uniform shaft on two supports is within 1 % of π²·√(EI/(m′L⁴)); disc on a light shaft → √(g/y_st)', () => {
  const d = 40, L = 1500, c45 = SHAFT_MATERIALS[2];
  const EImm = E_STEEL * (Math.PI * d ** 4) / 64, q = 7.85e-6 * (Math.PI * d * d) / 4 * 9.81;
  const EI = E_STEEL * 1e6 * (Math.PI * (d / 1000) ** 4) / 64, mp = 7850 * (Math.PI * (d / 1000) ** 2) / 4, Lm = L / 1000;
  rel(rayleigh(L, L, EImm, q, []), Math.PI ** 2 * Math.sqrt(EI / (mp * Lm ** 4)), 0.01, 'uniform shaft');
  // heavy disc at mid-span dominates: n_c ≈ (60/2π)·√(g/y_st), y_st = W·L³/(48EI)
  const r2 = shaft({ P: 0.001, n: 100, L: 400, a: 200, d: 30, D: 200, kind: 'gear', mElem: 200, mat: c45, detail: DETAILS[0] });
  const EI2 = E_STEEL * (Math.PI * 30 ** 4) / 64, yst = (200 * 9.81 * 400 ** 3) / (48 * EI2);
  rel(r2.nCrit, (Math.sqrt(9810 / yst) * 60) / (2 * Math.PI), 0.03, 'disc');
});

test('shaft: torque T = 9549·P/n, gear load F = F_t/cos 20°, keyseat lowers the fatigue safety, overhang raises the bearing load', () => {
  const base = { P: 5.5, n: 1450, L: 250, a: 125, d: 35, D: 120, kind: 'gear' as const, mElem: 3, mat: SHAFT_MATERIALS[2], detail: DETAILS[0] };
  const r = shaft(base);
  rel(r.T, 9549.3 * 5.5 / 1450 * 1000, 1e-9);
  rel(r.F, (2 * r.T) / 120 / Math.cos((20 * Math.PI) / 180), 1e-9);
  near(r.RA + r.RB, r.F, 1e-6);
  const key = shaft({ ...base, detail: DETAILS[3] });
  assert.ok(key.nf < r.nf);
  const over = shaft({ ...base, a: 320 });
  assert.ok(over.RB > over.F && over.RA < 0);
});
