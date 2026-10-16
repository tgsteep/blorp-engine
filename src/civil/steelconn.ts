/**
 * Steel connections after EN 1993-1-8 (simplified, design values with γ_M0 = 1.0, γ_M2 = 1.25):
 * fin plate (beam web bolted to a plate welded to the column flange — a nominally pinned shear connection, checks in the
 * style of SCI P358) and column base plate under axial compression (effective area with the T-stub width c,
 * EN 1993-1-8 6.2.5, bearing strength f_jd) with shear by friction and anchor bolts. Units: mm, N, MPa.
 */
import { IPE } from './beam.ts';

export type Check = { ok: boolean; label: string; detail: string };
export const GM0 = 1.0, GM2 = 1.25;

/** HEB columns: h, b, t_w, t_f, r [mm], A [cm²]. */
export const HEB: { name: string; h: number; b: number; tw: number; tf: number; r: number; A: number }[] = [
  { name: 'HEB 100', h: 100, b: 100, tw: 6, tf: 10, r: 12, A: 26.0 },
  { name: 'HEB 120', h: 120, b: 120, tw: 6.5, tf: 11, r: 12, A: 34.0 },
  { name: 'HEB 140', h: 140, b: 140, tw: 7, tf: 12, r: 12, A: 43.0 },
  { name: 'HEB 160', h: 160, b: 160, tw: 8, tf: 13, r: 15, A: 54.3 },
  { name: 'HEB 180', h: 180, b: 180, tw: 8.5, tf: 14, r: 15, A: 65.3 },
  { name: 'HEB 200', h: 200, b: 200, tw: 9, tf: 15, r: 18, A: 78.1 },
  { name: 'HEB 220', h: 220, b: 220, tw: 9.5, tf: 16, r: 18, A: 91.0 },
  { name: 'HEB 240', h: 240, b: 240, tw: 10, tf: 17, r: 21, A: 106 },
  { name: 'HEB 260', h: 260, b: 260, tw: 10, tf: 17.5, r: 24, A: 118 },
  { name: 'HEB 280', h: 280, b: 280, tw: 10.5, tf: 18, r: 24, A: 131 },
  { name: 'HEB 300', h: 300, b: 300, tw: 11, tf: 19, r: 27, A: 149 },
  { name: 'HEB 320', h: 320, b: 300, tw: 11.5, tf: 20.5, r: 27, A: 161 },
  { name: 'HEB 340', h: 340, b: 300, tw: 12, tf: 21.5, r: 27, A: 171 },
  { name: 'HEB 360', h: 360, b: 300, tw: 12.5, tf: 22.5, r: 27, A: 181 },
  { name: 'HEB 400', h: 400, b: 300, tw: 13.5, tf: 24, r: 27, A: 198 },
];
export const heb = (name: string) => HEB.find((x) => x.name === name) ?? HEB[5];
export const ipe = (name: string) => IPE.find((x) => x.name === name) ?? IPE[10];

/** Structural steels EN 10025-2 (t ≤ 40 mm): f_y, f_u [MPa], correlation factor β_w for fillet welds. */
export const STEELS = { S235: { fy: 235, fu: 360, bw: 0.8 }, S275: { fy: 275, fu: 430, bw: 0.85 }, S355: { fy: 355, fu: 490, bw: 0.9 } } as const;
export type SteelGrade = keyof typeof STEELS;
/** Bolts: tensile stress area A_s [mm²] and normal hole d₀ [mm]; classes with f_ub [MPa] and α_v (shear through the thread). */
export const BOLTS: { name: string; d: number; As: number; d0: number }[] = [
  { name: 'M12', d: 12, As: 84.3, d0: 13 }, { name: 'M16', d: 16, As: 157, d0: 18 }, { name: 'M20', d: 20, As: 245, d0: 22 },
  { name: 'M22', d: 22, As: 303, d0: 24 }, { name: 'M24', d: 24, As: 353, d0: 26 }, { name: 'M27', d: 27, As: 459, d0: 30 }, { name: 'M30', d: 30, As: 561, d0: 33 },
];
export const CLASSES = { '4.6': { fub: 400, fyb: 240, av: 0.6 }, '8.8': { fub: 800, fyb: 640, av: 0.6 }, '10.9': { fub: 1000, fyb: 900, av: 0.5 } } as const;
export type BoltClass = keyof typeof CLASSES;
export const bolt = (name: string) => BOLTS.find((b) => b.name === name) ?? BOLTS[2];

/** Bolt shear resistance per shear plane, thread in the plane: F_v,Rd = α_v f_ub A_s/γ_M2 [N]. */
export const FvRd = (b: { As: number }, c: BoltClass) => (CLASSES[c].av * CLASSES[c].fub * b.As) / GM2;
/** Bearing resistance F_b,Rd = k₁ α_b f_u d t/γ_M2 with α_b = min(α_d, f_ub/f_u, 1), k₁ = min(2.8 e₂/d₀ − 1.7, 2.5) (EN 1993-1-8 Table 3.4). */
export function FbRd(d: number, d0: number, t: number, fu: number, fub: number, alphaD: number, e2: number) {
  const k1 = Math.max(0, Math.min(2.8 * e2 / d0 - 1.7, 2.5)), ab = Math.max(0, Math.min(alphaD, fub / fu, 1));
  return { k1, ab, F: (k1 * ab * fu * d * t) / GM2 };
}

/* ---------------- fin plate ---------------- */
export type FinIn = {
  V: number;               // design shear [kN]
  beam: string; column: string; steel: SteelGrade;
  bolt: string; cls: BoltClass; n: number;   // bolts in one vertical line
  p1: number; e1: number; e2: number;        // pitch, vertical end distance, horizontal edge distance on the plate [mm]
  z: number;               // bolt line from the column face (lever arm) [mm]
  tp: number; a: number;   // plate thickness, fillet weld throat [mm]
};
export const FIN_GAP = 10; // gap between beam end and column face [mm]

export function finPlate(p: FinIn) {
  const S = STEELS[p.steel], B = bolt(p.bolt), C = CLASSES[p.cls], bm = ipe(p.beam), col = heb(p.column);
  const V = p.V * 1000, n = Math.max(1, Math.round(p.n)), hp = 2 * p.e1 + (n - 1) * p.p1, bp = p.z + p.e2;
  // bolt group: vertical share + moment V z about the group centre
  const ys = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * p.p1), Iy = ys.reduce((s, y) => s + y * y, 0), ymax = Math.max(...ys.map(Math.abs));
  const Fv = V / n, Fh = Iy > 0 ? (V * p.z * ymax) / Iy : 0, Fb = Math.hypot(Fv, Fh), beta = Fb / V; // bolt force per kN of shear
  const fv = FvRd(B, p.cls);
  const aD = n > 1 ? Math.min(p.e1 / (3 * B.d0), p.p1 / (3 * B.d0) - 0.25) : p.e1 / (3 * B.d0);
  const bPlate = FbRd(B.d, B.d0, p.tp, S.fu, C.fub, aD, p.e2);
  const e2b = p.z - FIN_GAP;                                    // beam end to bolt line
  const bWeb = FbRd(B.d, B.d0, bm.tw, S.fu, C.fub, n > 1 ? p.p1 / (3 * B.d0) - 0.25 : 1, e2b);
  // plate
  const Vg = (hp * p.tp * S.fy) / (1.27 * Math.sqrt(3) * GM0);
  const Vn = (p.tp * (hp - n * B.d0) * S.fu) / (Math.sqrt(3) * GM2);
  const Ant = p.tp * (p.e2 - B.d0 / 2), Anv = p.tp * (hp - p.e1 - (n - 0.5) * B.d0);
  const Vbt = (0.5 * S.fu * Ant) / GM2 + (S.fy * Anv) / (Math.sqrt(3) * GM0);
  const bendNeeded = hp < 2.73 * p.z, Vbend = (((p.tp * hp * hp) / 6) * S.fy) / (p.z * GM0);
  // beam web in shear (plain web, no notch)
  const hw = bm.h - 2 * bm.tf, Vbeam = (hw * bm.tw * S.fy) / (Math.sqrt(3) * GM0);
  // welds: two fillets of length h_p carry V and V z
  const fvw = S.fu / (Math.sqrt(3) * S.bw * GM2), fw = Math.hypot(V / (2 * hp), (6 * V * p.z) / (2 * hp * hp)), FwRd = fvw * p.a, Vweld = (FwRd / fw) * V;
  const modes: { key: string; label: string; VRd: number }[] = [
    { key: 'bolt', label: 'bolt shear', VRd: fv / beta },
    { key: 'bplate', label: 'bearing on the plate', VRd: bPlate.F / beta },
    { key: 'bweb', label: 'bearing on the beam web', VRd: bWeb.F / beta },
    { key: 'gross', label: 'plate shear, gross', VRd: Vg },
    { key: 'net', label: 'plate shear, net', VRd: Vn },
    { key: 'block', label: 'plate block tearing', VRd: Vbt },
    { key: 'web', label: 'beam web shear', VRd: Vbeam },
    { key: 'weld', label: 'fillet welds', VRd: Vweld },
  ];
  if (bendNeeded) modes.splice(6, 0, { key: 'bend', label: 'plate bending', VRd: Vbend });
  const gov = modes.reduce((a, b) => (b.VRd < a.VRd ? b : a));
  const clear = bm.h - 2 * bm.tf - 2 * Math.max(bm.tf, 10);
  const checks: Check[] = [
    { ok: V <= gov.VRd, label: 'Shear resistance of the connection (weakest mode)', detail: `V_Ed = ${p.V.toFixed(0)} kN ≤ V_Rd = ${(gov.VRd / 1000).toFixed(0)} kN (${gov.label})` },
    { ok: p.tp <= 0.5 * B.d, label: 'Plate thin enough to rotate (t_p ≤ d/2: the plate yields before the bolts shear)', detail: `t_p = ${p.tp} mm ≤ ${(0.5 * B.d).toFixed(1)} mm` },
    { ok: p.e1 >= 1.2 * B.d0 && p.e2 >= 1.2 * B.d0 && e2b >= 1.2 * B.d0, label: 'End and edge distances at least 1.2 d₀ (plate and beam web)', detail: `e₁ ${p.e1}, e₂ ${p.e2}, beam ${e2b.toFixed(0)} mm ≥ ${(1.2 * B.d0).toFixed(1)} mm` },
    { ok: n === 1 || (p.p1 >= 2.2 * B.d0 && p.p1 <= Math.min(14 * p.tp, 200)), label: 'Bolt pitch between 2.2 d₀ and min(14 t, 200 mm)', detail: `p₁ = ${p.p1} mm, ${(2.2 * B.d0).toFixed(0)}…${Math.min(14 * p.tp, 200).toFixed(0)} mm` },
    { ok: hp >= 0.6 * bm.h && hp <= clear, label: 'Plate depth at least 0.6 h of the beam and fits between the flanges', detail: `h_p = ${hp.toFixed(0)} mm, ${(0.6 * bm.h).toFixed(0)}…${clear.toFixed(0)} mm` },
    { ok: p.a >= (p.steel === 'S355' ? 0.55 : 0.5) * p.tp, label: 'Welds stronger than the plate (a ≥ 0.5 t_p, S355: 0.55 t_p)', detail: `a = ${p.a} mm, needs ${((p.steel === 'S355' ? 0.55 : 0.5) * p.tp).toFixed(1)} mm` },
    { ok: p.tp <= col.tf + 5, label: 'Plate no thicker than the column flange + 5 mm (flange takes the welds)', detail: `t_p = ${p.tp} mm, t_f = ${col.tf} mm` },
  ];
  return { S, B, C, bm, col, n, hp, bp, ys, Fv, Fh, Fb: Fb * (1 / 1000), beta, fv, bPlate, bWeb, e2b, Vg, Vn, Vbt, Vbend, bendNeeded, Vbeam, fw, FwRd, modes, gov, util: V / gov.VRd, checks };
}
export type FinResult = ReturnType<typeof finPlate>;

/* ---------------- base plate ---------------- */
export type BaseIn = {
  N: number; V: number;     // axial compression, shear [kN]
  column: string; steel: SteelGrade;
  Lp: number; Bp: number; tp: number;   // plate length (along h), width (along b), thickness [mm]
  fck: number; alpha: number;           // concrete class (cylinder strength) [MPa], concentration factor α = √(A_c1/A_c0) ≤ 3
  anchor: string; nA: number;           // anchor bolts (class 4.6)
};

/** Effective bearing area [mm²] of an I-column footprint widened by c, cut to the plate (EN 1993-1-8 6.2.5). */
export function effArea(c: number, col: { h: number; b: number; tw: number; tf: number }, Lp: number, Bp: number) {
  const cut = (a: number, b: number, lim: number) => Math.max(0, Math.min(b, lim / 2) - Math.max(a, -lim / 2));
  const yB = cut(-col.b / 2 - c, col.b / 2 + c, Bp);
  const inner = col.h / 2 - col.tf - c;
  if (inner <= 0) return { A: cut(-col.h / 2 - c, col.h / 2 + c, Lp) * yB, merged: true };
  const fl = 2 * cut(col.h / 2 - col.tf - c, col.h / 2 + c, Lp) * yB, web = 2 * inner * cut(-col.tw / 2 - c, col.tw / 2 + c, Bp);
  return { A: fl + web, merged: false };
}

export function basePlate(p: BaseIn) {
  const S = STEELS[p.steel], col = heb(p.column), N = p.N * 1000, V = p.V * 1000;
  const fcd = p.fck / 1.5, fjd = (2 / 3) * Math.min(p.alpha, 3) * fcd;          // β_j = 2/3
  const cOf = (t: number) => t * Math.sqrt(S.fy / (3 * fjd * GM0));
  const c = cOf(p.tp), eff = effArea(c, col, p.Lp, p.Bp), NRd = eff.A * fjd;
  // thinnest plate that carries N (bisection on t)
  let lo = 1, hi = 150; const ok = (t: number) => effArea(cOf(t), col, p.Lp, p.Bp).A * fjd >= N;
  let treq: number | null = null; if (ok(hi)) { if (ok(lo)) treq = lo; else { for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (ok(m)) hi = m; else lo = m; } treq = hi; } }
  const NRdMax = p.Lp * p.Bp * fjd;                                               // whole plate bearing (very thick plate)
  const Npl = (col.A * 100 * S.fy) / GM0;
  const A = bolt(p.anchor), ab = 0.44 - 0.0003 * CLASSES['4.6'].fyb, Fvb = (ab * CLASSES['4.6'].fub * A.As) / GM2, Ff = 0.2 * N, VRd = Ff + p.nA * Fvb;
  const over = Math.min((p.Lp - col.h) / 2, (p.Bp - col.b) / 2);
  const checks: Check[] = [
    { ok: N <= NRd, label: 'Bearing under the plate: N_Ed ≤ A_eff f_jd', detail: `${p.N.toFixed(0)} kN ≤ ${(NRd / 1000).toFixed(0)} kN (needs t_p ≥ ${treq !== null ? treq.toFixed(1) : '—'} mm)` },
    { ok: N <= Npl, label: 'Column itself carries the load (squash load A f_y)', detail: `${p.N.toFixed(0)} kN ≤ ${(Npl / 1000).toFixed(0)} kN (buckling: see Columns)` },
    { ok: V <= VRd, label: 'Shear by friction 0.20 N plus the anchor bolts', detail: `${p.V.toFixed(0)} kN ≤ ${(Ff / 1000).toFixed(0)} + ${p.nA} × ${(Fvb / 1000).toFixed(1)} = ${(VRd / 1000).toFixed(0)} kN` },
    { ok: over >= 1.2 * A.d0 + A.d, label: 'Plate projects far enough for the anchor bolts', detail: `overhang ${over.toFixed(0)} mm ≥ ${(1.2 * A.d0 + A.d).toFixed(0)} mm` },
    { ok: p.tp >= col.tf, label: 'Plate at least as thick as the column flange (stiff enough to spread the load)', detail: `t_p = ${p.tp} mm, t_f = ${col.tf} mm` },
    { ok: p.alpha <= 3, label: 'Concentration factor α ≤ 3 (foundation large enough around the plate)', detail: `α = ${p.alpha.toFixed(2)}` },
  ];
  return { S, col, fcd, fjd, c, eff, NRd, treq, NRdMax, Npl, A, ab, Fvb, Ff, VRd, over, util: N / NRd, cOf, checks };
}
export type BaseResult = ReturnType<typeof basePlate>;

export const CONN_INTRO = 'Steel frames are only as strong as their joints. A fin plate — a short plate welded to the column with the beam web bolted to it — passes the beam’s shear into the column while letting the beam end rotate, so it acts as a pin. A base plate spreads the column load over the concrete, which is about ten times weaker than steel: only a strip around the column’s outline, as wide as the plate can bend, really carries the pressure.';

export const CONN_NOTES = [
  'EN 1993-1-8 with the recommended partial factors γ_M0 = 1.0 and γ_M2 = 1.25: bolt shear F_v,Rd = α_v f_ub A_s/γ_M2 (thread in the shear plane), bearing F_b,Rd = k₁ α_b f_u d t/γ_M2 (Table 3.4), block tearing 3.10.2 (eccentric), fillet welds by the simplified method f_vw,d = f_u/(√3 β_w γ_M2) (4.5.3.3). Steels EN 10025-2 for t ≤ 40 mm. National Annexes may change the factors.',
  'Fin plate in the style of SCI P358 (simple joints): the bolt group carries V and the moment V z about its centre (elastic distribution, the resultant compared with the bearing resistance in the load direction — conservative); plate gross shear with the 1.27 reduction for bending, net shear, block tearing, plate bending when h_p < 2.73 z; beam web shear without a notch; welds on both sides of the plate for V and V z. Ductility and detailing rules from SCI P358. Column-side checks (flange bending, web panel) are not included.',
  'Base plate under axial compression (EN 1993-1-8 6.2.5): f_jd = β_j α f_cd with β_j = 2/3, f_cd = f_ck/1.5 and the concentration factor α (√ of the foundation area over the plate area, at most 3); the plate spreads the load over a strip c = t √(f_y/(3 f_jd γ_M0)) around the column outline (flanges and web), cut to the plate. Shear by friction C_f,d = 0.20 (6.2.2(6)) plus class 4.6 anchor bolts with α_b = 0.44 − 0.0003 f_yb. Base moments, uplift, grout and anchorage length are not included.',
];
