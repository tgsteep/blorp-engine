/**
 * Ship resistance and powering after Holtrop & Mennen (1982), "An approximate power prediction method",
 * International Shipbuilding Progress 29 (335). Friction line ITTC-1957. Low-speed wave-resistance formula (F_n ≤ 0.4);
 * half angle of entrance i_E from Holtrop (1984) when it is not given. Propulsion factors w, t, η_R for single-screw
 * ships with a conventional stern, or the twin-screw formulas of the same paper. Blade area from Keller's formula.
 * Open-water efficiency from the Wageningen B-series polynomials (`bseries.ts`) at the pitch ratio that gives the best
 * efficiency for the thrust, as in the paper's example.
 *
 * Units: lengths m, areas m², speed in knots at the interface (m/s inside), forces N, powers W.
 */
import { AE_RANGE, bestPitch, keller } from './bseries.ts';
const fx = (v: number, n: number) => (Number.isFinite(v) ? v.toFixed(n) : '—'); // a missing result reads as a dash

export type ResIn = {
  L: number; B: number; T: number;          // waterline length, moulded breadth, mean draft (even keel: T_F = T_A = T) [m]
  CB: number; CM: number; CWP: number;      // block, midship section, waterplane area coefficients
  lcb: number;                              // longitudinal centre of buoyancy, % of L forward (+) or aft (−) of ½L
  ABT: number; hB: number;                  // transverse bulb area at the forward perpendicular [m²], its centre above the keel [m]
  AT: number;                               // immersed transom area at rest [m²]
  SAPP: number; k2: number;                 // wetted area of appendages [m²], their form factor 1 + k₂
  Cstern: number;                           // stern shape: −25 pram with gondola, −10 V sections, 0 normal, +10 U sections with Hogner stern
  D: number; Z: number; screws: 1 | 2;      // propeller diameter [m], blades, number of propellers
  V: number;                                // ship speed [kn]
  iE?: number;                              // half angle of entrance [°]; estimated when left out
  rho?: number; nu?: number;                // sea water 15 °C: 1025 kg/m³, 1.1883e-6 m²/s (ITTC)
  etaS?: number; margin?: number; sfoc?: number; // shaft efficiency, sea margin (fraction), specific fuel oil consumption [g/kWh]
};

const G = 9.81, KN = 1852 / 3600;
const CLEAR = 0.2;   // propeller tip clearance to the keel line [m] (as in the paper's example)

export const kn2ms = (v: number) => v * KN;

/** Holtrop–Mennen resistance components and propulsion factors at speed V [kn]. */
export function holtrop(p: ResIn, Vkn = p.V) {
  const rho = p.rho ?? 1025, nu = p.nu ?? 1.1883e-6, V = Vkn * KN;
  const { L, B, T, CB, CM, CWP, lcb, ABT, hB, AT } = p;
  const TF = T, TA = T;
  const vol = CB * L * B * T, CP = CB / CM, q = 0.5 * rho * V * V;
  const Fn = V / Math.sqrt(G * L), Rn = (V * L) / nu;

  // form factor of the bare hull
  const LR = L * (1 - CP + (0.06 * CP * lcb) / (4 * CP - 1));
  const TL = T / L;
  const c12 = TL > 0.05 ? Math.pow(TL, 0.2228446) : TL > 0.02 ? 48.2 * Math.pow(TL - 0.02, 2.078) + 0.479948 : 0.479948;
  const c13 = 1 + 0.003 * p.Cstern;
  const k1 = c13 * (0.93 + c12 * Math.pow(B / LR, 0.92497) * Math.pow(0.95 - CP, -0.521448) * Math.pow(1 - CP + 0.0225 * lcb, 0.6906));

  // wetted surface of the bare hull, friction (ITTC-1957), appendages
  const S = L * (2 * T + B) * Math.sqrt(CM) * (0.453 + 0.4425 * CB - 0.2862 * CM - 0.003467 * (B / T) + 0.3696 * CWP) + (2.38 * ABT) / CB;
  const CF = 0.075 / Math.pow(Math.log10(Rn) - 2, 2);
  const RF = q * S * CF;
  const RAPP = q * p.SAPP * p.k2 * CF;

  // wave resistance, low-speed formula
  const iE = p.iE ?? 1 + 89 * Math.exp(-(Math.pow(L / B, 0.80856) * Math.pow(1 - CWP, 0.30484) * Math.pow(1 - CP - 0.0225 * lcb, 0.6367) * Math.pow(LR / B, 0.34574) * Math.pow((100 * vol) / L ** 3, 0.16302)));
  const BL = B / L;
  const c7 = BL < 0.11 ? 0.229577 * Math.pow(BL, 0.33333) : BL <= 0.25 ? BL : 0.5 - 0.0625 / BL;
  const c1 = 2223105 * Math.pow(c7, 3.78613) * Math.pow(T / B, 1.07961) * Math.pow(90 - iE, -1.37565);
  const c3 = ABT > 0 ? (0.56 * Math.pow(ABT, 1.5)) / (B * T * (0.31 * Math.sqrt(ABT) + TF - hB)) : 0;
  const c2 = Math.exp(-1.89 * Math.sqrt(c3));
  const c5 = 1 - (0.8 * AT) / (B * T * CM);
  const lam = L / B < 12 ? 1.446 * CP - 0.03 * (L / B) : 1.446 * CP - 0.36;
  const c16 = CP < 0.8 ? 8.07981 * CP - 13.8673 * CP * CP + 6.984388 * CP ** 3 : 1.73014 - 0.7067 * CP;
  const m1 = 0.0140407 * (L / T) - (1.75254 * Math.cbrt(vol)) / L - 4.79323 * BL - c16;
  const L3V = L ** 3 / vol;
  const c15 = L3V < 512 ? -1.69385 : L3V > 1726.91 ? 0 : -1.69385 + (L / Math.cbrt(vol) - 8) / 2.36;
  const m2 = c15 * CP * CP * Math.exp(-0.1 / (Fn * Fn));
  const RW = Fn > 0 ? c1 * c2 * c5 * vol * rho * G * Math.exp(m1 * Math.pow(Fn, -0.9) + m2 * Math.cos(lam / (Fn * Fn))) : 0;

  // bulbous bow near the surface, immersed transom
  let RB = 0;
  if (ABT > 0) {
    const PB = (0.56 * Math.sqrt(ABT)) / (TF - 1.5 * hB);
    const Fni = V / Math.sqrt(G * (TF - hB - 0.25 * Math.sqrt(ABT)) + 0.15 * V * V);
    RB = (0.11 * Math.exp(-3 / (PB * PB)) * Fni ** 3 * Math.pow(ABT, 1.5) * rho * G) / (1 + Fni * Fni);
  }
  const FnT = AT > 0 ? V / Math.sqrt((2 * G * AT) / (B + B * CWP)) : Infinity;
  const c6 = FnT < 5 ? 0.2 * (1 - 0.2 * FnT) : 0;
  const RTR = q * AT * c6;

  // model–ship correlation allowance
  const c4 = TF / L <= 0.04 ? TF / L : 0.04;
  const CA = 0.006 * Math.pow(L + 100, -0.16) - 0.00205 + 0.003 * Math.sqrt(L / 7.5) * CB ** 4 * c2 * (0.04 - c4);
  const RA = q * S * CA;

  const RT = RF * k1 + RAPP + RW + RB + RTR + RA;
  const PE = RT * V;

  // propulsion factors
  const Stot = S + p.SAPP, kTot = k1 + ((p.k2 - k1) * p.SAPP) / Stot; // overall form factor 1 + k
  const CV = kTot * CF + CA;
  const CP1 = 1.45 * CP - 0.315 - 0.0225 * lcb;
  let w: number, t: number;
  if (p.screws === 1) {
    const BT = B / TA;
    const c8 = BT < 5 ? (B * S) / (L * p.D * TA) : (S * (7 * BT - 25)) / (L * p.D * (BT - 3));
    const c9 = c8 < 28 ? c8 : 32 - 16 / (c8 - 24);
    const c11 = TA / p.D < 2 ? TA / p.D : 0.0833333 * (TA / p.D) ** 3 + 1.33333;
    w = c9 * CV * (L / TA) * (0.0661875 + (1.21756 * c11 * CV) / (1 - CP1)) + 0.24558 * Math.sqrt(B / (L * (1 - CP1)))
      - 0.09726 / (0.95 - CP) + 0.11434 / (0.95 - CB) + 0.75 * p.Cstern * CV + 0.002 * p.Cstern;
    const c10 = L / B > 5.2 ? BL : 0.25 - 0.003328402 / (BL - 0.134615385);
    t = (0.001979 * L) / (B - B * CP1) + 1.0585 * c10 - 0.00524 - (0.1418 * p.D * p.D) / (B * T) + 0.0015 * p.Cstern;
  } else {
    w = 0.3095 * CB + 10 * CV * CB - (0.23 * p.D) / Math.sqrt(B * T);
    t = 0.325 * CB - (0.1885 * p.D) / Math.sqrt(B * T);
  }
  const thrust = RT / (1 - t) / p.screws;                      // per propeller [N]
  const hShaft = TA - CLEAR - p.D / 2;                          // shaft immersion [m]
  const AEA0 = keller(thrust, p.D, p.Z, hShaft, p.screws, rho);
  const etaR = p.screws === 1 ? 0.9922 - 0.05908 * AEA0 + 0.07424 * (CP - 0.0225 * lcb) : 0.9737 + 0.111 * (CP - 0.0225 * lcb) - 0.06325 * 1.0;
  const VA = V * (1 - w), A0 = (Math.PI * p.D * p.D) / 4;
  const CT = VA > 0 ? thrust / (0.5 * rho * A0 * VA * VA) : Infinity;
  const etaI = 2 / (1 + Math.sqrt(1 + CT));                  // ideal (actuator disc) efficiency
  // B-series propeller with Keller's blade area (kept inside the series' range) and the most efficient pitch
  const Zs = Math.min(7, Math.max(3, Math.round(p.Z))), AEs = Math.min(AE_RANGE[Zs][1], Math.max(AE_RANGE[Zs][0], AEA0));
  const best = VA > 0 && thrust > 0 ? bestPitch(thrust, VA, p.D, AEs, Zs, rho) : { PD: NaN, eta: 0 };
  const etaO = Number.isFinite(best.eta) ? best.eta : 0, PDopt = best.PD;
  const etaH = (1 - t) / (1 - w), etaD = etaO * etaH * etaR;
  const PD = PE / etaD, PB = PD / (p.etaS ?? 0.98);
  const Pserv = PB * (1 + (p.margin ?? 0.15));
  const fuelDay = ((p.sfoc ?? 175) * (Pserv / 1000) * 24) / 1e6; // t/day
  const fuelNm = Vkn > 0 ? (fuelDay * 1000) / (Vkn * 24) : Infinity; // kg per nautical mile

  return {
    V, Vkn, Fn, Rn, vol, disp: (vol * rho) / 1000, CP, LR, c12, c13, k1, S, CF, RF, RAPP, iE, c1, c2, c3, c5, c7, c15, c16, m1, m2, lam,
    RW, RB, RTR, c4, CA, RA, RT, PE, kTot, CV, CP1, w, t, thrust, hShaft, AEA0, AEs, PDopt, etaR, VA, CT, etaI, etaO, etaH, etaD, PD, PB, Pserv, fuelDay, fuelNm,
  };
}
export type HoltropPoint = ReturnType<typeof holtrop>;

type Check = { ok: boolean; label: string; detail: string };

/** Speed at which the Froude number reaches F_n [kn]. */
export const speedAtFn = (L: number, Fn: number) => (Fn * Math.sqrt(G * L)) / KN;
/** Upper end of the speed–power curve: F_n = 0.40 (end of the low-speed wave formula). */
export const FN_MAX = 0.4;

export function resistance(p: ResIn) {
  const r = holtrop(p);
  const vTop = Math.max(p.V, speedAtFn(p.L, FN_MAX)) * 1.0001;
  // a point can be drawn when its resistance and engine power came out as real, positive numbers
  const drawable = (q: HoltropPoint) => Number.isFinite(q.RT) && q.RT >= 0 && Number.isFinite(q.PB) && q.PB > 0;
  const curve: HoltropPoint[] = [];
  for (let i = 0; i <= 40; i++) { const q = holtrop(p, Math.max(0.5, (vTop * i) / 40)); if (drawable(q)) curve.push(q); }
  const LB = p.L / p.B, BT = p.B / p.T, tipDepth = p.T - CLEAR - p.D;
  // the regression is only defined for consistent hull numbers (C_B ≤ C_M, C_P < 0.95, lcb not at the extremes of a full hull)
  const hullOk = r.CP < 0.95 && Number.isFinite(r.k1) && Number.isFinite(r.RW) && r.RT >= 0;
  const bulbOk = p.ABT <= 0 || (p.hB + 0.25 * Math.sqrt(p.ABT) < p.T && p.ABT <= 0.2 * p.B * p.T * p.CM);
  const checks: Check[] = [
    { ok: hullOk, label: 'Hull numbers consistent for the method (C_P = C_B/C_M < 0.95, lcb within the hull’s fullness)', detail: `C_P = ${fx(r.CP, 3)}, lcb = ${fx(p.lcb, 2)} %` },
    { ok: bulbOk, label: 'Bulb under water and smaller than ⅕ of the midship section (h_B + ¼√A_BT < T)', detail: p.ABT > 0 ? `${fx((p.hB + 0.25 * Math.sqrt(p.ABT)), 2)} m < ${fx(p.T, 2)} m, A_BT = ${fx(p.ABT, 1)} m²` : 'no bulb' },
    { ok: r.Fn <= FN_MAX, label: 'Froude number F_n ≤ 0.40 (range of the low-speed wave formula)', detail: `F_n = ${fx(r.Fn, 3)}` },
    { ok: r.CP >= 0.55 && r.CP <= 0.85, label: 'Prismatic coefficient 0.55 ≤ C_P ≤ 0.85 (ships the method was fitted to)', detail: `C_P = ${fx(r.CP, 3)}` },
    { ok: LB >= 3.9 && LB <= 9.5, label: 'Length–breadth ratio 3.9 ≤ L/B ≤ 9.5', detail: `L/B = ${fx(LB, 2)}` },
    { ok: BT >= 2.1 && BT <= 4.0, label: 'Breadth–draft ratio 2.1 ≤ B/T ≤ 4.0', detail: `B/T = ${fx(BT, 2)}` },
    { ok: tipDepth >= 0, label: 'Propeller fits under the waterline (D + 0.2 m keel clearance ≤ T)', detail: `${fx((p.D + CLEAR), 2)} m ≤ ${fx(p.T, 2)} m` },
    { ok: r.AEA0 <= 1.05, label: 'Blade area ratio A_E/A_0 ≤ 1.05 (Keller; larger means cavitation, a bigger propeller is needed)', detail: `A_E/A_0 = ${fx(r.AEA0, 2)}` },
    { ok: r.w > 0 && r.w < 0.6 && r.t > 0 && r.t < 0.5, label: 'Wake and thrust deduction in the usual range (0 < w < 0.6, 0 < t < 0.5)', detail: `w = ${fx(r.w, 3)}, t = ${fx(r.t, 3)}` },
  ];
  return { ...r, curve, vTop, LB, BT, checks };
}
export type ResResult = ReturnType<typeof resistance>;

export type ResKind = 'example' | 'cargo' | 'tug' | 'yacht' | 'barge';
/** Hull presets; `depth` and `a` (end fullness) only shape the 3D drawing. The example is the paper's 205 m ship. */
export const RES_PRESETS: Record<ResKind, ResIn & { depth: number; a: number }> = {
  example: { L: 205, B: 32, T: 10, CB: 37500 / (205 * 32 * 10), CM: 0.98, CWP: 0.75, lcb: -0.75, ABT: 20, hB: 4, AT: 16, SAPP: 50, k2: 1.5, Cstern: 10, D: 8, Z: 4, screws: 1, V: 25, depth: 19, a: 2.4 },
  cargo: { L: 140, B: 22, T: 8.5, CB: 0.7, CM: 0.985, CWP: 0.82, lcb: 1, ABT: 12, hB: 3.5, AT: 0, SAPP: 30, k2: 1.5, Cstern: 0, D: 5.6, Z: 4, screws: 1, V: 14.5, depth: 12, a: 2 },
  tug: { L: 32, B: 8, T: 3.6, CB: 0.52, CM: 0.82, CWP: 0.8, lcb: -3, ABT: 0, hB: 0, AT: 2, SAPP: 8, k2: 2, Cstern: 0, D: 2.4, Z: 4, screws: 1, V: 12, depth: 4.8, a: 1.6 },
  yacht: { L: 24, B: 5.6, T: 1.6, CB: 0.45, CM: 0.7, CWP: 0.75, lcb: -4, ABT: 0, hB: 0, AT: 1.2, SAPP: 4, k2: 2.5, Cstern: 0, D: 1.0, Z: 4, screws: 2, V: 11, depth: 3, a: 1.6 },
  barge: { L: 60, B: 15, T: 2.5, CB: 0.92, CM: 0.995, CWP: 0.95, lcb: 0, ABT: 0, hB: 0, AT: 0, SAPP: 6, k2: 1.5, Cstern: 0, D: 1.6, Z: 4, screws: 2, V: 7, depth: 5.5, a: 4 },
};

export const RES_INTRO =
  'A ship moving through water pays twice: water rubs along the wetted skin (friction) and the hull pushes up waves that carry energy away behind it (wave resistance). Friction grows roughly with the speed squared; wave resistance grows much faster and depends on the Froude number V/√(gL), the ratio of the wave length the ship makes to its own length. The Holtrop–Mennen method, fitted to hundreds of model tests, turns a few hull numbers into these components, then into the power the engine must deliver through the propeller.';
export const RES_NOTES = [
  'Resistance after Holtrop & Mennen (1982): R_T = R_F (1 + k₁) + R_APP + R_W + R_B + R_TR + R_A. Friction line ITTC-1957 C_F = 0.075/(log₁₀Rn − 2)², sea water 15 °C (ρ 1025 kg/m³, ν 1.1883·10⁻⁶ m²/s). Form factor 1 + k₁ with c₁₂ and c₁₃, wetted surface S from the regression, appendages with their own form factor 1 + k₂. Wave resistance from the low-speed formula, valid to F_n ≈ 0.4 (the paper blends a high-speed formula above that, not included); half angle of entrance i_E from Holtrop (1984). Bulb (R_B) and immersed transom (R_TR) terms and the correlation allowance C_A as in the paper. Even keel, deep water, calm sea, no wind.',
  'Propulsion: wake fraction w, thrust deduction t and relative-rotative efficiency η_R from the same paper (single screw with conventional stern, or its twin-screw formulas with P/D = 1). Blade area ratio from Keller’s formula (tip clearance 0.2 m). Open-water efficiency η_O from the Wageningen B-series polynomials (Oosterveld & van Oossanen 1975, model Reynolds number 2·10⁶) with that blade area (kept within the series’ range for the blade number) and the pitch ratio between 0.5 and 1.4 that gives the best efficiency for the thrust — the Ship propellers tool shows the whole open-water diagram. Shaft efficiency 0.98, sea margin 15 %, fuel = SFOC · P_B (1 + margin) · 24 h.',
  'Validation: the paper’s numerical example (L 205 m, B 32 m, T 10 m, ∇ 37 500 m³, lcb −0.75 % L, bulb 20 m², transom 16 m², 25 kn) gives R_T = 1793 kN and P_E = 23 063 kW; this tool gives the same within 0.1 %, w, t, η_R within 0.003 and the B-series η_O 0.644 against the paper’s 0.646. Choose “Holtrop–Mennen example” to see it. Results outside the method’s range (checks) are only indications.',
];

/** Half angle of the Kelvin wedge: asin(1/3) = 19.47°. */
export const KELVIN_HALF = Math.asin(1 / 3);
const smooth = (a: number, b: number, x: number) => { const u = Math.min(Math.max((x - a) / (b - a), 0), 1); return u * u * (3 - 2 * u); };

/**
 * Surface elevation of the steady Kelvin wave pattern around a ship (for drawings, shape only — not a wave-resistance
 * calculation). Ship frame: bow at x = +L/2, stern at −L/2, y across, the pattern trails towards −x. Two point
 * sources (bow crest, stern trough, weaker). For a point d behind a source and r to the side, stationary phase gives
 * two waves (tan θ = (−d ± √(d² − 8r²))/(4r)): transverse and divergent, with phase k₀·secθ·(d + r·tanθ), k₀ = g/V².
 * Inside the wedge r/d < 1/√8 only. Amplitude falls like 1/√distance; returns height in units of `amp`.
 */
export function kelvin(x: number, y: number, L: number, Vms: number) {
  if (Vms <= 0) return 0;
  const k0 = G / (Vms * Vms), r = Math.abs(y);
  const source = (xs: number, sign: number, gain: number) => {
    const d = xs - x;
    if (d <= 0) return 0;
    const q = r / d, lim = 1 / Math.sqrt(8);
    if (q >= lim) return 0;
    const disc = Math.sqrt(Math.max(d * d - 8 * r * r, 0));
    const fall = 1 / Math.sqrt(1 + (k0 * d) / (2 * Math.PI)), ramp = smooth(0, 0.08 * L, d), edge = 1 - smooth(0.93 * lim, lim, q);
    const cusp = 1 + 0.8 * Math.exp(-(((q - 0.95 * lim) / (0.06 * lim)) ** 2));
    let h = 0;
    if (r < 1e-9) h = Math.cos(k0 * d);
    else {
      for (const [s, a] of [[1, 1], [-1, 0.8 * smooth(0.2, 0.32, q)]] as const) { // divergent waves only near the wedge edges (shorter than the eye resolves near the track)
        const T = (-d + s * disc) / (4 * r);
        h += a * Math.cos(k0 * Math.sqrt(1 + T * T) * (d + r * T));
      }
    }
    return sign * gain * fall * ramp * edge * cusp * h;
  };
  return source(L / 2, 1, 1) + source(-L / 2, -1, 0.6);
}
/** Transverse wave length 2πV²/g [m]. */
export const waveLength = (Vms: number) => (2 * Math.PI * Vms * Vms) / G;
