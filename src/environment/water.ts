/**
 * Drinking-water treatment train (conventional surface-water plant): rapid mix, flocculation, sedimentation,
 * rapid sand filtration and chlorine contact.
 *
 * - mixing: G = √(P/(μV)), V = Q·t; flocculation dose G·t (Camp–Stein);
 * - floc settling velocity from the drag law C_D = 24/Re·(1 + 0.15 Re^0.687) (Schiller–Naumann, Re < 800), solved by iteration;
 * - ideal rectangular basin (Hazen/Camp): overflow rate v_o = Q/A, removal r = v_s/v_o (all particles with v_s ≥ v_o);
 * - filtration rate with all filters and with one out of service (backwash);
 * - disinfection: T₁₀ = BF·V/Q (baffling factor), CT = C·T₁₀, required CT for Giardia inactivation by free chlorine from the
 *   US EPA SWTR tables (3-log values at 0.5…25 °C, pH 6…9, C ≤ 0.4…3 mg/L, interpolated; other log values in proportion).
 * Units: m, s, m³, mg/L, °C.
 */

export type Check = { ok: boolean; label: string; detail: string };

/** Water viscosity [Pa·s] (CRC Handbook fit around 20 °C, 0…40 °C within 1 %). */
export const mu = (T: number) => 1.002e-3 * Math.pow(10, (1.3272 * (20 - T) - 0.001053 * (T - 20) ** 2) / (T + 105));
/** Water density [kg/m³] (0…40 °C within 0.05 %). */
export const rhoW = (T: number) => 1000 * (1 - ((T + 288.9414) / (508929.2 * (T + 68.12963))) * (T - 3.9863) ** 2);

/** Terminal settling velocity [m/s] of a sphere d [m], density ρp, in water at T: Schiller–Naumann drag, fixed-point iteration. */
export function settling(d: number, rhoP: number, T: number) {
  const m = mu(T), r = rhoW(T), dr = Math.max(rhoP - r, 0);
  let v = (9.80665 * dr * d * d) / (18 * m); // Stokes first
  for (let i = 0; i < 60; i++) {
    const Re = Math.max((r * v * d) / m, 1e-9), Cd = (24 / Re) * (1 + 0.15 * Math.pow(Re, 0.687));
    const vn = Math.sqrt((4 * 9.80665 * dr * d) / (3 * Cd * r));
    if (Math.abs(vn - v) < 1e-12) break;
    v = 0.5 * (v + vn);
  }
  return { v, Re: (r * v * d) / m, stokes: (9.80665 * dr * d * d) / (18 * m) };
}

/** US EPA SWTR: CT [mg·min/L] for 3-log Giardia inactivation by free chlorine; [temperature][concentration][pH]. */
const CT_T = [0.5, 5, 10, 15, 20, 25], CT_C = [0.4, 1, 2, 3], CT_PH = [6, 6.5, 7, 7.5, 8, 8.5, 9];
const CT3: number[][][] = [
  [[137, 163, 195, 237, 277, 329, 390], [148, 176, 210, 253, 304, 365, 437], [165, 197, 236, 286, 346, 417, 500], [181, 217, 261, 316, 382, 460, 552]],
  [[97, 117, 139, 166, 198, 236, 279], [105, 125, 149, 179, 216, 260, 312], [116, 138, 165, 200, 243, 294, 353], [126, 151, 182, 221, 268, 324, 369]],
  [[73, 88, 104, 125, 149, 177, 209], [79, 94, 112, 134, 162, 195, 234], [87, 104, 124, 150, 182, 221, 265], [95, 113, 137, 166, 201, 243, 292]],
  [[49, 59, 70, 83, 99, 118, 140], [53, 63, 75, 90, 108, 130, 156], [58, 69, 83, 100, 122, 147, 177], [63, 76, 91, 111, 134, 162, 195]],
  [[36, 44, 52, 62, 74, 89, 105], [39, 47, 56, 67, 81, 98, 117], [44, 52, 62, 75, 91, 110, 132], [47, 57, 68, 83, 101, 122, 146]],
  [[24, 29, 35, 42, 50, 59, 70], [26, 31, 37, 45, 54, 65, 78], [29, 35, 41, 50, 61, 74, 88], [32, 38, 46, 55, 67, 81, 97]],
];
const bracket = (xs: number[], x: number) => { const v = Math.min(Math.max(x, xs[0]), xs[xs.length - 1]); let i = 0; while (i < xs.length - 2 && v > xs[i + 1]) i++; return { i, f: (v - xs[i]) / (xs[i + 1] - xs[i]) }; };
/** Trilinear interpolation in the EPA table (clamped to its range: below 0.5 °C use 0.5 °C, C ≤ 0.4 uses 0.4 mg/L). */
export function ct3Giardia(T: number, C: number, pH: number) {
  const a = bracket(CT_T, T), b = bracket(CT_C, C), c = bracket(CT_PH, pH);
  let s = 0;
  for (const [ia, wa] of [[a.i, 1 - a.f], [a.i + 1, a.f]] as const) for (const [ib, wb] of [[b.i, 1 - b.f], [b.i + 1, b.f]] as const) for (const [ic, wc] of [[c.i, 1 - c.f], [c.i + 1, c.f]] as const) s += wa * wb * wc * CT3[ia][ib][ic];
  return s;
}
export const BAFFLE = [
  { id: 'none', bf: 0.1, name: 'Unbaffled (mixed tank)' }, { id: 'poor', bf: 0.3, name: 'Poor (single inlet and outlet, no baffles)' },
  { id: 'avg', bf: 0.5, name: 'Average (some intra-basin baffles)' }, { id: 'good', bf: 0.7, name: 'Superior (serpentine baffles)' }, { id: 'plug', bf: 1.0, name: 'Plug flow (pipeline)' },
] as const;

export type WtIn = {
  Q: number; T: number; pH: number;            // flow [m³/d], temperature [°C], pH
  Gr: number; tr: number;                      // rapid mix: G [1/s], time [s]
  Gf: number; tf: number;                      // flocculation: G [1/s], time [min]
  nS: number; L: number; B: number; H: number;  // sedimentation tanks: number, length, width, water depth [m]
  d: number; rhoF: number;                     // floc diameter [mm], floc density [kg/m³]
  nF: number; Af: number;                      // filters: number, area each [m²]
  C: number; Vc: number; bf: number; logs: number; // chlorine residual [mg/L], contact volume [m³], baffling factor, Giardia log credit needed
};

export function treatment(p: WtIn) {
  const Qs = p.Q / 86400, m = mu(p.T);
  const Vr = Qs * p.tr, Pr = p.Gr * p.Gr * m * Vr;                    // m³, W
  const Vf = Qs * p.tf * 60, Pf = p.Gf * p.Gf * m * Vf, Gt = p.Gf * p.tf * 60;
  const As = p.nS * p.L * p.B, vo = Qs / As, td = (p.nS * p.L * p.B * p.H) / Qs, vh = Qs / (p.nS * p.B * p.H);
  const set = settling(p.d / 1000, p.rhoF, p.T), r = Math.min(1, set.v / vo);
  const vf = p.Q / 24 / (p.nF * p.Af), vf1 = p.nF > 1 ? p.Q / 24 / ((p.nF - 1) * p.Af) : Infinity;
  const T10 = (p.bf * p.Vc) / Qs / 60, CT = p.C * T10, CTreq = (ct3Giardia(p.T, p.C, p.pH) * p.logs) / 3;
  const logAch = CTreq > 0 ? (CT / ct3Giardia(p.T, p.C, p.pH)) * 3 : Infinity;
  const vom = vo * 3600, vhm = vh * 60;
  const checks: Check[] = [
    { ok: p.Gr >= 600 && p.Gr <= 1000 && p.tr >= 10 && p.tr <= 60, label: 'Rapid mix: G 600…1000 s⁻¹ for 10…60 s', detail: `G = ${p.Gr.toFixed(0)} s⁻¹, t = ${p.tr.toFixed(0)} s` },
    { ok: Gt >= 1e4 && Gt <= 2e5 && p.Gf <= 80, label: 'Flocculation: G ≤ 80 s⁻¹ and G·t 10⁴…2·10⁵', detail: `G·t = ${Gt.toExponential(2)}` },
    { ok: vom >= 0.5 && vom <= 2.5, label: 'Sedimentation overflow rate 0.5…2.5 m/h', detail: `v_o = ${vom.toFixed(2)} m/h` },
    { ok: td >= 1.5 * 3600 && td <= 4 * 3600, label: 'Sedimentation detention time 1.5…4 h', detail: `t = ${(td / 3600).toFixed(2)} h` },
    { ok: p.L / p.B >= 4, label: 'Basin length at least 4 × width (even flow)', detail: `L/B = ${(p.L / p.B).toFixed(1)}` },
    { ok: vhm <= 0.5, label: 'Horizontal velocity ≤ 0.5 m/min (no scour)', detail: `v_h = ${vhm.toFixed(3)} m/min` },
    { ok: r >= 0.9, label: 'Ideal-basin removal of the floc ≥ 90 %', detail: `v_s/v_o = ${(set.v * 3600).toFixed(2)}/${vom.toFixed(2)} → ${(r * 100).toFixed(0)} %` },
    { ok: vf >= 5 && vf1 <= 15, label: 'Filtration rate 5…15 m/h (also with one filter backwashing)', detail: `${vf.toFixed(1)} m/h, ${Number.isFinite(vf1) ? vf1.toFixed(1) : '∞'} m/h with ${p.nF - 1}` },
    { ok: CT >= CTreq, label: 'Chlorine CT meets the Giardia inactivation needed', detail: `CT = ${CT.toFixed(1)} ≥ ${CTreq.toFixed(1)} mg·min/L (${p.logs} log)` },
    { ok: p.C >= 0.2 && p.C <= 4, label: 'Free chlorine residual 0.2…4 mg/L', detail: `C = ${p.C.toFixed(2)} mg/L` },
  ];
  return { Qs, m, Vr, Pr, Vf, Pf, Gt, As, vo, td, vh, set, r, vf, vf1, T10, CT, CTreq, logAch, checks };
}
export type WtResult = ReturnType<typeof treatment>;

export const WT_INTRO = 'Surface water is made drinkable in steps: a coagulant is mixed in fast (rapid mix), gentle stirring grows the tiny particles into flocs (flocculation), the flocs settle in a long quiet basin (sedimentation), sand filters catch what is left, and chlorine kills germs during a contact time. Each step has simple sizing rules; a basin removes every floc that settles faster than the water rises over its surface.';

export const WT_NOTES = [
  'Mixing intensity G = √(P/(μ·V)) (Camp–Stein) with V = Q·t; water viscosity and density from temperature. Floc settling: a sphere of the given diameter and density with the Schiller–Naumann drag law (Stokes at low Re); real flocs are porous and irregular — measure settling in a jar test for design. Sedimentation as an ideal Hazen/Camp basin: removal r = v_s/v_o, independent of depth; real basins lose some efficiency to short-circuiting, wind and density currents.',
  'Design ranges used as checks are typical textbook values (rapid mix G 600…1000 s⁻¹ for 10…60 s; flocculation G ≤ 80 s⁻¹, G·t 10⁴…2·10⁵; sedimentation 0.5…2.5 m/h, 1.5…4 h, L ≥ 4B, v_h ≤ 0.5 m/min; rapid sand filters 5…15 m/h with one filter out of service; free chlorine 0.2…4 mg/L). National rules and the water itself decide the final design.',
  'Disinfection credit: CT = C·T₁₀ with T₁₀ = BF·V/Q (EPA baffling factors 0.1 unbaffled … 1.0 plug flow). Required CT for Giardia inactivation by free chlorine from the US EPA Surface Water Treatment Rule tables (as reproduced in 35 Ill. Adm. Code 611 Appendix B), interpolated in temperature, chlorine concentration and pH; other log values in proportion to the 3-log CT. Conventional treatment usually earns 2.5 log for Giardia, so disinfection must add 0.5 log; without filtration 3 log. Cryptosporidium is hardly affected by chlorine and needs filtration, UV or ozone. Values outside the tables (below 0.5 °C, above 25 °C, pH outside 6…9, C above 3 mg/L) use the nearest edge.',
];
