import { test } from 'node:test';
import assert from 'node:assert/strict';
import { burn, emissions, FUELS, heatComparison, type Fuel } from './combustion.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const fuel = (id: string) => FUELS.find((f) => f.id === id)!;

test('analyses add up to 1 and the CO₂ factors agree with the IPCC 2006 defaults within 3 %', () => {
  for (const f of FUELS) {
    near(f.c + f.h + f.o + f.n + f.s + f.ash + f.w, 1, 1e-3, `${f.id} sum`);
    if (f.ipcc) { const b = burn(f, 1.2); near((b.mCO2 / f.LHV) * 1000 / f.ipcc, 1, 0.03, `${f.id} kg CO₂/GJ`); }
  }
});

test('pure methane (hand calculation): 17.2 kg air/kg, 9.52 mol air/mol, CO₂,max 11.7 %', () => {
  const ch4: Fuel = { id: 'gas', name: '', short: '', c: 12.011 / 16.043, h: 4.032 / 16.043, o: 0, n: 0, s: 0, ash: 0, w: 0, LHV: 50.03, lam: [1, 2], o2ref: 3 };
  const b = burn(ch4, 1);
  near(b.mAirMin, 17.2, 0.05, 'stoichiometric air'); near((b.airMin * 16.043), 9.52, 0.01, 'mol air per mol');
  near(b.CO2max, 11.73, 0.05, 'CO₂ max (dry)'); near(b.O2dry, 0, 1e-12, 'no O₂ at λ = 1');
  // dry O₂ at λ: λ ≈ 21/(21 − O₂) for methane within a few percent
  for (const lam of [1.1, 1.3]) { const r = burn(ch4, lam); near(21 / (21 - r.O2dry), lam, 0.03 * lam, `λ ${lam}`); }
});

test('SO₂ concentration and reference-oxygen conversion (hand calculation for heavy fuel oil)', () => {
  const f = fuel('hfo'), r = emissions({ fuel: f, lam: 1.2, Q: 1000, eta: 0.9, hours: 4000, so2Removal: 0, elec: 0, efGrid: 0.4 });
  const so2 = (f.s / 32.06) * 64.06 * 1e6 / r.Vdry;
  near(r.so2, so2, 1e-6, 'mg/Nm³'); near(r.so2Ref, so2 * 18 / (21 - r.O2dry), 1e-6, 'at 3 % O₂');
  assert.ok(r.so2Ref > 350 && !r.checks[0].ok, '1 % S oil needs desulphurisation'); // ≈ 1700 mg/Nm³
  const clean = emissions({ fuel: f, lam: 1.2, Q: 1000, eta: 0.9, hours: 4000, so2Removal: 0.9, elec: 0, efGrid: 0.4 });
  near(clean.so2Ref, r.so2Ref * 0.1, 1e-6, '90 % removal');
});

test('yearly footprint: fuel use from heat and efficiency, electricity at the grid factor, biomass counted apart', () => {
  const f = fuel('gas'), r = emissions({ fuel: f, lam: 1.1, Q: 500, eta: 0.95, hours: 2000, so2Removal: 0, elec: 50, efGrid: 0.4 });
  near(r.mFuel, (500 / 0.95 / 1000 / f.LHV) * 3600, 1e-9, 'kg/h');
  near(r.co2Fuel, (500 / 0.95) * 2000 * (r.co2PerKWhFuel) / 1000, 1e-6, 't CO₂/year');
  near(r.co2Elec, 20, 1e-12, '50 MWh × 0.4');
  const w = emissions({ fuel: fuel('wood'), lam: 1.6, Q: 500, eta: 0.9, hours: 2000, so2Removal: 0, elec: 0, efGrid: 0.4 });
  assert.equal(w.co2Fuel, 0); assert.ok(w.co2Bio > 0);
  const hp = heatComparison(0.9, 0.4, 3.5).find((x) => x.id === 'hp')!; near(hp.v, 0.4 / 3.5, 1e-12);
});
