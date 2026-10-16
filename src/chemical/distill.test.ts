import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bubble, dew, distill, latent, psat, stepOff, type DistIn } from './distill.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);

test('VALIDATION (Geankoplis, Transport Processes, Table 11.1-1): benzene–toluene equilibrium at 101.32 kPa', () => {
  for (const [T, x, y] of [[358.2, 0.78, 0.9], [363.2, 0.581, 0.777], [368.2, 0.411, 0.632], [373.2, 0.258, 0.456], [378.2, 0.13, 0.261]]) {
    const t = T - 273.15, pa = psat('benzene', t), pb = psat('toluene', t), xx = (101.32 - pb) / (pa - pb);
    near(xx, x, 0.012, `x at ${T} K`); near((xx * pa) / 101.32, y, 0.012, `y at ${T} K`);
  }
  // normal boiling points 80.1 °C and 110.6 °C; latent heats ≈ 30.7 and 33.2 kJ/mol
  near(bubble('benzene', 'toluene', 101.325, 1).t, 80.1, 0.2, 'benzene boils'); near(bubble('benzene', 'toluene', 101.325, 0).t, 110.6, 0.3, 'toluene boils');
  near(latent('benzene', 80.1) / 1000, 30.7, 1.6, 'λ benzene (ideal-vapour Clausius–Clapeyron, ≈ 4 % high)'); near(latent('toluene', 110.6) / 1000, 33.2, 1.7, 'λ toluene');
  // dew and bubble points are inverse
  const b = bubble('benzene', 'toluene', 101.325, 0.4); near(dew('benzene', 'toluene', 101.325, b.y).x, 0.4, 1e-6);
});

test('McCabe–Thiele: mass balance, minimum reflux, total reflux against Fenske (constant α), flows', () => {
  const p: DistIn = { pair: 'bt', P: 101.325, F: 100, xF: 0.45, q: 1, xD: 0.95, xB: 0.1, Rf: 1.5, E: 0.7, spacing: 0.6 };
  const r = distill(p);
  near(r.D, (100 * 0.35) / 0.85, 1e-9, 'D'); near(r.D + r.B, 100, 1e-9);
  // saturated-liquid feed: pinch at x = x_F, R_min = (x_D − y*)/(y* − x_F)
  const yF = bubble('benzene', 'toluene', 101.325, 0.45).y; near(r.Rmin, (0.95 - yF) / (yF - 0.45), 1e-9, 'R_min');
  near(r.V, (r.R + 1) * r.D, 1e-9); near(r.Ls - r.Vs, r.B, 1e-9, 'bottoms = L′ − V′');
  assert.ok(distill({ ...p, Rf: 1.02 }).st.N > distill({ ...p, Rf: 1.3 }).st.N, 'fewer stages with more reflux');
  assert.ok(r.st.N > r.total.N, 'more stages than at total reflux');
  // constant α = 2.5 at total reflux: whole steps equal Fenske's count
  const a = 2.5, eqX = (y: number) => y / (a - (a - 1) * y), s = stepOff(0.95, 0.05, eqX, (x) => x, -1);
  const fen = Math.log((0.95 / 0.05) * (0.95 / 0.05)) / Math.log(a);
  near(s.N, fen, 0.5, 'total reflux ≈ Fenske');
  assert.equal(s.steps.length, Math.ceil(fen), 'whole steps');
});
