/**
 * Slope stability (Das, Principles of Foundation Engineering / Craig, Soil Mechanics; Bishop 1955; Taylor 1937):
 * - infinite slope with seepage parallel to the slope (water at m z above the slip plane);
 * - simple slope (toe at the origin, face at angle β, crest at height H) on a firm base at depth D below the toe:
 *   circular slip surfaces, Bishop's simplified method (Fellenius / ordinary method for comparison), phreatic line
 *   from the toe to h_w at the back, uniform surcharge q on the crest, critical-circle search over a grid of centres
 *   with radius sweep and local refinement;
 * - Eurocode 7 GEO check: design strengths (M2: tan φ′/1.25, c′/1.25) and the surcharge × 1.3 (A2) or × 1.5 (A1).
 */
import { GW } from './bearing.ts';

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

// ---------------- infinite slope ----------------
export type InfIn = { beta: number; z: number; m: number; c: number; phi: number; gamma: number; gammaSat: number; FSreq: number };
/** Infinite slope with parallel seepage: water surface at m z above the slip plane (0 ≤ m ≤ 1). */
export function infSlope(p: InfIn, z = p.z, c = p.c, phi = p.phi) {
  const b = rad(p.beta), cb = Math.cos(b), sb = Math.sin(b), m = Math.min(Math.max(p.m, 0), 1);
  const sv = (p.gamma * (1 - m) + p.gammaSat * m) * z; // total vertical stress on the slip plane
  const u = GW * m * z * cb * cb; // parallel seepage
  const sigma = sv * cb * cb, tau = sv * sb * cb, sig1 = sigma - u;
  const FS = (c + Math.max(sig1, 0) * Math.tan(rad(phi))) / tau;
  return { sigma, tau, u, sig1, FS };
}
export function infinite(p: InfIn) {
  const r = infSlope(p);
  const phiD = deg(Math.atan(Math.tan(rad(p.phi)) / 1.25)), d = infSlope(p, p.z, p.c / 1.25, phiD);
  // depth at which FS = 1 (c′ > 0 only), by bisection on z
  let Hcr = Infinity;
  if (p.c > 0 && infSlope(p, 200).FS < 1) { let lo = 1e-3, hi = 200; for (let i = 0; i < 80; i++) { const mz = (lo + hi) / 2; if (infSlope(p, mz).FS > 1) lo = mz; else hi = mz; } Hcr = (lo + hi) / 2; }
  const checks = [
    { ok: r.FS >= p.FSreq, label: `Factor of safety ≥ ${p.FSreq.toFixed(2)}`, detail: `FS ${r.FS.toFixed(2)}` },
    { ok: d.FS >= 1, label: 'Eurocode 7 (M2: tan φ′/1.25, c′/1.25): FS_d ≥ 1', detail: `FS_d ${d.FS.toFixed(2)}` },
  ];
  return { ...r, phiD, FSd: d.FS, Hcr, checks };
}

// ---------------- circular slip, simple slope ----------------
export type CircIn = { H: number; beta: number; D: number; c: number; phi: number; gamma: number; gammaSat: number; hw: number; q: number; FSreq: number };
export type Circle = { xo: number; yo: number; R: number };
export const crestX = (p: CircIn) => p.H / Math.tan(rad(p.beta));
export const ground = (p: CircIn, x: number) => (x <= 0 ? 0 : x >= crestX(p) ? p.H : x * Math.tan(rad(p.beta)));
/** Phreatic line: from the toe (0, 0) rising straight to h_w at x = crest + H, level beyond; not above the ground. */
export const water = (p: CircIn, x: number) => (p.hw <= 0 ? -Infinity : x <= 0 ? 0 : Math.min(ground(p, x), (p.hw * Math.min(x, crestX(p) + p.H)) / (crestX(p) + p.H)));

export type Slice = { x: number; b: number; l: number; yTop: number; yBot: number; W: number; u: number; alpha: number };
export const NSL = 30;
/** Slices of the mass above the circle (largest stretch where the circle is below the ground). */
export function slices(p: CircIn, C: Circle, n = NSL): Slice[] | null {
  const x0 = C.xo - C.R, x1 = C.xo + C.R, N = 160;
  let best: [number, number] | null = null, start: number | null = null;
  const tol = 1e-6 * p.H; // a circle through the toe must not split the mass there
  const under = (x: number) => C.yo - Math.sqrt(Math.max(C.R * C.R - (x - C.xo) ** 2, 0)) < ground(p, x) + tol;
  for (let i = 0; i <= N; i++) {
    const x = x0 + ((x1 - x0) * i) / N, u = i > 0 && i < N && under(x);
    if (u && start === null) start = x;
    if ((!u || i === N) && start !== null) { const end = x; if (!best || end - start > best[1] - best[0]) best = [start, end]; start = null; }
  }
  if (!best) return null;
  // both ends must cross the ground surface (a circle whose side stays inside the soil is no mechanism)
  const dx0 = (x1 - x0) / N;
  if (best[0] <= x0 + 1.5 * dx0 || best[1] >= x1 - 0.5 * dx0) return null;
  // refine the two crossings by bisection
  const cross = (a: number, b: number) => { for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (under(m) === under(a)) a = m; else b = m; } return (a + b) / 2; };
  const dx = (x1 - x0) / N, xl = cross(Math.max(x0, best[0] - dx), best[0]), xr = cross(best[1] - dx, Math.min(x1, best[1]));
  // equal angle steps along the arc: narrow slices where the circle is steep, exact base length l = R Δα
  const as = (x: number) => Math.asin(Math.max(-1, Math.min(1, (x - C.xo) / C.R)));
  const aL = as(xl), aR = as(xr), out: Slice[] = [], xc = crestX(p);
  for (let i = 0; i < n; i++) {
    const a1 = aL + ((aR - aL) * i) / n, a2 = aL + ((aR - aL) * (i + 1)) / n;
    const x1 = C.xo + C.R * Math.sin(a1), x2 = C.xo + C.R * Math.sin(a2), b = x2 - x1, x = (x1 + x2) / 2, alpha = (a1 + a2) / 2;
    const yTop = ground(p, x), yBot = C.yo - C.R * Math.cos(alpha);
    const h = Math.max(yTop - yBot, 0), yw = water(p, x), wetH = Math.min(Math.max(yw - yBot, 0), h);
    const W = (p.gamma * (h - wetH) + p.gammaSat * wetH) * b + (x >= xc ? p.q * b : 0);
    out.push({ x, b, l: C.R * (a2 - a1), yTop, yBot, W, u: GW * Math.max(yw - yBot, 0), alpha });
  }
  return out;
}
/** Bishop's simplified method (iterated) and Fellenius' ordinary method for one circle. */
export function bishop(p: CircIn, C: Circle, c = p.c, phi = p.phi, qf = 1) {
  const pp = qf === 1 ? p : { ...p, q: p.q * qf };
  const S = slices(pp, C);
  if (!S) return null;
  const t = Math.tan(rad(phi));
  const drive = S.reduce((a, s) => a + s.W * Math.sin(s.alpha), 0);
  const area = S.reduce((a, s) => a + (s.yTop - s.yBot) * s.b, 0);
  if (drive <= 1e-9 || area < 0.004 * p.H * p.H) return null;
  const fell = S.reduce((a, s) => a + c * s.l + Math.max(s.W * Math.cos(s.alpha) - s.u * s.l, 0) * t, 0) / drive;
  let F = Math.max(fell, 0.3);
  for (let it = 0; it < 60; it++) {
    let res = 0;
    for (const s of S) {
      const ma = Math.cos(s.alpha) * (1 + (Math.tan(s.alpha) * t) / F);
      if (s.alpha < 0 && ma < 0.2) return null; // m_α too small at the exit: Bishop unreliable for this circle
      const bb = s.l * Math.cos(s.alpha); // horizontal width of the base
      res += (c * bb + Math.max(s.W - s.u * bb, 0) * t) / ma;
    }
    const Fn = res / drive;
    if (Math.abs(Fn - F) < 1e-6) { F = Fn; break; }
    F = Fn;
  }
  return { FS: F, fell, S, drive, area };
}
/** Circle by centre and depth of its lowest point; null if it would cut the firm base. */
const circleOf = (xo: number, yo: number, yb: number): Circle => ({ xo, yo, R: yo - yb });

export function search(p: CircIn, c = p.c, phi = p.phi, qf = 1, from?: Circle, coarse = false) {
  const xc = crestX(p), H = p.H;
  const gx0 = -0.6 * H, gx1 = xc + 0.6 * H, gy0 = H * 0.7, gy1 = H * 2.6, NX = coarse ? 8 : 15, NY = coarse ? 6 : 12, NR = coarse ? 8 : 14;
  let best: { C: Circle; FS: number } | null = null;
  const grid: { x: number; y: number; FS: number }[] = [], starts3: { C: Circle; FS: number }[] = [];
  const evalC = (C: Circle) => { if (C.yo - C.R < -p.D - 1e-9 || C.R <= 0.05 * H) return Infinity; const r = bishop(p, C, c, phi, qf); return r ? r.FS : Infinity; };
  if (from) starts3.push({ C: from, FS: evalC(from) });
  else for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
    const xo = gx0 + ((gx1 - gx0) * i) / (NX - 1), yo = gy0 + ((gy1 - gy0) * j) / (NY - 1);
    let fmin = Infinity, cmin: Circle | null = null;
    for (let k = 0; k < NR; k++) {
      const yb = -p.D + ((0.85 * H + p.D) * k) / (NR - 1), C = circleOf(xo, yo, yb), f = evalC(C);
      if (f < fmin) { fmin = f; cmin = C; }
    }
    grid.push({ x: xo, y: yo, FS: fmin });
    if (cmin) starts3.push({ C: cmin, FS: fmin });
    if (cmin && (!best || fmin < best.FS)) best = { C: cmin, FS: fmin };
  }
  if (from && Number.isFinite(starts3[0].FS)) best = starts3[0];
  if (!best) return null;
  // local refinement (pattern search on centre and depth) from the three best grid centres
  const refine = (C0: Circle, f0: number) => {
    let cur = { xo: C0.xo, yo: C0.yo, yb: C0.yo - C0.R }, f = f0, step = 0.08 * H;
    for (let it = 0; it < 150 && step > 0.002 * H; it++) {
      let moved = false;
      for (const [dx, dy, db] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [1, 1, 0], [-1, -1, 0], [1, -1, 0], [-1, 1, 0]]) {
        const n = { xo: cur.xo + dx * step, yo: cur.yo + dy * step, yb: Math.max(cur.yb + db * step, -p.D) };
        if (n.yo - n.yb < 0.05 * H) continue;
        const fn = evalC(circleOf(n.xo, n.yo, n.yb));
        if (fn < f - 1e-7) { cur = n; f = fn; moved = true; }
      }
      if (!moved) step /= 2;
    }
    return { C: circleOf(cur.xo, cur.yo, cur.yb), FS: f };
  };
  const starts = starts3.sort((a, b) => a.FS - b.FS).slice(0, coarse ? 2 : 3);
  const fin = starts.map((st) => refine(st.C, st.FS)).reduce((a, b) => (b.FS < a.FS ? b : a));
  const C = fin.C, f = fin.FS, r = bishop(p, C, c, phi, qf)!;
  return { C, FS: f, r, grid, gx: [gx0, gx1] as const, gy: [gy0, gy1] as const, NX, NY };
}

export const EC7_SLOPE = [
  { name: 'DA1-1', set: 'A1 + M1', qf: 1.5, gm: 1.0 },
  { name: 'DA1-2', set: 'A2 + M2', qf: 1.3, gm: 1.25 },
  { name: 'DA3', set: 'A2 + M2', qf: 1.3, gm: 1.25 },
];
export function circular(p: CircIn) {
  const s = search(p);
  const ec = EC7_SLOPE.map((k) => {
    if (k.name === 'DA3') return null; // identical to DA1-2 here (all actions geotechnical)
    const phiD = deg(Math.atan(Math.tan(rad(p.phi)) / k.gm)), cD = p.c / k.gm;
    // start from the characteristic critical circle and refine locally (a full grid search per combination is too slow on phones)
    const sd = s && (k.qf !== 1 && p.q > 0 || k.gm !== 1) ? search(p, cD, phiD, k.qf, s.C) : s;
    return { ...k, phiD, cD, FS: sd ? sd.FS : NaN, C: sd?.C };
  });
  ec[2] = ec[1] ? { ...ec[1], name: 'DA3' } : null;
  const ecv = ec.filter((e): e is NonNullable<typeof e> => !!e);
  const worst = ecv.reduce((a, b) => (b.FS < a.FS ? b : a), ecv[0]);
  const FS = s ? s.FS : NaN;
  const checks = [
    { ok: FS >= p.FSreq, label: `Factor of safety ≥ ${p.FSreq.toFixed(2)} (Bishop, critical circle)`, detail: `FS ${FS.toFixed(2)}${s ? `, Fellenius ${s.r.fell.toFixed(2)}` : ''}` },
    { ok: worst.FS >= 1, label: 'Eurocode 7 GEO: FS_d ≥ 1 with design strengths', detail: `${worst.name} (${worst.set}): FS_d ${worst.FS.toFixed(2)}` },
  ];
  return { s, FS, ec: ecv, worst, checks };
}

/** Quick pass/fail of all circular-slip checks (coarse search, EC7 refined locally): for slider pass ranges. */
export function circularOk(p: CircIn) {
  const s = search(p, p.c, p.phi, 1, undefined, true);
  if (!s || s.FS < p.FSreq) return false;
  for (const k of EC7_SLOPE.slice(0, 2)) {
    const phiD = deg(Math.atan(Math.tan(rad(p.phi)) / k.gm)), cD = p.c / k.gm;
    const sd = k.gm === 1 && (k.qf === 1 || p.q === 0) ? s : search(p, cD, phiD, k.qf, s.C);
    if (!sd || sd.FS < 1) return false;
  }
  return true;
}

export const SLOPE_INTRO: Record<'infinite' | 'circular', string> = {
  infinite: 'A long natural slope often fails along a plane parallel to its surface, at the depth of a weaker layer or the rock below. Water flowing down the slope lowers the friction on that plane: many landslides start after heavy rain.',
  circular: 'In a cut or an embankment the soil tends to rotate on a curved surface. The method of slices cuts the moving mass into vertical strips and compares the resisting shear along the curve with the driving weight; the critical circle is the one with the smallest factor of safety.',
};
export const SLOPE_NOTES = [
  'Infinite slope: slip plane parallel to the surface at vertical depth z, seepage parallel to the slope with the water surface at m z above the plane, u = γ_w m z cos²β; FS = (c′ + σ′ tan φ′)/τ with σ = γ z cos²β and τ = γ z sin β cos β (γ above and γ_sat below the water surface). Dry and c′ = 0: FS = tan φ′/tan β; full seepage: FS = (γ′/γ_sat) tan φ′/tan β (Das).',
  'Circular slip (Bishop 1955, simplified: horizontal interslice forces): FS = Σ [c′ b + (W − u b) tan φ′]/m_α ÷ Σ W sin α, m_α = cos α (1 + tan α tan φ′/FS), 30 slices, iterated; Fellenius (ordinary method) for comparison. Homogeneous soil on a firm base at depth D below the toe; phreatic line straight from the toe to h_w at the back, pore pressure hydrostatic below it; surcharge q on the whole crest. Critical circle: 15 × 12 grid of centres, 14 depths each, then a local pattern search from the three best; circles with m_α < 0.2 at the exit are skipped. Validation: Taylor’s stability chart for φ = 0 (c/(γ H F) = 0.181 for deep circles at β ≤ 53°, 0.219 at β = 75°); shallow circles in dry sand approach tan φ′/tan β.',
  'Eurocode 7 GEO: soil weight unfactored (one source), surcharge × 1.5 (A1) or × 1.3 (A2), strengths tan φ′/1.25 and c′/1.25 (M2), resistance factor 1.0 (R1/R3); the critical circle is refined again with the design values, starting from the characteristic one. DA3 equals DA1-2 here because all actions are geotechnical. Not included: layered soils, tension cracks, non-circular surfaces, seismic load, undrained strength profiles, reinforcement.',
];
