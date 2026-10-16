import { test } from 'node:test';
import assert from 'node:assert/strict';
import { battery, BATT_DEFAULTS, capacityAt, CELLS, CHEMS, chargeCell, cycleLife, dischargeCell, ocv, type BattIn, type Cell } from './battery.ts';

const near = (a: number, b: number, tol: number, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (±${tol})`);

test('Peukert by hand: 100 Ah (20 h) with k = 1.2 at 10 A lasts 8.7 h', () => {
  const cell: Cell = { ...CELLS.lead, C: 100, peukert: 1.2 };
  const C = capacityAt(cell, 10);
  near(C, 100 * Math.pow(0.5, 0.2), 1e-9, 'capacity');
  near(C / 10, 8.7, 0.01, 'hours');
  assert.equal(capacityAt(CELLS.lfp, 500), CELLS.lfp.C); // lithium: no Peukert effect in this model
});

test('discharge without resistance gives the integral of the open-circuit voltage', () => {
  const cell: Cell = { ...CELLS.nmc, R: 1e-9 };
  const r = dischargeCell(cell, 1, 1, 0.1);
  let e = 0; const n = 2000; for (let i = 0; i < n; i++) { const s = 0.1 + (0.9 * (i + 0.5)) / n; e += ocv(cell, s) * (0.9 / n) * cell.C; }
  near(r.E, e, e * 0.003, 'Wh');
  assert.equal(r.cut, false);
});

test('one LFP cell at 1C: current from P = (U − IR) I, voltage sag I R', () => {
  const c = CELLS.lfp, U = ocv(c, 0.5), P = 280 * 3.2;
  const r = dischargeCell(c, P, 0.5, 0.4), I = r.curve[0].I;
  near(P, (U - I * c.R) * I, 1e-6, 'power balance');
  near(r.curve[0].V, U - I * c.R, 1e-9, 'sag');
});

test('faster is less efficient; charging ends in constant voltage near full', () => {
  const slow = battery({ ...BATT_DEFAULTS.nmc, Pdis: 2e3, Pch: 2e3 }), fast = battery({ ...BATT_DEFAULTS.nmc, Pdis: 20e3, Pch: 20e3 });
  assert.ok(fast.etaDC < slow.etaDC);
  assert.ok(chargeCell(CELLS.nmc, 4.2 * 4.9, 0.1, 1).cv);
});

test('series for the voltage, parallel for the energy', () => {
  const r = battery(BATT_DEFAULTS.lfp);
  assert.equal(r.Ns, 16); // 51.2 V / 3.2 V
  assert.ok(r.Eout >= BATT_DEFAULTS.lfp.E);
  const big = battery({ ...BATT_DEFAULTS.lfp, E: 100e3 });
  assert.ok(big.Np >= 7 && big.Eout >= 100e3);
  near(battery({ ...BATT_DEFAULTS.lfp, Vsys: 800 }).Vpack.nom, 250 * 3.2, 1e-9, '800 V pack');
});

test('cycle life power law through the datasheet point', () => {
  near(cycleLife(CELLS.lfp, 0.8), 6000, 1e-9, 'reference');
  near(cycleLife(CELLS.lead, 0.25), 600 * 2 ** 1.3, 1e-6, 'half depth');
});

test('defaults pass their checks; slider ends give numbers', () => {
  for (const k of CHEMS) {
    const bad = battery(BATT_DEFAULTS[k]).checks.filter((c) => !c.ok).map((c) => `${c.label} (${c.detail})`);
    assert.deepEqual(bad, [], k);
  }
  const ends: Partial<BattIn>[] = [{ E: 1e3 }, { E: 5e6 }, { Pdis: 100 }, { Pdis: 5e6 }, { Pch: 100 }, { Pch: 5e6 }, { Vsys: 12 }, { Vsys: 1500 }, { socMin: 0 }, { socMax: 0.5 }, { cyclesDay: 0.05 }, { cyclesDay: 4 }];
  for (const k of CHEMS) for (const e of ends) {
    const r = battery({ ...BATT_DEFAULTS[k], ...e });
    for (const [n, v] of Object.entries({ Eout: r.Eout, Ein: r.Ein, eta: r.etaDC, t: r.tDis, I0: r.I0, mass: r.mass, years: r.years })) assert.ok(Number.isFinite(v), `${k} ${JSON.stringify(e)} ${n} = ${v}`);
  }
});
