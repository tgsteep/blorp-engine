import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispersion, plume, rise, sigmas, windSweep, type PlumeIn } from './dispersion.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const base: PlumeIn = { pol: 'SO2', Q: 50, hs: 60, d: 2, vs: 15, Ts: 150, Ta: 15, u10: 4, cls: 'D', urban: false, cb: 10, xr: 1500, yr: 0 };

test('Gaussian plume conserves mass: ∫∫ u C dy dz over the half space z ≥ 0 = Q', () => {
  const Q = 10, u = 5, H = 80, { sy, sz } = sigmas('D', 2000, false);
  let s = 0; const dy = sy / 20, dz = sz / 20;
  for (let y = -8 * sy; y <= 8 * sy; y += dy) for (let z = dz / 2; z <= H + 8 * sz; z += dz) s += plume(Q, u, H, sy, sz, y, z) * dy * dz;
  near((s * u) / 1e6, Q, 0.01 * Q, 'mass flux [g/s]');
});

test('ground-level centreline: C = Q/(π u σ_y σ_z) e^(−H²/2σ_z²) (hand calculation)', () => {
  const v = plume(100, 4, 50, 80, 40, 0, 0), hand = ((100e6) / (Math.PI * 4 * 80 * 40)) * Math.exp(-(2500) / (2 * 1600));
  near(v, hand, 1e-9 * hand);
  near(plume(100, 4, 50, 80, 40, 80, 0) / v, Math.exp(-0.5), 1e-12, 'one σ_y off the axis');
});

test('Briggs open-country σ (hand values at 1 km) and urban σ larger than rural', () => {
  const d = sigmas('D', 1000, false); near(d.sy, 80 / Math.sqrt(1.1), 1e-9); near(d.sz, 60 / Math.sqrt(2.5), 1e-9);
  const f = sigmas('F', 1000, false); near(f.sz, 16 / 1.3, 1e-9);
  for (const c of ['A', 'B', 'C', 'D', 'E', 'F'] as const) assert.ok(sigmas(c, 1000, true).sz > sigmas(c, 1000, false).sz * 0.9, c);
  // spreading decreases from A to F
  const zs = (['A', 'B', 'C', 'D', 'E', 'F'] as const).map((c) => sigmas(c, 2000, false).sz);
  for (let i = 1; i < zs.length; i++) assert.ok(zs[i] < zs[i - 1]);
});

test('Briggs plume rise (hand calculation) and stack-tip downwash', () => {
  const r = rise(base), Ts = 423.15, Ta = 288.15;
  near(r.Fb, (9.80665 * 15 * 4 * (Ts - Ta)) / (4 * Ts), 1e-9, 'F_b');
  near(r.us, 4 * Math.pow(6, 0.15), 1e-9, 'u at the stack top');
  assert.ok(r.Fb < 55 && r.buoyant);
  near(r.dh, (21.425 * Math.pow(r.Fb, 0.75)) / r.us, 1e-9, 'final rise, F_b < 55');
  const big = rise({ ...base, d: 4 }); assert.ok(big.Fb >= 55); near(big.dh, (38.71 * Math.pow(big.Fb, 0.6)) / big.us, 1e-9, 'final rise, F_b ≥ 55');
  near(r.H, 60 + r.dh, 1e-9, 'no downwash at 15 m/s');
  const slow = rise({ ...base, vs: 3, u10: 6 }); near(slow.hp, 60 + 2 * 2 * (3 / slow.us - 1.5), 1e-9, 'downwash');
  const cold = rise({ ...base, Ts: 16 }); assert.ok(!cold.buoyant); near(cold.dh, (3 * 2 * 15) / cold.us, 1e-9, 'momentum rise');
  const st = rise({ ...base, cls: 'E' }); near(st.dhB, 2.6 * Math.cbrt(st.Fb / (st.us * st.s)), 1e-9, 'stable rise');
});

test('maximum ground-level concentration: about where σ_z ≈ H/√2 for near-linear σ, and a critical wind speed exists', () => {
  const r = dispersion({ ...base, cls: 'B' });
  near(r.sAt.sz / (r.H / Math.SQRT2), 1, 0.12, 'σ_z at x_max');
  assert.ok(r.curve.every((q) => q.c <= r.cmax * (1 + 1e-9)));
  const sw = windSweep(base), i = sw.reduce((k, q, j) => (q.c > sw[k].c ? j : k), 0);
  assert.ok(i > 0 && i < sw.length - 1, 'interior maximum over wind speed');
});

test('checks: a tall hot stack passes, a short cold one with a big release fails', () => {
  assert.ok(dispersion(base).checks.every((c) => c.ok), dispersion(base).checks.filter((c) => !c.ok).map((c) => c.label).join('; '));
  assert.ok(dispersion({ ...base, hs: 15, Ts: 40, Q: 200 }).checks.some((c) => !c.ok));
});
