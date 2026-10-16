import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBevel, computeHelical, computeInternal, computePlanetary, computeRack, computeWorm } from './types.ts';
import { computeSpur } from './spur.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);

test('helical with β = 0 equals the spur pair', () => {
  const h = computeHelical({ mn: 3, z1: 18, z2: 45, betaDeg: 0, alphaNDeg: 20, x1: 0, x2: 0, b: 30, n1: 1000, T1: 50 });
  const s = computeSpur({ m: 3, z1: 18, z2: 45, alphaDeg: 20, x1: 0, x2: 0, n1: 1000, T1: 50 });
  near(h.epsA, s.epsAlpha, 1e-9); near(h.aw, s.aw, 1e-9); near(h.Fa, 0, 1e-9);
});

test('helical: m_t = m_n/cos β, ε_β = b sin β/(π m_n), F_a = F_t tan β', () => {
  const h = computeHelical({ mn: 2, z1: 20, z2: 40, betaDeg: 15, alphaNDeg: 20, x1: 0, x2: 0, b: 25, n1: 1000, T1: 40 });
  near(h.mt, 2 / Math.cos((15 * Math.PI) / 180), 1e-12);
  near(h.epsB, (25 * Math.sin((15 * Math.PI) / 180)) / (Math.PI * 2), 1e-12);
  near(h.Fa, h.Ft * Math.tan((15 * Math.PI) / 180), 1e-9);
});

test('internal: a = m(z2 − z1)/2 and ε larger than the external pair with the same teeth', () => {
  const i = computeInternal({ m: 2, z1: 20, z2: 60, alphaDeg: 20, n1: 1000, T1: 10 });
  near(i.a, 40, 1e-12);
  const e = computeSpur({ m: 2, z1: 20, z2: 60, alphaDeg: 20, x1: 0, x2: 0, n1: 0, T1: 0 });
  assert.ok(i.eps > e.epsAlpha);
});

test('rack: z = 20, m = 1, α = 20°, x = 0 → ε_α ≈ 1.77; travel = π m z', () => {
  const r = computeRack({ m: 1, z: 20, alphaDeg: 20, x: 0, n: 60, T: 10 });
  near(r.eps, 1.769, 0.003); near(r.travel, Math.PI * 20, 1e-12);
});

test('bevel: δ₁ + δ₂ = 90°, tan δ₁ = z₁/z₂, R_e = d_e1/(2 sin δ₁)', () => {
  const b = computeBevel({ m: 4, z1: 20, z2: 40, b: 25, alphaDeg: 20, T1: 50 });
  near(b.d1 + b.d2, Math.PI / 2, 1e-12); near(Math.tan(b.d1), 0.5, 1e-12);
  near(b.Re, 80 / (2 * Math.sin(b.d1)), 1e-9);
});

test('worm: η = tan γ/tan(γ+ρ′); single start, q = 10, μ = 0.05 → γ ≈ 5.71°, self-locking threshold', () => {
  const w = computeWorm({ m: 4, z1: 1, q: 10, z2: 40, mu: 0.05, n1: 1450, T1: 10 });
  near((w.gamma * 180) / Math.PI, 5.7106, 1e-3);
  assert.ok(w.eta > 0.6 && w.eta < 0.7);
});

test('planetary, ring fixed: i = 1 + z_r/z_s (textbook), Willis holds', () => {
  const p = computePlanetary({ m: 2, zs: 24, zp: 18, np: 3, fixed: 'ring', nIn: 1000, TIn: 10 });
  near(p.i, 1 + 60 / 24, 1e-12);
  near((p.ns - p.nc) / (p.nr - p.nc), -60 / 24, 1e-9);
  const c = computePlanetary({ m: 2, zs: 24, zp: 18, np: 3, fixed: 'carrier', nIn: 1000, TIn: 10 });
  near(c.i, -60 / 24, 1e-12);
});
