/**
 * Helical springs of round wire.
 *  - Compression: rate, lengths (Shigley Table 10-1 end types), stresses (EN 13906-1: uncorrected for static,
 *    Bergsträsser-corrected for fatigue), coil clearance S_a and buckling (EN 13906-1), Zimmerli/Gerber fatigue
 *    (Shigley §10-9), surge frequency.
 *  - Torsion (leg) spring: rate with leg contribution and coil friction (Shigley eq. 10-51), bending stress with
 *    the inner-fibre factor K_i, coil diameter after wind-up.
 * Units: mm, N, N·mm, MPa, kg.
 */

export type SpringWire = { id: string; name: string; std: string; A: number; m: number; G: number; E: number; bend: number; dMin: number; dMax: number };
const fx = (v: number, n: number) => (Number.isFinite(v) ? v.toFixed(n) : '—'); // a missing result reads as a dash
/** Rm = A/d^m (Shigley Table 10-4), G and E (Table 10-5), allowable bending stress / Rm for torsion springs (Table 10-6). */
export const SPRING_WIRES: SpringWire[] = [
  { id: 'music', name: 'Music wire', std: 'EN 10270-1 DH ≈ ASTM A228', A: 2211, m: 0.145, G: 81000, E: 203400, bend: 0.78, dMin: 0.1, dMax: 6.5 },
  { id: 'hd', name: 'Hard-drawn spring steel', std: 'EN 10270-1 SM ≈ ASTM A227', A: 1783, m: 0.19, G: 80000, E: 197200, bend: 0.78, dMin: 0.7, dMax: 12.7 },
  { id: 'crv', name: 'Chrome-vanadium', std: 'EN 10270-2 VDCrV ≈ ASTM A232', A: 2005, m: 0.168, G: 77200, E: 203400, bend: 0.87, dMin: 0.8, dMax: 12 },
  { id: 'crsi', name: 'Chrome-silicon', std: 'EN 10270-2 VDSiCr ≈ ASTM A401', A: 1974, m: 0.108, G: 77200, E: 203400, bend: 0.87, dMin: 1.6, dMax: 9.5 },
  { id: 'ss', name: 'Stainless 1.4310', std: 'EN 10270-3 ≈ ASTM A313 (302)', A: 1867, m: 0.146, G: 69000, E: 193000, bend: 0.61, dMin: 0.3, dMax: 2.5 },
];
export const RHO_WIRE = 7.85e-6; // kg/mm³

export const tensile = (w: SpringWire, d: number) => w.A / Math.pow(d, w.m);
/** Bergsträsser stress correction (curvature + direct shear). */
export const kBergstrasser = (C: number) => (4 * C + 2) / (4 * C - 3);
/** Inner-fibre bending factor of a torsion spring. */
export const kInner = (C: number) => (4 * C * C - C - 1) / (4 * C * (C - 1));

export type EndType = 'plain' | 'plainGround' | 'squared' | 'squaredGround';
/** Total coils and solid length (Shigley Table 10-1). */
export function ends(type: EndType, n: number, d: number) {
  switch (type) {
    case 'plain': return { Nt: n, Ls: d * (n + 1) };
    case 'plainGround': return { Nt: n + 1, Ls: d * (n + 1) };
    case 'squared': return { Nt: n + 2, Ls: d * (n + 3) };
    default: return { Nt: n + 2, Ls: d * (n + 2) };
  }
}

/** EN 13906-1 critical (buckling) deflection; Infinity when the spring cannot buckle. ν: seating factor. */
export function bucklingDeflection(L0: number, D: number, nu: number, G: number, E: number) {
  const g = G / E, rad = 1 - ((1 - g) / (0.5 + g)) * ((Math.PI * D) / (nu * L0)) ** 2;
  return rad < 0 ? Infinity : L0 * (0.5 / (1 - g)) * (1 - Math.sqrt(rad));
}

/** Zimmerli endurance data, unpeened (Shigley §10-9): S_sa = 241 MPa at S_sm = 379 MPa. Gerber line through S_su = 0.67 R_m. */
export const ZIMMERLI = { Ssa: 241, Ssm: 379 };
export const sseGerber = (Rm: number) => { const Ssu = 0.67 * Rm; return ZIMMERLI.Ssa / (1 - (ZIMMERLI.Ssm / Ssu) ** 2); };
/** Gerber safety factor in shear (Shigley Table 6-7 form). */
export function gerberShear(ta: number, tm: number, Sse: number, Ssu: number) {
  if (ta <= 1e-9) return Ssu / Math.max(tm, 1e-9);
  if (tm <= 1e-9) return Sse / ta;
  return 0.5 * (Ssu / tm) ** 2 * (ta / Sse) * (-1 + Math.sqrt(1 + ((2 * tm * Sse) / (Ssu * ta)) ** 2));
}

export const SEATS = [
  { id: 'flat', name: 'both ends flat and parallel', nu: 0.5 },
  { id: 'pivot1', name: 'one end flat, one pivoted', nu: 0.7 },
  { id: 'pivot2', name: 'both ends pivoted', nu: 1 },
];

export type CompressionIn = { d: number; D: number; n: number; L0: number; endType: EndType; F1: number; F2: number; cyclic: boolean; f: number; nu: number; wire: SpringWire };
export const SPRING_LIMITS = { tauStatic: 0.5, Cmin: 4, Cmax: 16, nf: 1.3, surge: 15 };

export function compression(p: CompressionIn) {
  const { d, D, n, wire: w } = p;
  const C = D / d, KB = kBergstrasser(C);
  const k = (w.G * d ** 4) / (8 * D ** 3 * n); // N/mm
  const { Nt, Ls } = ends(p.endType, n, d);
  const Rm = tensile(w, d);
  const Sa = (0.0015 * (D * D) / d + 0.1 * d) * n * (p.cyclic ? 1.5 : 1); // EN 13906-1 sum of minimum gaps
  const Ln = Ls + Sa;
  const s1 = p.F1 / k, s2 = p.F2 / k, L1 = p.L0 - s1, L2 = p.L0 - s2, sc = p.L0 - Ls, Fc = k * sc;
  const tau = (F: number) => (8 * F * D) / (Math.PI * d ** 3); // uncorrected
  const t1 = tau(p.F1), t2 = tau(p.F2), tc = tau(Fc);
  const tauAllow = SPRING_LIMITS.tauStatic * Rm;
  const sK = bucklingDeflection(p.L0, D, p.nu, w.G, w.E);
  // fatigue (cyclic between F1 and F2), corrected stresses
  const Fa = (p.F2 - p.F1) / 2, Fm = (p.F2 + p.F1) / 2;
  const ta = KB * tau(Fa), tm = KB * tau(Fm), Ssu = 0.67 * Rm, Sse = sseGerber(Rm);
  const nf = gerberShear(ta, tm, Sse, Ssu);
  // surge: active coils between parallel plates
  const mAct = (Math.PI ** 2 * d * d * D * n * RHO_WIRE) / 4; // kg
  const fe = 0.5 * Math.sqrt((k * 1000) / mAct); // Hz
  const lim = SPRING_LIMITS;
  const checks = [
    { ok: C >= lim.Cmin && C <= lim.Cmax, label: `Spring index C = D/d within ${lim.Cmin}…${lim.Cmax}`, detail: `C = ${fx(C, 1)}` },
    { ok: d >= w.dMin && d <= w.dMax, label: 'Wire diameter within the range made in this material', detail: `${w.dMin}…${w.dMax} mm` },
    { ok: t2 <= tauAllow, label: `Working stress τ₂ ≤ 0.5·R_m (EN 13906-1)`, detail: `τ₂ = ${fx(t2, 0)} ≤ ${fx(tauAllow, 0)} MPa` },
    { ok: tc <= tauAllow, label: 'Solid-safe: stress at solid length τ_c ≤ 0.5·R_m', detail: `τ_c = ${fx(tc, 0)} MPa` },
    { ok: L2 >= Ln, label: 'Coils do not touch: L₂ ≥ L_s + S_a', detail: `L₂ = ${fx(L2, 1)} ≥ ${fx(Ln, 1)} mm` },
    { ok: s2 < sK, label: 'No buckling: s₂ < s_K (EN 13906-1)', detail: Number.isFinite(sK) ? `s_K = ${fx(sK, 1)} mm` : 'cannot buckle' },
    ...(p.cyclic ? [
      { ok: nf >= lim.nf, label: `Fatigue (Zimmerli, Gerber) n_f ≥ ${lim.nf}`, detail: `n_f = ${fx(nf, 2)}` },
      { ok: fe >= lim.surge * p.f, label: `Surge frequency ≥ ${lim.surge} × load frequency`, detail: `f_e = ${fx(fe, 0)} Hz` },
    ] : []),
  ];
  return { C, KB, k, Nt, Ls, Rm, Sa, Ln, s1, s2, L1, L2, sc, Fc, t1, t2, tc, tauAllow, sK, ta, tm, Ssu, Sse, nf, mAct, fe, checks };
}
export type CompressionResult = ReturnType<typeof compression>;

export type TorsionIn = { d: number; D: number; Nb: number; l: number; F: number; wire: SpringWire };

export function torsion(p: TorsionIn) {
  const { d, D, Nb, l, F, wire: w } = p;
  const C = D / d, Ki = kInner(C);
  const M = F * l; // N·mm
  const Ne = Nb + (2 * l) / (3 * Math.PI * D); // two straight legs of length l
  const kTurn = (d ** 4 * w.E) / (10.8 * D * Ne); // N·mm per turn (incl. coil friction)
  const kRad = kTurn / (2 * Math.PI);
  const turns = M / kTurn, angle = turns * 360;
  const sigma = (Ki * 32 * M) / (Math.PI * d ** 3);
  const Rm = tensile(w, d), allow = w.bend * Rm;
  const Dafter = (D * Nb) / (Nb + turns); // mean diameter after wind-up
  const arbor = 0.9 * (Dafter - d); // largest arbor that still leaves ≈ 10 % clearance
  const checks = [
    { ok: C >= 4 && C <= 16, label: `Spring index C = D/d within ${4}…${16}`, detail: `C = ${fx(C, 1)}` },
    { ok: d >= w.dMin && d <= w.dMax, label: 'Wire diameter within the range made in this material', detail: `${w.dMin}…${w.dMax} mm` },
    { ok: sigma <= allow, label: `Bending stress σ ≤ ${Math.round(w.bend * 100)} % of R_m (Shigley Table 10-6)`, detail: `σ = ${fx(sigma, 0)} ≤ ${fx(allow, 0)} MPa` },
    { ok: angle <= 360, label: 'Wind-up angle ≤ 360° (one turn)', detail: `θ = ${fx(angle, 0)}°` },
  ];
  return { C, Ki, M, Ne, kTurn, kRad, turns, angle, sigma, Rm, allow, Dafter, arbor, checks };
}
export type TorsionResult = ReturnType<typeof torsion>;

export const SPRING_INTRO =
  'A helical spring stores energy by twisting its wire: in a compression spring the coils are pushed together and the wire is twisted (shear), in a torsion spring the legs are turned and the wire is bent. The rate depends strongly on the sizes — k grows with d⁴ and falls with D³ — so a small change of wire makes a big change of stiffness. Limits: the wire must not yield (the spring would “set” shorter), the coils must not touch, a slender spring must not buckle, and a spring that works millions of times must survive fatigue.';

export const SPRING_ASSUMPTIONS =
  'Cylindrical helical springs of round, cold-drawn wire; linear rate. Compression: k = G·d⁴/(8D³n); total coils and solid length by end type (Shigley Table 10-1); static stress uncorrected τ = 8FD/(πd³) against 0.5·R_m (EN 13906-1), fatigue with the Bergsträsser factor and Zimmerli data for unpeened wire on a Gerber line through S_su = 0.67·R_m (Shigley §10-9); minimum coil gaps S_a and buckling by EN 13906-1; surge frequency for ends held between flat plates. Torsion spring: rate d⁴E/(10.8·D·N_e) per turn including both legs (Shigley eq. 10-51), stress with the inner-fibre factor K_i, allowable static bending stress as a share of R_m (Shigley Table 10-6). Tensile strength R_m = A/d^m (Shigley Table 10-4): typical, check the wire supplier’s certificate. Hot-coiled, shot-peened, preset and conical springs are not covered.';
