import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daySchedule, ETA, lossSteps, pumped, PUMPED_PRESETS, type PumpedIn } from './pumped.ts';
import { RHO, G } from './hydro.ts';

const near = (a: number, b: number, tol: number, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (±${tol})`);

test('energy balance: E_out = ρ g V H_n η, round trip = η_gen η_pump H_n/H_p', () => {
  const p = PUMPED_PRESETS.medium, r = pumped(p);
  near(r.Eout, (RHO * G * r.V * r.Hn * r.etaGen) / 3600, r.Eout * 1e-6, 'E_out');
  near(r.Ein, (RHO * G * r.V * r.Hp) / r.etaPump / 3600, r.Ein * 1e-6, 'E_in');
  near(r.etaRT, r.etaGen * r.etaPump * (r.Hn / r.Hp), 1e-9, 'round trip');
  near(r.Pg, p.P, 1, 'rated power reached');
  // the loss waterfall ends at the round-trip efficiency
  near(lossSteps(r).out, r.etaRT, 1e-9, 'waterfall');
});

test('no friction: round trip = product of the machine efficiencies (≈ 80 %)', () => {
  const r = pumped({ ...PUMPED_PRESETS.medium, D: 60, K: 0 });
  const ideal = ETA.turbine * ETA.pump * ETA.motorGen ** 2 * ETA.transformer ** 2;
  near(r.etaRT, ideal, 2e-4, 'ideal');
  near(ideal, 0.8045, 5e-4, 'product');
});

test('hand calculation: 1 GWh at 500 m needs about 0.8 million m³', () => {
  // E = ρ g V H η → V = 1e9 Wh · 3600 / (999.7 · 9.81 · 500 · 0.92·0.985·0.995) ≈ 0.814e6 m³ at the net head
  const r = pumped({ ...PUMPED_PRESETS.large, P: 1e9 / 6, ts: 6, D: 40, K: 0, units: 1 });
  near(r.V / 1e6, 3.6e12 / (RHO * G * 500 * 0.92 * 0.985 * 0.995) / 1e6, 0.002, 'V');
});

test('reservoir levels and head range', () => {
  const p: PumpedIn = { ...PUMPED_PRESETS.medium, du: 20, dl: 10 }, r = pumped(p);
  near(r.Hmax, 315, 1e-9, 'H_max'); near(r.Hmin, 285, 1e-9, 'H_min');
  near(r.Au, r.V / 20, 1e-6, 'upper area');
  assert.equal(pumped({ ...p, du: 60, dl: 30 }).checks.find((c) => c.label.includes('H_max/H_min'))!.ok, false);
});

test('a too-small waterway cannot carry the rated power and says so', () => {
  const r = pumped({ ...PUMPED_PRESETS.medium, D: 1 });
  assert.equal(r.checks[0].ok, false);
  assert.ok(r.Pg < PUMPED_PRESETS.medium.P && r.Pg > 0);
});

test('day schedule: full after pumping, empty after generating', () => {
  const r = pumped(PUMPED_PRESETS.small), d = daySchedule(r, PUMPED_PRESETS.small.ts); // pumping ≈ 23:18…06:42, generating 15:00…21:00
  assert.equal(d.mode(18), 'gen'); assert.equal(d.mode(3), 'pump'); assert.equal(d.mode(11), 'idle');
  near(d.stored(11), 1, 1e-9, 'full before the evening'); near(d.stored(22), 0, 1e-9, 'empty after the evening');
  near(d.stored(18), 0.5, 1e-9, 'half way through generating');
});

test('presets pass their checks; slider ends give numbers', () => {
  for (const k of Object.keys(PUMPED_PRESETS) as (keyof typeof PUMPED_PRESETS)[]) {
    const bad = pumped(PUMPED_PRESETS[k]).checks.filter((c) => !c.ok).map((c) => `${c.label} (${c.detail})`);
    assert.deepEqual(bad, [], k);
  }
  const ends: Partial<PumpedIn>[] = [{ Hg: 30 }, { Hg: 1000 }, { P: 1e6 }, { P: 4e9 }, { ts: 0.5 }, { ts: 24 }, { L: 100 }, { L: 20000 }, { D: 0.5 }, { D: 15 }, { du: 1 }, { dl: 60 }, { pumpRatio: 0.6 }, { tc: 0.5 }, { K: 0 }];
  for (const e of ends) {
    const r = pumped({ ...PUMPED_PRESETS.medium, ...e });
    for (const [k, v] of Object.entries({ Qg: r.Qg, Qp: r.Qp, V: r.V, Eout: r.Eout, Ein: r.Ein, eta: r.etaRT, tp: r.tp, dh: r.wall.dh, rpm: r.rpm, y: r.perYear })) assert.ok(Number.isFinite(v), `${JSON.stringify(e)} ${k} = ${v}`);
  }
});
