import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CUT_MATERIALS, drilling, kc, milling, rpm, turning, vcRange } from './cutting.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const c45 = CUT_MATERIALS.find((m) => m.id === 'c45')!;
const machine = { Pmax: 15, nmax: 4000, eta: 0.8 };

test('Kienzle: k_c = k_c1.1 at h = 1 mm and rises for thin chips (C45: 2220 N/mm², m_c 0.14 → 2627.6 at 0.3 mm)', () => {
  near(kc(c45, 1), 2220, 1e-9);
  near(kc(c45, 0.3), 2220 * Math.pow(0.3, -0.14), 1e-9);
  near(kc(c45, 0.3), 2627.6, 0.1);
  near(rpm(200, 50), 1273.24, 0.01);
});

test('turning, hand calculation: C45, D 50, v_c 200, f 0.3, a_p 2, κ 90° → F_c 1576.6 N, P_c 5.26 kW', () => {
  const r = turning({ ...machine, mat: c45, tool: 'carbide', D: 50, vc: 200, f: 0.3, ap: 2, kappa: 90, re: 0.8, L: 100, RaMax: 3.2 });
  near(r.Fc, 2 * 0.3 * 2627.57, 0.5);
  near(r.Pc, (r.Fc * 200) / 60000, 1e-12); near(r.Pc, 5.255, 0.005);
  near(r.Q, 120, 1e-9, 'v_c a_p f = 120 cm³/min');
  near(r.Rz, (0.09 / 6.4) * 1000, 1e-9); // 14.06 µm
  near(r.t, 100 / (0.3 * rpm(200, 50)), 1e-12);
  assert.equal(r.checks.find((c) => c.label.startsWith('Surface'))!.ok, false, 'R_a 3.5 µm > 3.2');
  // a smaller approach angle thins the chip over a longer edge: same area a_p f, higher k_c → slightly more force
  const k45 = turning({ ...machine, mat: c45, tool: 'carbide', D: 50, vc: 200, f: 0.3, ap: 2, kappa: 45, re: 0.8, L: 100, RaMax: 3.2 });
  near(k45.Fc / r.Fc, Math.pow(Math.sin(Math.PI / 4), -0.14), 1e-12);
});

test('face milling, hand calculation: D 80, z 6, a_e 60, f_z 0.15, κ 45° → mean chip and power', () => {
  const r = milling({ ...machine, mat: c45, tool: 'carbide', D: 80, z: 6, vc: 200, fz: 0.15, ap: 2, ae: 60, kappa: 45, L: 300 });
  const phi = 2 * Math.asin(60 / 80) * 180 / Math.PI; // 97.18°
  near(r.phiDeg, phi, 1e-9);
  near(r.hm, (360 * Math.sin(Math.PI / 4) * 60 * 0.15) / (Math.PI * 80 * phi), 1e-12); // 0.0938 mm
  near(r.vf, 0.15 * 6 * rpm(200, 80), 1e-9);
  near(r.Pc, (2 * 60 * r.vf * kc(c45, r.hm)) / 60e6, 1e-12);
  near(r.M, (r.Pc * 30000) / (Math.PI * r.n), 1e-12);
});

test('drilling: torque k_c f D²/8000 and power f v_c D k_c/240000 agree (P = M ω)', () => {
  const r = drilling({ ...machine, mat: c45, tool: 'carbide', D: 10, vc: 100, f: 0.2, point: 140, L: 30 });
  near(r.h, 0.1 * Math.sin((70 * Math.PI) / 180), 1e-12);
  near((r.M * 2 * Math.PI * r.n) / 60 / 1000, r.Pc, 1e-9);
  assert.deepEqual(vcRange(c45, 'drilling', 'carbide'), [85, 130]);
});
