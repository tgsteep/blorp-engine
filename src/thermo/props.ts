/**
 * Fluid properties by interpolation in tables generated from CoolProp (scripts/build-thermo-tables.py).
 * Units: T °C, p kPa, v m³/kg, h kJ/kg, s kJ/(kg·K).
 */
import { TABLES, type FluidTable } from './tables.ts';

export type Fluid = keyof typeof TABLES;
export type State = { T: number; p: number; h: number; s: number; x: number | null; v?: number }; // x: quality (null = single phase)

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Saturation properties at temperature T [°C] (linear in T between 1 K rows). */
export function satT(f: Fluid, T: number) {
  const s = TABLES[f].sat;
  let i = s.findIndex((r) => r[0] >= T);
  if (i <= 0) i = i === 0 ? 1 : s.length - 1;
  const a = s[i - 1], b = s[i], t = Math.min(Math.max((T - a[0]) / (b[0] - a[0]), 0), 1);
  // pressure: interpolate ln p (closer to Clausius–Clapeyron than linear)
  return { T, p: Math.exp(lerp(Math.log(a[1]), Math.log(b[1]), t)), vf: lerp(a[2], b[2], t), vg: Math.exp(lerp(Math.log(a[3]), Math.log(b[3]), t)), hf: lerp(a[4], b[4], t), hg: lerp(a[5], b[5], t), sf: lerp(a[6], b[6], t), sg: lerp(a[7], b[7], t) };
}

/** Saturation temperature at pressure p [kPa] (inverse of satT, bisection). */
export function TsatP(f: Fluid, p: number) {
  const s = TABLES[f].sat;
  let lo = s[0][0], hi = s[s.length - 1][0];
  for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (satT(f, m).p < p) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
export const satP = (f: Fluid, p: number) => satT(f, TsatP(f, p));

/** Superheated vapour at pressure p and superheat dT ≥ 0 (bilinear: ln p between rows, dT within a row). */
function supRow(tb: FluidTable, r: number, dT: number) {
  const row = tb.sup[r], d = tb.dT;
  let j = d.findIndex((x) => x >= dT);
  if (j <= 0) j = j === 0 ? 1 : d.length - 1;
  const t = (dT - d[j - 1]) / (d[j] - d[j - 1]);
  return { h: lerp(row.h[j - 1], row.h[j], t), s: lerp(row.s[j - 1], row.s[j], t) };
}
export function superheated(f: Fluid, p: number, dT: number) {
  const tb = TABLES[f], ps = tb.sup.map((r) => r.p);
  let i = ps.findIndex((x) => x >= p);
  if (i <= 0) i = i === 0 ? 1 : ps.length - 1;
  const t = (Math.log(p) - Math.log(ps[i - 1])) / (Math.log(ps[i]) - Math.log(ps[i - 1]));
  const a = supRow(tb, i - 1, dT), b = supRow(tb, i, dT);
  return { h: lerp(a.h, b.h, t), s: lerp(a.s, b.s, t) };
}

/** State from p and T: superheated vapour above T_sat, compressed liquid (≈ saturated liquid at T) below. */
export function statePT(f: Fluid, p: number, T: number): State {
  const Ts = TsatP(f, p);
  if (T >= Ts) { const v = superheated(f, p, T - Ts); return { T, p, h: v.h, s: v.s, x: null }; }
  const l = satT(f, T);
  return { T, p, h: l.hf + l.vf * (p - l.p), s: l.sf, x: null, v: l.vf };
}

/** Find the superheat at pressure p that gives property `key` = target (bisection on the table). */
function supInverse(f: Fluid, p: number, key: 'h' | 's', target: number) {
  const dTs = TABLES[f].dT;
  let lo = 0, hi = dTs[dTs.length - 1];
  for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (superheated(f, p, m)[key] < target) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/** State from p and s (wet if s < s_g, else superheated). */
export function statePS(f: Fluid, p: number, s: number): State {
  const sat = satP(f, p);
  if (s <= sat.sg) {
    const x = Math.max((s - sat.sf) / (sat.sg - sat.sf), 0);
    return { T: sat.T, p, h: sat.hf + x * (sat.hg - sat.hf), s, x, v: sat.vf + x * (sat.vg - sat.vf) };
  }
  const dT = supInverse(f, p, 's', s);
  return { T: sat.T + dT, p, h: superheated(f, p, dT).h, s, x: null };
}

/** State from p and h. */
export function statePH(f: Fluid, p: number, h: number): State {
  const sat = satP(f, p);
  if (h <= sat.hg) {
    const x = Math.max((h - sat.hf) / (sat.hg - sat.hf), 0);
    return { T: sat.T, p, h, s: sat.sf + x * (sat.sg - sat.sf), x, v: sat.vf + x * (sat.vg - sat.vf) };
  }
  const dT = supInverse(f, p, 'h', h);
  return { T: sat.T + dT, p, h, s: superheated(f, p, dT).s, x: null };
}

/** Saturation dome for T–s diagrams: [s_f, s_g, T] rows. */
export function dome(f: Fluid, n = 40) {
  const s = TABLES[f].sat, out: { T: number; sf: number; sg: number }[] = [];
  for (let k = 0; k < n; k++) { const r = s[Math.round((k * (s.length - 1)) / (n - 1))]; out.push({ T: r[0], sf: r[6], sg: r[7] }); }
  const last = s[s.length - 1], tc = TABLES[f].Tcrit;
  if (tc - last[0] > 0.5) out.push({ T: tc, sf: (last[6] + last[7]) / 2, sg: (last[6] + last[7]) / 2 }); // close the dome at the critical point
  return out;
}

export const FLUID_NAME = (f: Fluid) => TABLES[f].name;
export const TCRIT = (f: Fluid) => TABLES[f].Tcrit;
