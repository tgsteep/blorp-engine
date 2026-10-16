import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blast, konyaBurden, passing, ppv, uniformity, x50, type BlastIn } from './blast.ts';
import { atkinson, fanP, parallelR, ventilation, type VentIn } from './ventilation.ts';
import { haulage, segSpeed, type HaulIn } from './haulage.ts';

const near = (a: number, b: number, tol: number, w = '') => assert.ok(Math.abs(a - b) <= tol, `${w}: ${a} vs ${b}`);
export const BLAST_DEF: BlastIn = { rock: 'limestone', exp: 'anfo', d: 102, H: 10, kB: 1, sb: 1.15, tb: 0.75, jb: 0.3, rows: 3, perRow: 10, dev: 0.2, wet: false, xmax: 0.8, R: 400, ppvMax: 10 };
export const VENT_DEF: VentIn = { kind: 'metal', D: 500, Ds: 5, ks: 0.004, Ld: 1500, w: 5.5, h: 5, kd: 0.012, n: 3, Lp: 300, kp: 0.015, shock: 0.1, Qr: 120, pr: 1800, speed: 1, eta: 0.8, diesel: 1500, people: 60, ch4: 3, Ts: 15, Tr: 25, price: 0.12 };
export const HAUL_DEF: HaulIn = { truck: 'rigid90', N: 4, bucket: 12, fill: 0.9, rhoL: 1.8, loaderCycle: 35, L1: 300, L2: 1200, G: 8, L3: 500, RR: 2.5, vlim: 40, spot: 0.7, dump: 1.0, eff: 0.83, target: 1000, fuelPrice: 1.2 };

test('blasting by hand: Konya burden, charge, powder factor, Kuz-Ram and scaled distance', () => {
  near(konyaBurden(0.82, 2.6, 102), 0.012 * (2 * 0.82 / 2.6 + 1.5) * 102, 1e-12, 'Konya');
  const r = blast(BLAST_DEF), B = r.B;
  near(B, 2.608, 0.01, 'B ≈ 2.6 m'); near(r.S, 1.15 * B, 1e-12); near(r.L, 10 + 0.3 * B, 1e-12);
  near(r.lin, Math.PI * 0.102 ** 2 / 4 * 820, 1e-9, 'kg/m'); near(r.Q, r.lin * (r.L - 0.75 * B), 1e-9, 'charge');
  near(r.K, r.Q / (B * r.S * 10), 1e-12, 'powder factor'); assert.ok(r.K > 0.3 && r.K < 0.9, `q ${r.K}`);
  // Kuz-Ram: X50 = A K^-0.8 Q^(1/6) (115/E)^(19/30) cm; passing at X50 is 50 %
  near(x50(7, 0.5, 64, 100), (7 * 0.5 ** -0.8 * 64 ** (1 / 6) * 1.15 ** (19 / 30)) / 100, 1e-12, 'X50');
  near(passing(0.3, 0.3, 1.4), 0.5, 0.001, '50 % at X50');
  near(uniformity(3, 100, 3.6, 0.3, 8, 10), (2.2 - 0.42) * 0.9 * 1.1 * 0.8, 1e-12, 'n');
  near(ppv(100, 25), 1140 * 20 ** -1.6, 1e-9, 'PPV'); near(ppv(r.Rmin, r.Q), 10, 1e-6, 'distance at the limit');
  assert.ok(r.checks.every((c) => c.ok), JSON.stringify(r.checks.filter((c) => !c.ok)));
  // larger burden → coarser, wetter ANFO fails
  assert.ok(blast({ ...BLAST_DEF, kB: 1.3 }).X50 > r.X50); assert.equal(blast({ ...BLAST_DEF, wet: true }).checks[7].ok, false);
});

test('ventilation by hand: Atkinson resistance, parallel panels, fan operating point, requirement', () => {
  near(atkinson(0.012, 20, 1000, 25), 0.012 * 20 * 1000 / 15625, 1e-12, 'R');
  near(parallelR([0.4, 0.4, 0.4, 0.4]), 0.4 / 16, 1e-12, 'four equal branches = R/n²');
  near(fanP(150, 150, 2000, 1), 2000, 1e-9, 'rated duty'); near(fanP(0, 150, 2000, 0.5), 750, 1e-9, 'fan law p ∝ n²');
  const r = ventilation(VENT_DEF);
  near(r.pf + r.NVP, r.R * r.Q * r.Q, 1e-6, 'fan + natural pressure = mine pressure');
  near(r.parts.reduce((s, a) => s + a.dp, 0), r.R * r.Q * r.Q, 1e-6, 'pressure drops add up');
  assert.ok(r.NVP > 0, 'warm return air helps');
  near(r.req.diesel, 90, 1e-9, '0.06 m³/s per kW');
  assert.ok(r.checks.every((c) => c.ok), JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.ok(ventilation({ ...VENT_DEF, speed: 0.8 }).Q < r.Q, 'slower fan, less air');
  const c = ventilation({ ...VENT_DEF, kind: 'coal', ch4: 60 }); near(c.req.ch4, 1 / 0.0075, 1e-9, 'methane dilution');
});

test('haulage by hand: power-limited speed, passes, cycle, match factor', () => {
  // 158 t gross on 8 % + 2.5 % at 0.8 × 750 kW → v = 600000/(158000·9.81·0.105)
  near(segSpeed(158, 0.105, 750, 1300, 60, 40), 600000 / (158000 * 9.81 * 0.105), 1e-9, 'uphill');
  near(segSpeed(68, -0.055, 750, 1300, 60, 40), 40 / 3.6, 1e-9, 'downhill capped by the speed limit');
  const r = haulage(HAUL_DEF);
  assert.equal(r.passes, 5); near(r.load, 5 * 12 * 0.9 * 1.8, 1e-9, 'load');
  near(r.cycle, 0.7 + r.tLoad + r.tHaul + 1 + r.tRet, 1e-9, 'cycle'); near(r.MF, 4 * r.tLoader / r.cycle, 1e-12, 'MF');
  assert.ok(r.tHaul > r.tRet, 'loaded uphill is slower');
  assert.ok(haulage({ ...HAUL_DEF, N: 20 }).prod <= r.loaderMax + 1e-9, 'loader caps the production');
  assert.ok(r.checks.every((c) => c.ok), JSON.stringify(r.checks.filter((c) => !c.ok)));
});
