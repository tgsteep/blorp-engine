import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CEA, CEA_EPS, CEA_PC } from './ceaTables.ts';
import { altitudeSweep, areaRatio, chamberGas, engine, engineGeometry, exhaustVelocity, G0, gammaFn, machFromArea, optimumEps, pRatio, RU, thrustCoef } from './engine.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);

test('VALIDATION (Braeunig, Rocket and Space Technology, Problem 1.5): LOX/kerosene O/F 2.26, p_c 50 atm to p_e 1 atm, T_c 3470 K, M 21.40, k 1.221 → v_e = 2749 m/s', () => {
  near(exhaustVelocity(1.221, RU / 21.4, 3470, 1 / 50), 2749, 1.5);
});

test('isentropic nozzle relations: A/A* = 1 at M = 1, Mach from area round trip, optimum expansion has no pressure thrust', () => {
  near(areaRatio(1, 1.2), 1, 1e-12);
  for (const eps of [2, 10, 77, 300]) near(areaRatio(machFromArea(eps, 1.2), 1.2), eps, 1e-9);
  // k = 1.4, ε = 4: supersonic M = 2.9402 (isentropic flow tables)
  near(machFromArea(4, 1.4), 2.9402, 2e-4);
  near(pRatio(1, 1.4), 0.528282, 1e-6, 'critical pressure ratio');
  const k = 1.2, pc_pa = 100, eps = optimumEps(k, pc_pa);
  near(pRatio(machFromArea(eps, k), k), 1 / pc_pa, 1e-9);
  // C_F at optimum = Γ √(2k/(k−1)·(1 − (p_a/p_c)^((k−1)/k))), the peak of C_F over ε
  const cfOpt = gammaFn(k) * Math.sqrt(((2 * k) / (k - 1)) * (1 - Math.pow(1 / pc_pa, (k - 1) / k)));
  near(thrustCoef(k, eps, pc_pa), cfOpt, 1e-9);
  assert.ok(thrustCoef(k, eps * 0.7, pc_pa) < cfOpt && thrustCoef(k, eps * 1.4, pc_pa) < cfOpt);
});

test('one-k ideal rocket with CEA chamber gas against CEA shifting-equilibrium vacuum I_sp: within 6.5 % over the whole table; at the usual mixture ratio 1.2 % (kerosene, methane), 3.1 % (hydrogen), 4.3 % (hypergolic)', () => {
  const usual: Record<string, number> = { kerolox: 2.65, methalox: 3.4, hydrolox: 6, hypergolic: 2 };
  for (const t of CEA) for (let i = 0; i < CEA_PC.length; i++) for (let j = 0; j < t.mr.length; j++) for (let e = 0; e < CEA_EPS.length; e++) {
    const k = t.k[i][j], cs = Math.sqrt((RU / t.M[i][j]) * t.Tc[i][j]) / gammaFn(k);
    const err = Math.abs((thrustCoef(k, CEA_EPS[e], 0) * cs) / G0 / t.ispVac[i][j][e] - 1);
    const lim = Math.abs(t.mr[j] - usual[t.id]) < 0.11 ? { kerolox: 0.012, methalox: 0.012, hydrolox: 0.031, hypergolic: 0.043 }[t.id]! : 0.065;
    assert.ok(err < lim, `${t.id} ${CEA_PC[i]} bar O/F ${t.mr[j]} ε ${CEA_EPS[e]}: ${(err * 100).toFixed(2)} %`);
  }
});

test('engine: ṁ = p_c A_t/c*, F = C_F p_c A_t, I_sp = C_F c*/g₀; vacuum thrust in space; big bell separates at sea level', () => {
  const p = { prop: 'kerolox' as const, pc: 70e5, mr: 2.6, eps: 16, Dt: 0.2, alt: 0 };
  const r = engine(p);
  near(r.mdot, (p.pc * r.At) / r.cstar, 1e-9);
  near(r.F, r.CF * p.pc * r.At, 1e-6);
  near(r.Isp, (r.CF * r.cstar) / G0, 1e-9);
  near(r.cstar, r.gas.cstarCEA, r.gas.cstarCEA * 0.01, 'c* within 1 % of CEA');
  near(r.mdotOx + r.mdotF, r.mdot, 1e-9); near(r.mdotOx / r.mdotF, 2.6, 1e-9);
  // throat: T* = 2T_c/(k+1)
  near(r.Tt, (2 * r.gas.Tc) / (r.k + 1), 1e-9);
  const space = engine({ ...p, alt: 100000 });
  near(space.F, space.Fvac, space.Fvac * 2e-5);
  assert.equal(engine({ ...p, eps: 150 }).separated, true);
  assert.equal(engine({ ...p, eps: 150, alt: 20000 }).separated, false);
  const sw = altitudeSweep(p, 20);
  assert.ok(sw.every((s) => s.adapted >= s.Isp - 1e-9), 'an adapted nozzle is never worse');
});

test('CEA interpolation returns grid values at grid points; chamber gas is hottest near the usual mixture ratios', () => {
  const t = CEA.find((x) => x.id === 'kerolox')!;
  near(chamberGas('kerolox', 70e5, t.mr[4]).Tc, t.Tc[4][4], 1e-9);
  const tc = t.mr.map((m) => chamberGas('kerolox', 70e5, m).Tc);
  const iMax = tc.indexOf(Math.max(...tc));
  assert.ok(t.mr[iMax] > 2.2 && t.mr[iMax] < 3.2, `peak T_c at O/F ${t.mr[iMax]}`);
});

test('Bartz throat heat flux, hand calculation (μ 1e-4 Pa·s, c_p 2000 J/kgK, Pr 0.6, p_c 7 MPa, c* 1800 m/s, D_t 0.2 m, r_c = 0.75 D_t)', () => {
  // h = 0.026/0.2^0.2 · (1e-4^0.2·2000/0.6^0.6) · (7e6/1800)^0.8 · (1/0.75)^0.1
  const h = (0.026 / Math.pow(0.2, 0.2)) * ((Math.pow(1e-4, 0.2) * 2000) / Math.pow(0.6, 0.6)) * Math.pow(7e6 / 1800, 0.8) * Math.pow(1 / 0.75, 0.1);
  near(h, 11838, 5);
  const g = engineGeometry('kerolox', 0.2, 16);
  near(g.pts[g.pts.length - 1][1], 0.1 * 4, 1e-9, 'exit radius R_t √ε');
  near(Math.min(...g.pts.map((q) => q[1])), 0.1, 1e-9, 'throat radius');
});
