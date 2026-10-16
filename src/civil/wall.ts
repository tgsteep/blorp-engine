/**
 * Retaining walls (cantilever and gravity): Rankine or Coulomb active earth pressure on a vertical plane through the
 * heel (cantilever: the "virtual back"; gravity wall: the vertical back face), surcharge, water behind the wall,
 * stability against overturning, sliding and bearing (classic FS, Das ch. 13), and an Eurocode 7 check
 * (EQU overturning, GEO sliding and bearing with the Annex A partial factors).
 */
import { ec7 as ec7Bearing, classic as bearingClassic, PARTIAL, COMBOS, GW, type Approach, type BearingIn } from './bearing.ts';
const fx = (v: number, n: number) => (Number.isFinite(v) ? v.toFixed(n) : '—'); // a missing result reads as a dash

export type WallType = 'cantilever' | 'gravity';
export type Method = 'rankine' | 'coulomb';
export type WallIn = {
  type: WallType; method: Method;
  H: number; // total height from the underside of the base to the top of the stem [m]
  B: number; toe: number; tb: number; tTop: number; tBot: number; // base width, toe length, base thickness, stem/wall top and bottom widths [m]
  gammaC: number; // wall unit weight [kN/m³]
  gamma: number; phi: number; beta: number; q: number; hw: number; // backfill γ, φ [deg], slope β [deg], surcharge [kPa], water height above the base underside [m]
  phiF: number; cF: number; gammaF: number; D: number; passive: boolean; // foundation soil φ, c, γ, embedment of the base in front [m]
  approach: Approach;
};
const rad = (d: number) => (d * Math.PI) / 180;

/** Rankine active coefficient for a backfill sloping at β (pressure parallel to the slope). */
export function kaRankine(phi: number, beta: number) {
  const cb = Math.cos(rad(beta)), cp = Math.cos(rad(phi)), r = Math.sqrt(Math.max(cb * cb - cp * cp, 0));
  return (cb * (cb - r)) / (cb + r);
}
/** Coulomb active coefficient, vertical back, wall friction δ, backfill slope β. */
export function kaCoulomb(phi: number, delta: number, beta: number) {
  const f = rad(phi), d = rad(delta), b = rad(beta);
  const root = Math.sqrt(Math.max((Math.sin(f + d) * Math.sin(f - b)) / (Math.cos(d) * Math.cos(b)), 0));
  return Math.cos(f) ** 2 / (Math.cos(d) * (1 + root) ** 2);
}
export const kpRankine = (phi: number) => Math.tan(rad(45 + phi / 2)) ** 2;

type Piece = { name: string; W: number; x: number; y: number }; // weight [kN/m] and centroid (x from the toe, y from the base underside)

/** Wall body and soil pieces with their weights and lever arms about the toe. */
export function pieces(p: WallIn): { parts: Piece[]; heelX: number; Hv: number } {
  const parts: Piece[] = [];
  if (p.type === 'cantilever') {
    const hs = p.H - p.tb, x0 = p.toe; // stem from x0 (front face at the base) — front face vertical, back face battered
    parts.push({ name: 'stem (rectangle)', W: p.gammaC * p.tTop * hs, x: x0 + p.tTop / 2, y: p.tb + hs / 2 });
    if (p.tBot > p.tTop) parts.push({ name: 'stem (batter)', W: p.gammaC * 0.5 * (p.tBot - p.tTop) * hs, x: x0 + p.tTop + (p.tBot - p.tTop) / 3, y: p.tb + hs / 3 });
    parts.push({ name: 'base slab', W: p.gammaC * p.B * p.tb, x: p.B / 2, y: p.tb / 2 });
    const heel = p.B - p.toe - p.tBot, xh = p.toe + p.tBot;
    // soil above the heel (rectangle up to the stem top level, wedge of the batter, sloping triangle above)
    parts.push({ name: 'soil on the heel', W: p.gamma * heel * hs, x: xh + heel / 2, y: p.tb + hs / 2 });
    if (p.tBot > p.tTop) parts.push({ name: 'soil on the batter', W: p.gamma * 0.5 * (p.tBot - p.tTop) * hs, x: p.toe + p.tTop + (2 * (p.tBot - p.tTop)) / 3, y: p.tb + (2 * hs) / 3 });
    const rise = Math.tan(rad(p.beta)) * (p.B - p.toe - p.tTop);
    if (rise > 0) parts.push({ name: 'sloping backfill', W: p.gamma * 0.5 * (p.B - p.toe - p.tTop) * rise, x: p.toe + p.tTop + (2 * (p.B - p.toe - p.tTop)) / 3, y: p.H + rise / 3 });
    return { parts, heelX: p.B, Hv: p.H + rise };
  }
  // gravity: vertical back at x = B, battered front from the toe edge of the base to the top
  const hs = p.H - p.tb, xb = p.B; // back face
  parts.push({ name: 'wall (rectangle)', W: p.gammaC * p.tTop * hs, x: xb - p.tTop / 2, y: p.tb + hs / 2 });
  const batter = p.tBot - p.tTop;
  if (batter > 0) parts.push({ name: 'wall (front batter)', W: p.gammaC * 0.5 * batter * hs, x: xb - p.tTop - batter / 3, y: p.tb + hs / 3 });
  parts.push({ name: 'base', W: p.gammaC * p.B * p.tb, x: p.B / 2, y: p.tb / 2 });
  return { parts, heelX: p.B, Hv: p.H };
}

/** Active thrust on the vertical plane x = heel, with surcharge and water; horizontal/vertical parts and heights. */
export function thrust(p: WallIn, phi = p.phi, gF = { soil: 1, q: 1 }) {
  const { Hv } = pieces(p);
  const delta = p.method === 'coulomb' ? (p.type === 'gravity' ? (2 * phi) / 3 : p.beta) : p.beta; // virtual back: δ = β
  const Ka = p.method === 'rankine' ? kaRankine(phi, p.beta) : kaCoulomb(phi, delta, p.beta);
  const ang = rad(p.method === 'rankine' ? p.beta : delta), hw = Math.min(Math.max(p.hw, 0), Hv), dry = Hv - hw, gw = p.gamma + 2 - GW; // submerged backfill γ′ (γ_sat ≈ γ + 2)
  // soil: dry part triangle + below water (vertical effective stress continues with γ′)
  const s1 = 0.5 * Ka * p.gamma * dry * dry, y1 = hw + dry / 3;
  const s2 = Ka * p.gamma * dry * hw, y2 = hw / 2;
  const s3 = 0.5 * Ka * gw * hw * hw, y3 = hw / 3;
  const Ps = (s1 + s2 + s3) * gF.soil, ys = s1 + s2 + s3 > 0 ? (s1 * y1 + s2 * y2 + s3 * y3) / (s1 + s2 + s3) : 0;
  const Pq = Ka * p.q * Hv * gF.q, yq = Hv / 2;
  const Pw = 0.5 * GW * hw * hw * gF.soil, yw = hw / 3; // water acts horizontally
  const Pah = (Ps + Pq) * Math.cos(ang) + Pw, Pav = (Ps + Pq) * Math.sin(ang);
  const Mo = (Ps * ys + Pq * yq) * Math.cos(ang) + Pw * yw;
  return { Ka, delta, ang, Hv, Ps, ys, Pq, yq, Pw, yw, Pah, Pav, Mo, hw };
}

export function wall(p: WallIn) {
  const { parts, heelX, Hv } = pieces(p), t = thrust(p);
  const Wsum = parts.reduce((a, q) => a + q.W, 0), Mw = parts.reduce((a, q) => a + q.W * q.x, 0);
  // surcharge on the heel counts as stabilising load only for the cantilever (soil above the heel)
  const qHeel = p.type === 'cantilever' ? p.q * (p.B - p.toe - p.tTop) : 0, xq = p.toe + p.tTop + (p.B - p.toe - p.tTop) / 2;
  const V = Wsum + t.Pav + qHeel, MR = Mw + t.Pav * heelX + qHeel * xq;
  const Kp = kpRankine(p.phiF), Pp = p.passive ? 0.5 * Kp * p.gammaF * p.D * p.D + 2 * p.cF * Math.sqrt(Kp) * p.D : 0;
  const FSo = MR / t.Mo;
  const dB = (2 * p.phiF) / 3;
  const FSs = (V * Math.tan(rad(dB)) + p.B * (2 / 3) * p.cF + Pp) / t.Pah;
  const xR = (MR - t.Mo) / V, e = p.B / 2 - xR;
  // contact pressure: trapezoid inside the middle third, otherwise a triangle (no tension under the base)
  const mid = Math.abs(e) <= p.B / 6;
  const qmax = mid ? (V / p.B) * (1 + (6 * Math.abs(e)) / p.B) : (2 * V) / (3 * Math.max(p.B / 2 - Math.abs(e), 1e-6)), qmin = mid ? (V / p.B) * (1 - (6 * Math.abs(e)) / p.B) : 0;
  const bin: BearingIn = { shape: 'strip', B: p.B, L: 1, Df: p.D, drainage: 'drained', c: p.cF, phi: p.phiF, cu: 50, gamma: p.gammaF, gammaSat: p.gammaF + 2, Dw: 50, G: V, Q: 0, H: t.Pah, e: Math.min(Math.abs(e), p.B / 2 - 0.01), FS: 3, approach: p.approach };
  const br = bearingClassic(bin), FSb = br.qu / Math.max(qmax, 1e-9);
  // Eurocode 7: EQU overturning (γ_G,dst 1.1, γ_G,stb 0.9, γ_Q 1.5, γ_φ 1.25) and GEO sliding + bearing per combination
  const tE = thrust(p, (Math.atan(Math.tan(rad(p.phi)) / 1.25) * 180) / Math.PI, { soil: 1.1, q: 1.5 });
  const equ = { Mdst: tE.Mo, Mstb: 0.9 * Mw + tE.Pav * heelX };
  const geo = COMBOS[p.approach].map((c) => {
    const a = PARTIAL[c.A], m = PARTIAL[c.M], r = PARTIAL[c.R];
    const phiD = (Math.atan(Math.tan(rad(p.phi)) / m.phi) * 180) / Math.PI, phiFD = (Math.atan(Math.tan(rad(p.phiF)) / m.phi) * 180) / Math.PI;
    const td = thrust(p, phiD, { soil: a.G, q: a.Q });
    const Vd = Wsum + td.Pav + qHeel * 0; // favourable weights × 1.0, surcharge on the heel ignored (favourable variable)
    // EN 1997-1 6.5.3(10): cast-in-place base δ_d = φ′_d (taken as φ′_cv), effective cohesion neglected
    const Rh = (Vd * Math.tan(rad(phiFD))) / r.h + (p.passive ? Pp / r.h : 0);
    const MRd = Mw + td.Pav * heelX, ed = p.B / 2 - (MRd - td.Mo) / Vd;
    // ec7() multiplies the loads by γ_G: pass them divided so that its V_d and H_d equal the values computed here
    const bd = ec7Bearing({ ...bin, G: Vd / a.G, Q: 0, H: td.Pah / a.G, e: Math.min(Math.abs(ed), p.B / 2 - 0.01) }, c);
    const Rd = bd.Rd, util = bd.util;
    return { combo: c, Hd: td.Pah, Rh, slideUtil: td.Pah / Rh, Vd, ed, Rd, bearUtil: util };
  });
  const worst = geo.reduce((a, b) => (Math.max(b.slideUtil, b.bearUtil) > Math.max(a.slideUtil, a.bearUtil) ? b : a), geo[0]);
  const checks = [
    { ok: FSo >= 2, label: 'Overturning: FS = M_R/M_O ≥ 2', detail: `FS ${fx(FSo, 2)}` },
    { ok: FSs >= 1.5, label: 'Sliding: FS ≥ 1.5', detail: `FS ${fx(FSs, 2)}${p.passive ? ' (passive pressure in front counted)' : ''}` },
    { ok: FSb >= 3, label: 'Bearing: FS = q_u/q_max ≥ 3', detail: `q_max ${fx(qmax, 0)} kPa, q_u ${fx(br.qu, 0)} kPa` },
    { ok: Math.abs(e) <= p.B / 6, label: 'Resultant inside the middle third (e ≤ B/6)', detail: `e ${fx(e, 3)} m, B/6 ${fx((p.B / 6), 3)} m` },
    { ok: equ.Mdst <= equ.Mstb && worst.slideUtil <= 1 && worst.bearUtil <= 1, label: 'Eurocode 7: EQU overturning, GEO sliding and bearing', detail: `${worst.combo.name}: sliding ${fx(worst.slideUtil, 2)}, bearing ${fx(worst.bearUtil, 2)}; EQU ${fx((equ.Mdst / equ.Mstb), 2)}` },
  ];
  return { parts, Hv, t, Wsum, Mw, qHeel, V, MR, Kp, Pp, FSo, FSs, xR, e, qmax, qmin, br, FSb, equ, geo, worst, checks };
}

export const WALL_INTRO: Record<WallType, string> = {
  cantilever: 'A cantilever wall is an L or T of reinforced concrete: the soil resting on the heel holds it down while the earth behind pushes it outward. It must not tip over, slide or press the ground under the toe too hard.',
  gravity: 'A gravity wall stands by its own weight (mass concrete, masonry, gabions): heavy and wide enough that the earth pressure behind can neither tip nor slide it.',
};
export const WALL_NOTES = [
  'Active earth pressure on a vertical plane through the heel (cantilever: virtual back, wall friction δ = β; gravity wall: vertical back with δ = ⅔φ for Coulomb). Rankine: K_a = cos β (cos β − √(cos²β − cos²φ))/(cos β + √(cos²β − cos²φ)); Coulomb for a vertical back: K_a = cos²φ/(cos δ [1 + √(sin(φ + δ) sin(φ − β)/(cos δ cos β))]²). Surcharge K_a q H, water below the given level hydrostatic with submerged backfill γ′ ≈ γ + 2 − γ_w kN/m³. Cohesionless backfill.',
  'Classic stability (Das, Principles of Foundation Engineering, ch. 13): overturning about the toe FS ≥ 2, sliding with base friction tan(⅔φ) and adhesion ⅔c FS ≥ 1.5 (passive resistance in front only if chosen), bearing q_u/q_max ≥ 3 with the strip footing equation and the eccentric, inclined resultant. Eurocode 7: EQU with γ_G,dst 1.1, γ_G,stb 0.9, γ_Q 1.5, γ_φ 1.25; GEO sliding with a cast-in-place base (δ_d = φ′_d, c′ neglected, EN 1997-1 6.5.3) and bearing (Annex D) with the chosen design approach. Wall weights are favourable (× 1.0).',
  'Not included: compaction pressure, seismic thrust (Mononobe–Okabe), drainage design, structural design of the stem and base. Validation: K_a reproduces the Rankine and Coulomb tables (Das: φ = 30°, β = 10° → 0.3495; Coulomb φ = 30°, δ = 20° → 0.2973); a full wall is checked by hand in the tests.',
];
