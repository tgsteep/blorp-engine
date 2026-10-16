import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CITIES_TR } from './climateTR.ts';
import {
  AVG_DAY, PANEL_TYPES, beamRatio, beamRatioSouth, cellTemp, declination, ENERGY_WEIGHT, pvMonthly, sunsetHourAngle, tiltSweep, tiltedIrradiation, bestTiltGen,
} from './pv.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const city = (n: string) => CITIES_TR.find((c) => c.name === n)!;
const perc = PANEL_TYPES.find((p) => p.id === 'perc')!;

test('declination (Cooper): 21 June (n = 172) → 23.45°; 17 Jan → −20.9° (Duffie & Beckman Table 1.6.1)', () => {
  near(declination(172), 23.45, 0.01);
  near(declination(AVG_DAY[0]), -20.9, 0.1);
});

test('sunset hour angle φ = 40°, δ = 23.09° → arccos(−tan40·tan23.09) = 110.97° (hand calculation)', () => {
  near(sunsetHourAngle(40, 23.09), 110.97, 0.02);
});

test('numerical R̄_b equals the closed form for a south-facing surface (φ 40°, β 30°, Jan and Jun)', () => {
  for (const m of [0, 5]) {
    const d = declination(AVG_DAY[m]);
    near(beamRatio(40, d, 30, 0, 2000), beamRatioSouth(40, d, 30), 0.002, `month ${m + 1}`);
  }
});

test('horizontal surface: H_T = H; vertical south wall in January gets more beam than the ground (R̄_b > 1)', () => {
  const t = tiltedIrradiation(2.5, 1.0, beamRatio(40, declination(17), 0, 0), 0, 0.2);
  near(t.HT, 2.5, 1e-6);
  assert.ok(beamRatio(40, declination(17), 90, 0) > 1);
});

test('isotropic sky parts: H 5, H_d 2, R̄_b 1.2, β 30°, ρ 0.2 → 3.6 + 1.866 + 0.067 = 5.533 (hand calculation)', () => {
  const t = tiltedIrradiation(5, 2, 1.2, 30, 0.2);
  near(t.beam, 3.6, 1e-9); near(t.diffuse, 1.8660, 1e-4); near(t.ground, 0.0670, 1e-4); near(t.HT, 5.5330, 1e-4);
});

test('NOCT cell temperature: T_a 25 °C, G 800 W/m², NOCT 45 °C → 50 °C; half-sine weighting π²/8 = 1.2337', () => {
  near(cellTemp(25, 800, 45), 50, 1e-12);
  near(ENERGY_WEIGHT, 1.2337, 1e-4);
});

test('plausibility: 1 kWp mono PERC, south 30° → Antalya 1350…1800 kWh/kWp, more than Rize; PR 0.7…0.9', () => {
  const run = (n: string) => pvMonthly({ city: city(n), nPanels: 10, panelW: 100, panel: perc, tilt: 30, azim: 0 });
  const a = run('Antalya'), r = run('Rize');
  assert.ok(a.specificYield > 1350 && a.specificYield < 1800, `Antalya ${a.specificYield}`);
  assert.ok(a.specificYield > r.specificYield);
  assert.ok(a.PR > 0.7 && a.PR < 0.9, `PR ${a.PR}`);
  near(a.annualAC, a.months.reduce((s, x) => s + x.ac, 0), 1e-9);
});

test('best annual tilt in Turkey is roughly latitude − 5…10° (classic rule of thumb)', () => {
  const sweep = tiltSweep(city('Yozgat'), 0);
  const best = sweep.reduce((a, b) => (b.HT > a.HT ? b : a));
  assert.ok(best.tilt >= 25 && best.tilt <= 40, `best tilt ${best.tilt}`);
});

test('data file: 81 provinces, 12 months each, values in a sane range', () => {
  assert.equal(CITIES_TR.length, 81);
  for (const c of CITIES_TR) {
    assert.equal(c.ghi.length, 12);
    assert.ok(c.ghi.every((v, i) => v > 0.5 && v < 9 && c.dhi[i] <= v), c.name);
  }
});

test('bestTiltGen (background scan) gives the same best tilt as tiltSweep', () => {
  for (const city of [CITIES_TR[0], CITIES_TR[40], CITIES_TR[80]]) for (const azim of [-90, -30, 0, 45, 90]) {
    const g = bestTiltGen(city, azim); let r = g.next(); while (!r.done) r = g.next();
    assert.equal(r.value, tiltSweep(city, azim).reduce((a, b) => (b.HT > a.HT ? b : a)).tilt);
  }
});
