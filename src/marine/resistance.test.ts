import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holtrop, resistance, RES_PRESETS, speedAtFn, type ResIn } from './resistance.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
const rel = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a / b - 1) <= tol, `${msg}: ${a} vs ${b} (±${tol * 100} %)`);

// Holtrop & Mennen (1982), numerical example: L 205 m (waterline), B 32 m, T 10 m, ∇ 37 500 m³, lcb −0.75 % L,
// A_BT 20 m², h_B 4 m, C_M 0.98, C_WP 0.75, A_T 16 m², S_APP 50 m² (1 + k₂ = 1.5), C_stern 10, D 8 m, Z 4, 25 kn.
const EX: ResIn = { ...RES_PRESETS.example };

test('VALIDATION (Holtrop & Mennen 1982, numerical example): resistance components at 25 kn', () => {
  const r = holtrop(EX);
  near(r.vol, 37500, 1, '∇');
  near(r.CP, 0.5833, 0.0001, 'C_P');
  near(r.Fn, 0.2868, 0.0002, 'F_n');
  near(r.iE, 12.08, 0.02, 'half angle of entrance (Holtrop 1984 formula)');
  near(r.k1, 1.156, 0.001, '1 + k₁');
  near(r.c12, 0.5102, 0.0002, 'c₁₂');
  near(r.S, 7381.45, 1, 'wetted surface');
  near(r.CF, 0.001390, 0.000002, 'C_F');
  rel(r.RF, 869.63e3, 0.002, 'R_F');
  rel(r.RAPP, 8.83e3, 0.005, 'R_APP');
  near(r.c1, 1.398, 0.002, 'c₁'); near(r.c2, 0.7595, 0.0005, 'c₂'); near(r.c5, 0.9592, 0.0002, 'c₅');
  near(r.lam, 0.6513, 0.0002, 'λ'); near(r.m1, -2.127, 0.002, 'm₁'); near(r.m2, -0.1708, 0.0005, 'm₂');
  rel(r.RW, 557.11e3, 0.005, 'R_W');
  near(r.RB, 0.05e3, 0.02e3, 'R_B (bulb deep enough: almost nothing)');
  near(r.RTR, 0, 1e-9, 'R_TR (transom dry at 25 kn)');
  near(r.CA, 0.000352, 0.000002, 'C_A');
  rel(r.RA, 221.98e3, 0.01, 'R_A');
  rel(r.RT, 1793.26e3, 0.002, 'R_T');
  rel(r.PE, 23063e3, 0.002, 'P_E');
});

test('VALIDATION (Holtrop & Mennen 1982, numerical example): propulsion factors', () => {
  const r = holtrop(EX);
  near(r.CP1, 0.5477, 0.0002, 'C_P1');
  near(r.w, 0.2584, 0.003, 'wake fraction w');
  near(r.t, 0.1747, 0.0005, 'thrust deduction t');
  near(r.etaR, 0.9931, 0.003, 'relative-rotative efficiency η_R (Keller blade area)');
  // paper: η_O = 0.6461 from the B-series (4 blades, Keller blade area, best pitch)
  near(r.etaO, 0.6461, 0.004, 'B-series open-water efficiency η_O');
});

test('resistance grows with speed, components add up, power = R·V', () => {
  const s = resistance(EX);
  for (let i = 1; i < s.curve.length; i++) assert.ok(s.curve[i].RT > s.curve[i - 1].RT, `R_T rises at ${s.curve[i].Vkn.toFixed(1)} kn`);
  const r = holtrop(EX, 18);
  near(r.RT, r.RF * r.k1 + r.RAPP + r.RW + r.RB + r.RTR + r.RA, 1e-6, 'sum of components');
  near(r.PE, r.RT * r.V, 1e-6, 'P_E = R_T V');
  near(r.etaD, r.etaO * r.etaH * r.etaR, 1e-12, 'η_D');
  // friction dominates at low speed, wave resistance grows faster
  const lo = holtrop(EX, 8), hi = holtrop(EX, 25);
  assert.ok(lo.RW / lo.RT < 0.1 && hi.RW / hi.RT > 0.25);
  // fuel per mile falls when the ship slows down (slow steaming)
  assert.ok(holtrop(EX, 18).fuelNm < holtrop(EX, 25).fuelNm);
});

test('hand checks: Froude speed, transom wet at low speed, no bulb terms without a bulb', () => {
  near(speedAtFn(100, 0.3), (0.3 * Math.sqrt(9.81 * 100)) / (1852 / 3600), 1e-9);
  const slow = holtrop(EX, 8);
  assert.ok(slow.RTR > 0, 'transom immersed at 8 kn (F_nT < 5) has a pressure resistance');
  const noBulb = holtrop({ ...EX, ABT: 0 });
  assert.equal(noBulb.RB, 0); near(noBulb.c2, 1, 1e-12, 'c₂ = 1 without a bulb');
});

test('presets: the example and the cargo ship pass all checks; the barge is outside the method', () => {
  assert.ok(resistance(RES_PRESETS.example).checks.every((c) => c.ok));
  assert.ok(resistance(RES_PRESETS.cargo).checks.every((c) => c.ok));
  assert.ok(resistance(RES_PRESETS.tug).checks.every((c) => c.ok), 'tug');
  assert.ok(resistance(RES_PRESETS.yacht).checks.every((c) => c.ok), 'yacht');
  assert.equal(resistance(RES_PRESETS.barge).checks.find((c) => c.label.startsWith('Prismatic'))!.ok, false);
});

test('Kelvin pattern: nothing ahead of the bow or outside the 19.47° wedge; transverse waves of length 2πV²/g', async () => {
  const { kelvin, waveLength, KELVIN_HALF } = await import('./resistance.ts');
  const L = 100, V = 8, lam = waveLength(V);
  near((KELVIN_HALF * 180) / Math.PI, 19.47, 0.01, 'wedge half angle');
  assert.equal(kelvin(L / 2 + 5, 0, L, V), 0, 'ahead of the bow');
  const d = 3 * L, outside = Math.tan(KELVIN_HALF) * 1.02 * d; // beyond the wider (bow) wedge
  assert.equal(kelvin(L / 2 - d, outside, L, V), 0, 'outside the wedge of both sources');
  // along the track far behind, the bow system alone repeats every λ (stern source shifted by L, same period)
  const x0 = -L / 2 - 4 * L, a = kelvin(x0, 0, L, V), b = kelvin(x0 - lam, 0, L, V);
  near(a, b, 0.08 * Math.max(Math.abs(a), 0.2), 'period λ along the track');
  near(lam, (2 * Math.PI * 64) / 9.81, 1e-9);
});

test('slider ends: no NaN point in the curve, and a result that is not a number never passes all checks', () => {
  const ranges: Record<string, [number, number]> = { L: [10, 350], B: [2, 60], T: [0.5, 25], CB: [0.35, 0.9], CM: [0.6, 1], CWP: [0.6, 0.98], lcb: [-6, 6], ABT: [0, 60], AT: [0, 40], SAPP: [0, 200], k2: [1.3, 3], D: [0.3, 12] };
  for (const kind of Object.keys(RES_PRESETS) as (keyof typeof RES_PRESETS)[]) {
    const { depth, a, ...base } = RES_PRESETS[kind]; void depth; void a;
    for (const [k, [lo, hi]] of Object.entries(ranges)) for (const f of [0, 0.5, 1]) {
      const r = resistance({ ...base, [k]: lo + (hi - lo) * f });
      for (const q of r.curve) assert.ok(Number.isFinite(q.RT) && q.RT >= 0 && Number.isFinite(q.PB) && q.PB > 0, `${kind} ${k}: curve point`);
      if (!Number.isFinite(r.RT) || !Number.isFinite(r.PB)) assert.ok(r.checks.some((c) => !c.ok), `${kind} ${k}=${lo + (hi - lo) * f}: broken result passes`);
    }
  }
});
