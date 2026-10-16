import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cev, GRADES, gradeOf, preheat, pren, seferianC, steel } from './steels.ts';
import { ac1, ac3, criticalDiameter, harris, harrisTime, heatTreat, hrcMax, idealDiameter, msTemp, theta, timeRatio, type HTIn } from './heattreat.ts';
import { galvanic, rateMm, type GalvIn } from './galvanic.ts';

const near = (a: number, b: number, tol: number, w = '') => assert.ok(Math.abs(a - b) <= tol, `${w}: ${a} vs ${b}`);
export const HT_DEF: HTIn = { mode: 'through', grade: '42CrMo4', D: 60, quench: 'oilAgit', Tc: 925, hours: 6, caseReq: 0.8 };
export const GALV_DEF: GalvIn = { a: 'steel', b: 'ss304', env: 'normal', ratio: 1, years: 10, t: 3, isolated: false };

test('steel weldability by hand: CEV, Seferian preheat, PREN', () => {
  const s = gradeOf('S355J2').comp; near(cev(s), 0.18 + 1.4 / 6, 1e-12, 'CEV S355');
  const q = gradeOf('42CrMo4').comp; near(cev(q), 0.42 + 0.75 / 6 + (1.05 + 0.22) / 5, 1e-12, 'CEV 42CrMo4');
  near(seferianC(q), 0.42 + (0.75 + 1.05) / 9 + (7 * 0.22) / 90, 1e-12, '[C]');
  near(preheat(q, 30), 350 * Math.sqrt(seferianC(q) * 1.15 - 0.25), 1e-9, 'T_p');
  assert.equal(preheat(gradeOf('S235JR').comp, 5), 0, 'mild steel: no preheat'); assert.ok(preheat(gradeOf('S235JR').comp, 20) < 40);
  near(pren(gradeOf('X2CrNiMo17-12-2').comp), 17.2 + 3.3 * 2.1 + 16 * 0.05, 1e-12, 'PREN 316L');
  assert.ok(steel({ grade: 'S235JR', t: 20 }).checks.every((c) => c.ok));
  assert.equal(steel({ grade: '42CrMo4', t: 30 }).checks[0].ok, false, '42CrMo4 needs care');
  assert.equal(new Set(GRADES.map((g) => g.en)).size, GRADES.length, 'unique names');
});

test('heat treatment: Andrews temperatures, Grossmann D_I and the chart relation, Harris case depth', () => {
  const x = gradeOf('C45E').comp;
  near(ac1(x), 723 - 10.7 * 0.65 + 29.1 * 0.25, 1e-9, 'Ac1'); near(ac3(x), 910 - 203 * Math.sqrt(0.45) + 44.7 * 0.25, 1e-9, 'Ac3');
  near(msTemp(x), 539 - 423 * 0.45 - 30.4 * 0.65, 1e-9, 'Ms');
  // D_I of 1045 about 0.8–1.0 in, of 4140 about 4–6 in (ASTM A255 factors)
  const d45 = idealDiameter(x) / 25.4, d4140 = idealDiameter(gradeOf('42CrMo4').comp) / 25.4;
  assert.ok(d45 > 0.7 && d45 < 1.1, `1045 D_I ${d45}`); assert.ok(d4140 > 4 && d4140 < 6, `4140 D_I ${d4140}`);
  // ideal quench (H → ∞) gives D = D_I; Grossmann chart: D_I 2 in, H 1.0 → about 1.3 in, H 0.3 → about 0.6 in
  near(criticalDiameter(50.8, 1e6) / 50.8, 1, 0.01, 'H → ∞');
  near(criticalDiameter(50.8, 1.0) / 25.4, 1.3, 0.15, 'H 1.0'); near(criticalDiameter(50.8, 0.3) / 25.4, 0.65, 0.12, 'H 0.3');
  near(timeRatio(50.8, 1e6, 50.8, 0), 1, 1e-3, 'definition');
  // Bessel series: the initial temperature is 1 inside the bar
  assert.ok(Math.abs(theta([], 0, 0)) === 0);
  near(hrcMax(0.45), 20 + 60 * Math.sqrt(0.45), 1e-12, 'H_max');
  // Harris: 925 °C, 4 h ≈ 0.050 in = 1.27 mm; time for a depth is the inverse
  near(harris(925, 4), 1.27, 0.03, 'case depth'); near(harrisTime(925, harris(925, 4)), 4, 1e-9, 'inverse');
  const r = heatTreat(HT_DEF); assert.ok(r.checks.every((c) => c.ok), JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.ok(r.core.hrc < r.surf.hrc, 'centre softer than the surface');
  assert.equal(heatTreat({ ...HT_DEF, grade: 'C45E', D: 60, quench: 'water' }).checks[0].ok, false, 'C45 does not harden through at 60 mm');
});

test('galvanic: anode, limits, area ratio, Faraday rate', () => {
  near(rateMm('steel', 1), 1.16, 0.01, '1 A/m² on steel ≈ 1.16 mm/year');
  const r = galvanic(GALV_DEF); assert.equal(r.anode, 'steel'); near(r.dE, 0.35, 1e-12, 'ΔE');
  assert.equal(r.checks[0].ok, false, 'steel on stainless outdoors: too far apart');
  const big = galvanic({ ...GALV_DEF, ratio: 10 }), small = galvanic({ ...GALV_DEF, ratio: 0.1 });
  near(big.cr / small.cr, 100, 1e-9, 'rate ∝ area ratio');
  assert.equal(galvanic({ ...GALV_DEF, isolated: true }).cr, 0);
  assert.ok(galvanic({ ...GALV_DEF, b: 'castiron' }).checks.every((c) => c.ok), 'steel + cast iron: fine');
});

test('slider ends give numbers', () => {
  for (const g of GRADES) for (const t of [3, 100]) { const r = steel({ grade: g.en, t }); for (const v of [r.CEV, r.Tp, r.PREN]) assert.ok(Number.isFinite(v), g.en); }
  for (const e of [{ D: 5 }, { D: 300 }, { quench: 'brine' }, { grade: '100Cr6' }, { mode: 'case', grade: '16MnCr5', Tc: 880, hours: 1 }, { mode: 'case', Tc: 980, hours: 40 }] as Partial<HTIn>[]) {
    const r = heatTreat({ ...HT_DEF, ...e }); for (const v of [r.Dcrit, r.core.hrc, r.surf.hrc, r.caseDepth, r.tNeed, r.depth50]) assert.ok(Number.isFinite(v), JSON.stringify(e));
  }
  for (const e of [{ ratio: 0.01 }, { ratio: 100 }, { a: 'gold', b: 'gold' }, { a: 'magnesium', b: 'gold', env: 'harsh' }, { years: 50 }] as Partial<GalvIn>[]) {
    const r = galvanic({ ...GALV_DEF, ...e }); for (const v of [r.cr, r.loss, r.ia]) assert.ok(Number.isFinite(v), JSON.stringify(e));
  }
});
