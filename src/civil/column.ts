/**
 * Slender columns: Euler buckling with effective length, Johnson parabola for intermediate slenderness,
 * eccentric load by the secant formula. SI units: m, N, Pa, m⁴.
 */
import { IPE, MATERIALS, sectionProps, type Material, type Sect } from './beam.ts';

type Check = { ok: boolean; label: string; detail: string };

/** Theoretical effective length factors K (design codes recommend larger values where the end fixity is not perfect). */
export type End = 'pinned' | 'fixedFree' | 'fixedPinned' | 'fixedFixed';
export const END_K: Record<End, number> = { pinned: 1, fixedFree: 2, fixedPinned: 0.7, fixedFixed: 0.5 };
export const END_LABEL: Record<End, string> = { pinned: 'Pinned–pinned', fixedFree: 'Fixed–free', fixedPinned: 'Fixed–pinned', fixedFixed: 'Fixed–fixed' };

/** Minor-axis second moment I_z of the IPE profiles [cm⁴] (section tables). */
export const IPE_IZ: Record<string, number> = {
  'IPE 80': 8.49, 'IPE 100': 15.9, 'IPE 120': 27.7, 'IPE 140': 44.9, 'IPE 160': 68.3, 'IPE 180': 101, 'IPE 200': 142, 'IPE 220': 205, 'IPE 240': 284,
  'IPE 270': 420, 'IPE 300': 604, 'IPE 330': 788, 'IPE 360': 1043, 'IPE 400': 1318, 'IPE 450': 1676, 'IPE 500': 2142, 'IPE 550': 2668, 'IPE 600': 3387,
};

/** Compression strength [Pa] used for the column checks: steel and aluminium yield, timber C24 f_c,0,k, plain concrete f_ck. */
export const COMPRESSION: Record<string, number> = { s235: 235e6, s355: 355e6, al: 240e6, c24: 21e6, conc: 30e6 };

/** The weak axis governs buckling: A, I_min, extreme fibre c in the buckling plane, radius of gyration, and which section direction the column bows in. */
export function minorSection(s: Sect) {
  const q = sectionProps(s);
  const mm = 1e-3;
  let I = q.I, c = q.c, bowZ = true;
  if (s.kind === 'rect') { const mn = Math.min(s.b, s.h), mx = Math.max(s.b, s.h); I = (mx * mn ** 3 / 12) * mm ** 4; c = (mn / 2) * mm; bowZ = s.b <= s.h; }
  else if (s.kind === 'ipe') { const e = IPE.find((x) => x.name === s.name) ?? IPE[0]; I = IPE_IZ[e.name] * 1e4 * mm ** 4; c = (e.b / 2) * mm; }
  return { A: q.A, I, c, r: Math.sqrt(I / q.A), bowZ, outline: q.outline, hole: q.hole, dMin: 2 * c };
}

/** Euler critical load π² E I/(K L)². */
export const eulerLoad = (E: number, I: number, Le: number) => (Math.PI * Math.PI * E * I) / (Le * Le);

/** Slenderness at which the Euler hyperbola meets half the yield stress: λ_c = √(2π²E/σ_y). */
export const lambdaC = (E: number, sy: number) => Math.sqrt((2 * Math.PI * Math.PI * E) / sy);

/** Critical stress σ_cr(λ): Johnson parabola σ_y (1 − σ_y λ²/(4π²E)) below λ_c, Euler π²E/λ² above. */
export function criticalStress(E: number, sy: number, lam: number) {
  const lc = lambdaC(E, sy);
  return lam < lc ? sy * (1 - (sy * lam * lam) / (4 * Math.PI * Math.PI * E)) : (Math.PI * Math.PI * E) / (lam * lam);
}

export type ColumnIn = { L: number; end: End; sect: Sect; mat: Material; n: number; P: number };

export function analyseColumn(a: ColumnIn) {
  const m = minorSection(a.sect), E = a.mat.E, sy = COMPRESSION[a.mat.id] ?? a.mat.f;
  const K = END_K[a.end], Le = K * a.L;
  const lam = Le / m.r, lc = lambdaC(E, sy);
  const Pe = eulerLoad(E, m.I, Le);
  const sigCr = criticalStress(E, sy, lam), Pcr = sigCr * m.A;
  const Pallow = Pcr / a.n;
  const regime = lam < lc ? ('johnson' as const) : ('euler' as const);
  const checks: Check[] = [
    { ok: a.P <= Pallow, label: 'Load P ≤ P_cr/n (buckling with safety factor)', detail: `${(a.P / 1000).toFixed(1)} kN vs ${(Pallow / 1000).toFixed(1)} kN` },
    { ok: a.P / m.A <= sy / a.n, label: 'Crushing: P/A ≤ f/n', detail: `${(a.P / m.A / 1e6).toFixed(1)} MPa vs ${(sy / a.n / 1e6).toFixed(1)} MPa` },
    { ok: lam <= 200, label: 'Slenderness λ ≤ 200 (usual upper limit for compression members)', detail: `λ = ${lam.toFixed(0)}` },
  ];
  return { ...m, E, sy, K, Le, lam, lc, Pe, sigCr, Pcr, Pallow, regime, checks };
}
export type ColumnResult = ReturnType<typeof analyseColumn>;

/* ---------- eccentric load: secant formula ---------- */

const sec = (x: number) => 1 / Math.cos(x);

/** Maximum compressive stress and mid-height deflection at axial load P applied e from the axis (effective length L_e). */
export function secant(m: { A: number; I: number; c: number; r: number }, E: number, Le: number, P: number, e: number) {
  const Pe = eulerLoad(E, m.I, Le);
  if (P >= Pe) return { sigma: Infinity, delta: Infinity, Pe };
  const x = (Math.PI / 2) * Math.sqrt(P / Pe); // = (Le/2) √(P/EI)
  const sigma = (P / m.A) * (1 + ((e * m.c) / (m.r * m.r)) * sec(x));
  const delta = e * (sec(x) - 1);
  return { sigma, delta, Pe };
}

/** Axial load at which the secant stress reaches σ_y (bisection below P_e). */
export function secantYieldLoad(m: { A: number; I: number; c: number; r: number }, E: number, Le: number, sy: number, e: number) {
  const Pe = eulerLoad(E, m.I, Le);
  let lo = 0, hi = Pe * (1 - 1e-12);
  if (secant(m, E, Le, hi, e).sigma < sy) return hi;
  for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; if (secant(m, E, Le, mid, e).sigma < sy) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

export function analyseEccentric(a: ColumnIn & { e: number }) {
  const r = analyseColumn(a);
  const s = secant(r, r.E, r.Le, a.P, a.e);
  const Py = secantYieldLoad(r, r.E, r.Le, r.sy, a.e);
  const checks: Check[] = [
    { ok: a.P < r.Pe, label: 'Load P below the Euler load P_e', detail: `${(a.P / 1000).toFixed(1)} kN vs ${(r.Pe / 1000).toFixed(1)} kN` },
    { ok: s.sigma <= r.sy / a.n, label: 'Maximum stress σ_max (secant) ≤ f/n', detail: Number.isFinite(s.sigma) ? `${(s.sigma / 1e6).toFixed(1)} MPa vs ${(r.sy / a.n / 1e6).toFixed(1)} MPa` : 'unstable' },
    { ok: r.lam <= 200, label: 'Slenderness λ ≤ 200 (usual upper limit for compression members)', detail: `λ = ${r.lam.toFixed(0)}` },
  ];
  return { ...r, sigmaMax: s.sigma, delta: s.delta, Py, checks };
}
export type EccentricResult = ReturnType<typeof analyseEccentric>;

/* ---------- buckled shape ---------- */

/** Normalised buckling mode (maximum 1) at ξ = x/L from the base: ends as named in `End`; fixed end at ξ = 0. */
export function modeShape(end: End, xi: number) {
  if (end === 'pinned') return Math.sin(Math.PI * xi);
  if (end === 'fixedFree') return 1 - Math.cos((Math.PI / 2) * xi);
  if (end === 'fixedFixed') return (1 - Math.cos(2 * Math.PI * xi)) / 2;
  const kL = 4.4934094579, k = kL, t = Math.tan(kL);
  const w = (x: number) => Math.sin(k * x) - t * Math.cos(k * x) - k * x + t; // x in units of L
  let mx = 0; for (let i = 0; i <= 200; i++) mx = Math.max(mx, Math.abs(w(i / 200)));
  return w(xi) / mx;
}

export const COLUMN_INTRO = 'A slender column under compression does not crush: it suddenly bows sideways (buckles) at a load far below the crushing load. The longer and thinner the column and the looser its ends, the lower that load. The column bows about its weak axis; the bow is drawn exaggerated.';

export const COLUMN_INTRO_J = 'Slenderness λ = K L/r decides how a column fails. Slender columns (λ above λ_c) buckle elastically and follow the Euler hyperbola. Stocky columns (λ below λ_c) fail by yielding before they can buckle, so Johnson’s parabola lowers the Euler value. The stocky column is drawn shortening under load; the dot on the graph is your column.';

export const COLUMN_INTRO_E = 'A load that is not exactly on the axis bends the column from the start: there is no sudden buckling, the deflection and the maximum stress grow faster and faster as the load nears the Euler load. The bow shown is the real (exaggerated) deflection at your load; the orange arrow is offset by the eccentricity e.';

export const COLUMN_NOTES = [
  'Euler: P_cr = π² E I/(K L)² with the weak-axis I and the effective length K L (theoretical K: pinned–pinned 1, fixed–free 2, fixed–pinned 0.7, fixed–fixed 0.5; real supports are never perfectly fixed, so codes use larger values). Valid for slender columns (λ = K L/r above λ_c = √(2π²E/σ_y)). The Euler load is checked against Hibbeler’s worked example 13.1 (W8×40 pin-ended column).',
  'Johnson: for λ < λ_c the critical stress follows the parabola σ_cr = σ_y (1 − σ_y λ²/(4π²E)), which meets the Euler hyperbola at σ_y/2. Strength σ_y: yield for steel and aluminium, f_c,0,k for timber C24, f_ck for plain concrete. Imperfections, residual stresses and the buckling curves of design codes are not modelled; the safety factor n is yours.',
  'Eccentric load: secant formula σ_max = P/A [1 + (e c/r²) sec((K L/2r) √(P/EA))] and δ = e [sec((K L/2) √(P/EI)) − 1], exact for pinned ends with K = 1 and used with the effective length for other end conditions (an approximation). The stress is linear-elastic; the column is assumed to stay elastic up to σ_y.',
  'Not modelled: local buckling of thin walls, torsional and flexural-torsional buckling, bracing between the ends, initial crookedness, biaxial bending, creep (timber, concrete), reinforcement.',
];
