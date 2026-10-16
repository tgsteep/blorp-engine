import { test } from 'node:test';
import assert from 'node:assert/strict';
import { G } from './pipe.ts';
import {
  combinedHead, npshAvailable, npshRequired, operatingFlow, operatingPoint, pumpChecks, pumpCoeffs, pumpEta, pumpHead,
  speedForFlow, systemHead, throttlingVsSpeed, vapourPressure, type Pump, type System,
} from './pump.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const rel = (a: number, b: number, tol: number, msg = '') => near(a / b, 1, tol, msg);

const pump: Pump = { H0: 43, Qd: 0.02, Hd: 30, Qmax: 0.04, etaMax: 0.75, NPSHrd: 3 };
const rho = 998.2, mu = 1.002e-3;
// K-only pipe: H_sys = H_s + K v²/2g exactly (no friction term, so the crossing has a closed form)
const kSys = (Hs: number): System => ({ rho, mu, Hs, pipe: { D: 0.1, L: 0, eps: 0, K: 10 } });
const suc = { pAbs: 101325, T: 20, zs: 2, hLossD: 0.5 };

test('pump curve passes through shutoff, duty and run-out points', () => {
  near(pumpHead(pump, 0), 43, 1e-9); near(pumpHead(pump, 0.02), 30, 1e-9); near(pumpHead(pump, 0.04), 0, 1e-9);
  assert.equal(pumpHead(pump, 0.05), 0);
  assert.ok(pumpCoeffs(pump).stable);
  assert.ok(!pumpCoeffs({ ...pump, H0: 33 }).stable); // shallow shutoff makes the quadratic rise first
});

test('efficiency peaks at the duty point and vanishes at 0 and 2·Q_d', () => {
  near(pumpEta(pump, 0.02), 0.75, 1e-12); near(pumpEta(pump, 0), 0, 1e-12); near(pumpEta(pump, 0.04), 0, 1e-12);
  near(pumpEta(pump, 0.01), 0.75 * 0.75, 1e-12);
});

test('affinity laws: Q ∝ r, H ∝ r², same efficiency at similar points, NPSHr ∝ r²', () => {
  const r = 0.8;
  near(pumpHead(pump, 0.015 * r, r), r * r * pumpHead(pump, 0.015), 1e-9);
  near(pumpEta(pump, 0.015 * r, r), pumpEta(pump, 0.015), 1e-12);
  near(npshRequired(pump, 0.02 * r, r), r * r * 3, 1e-9);
});

test('parallel adds flows at equal head, series adds heads at equal flow', () => {
  const par = { mode: 'parallel' as const, n: 2 }, ser = { mode: 'series' as const, n: 2 };
  near(combinedHead(pump, par, 0.03), pumpHead(pump, 0.015), 1e-12);
  near(combinedHead(pump, ser, 0.02), 2 * pumpHead(pump, 0.02), 1e-12);
});

test('operating point equals the closed-form crossing of the pump parabola and a K-only system', () => {
  const s = kSys(10), A = (Math.PI / 4) * 0.01, c = 10 / (2 * G * A * A);
  const { a, b } = pumpCoeffs(pump);
  const B = b - c, disc = a * a - 4 * B * (43 - 10);
  const Q = (-a - Math.sqrt(disc)) / (2 * B);
  const got = operatingFlow(pump, { mode: 'single', n: 1 }, 1, s);
  rel(got, Q, 1e-6);
  near(pumpHead(pump, got), systemHead(s, got), 1e-6);
});

test('a pump that cannot lift the static head delivers no flow', () => {
  assert.equal(operatingFlow(pump, { mode: 'single', n: 1 }, 1, kSys(60)), 0);
});

test('two parallel pumps deliver more than one but less than double; two in series raise head', () => {
  const s = kSys(10), one = { mode: 'single' as const, n: 1 };
  const q1 = operatingFlow(pump, one, 1, s);
  const qp = operatingFlow(pump, { mode: 'parallel', n: 2 }, 1, s);
  const qs = operatingFlow(pump, { mode: 'series', n: 2 }, 1, s);
  assert.ok(qp > q1 && qp < 2 * q1);
  assert.ok(qs > q1 && qs < 2 * q1);
  const op = operatingPoint(pump, { mode: 'parallel', n: 2 }, 1, s, suc);
  near(op.q, op.Q / 2, 1e-12); near(op.h, op.H, 1e-12);
  const os = operatingPoint(pump, { mode: 'series', n: 2 }, 1, s, suc);
  near(os.h, os.H / 2, 1e-12); near(os.q, os.Q, 1e-12);
});

test('shaft power = n ρ g q h / η; hydraulic power = ρ g Q H', () => {
  const s = kSys(10), op = operatingPoint(pump, { mode: 'single', n: 1 }, 1, s, suc);
  near(op.Phyd, rho * G * op.Q * op.H, 1e-6);
  near(op.Pshaft, op.Phyd / op.eta, 1e-6);
  assert.ok(op.Pshaft > op.Phyd);
});

test('system with no static head: Q ∝ r exactly (similar operating points); P ∝ r³', () => {
  const s = kSys(0), one = { mode: 'single' as const, n: 1 };
  const q1 = operatingFlow(pump, one, 1, s), q2 = operatingFlow(pump, one, 0.7, s);
  rel(q2, 0.7 * q1, 1e-6);
  const p1 = operatingPoint(pump, one, 1, s, suc).Pshaft, p2 = operatingPoint(pump, one, 0.7, s, suc).Pshaft;
  rel(p2, 0.343 * p1, 1e-5);
});

test('speedForFlow inverts the operating flow; speed control beats throttling at part load', () => {
  const s = kSys(10), one = { mode: 'single' as const, n: 1 };
  const q1 = operatingFlow(pump, one, 1, s), Qt = 0.7 * q1;
  const r = speedForFlow(pump, one, s, Qt)!;
  assert.ok(r > 0.5 && r < 1);
  rel(operatingFlow(pump, one, r, s), Qt, 1e-6);
  const c = throttlingVsSpeed(pump, one, s, Qt);
  assert.ok(c.speed < c.throttled);
  assert.equal(speedForFlow(pump, one, s, 10 * q1), null);
});

test('vapour pressure of water (Antoine): 20 °C 2.339 kPa, 60 °C 19.95 kPa, 100 °C 101.3 kPa', () => {
  near(vapourPressure(20), 2339, 30); near(vapourPressure(60), 19950, 250); near(vapourPressure(100), 101325, 600);
});

test('NPSH available, hand calc: (101 325 − 2 339)/(998.2 g) = 10.11 m; + z_s − loss', () => {
  near(npshAvailable({ pAbs: 101325, T: 20, zs: 0, hLossD: 0 }, rho, 0.02, 0.02), 10.11, 0.03);
  near(npshAvailable({ pAbs: 101325, T: 20, zs: 2, hLossD: 0.5 }, rho, 0.01, 0.02), 10.11 + 2 - 0.125, 0.03);
});

test('checks: BEP window, cavitation margin and stability are flagged', () => {
  const s = kSys(10), one = { mode: 'single' as const, n: 1 };
  const op = operatingPoint(pump, one, 1, s, suc);
  const ok = pumpChecks(pump, 1, op, s, one);
  assert.equal(ok.length, 6);
  const bad = pumpChecks(pump, 1, operatingPoint(pump, one, 1, s, { ...suc, zs: -9 }), s, one);
  assert.ok(bad.some((c) => !c.ok && /NPSH/.test(c.label)));
  const far = pumpChecks(pump, 1, operatingPoint(pump, one, 1, kSys(38), suc), kSys(38), one);
  assert.ok(far.some((c) => !c.ok && /70…120/.test(c.label)));
});
