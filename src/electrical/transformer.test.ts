import { test } from 'node:test';
import assert from 'node:assert/strict';
import { efficiency, RATINGS, regulation, transformer, type TrIn } from './transformer.ts';
import { fusing, ipcCurrent, ipcRise, minSpacing, pcb, widthFor, MIL, OZ, type PcbIn } from './pcb.ts';

const near = (a: number, b: number, tol: number, w = '') => assert.ok(Math.abs(a - b) <= tol, `${w}: ${a} vs ${b}`);
export const TR_DEF: TrIn = { S: 400, U1: 20, U2: 400, Pk: 3250, P0: 387, uk: 4, beta: 0.8, pf: 0.9, lead: false, hours: 3000, price: 0.15 };
export const PCB_DEF: PcbIn = { I: 3, dTmax: 20, oz: 1, layer: 'outer', w: 1, L: 50, Ta: 25, V: 24, gap: 0.3, coated: false, viaD: 0.3, board: 1.6 };

test('transformer by hand: currents, turns ratio, impedance, regulation, efficiency', () => {
  const r = transformer({ ...TR_DEF, beta: 1, pf: 0.8 });
  near(r.I2, 400e3 / (Math.sqrt(3) * 400), 1e-9, 'I2');                 // 577.4 A
  near(r.I1, 400e3 / (Math.sqrt(3) * 20e3), 1e-9, 'I1');                // 11.55 A
  near(r.N, 20000 / (400 / Math.sqrt(3)), 1e-9, 'Dyn11 turns ratio');   // 86.6
  near(r.ur, 0.008125, 1e-12, 'u_r'); near(r.ux, Math.sqrt(0.04 ** 2 - 0.008125 ** 2), 1e-12, 'u_x');
  // exact phasor result against the IEC 60076-1 approximation ε ≈ a + b²/2 (per unit)
  const a = 0.008125 * 0.8 + r.ux * 0.6, b = r.ux * 0.8 - 0.008125 * 0.6;
  near(r.reg.reg, a + (b * b) / 2, 2e-6, 'regulation'); near(r.reg.reg, 0.03035, 1e-4, '≈ 3.0 %');
  near(r.eta, 320e3 / (320e3 + 387 + 3250), 1e-12, 'η');                // 98.88 %
  near(r.Ik, r.I2 / 0.04, 1e-9, 'I_k');                                 // 14.4 kA
  // leading load can raise the voltage above no load
  assert.ok(regulation(1, 0.2, true, 0.008, 0.039).V > 1);
  // unity power factor: drop is mostly the resistive part
  near(regulation(1, 1, false, 0.01, 0.04).reg, 0.01 + 0.04 ** 2 / 2, 1e-4, 'cos φ = 1');
});

test('maximum efficiency where copper loss equals iron loss', () => {
  const r = transformer(TR_DEF);
  near(r.betaOpt ** 2 * TR_DEF.Pk, TR_DEF.P0, 1e-9, 'P_cu = P_0');
  for (const d of [-0.05, 0.05]) assert.ok(efficiency(400, r.betaOpt + d, 0.9, 387, 3250) < r.etaMax);
  assert.ok(r.checks.every((c) => c.ok), JSON.stringify(r.checks.filter((c) => !c.ok)));
  near(r.Eloss, 387 * 8.76 + 3250 * 3, 1e-6, 'yearly kWh');
});

test('every rating with its defaults passes at 80 % load', () => {
  for (const x of RATINGS) {
    const r = transformer({ ...TR_DEF, S: x.S, Pk: x.Pk, P0: x.P0, uk: x.S <= 630 ? 4 : 6 });
    assert.ok(r.checks.every((c) => c.ok), `${x.S}: ${JSON.stringify(r.checks.filter((c) => !c.ok))}`);
  }
});

test('PCB trace by hand: IPC-2221 width, resistance, fusing, spacing', () => {
  // 1 A, 10 K, 1 oz outer → about 12 mil (the usual chart value)
  near(widthFor(1, 10, 1, 'outer') / 25.4e-3, 11.8, 0.2, '1 A width in mil');
  // inner layers need A·2^(1/0.725) for the same current
  near(widthFor(1, 10, 1, 'inner') / widthFor(1, 10, 1, 'outer'), Math.pow(2, 1 / 0.725), 1e-9, 'inner / outer');
  near(ipcRise(2, 100, 'outer'), Math.pow(2 / (0.048 * Math.pow(100, 0.725)), 1 / 0.44), 1e-12, 'rise');
  near(ipcCurrent(100, ipcRise(2, 100, 'outer'), 'outer'), 2, 1e-9, 'round trip');
  const r = pcb(PCB_DEF);
  const A = 1e-3 * OZ; near(r.R, (1.724e-8 * (1 + 0.00393 * (r.T - 20)) * 0.05) / A, 1e-12, 'R');
  near(r.dU, 3 * r.R, 1e-12, 'ΔU');
  // Onderdonk, 1 s, 25 °C: I = A_cmil √(lg(1058/259 + 1)/33)
  const cmil = (A / (MIL * MIL)) * 4 / Math.PI; near(fusing(A, 1, 25), cmil * Math.sqrt(Math.log10(1058 / 259 + 1) / 33), 1e-9, 'fusing');
  assert.equal(minSpacing(24, 'B2'), 0.1); assert.equal(minSpacing(230, 'B2'), 1.25); assert.equal(minSpacing(1000, 'B2'), 5);
  assert.ok(r.checks.every((c) => c.ok), JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.equal(pcb({ ...PCB_DEF, w: 0.5 }).checks[0].ok, false);
});

test('slider ends give numbers', () => {
  for (const e of [{ beta: 0 }, { beta: 1.5 }, { pf: 0.1 }, { pf: 1, lead: true }, { uk: 1 }, { P0: 1 }, { S: 25, Pk: 600, P0: 63 }] as Partial<TrIn>[]) {
    const r = transformer({ ...TR_DEF, ...e }); for (const v of [r.eta, r.reg.V, r.Ik, r.etaMax]) assert.ok(Number.isFinite(v), JSON.stringify(e));
  }
  for (const e of [{ I: 0.05 }, { I: 50 }, { w: 0.05 }, { w: 20 }, { dTmax: 1 }, { V: 2000 }, { oz: 0.5, layer: 'inner' }] as Partial<PcbIn>[]) {
    const r = pcb({ ...PCB_DEF, ...e }); for (const v of [r.dT, r.R, r.wReq, r.Ifuse1, r.sMin, r.nVia]) assert.ok(Number.isFinite(v), JSON.stringify(e));
  }
});
