/**
 * Stack dispersion: steady Gaussian plume with ground reflection (screening level, as in EPA ISC / SCREEN3).
 *
 *   C(x, y, z) = Q/(2π u σ_y σ_z) · e^(−y²/2σ_y²) · [e^(−(z − H)²/2σ_z²) + e^(−(z + H)²/2σ_z²)]
 *
 * - wind at the stack top: power law u_s = u₁₀ (h_s/10)^p with the ISC exponents for the stability class (rural/urban);
 * - stack-tip downwash (Briggs): h′ = h_s + 2d (v_s/u_s − 1.5) when v_s < 1.5 u_s;
 * - plume rise (Briggs, as in ISC): buoyancy flux F_b = g v_s d² ΔT/(4 T_s), momentum flux F_m = v_s² d² T_a/(4 T_s);
 *   unstable/neutral Δh = 21.425 F_b^¾/u_s (F_b < 55) or 38.71 F_b^⅗/u_s, momentum Δh = 3 d v_s/u_s;
 *   stable s = g (dθ/dz)/T_a (0.02 K/m for E, 0.035 K/m for F), Δh = 2.6 (F_b/(u_s s))^⅓, momentum 1.5 (F_m/(u_s √s))^⅓;
 *   buoyancy or momentum rise chosen by the crossover temperature difference; final rise used for all distances;
 * - dispersion coefficients: Briggs (1973) open-country or McElroy–Pooler urban formulas, 100 m … 10 km;
 * - averaging times from the 1-hour value with the EPA (1992) screening factors 0.9 (3 h), 0.7 (8 h), 0.4 (24 h), 0.08 (year).
 * No mixing-height reflection, no building downwash, no terrain, no deposition or chemistry.
 * Units: m, s, K internally; Q [g/s]; C [µg/m³].
 */

export type Check = { ok: boolean; label: string; detail: string };
export type Stab = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type Pollutant = 'SO2' | 'NO2' | 'PM10' | 'CO';
export const CLASSES: Stab[] = ['A', 'B', 'C', 'D', 'E', 'F'];
export const POL_SYM: Record<Pollutant, string> = { SO2: 'SO₂', NO2: 'NO₂', PM10: 'PM10', CO: 'CO' };

/** EU Directive 2008/50/EC limit values [µg/m³] by averaging time (h; 8760 = calendar year). */
export const LIMITS: Record<Pollutant, { h: number; v: number; note: string }[]> = {
  SO2: [{ h: 1, v: 350, note: 'not more than 24 times a year' }, { h: 24, v: 125, note: 'not more than 3 times a year' }],
  NO2: [{ h: 1, v: 200, note: 'not more than 18 times a year' }, { h: 8760, v: 40, note: 'calendar year' }],
  PM10: [{ h: 24, v: 50, note: 'not more than 35 times a year' }, { h: 8760, v: 40, note: 'calendar year' }],
  CO: [{ h: 8, v: 10000, note: 'highest daily 8-hour mean' }],
};
/** EPA (1992) screening factors from the 1-hour maximum to longer averaging times. */
export const AVG: Record<number, number> = { 1: 1, 3: 0.9, 8: 0.7, 24: 0.4, 8760: 0.08 };

const P_RURAL: Record<Stab, number> = { A: 0.07, B: 0.07, C: 0.1, D: 0.15, E: 0.35, F: 0.55 };
const P_URBAN: Record<Stab, number> = { A: 0.15, B: 0.15, C: 0.2, D: 0.25, E: 0.3, F: 0.3 };
const G = 9.80665;

/** Briggs dispersion coefficients σ_y, σ_z [m] at downwind distance x [m]. */
export function sigmas(cls: Stab, x: number, urban: boolean) {
  if (!urban) {
    const r = (a: number) => (a * x) / Math.sqrt(1 + 0.0001 * x);
    switch (cls) {
      case 'A': return { sy: r(0.22), sz: 0.2 * x };
      case 'B': return { sy: r(0.16), sz: 0.12 * x };
      case 'C': return { sy: r(0.11), sz: (0.08 * x) / Math.sqrt(1 + 0.0002 * x) };
      case 'D': return { sy: r(0.08), sz: (0.06 * x) / Math.sqrt(1 + 0.0015 * x) };
      case 'E': return { sy: r(0.06), sz: (0.03 * x) / (1 + 0.0003 * x) };
      default: return { sy: r(0.04), sz: (0.016 * x) / (1 + 0.0003 * x) };
    }
  }
  const r = (a: number) => (a * x) / Math.sqrt(1 + 0.0004 * x);
  switch (cls) {
    case 'A': case 'B': return { sy: r(0.32), sz: 0.24 * x * Math.sqrt(1 + 0.001 * x) };
    case 'C': return { sy: r(0.22), sz: 0.2 * x };
    case 'D': return { sy: r(0.16), sz: (0.14 * x) / Math.sqrt(1 + 0.0003 * x) };
    default: return { sy: r(0.11), sz: (0.08 * x) / Math.sqrt(1 + 0.0015 * x) };
  }
}

/** Gaussian plume with ground reflection [µg/m³] for Q [g/s], u [m/s], effective height H [m]. */
export function plume(Q: number, u: number, H: number, sy: number, sz: number, y: number, z: number) {
  return ((Q * 1e6) / (2 * Math.PI * u * sy * sz)) * Math.exp(-(y * y) / (2 * sy * sy)) * (Math.exp(-((z - H) ** 2) / (2 * sz * sz)) + Math.exp(-((z + H) ** 2) / (2 * sz * sz)));
}

export type PlumeIn = {
  pol: Pollutant; Q: number;            // emission rate [g/s]
  hs: number; d: number; vs: number;   // stack height, inner diameter [m], exit velocity [m/s]
  Ts: number; Ta: number;              // exit gas and ambient temperature [°C]
  u10: number; cls: Stab; urban: boolean;
  cb: number;                          // background concentration [µg/m³]
  xr: number; yr: number;              // receptor: downwind and crosswind distance [m]
};

/** Plume rise (Briggs, ISC formulation) and effective height. */
export function rise(p: PlumeIn) {
  const pw = (p.urban ? P_URBAN : P_RURAL)[p.cls], us = Math.max(1, p.u10 * Math.pow(Math.max(p.hs, 10) / 10, pw));
  const Ts = p.Ts + 273.15, Ta = p.Ta + 273.15, dT = Math.max(Ts - Ta, 0);
  const Fb = (G * p.vs * p.d * p.d * dT) / (4 * Ts), Fm = (p.vs * p.vs * p.d * p.d * Ta) / (4 * Ts);
  const hp = p.vs < 1.5 * us ? Math.max(0, p.hs + 2 * p.d * (p.vs / us - 1.5)) : p.hs;
  const stable = p.cls === 'E' || p.cls === 'F';
  let dhB: number, dhM: number, dTc: number, xf: number, s = 0;
  if (!stable) {
    dhB = Fb < 55 ? (21.425 * Math.pow(Fb, 0.75)) / us : (38.71 * Math.pow(Fb, 0.6)) / us;
    xf = Fb < 55 ? 49 * Math.pow(Fb, 5 / 8) : 119 * Math.pow(Fb, 0.4);
    dhM = (3 * p.d * p.vs) / us;
    dTc = Fb < 55 ? (0.0297 * Ts * Math.cbrt(p.vs)) / Math.pow(p.d, 2 / 3) : (0.00575 * Ts * Math.pow(p.vs, 2 / 3)) / Math.cbrt(p.d);
  } else {
    s = (G * (p.cls === 'E' ? 0.02 : 0.035)) / Ta;
    dhB = 2.6 * Math.cbrt(Fb / (us * s));
    xf = 2.0715 * us / Math.sqrt(s);
    dhM = Math.min(1.5 * Math.cbrt(Fm / (us * Math.sqrt(s))), (3 * p.d * p.vs) / us);
    dTc = 0.019582 * Ts * p.vs * Math.sqrt(s);
  }
  const buoyant = dT >= dTc && Fb > 0;
  const dh = buoyant ? dhB : dhM;
  return { pw, us, Fb, Fm, hp, dhB, dhM, dTc, buoyant, dh, xf, s, H: hp + dh };
}

export function dispersion(p: PlumeIn) {
  const R = rise(p), C = (x: number, y = 0, z = 0) => { const { sy, sz } = sigmas(p.cls, x, p.urban); return plume(p.Q, R.us, R.H, sy, sz, y, z); };
  // ground-level centreline concentration on a log grid, then refine the maximum
  const curve: { x: number; c: number }[] = [];
  for (let i = 0; i <= 240; i++) { const x = 50 * Math.pow(1000, i / 240); curve.push({ x, c: C(x) }); } // 50 m … 50 km
  let k = 0; curve.forEach((q, i) => { if (q.c > curve[k].c) k = i; });
  let a = curve[Math.max(0, k - 1)].x, b = curve[Math.min(curve.length - 1, k + 1)].x;
  for (let i = 0; i < 60; i++) { const m1 = a + (b - a) * 0.382, m2 = a + (b - a) * 0.618; if (C(m1) > C(m2)) b = m2; else a = m1; }
  const xmax = (a + b) / 2, cmax = C(xmax), sAt = sigmas(p.cls, xmax, p.urban);
  const cr = C(p.xr, p.yr);
  const lim = LIMITS[p.pol].map((L) => ({ ...L, c: cmax * AVG[L.h] + p.cb }));
  const sym = POL_SYM[p.pol];
  const checks: Check[] = [
    ...lim.map((L) => ({ ok: L.c <= L.v, label: L.h === 8760 ? `${sym} annual mean below the EU limit (${L.note})` : `${sym} ${L.h}-hour mean below the EU limit (${L.note})`, detail: `${L.h === 1 ? '' : `${AVG[L.h]} × `}${cmax.toFixed(1)} + ${p.cb} = ${L.c.toFixed(1)} ≤ ${L.v} µg/m³` })),
    { ok: p.vs >= 1.5 * R.us, label: 'No stack-tip downwash (v_s ≥ 1.5 u)', detail: `${p.vs.toFixed(1)} ≥ ${(1.5 * R.us).toFixed(1)} m/s` },
    { ok: xmax >= 100 && xmax <= 10000, label: 'Highest concentration inside the 100 m…10 km range of the σ formulas', detail: `x_max = ${(xmax / 1000).toFixed(2)} km` },
  ];
  return { ...R, curve, xmax, cmax, sAt, cr, lim, C, checks };
}
export type DispResult = ReturnType<typeof dispersion>;

/** Highest ground-level concentration against the wind speed at 10 m (the critical wind speed gives the worst case). */
export function windSweep(p: PlumeIn) {
  return Array.from({ length: 40 }, (_, i) => { const u = 0.5 + i * 0.5; return { u, c: dispersion({ ...p, u10: u }).cmax }; });
}

export const DISP_INTRO = 'A chimney releases its gas well above the ground; the hot, fast gas rises further (plume rise) and the wind carries it away while turbulence spreads it sideways and down. The Gaussian plume model gives the concentration everywhere downwind: it is highest on the ground some distance away, where the spreading plume first reaches people. Stability of the air (classes A, very unstable, to F, very stable) decides how fast it spreads.';

export const DISP_NOTES = [
  'Steady Gaussian plume with reflection at the ground (EPA ISC / SCREEN3 type screening model): C = Q/(2π u σ_y σ_z)·e^(−y²/2σ_y²)·[e^(−(z−H)²/2σ_z²) + e^(−(z+H)²/2σ_z²)]. Wind at the stack top from the power law with the ISC exponents; σ_y, σ_z from the Briggs (1973) open-country or McElroy–Pooler urban formulas (valid 100 m…10 km); stability class chosen by you (Pasquill: A very unstable, sunny light wind … D neutral, overcast or windy … F very stable, clear night, light wind).',
  'Plume rise: Briggs final rise as used in ISC (buoyancy flux F_b = g v_s d² ΔT/(4T_s), momentum rise when the gas is not hot enough), applied at all distances; stack-tip downwash h′ = h_s + 2d(v_s/u − 1.5) when the exit velocity is below 1.5 × the wind. Not included: building downwash (keep the stack at least 2.5 × the nearby building height), terrain, the mixing height lid, calm winds below 1 m/s, deposition and chemistry (NO is treated as NO₂, conservative).',
  'Averaging times: the model gives about 1-hour averages; longer averages use the EPA (1992) screening factors 0.9 (3 h), 0.7 (8 h), 0.4 (24 h), 0.08 (year) on the highest 1-hour value. Limits: EU Directive 2008/50/EC (SO₂ 350 µg/m³ 1 h and 125 µg/m³ 24 h; NO₂ 200 µg/m³ 1 h and 40 µg/m³ year; PM10 50 µg/m³ 24 h and 40 µg/m³ year; CO 10 mg/m³ 8 h). The WHO 2021 guidelines are lower. A screening result above a limit means a detailed model (AERMOD, AUSTAL, CALPUFF) with local weather data is needed, not a final answer.',
];
