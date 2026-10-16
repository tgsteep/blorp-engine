/**
 * Ship propeller from the Wageningen B-series (`bseries.ts`): the thrust a ship needs at its speed, the wake that slows
 * the water reaching the propeller, and a B-series screw (blades, diameter, pitch ratio, blade area) → the shaft speed
 * at which it gives that thrust, torque, delivered power and open-water efficiency; the most efficient pitch for this
 * diameter; Keller's blade-area rule against cavitation and the cavitation number at 0.7 R. SI units (knots and rpm
 * shown on the page).
 */
import { AE_RANGE, atThrust, bestPitch, bseries, etaOpen, jZero, keller, P0_PV, PD_RANGE } from './bseries.ts';
import { holtrop, RES_PRESETS, type ResKind } from './resistance.ts';

export type Check = { ok: boolean; label: string; detail: string };
export type ShipPropIn = {
  Z: number;          // blades 3…7
  D: number;          // diameter [m]
  PD: number;         // pitch ratio P/D
  AE: number;         // expanded blade-area ratio A_E/A_0
  V: number;          // ship speed [kn]
  w: number;          // wake fraction
  T: number;          // thrust needed per propeller [N]
  h: number;          // shaft centre below the waterline [m]
  screws: 1 | 2;
};
const G = 9.81, KN = 1852 / 3600, RHO = 1025;

/** Blade outline of the B-series (Kuiper 1992), r/R 0.2 … 1: chord c Z/(D A_E/A_0), leading edge from the generator line
 *  a/c, maximum thickness t/D = A − B Z. Used for the drawings and the blade area of the 3D model. */
export const OUTLINE = {
  x: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
  c4: [1.662, 1.882, 2.05, 2.152, 2.187, 2.144, 1.97, 1.582, 0],
  c3: [1.633, 1.832, 2.0, 2.12, 2.186, 2.168, 2.127, 1.657, 0],
  le: [0.616, 0.611, 0.599, 0.583, 0.558, 0.526, 0.481, 0.4, 0.2],
  tA: [0.0526, 0.0464, 0.0402, 0.034, 0.0278, 0.0216, 0.0154, 0.0092, 0.003],
  tB: [0.004, 0.0035, 0.003, 0.0025, 0.002, 0.0015, 0.001, 0.0005, 0],
};
export const HUB = 0.167, RAKE = (15 * Math.PI) / 180;
const lerpT = (xs: number[], ys: number[], x: number) => {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) { const u = (x - xs[i - 1]) / (xs[i] - xs[i - 1]); return ys[i - 1] + u * (ys[i] - ys[i - 1]); }
  return ys[ys.length - 1];
};
/** Tip rounding: above 0.8 R both edges close to the tip along a superellipse (1 − u^p)^(1/p), u = (x − 0.8)/0.2, with
 *  p = 1.7 so the chord at 0.9 R matches the table (the table's straight line from 0.9 R to a zero chord at the tip would
 *  draw a cut-off, pointed tip). */
const TIP_X = 0.8, TIP_P = 1.7;
/** Blade section at radius fraction x: chord [m], leading edge ahead of the generator line [m], max thickness [m]. */
export function bladeSection(x: number, D: number, AE: number, Z: number) {
  const c0 = Z === 3 ? OUTLINE.c3 : OUTLINE.c4, k = (D * AE) / Z;
  const tip = x > TIP_X ? Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, (x - TIP_X) / (1 - TIP_X)), TIP_P)), 1 / TIP_P) : 1;
  const xe = Math.min(x, TIP_X), c = lerpT(OUTLINE.x, c0, xe) * k * tip;
  const le = lerpT(OUTLINE.x, OUTLINE.le, xe) * c, t = Math.max(0.0015, lerpT(OUTLINE.x, OUTLINE.tA, x) - lerpT(OUTLINE.x, OUTLINE.tB, x) * Z) * D;
  return { c, le, t };
}

export function shipProp(p: ShipPropIn) {
  const V = p.V * KN, VA = V * (1 - p.w), A0 = (Math.PI * p.D * p.D) / 4;
  const op = atThrust(p.T, VA, p.D, p.PD, p.AE, p.Z, RHO);
  const best = bestPitch(p.T, VA, p.D, p.AE, p.Z, RHO);
  const rpm = op.n * 60, pitch = p.PD * p.D;
  const CT = VA > 0 ? p.T / (0.5 * RHO * A0 * VA * VA) : Infinity, etaI = 2 / (1 + Math.sqrt(1 + CT));
  const AEmin = keller(p.T, p.D, p.Z, p.h, p.screws, RHO), range = AE_RANGE[p.Z] ?? [0.3, 1.05];
  const tipSpeed = Math.PI * op.n * p.D, VR2 = VA * VA + (0.7 * tipSpeed) ** 2;
  const sigma07 = (P0_PV + RHO * G * p.h) / (0.5 * RHO * VR2);                  // cavitation number at 0.7 R (shaft depth)
  const slipReal = 1 - VA / (pitch * op.n), slipApp = 1 - V / (pitch * op.n);
  const vInd = 0.5 * VA * (Math.sqrt(1 + CT) - 1);                              // momentum theory: axial speed added at the disc
  const tipDepth = p.h - p.D / 2;
  const reach = Number.isFinite(op.J) && op.J > 0;
  const checks: Check[] = [
    { ok: reach, label: 'The propeller can give the thrust (its K_T curve meets the demand K_T = c J²)', detail: reach ? `J = ${op.J.toFixed(3)}, K_T = ${op.KT.toFixed(4)}` : 'no thrust at this pitch' },
    { ok: p.PD >= PD_RANGE[0] && p.PD <= PD_RANGE[1], label: 'Pitch ratio within the B-series range 0.5 ≤ P/D ≤ 1.4', detail: `P/D = ${p.PD.toFixed(2)}` },
    { ok: p.AE >= range[0] - 1e-9 && p.AE <= range[1] + 1e-9, label: `Blade-area ratio within the series tested for ${p.Z} blades`, detail: `${range[0].toFixed(2)} ≤ ${p.AE.toFixed(2)} ≤ ${range[1].toFixed(2)}` },
    { ok: p.AE >= AEmin, label: 'Blade area at least Keller’s minimum against cavitation', detail: `A_E/A_0 = ${p.AE.toFixed(2)} ≥ ${AEmin.toFixed(3)}` },
    { ok: reach && op.eta >= 0.97 * best.eta, label: 'Pitch within 3 % of the most efficient one for this diameter and thrust', detail: `η_O = ${(op.eta || 0).toFixed(3)} vs best ${(best.eta || 0).toFixed(3)} at P/D ${best.PD.toFixed(2)}` },
    { ok: tipDepth >= 0.1 * p.D, label: 'Blade tips stay well under water (top of the disc ≥ 0.1 D deep)', detail: `${tipDepth.toFixed(2)} m ≥ ${(0.1 * p.D).toFixed(2)} m` },
  ];
  return { V, VA, A0, ...op, best, rpm, pitch, CT, etaI, AEmin, range, tipSpeed, sigma07, slipReal, slipApp, vInd, tipDepth, reach, checks };
}
export type ShipPropResult = ReturnType<typeof shipProp>;

/** Open-water curves K_T, K_Q, η_O from J = 0 to where K_T reaches zero. */
export function openWater(PD: number, AE: number, Z: number, n = 50) {
  const J1 = jZero(PD, AE, Z) || 1;
  return Array.from({ length: n + 1 }, (_, i) => {
    const J = (J1 * i) / n, k = bseries(J, PD, AE, Z);
    return { J, KT: k.KT, KQ: k.KQ, eta: etaOpen(J, k.KT, k.KQ) };
  });
}

export type PropPreset = 'example' | 'cargo' | 'tug' | 'yacht';
/** Operating points taken from the ship-resistance presets (Holtrop–Mennen thrust, wake, diameter, shaft depth). */
export function preset(k: PropPreset): ShipPropIn {
  const s = RES_PRESETS[k as ResKind], r = holtrop(s), Z = Math.min(7, Math.max(3, s.Z)), rg = AE_RANGE[Z];
  const AE = Math.min(rg[1], Math.max(rg[0], Math.ceil(r.AEA0 * 20) / 20));
  const PD = Math.round(bestPitch(r.thrust, r.VA, s.D, AE, Z).PD * 100) / 100;
  return { Z, D: s.D, PD, AE, V: s.V, w: Math.round(r.w * 1000) / 1000, T: Math.round(r.thrust / 100) * 100, h: Math.round(r.hShaft * 100) / 100, screws: s.screws };
}

export const PROP_INTRO =
  'A ship’s propeller is a screw that pushes water aft: each blade is a twisted wing whose lift, turned forwards, is the thrust. The water reaching it has already been dragged along by the hull (the wake), so it meets the propeller slower than the ship moves. The Wageningen B-series — about 120 model propellers tested in the Netherlands — gives the thrust and torque of a whole family as smooth formulas, so for any blade number, blade area and pitch the shaft speed, power and efficiency follow. Big, slow propellers are the most efficient; the blade area must be large enough that the pressure on the blades never falls to the point where the water boils (cavitation).';

export const PROP_NOTES = [
  'Open water: Wageningen B-series polynomials after Oosterveld & van Oossanen (1975), K_T with 39 terms and K_Q with 47 terms in J, P/D, A_E/A_0 and Z, at the series’ Reynolds number 2·10⁶ (model scale; at ship scale η_O is typically 1–3 % higher, not corrected here). Valid for 2…7 blades, A_E/A_0 0.30…1.05, P/D 0.5…1.4. The operating point is where the open-water K_T meets the demand K_T = T/(ρ V_A² D²) · J², sea water ρ = 1025 kg/m³; n = V_A/(J D), Q = ρ n² D⁵ K_Q, P_D = 2π n Q. Behind the hull the power also depends on the relative-rotative efficiency η_R (Ship resistance tool).',
  'Inputs per propeller: thrust T = R_T/(1 − t)/number of propellers and wake fraction w come from the hull (presets take them from the Holtrop–Mennen ship-resistance tool); V_A = V (1 − w). Keller’s minimum blade area (1.3 + 0.3 Z) T/(D² (p₀ + ρ g h − p_v)) + K, K = 0.2 single / 0.1 twin screw, p₀ − p_v = 99.6 kPa at 15 °C; cavitation number σ₀.₇ = (p₀ + ρ g h − p_v)/(½ ρ (V_A² + (0.7 π n D)²)) at the shaft depth. Ideal efficiency from momentum theory 2/(1 + √(1 + C_T)), C_T = T/(½ ρ A₀ V_A²).',
  'Drawings: B-series blade outline, leading-edge line and thickness from Kuiper (1992), 15° rake, constant pitch, hub 0.167 D; sections drawn as flat-faced segments. Validation: the polynomials reproduce the B5-90 and B3-80 operating points of Helma (2020) and the B-series η_O of the Holtrop & Mennen (1982) example (0.644 against 0.646).',
];
