import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basePlate, bolt, effArea, FbRd, finPlate, FvRd, heb, type BaseIn, type FinIn } from './steelconn.ts';
import { interaction, Kprime, mrdAtN, nmAt, rcBeam, rcColumn, spanDepth, type BeamRCIn, type ColRCIn } from './rc.ts';

const near = (a: number, b: number, tol: number, w = '') => assert.ok(Math.abs(a - b) <= tol, `${w}: ${a} vs ${b}`);
export const FIN_DEF: FinIn = { V: 150, beam: 'IPE 360', column: 'HEB 240', steel: 'S275', bolt: 'M20', cls: '8.8', n: 4, p1: 70, e1: 40, e2: 50, z: 60, tp: 10, a: 6 };
export const BASE_DEF: BaseIn = { N: 1000, V: 50, column: 'HEB 200', steel: 'S275', Lp: 300, Bp: 300, tp: 20, fck: 25, alpha: 1.5, anchor: 'M20', nA: 4 };
export const RCB_DEF: BeamRCIn = { b: 300, h: 500, c: 30, fck: 30, acc: 0.85, nb: 4, db: 20, nt: 2, dt: 12, dw: 8, s: 200, M: 200, V: 150, L: 6, span: 'simple' };
export const RCC_DEF: ColRCIn = { b: 400, h: 400, c: 30, fck: 30, acc: 0.85, n: 3, db: 20, dw: 8, N: 1500, M: 100, l0: 4 };

test('steel connections by hand: bolt shear and bearing (EN 1993-1-8 Table 3.4), base plate effective area', () => {
  near(FvRd(bolt('M20'), '8.8'), 0.6 * 800 * 245 / 1.25, 1e-9, 'F_v,Rd M20 8.8 = 94.1 kN'); near(FvRd(bolt('M20'), '8.8') / 1000, 94.08, 0.01, 'tabulated');
  const b = FbRd(20, 22, 10, 430, 800, Math.min(40 / 66, 70 / 66 - 0.25), 50);
  near(b.k1, 2.5, 1e-12, 'k1'); near(b.ab, 40 / 66, 1e-12, 'alpha_b'); near(b.F, 2.5 * (40 / 66) * 430 * 20 * 10 / 1.25, 1e-6, 'F_b,Rd');
  const r = finPlate(FIN_DEF);
  near(r.hp, 2 * 40 + 3 * 70, 1e-12, 'h_p');
  // bolt group: Σy² = 2(35² + 105²), F_h = V z y_max/Σy²
  const Iy = 2 * (35 * 35 + 105 * 105), Fh = (150e3 * 60 * 105) / Iy; near(r.Fb * 1000, Math.hypot(150e3 / 4, Fh), 1e-6, 'bolt resultant');
  near(r.Vbt, 0.5 * 430 * 10 * (50 - 11) / 1.25 + (275 * 10 * (290 - 40 - 3.5 * 22)) / Math.sqrt(3), 1e-6, 'block tearing');
  assert.ok(r.checks.every((c) => c.ok), JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.equal(finPlate({ ...FIN_DEF, V: 400 }).checks[0].ok, false, 'overloaded');
  // base plate: HEB 200, 300 × 300 × 20, S275, C25/30, α = 1.5 → f_jd = 16.67 MPa, c = 46.9 mm
  const q = basePlate(BASE_DEF), fjd = (2 / 3) * 1.5 * 25 / 1.5, c = 20 * Math.sqrt(275 / (3 * fjd));
  near(q.fjd, fjd, 1e-9, 'f_jd'); near(q.c, c, 1e-9, 'c');
  const A = 2 * (100 + c - (100 - 15 - c)) * (200 + 2 * c) + 2 * (100 - 15 - c) * (9 + 2 * c); near(q.eff.A, A, 1e-6, 'A_eff'); near(q.NRd, A * fjd, 1e-3, 'N_Rd');
  assert.ok(q.treq !== null && q.treq < 20 && q.checks[0].ok);
  // thick plate on a small column: flange areas merge, then the plate edge limits the area
  assert.equal(effArea(200, heb('HEB 100'), 300, 300).A, 300 * 300);
});

test('reinforced concrete by hand: K, z, A_s, shear, span/depth, column N–M points', () => {
  near(Kprime(0.85), 0.167, 0.001, "K' 0.85"); near(Kprime(1), 0.197, 0.001, "K' 1.0");
  const r = rcBeam(RCB_DEF), d = 500 - 30 - 8 - 10, K = 200e6 / (300 * d * d * 30);
  near(r.d, d, 1e-12, 'd'); near(r.K, K, 1e-12, 'K');
  const z = d * (0.5 + Math.sqrt(0.25 - K / 1.134)); near(r.z, z, 0.5, 'z = d[0.5 + √(0.25 − K/1.134)]'); near(r.Asreq, 200e6 / (500 / 1.15 * z), 2, 'A_s');
  const k = 1 + Math.sqrt(200 / d), rl = (4 * Math.PI * 100) / (300 * d); near(r.VRdc, 0.12 * k * Math.pow(100 * rl * 30, 1 / 3) * 300 * d, 1e-6, 'V_Rd,c');
  near(spanDepth(1, 30, 0.005, 0), 11 + 1.5 * Math.sqrt(30) * (Math.sqrt(30) * 1e-3) / 0.005 + 3.2 * Math.sqrt(30) * Math.pow((Math.sqrt(30) * 1e-3) / 0.005 - 1, 1.5), 1e-9, 'eq. 7.16');
  assert.ok(r.checks.every((c) => c.ok), JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.equal(rcBeam({ ...RCB_DEF, M: 400 }).checks[0].ok, false, 'too much moment');
  // column section 400 × 400, 3 Ø20 per face at d2 = 50, f_cd = 17: at x = 200 both bar rows yield
  const s = { b: 400, h: 400, d2: 50, As1: 3 * Math.PI * 100, fcd: 17 }, nm = nmAt(200, s), Fc = 160 * 400 * 17;
  near(nm.N, Fc, 1e-6, 'N at x = 200'); near(nm.M, Fc * 120 + 2 * s.As1 * (500 / 1.15) * 150, 1e-3, 'M at x = 200');
  const pts = interaction(s); near(pts[0].N, -2 * s.As1 * 500 / 1.15, 1e-6, 'pure tension'); near(pts[pts.length - 1].N, 400 * 400 * 17 + 2 * s.As1 * 400, 1e-6, 'pure compression');
  near(mrdAtN(pts, Fc), nm.M, 0.02 * nm.M, 'M_Rd read back');
  const c = rcColumn(RCC_DEF); assert.ok(c.checks.every((x) => x.ok), JSON.stringify(c.checks.filter((x) => !x.ok)));
  assert.ok(rcColumn({ ...RCC_DEF, l0: 9 }).M2 > 0, 'slender: second-order moment');
});
