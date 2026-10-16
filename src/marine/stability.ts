/**
 * Intact stability of a ship: parametric hull, upright hydrostatics, the righting-lever (GZ) curve from the exact
 * heeled underwater shape, free-surface correction and the IMO 2008 IS Code general criteria (Part A, 2.2).
 *
 * Hull (keel at z = 0, centreline y = 0, x from the midship section): half-breadth y = (B/2)·f(x)·h(z)
 *  - waterlines f(ξ), ξ = |2x/L|: 1 in the parallel middle body ξ ≤ p, then 1 − ((ξ − p)/(1 − p))^a to the ends;
 *  - sections h(z) = 1 − (1 − z/T)^c below the design waterline (c = C_M/(1 − C_M), box for C_M = 1), wall-sided above;
 *  - C_M = c/(c + 1), C_P = p + (1 − p)·a/(a + 1), C_B = C_P·C_M (p is set from the requested C_B).
 * The Wigley hull is p = 0, a = 2, c = 2 (C_B = 4/9); a box barge is C_M = C_B = 1.
 * Heeled: the ship heels about its own axis with no trim; for each angle the waterline height is found so the
 * displaced volume stays the same (free to heave, fixed trim). Watertight up to the deck, no superstructure buoyancy.
 */

export type HullKind = 'cargo' | 'tug' | 'yacht' | 'barge';
export type StabIn = {
  L: number; B: number; D: number; T: number; // length, breadth, depth to the deck, draft [m]
  CB: number; CM: number; a: number;          // block, midship section coefficient, end fullness exponent
  KG: number;                                 // centre of gravity above the keel [m]
  rho: number;                                // water density [t/m³]
  tankL: number; tankB: number; tankRho: number; // slack tank for the free-surface effect (0 = none) [m, m, t/m³]
  thetaF: number;                             // downflooding angle [°]
};

export const RHO_SEA = 1.025, RHO_FRESH = 1.0;
export const PRESETS: Record<HullKind, Omit<StabIn, 'rho' | 'tankL' | 'tankB' | 'tankRho' | 'thetaF'>> = {
  cargo: { L: 120, B: 20, D: 11, T: 7.5, CB: 0.75, CM: 0.98, a: 2, KG: 6.6 },
  tug: { L: 30, B: 10, D: 4.8, T: 3.6, CB: 0.52, CM: 0.82, a: 1.6, KG: 2.9 },
  yacht: { L: 15, B: 4.6, D: 2.4, T: 1.1, CB: 0.42, CM: 0.66, a: 1.6, KG: 1.5 },
  barge: { L: 60, B: 15, D: 5.5, T: 2.5, CB: 0.92, CM: 1, a: 4, KG: 3.5 },
};

/** Resolution: stations (odd, Simpson), points per side below the waterline, heel step [°]. `coarse` is for the slider pass-range scans. */
const RES = { fine: { nx: 41, nz: 16, step: 1 }, coarse: { nx: 21, nz: 16, step: 2 } };
const rad = (d: number) => (d * Math.PI) / 180;

/** Shape parameters: section exponent c, parallel middle body p, valid C_B range for the C_M and a. */
export function shape(p: Pick<StabIn, 'CB' | 'CM' | 'a'>) {
  const CM = Math.min(Math.max(p.CM, 0.5), 1), c = CM >= 0.9999 ? Infinity : CM / (1 - CM);
  const lo = (CM * p.a) / (p.a + 1), hi = CM;
  const CB = Math.min(Math.max(p.CB, lo), hi), CP = CB / CM;
  const par = Math.min(Math.max(CP * (p.a + 1) - p.a, 0), 1);
  return { c, CM, CB, CP, par, CBmin: lo, CBmax: hi };
}
const fLong = (xi: number, par: number, a: number) => (xi <= par ? 1 : par >= 1 ? 1 : Math.max(0, 1 - Math.pow((xi - par) / (1 - par), a)));
const hSec = (z: number, T: number, c: number) => (z >= T || !Number.isFinite(c) ? 1 : 1 - Math.pow(1 - z / T, c));

/** Midship section outline (convex, counter-clockwise), y to starboard, z up from the keel; scaled by k for other stations. */
export function sectionOutline(p: StabIn, k = 1, nz = RES.fine.nz): [number, number][] {
  const { c } = shape(p), b = (p.B / 2) * k, right: [number, number][] = [];
  for (let i = 0; i <= nz; i++) { const z = p.T * (1 - Math.cos((i / nz) * Math.PI / 2)); right.push([b * hSec(z, p.T, c), z]); }
  right.push([b, p.D]);
  const left = right.slice().reverse().map(([y, z]) => [-y, z] as [number, number]);
  const pts = [...right, ...left];
  // drop repeated points (keel point when the section comes to a point)
  return pts.filter((q, i) => { const n = pts[(i + 1) % pts.length]; return Math.hypot(q[0] - n[0], q[1] - n[1]) > 1e-9; });
}

/** Area and centroid of the part of a polygon below the line z·cosφ − y·sinφ = d (earth height ≤ d). */
function clipBelow(poly: [number, number][], cs: number, sn: number, d: number) {
  const out: [number, number][] = [];
  const hgt = (q: [number, number]) => q[1] * cs - q[0] * sn - d;
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i], Q = poly[(i + 1) % poly.length], hp = hgt(P), hq = hgt(Q);
    if (hp <= 0) out.push(P);
    if ((hp < 0 && hq > 0) || (hp > 0 && hq < 0)) { const t = hp / (hp - hq); out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]); }
  }
  let A = 0, Sy = 0, Sz = 0;
  for (let i = 0; i < out.length; i++) {
    const [y1, z1] = out[i], [y2, z2] = out[(i + 1) % out.length], cr = y1 * z2 - y2 * z1;
    A += cr; Sy += (y1 + y2) * cr; Sz += (z1 + z2) * cr;
  }
  A /= 2;
  return Math.abs(A) < 1e-12 ? { A: 0, y: 0, z: 0 } : { A, y: Sy / (6 * A), z: Sz / (6 * A) };
}

/** The hull as stations: Simpson weights and the section outline of each (fore and aft are symmetric, so only the
 *  aft half plus midship is integrated, with doubled weights). */
function stations(p: StabIn, base: [number, number][], nx: number) {
  const { par } = shape(p), h = p.L / (nx - 1), mid = (nx - 1) / 2, w: number[] = [], k: number[] = [], polys: [number, number][][] = [];
  for (let i = 0; i <= mid; i++) {
    const x = -p.L / 2 + i * h, wi = (h / 3) * (i === 0 ? 1 : i % 2 ? 4 : 2);
    const ki = fLong(Math.abs((2 * x) / p.L), par, p.a);
    w.push(i === mid ? wi : 2 * wi); k.push(ki);
    polys.push(base.map(([y, z]) => [y * ki, z] as [number, number]));
  }
  return { w, k, polys };
}

/** Displaced volume and centre of buoyancy (y, z) at heel φ with the waterline at earth height d (ship coordinates). */
function immersed(st: ReturnType<typeof stations>, phi: number, d: number) {
  const cs = Math.cos(phi), sn = Math.sin(phi);
  let V = 0, My = 0, Mz = 0;
  for (let i = 0; i < st.w.length; i++) {
    if (st.k[i] <= 0) continue;
    const s = clipBelow(st.polys[i], cs, sn, d);
    V += st.w[i] * s.A; My += st.w[i] * s.A * s.y; Mz += st.w[i] * s.A * s.z;
  }
  return { V, y: V > 0 ? My / V : 0, z: V > 0 ? Mz / V : 0 };
}

export type GZPoint = { deg: number; gz: number; yB: number; zB: number; d: number };

export function stability(p: StabIn, coarse = false) {
  const res = coarse ? RES.coarse : RES.fine, step = res.step, n = 80 / step;
  const sh = shape(p), base = sectionOutline(p, 1, res.nz), st = stations(p, base, res.nx);
  const up = immersed(st, 0, p.T), vol = up.V, disp = p.rho * vol; // m³, t
  // waterplane: half-breadth at the waterline is (B/2)·f(x)
  let Awp = 0, IT = 0;
  for (let i = 0; i < st.w.length; i++) { const yw = (p.B / 2) * st.k[i]; Awp += st.w[i] * 2 * yw; IT += st.w[i] * (2 / 3) * yw ** 3; }
  const KB = up.z, BM = IT / vol, KM = KB + BM;
  const FSM = p.tankRho * p.tankL * p.tankB ** 3 / 12, FSC = disp > 0 ? FSM / disp : 0; // t·m, m
  const KGf = p.KG + FSC, GM0 = KM - p.KG, GM = KM - KGf;

  // GZ curve: for each heel find the waterline height d with the same volume (regula falsi, Illinois)
  const curve: GZPoint[] = [];
  let dPrev = p.T;
  for (let deg = 0; deg <= 80; deg += step) {
    const phi = rad(deg), cs = Math.cos(phi), sn = Math.sin(phi);
    const hts = base.map(([y, z]) => [z * cs - y * sn, z * cs + y * sn]).flat();
    let lo = Math.min(...hts) - 1e-6, hi = Math.max(...hts) + 1e-6;
    let flo = -vol, fhi = immersed(st, phi, hi).V - vol, d = dPrev, side = 0, r = immersed(st, phi, d);
    for (let it = 0; it < 60 && Math.abs(r.V - vol) > vol * 1e-9; it++) {
      if (r.V - vol < 0) { lo = d; flo = r.V - vol; if (side === -1) fhi /= 2; side = -1; } else { hi = d; fhi = r.V - vol; if (side === 1) flo /= 2; side = 1; }
      d = (lo * fhi - hi * flo) / (fhi - flo);
      if (!(d > lo && d < hi)) d = (lo + hi) / 2;
      r = immersed(st, phi, d);
    }
    dPrev = d;
    curve.push({ deg, gz: r.y * cs + (r.z - KGf) * sn, yB: r.y, zB: r.z, d });
  }
  const gzAt = (deg: number) => { const u = deg / step, i = Math.min(Math.floor(u), n - 1), t = u - i; return curve[i].gz * (1 - t) + curve[i + 1].gz * t; };
  const area = (a0: number, a1: number) => { // m·rad, trapezoid on 0.25° steps
    let s = 0; const m = Math.max(1, Math.round((a1 - a0) * 4)), h = (a1 - a0) / m;
    for (let i = 0; i < m; i++) s += ((gzAt(a0 + i * h) + gzAt(a0 + (i + 1) * h)) / 2) * rad(h);
    return s;
  };
  const th40 = Math.min(40, p.thetaF);
  const A30 = area(0, 30), A40 = area(0, th40), A3040 = th40 > 30 ? area(30, th40) : 0;
  let iMax = 0; for (let i = 1; i < curve.length; i++) if (curve[i].gz > curve[iMax].gz) iMax = i;
  const gzMax = curve[iMax].gz, thMax = curve[iMax].deg;
  const gz30plus = Math.max(...curve.filter((q) => q.deg >= 30).map((q) => q.gz));
  let vanish = NaN; for (let i = 1; i < curve.length; i++) if (curve[i - 1].gz > 0 && curve[i].gz <= 0) { vanish = curve[i - 1].deg + curve[i - 1].gz / (curve[i - 1].gz - curve[i].gz); break; }
  const deckEdge = (Math.atan2(p.D - p.T, p.B / 2) * 180) / Math.PI;
  const wallSided = (deg: number) => { const ph = rad(deg); return Math.sin(ph) * (GM + 0.5 * BM * Math.tan(ph) ** 2); };
  // natural roll period, IS Code 2008 Part A 2.3.4 (weather criterion): T_r = 2 C B/√GM
  const Cr = 0.373 + 0.023 * (p.B / p.T) - 0.043 * (p.L / 100), Troll = GM > 0 ? (2 * Cr * p.B) / Math.sqrt(GM) : NaN;

  const f = (v: number, n = 3) => (Number.isFinite(v) ? v.toFixed(n) : '—');
  const checks = [
    { ok: p.T < p.D, label: 'Freeboard: the draft is below the deck (T < D)', detail: `D − T = ${f(p.D - p.T, 2)} m` },
    { ok: GM >= 0.15, label: 'Initial metacentric height GM₀ ≥ 0.15 m (free surface included)', detail: `GM₀ = ${f(GM)} m` },
    { ok: A30 >= 0.055, label: 'Area under the GZ curve 0…30° ≥ 0.055 m·rad', detail: `${f(A30, 4)} m·rad` },
    { ok: A40 >= 0.09, label: 'Area under the GZ curve 0…40° (or downflooding) ≥ 0.09 m·rad', detail: `${f(A40, 4)} m·rad (0…${f(th40, 0)}°)` },
    { ok: A3040 >= 0.03, label: 'Area between 30° and 40° (or downflooding) ≥ 0.03 m·rad', detail: `${f(A3040, 4)} m·rad` },
    { ok: gz30plus >= 0.2, label: 'Righting lever GZ ≥ 0.20 m at a heel of 30° or more', detail: `largest GZ beyond 30°: ${f(gz30plus)} m` },
    { ok: thMax >= 25, label: 'Maximum GZ at a heel of at least 25°', detail: `GZ_max = ${f(gzMax)} m, φ = ${thMax}°` },
  ];
  return {
    ...sh, vol, disp, Awp, CWP: Awp / (p.L * p.B), IT, KB, BM, KM, FSM, FSC, KGf, GM0, GM,
    curve, gzAt, A30, A40, A3040, th40, gzMax, thMax, vanish, deckEdge, wallSided, Cr, Troll, checks, base,
  };
}
export type StabResult = ReturnType<typeof stability>;

export const STAB_INTRO = 'A ship floats because the water it pushes aside weighs as much as the ship. When it heels, the underwater shape changes and the centre of buoyancy B moves to the low side, while the centre of gravity G stays where the cargo put it. The horizontal distance between them, the righting lever GZ, turns the ship back upright. Low G, wide hull and high freeboard give a long, strong GZ curve; a high G or loose liquid in tanks shortens it, and past the angle of vanishing stability the ship capsizes.';

export const STAB_NOTES = [
  'Hull: half-breadth (B/2)·f(x)·h(z) with a parallel middle body and ends of fullness a, sections 1 − (1 − z/T)^c below the waterline (c from C_M) and vertical sides above it, symmetric fore and aft, watertight up to a flat deck; no sheer, camber, bulbous bow, superstructure or appendages. The shape is defined at the given draft, so the coefficients are those of this loading condition.',
  'Hydrostatics by integration over 41 stations (Simpson): volume ∇, displacement Δ = ρ∇, KB, BM = I_T/∇, KM. GZ curve: for every degree of heel the waterline height is found so the displaced volume stays the same (free to heave, no trim), the immersed part of each section is clipped exactly and GZ = y_B cos φ + (z_B − KG) sin φ. The wall-sided formula GZ = sin φ (GM + ½ BM tan²φ) is drawn for comparison; it only holds before the deck edge immerses or the bilge emerges.',
  'Free surface: one slack tank, rectangular, free-surface moment ρ_t l b³/12; the free-surface correction FSC = FSM/Δ is added to KG for GM and the whole GZ curve (IMO practice for small angles, conservative at large ones).',
  'Criteria: IMO 2008 Intact Stability Code, Part A, 2.2 (general criteria for cargo and passenger ships): areas 0.055 / 0.09 / 0.03 m·rad, GZ ≥ 0.20 m at ≥ 30°, maximum GZ at ≥ 25°, GM₀ ≥ 0.15 m. Not included: the severe wind and rolling (weather) criterion of 2.3, grain, icing, towing, passenger crowding, trim and longitudinal strength, damage stability. Roll period T_r = 2 C B/√GM with C from 2.3.4 is shown for information. Checks are simplified — use approved stability software and the vessel’s stability booklet for any real ship.',
  'Closed-form checks in the tests: a box barge follows the wall-sided formula exactly until the deck edge immerses (KB = T/2, BM = B²/12T); the Wigley hull gives C_B = 4/9, KB = 5T/8 and BM = 0.0857 B²/T; GZ/sin φ tends to GM at small angles.',
];
