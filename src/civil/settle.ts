/**
 * Settlement of a shallow footing (Das, Principles of Foundation Engineering ch. 5 and 11; Craig ch. 7):
 * - stress increase under a uniformly loaded rectangle by Boussinesq (Newmark corner formula with superposition) and the 2:1 method;
 * - immediate (elastic) settlement of a flexible rectangle on an elastic layer of thickness H over a rigid base
 *   (Steinbrenner F1, F2, superposed at any surface point), average over the footing, rigid ≈ 0.93 × centre;
 * - primary consolidation of a clay layer (normally or over-consolidated, C_c, C_s, OCR) in sublayers;
 *   time with Terzaghi's one-dimensional theory, U(T_v) by the exact series.
 */
import { GW } from './bearing.ts';

export type FootShape = 'square' | 'rect' | 'strip';
export const STRIP_L = 100; // strip modelled as L = 100 B
const PI = Math.PI;

/** Newmark influence factor under the corner of an a × b rectangle at depth z (Δσ = q I). */
export function newmark(a: number, b: number, z: number) {
  if (a <= 0 || b <= 0) return 0;
  if (z <= 1e-9) return 0.25;
  const m = a / z, n = b / z, m2 = m * m, n2 = n * n, r = Math.sqrt(m2 + n2 + 1);
  const t1 = ((2 * m * n * r) / (m2 + n2 + m2 * n2 + 1)) * ((m2 + n2 + 2) / (m2 + n2 + 1));
  const t2 = Math.atan2(2 * m * n * r, m2 + n2 + 1 - m2 * n2);
  return (t1 + t2) / (4 * PI);
}
/** Signed superposition of corner rectangles: value at (x, y) of a B × L rectangle centred at the origin. */
function superpose(B: number, L: number, x: number, y: number, f: (a: number, b: number) => number) {
  const F = (a: number, b: number) => Math.sign(a) * Math.sign(b) * f(Math.abs(a), Math.abs(b));
  const x1 = -B / 2 - x, x2 = B / 2 - x, y1 = -L / 2 - y, y2 = L / 2 - y;
  return F(x2, y2) - F(x1, y2) - F(x2, y1) + F(x1, y1);
}
/** Boussinesq vertical stress increase at (x, y, z) below the base of a B × L footing with net pressure q. */
export const dSigma = (q: number, B: number, L: number, x: number, y: number, z: number) => q * superpose(B, L, x, y, (a, b) => newmark(a, b, z));
/** 2:1 spread: q B L / ((B + z)(L + z)). */
export const dSigma21 = (q: number, B: number, L: number, z: number) => (q * B * L) / ((B + z) * (L + z));

/** Steinbrenner factors for the corner of an a × b rectangle (a short side) on a layer of thickness H. */
export function steinbrenner(a: number, b: number, H: number) {
  const s = Math.min(a, b), l = Math.max(a, b), m = l / s, n = H / s;
  const r1 = Math.sqrt(m * m + 1), rn = Math.sqrt(m * m + n * n), r = Math.sqrt(m * m + n * n + 1);
  const A0 = m * Math.log(((1 + r1) * rn) / (m * (1 + r)));
  const A1 = Math.log(((m + r1) * Math.sqrt(1 + n * n)) / (m + r));
  return { F1: (A0 + A1) / PI, F2: (n / (2 * PI)) * Math.atan(m / (n * r)), short: s };
}
/** Settlement / (q (1 − ν²)/E) under the corner of an a × b rectangle: a′ (F1 + (1 − 2ν)/(1 − ν) F2). */
export function cornerFactor(a: number, b: number, H: number, nu: number) {
  if (a <= 0 || b <= 0) return 0;
  const f = steinbrenner(a, b, H);
  return f.short * (f.F1 + ((1 - 2 * nu) / (1 - nu)) * f.F2);
}

// ---------------- immediate settlement ----------------
export type ElasticIn = { shape: FootShape; B: number; L: number; q: number; E: number; nu: number; H: number; sAllow: number };
export const footL = (shape: FootShape, B: number, L: number) => (shape === 'square' ? B : shape === 'strip' ? STRIP_L * B : Math.max(L, B));

export function elastic(p: ElasticIn) {
  const L = footL(p.shape, p.B, p.L), k = (p.q * (1 - p.nu * p.nu)) / (p.E * 1e3); // E in MPa → kPa; result in m
  const at = (x: number, y: number) => k * superpose(p.B, L, x, y, (a, b) => cornerFactor(a, b, p.H, p.nu));
  const sC = at(0, 0), sEdge = p.shape === 'strip' ? at(p.B / 2, 0) : at(p.B / 2, L / 2); // strip: edge; else corner
  // average over the loaded area (midpoint rule, 24 × 24; strip: across the width at the middle section)
  const N = 24; let sum = 0;
  if (p.shape === 'strip') { for (let i = 0; i < N; i++) sum += at(-p.B / 2 + ((i + 0.5) / N) * p.B, 0); sum /= N; } else {
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) sum += at(-p.B / 2 + ((i + 0.5) / N) * p.B, -L / 2 + ((j + 0.5) / N) * L);
    sum /= N * N;
  }
  const sRigid = 0.93 * sC;
  const Is = sC / (k * p.B); // influence factor referred to the full width B
  const checks = [
    { ok: sRigid * 1e3 <= p.sAllow, label: 'Immediate settlement ≤ allowable', detail: `rigid footing ${(sRigid * 1e3).toFixed(1)} mm, allowable ${p.sAllow.toFixed(0)} mm` },
  ];
  return { L, k, at, sC, sEdge, sAvg: sum, sRigid, Is, checks };
}

// ---------------- consolidation ----------------
export type Drain = 'double' | 'single';
export type ConsolIn = {
  shape: FootShape; B: number; L: number; Df: number; q: number; // q = net pressure at the base [kPa]
  gamma: number; gammaSat: number; Dw: number; // sand above the clay: γ above, γ_sat below the water table; water table depth [m]
  zc: number; Hc: number; gammaC: number; e0: number; Cc: number; Cs: number; OCR: number; cv: number; // clay: top depth, thickness, γ_sat, e₀, C_c, C_s, OCR, c_v [m²/yr]
  drain: Drain; t: number; sAllow: number; // time after loading [yr], allowable [mm]
};
/** Effective vertical stress at depth z below ground before loading. */
export function sigma0(p: ConsolIn, z: number) {
  const zs = Math.min(z, p.zc), dry = Math.min(zs, p.Dw), wetSand = Math.max(zs - p.Dw, 0), clay = Math.max(z - p.zc, 0);
  const tot = p.gamma * dry + p.gammaSat * wetSand + p.gammaC * clay;
  return tot - GW * Math.max(z - p.Dw, 0);
}
/** Primary consolidation of one sublayer of thickness h at mid-depth with σ′0, Δσ. */
export function layerSettle(h: number, e0: number, Cc: number, Cs: number, s0: number, ds: number, sp: number) {
  const s1 = s0 + ds;
  if (sp <= s0 * 1.0000001) return ((Cc * h) / (1 + e0)) * Math.log10(s1 / s0);
  if (s1 <= sp) return ((Cs * h) / (1 + e0)) * Math.log10(s1 / s0);
  return ((Cs * h) / (1 + e0)) * Math.log10(sp / s0) + ((Cc * h) / (1 + e0)) * Math.log10(s1 / sp);
}
/** Average degree of consolidation U(T_v), Terzaghi exact series (uniform initial excess pore pressure). */
export function U(Tv: number) {
  if (Tv <= 0) return 0;
  if (Tv < 0.02) return Math.sqrt((4 * Tv) / PI); // series converges slowly; exact enough for U < 16 %
  let s = 0;
  for (let m = 0; m < 60; m++) { const M = (PI * (2 * m + 1)) / 2; s += (2 / (M * M)) * Math.exp(-M * M * Tv); }
  return 1 - s;
}
/** T_v for a given U (bisection). */
export function TvOf(u: number) {
  let lo = 0, hi = 5;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (U(m) < u) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
/** Excess pore pressure ratio u/u₀ at relative depth Z = z/H_dr (0 at the drained face) and T_v. */
export function uRatio(Z: number, Tv: number) {
  if (Tv <= 0) return Z > 0 ? 1 : 0;
  let s = 0;
  for (let m = 0; m < 60; m++) { const M = (PI * (2 * m + 1)) / 2; s += (2 / M) * Math.sin(M * Z) * Math.exp(-M * M * Tv); }
  return Math.max(0, Math.min(1, s));
}

export const NSUB = 10;
export function consolidation(p: ConsolIn) {
  const L = footL(p.shape, p.B, p.L), h = p.Hc / NSUB;
  const at = (x: number, y: number) => {
    let s = 0;
    const rows = [];
    for (let i = 0; i < NSUB; i++) {
      const z = p.zc + (i + 0.5) * h, s0 = sigma0(p, z), ds = dSigma(p.q, p.B, L, x, y, z - p.Df), sp = p.OCR * s0;
      const si = layerSettle(h, p.e0, p.Cc, p.Cs, s0, ds, sp);
      s += si; rows.push({ z, s0, ds, sp, si });
    }
    return { s, rows };
  };
  const c = at(0, 0), edge = p.shape === 'strip' ? at(p.B / 2, 0) : at(p.B / 2, L / 2);
  const Hdr = p.drain === 'double' ? p.Hc / 2 : p.Hc;
  const tOf = (u: number) => (TvOf(u) * Hdr * Hdr) / p.cv; // years
  const Tv = (p.cv * p.t) / (Hdr * Hdr), Ut = U(Tv);
  const t50 = tOf(0.5), t90 = tOf(0.9);
  const mid = c.rows[Math.floor(NSUB / 2)];
  const checks = [
    { ok: c.s * 1e3 <= p.sAllow, label: 'Final consolidation settlement ≤ allowable', detail: `${(c.s * 1e3).toFixed(1)} mm, allowable ${p.sAllow.toFixed(0)} mm` },
  ];
  return { L, at, c, edge, Hdr, Tv, Ut, st: c.s * Ut, t50, t90, tOf, mid, checks };
}

export const SETTLE_INTRO: Record<'elastic' | 'consol', string> = {
  elastic: 'Under a footing the ground compresses. In sand, gravel and stiff soils this happens as soon as the load is applied: immediate (elastic) settlement, larger in the middle of a flexible base than at its corners.',
  consol: 'A saturated clay layer settles slowly: the load first goes into the pore water, which must flow out through the clay before the soil skeleton compresses. Thicker layers with one drainage face take much longer: time grows with the square of the drainage path.',
};
export const SETTLE_NOTES = [
  'Stress increase: Boussinesq for a uniformly loaded flexible rectangle (Newmark corner influence factor, superposed for any point) on a homogeneous elastic half-space; the 2:1 method q B L/((B + z)(L + z)) is shown for comparison. Net pressure q at the base level D_f. A strip is modelled as L = 100 B.',
  'Immediate settlement (Das, Principles of Foundation Engineering, ch. 5): flexible footing on an elastic layer of thickness H over a rigid base, s = q (1 − ν²)/E · B′ (F₁ + (1 − 2ν)/(1 − ν) F₂) with Steinbrenner F₁, F₂ under each corner rectangle, superposed for the centre, corner and the settlement profile; average over the footing by integration; rigid footing ≈ 0.93 × centre of a flexible one. No embedment (Fox) correction, which would reduce the settlement. One uniform E; for sands E grows with depth, so use a representative value. Allowable settlement: 25 mm is the classic limit for isolated footings on sand (Terzaghi and Peck); EN 1997-1 Annex H notes that total settlements up to 50 mm are often acceptable for normal structures.',
  'Consolidation (Das ch. 11, Craig ch. 7): clay layer in 10 sublayers, s = Σ C h/(1 + e₀) log(σ′₁/σ′₀) with C_s up to σ′_p = OCR σ′₀ and C_c beyond; Terzaghi one-dimensional consolidation with uniform initial excess pore pressure, U(T_v) by the exact series, T_v = c_v t/H_dr². Not included: immediate settlement of the clay, secondary compression (creep), Skempton–Bjerrum correction for three-dimensional effects. Validation: Newmark factor m = n = 1 → 0.1752 and flexible square centre 1.12 q B (1 − ν²)/E, corner 0.56 (Das); T_v = 0.197 for U = 50 % and 0.848 for 90 % (Terzaghi).',
];
