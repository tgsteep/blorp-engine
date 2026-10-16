/**
 * Bearing capacity of shallow footings.
 * Classic: general bearing capacity equation (Meyerhof form) with Vesić factors, De Beer shape, Hansen depth and
 * Meyerhof inclination factors, effective width B' = B − 2e (as in Das, Principles of Foundation Engineering), global FS.
 * Eurocode 7: EN 1997-1 Annex D (drained and undrained) with the recommended partial factors of Annex A for
 * design approaches DA1 (combinations 1 and 2), DA2 and DA3.
 */
export type Shape = 'strip' | 'square' | 'rect' | 'circle';
const fx = (v: number, n: number) => (Number.isFinite(v) ? v.toFixed(n) : '—'); // a missing result reads as a dash
export type Drainage = 'drained' | 'undrained';
export type Approach = 'DA1' | 'DA2' | 'DA3';
export const GW = 9.81; // unit weight of water [kN/m³]

export type BearingIn = {
  shape: Shape; B: number; L: number; Df: number; // m (strip: per metre run)
  drainage: Drainage; c: number; phi: number /* deg */; cu: number; // kPa
  gamma: number; gammaSat: number; Dw: number; // kN/m³, water depth below ground [m]
  G: number; Q: number; H: number; e: number; // kN (strip: kN/m), eccentricity along B [m]
  FS: number; approach: Approach;
};

const rad = (d: number) => (d * Math.PI) / 180;

/** Vesić factors (Das Table 3.3) and the EN 1997-1 Annex D Nγ = 2(Nq − 1) tan φ. */
export function factors(phiDeg: number) {
  if (phiDeg < 1e-6) return { Nc: Math.PI + 2, Nq: 1, Ng: 0, NgEC: 0 };
  const t = Math.tan(rad(phiDeg));
  const Nq = Math.exp(Math.PI * t) * Math.tan(rad(45 + phiDeg / 2)) ** 2;
  return { Nc: (Nq - 1) / t, Nq, Ng: 2 * (Nq + 1) * t, NgEC: 2 * (Nq - 1) * t };
}

/** Effective overburden at the footing base and the effective unit weight for the Nγ term (water table, Das § 3.6). */
export function waterEffects(p: Pick<BearingIn, 'gamma' | 'gammaSat' | 'Dw' | 'Df' | 'B'>) {
  const gw = p.gammaSat - GW;
  const q = p.Dw >= p.Df ? p.gamma * p.Df : p.gamma * p.Dw + gw * (p.Df - p.Dw);
  const d = p.Dw - p.Df; // water below the base
  const gEff = d <= 0 ? gw : d >= p.B ? p.gamma : gw + (d / p.B) * (p.gamma - gw);
  return { q, gEff, gw };
}

/** Effective dimensions B' = B − 2e (L' = L; strip per metre; circle as an equal-area square for B'/L' = 1). */
export function effective(p: BearingIn) {
  const Beff = Math.max(p.B - 2 * Math.abs(p.e), 1e-6);
  const L = p.shape === 'strip' ? 1 : p.shape === 'square' || p.shape === 'circle' ? p.B : Math.max(p.L, p.B);
  const ratio = p.shape === 'strip' ? 0 : Math.min(Beff / L, 1);
  const A = p.shape === 'circle' ? (Math.PI * p.B * p.B) / 4 * (Beff / p.B) : Beff * L; // circle: area reduced with B'/B
  return { Beff, Leff: L, ratio, A };
}

export function classic(p: BearingIn) {
  const und = p.drainage === 'undrained', phi = und ? 0 : p.phi, c = und ? p.cu : p.c;
  const f = factors(phi), { q, gEff } = waterEffects(p), ef = effective(p), t = Math.tan(rad(phi));
  const V = p.G + p.Q, br = ef.ratio;
  // shape (De Beer)
  const Fcs = 1 + br * (f.Nq / f.Nc), Fqs = 1 + br * t, Fgs = 1 - 0.4 * br;
  // depth (Hansen), Df/B > 1 → arctan
  const k = p.Df / p.B <= 1 ? p.Df / p.B : Math.atan(p.Df / p.B);
  const Fqd = 1 + 2 * t * (1 - Math.sin(rad(phi))) ** 2 * k;
  const Fcd = phi > 0 ? Fqd - (1 - Fqd) / (f.Nc * t) : 1 + 0.4 * k, Fgd = 1;
  // inclination (Meyerhof)
  const beta = V > 0 ? (Math.atan(Math.abs(p.H) / V) * 180) / Math.PI : 0;
  const Fci = (1 - beta / 90) ** 2, Fqi = Fci, Fgi = phi > 0 ? Math.max(0, 1 - beta / phi) ** 2 : 1;
  const tc = c * f.Nc * Fcs * Fcd * Fci, tq = q * f.Nq * Fqs * Fqd * Fqi, tg = 0.5 * gEff * ef.Beff * f.Ng * Fgs * Fgd * Fgi;
  const qu = tc + tq + tg, Qu = qu * ef.A, FS = V > 0 ? Qu / V : Infinity;
  // sliding: base friction tan(2φ/3) drained, adhesion = cu undrained
  const Hres = und ? ef.A * p.cu : V * Math.tan(rad((2 * phi) / 3)) + ef.A * c * (2 / 3);
  const FSslide = Math.abs(p.H) > 0 ? Hres / Math.abs(p.H) : Infinity;
  const qmax = V / (p.B * ef.Leff) * (1 + (6 * Math.abs(p.e)) / p.B), qmin = V / (p.B * ef.Leff) * (1 - (6 * Math.abs(p.e)) / p.B);
  return { f, q, gEff, ef, V, Fcs, Fqs, Fgs, Fcd, Fqd, Fgd, Fci, Fqi, Fgi, beta, tc, tq, tg, qu, Qu, FS, qall: qu / p.FS, Hres, FSslide, qmax, qmin, qApplied: V / ef.A };
}

/** EN 1997-1 Annex A recommended partial factors. */
export const PARTIAL = {
  A1: { G: 1.35, Q: 1.5 }, A2: { G: 1.0, Q: 1.3 },
  M1: { phi: 1.0, c: 1.0, cu: 1.0 }, M2: { phi: 1.25, c: 1.25, cu: 1.4 },
  R1: { v: 1.0, h: 1.0 }, R2: { v: 1.4, h: 1.1 }, R3: { v: 1.0, h: 1.0 },
} as const;
export const COMBOS: Record<Approach, { name: string; A: 'A1' | 'A2'; M: 'M1' | 'M2'; R: 'R1' | 'R2' | 'R3' }[]> = {
  DA1: [{ name: 'DA1-1', A: 'A1', M: 'M1', R: 'R1' }, { name: 'DA1-2', A: 'A2', M: 'M2', R: 'R1' }],
  DA2: [{ name: 'DA2', A: 'A1', M: 'M1', R: 'R2' }],
  DA3: [{ name: 'DA3', A: 'A1', M: 'M2', R: 'R3' }],
};

/** Annex D resistance with design parameters; V_d, H_d from the partial factors (H taken as permanent). */
export function ec7(p: BearingIn, combo: { name: string; A: 'A1' | 'A2'; M: 'M1' | 'M2'; R: 'R1' | 'R2' | 'R3' }) {
  const a = PARTIAL[combo.A], m = PARTIAL[combo.M], r = PARTIAL[combo.R];
  const Vd = a.G * p.G + a.Q * p.Q, Hd = a.G * Math.abs(p.H);
  const ef = effective(p), { q } = waterEffects(p), { gEff } = waterEffects(p);
  const br = ef.ratio, sq0 = p.shape === 'square' || p.shape === 'circle';
  let Rk: number, parts: { c: number; q: number; g: number }, phid = 0, cd = 0, cud = 0;
  if (p.drainage === 'undrained') {
    cud = p.cu / m.cu;
    const sc = 1 + 0.2 * (sq0 ? 1 : br), ic = 0.5 * (1 + Math.sqrt(Math.max(0, 1 - Hd / (ef.A * cud))));
    parts = { c: (Math.PI + 2) * cud * sc * ic, q, g: 0 };
  } else {
    phid = (Math.atan(Math.tan(rad(p.phi)) / m.phi) * 180) / Math.PI; cd = p.c / m.c;
    const f = factors(phid), s = Math.sin(rad(phid)), t = Math.tan(rad(phid));
    const sq = sq0 ? 1 + s : 1 + br * s, sg = sq0 ? 0.7 : 1 - 0.3 * br, sc = f.Nq - 1 > 1e-9 ? (sq * f.Nq - 1) / (f.Nq - 1) : 1 + (sq0 ? 1 : br) / (Math.PI + 2); // φ → 0: the limit of the same expression
    const mB = (2 + (sq0 ? 1 : br)) / (1 + (sq0 ? 1 : br));
    const base = 1 - Hd / (Vd + (t > 0 ? (ef.A * cd) / t : 0));
    const iq = Math.max(0, base) ** mB, ig = Math.max(0, base) ** (mB + 1), ic = t > 0 ? iq - (1 - iq) / (f.Nc * t) : iq;
    parts = { c: cd * f.Nc * sc * ic, q: q * f.Nq * sq * iq, g: 0.5 * gEff * ef.Beff * f.NgEC * sg * ig };
  }
  Rk = (parts.c + parts.q + parts.g) * ef.A;
  const Rd = Rk / r.v;
  return { combo, Vd, Hd, phid, cd, cud, parts, Rk, Rd, util: Vd / Rd };
}

export function bearing(p: BearingIn) {
  const cl = classic(p);
  const ec = COMBOS[p.approach].map((c) => ec7(p, c));
  const worst = ec.reduce((a, b) => (b.util > a.util ? b : a), ec[0]);
  const checks = [
    { ok: cl.FS >= p.FS, label: 'Bearing capacity: FS = Q_u/V ≥ required', detail: `FS ${fx(cl.FS, 2)}, required ${fx(p.FS, 1)}` },
    { ok: worst.util <= 1, label: 'Eurocode 7 bearing resistance (V_d ≤ R_d)', detail: `${worst.combo.name}: V_d/R_d = ${fx(worst.util, 2)}` },
    { ok: Math.abs(p.e) <= p.B / 6, label: 'Load inside the middle third (no uplift at the base, e ≤ B/6)', detail: `e ${fx(Math.abs(p.e), 3)} m, B/6 ${fx((p.B / 6), 3)} m` },
    { ok: cl.FSslide >= 1.5, label: 'Sliding: FS ≥ 1.5', detail: Number.isFinite(cl.FSslide) ? `FS ${fx(cl.FSslide, 2)}` : 'no horizontal load' },
  ];
  return { cl, ec, worst, checks };
}

/**
 * Prandtl–Vesić failure mechanism of a strip under the effective width (right half; mirror for the left):
 * active wedge under the base (base angle 45° + φ/2), log-spiral fan r = r₀ e^(θ tan φ) over 90°, passive Rankine
 * wedge rising at 45° − φ/2 to the base level. Coordinates in m from the centre of the base, y up.
 */
export function mechanism(Beff: number, phiDeg: number) {
  const b = Beff / 2, al = rad(45 + phiDeg / 2), be = rad(45 - phiDeg / 2), t = Math.tan(rad(phiDeg));
  const apex: [number, number] = [0, -b * Math.tan(al)];
  const r0 = b / Math.cos(al), th0 = -(Math.PI - al), th1 = -be;
  const spiral: [number, number][] = [];
  for (let i = 0; i <= 30; i++) { const th = th0 + (i / 30) * (th1 - th0), r = r0 * Math.exp((th - th0) * t); spiral.push([b + r * Math.cos(th), r * Math.sin(th)]); }
  const D = spiral[spiral.length - 1];
  const G: [number, number] = [D[0] + -D[1] / Math.tan(be), 0];
  return { b, apex, spiral, D, G, depth: -Math.min(...spiral.map((s) => s[1])), reach: G[0] };
}

export const BEARING_INTRO =
  'A footing spreads a column load over soil. Load it too much and a wedge of soil under it pushes the ground sideways and up: a shear failure. The capacity grows with the soil strength (cohesion c, friction angle φ), with the depth of the footing (the soil above holds the wedge down) and, in sand, with the footing width.';
export const BEARING_NOTES = [
  'Classic method: q_u = c N_c F_cs F_cd F_ci + q N_q F_qs F_qd F_qi + ½ γ′ B′ N_γ F_γs F_γd F_γi with Vesić factors N_q = e^(π tan φ) tan²(45° + φ/2), N_c = (N_q − 1) cot φ, N_γ = 2(N_q + 1) tan φ, De Beer shape, Hansen depth and Meyerhof inclination factors, effective width B′ = B − 2e (Meyerhof), water table by the effective unit weight (Das, Principles of Foundation Engineering, ch. 3). Undrained clay: φ = 0, N_c = π + 2 (Prandtl). Global FS on the gross ultimate load; 3 is usual.',
  'Eurocode 7: EN 1997-1 Annex D with N_γ = 2(N_q − 1) tan φ, shape and inclination factors of Annex D, no depth factors, horizontal base and ground; recommended partial factors of Annex A (A1/A2, M1/M2, R1/R2/R3); the horizontal load is taken as permanent. National annexes may change the factors.',
  'Not included: settlement (see the settlement page), punching or local shear in loose sand and soft clay (reduce c and tan φ by ⅔ as Terzaghi suggested), layered soil, sloping ground, two-way eccentricity. Validation: bearing capacity factors reproduce Das Table 3.3 (Vesić) and the Eurocode 7 values; undrained strip capacity equals Prandtl’s (π + 2) c_u + q.',
];
