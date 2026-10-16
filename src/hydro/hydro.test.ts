import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  driveFor, flowExceeded, francis, hydro, HYDRO_PRESETS, normInv, nQE, pelton, penstockLoss, selectTurbine, surgeHead, thoma,
  turbineEta, waveSpeed, type HydroIn,
} from './hydro.ts';

const near = (a: number, b: number, tol: number, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (±${tol})`);

test('VALIDATION (ESHA Guide on how to develop a small hydropower plant, Penche 2004, ch. 6 examples): specific speed and runner sizes', () => {
  // 400 m, 0.42 m³/s at 1000 rpm: n_QE = 0.022, one-nozzle Pelton with D₁ = 0.815 m
  near(nQE(1000, 0.42, 400), 0.022, 0.0005, 'n_QE 400 m');
  near(pelton(0.42, 400, 1000, 1).D1, 0.815, 0.002, 'Pelton D1 400 m');
  // 200 m, 1.5 m³/s, one-nozzle Pelton at 333 rpm: n_QE = 0.023, D₁ = 1.733, B₂ = 0.547, nozzle 0.217 m
  near(nQE(333, 1.5, 200), 0.023, 0.0005, 'n_QE 333 rpm');
  const p1 = pelton(1.5, 200, 333, 1); // the guide rounds the speed to 333 rpm
  near(p1.D1, 1.733, 0.002, 'D1'); near(p1.B2, 0.547, 0.001, 'B2'); near(p1.De, 0.217, 0.001, 'De');
  // four nozzles at 600 rpm: n_QE = 0.042, D₁ = 0.962, B₂ = 0.274, nozzle 0.108 m
  near(nQE(600, 1.5, 200), 0.042, 0.0005, 'n_QE 600 rpm');
  const p4 = pelton(1.5, 200, 600, 4);
  near(p4.D1, 0.962, 0.001, 'D1 4 jets'); near(p4.B2, 0.274, 0.001, 'B2 4 jets'); near(p4.De, 0.108, 0.001, 'De 4 jets');
  // Francis at 1500 rpm: n_QE = 0.104, D₃ = 0.453, D₁ = D₂ = 0.595, σ = 0.0533
  const n15 = nQE(1500, 1.5, 200), f15 = francis(200, 1500, n15);
  near(n15, 0.104, 0.0005, 'n_QE 1500'); near(f15.D3, 0.453, 0.001, 'D3 1500'); near(f15.D1, 0.595, 0.002, 'D1 1500');
  assert.equal(f15.D2, f15.D1);
  near(thoma('francis', n15, 200), 0.0533, 0.0005, 'sigma 1500');
  // Francis at 1000 rpm: n_QE = 0.069, D₃ = 0.576, D₁ = 1.02, σ = 0.0305
  const n10 = nQE(1000, 1.5, 200), f10 = francis(200, 1000, n10);
  near(n10, 0.069, 0.0005, 'n_QE 1000'); near(f10.D3, 0.576, 0.001, 'D3 1000'); near(f10.D1, 1.02, 0.005, 'D1 1000');
  near(thoma('francis', n10, 200), 0.0305, 0.0003, 'sigma 1000');
});

test('VALIDATION (ESHA guide, Example 2.5): Colebrook–White head loss in 500 m of welded steel pipe at 4 m/s', () => {
  const book: [number, number][] = [[0.5, 17.23], [0.8, 9.53], [1.2, 5.73], [1.5, 4.35]];
  for (const [D, h] of book) {
    const Q = (Math.PI / 4) * D * D * 4;
    const r = penstockLoss({ L: 500, D, mat: 'steel', K: 0 }, Q);
    near(r.v, 4, 1e-9, 'v');
    assert.ok(Math.abs(r.h / h - 1) < 0.02, `D ${D}: ${r.h.toFixed(2)} vs ${h}`);
  }
});

test('turbine choice: high head → Pelton, medium → Francis, low → Kaplan; cross-flow when chosen', () => {
  assert.equal(selectTurbine('auto', 0.42, 400, 0, 0).type, 'pelton');
  const f = selectTurbine('auto', 1.5, 200, 1000, 0);
  assert.equal(f.type, 'francis');
  assert.equal(Math.round(f.rpm), 1000); // 1500 rpm needs the runner below tail water (ESHA: excavation), 1000 rpm does not
  assert.ok(f.Hs > 0);
  assert.equal(selectTurbine('auto', 12, 11, 200, 0).type, 'kaplan');
  const cf = selectTurbine('crossflow', 0.1, 30, 600, 0);
  assert.equal(cf.type, 'crossflow'); assert.ok(cf.inRange);
  near(cf.rpm, (39.85 * Math.sqrt(30)) / 0.4, 1e-9, 'cross-flow speed');
  // a forced type outside its range is still returned (and flagged)
  const forced = selectTurbine('kaplan', 0.42, 400, 0, 0);
  assert.equal(forced.type, 'kaplan'); assert.equal(forced.inRange, false);
});

test('water hammer: Korteweg wave speed, Joukowsky and Michaud by hand', () => {
  // steel D = 1 m, e = 10 mm: c = √(2.1e9/999.7)/√(1 + 2.1e9·1/(206e9·0.01)) = 1449.4/√2.0194 = 1020 m/s
  near(waveSpeed(1, 0.01, 206e9), 1449.37 / Math.sqrt(1 + 2.1e9 / 2.06e9), 0.5, 'c');
  const c = 1000, v = 2, L = 1000;
  near(surgeHead(c, v, L, 1), (c * v) / 9.81, 1e-9, 'Joukowsky'); // 2L/c = 2 s
  near(surgeHead(c, v, L, 10), (2 * L * v) / (9.81 * 10), 1e-9, 'Michaud');
});

test('flow-duration curve: log-normal keeps the mean flow, median below the mean', () => {
  near(normInv(0.975), 1.959964, 1e-5, 'z');
  let s = 0; const N = 20000;
  for (let i = 0; i < N; i++) s += flowExceeded((i + 0.5) / N, 3, 0.8);
  near(s / N, 3, 0.03, 'mean');
  assert.ok(flowExceeded(0.5, 3, 0.8) < 3);
  assert.ok(flowExceeded(0.1, 3, 0.8) > flowExceeded(0.9, 3, 0.8));
});

test('part-load efficiency: zero below the minimum flow, best near 60…90 %', () => {
  assert.equal(turbineEta('francis', 0.3), 0);
  assert.ok(turbineEta('francis', 0.9) > turbineEta('francis', 0.5));
  assert.ok(turbineEta('pelton', 0.2, 4) > 0 && turbineEta('pelton', 0.2, 1) === 0);
});

test('plant: power by hand, energy below the full-load energy, presets pass their checks', () => {
  const p: HydroIn = { ...HYDRO_PRESETS.medium };
  const r = hydro(p);
  const P = 999.7 * 9.81 * p.Qd * r.Hn * r.etaT * r.etaG;
  near(r.P, P, P * 0.002, 'P');
  assert.ok(r.E < r.P * 8760 && r.E > 0);
  assert.ok(r.Hn < p.Hg);
  for (const k of Object.keys(HYDRO_PRESETS) as (keyof typeof HYDRO_PRESETS)[]) {
    const x = hydro(HYDRO_PRESETS[k]);
    const bad = x.checks.filter((c) => !c.ok).map((c) => `${c.label} (${c.detail})`);
    assert.deepEqual(bad, [], `${k}: ${x.sel.type} ${x.sel.rpm.toFixed(0)} rpm`);
  }
});

test('slider ends give numbers, not NaN', () => {
  const ends: Partial<HydroIn>[] = [{ Hg: 1 }, { Hg: 1500 }, { Qd: 0.01 }, { Qd: 300 }, { L: 10 }, { L: 8000 }, { D: 0.1 }, { D: 8 }, { tc: 0.5 }, { Qmean: 0.005 }, { cv: 3 }, { Qres: 50 }, { units: 4 }, { mat: 'hdpe' }, { turbine: 'pelton' }, { turbine: 'crossflow' }];
  for (const e of ends) {
    const r = hydro({ ...HYDRO_PRESETS.medium, ...e });
    for (const [k, v] of Object.entries({ P: r.P, E: r.E, Hn: r.Hn, e: r.pipe.e, c: r.pipe.c, dh: r.pipe.dh, rpm: r.sel.rpm, nqe: r.sel.nqe, CF: r.CF })) assert.ok(Number.isFinite(v), `${JSON.stringify(e)} ${k} = ${v}`);
  }
});

test('drive: speed increaser below 400 rpm up to 5 MW, belt for cross-flow, direct otherwise', () => {
  const g = driveFor('kaplan', 375, 1.3e6);
  assert.equal(g.kind, 'gearbox'); assert.equal(g.nGen, 1500); assert.equal(g.stages, 1); near(g.ratio, 4, 1e-9, 'ratio'); near(g.eta, 0.98, 1e-12, 'η');
  const g2 = driveFor('kaplan', 250, 1e6); // 1500/250 = 6 > 5 in one stage → 1000 rpm, ratio 4
  assert.equal(g2.nGen, 1000); near(g2.ratio, 4, 1e-9, 'ratio 250 rpm');
  const g3 = driveFor('kaplan', 100, 1e6); // 750/100 > 5 → 1500 rpm in two stages
  assert.equal(g3.nGen, 1500); assert.equal(g3.stages, 2); near(g3.eta, 0.98 * 0.98, 1e-12, 'two stages');
  assert.equal(driveFor('kaplan', 375, 8e6).kind, 'direct');   // large unit: slow many-pole generator
  assert.equal(driveFor('francis', 1000, 1e6).kind, 'direct');
  const b = driveFor('crossflow', 590, 2e4); assert.equal(b.kind, 'belt'); near(b.eta, 0.97, 1e-12, 'belt');
  // the river-weir preset: two ~1.3 MW Kaplans at 375 rpm drive 1500 rpm generators; power includes the gearbox
  const p: HydroIn = { ...HYDRO_PRESETS.low }, r = hydro(p);
  assert.equal(r.drive.kind, 'gearbox');
  const P = 999.7 * 9.81 * p.Qd * r.Hn * r.etaT * r.etaG * 0.98;
  near(r.P, P, P * 0.002, 'P with gearbox');
});
