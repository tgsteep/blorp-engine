import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kForRatio, magnification, transmissibility, vibration, type VibIn } from './vibration.ts';
import { acoustics, addDb, addOn, lpAt, maekawa, type AcIn } from './acoustics.ts';

const near = (a: number, b: number, tol: number, w = '') => assert.ok(Math.abs(a - b) <= tol, `${w}: ${a} vs ${b}`);
export const VIB_DEF: VibIn = { m: 500, rpm: 1480, me: 15, n: 4, kEach: 150, iso: 'rubber' };
export const AC_DEF: AcIn = { Lw: 100, n: 1, r: 100, Q: 2, Lbg: 40, barrier: false, db: 5, hb: 3, f: 500, limit: 'day55' };

test('single degree of freedom by hand: natural frequency, ratios, transmissibility', () => {
  // undamped T = 1/|1 − r²|; r = √2 → T = 1 for any damping; resonance peak 1/(2ζ)
  near(transmissibility(3, 0), 1 / 8, 1e-12, 'T at r 3');
  for (const z of [0, 0.1, 0.5]) near(transmissibility(Math.SQRT2, z), 1, 1e-12, 'r √2');
  near(magnification(1, 0.05), 10, 1e-12, 'peak');
  const r = vibration(VIB_DEF);
  const k = 4 * 150e3; near(r.fn, Math.sqrt(k / 500) / (2 * Math.PI), 1e-12, 'fn');            // 5.513 Hz
  near(r.F0, 0.015 * ((1480 * Math.PI) / 30) ** 2, 1e-9, 'F0');                                // 480 N
  near(r.FT, r.T * r.F0, 1e-9, 'FT'); near(r.dst, (500 * 9.81) / k, 1e-12, 'static deflection');
  assert.ok(r.checks.every((c) => c.ok), JSON.stringify(r.checks.filter((c) => !c.ok)));
  // stiffness for a target ratio gives that ratio back
  near(vibration({ ...VIB_DEF, kEach: kForRatio(500, 1480, 4, 4) }).r, 4, 1e-9, 'kForRatio');
});

test('decibels by hand: adding, distance, barrier', () => {
  near(addDb(80, 80), 83.01, 0.01, 'two equal'); near(addDb(...Array(10).fill(70)), 80, 1e-9, 'ten equal');
  near(addOn(10), 0.41, 0.01, '10 dB apart');
  near(lpAt(100, 10, 2), 100 - 10 * Math.log10(200 * Math.PI), 1e-12, 'Lp'); // 72.0 dB
  near(lpAt(100, 20, 2) - lpAt(100, 10, 2), -6.02, 0.01, 'doubling distance');
  near(maekawa(0), 4.77, 0.01, 'grazing'); near(maekawa(1), 13.6, 0.05, 'N = 1'); assert.equal(maekawa(100), 20);
  const r = acoustics(AC_DEF);
  near(r.Lp, lpAt(100, 100, 2), 1e-9, 'no barrier');
  assert.ok(r.checks.every((c) => c.ok), JSON.stringify(r.checks.filter((c) => !c.ok)));
  const b = acoustics({ ...AC_DEF, barrier: true });
  assert.ok(b.Ab > 5 && b.Ab < 20 && b.N > 0, `${b.Ab} ${b.N}`);
  assert.equal(acoustics({ ...AC_DEF, barrier: true, hb: 0.1 }).Ab, 0, 'well below the line of sight');
});

test('slider ends give numbers', () => {
  for (const e of [{ m: 10 }, { m: 50000 }, { rpm: 100 }, { rpm: 6000 }, { kEach: 1 }, { kEach: 5000 }, { me: 0.1 }] as Partial<VibIn>[]) {
    const r = vibration({ ...VIB_DEF, ...e }); for (const v of [r.X, r.T, r.FT, r.fn, r.Xres]) assert.ok(Number.isFinite(v), JSON.stringify(e));
  }
  for (const e of [{ r: 1 }, { r: 2000 }, { hb: 10, barrier: true }, { db: 1, barrier: true }, { f: 63, barrier: true }, { Lw: 140 }] as Partial<AcIn>[]) {
    const r = acoustics({ ...AC_DEF, ...e }); for (const v of [r.Lp, r.Ltot, r.rLim, r.Ab]) assert.ok(Number.isFinite(v), JSON.stringify(e));
  }
});
