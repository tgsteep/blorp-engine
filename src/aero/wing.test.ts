import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clCurve, naca4, oswald, wing, wingSlope, A0, type WingIn } from './wing.ts';
import { isa } from './ramjet.ts';

const near = (a: number, b: number, tol: number, w = '') => assert.ok(Math.abs(a - b) <= tol, `${w}: ${a} vs ${b}`);
export const WING_DEF: WingIn = { airfoil: 'n2412', m: 1000, S: 16.2, A: 7.5, taper: 0.7, CD0: 0.027, h: 1500, V: 55, n: 1 };

test('wing by hand: lift coefficient, induced drag, stall speed, best glide', () => {
  const r = wing(WING_DEF), rho = isa(1500).rho, W = 1000 * 9.80665;
  near(r.CL, W / (0.5 * rho * 55 * 55 * 16.2), 1e-12, 'C_L');
  near(r.CDi, r.CL ** 2 / (Math.PI * r.e * 7.5), 1e-12, 'C_Di');
  near(r.Vs1, Math.sqrt((2 * W) / (rho * 16.2 * 0.9 * 1.68)), 1e-9, 'V_s');
  // at the best-glide speed induced drag equals zero-lift drag
  const md = wing({ ...WING_DEF, V: r.Vmd });
  near(md.Di, md.Dp, 1e-6, 'D_i = D_0 at V_md'); near(md.LD, r.LDmax, 1e-9, '(L/D)max');
  // at the minimum-power speed induced drag is three times the zero-lift drag
  const mp = wing({ ...WING_DEF, V: r.Vmp }); near(mp.Di, 3 * mp.Dp, 1e-6, 'D_i = 3 D_0 at V_mp');
  assert.ok(r.checks.every((c) => c.ok), JSON.stringify(r.checks.filter((c) => !c.ok)));
  // turning at 60° bank doubles the load and raises the stall speed by √2
  const t = wing({ ...WING_DEF, n: 2 }); near(t.bank, 60, 1e-9, 'bank'); near(t.Vs / r.Vs, Math.SQRT2, 1e-12, 'V_s √n');
});

test('lift slope limits and Oswald factor', () => {
  near(wingSlope(1e4), A0, 0.01, 'very long wing → section slope');
  near(wingSlope(6), 4.3, 0.15, 'A = 6 about 4.3 /rad (Helmholtz)');
  assert.ok(wingSlope(8, 0.5) > wingSlope(8, 0), 'compressibility raises the slope');
  near(oswald(8), 1.78 * (1 - 0.045 * 8 ** 0.68) - 0.64, 1e-12, 'Raymer e'); assert.ok(oswald(8) > 0.7 && oswald(8) < 0.85);
});

test('NACA section outline and lift curve', () => {
  const s = naca4(0, 0, 0.12, 60), tmax = Math.max(...s.map((q) => q[1])) * 2; near(tmax, 0.12, 0.002, 't/c of 0012');
  const c = naca4(0.04, 0.4, 0.12, 60); assert.ok(c.every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1])));
  near(clCurve(-4, 6, -4, 1.6), 0, 1e-12, 'zero lift'); assert.ok(clCurve(25, 6, -4, 1.6) < clCurve(14, 6, -4, 1.6), 'falls after stall');
  assert.ok(Math.max(...Array.from({ length: 300 }, (_, i) => clCurve(i / 10, 6, -2, 1.6))) <= 1.6 + 1e-9);
});

test('slider ends give numbers', () => {
  for (const e of [{ m: 1 }, { m: 600000 }, { V: 5 }, { V: 300 }, { h: 15000 }, { A: 3 }, { A: 30 }, { S: 0.1 }, { n: 6 }, { CD0: 0.01 }] as Partial<WingIn>[]) {
    const r = wing({ ...WING_DEF, ...e }); for (const v of [r.CL, r.D, r.P, r.Vs, r.Vmd, r.alpha, r.Re, r.Mroot]) assert.ok(Number.isFinite(v), JSON.stringify(e));
  }
});
