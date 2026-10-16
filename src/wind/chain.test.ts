import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rotor } from './bem.ts';
import { DD, drivetrain, driveMasses, footingSlab, kingpinCheck, foundation, revolvedVolume, shaftCheck, shaftForPower, shaftLoads, shaftPowerLimit, tower, TOWER_REF, towerModes } from './chain.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const r = rotor({ D: 126, P: 5e6, H: 90, vMean: 8, k: 2, loss: 0.12, vOp: 10 });
const chk = (cs: { ok: boolean; label: string }[], start: string) => { const c = cs.find((x) => x.label.startsWith(start)); assert.ok(c, start); return c!; };

test('VALIDATION (Jonkman et al. 2009, NREL/TP-500-38060): NREL 5-MW onshore tower mass and first fore-aft frequency, gearbox ratio', () => {
  const t = towerModes(TOWER_REF.L, TOWER_REF.Db, TOWER_REF.Dt, TOWER_REF.tb, TOWER_REF.tt, 110000 + 240000);
  near(t.mTower / 347460, 1, 0.005, 'tower mass 347 460 kg');
  near(t.f1 / TOWER_REF.f1, 1, 0.05, 'first fore-aft frequency 0.324 Hz (full-system value; Rayleigh on a cantilever with a point top mass)');
  near(drivetrain(r, { gen: 'high', d: 0.85 }, 5e6).ratio, 97, 0.1, 'gearbox ratio 97 (1173.7 / 12.1 rpm)');
});

test('tower: uniform tube against the closed-form cantilever with tip mass', () => {
  const L = 60, D = 4, tw = 0.03, mTop = 100000, t = towerModes(L, D, D, tw, tw, mTop, 200);
  const Di = D - 2 * tw, I = (Math.PI / 64) * (D ** 4 - Di ** 4), m = 8500 * (Math.PI / 4) * (D * D - Di * Di) * L;
  near(t.f1, Math.sqrt((3 * 210e9 * I) / ((mTop + 0.2357 * m) * L ** 3)) / (2 * Math.PI), 0.01 * t.f1, 'f₁ = (1/2π)√(3EI/((M + 0.236 m)L³))');
});

test('drivetrain, tower base, flange and foundation (hand calculation)', () => {
  const d = drivetrain(r, { gen: 'high', d: 0.85 }, 5e6);
  near(d.stage ** 3, d.ratio, 1e-9); near(d.shafts[3].n, 1173.7, 1e-6, 'generator speed');
  near(d.sa, (r.mRotor * 9.81 * 1.9 * 32) / (Math.PI * 0.85 ** 3), 1, 'σ_a = 32M/(πd³)');
  // main shaft by hand at d = 0.7 m: Marin k_a = 4.51·800^−0.265, k_b = 1.51·700^−0.157, DE-Goodman
  const M = r.mRotor * 9.81 * 1.9, Q = r.rated.Q, c = shaftCheck(M, Q, 0.7);
  const Se = 0.5 * 800e6 * 4.51 * 800 ** -0.265 * 1.51 * 700 ** -0.157 * 0.814, sa = (32 * M) / (Math.PI * 0.343), tm = (16 * Q) / (Math.PI * 0.343);
  near(c.Se, Se, 1, 'S_e'); near(c.n, 1 / (sa / Se + (Math.sqrt(3) * tm) / 800e6), 1e-9, 'Goodman n');
  near(c.svm, Math.sqrt(((1.1 * 32 * M) / (Math.PI * 0.343)) ** 2 + 3 * ((1.35 * 16 * Q) / (Math.PI * 0.343)) ** 2), 1, 'σ_vM');
  near(shaftLoads(126, 5e6).Q, Q, Q * 1e-3, 'rated torque from P, D'); near(shaftLoads(126, 5e6).M, M, 1e-6);
  // the needed diameter grows with power: 0.5 m is too thin for 5 MW but enough for 2 MW at the same specific power
  assert.ok(!drivetrain(r, { gen: 'high', d: 0.5 }, 5e6).checks.every((x) => x.ok), '0.5 m fails at 5 MW');
  assert.ok(shaftForPower(2e6, r.specific).dReq < 0.5 && shaftForPower(5e6, r.specific).dReq > 0.6, 'd_req(2 MW) < 0.5 m < d_req(5 MW)');
  near(shaftForPower(shaftPowerLimit(0.5, r.specific), r.specific).dReq, 0.5, 1e-3, 'power limit of a 0.5 m shaft');
  near(shaftForPower(5e6, r.specific).dReq, d.dReq, 1e-3, 'same as the drivetrain');
  assert.ok(drivetrain(r, { gen: 'high', d: 0.7 }, 5e6).checks.every((x) => x.ok), 'default 0.7 m passes');
  // direct drive: stationary hollow shaft, cantilever from the neck flange, by hand
  const W = r.mRotor * 9.81, mG = driveMasses('direct', Q / 1e3, 5e3).generator, k = kingpinCheck(W, mG, 1, 0.6);
  const I = (Math.PI * 0.6 ** 4 * (1 - 0.6 ** 4)) / 64, Wg = 0.4 * mG * 9.81, a = DD.root, x = DD.root - DD.gen0 - DD.genL / 2;
  near(k.Mroot, W * a + Wg * x, 1e-6, 'root moment'); near(k.sk, (1.1 * k.Mroot * 0.3) / I, 1, 'σ = 1.1 M/Z');
  near(k.delta, ((W * x * x * (3 * a - x)) / 6 + (Wg * x ** 3) / 3) / (210e9 * I), 1e-12, 'deflection at the generator');
  const dd = drivetrain(r, { gen: 'direct', d: 0.6 }, 5e6);
  assert.ok(dd.dReq < d.dReq, 'no torque, no rotation: the stationary shaft is thinner than the geared main shaft');
  assert.ok(dd.checks.every((x) => x.ok) && !drivetrain(r, { gen: 'direct', d: 0.45 }, 5e6).checks.every((x) => x.ok), 'direct drive 0.6 m passes, 0.45 m fails');
  near(driveMasses('high', 4000, 5000).gearbox, 70.94 * 4000 ** 0.759, 1e-9);
  assert.equal(drivetrain(r, { gen: 'direct', d: 0.85 }, 5e6).ratio, 1);
  const t = tower(r, { Db: 6, tb: 0.0351, nb: 100, bolt: 'M48' }, 90);
  near(t.Mb, 1.35 * r.peakT.T * 90, 1e-6); near(t.Fbolt, (4 * t.Mb) / (100 * 5.85) - t.Nb / 100, 1e-6, 'bolt force');
  near(t.FtRd, (0.9 * 1000 * 1473) / 1.25, 1e-6, 'F_t,Rd');
  assert.ok(t.checks.every((c) => c.ok), t.checks.filter((c) => !c.ok).map((c) => `${c.label} ${c.detail}`).join('; '));
  near(revolvedVolume([[0, 0], [2, 0], [2, 3], [0, 3]]), Math.PI * 4 * 3, 1e-9, 'cylinder by Pappus');
  near(revolvedVolume([[0, 0], [2, 0], [0, 3]]), (Math.PI * 4 * 3) / 3, 1e-9, 'cone by Pappus');
  near(revolvedVolume([[0, -2], [2, -2], [2, 1], [0, 1]], 0), Math.PI * 4 * 2, 1e-9, 'part below ground');
  for (const type of ['slab', 'dome'] as const) {
    const g = foundation(r, t, { type, B: 22, Df: type === 'dome' ? 4.5 : 3, soil: 'dense' }, 90);
    near(g.Gf, 25e3 * g.vol + 18e3 * g.soilOn, 1e-6, `${type} weight`);
    assert.ok(g.checks.every((c) => c.ok), `${type}: ` + g.checks.filter((c) => !c.ok).map((c) => `${c.label} ${c.detail}`).join('; '));
  }
  const f = foundation(r, t, { type: 'slab', B: 22, Df: 3, soil: 'dense' }, 90);
  near(f.e, f.M / f.V, 1e-12); near(f.FSot, (f.V * 11) / f.M, 1e-12);
  assert.ok(f.checks.every((c) => c.ok), f.checks.filter((c) => !c.ok).map((c) => `${c.label} ${c.detail}`).join('; '));
  assert.ok(!chk(foundation(r, t, { type: 'slab', B: 14, Df: 3, soil: 'dense' }, 90).checks, 'No gap under the footing').ok, 'a small footing lifts off');
  // footing structure, hand calculation: flat 1 m slab, no moment → uniform net pressure V/A − 25 kN/m³ × 1 m
  const R = 8, pr = 3, V = 20e6, net = V / (Math.PI * 64) - 25e3, sl = footingSlab([[0, -1], [R, -1], [R, 0], [pr, 0], [pr, 0.4], [0, 0.4]], 16, 1, pr, V, 0);
  near(sl.K, (1.35 * net * 25) / 2 / (0.81 * 35e6), 1e-6, 'K at the face'); near(sl.v, (1.35 * net * 5) / 0.9 / 1e6, 1e-6, 'v at the face');
  near(sl.vRd, Math.max(0.12 * (1 + Math.sqrt(200 / 900)) * Math.cbrt(0.5 * 35), 0.035 * (1 + Math.sqrt(200 / 900)) ** 1.5 * Math.sqrt(35)), 1e-9, 'v_Rd,c');
  // a heavy but thin footing is still rejected
  for (const type of ['slab', 'dome'] as const) { const c = foundation(r, t, { type, B: 30, Df: 0.6, soil: 'dense' }, 90).checks; assert.ok(chk(c, 'Overturning').ok && (!chk(c, 'Footing thick enough').ok || !chk(c, 'Footing shear').ok), `thin ${type}: stable but structurally rejected`); }
});

test('every stage rejects a turbine that cannot exist (owner: 15 MW on a 20 m rotor passed the drivetrain)', () => {
  const bad = rotor({ D: 20, P: 15e6, H: 90, vMean: 8, k: 2, loss: 0.12, vOp: 10 });
  assert.ok(!chk(bad.checks, 'Specific power').ok && !chk(bad.checks, 'Rated wind speed').ok, 'rotor tab');
  const d = drivetrain(bad, { gen: 'high', d: 2 }, 15e6);
  assert.ok(!d.checks.every((c) => c.ok) && !chk(d.checks, 'Specific power').ok, 'drivetrain tab');
  const t = tower(bad, { Db: 6, tb: 0.04, nb: 120, bolt: 'M64' }, 90);
  assert.ok(!chk(t.checks, 'Rated wind speed').ok, 'tower tab');
  assert.ok(!chk(foundation(bad, t, { type: 'slab', B: 30, Df: 3, soil: 'dense' }, 90).checks, 'Specific power').ok, 'foundation tab');
  // a low hub with a large rotor: the tip hits the ground — on the tower and foundation tabs too
  const low = rotor({ D: 126, P: 5e6, H: 70, vMean: 8, k: 2, loss: 0.12, vOp: 10 });
  assert.ok(!chk(tower(low, { Db: 6, tb: 0.0351, nb: 100, bolt: 'M48' }, 70).checks, 'Blade tip').ok);
});
