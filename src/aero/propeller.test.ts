import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bem, propeller, section, type PropIn } from './propeller.ts';

const near = (a: number, b: number, tol: number, w = '') => assert.ok(Math.abs(a - b) <= tol, `${w}: ${a} vs ${b}`);
export const PROP_DEF: PropIn = { D: 1.9, B: 2, PD: 0.8, width: 1, rpm: 2500, V: 55, h: 1500, Peng: 120e3 };

test('BEM converged: blade forces equal the momentum of the annuli; coefficients consistent', () => {
  const r = propeller(PROP_DEF);
  const mom = r.els.reduce((a, e) => a + 4 * Math.PI * e.r * r.rho * e.F * (PROP_DEF.V + e.vi) * e.vi * e.dr, 0);
  near(mom / r.T, 1, 1e-3, 'thrust: blade = momentum');
  near(r.eta, (r.J * r.CT) / r.CP, 1e-9, 'η = J C_T/C_P');
  near(r.J, 55 / ((2500 / 60) * 1.9), 1e-12, 'J');
  assert.ok(r.eta < r.etaIdeal && r.eta > 0.75, `η ${r.eta} below the momentum limit ${r.etaIdeal}`);
  assert.ok(r.checks.every((c) => c.ok), JSON.stringify(r.checks.filter((c) => !c.ok)));
});

test('static thrust: figure of merit in the usual 0.6…0.8 band, thrust falls with speed, windmills at high J', () => {
  const s = propeller({ ...PROP_DEF, V: 0 });
  assert.ok(s.FM > 0.6 && s.FM < 0.85, `FM ${s.FM}`);
  assert.ok(s.T > propeller(PROP_DEF).T);
  assert.ok(propeller({ ...PROP_DEF, V: 90 }).T < 0, 'negative thrust past the zero-lift pitch');
  // more blades and wider blades give more thrust at the same rpm
  assert.ok(propeller({ ...PROP_DEF, B: 3 }).T > propeller(PROP_DEF).T);
  assert.ok(propeller({ ...PROP_DEF, width: 1.3 }).T > propeller(PROP_DEF).T);
});

test('section model and non-dimensional scaling', () => {
  near(section(-4).cl, 0, 1e-12, 'zero lift at −4°'); assert.ok(section(30).stall && section(30).cd > 0.2);
  // same J at twice the size and half the rpm → same C_T and C_P (no Reynolds effects in the model)
  const a = bem({ ...PROP_DEF, V: 40 }, 1.2), b = bem({ ...PROP_DEF, D: 3.8, rpm: 1250, V: 40 }, 1.2);
  near(a.CT, b.CT, 1e-6, 'C_T'); near(a.CP, b.CP, 1e-6, 'C_P');
});

test('slider ends give numbers', () => {
  for (const e of [{ V: 0 }, { V: 150 }, { rpm: 300 }, { rpm: 8000 }, { D: 0.2 }, { D: 6 }, { PD: 0.3 }, { PD: 1.8 }, { B: 6 }, { width: 0.5 }, { h: 10000 }] as Partial<PropIn>[]) {
    const r = propeller({ ...PROP_DEF, ...e }); for (const v of [r.T, r.P, r.eta, r.CT, r.CP, r.Mtip, r.stalled]) assert.ok(Number.isFinite(v), JSON.stringify(e));
  }
});
