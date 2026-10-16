import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airRho, deRect, duct, friction, type DuctIn } from './duct.ts';
import { hydronic, pipeFlow, SERIES, type HydIn } from './hydronic.ts';

const near = (a: number, b: number, tol: number, w = '') => assert.ok(Math.abs(a - b) <= tol, `${w}: ${a} vs ${b}`);
export const DUCT_DEF: DuctIn = { Q: 1500, shape: 'round', aspect: 2, method: 'friction', Rt: 1, vt: 5, L: 30, elbows: 4, dpComp: 150, use: 'office', etaFan: 0.55, T: 20 };
export const HYD_DEF: HydIn = { Q: 15, ts: 70, dT: 20, series: 'copper', L: 40, z: 0.3, dpComp: 10, use: 'home', eta: 0.4 };

test('duct by hand: 1000 m³/h in Ø315 about 0.5 Pa/m (ASHRAE friction chart), Huebscher 400 × 200 → 305 mm', () => {
  const D = 0.315, fr = friction(1000 / 3600, (Math.PI / 4) * D * D, D, 20);
  near(fr.v, 3.565, 0.005, 'v'); near(fr.R, 0.5, 0.05, 'R');
  near(deRect(0.4, 0.2) * 1000, 305, 1.5, 'De 400 × 200'); near(deRect(0.3, 0.3) * 1000, 328, 1.5, 'De 300 × 300');
  const r = duct(DUCT_DEF);
  // smallest standard size meeting 1 Pa/m: Ø315 is just over it at 1500 m³/h, so Ø400
  assert.ok(r.R <= 1 && r.pick.label === 'Ø400', `${r.pick.label} ${r.R}`);
  assert.ok(friction(1500 / 3600, (Math.PI / 4) * 0.315 ** 2, 0.315, 20).R > 1);
  near(r.dpTot, r.R * 30 + 4 * 0.3 * 0.5 * airRho(20) * r.v ** 2 + 150, 1e-9, 'Δp');
  near(r.Pfan, (1500 / 3600) * r.dpTot / 0.55, 1e-9, 'fan power'); near(r.SFP, r.Pfan / (1500 / 3600), 1e-9, 'SFP');
  assert.ok(r.Dexact < 0.4 && r.Dexact > 0.315, `exact ${r.Dexact}`);
  assert.ok(r.checks.every((c) => c.ok), JSON.stringify(r.checks.filter((c) => !c.ok)));
});

test('duct: velocity method and rectangular ducts', () => {
  const v = duct({ ...DUCT_DEF, method: 'velocity', vt: 4 }); assert.ok(v.v <= 4);
  const rc = duct({ ...DUCT_DEF, shape: 'rect', aspect: 2 }); assert.ok(rc.R <= 1 && Math.abs(rc.pick.a / rc.pick.b - 2) < 0.35, `${rc.pick.label}`);
});

test('heating pipe by hand: flow from the load, copper 28 × 1 for 15 kW at ΔT 20 K', () => {
  const r = hydronic(HYD_DEF);
  near(r.mDot, 15000 / (4190 * 20), 1e-12, 'ṁ'); assert.equal(r.pick.label, '28 × 1');
  const f = pipeFlow(r.mDot, 26, 0.0015, 60); near(r.v, f.v, 1e-12, 'v'); near(r.dpTot, f.R * 40 * 1.3 + 10000, 1e-6, 'Δp');
  near(r.H, r.dpTot / (r.rho * 9.80665), 1e-9, 'head');
  assert.ok(r.checks.every((c) => c.ok), JSON.stringify(r.checks.filter((c) => !c.ok)));
  // a heat pump at ΔT 5 K needs four times the water and a bigger pipe
  const hp = hydronic({ ...HYD_DEF, ts: 35, dT: 5 }); near(hp.mDot / r.mDot, 4, 1e-12, 'flow × 4');
  assert.ok(hp.pick.di > r.pick.di);
});

test('slider ends give numbers', () => {
  for (const e of [{ Q: 20 }, { Q: 100000 }, { Rt: 0.1 }, { Rt: 5 }, { L: 1 }, { L: 500 }, { elbows: 20 }, { aspect: 4, shape: 'rect' }, { T: -20 }, { T: 60 }] as Partial<DuctIn>[]) {
    const r = duct({ ...DUCT_DEF, ...e }); for (const x of [r.v, r.R, r.dpTot, r.Pfan, r.Dexact]) assert.ok(Number.isFinite(x), JSON.stringify(e));
  }
  for (const e of [{ Q: 0.5 }, { Q: 2000 }, { dT: 3 }, { dT: 40 }, { ts: 30 }, { ts: 90 }, { series: 'pex' }, { series: 'steel', Q: 500 }, { L: 2 }] as Partial<HydIn>[]) {
    const r = hydronic({ ...HYD_DEF, ...e }); for (const x of [r.v, r.R, r.dpTot, r.H, r.Pel]) assert.ok(Number.isFinite(x), JSON.stringify(e));
  }
  assert.ok(Object.values(SERIES).every((s) => s.sizes.every((x, i, a) => i === 0 || x.di > a[i - 1].di)));
});
