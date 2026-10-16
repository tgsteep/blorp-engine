import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AE_RANGE, atThrust, bestPitch, bseries, cubics, etaOpen, jZero, keller } from './bseries.ts';
import { bladeSection, openWater, preset, shipProp } from './propeller.ts';
import { holtrop, RES_PRESETS } from './resistance.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

// Helma (2020), "Surprising behaviour of the Wageningen B-screw series polynomials", J. Mar. Sci. Eng. 8(3) 211,
// section 3.1: operating points read from the polynomials, stated as J, K_T, K_Q, P/D, η_O.
test('VALIDATION (Helma 2020, section 3.1 examples): B5-90 and B3-80 operating points', () => {
  for (const [Z, AE, J, PD, KT, KQ, eta] of [
    [5, 0.9, 0.65, 1.04, 0.24, 0.041, 0.6],
    [3, 0.8, 0.62, 1.0, 0.2, 0.035, 0.57],
    [3, 0.8, 0.74, 1.3, 0.295, 0.062, 0.56],
  ]) {
    const k = bseries(J, PD, AE, Z);
    near(k.KT, KT, 0.006, `K_T B${Z}-${AE * 100}`);
    near(k.KQ, KQ, 0.001, `K_Q B${Z}-${AE * 100}`);
    near(etaOpen(J, k.KT, k.KQ), eta, 0.01, `η_O B${Z}-${AE * 100}`);
  }
});

test('VALIDATION (Holtrop & Mennen 1982, numerical example): B-series η_O at the best pitch', () => {
  const r = holtrop(RES_PRESETS.example);
  const b = bestPitch(r.thrust, r.VA, 8, r.AEA0, 4);
  near(b.eta, 0.6461, 0.004, 'η_O');
  near(r.etaO, b.eta, 1e-9, 'resistance tool uses the same value');
});

test('polynomial: cubic form equals the term sum, K_T falls with J, K_T and K_Q grow with pitch', () => {
  const c = cubics(1, 0.7, 4);
  near(c.kt[0], bseries(0, 1, 0.7, 4).KT, 1e-12, 'K_T at J = 0');
  near(bseries(0, 1, 0.7, 4).KT, 0.4547, 0.001, 'B4-70 P/D 1 bollard K_T');
  let prev = Infinity;
  for (let J = 0; J <= 0.9; J += 0.1) { const k = bseries(J, 1, 0.7, 4).KT; assert.ok(k < prev, `K_T falls at J ${J}`); prev = k; }
  assert.ok(bseries(0.5, 1.2, 0.7, 4).KT > bseries(0.5, 0.8, 0.7, 4).KT && bseries(0.5, 1.2, 0.7, 4).KQ > bseries(0.5, 0.8, 0.7, 4).KQ);
  const J0 = jZero(1, 0.7, 4);
  near(bseries(J0, 1, 0.7, 4).KT, 0, 1e-9, 'K_T = 0 at J0'); assert.ok(J0 > 0.95 && J0 < 1.15, `J0 ${J0}`);
});

test('operating point: thrust balance T = ρn²D⁴K_T, power = TV_A/η_O, best pitch beats its neighbours', () => {
  const T = 400e3, VA = 5.5, D = 5.6, AE = 0.55, Z = 4, rho = 1025;
  const o = atThrust(T, VA, D, 1.0, AE, Z, rho);
  near(rho * o.n ** 2 * D ** 4 * o.KT, T, 1, 'thrust');
  near(o.KT, o.c * o.J * o.J, 1e-9, 'on the demand parabola');
  near(o.P, (T * VA) / o.eta, 1, 'P_D = T V_A/η_O');
  const b = bestPitch(T, VA, D, AE, Z, rho);
  for (const d of [-0.1, 0.1]) assert.ok(atThrust(T, VA, D, b.PD + d, AE, Z, rho).eta <= b.eta + 1e-9);
  // a larger, slower propeller is more efficient
  assert.ok(bestPitch(T, VA, 1.2 * D, AE, Z, rho).eta > b.eta);
  // Keller: hand calculation for 4 blades, 400 kN, D 5.6 m, 5 m shaft depth, single screw
  near(keller(T, D, 4, 5, 1), (2.5 * 400e3) / (5.6 ** 2 * (99625 + 1025 * 9.81 * 5)) + 0.2, 1e-12, 'Keller');
});

test('tool: presets from the resistance ships pass every check; open-water curve and outline are finite', () => {
  for (const k of ['example', 'cargo', 'tug', 'yacht'] as const) {
    const p = preset(k), r = shipProp(p);
    assert.ok(r.checks.every((c) => c.ok), `${k}: ${r.checks.filter((c) => !c.ok).map((c) => c.label)}`);
    assert.ok(p.AE >= AE_RANGE[p.Z][0] && p.AE <= AE_RANGE[p.Z][1]);
    near(r.P, (p.T * r.VA) / r.eta, 1, `${k} power`);
  }
  for (const q of openWater(1.0, 0.7, 4)) assert.ok(Number.isFinite(q.KT) && Number.isFinite(q.eta));
  for (let x = 0.2; x <= 1.0001; x += 0.05) { const s = bladeSection(Math.min(x, 1), 8, 0.7, 4); assert.ok(s.c >= 0 && s.t > 0 && Number.isFinite(s.le)); }
  // blade area of the outline ≈ the nominal A_E/A_0 (outline integrated, hub to tip)
  let A = 0; const N = 200; for (let i = 0; i < N; i++) { const x = 0.2 + (0.8 * (i + 0.5)) / N; A += bladeSection(x, 8, 0.7, 4).c * ((0.8 * 4) / N); }
  near((4 * A) / (Math.PI * 16), 0.7, 0.07, 'outline area ratio');
});

test('slider ends: an impossible operating point shows no number and fails a check', () => {
  const p = preset('cargo');
  const r = shipProp({ ...p, T: 1e9 });
  assert.ok(Number.isFinite(r.rpm) && r.rpm > 0, 'huge thrust: just a very fast propeller');
  const z = shipProp({ ...p, V: 0 });
  assert.ok(!z.reach && z.checks.some((c) => !c.ok), 'no advance speed: bollard pull is outside this tool');
});
