import { test } from 'node:test';
import assert from 'node:assert/strict';
import { biElliptic, BODIES, eccAnomaly, hohmann, orbit, period, vCirc, type OrbitIn } from './orbit.ts';

const near = (a: number, b: number, tol: number, w = '') => assert.ok(Math.abs(a - b) <= tol, `${w}: ${a} vs ${b}`);
export const ORBIT_DEF: OrbitIn = { body: 'earth', h1: 300e3, h2: 35786e3, di: 0, mDry: 1500, mProp: 4000, Isp: 320 };

test('VALIDATION (Vallado, Fundamentals of Astrodynamics, Example 6-1): Hohmann LEO → GEO', () => {
  // r_i = 191.344 11 km altitude, r_f = 35 781.348 57 km altitude, R = 6378.137 km
  const mu = BODIES.earth.mu, r1 = 6378.137e3 + 191.34411e3, r2 = 6378.137e3 + 35781.34857e3;
  const h = hohmann(mu, r1, r2);
  near(h.dv1, 2457.038, 0.5, 'Δv_a'); near(h.dv2, 1478.187, 0.5, 'Δv_b'); near(h.dv, 3935.224, 0.8, 'Δv');
  near(h.t / 3600, 5.256713, 1e-4, 'transfer time h');
});

test('circular orbits by hand: ISS-like speed and period, GEO period one sidereal day', () => {
  const { mu, R } = BODIES.earth;
  near(vCirc(mu, R + 400e3), 7668.6, 1, 'v at 400 km');
  near(period(mu, R + 400e3) / 60, 92.56, 0.05, 'T at 400 km');
  near(period(mu, R + 35786e3), 86164, 5, 'GEO = sidereal day');
});

test('plane change, bi-elliptic limit, propellant', () => {
  const r = orbit({ ...ORBIT_DEF, di: 28.5 });
  // the combined burn is cheaper than a separate plane change
  assert.ok(r.dv < r.dvSeparate && r.dv > r.dvNoPlane);
  // bi-elliptic with r_b → ∞ beats Hohmann above r2/r1 = 11.94 and loses below
  const mu = 1, a = biElliptic(mu, 1, 15, Infinity).dv, b = hohmann(mu, 1, 15).dv; assert.ok(a < b);
  assert.ok(biElliptic(mu, 1, 10, Infinity).dv > hohmann(mu, 1, 10).dv);
  const d = orbit(ORBIT_DEF);
  near(d.dvAvail, 320 * 9.80665 * Math.log(5500 / 1500), 1e-6, 'available Δv');
  near(d.mUsed, 5500 * (1 - Math.exp(-d.dv / (320 * 9.80665))), 1e-6, 'propellant used');
  assert.ok(d.checks.every((c) => c.ok), JSON.stringify(d.checks.filter((c) => !c.ok)));
  // downward transfer costs the same as upward
  near(hohmann(BODIES.earth.mu, 7e6, 9e6).dv, hohmann(BODIES.earth.mu, 9e6, 7e6).dv, 1e-9, 'symmetry');
  near(eccAnomaly(1.2, 0.5) - 0.5 * Math.sin(eccAnomaly(1.2, 0.5)), 1.2, 1e-12, 'Kepler');
});

test('slider ends give numbers', () => {
  for (const e of [{ h1: 100e3 }, { h2: 100e3 }, { h1: 400000e3 }, { h2: 900000e3 }, { di: 90 }, { body: 'moon' }, { body: 'mars', h2: 20000e3 }, { mProp: 0.1 }] as Partial<OrbitIn>[]) {
    const r = orbit({ ...ORBIT_DEF, ...e }); for (const v of [r.dv, r.t, r.mUsed, r.dvAvail, r.bi.dv]) assert.ok(Number.isFinite(v), JSON.stringify(e));
  }
});
