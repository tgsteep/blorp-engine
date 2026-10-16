/**
 * Reinforced concrete sections after EN 1992-1-1 (Eurocode 2), rectangular, f_ck ≤ 50 MPa, B500 steel:
 * beam — bending with the rectangular stress block (λ = 0.8, η = 1, x/d ≤ 0.45), compression steel above K′, shear by the
 * variable strut inclination method (6.2.2, 6.2.3), minimum/maximum steel, bar spacing, span/depth ratio (7.4.2);
 * column — N–M interaction by strain compatibility (ε_cu = 3.5 ‰, pivot of 2 ‰ at 3h/7 when fully compressed),
 * slenderness limit (5.8.3.1) and the nominal-curvature second-order moment (5.8.8). Units: mm, N, MPa; inputs kN, kN·m, m.
 */
export type Check = { ok: boolean; label: string; detail: string };
export const ES = 200000, FYK = 500, GC = 1.5, GS = 1.15, FYD = FYK / GS;
export const BARS = [8, 10, 12, 14, 16, 20, 25, 32];
export const CLASSES = [20, 25, 30, 35, 40, 45, 50];
export const fctm = (fck: number) => 0.3 * Math.pow(fck, 2 / 3);
export const barA = (d: number) => (Math.PI * d * d) / 4;

/** K = M/(b d² f_ck) → x/d of the rectangular block (α_cc f_ck/1.5 over 0.8 x). */
export function xiOfK(K: number, acc: number) {
  const k1 = (0.8 * acc) / GC, disc = 1 - (1.6 * K) / k1;
  return disc < 0 ? NaN : (1 - Math.sqrt(disc)) / 0.8;
}
/** K′ at x/d = 0.45 (no redistribution, f_ck ≤ 50): 0.167 for α_cc = 0.85, 0.197 for 1.0. */
export const Kprime = (acc: number) => ((0.8 * acc) / GC) * 0.45 * (1 - 0.4 * 0.45);

/* ---------------- beam ---------------- */
export type Span = 'simple' | 'end' | 'interior' | 'cantilever';
export const SPAN_K: Record<Span, number> = { simple: 1.0, end: 1.3, interior: 1.5, cantilever: 0.4 };
export type BeamRCIn = {
  b: number; h: number; c: number;        // width, depth, nominal cover to the links [mm]
  fck: number; acc: number;               // concrete class, α_cc
  nb: number; db: number;                 // bottom bars: number, diameter
  nt: number; dt: number;                 // top bars (hangers or compression steel)
  dw: number; s: number;                  // link diameter, spacing (two legs) [mm]
  M: number; V: number;                   // design moment [kN·m], shear [kN]
  L: number; span: Span;                  // span [m] and support type (span/depth)
};

/** Basic span/depth ratio EN 1992-1-1 eq. 7.16 (with ρ the required tension ratio, ρ′ compression). */
export function spanDepth(K: number, fck: number, rho: number, rhoP: number) {
  const r0 = Math.sqrt(fck) * 1e-3, sf = Math.sqrt(fck);
  if (rho <= r0) return K * (11 + (1.5 * sf * r0) / rho + 3.2 * sf * Math.pow(r0 / rho - 1, 1.5));
  return K * (11 + (1.5 * sf * r0) / (rho - rhoP) + (sf / 12) * Math.sqrt(rhoP / r0));
}

export function rcBeam(p: BeamRCIn) {
  const M = p.M * 1e6, V = p.V * 1e3, fcd = (p.acc * p.fck) / GC;
  const d = p.h - p.c - p.dw - p.db / 2, d2 = p.c + p.dw + p.dt / 2;
  const As = p.nb * barA(p.db), As2p = p.nt * barA(p.dt), Ac = p.b * p.h;
  const K = M / (p.b * d * d * p.fck), Kp = Kprime(p.acc), doubly = K > Kp;
  let xi = doubly ? 0.45 : xiOfK(K, p.acc); if (!Number.isFinite(xi)) xi = 0.45;
  const z = Math.min(0.95 * d, d * (1 - 0.4 * xi));
  const As2req = doubly ? ((K - Kp) * p.fck * p.b * d * d) / (FYD * (d - d2)) : 0;
  const Asreq = doubly ? (Kp * p.fck * p.b * d * d) / (FYD * z) + As2req : M / (FYD * z);
  // resistance with the bars provided (top bars counted only when they are needed as compression steel)
  const As2use = doubly ? Math.min(As2p, As) : 0;
  const x = ((As - As2use) * FYD) / (0.8 * p.b * fcd), MRd = (As - As2use) * FYD * (d - 0.4 * x) + As2use * FYD * (d - d2);
  const xd = x / d;
  const Asmin = Math.max((0.26 * fctm(p.fck) * p.b * d) / FYK, 0.0013 * p.b * d), Asmax = 0.04 * Ac;
  const gap = (p.b - 2 * (p.c + p.dw) - p.nb * p.db) / Math.max(1, p.nb - 1), gapMin = Math.max(p.db, 20, 16 + 5);
  // shear
  const k = Math.min(1 + Math.sqrt(200 / d), 2), rl = Math.min(As / (p.b * d), 0.02), vmin = 0.035 * Math.pow(k, 1.5) * Math.sqrt(p.fck);
  const VRdc = Math.max(0.12 * k * Math.pow(100 * rl * p.fck, 1 / 3), vmin) * p.b * d;
  const zv = 0.9 * d, nu1 = 0.6 * (1 - p.fck / 250), Vmax = (cot: number) => (p.b * zv * nu1 * fcd) / (cot + 1 / cot);
  const X = (p.b * zv * nu1 * fcd) / Math.max(V, 1);
  const cot = X >= 2.9 ? 2.5 : X >= 2 ? Math.min(2.5, Math.max(1, (X + Math.sqrt(X * X - 4)) / 2)) : 1;
  const Asw = 2 * barA(p.dw), VRds = (Asw / p.s) * zv * FYD * cot, VRdmax = Vmax(cot);
  const AswReq = V / (zv * FYD * cot), rwMin = (0.08 * Math.sqrt(p.fck)) / FYK, AswMin = rwMin * p.b;
  const VRd = Math.min(Math.max(VRds, 0), VRdmax);
  // span / depth
  const rho = Math.max(Asreq, 1) / (p.b * d), rhoP = As2req / (p.b * d);
  const ldBasic = spanDepth(SPAN_K[p.span], p.fck, rho, rhoP), ldF = Math.min(1.5, (500 / FYK) * (As / Math.max(Asreq, 1))), ldLim = ldBasic * ldF, ld = (p.L * 1000) / d;
  // cracking moment (uncracked rectangle) — for the drawing of cracks
  const Mcr = (fctm(p.fck) * p.b * p.h * p.h) / 6;
  const checks: Check[] = [
    { ok: M <= MRd, label: 'Bending: M_Ed ≤ M_Rd with the bars provided', detail: `${p.M.toFixed(0)} kN·m ≤ ${(MRd / 1e6).toFixed(0)} kN·m (A_s ${As.toFixed(0)} mm² ≥ ${Asreq.toFixed(0)} mm² needed)` },
    { ok: !doubly || As2p >= As2req, label: doubly ? 'K > K′: compression steel provided at the top' : 'K ≤ K′: no compression steel needed', detail: `K = ${K.toFixed(3)}, K′ = ${Kp.toFixed(3)}${doubly ? `, A_s2 ${As2p.toFixed(0)} ≥ ${As2req.toFixed(0)} mm²` : ''}` },
    { ok: xd <= 0.45, label: 'Ductile section: x/d ≤ 0.45 (steel yields before the concrete crushes)', detail: `x/d = ${xd.toFixed(2)}` },
    { ok: As >= Asmin && As <= Asmax, label: 'Steel between A_s,min and 4 % of the section', detail: `${Asmin.toFixed(0)} ≤ ${As.toFixed(0)} ≤ ${Asmax.toFixed(0)} mm²` },
    { ok: gap >= gapMin, label: 'Bars fit side by side (clear gap ≥ bar size, 20 mm, aggregate + 5 mm)', detail: `gap ${gap.toFixed(0)} mm ≥ ${gapMin.toFixed(0)} mm` },
    { ok: V <= VRdmax, label: 'Concrete struts carry the shear: V_Ed ≤ V_Rd,max', detail: `${p.V.toFixed(0)} ≤ ${(VRdmax / 1000).toFixed(0)} kN (cot θ = ${cot.toFixed(2)})` },
    { ok: V <= VRdc || V <= VRds, label: 'Shear links strong enough: V_Ed ≤ V_Rd,s (or V_Rd,c without links)', detail: `${p.V.toFixed(0)} kN ≤ V_Rd,s ${(VRds / 1000).toFixed(0)} kN, V_Rd,c ${(VRdc / 1000).toFixed(0)} kN` },
    { ok: Asw / p.s >= AswMin && p.s <= 0.75 * d, label: 'Links at least the minimum and spaced ≤ 0.75 d', detail: `A_sw/s = ${(Asw / p.s).toFixed(2)} ≥ ${AswMin.toFixed(2)} mm²/mm, s = ${p.s} ≤ ${(0.75 * d).toFixed(0)} mm` },
    { ok: ld <= ldLim, label: 'Deflection: span/depth within the EC2 limit', detail: `L/d = ${ld.toFixed(1)} ≤ ${ldLim.toFixed(1)}` },
  ];
  return { d, d2, fcd, As, As2p, Ac, K, Kp, doubly, xi, z, As2req, Asreq, x, xd, MRd, Asmin, Asmax, gap, gapMin, k, rl, vmin, VRdc, zv, nu1, cot, Asw, VRds, VRdmax, VRd, AswReq, AswMin, ldBasic, ldF, ldLim, ld, Mcr, util: Math.max(M / MRd, V / Math.max(VRdc, VRd)), checks };
}
export type BeamRCResult = ReturnType<typeof rcBeam>;

/** M_Rd of the section for a given tension steel area [N·mm] (singly reinforced). */
export const mrdOf = (As: number, b: number, d: number, fcd: number) => { const x = (As * FYD) / (0.8 * b * fcd); return As * FYD * (d - 0.4 * x); };

/* ---------------- column ---------------- */
export type ColRCIn = {
  b: number; h: number; c: number;        // section (h in the bending direction), cover to links [mm]
  fck: number; acc: number;
  n: number; db: number; dw: number;      // bars on each of the two faces, bar and link diameter
  N: number; M: number; l0: number;       // design axial force [kN], first-order moment [kN·m], effective length [m]
};

/** Section forces (N compression positive, M about the centroid) for neutral axis depth x from the compressed face. */
export function nmAt(x: number, s: { b: number; h: number; d2: number; As1: number; fcd: number }) {
  const { b, h, d2, As1, fcd } = s, ecu = 0.0035, ec2 = 0.002;
  const eps = (y: number) => (x <= h ? (ecu * (x - y)) / x : (ec2 * (x - y)) / (x - (3 * h) / 7));
  const sig = (e: number) => Math.max(-FYD, Math.min(FYD, ES * e));
  const a = Math.min(0.8 * x, h), Fc = a * b * fcd;
  const s1 = sig(eps(d2)), s2 = sig(eps(h - d2));
  const N = Fc + As1 * s1 + As1 * s2;
  const M = Fc * (h / 2 - a / 2) + As1 * s1 * (h / 2 - d2) - As1 * s2 * (h / 2 - d2);
  return { N, M, s1, s2 };
}

/** Interaction curve points (N, M ≥ 0) from pure tension to pure compression. */
export function interaction(s: { b: number; h: number; d2: number; As1: number; fcd: number }) {
  const pts: { x: number; N: number; M: number }[] = [{ x: 0, N: -2 * s.As1 * FYD, M: 0 }];
  for (let i = 1; i <= 80; i++) { const x = s.h * Math.pow(10, -2 + (3.5 * i) / 80); const r = nmAt(x, s); pts.push({ x, N: r.N, M: r.M }); }
  const N0 = s.b * s.h * s.fcd + 2 * s.As1 * Math.min(FYD, ES * 0.002);
  pts.push({ x: 1e3 * s.h, N: N0, M: 0 });
  return pts;
}

/** M_Rd at a given N_Ed on the curve (largest M), NaN outside the N range. */
export function mrdAtN(pts: { N: number; M: number }[], N: number) {
  let best = NaN;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if ((N - a.N) * (N - b.N) <= 0 && a.N !== b.N) { const t = (N - a.N) / (b.N - a.N), m = a.M + t * (b.M - a.M); if (!(m <= best)) best = m; }
  }
  return best;
}

export function rcColumn(p: ColRCIn) {
  const fcd = (p.acc * p.fck) / GC, Ac = p.b * p.h, d2 = p.c + p.dw + p.db / 2, d = p.h - d2;
  const As1 = p.n * barA(p.db), Ast = 2 * As1, s = { b: p.b, h: p.h, d2, As1, fcd };
  const N = p.N * 1e3, M0 = p.M * 1e6, l0 = p.l0 * 1000;
  const i = p.h / Math.sqrt(12), lam = l0 / i, n = N / (Ac * fcd), lamLim = (20 * 0.7 * 1.1 * 0.7) / Math.sqrt(Math.max(n, 1e-6));
  const ei = l0 / 400, e0 = Math.max(p.h / 30, 20);
  const omega = (Ast * FYD) / (Ac * fcd), nu = 1 + omega, Kr = Math.min(1, Math.max(0, (nu - n) / (nu - 0.4)));
  const curv = (Kr * (FYD / ES)) / (0.45 * d), e2 = lam > lamLim ? (curv * l0 * l0) / 10 : 0;
  const M0Ed = M0 + N * ei, M2 = N * e2, MEd = Math.max(M0Ed + M2, N * e0);
  const pts = interaction(s), MRd0 = mrdAtN(pts, N), MRd = Number.isFinite(MRd0) ? MRd0 : 0, Nmax = pts[pts.length - 1].N;
  const ok = MRd > 0 && MEd <= MRd;
  const checks: Check[] = [
    { ok, label: 'Design point inside the N–M interaction diagram', detail: MRd > 0 ? `M_Ed = ${(MEd / 1e6).toFixed(0)} kN·m ≤ M_Rd = ${(MRd / 1e6).toFixed(0)} kN·m at N_Ed = ${p.N.toFixed(0)} kN` : `N_Ed = ${p.N.toFixed(0)} kN above N_Rd,max = ${(Nmax / 1000).toFixed(0)} kN` },
    { ok: Ast >= Math.max(0.002 * Ac, (0.1 * N) / FYD) && Ast <= 0.04 * Ac, label: 'Longitudinal steel between max(0.2 % A_c, 0.1 N/f_yd) and 4 % A_c', detail: `A_s = ${Ast.toFixed(0)} mm² (${((100 * Ast) / Ac).toFixed(2)} %)` },
    { ok: p.db >= 12, label: 'Main bars at least 12 mm', detail: `Ø ${p.db} mm` },
    { ok: lam <= 100, label: 'Slenderness λ ≤ 100 (second-order method meaningful)', detail: `λ = ${lam.toFixed(0)}, λ_lim = ${lamLim.toFixed(0)}${lam > lamLim ? ' → second-order moment added' : ' → second-order effects ignored'}` },
    { ok: (p.b - 2 * (p.c + p.dw) - p.n * p.db) / Math.max(1, p.n - 1) >= Math.max(p.db, 20), label: 'Bars fit along the face (clear gap ≥ bar size and 20 mm)', detail: `${p.n} × Ø${p.db} on a ${p.b} mm face` },
  ];
  return { fcd, Ac, d2, d, As1, Ast, i, lam, n, lamLim, ei, e0, omega, Kr, curv, e2, M0Ed, M2, MEd, pts, MRd, Nmax, util: MRd > 0 ? MEd / MRd : 9.99, checks };
}
export type ColRCResult = ReturnType<typeof rcColumn>;

export const RC_INTRO = 'Concrete is strong in compression and weak in tension, so steel bars go where the section is pulled. In a beam the bars at the bottom carry the tension of bending, while a block of concrete near the top carries the compression; links stop diagonal shear cracks. In a column the load mostly squeezes, and the bars help where bending pulls one face. The design aims for a section in which the steel yields first, so a failure gives warning by cracking and sagging.';

export const RC_NOTES = [
  'EN 1992-1-1 with γ_c = 1.5, γ_s = 1.15, B500 (f_yd = 435 MPa), rectangular stress block λ = 0.8, η = 1 (f_ck ≤ 50 MPa), f_cd = α_cc f_ck/γ_c with α_cc = 1.0 (EC2 recommended) or 0.85 (UK and other National Annexes, gives the textbook K′ = 0.167 and z = d[0.5 + √(0.25 − K/1.134)]). Beam bending: K = M/(b d² f_ck), x/d ≤ 0.45 without redistribution, compression steel above K′ (assumed to yield), z ≤ 0.95 d; M_Rd of the bars provided. Effective depth d = h − cover − link − bar/2, one layer of bars.',
  'Shear: V_Rd,c = [0.12 k (100 ρ_l f_ck)^⅓] b d ≥ v_min b d (6.2.2), links by the variable strut inclination method with cot θ between 1 and 2.5 chosen as large as V_Rd,max allows, z = 0.9 d, ν₁ = 0.6(1 − f_ck/250), minimum ρ_w = 0.08 √f_ck/f_yk, spacing ≤ 0.75 d (6.2.3, 9.2.2). Deflection by the span/depth ratio eq. 7.16 with K for the support type and the factor 310/σ_s ≈ A_s,prov/A_s,req (≤ 1.5); the 7/L reduction for long spans with brittle partitions is not applied. Minimum steel 0.26 f_ctm/f_yk b d ≥ 0.0013 b d (9.2.1.1).',
  'Column: interaction diagram by strain compatibility, ε_cu = 3.5 ‰ and, when the whole section is compressed, 2 ‰ at 3h/7 from the compressed face; bars on the two faces perpendicular to bending, elastic–plastic steel. Imperfection e_i = l₀/400, minimum eccentricity max(h/30, 20 mm), slenderness limit λ_lim = 20 A B C/√n with A = 0.7, B = 1.1, C = 0.7; above it the nominal-curvature moment M₂ = N (1/r) l₀²/10 with 1/r = K_r ε_yd/(0.45 d), K_φ = 1 (no creep). Biaxial bending, side bars and confinement are not included.',
];
