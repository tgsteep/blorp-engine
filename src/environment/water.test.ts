import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ct3Giardia, mu, rhoW, settling, treatment, type WtIn } from './water.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const base: WtIn = { Q: 10000, T: 10, pH: 7, Gr: 800, tr: 30, Gf: 40, tf: 30, nS: 2, L: 32, B: 8, H: 3, d: 0.25, rhoF: 1040, nF: 4, Af: 18, C: 1, Vc: 450, bf: 0.7, logs: 0.5 };

test('water properties: viscosity and density against tables (within 1 % / 0.05 %)', () => {
  near(mu(20) / 1.002e-3, 1, 0.01, 'μ 20 °C'); near(mu(10) / 1.306e-3, 1, 0.01, 'μ 10 °C'); near(mu(0) / 1.792e-3, 1, 0.01, 'μ 0 °C');
  near(rhoW(20), 998.2, 0.1, 'ρ 20 °C'); near(rhoW(4), 1000, 0.05, 'ρ 4 °C');
});

test('settling: Stokes for fine particles, slower than Stokes once Re grows', () => {
  const s = settling(20e-6, 2650, 20); near(s.v / s.stokes, 1, 0.01, 'fine silt'); assert.ok(s.Re < 0.1);
  const g = settling(1e-3, 2650, 20); assert.ok(g.v < 0.5 * g.stokes && g.Re > 50, 'sand grain');
  near(g.v, 0.15, 0.03, '1 mm quartz sand settles ≈ 0.15 m/s');
});

test('EPA CT table: nodes exact, interpolation between them, clamped outside', () => {
  near(ct3Giardia(10, 1, 7), 112, 1e-9); near(ct3Giardia(0.5, 3, 9), 552, 1e-9); near(ct3Giardia(25, 0.4, 6), 24, 1e-9);
  near(ct3Giardia(7.5, 1, 7), (149 + 112) / 2, 1e-9, 'temperature'); near(ct3Giardia(10, 1, 7.25), (112 + 134) / 2, 1e-9, 'pH');
  near(ct3Giardia(-2, 0.1, 5), 137, 1e-9, 'clamped low'); near(ct3Giardia(30, 1, 7), 37, 1e-9, 'clamped high');
});

test('treatment train (hand calculation)', () => {
  const r = treatment(base), Qs = 10000 / 86400;
  near(r.Vr, Qs * 30, 1e-9); near(r.Pr, 800 * 800 * mu(10) * Qs * 30, 1e-6, 'P = G²μV');
  near(r.Gt, 40 * 1800, 1e-9); near(r.vo * 3600, 10000 / 24 / (2 * 32 * 8), 1e-9, 'v_o'); near(r.td, (2 * 32 * 8 * 3) / Qs, 1e-6, 't');
  near(r.vf, 10000 / 24 / 72, 1e-9); near(r.vf1, 10000 / 24 / 54, 1e-9);
  near(r.T10, (0.7 * 450) / Qs / 60, 1e-9); near(r.CTreq, 112 / 6, 1e-9, '0.5 log = CT₃/6'); near(r.CT, r.T10, 1e-9);
  near(r.r, Math.min(1, r.set.v / r.vo), 1e-12, 'Hazen');
  assert.ok(r.checks.every((c) => c.ok), r.checks.filter((c) => !c.ok).map((c) => `${c.label} ${c.detail}`).join('; '));
  assert.ok(treatment({ ...base, Vc: 30 }).checks.some((c) => !c.ok), 'small contact tank fails CT');
});
