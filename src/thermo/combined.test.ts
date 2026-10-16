import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIRC, CC_PRESETS, combined, gasTurbine, GAS, LHV, REF, steamCycle, type CCIn, type CCKind } from './combined.ts';

const near = (a: number, b: number, tol: number, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (±${tol})`);

test('VALIDATION (Çengel & Boles, Thermodynamics, Example 10-9): combined gas–steam cycle, steam side with the gas enthalpies of Example 9-6', () => {
  // ideal Rankine 7 MPa / 500 °C / 5 kPa; gas cools from h₄′ = 880.36 to h₅′ = 451.80 kJ/kg; gas cycle w_net 210.41, q_in 790.58 kJ/kg
  const s = steamCycle(7000, 500, 5, 1, 1);
  near(s.live.h, 3411.4, 1.0, 'h3');
  near(s.hfw, 144.78, 0.5, 'h2');
  near(s.wnet, 1331.4, 2.0, 'w_net steam');
  const y = (880.36 - 451.8) / (s.live.h - s.hfw);
  near(y, 0.131, 0.0005, 'm_steam/m_gas');
  const w = 210.41 + y * s.wnet;
  near(w, 384.8, 0.5, 'w_net');
  near(w / 790.58, 0.487, 0.001, 'η');
});

test('gas turbine with constant specific heats by hand', () => {
  const g = gasTurbine({ rp: 16, T1: 15, T3: 1300, etaC: 0.87, etaT: 0.89 });
  const T1 = 288.15, T2 = T1 + (T1 * 16 ** (0.4 / 1.4) - T1) / 0.87;
  near(g.T2 + 273.15, T2, 1e-6, 'T2');
  near(g.wc, AIRC.cp * (T2 - T1), 1e-6, 'w_c');
  const T3 = 1573.15, rt = (16 * 0.96) / 1.03, T4 = T3 - 0.89 * (T3 - T3 / rt ** (0.333 / 1.333));
  near(g.T4 + 273.15, T4, 1e-6, 'T4');
  // fuel–air ratio from the combustor energy balance
  near(g.f * (0.99 * LHV - GAS.cp * (T3 - 298.15)), GAS.cp * (T3 - 298.15) - AIRC.cp * (T2 - 298.15), 1e-6, 'f');
  assert.ok(g.qin > 0 && g.wnet / g.qin > 0.3 && g.wnet / g.qin < 0.45, `GT efficiency ${g.wnet / g.qin}`);
});

test('combined cycle: energy balance closes, efficiency in the usual 50…62 % band', () => {
  const r = combined(CC_PRESETS.cc);
  // power + exhaust-steam heat + stack loss account for the fuel, less the GT, generator and combustion losses
  const out = r.P + r.Qx + r.Qstack;
  assert.ok(out <= r.Qfuel && out >= 0.93 * r.Qfuel, `${out} of ${r.Qfuel}`);
  assert.ok(r.etaEl > 0.5 && r.etaEl < 0.62, `η = ${r.etaEl}`);
  assert.ok(r.Pst > 0.3 * CC_PRESETS.cc.Pgt && r.Pst < 0.6 * CC_PRESETS.cc.Pgt);
});

test('cogeneration: less power, much more used, PES formula', () => {
  const cc = combined({ ...CC_PRESETS.dh, heat: 'none', Tx: 33 }), chp = combined(CC_PRESETS.dh);
  assert.ok(chp.etaEl < cc.etaEl && chp.util > 0.8);
  near(chp.PES, 1 - 1 / (chp.etaH / REF.hotWater + chp.etaEl / REF.el), 1e-12, 'PES');
});

test('presets pass their checks; slider ends give numbers', () => {
  for (const k of Object.keys(CC_PRESETS) as CCKind[]) {
    const bad = combined(CC_PRESETS[k]).checks.filter((c) => !c.ok).map((c) => `${c.label} (${c.detail})`);
    assert.deepEqual(bad, [], k);
  }
  const ends: Partial<CCIn>[] = [{ rp: 4 }, { rp: 40 }, { T3: 900 }, { T3: 1700 }, { T1: -20 }, { T1: 45 }, { pS: 1000 }, { pS: 16000 }, { TS: 300 }, { TS: 620 }, { dTp: 5 }, { dTp: 40 }, { Tx: 25 }, { Tx: 200 }, { Pgt: 1000 }, { etaC: 0.75 }, { etaST: 0.7 }];
  for (const k of Object.keys(CC_PRESETS) as CCKind[]) for (const e of ends) {
    const r = combined({ ...CC_PRESETS[k], ...e });
    for (const [n, v] of Object.entries({ P: r.P, eta: r.etaEl, ms: r.ms, Ts: r.Tstack, PES: r.PES, Pst: r.Pst })) assert.ok(Number.isFinite(v), `${k} ${JSON.stringify(e)} ${n} = ${v}`);
  }
});
