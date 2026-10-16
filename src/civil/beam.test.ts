import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IPE, MATERIALS, analyseBeam, sectionProps, shearStress, solveBeam, type Load, type Support } from './beam.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const rel = (a: number, b: number, tol: number, msg = '') => near(a / b, 1, tol, msg);

const L = 4, EI = 2e7, P = 10e3, w = 5e3; // m, N·m², N, N/m
const run = (support: Support, loads: Load[]) => solveBeam({ L, support, loads, EI });
const udl: Load = { kind: 'udl', a: 0, b: L, w };
const mid: Load = { kind: 'point', a: L / 2, P };

test('VALIDATION (Gere & Goodno beam tables): simply supported, uniform load: R = wL/2, M = wL²/8, δ = 5wL⁴/384EI', () => {
  const r = run('simple', [udl]);
  rel(r.reactions[0].R, (w * L) / 2, 1e-9); rel(r.reactions[1].R, (w * L) / 2, 1e-9);
  rel(r.Mmax, (w * L * L) / 8, 1e-9); near(r.xM, L / 2, 1e-9);
  rel(r.vmax, (5 * w * L ** 4) / (384 * EI), 1e-6); near(r.xv, L / 2, 1e-9);
  rel(r.Vmax, (w * L) / 2, 1e-9);
});

test('VALIDATION (Gere & Goodno): simply supported, central point load: R = P/2, M = PL/4, δ = PL³/48EI; off-centre R_A = Pb/L, M = Pab/L', () => {
  const r = run('simple', [mid]);
  rel(r.Mmax, (P * L) / 4, 1e-9); rel(r.vmax, (P * L ** 3) / (48 * EI), 1e-6);
  const a = 1.0, b = L - a, r2 = run('simple', [{ kind: 'point', a, P }]);
  rel(r2.reactions[0].R, (P * b) / L, 1e-9); rel(r2.Mmax, (P * a * b) / L, 1e-9); near(r2.xM, a, 1e-9);
});

test('VALIDATION (Gere & Goodno): cantilever tip load: δ = PL³/3EI, M = PL (hogging); uniform load: δ = wL⁴/8EI, M = wL²/2', () => {
  const r = run('cantilever', [{ kind: 'point', a: L, P }]);
  rel(r.vmax, (P * L ** 3) / (3 * EI), 1e-6); rel(r.Mhog, P * L, 1e-9); near(r.Msag, 0, 1e-3);
  rel(r.reactions[0].R, P, 1e-9); rel(r.reactions[0].Mw, P * L, 1e-9);
  const u = run('cantilever', [udl]);
  rel(u.vmax, (w * L ** 4) / (8 * EI), 1e-6); rel(u.Mhog, (w * L * L) / 2, 1e-9);
});

test('VALIDATION (Gere & Goodno): fixed-fixed uniform load: M_end = wL²/12, M_mid = wL²/24, δ = wL⁴/384EI; central load M = PL/8, δ = PL³/192EI', () => {
  const r = run('fixed', [udl]);
  rel(r.Mhog, (w * L * L) / 12, 1e-6); rel(r.Msag, (w * L * L) / 24, 1e-6); rel(r.vmax, (w * L ** 4) / (384 * EI), 1e-6);
  const c = run('fixed', [mid]);
  rel(c.Mhog, (P * L) / 8, 1e-6); rel(c.Msag, (P * L) / 8, 1e-6); rel(c.vmax, (P * L ** 3) / (192 * EI), 1e-6);
});

test('VALIDATION (Gere & Goodno): propped cantilever, uniform load: R_roller = 3wL/8, R_wall = 5wL/8, M_wall = wL²/8, M⁺ = 9wL²/128 at 5L/8, δ = wL⁴/185EI', () => {
  const r = run('propped', [udl]);
  rel(r.reactions[1].R, (3 * w * L) / 8, 1e-6); rel(r.reactions[0].R, (5 * w * L) / 8, 1e-6);
  rel(r.Mhog, (w * L * L) / 8, 1e-6); rel(r.Msag, (9 * w * L * L) / 128, 1e-4); near(r.xSag, (5 * L) / 8, L / 100);
  rel(r.vmax, (w * L ** 4) / (185 * EI), 3e-3); near(r.xv, 0.5785 * L, L / 60); // 0.4215 L from the roller end
});

test('applied moment: simply supported with clockwise M₀ at midspan gives R_A = −M₀/L, R_B = M₀/L and a jump of M₀ in the moment diagram', () => {
  const M0 = 8e3, r = run('simple', [{ kind: 'moment', a: L / 2, M: M0 }]);
  rel(r.reactions[1].R, M0 / L, 1e-9); rel(r.reactions[0].R, -M0 / L, 1e-9);
  near(r.section(L / 2, 'left').M, -M0 / 2, 1e-6); near(r.section(L / 2, 'right').M, M0 / 2, 1e-6);
});

test('equilibrium: the reactions balance the loads for any mix of loads and supports', () => {
  const loads: Load[] = [{ kind: 'point', a: 1.0, P: 3e3 }, { kind: 'udl', a: 1.5, b: 3.2, w: 2e3 }, { kind: 'point', a: 3.7, P: -1e3 }, { kind: 'moment', a: 2, M: 1e3 }];
  const total = 3e3 + 2e3 * 1.7 - 1e3;
  for (const s of ['simple', 'cantilever', 'fixed', 'propped'] as Support[]) {
    const r = run(s, loads);
    near(r.reactions.reduce((a, q) => a + q.R, 0), total, 1e-4, s);
    // shear and moment vanish at the free end(s): V(L⁺) = 0 and M(L⁺) = 0 once the right reaction is counted
    const e = r.section(L + 1e-6, 'right');
    near(e.V, 0, 1e-4, s); near(e.M, 0, 1e-3, s);
  }
});

test('superposition: two loads give the sum of the deflections', () => {
  const a = run('fixed', [{ kind: 'point', a: 1, P }]), b = run('fixed', [{ kind: 'udl', a: 0, b: L, w }]), ab = run('fixed', [{ kind: 'point', a: 1, P }, udl]);
  for (const i of [20, 60, 100]) near(ab.v[i], a.v[i] + b.v[i], 1e-12);
});

test('partial uniform load on a cantilever: δ_tip for w on the outer half, hand calc', () => {
  // load w on [L/2, L]: tip deflection = w·(L/2)/(24EI)·(... ) by integration: δ = wL⁴·(41/384)/EI
  const r = run('cantilever', [{ kind: 'udl', a: L / 2, b: L, w }]);
  rel(Math.abs(r.v[r.v.length - 1]), (41 * w * L ** 4) / (384 * EI), 1e-6);
});

test('section properties: rectangle, circle, tube; IPE tables agree with the plain I-shape within the fillet allowance', () => {
  const r = sectionProps({ kind: 'rect', b: 100, h: 200 });
  rel(r.I, (0.1 * 0.2 ** 3) / 12, 1e-12); rel(r.I / r.c, 0.1 * 0.2 ** 2 / 6, 1e-12);
  rel(sectionProps({ kind: 'circle', d: 100 }).I, (Math.PI / 64) * 0.1 ** 4, 1e-12);
  const t = sectionProps({ kind: 'tube', D: 100, t: 5 });
  rel(t.I, (Math.PI / 64) * (0.1 ** 4 - 0.09 ** 4), 1e-12);
  for (const e of IPE) {
    const plain = (e.b * e.h ** 3 - (e.b - e.tw) * (e.h - 2 * e.tf) ** 3) / 12; // mm⁴, no fillets
    const table = e.I * 1e4;
    assert.ok(table > plain && table < plain * 1.08, `${e.name} ${table} vs ${plain}`);
  }
  rel(sectionProps({ kind: 'ipe', name: 'IPE 300' }).I / sectionProps({ kind: 'ipe', name: 'IPE 300' }).c, 557e-6, 0.005); // W_el = 557 cm³
});

test('shear stress: rectangle 1.5 V/A, circle 4V/3A, I-section web stress V Q/(I t_w) of IPE 300 ≈ 1.1 × V/(h t_w)', () => {
  rel(shearStress({ kind: 'rect', b: 100, h: 200 }, 10e3), (1.5 * 10e3) / 0.02, 1e-12);
  rel(shearStress({ kind: 'circle', d: 100 }, 10e3), ((4 / 3) * 10e3) / ((Math.PI / 4) * 0.01), 1e-12);
  const tau = shearStress({ kind: 'ipe', name: 'IPE 300' }, 10e3);
  assert.ok(tau > 10e3 / (0.3 * 7.1e-3) * 0.9 && tau < 10e3 / (0.3 * 7.1e-3) * 1.3, `${tau}`);
});

test('analysis: IPE 200 steel, 4 m, 10 kN/m: σ = M/W hand calc, self-weight adds ρ g A, checks pass/fail as expected', () => {
  const mat = MATERIALS[0], sect = { kind: 'ipe' as const, name: 'IPE 200' };
  const base = { L: 4, support: 'simple' as Support, loads: [{ kind: 'udl' as const, a: 0, b: 4, w: 10e3 }], sect, mat, selfWeight: false, n: 1.5, defl: 250 };
  const a = analyseBeam(base);
  rel(a.Mmax, (10e3 * 16) / 8, 1e-9); // 20 kN·m
  rel(a.sigma, 20e3 / (194e-6), 0.01); // W = 194 cm³ → 103 MPa
  assert.ok(a.checks.every((c) => c.ok));
  const sw = analyseBeam({ ...base, selfWeight: true });
  rel(sw.wSelf, 7850 * 9.80665 * 28.5e-4, 1e-9);
  assert.ok(sw.Mmax > a.Mmax);
  const bad = analyseBeam({ ...base, loads: [{ kind: 'udl', a: 0, b: 4, w: 40e3 }] });
  assert.ok(bad.checks.some((c) => !c.ok));
  rel(analyseBeam({ ...base, support: 'cantilever' }).dLim, 8 / 250, 1e-12);
});
