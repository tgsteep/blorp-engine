/**
 * Sheet-metal bending (air bending in a V-die): neutral axis by the K-factor (DIN 6935 correction factor or a
 * chosen value), bend allowance, bend deduction and flat length, minimum inner radius and flange, the inner radius
 * that air bending gives for the die, press force, and springback (Kalpakjian, elastic–perfectly plastic sheet).
 * Units: mm, degrees at the interface, MPa, kN.
 */

export type Check = { ok: boolean; label: string; detail: string };

export type SheetMaterial = {
  id: string; name: string; E: number; Re: number; Rm: number;
  rMin: number; // smallest inner radius / thickness without cracking (bend across the rolling direction)
  rAir: number; // inner radius / die opening in air bending
};
/** Typical rounded values (cold-rolled or annealed sheet) — check the supplier's bending data. */
export const SHEET_MATERIALS: SheetMaterial[] = [
  { id: 'dc01', name: 'Cold-rolled steel DC01', E: 210000, Re: 240, Rm: 340, rMin: 0.5, rAir: 0.156 },
  { id: 's235', name: 'Structural steel S235', E: 210000, Re: 235, Rm: 400, rMin: 1, rAir: 0.156 },
  { id: 's355', name: 'Structural steel S355', E: 210000, Re: 355, Rm: 520, rMin: 1.6, rAir: 0.16 },
  { id: 'stainless', name: 'Stainless steel 1.4301', E: 200000, Re: 260, Rm: 600, rMin: 1, rAir: 0.2 },
  { id: 'al5754', name: 'Aluminium 5754 H22', E: 70000, Re: 130, Rm: 220, rMin: 1, rAir: 0.13 },
  { id: 'al6082', name: 'Aluminium 6082 T6', E: 70000, Re: 260, Rm: 310, rMin: 3, rAir: 0.15 },
  { id: 'copper', name: 'Copper Cu-ETP (half hard)', E: 120000, Re: 200, Rm: 250, rMin: 0.5, rAir: 0.14 },
];

/** DIN 6935: correction factor k = 0.65 + 0.5 lg(R/t) up to R/t = 5 (k = 1 above); K = k/2 is the neutral-axis position. */
export function kDin6935(R: number, t: number) {
  const k = R / t >= 5 ? 1 : Math.max(0, Math.min(1, 0.65 + 0.5 * Math.log10(R / t)));
  return k / 2;
}

/** Bend allowance BA = θ (R + K t), outside setback OSSB = (R + t) tan(θ/2), bend deduction BD = 2 OSSB − BA. */
export function bendGeometry(R: number, t: number, K: number, thetaDeg: number) {
  const th = (thetaDeg * Math.PI) / 180;
  const BA = th * (R + K * t), OSSB = (R + t) * Math.tan(th / 2), BD = 2 * OSSB - BA;
  return { BA, OSSB, BD };
}

/** Springback (Kalpakjian): R_i/R_f = 4x³ − 3x + 1, x = R_i R_e/(E t); bend angle after release α_f = α_i (R_i + t/2)/(R_f + t/2). */
export function springback(Ri: number, t: number, Re: number, E: number) {
  const x = (Ri * Re) / (E * t), ratio = 4 * x ** 3 - 3 * x + 1; // R_i/R_f
  const plastic = x < 0.5 && ratio > 0;
  const Rf = plastic ? Ri / ratio : Infinity;
  const Ks = plastic ? (Ri + t / 2) / (Rf + t / 2) : 0; // α_f/α_i
  return { x, Rf, Ks, plastic };
}

export type BendIn = {
  mat: SheetMaterial; t: number; R: number; theta: number; // thickness, inner radius, bend angle [°] (90 = right angle)
  a: number; b: number; // flange lengths, outside dimensions to the virtual sharp
  V: number; Lb: number; // die opening, bend length
  kMode: 'din' | 'manual'; K: number; Fmax: number; // press capacity [kN]
};

export function bend(p: BendIn) {
  const K = p.kMode === 'din' ? kDin6935(p.R, p.t) : p.K;
  const g = bendGeometry(p.R, p.t, K, p.theta);
  const flat = p.a + p.b - g.BD;
  const sb = springback(p.R, p.t, p.mat.Re, p.mat.E);
  const thetaI = sb.plastic ? p.theta / sb.Ks : Infinity; // bend this far to end at θ after release
  const F = (1.33 * p.mat.Rm * p.Lb * p.t * p.t) / p.V / 1000; // kN, air bending to 90°
  // too small a press stalls part way: the force needed is taken to rise from 75 % (plastic hinge formed) to 100 % at the
  // full angle as the sheet wraps into the die (schematic); below 75 % the sheet only flexes elastically and springs back flat
  const reach = F <= p.Fmax ? 1 : Math.min(Math.max((p.Fmax / F - 0.75) / 0.25, 0), 1);
  const thetaStall = reach * (Number.isFinite(thetaI) ? Math.min(thetaI, 178) : p.theta); // under load
  const thetaReached = sb.plastic ? thetaStall * sb.Ks : 0; // after the punch lifts
  const rMin = p.mat.rMin * p.t, rAir = p.mat.rAir * p.V, bMin = 0.7 * p.V;
  // the straight part of each flange outside the bend must sit on the die shoulders
  const flangeA = p.a - g.OSSB, flangeB = p.b - g.OSSB;
  const checks: Check[] = [
    { ok: p.R >= rMin, label: 'Inner radius ≥ minimum for the material (no cracks)', detail: `R = ${p.R.toFixed(2)} ≥ ${rMin.toFixed(2)} mm (${p.mat.rMin} t)` },
    { ok: Math.min(p.a, p.b) >= bMin, label: 'Both flanges ≥ 0.7 V (the sheet stays on the die)', detail: `${Math.min(p.a, p.b).toFixed(1)} ≥ ${bMin.toFixed(1)} mm` },
    { ok: p.V >= 6 * p.t && p.V <= 12 * p.t, label: 'Die opening 6…12 × thickness', detail: `V/t = ${(p.V / p.t).toFixed(1)}` },
    { ok: p.R >= 0.6 * rAir && p.R <= 1.6 * rAir, label: 'Inner radius close to what air bending in this die gives', detail: `R ≈ ${p.mat.rAir} V = ${rAir.toFixed(2)} mm in air bending` },
    { ok: F <= p.Fmax, label: 'Press brake force is enough', detail: F <= p.Fmax ? `F = ${F.toFixed(1)} kN ≤ ${p.Fmax.toFixed(0)} kN` : `F = ${F.toFixed(1)} kN > ${p.Fmax.toFixed(0)} kN: the press stalls, the bend stops at ${thetaReached.toFixed(0)}°` },
    { ok: sb.plastic && thetaI <= 180, label: 'Sheet takes a permanent set (springback can be overbent)', detail: sb.plastic ? `bend to ${thetaI.toFixed(1)}° for ${p.theta.toFixed(0)}°` : `R R_e/(E t) = ${sb.x.toFixed(2)} ≥ 0.5: it springs back flat` },
  ];
  return { K, ...g, flat, ...sb, thetaI, springDeg: thetaI - p.theta, F, reach, thetaStall, thetaReached, rMin, rAir, bMin, flangeA, flangeB, Rn: p.R + K * p.t, checks };
}

export const BEND_INTRO = 'Bending stretches the outside of the sheet and squeezes the inside; one layer in between keeps its length — the neutral axis, a fraction K of the thickness from the inside. Its length in the bend (bend allowance) gives the flat blank; the material\'s elastic part makes the bend open up a little when the punch lifts (springback).';

export const BEND_NOTES = [
  'Flat length = a + b − BD with flange lengths a, b measured outside to the virtual sharp, bend deduction BD = 2 (R + t) tan(θ/2) − θ (R + K t) (θ = bend angle). DIN 6935: correction factor k = 0.65 + ½ lg(R/t) for R/t < 5, else 1, neutral axis at K = k/2 from the inside; in practice K is often tuned to the shop\'s own test bends (typical 0.3…0.45 in air bending).',
  'Air bending in a V-die: inner radius about a fixed fraction of the die opening (≈ 0.156 V for mild steel, 0.2 V stainless, 0.13 V soft aluminium); force F = 1.33 R_m L t²/V for a 90° bend (bottoming or coining needs 3…10 times more). When the press is too small the bend stops part way; the force is taken to rise from 75 % of F when the sheet starts to yield to F at the full angle (a schematic stroke curve), so a press below 75 % of F leaves the sheet only elastically flexed. Minimum flange 0.7 V. Minimum inner radii are typical values across the rolling direction; along it they are larger.',
  'Springback (Kalpakjian): R_i/R_f = 4 (R_i R_e/(E t))³ − 3 (R_i R_e/(E t)) + 1 for an elastic–perfectly plastic sheet, bend angle after release α_f = α_i (R_i + t/2)/(R_f + t/2). Work hardening, anisotropy and the die geometry change real springback; use a test bend. Material values are typical, rounded.',
];
