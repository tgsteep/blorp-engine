import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bearing, classic, ec7, factors, mechanism, waterEffects, type BearingIn } from './bearing.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const base: BearingIn = { shape: 'square', B: 2, L: 2, Df: 1, drainage: 'drained', c: 0, phi: 30, cu: 50, gamma: 18, gammaSat: 20, Dw: 10, G: 600, Q: 200, H: 0, e: 0, FS: 3, approach: 'DA1' };

test('VALIDATION (Das, Principles of Foundation Engineering, Table 3.3 — Vesić bearing capacity factors)', () => {
  for (const [phi, Nc, Nq, Ng] of [[20, 14.83, 6.40, 5.39], [30, 30.14, 18.40, 22.40], [40, 75.31, 64.20, 109.41]]) {
    const f = factors(phi);
    near(f.Nc, Nc, 0.01, `Nc ${phi}`); near(f.Nq, Nq, 0.01, `Nq ${phi}`); near(f.Ng, Ng, 0.02, `Nγ ${phi}`);
  }
  // Eurocode 7 Annex D: φ = 35° → N_q 33.30, N_c 46.12, N_γ 45.23
  const e = factors(35); near(e.Nq, 33.30, 0.01); near(e.Nc, 46.12, 0.01); near(e.NgEC, 45.23, 0.01);
});

test('Prandtl: undrained strip at the surface carries (π + 2) c_u; EC7 DA1-2 divides c_u by 1.4', () => {
  const p: BearingIn = { ...base, shape: 'strip', drainage: 'undrained', Df: 0, cu: 60 };
  near(classic(p).qu, (Math.PI + 2) * 60, 1e-9);
  const r = ec7(p, { name: 'DA1-2', A: 'A2', M: 'M2', R: 'R1' });
  near(r.Rd, ((Math.PI + 2) * 60) / 1.4 * 2, 1e-9, 'per metre, B = 2 m');
});

test('square footing on sand, hand calculation: B = 2 m, D_f = 1 m, φ = 30°, γ = 18 kN/m³, dry', () => {
  // q = 18; F_qs = 1 + tan 30° = 1.5774, F_γs = 0.6; F_qd = 1 + 2·tan30·(1 − sin30)²·0.5 = 1.1443
  // q_u = 18·18.401·1.5774·1.1443 + 0.5·18·2·22.402·0.6 = 597.9 + 241.9 = 839.8 kPa; Q_u = 4·q_u = 3359 kN; FS = 3359/800 = 4.20
  const r = classic(base);
  near(r.Fqd, 1.1443, 1e-4);
  near(r.qu, 839.8, 0.3);
  near(r.FS, 4.199, 0.002);
  assert.equal(bearing(base).checks[0].ok, true);
});

test('water table at the base halves the γ term; eccentricity reduces the width; inclination lowers capacity', () => {
  const w = waterEffects({ ...base, Dw: 1 });
  near(w.q, 18, 1e-9); near(w.gEff, 20 - 9.81, 1e-9);
  near(waterEffects({ ...base, Dw: 2 }).gEff, 10.19 + 0.5 * (18 - 10.19), 1e-9);
  assert.ok(classic({ ...base, e: 0.2 }).Qu < classic(base).Qu);
  assert.ok(classic({ ...base, H: 100 }).qu < classic(base).qu);
  assert.equal(bearing({ ...base, e: 0.4 }).checks[2].ok, false, 'e > B/6');
});

test('Prandtl mechanism for φ = 0: wedge depth B/2, failure reaches B beyond the edge', () => {
  const m = mechanism(2, 0);
  near(m.apex[1], -1, 1e-9); near(m.D[0], 2, 1e-9); near(m.D[1], -1, 1e-9); near(m.G[0], 3, 1e-9);
  assert.ok(mechanism(2, 35).reach > m.reach, 'friction widens the mechanism');
});

test('φ = 0 drained (c only): Eurocode 7 shape factor takes its limit, no NaN', () => {
  for (const shape of ['strip', 'square', 'rect', 'circle'] as const) {
    const r = bearing({ ...base, shape, L: shape === 'rect' ? 4 : base.L, phi: 0, c: 20 });
    for (const e of r.ec) assert.ok(Number.isFinite(e.util), `${shape} ${e.combo.name}`);
  }
});
