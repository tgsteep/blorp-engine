/**
 * Incompressible pipe flow: Darcy–Weisbach with Colebrook friction, minor losses by K, one pipe,
 * pipes in series (with sudden diameter changes) and parallel branches between the same two junctions.
 * SI units throughout: m, m³/s, Pa, kg/m³, Pa·s.
 */
import { OILS, viscosity } from '../bearings/plain.ts';

export const G = 9.80665;
type Check = { ok: boolean; label: string; detail: string };

/* ---------- fluids ---------- */

export type FluidKind = 'water' | 'oil' | 'air' | 'custom';
export type Fluid = { kind: FluidKind; name: string; rho: number; mu: number; c: number | null; gas: boolean };

/** Water density, Tanaka et al. (1975), 0…100 °C (error < 0.02 % below 40 °C, < 0.1 % to 100 °C). */
export const waterDensity = (T: number) => 1000 * (1 - ((T + 288.9414) / (508929.2 * (T + 68.12963))) * (T - 3.9863) ** 2);
/** Water dynamic viscosity, Vogel-type fit μ = 2.414e-5·10^(247.8/(T + 133.15 K)) [Pa·s] (≈ 1.002 mPa·s at 20 °C, ≈ 0.282 at 100 °C). */
export const waterViscosity = (T: number) => 2.414e-5 * Math.pow(10, 247.8 / (T + 273.15 - 140));
/** Air dynamic viscosity by Sutherland's law (T in °C). */
export const airViscosity = (T: number) => 1.716e-5 * Math.pow((T + 273.15) / 273.15, 1.5) * (273.15 + 110.4) / (T + 273.15 + 110.4);
export const R_AIR = 287.05;

export type FluidIn = { kind: FluidKind; T: number; oil?: string; pAbs?: number; rho?: number; mu?: number };

export function fluidProps(f: FluidIn): Fluid {
  if (f.kind === 'water') return { kind: 'water', name: 'water', rho: waterDensity(f.T), mu: waterViscosity(f.T), c: null, gas: false };
  if (f.kind === 'oil') {
    const nu = viscosity(OILS[f.oil ?? 'VG46'], f.T) * 1e-6; // m²/s
    const rho = 870 - 0.65 * (f.T - 15); // mineral oil, ≈ 0.075 %/K
    return { kind: 'oil', name: f.oil ?? 'VG46', rho, mu: rho * nu, c: null, gas: false };
  }
  if (f.kind === 'air') {
    const TK = f.T + 273.15;
    return { kind: 'air', name: 'air', rho: (f.pAbs ?? 101325) / (R_AIR * TK), mu: airViscosity(f.T), c: Math.sqrt(1.4 * R_AIR * TK), gas: true };
  }
  return { kind: 'custom', name: 'custom', rho: f.rho ?? 1000, mu: f.mu ?? 1e-3, c: null, gas: false };
}

/* ---------- roughness, fittings ---------- */

/** Absolute roughness ε [mm], typical new pipe (Çengel Table 8-2). */
export const ROUGHNESS: { id: string; label: string; eps: number }[] = [
  { id: 'drawn', label: 'drawn tube, PVC, copper', eps: 0.0015 },
  { id: 'steel', label: 'commercial steel', eps: 0.045 },
  { id: 'galv', label: 'galvanized iron', eps: 0.15 },
  { id: 'cast', label: 'cast iron', eps: 0.26 },
  { id: 'concrete', label: 'concrete', eps: 3 },
];

/** Loss coefficients K = Δp/(ρv²/2), typical high-Re values for flanged/welded fittings (Çengel Table 8-4). */
export const FITTINGS: { id: string; label: string; K: number }[] = [
  { id: 'entrance', label: 'sharp entrance', K: 0.5 },
  { id: 'exit', label: 'exit into a tank', K: 1.0 },
  { id: 'elbow90', label: '90° elbow', K: 0.3 },
  { id: 'elbow90lr', label: '90° long-radius elbow', K: 0.2 },
  { id: 'elbow45', label: '45° elbow', K: 0.4 },
  { id: 'teeRun', label: 'tee, through flow', K: 0.2 },
  { id: 'teeBranch', label: 'tee, branch flow', K: 1.0 },
  { id: 'gate', label: 'gate valve, open', K: 0.2 },
  { id: 'ball', label: 'ball valve, open', K: 0.05 },
  { id: 'butterfly', label: 'butterfly valve, open', K: 0.24 },
  { id: 'check', label: 'swing check valve', K: 2.0 },
  { id: 'globe', label: 'globe valve, open', K: 10 },
];
export type FittingCounts = Record<string, number>;
export const sumK = (n: FittingCounts) => FITTINGS.reduce((s, f) => s + (n[f.id] ?? 0) * f.K, 0);

/* ---------- friction ---------- */

export const RE_LAMINAR = 2300;
export const RE_TURBULENT = 4000;

/** Colebrook–White 1/√f = −2 log₁₀(ε/(3.7 D) + 2.51/(Re √f)), Newton on x = 1/√f from the Swamee–Jain start. */
export function colebrook(Re: number, rel: number) {
  let x = -2 * Math.log10(rel / 3.7 + 5.74 / Math.pow(Re, 0.9)); // Swamee–Jain
  for (let i = 0; i < 30; i++) {
    const a = rel / 3.7 + (2.51 * x) / Re;
    const g = x + 2 * Math.log10(a);
    const dg = 1 + (2 / Math.LN10) * (2.51 / Re) / a;
    const step = g / dg;
    x -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  return 1 / (x * x);
}

export type Regime = 'laminar' | 'transition' | 'turbulent';
export const regimeOf = (Re: number): Regime => (Re < RE_LAMINAR ? 'laminar' : Re < RE_TURBULENT ? 'transition' : 'turbulent');

/** Darcy friction factor: 64/Re laminar; Colebrook turbulent; linear blend in the transition zone (uncertain). */
export function frictionFactor(Re: number, rel: number) {
  if (Re <= 0) return 0;
  if (Re < RE_LAMINAR) return 64 / Re;
  const fT = colebrook(RE_TURBULENT, rel);
  if (Re < RE_TURBULENT) {
    const f0 = 64 / RE_LAMINAR, s = (Re - RE_LAMINAR) / (RE_TURBULENT - RE_LAMINAR);
    return f0 + (fT - f0) * s;
  }
  return colebrook(Re, rel);
}

/** Moody chart curve for one relative roughness: [Re, f] pairs, laminar line and turbulent Colebrook line. */
export function moodyCurve(rel: number, n = 40, reMin = 4000, reMax = 1e8) {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const Re = reMin * Math.pow(reMax / reMin, i / n);
    out.push([Re, colebrook(Re, rel)]);
  }
  return out;
}

/* ---------- one pipe section ---------- */

export type Section = { D: number; L: number; eps: number; K: number }; // m, m, m, –
export type FluidRho = { rho: number; mu: number };

export function pipeSection(fl: FluidRho, Q: number, s: Section) {
  const A = (Math.PI / 4) * s.D * s.D;
  const v = Q / A;
  const Re = (fl.rho * v * s.D) / fl.mu;
  const rel = s.eps / s.D;
  const f = frictionFactor(Re, rel);
  const q = 0.5 * fl.rho * v * v; // dynamic pressure
  const dpF = f * (s.L / s.D) * q;
  const dpM = s.K * q;
  return { A, v, Re, rel, f, regime: regimeOf(Re), q, dpF, dpM, dp: dpF + dpM, hF: dpF / (fl.rho * G), hM: dpM / (fl.rho * G) };
}
export type SectionResult = ReturnType<typeof pipeSection>;

/** Velocity range usually recommended [m/s]; null = no guidance (custom fluid). */
export const VELOCITY_RANGE: Record<FluidKind, [number, number] | null> = { water: [0.5, 3], oil: [0.3, 2], air: [2, 25], custom: null };

export type PipeChecks = { dpMax: number; fluid: Fluid; pAbs?: number };

function commonChecks(fluid: Fluid, secs: { label: string; r: SectionResult }[], dpTotal: number, dpMax: number, pAbs?: number): Check[] {
  const out: Check[] = [];
  const range = VELOCITY_RANGE[fluid.kind];
  for (const { label, r } of secs) {
    if (range) out.push({ ok: r.v >= range[0] && r.v <= range[1], label: `${label}velocity ${range[0]}…${range[1]} m/s (usual range, ${fluid.kind === 'air' ? 'air' : 'liquid'})`, detail: `v = ${r.v.toFixed(2)} m/s` });
    out.push({ ok: r.regime !== 'transition', label: `${label}not in the transition zone (Re 2300…4000: friction factor uncertain)`, detail: `Re = ${Math.round(r.Re)}, ${r.regime}` });
  }
  out.push({ ok: dpTotal <= dpMax, label: `Pressure drop ≤ ${(dpMax / 1000).toFixed(0)} kPa (your limit)`, detail: `${(dpTotal / 1000).toFixed(2)} kPa` });
  if (fluid.gas && fluid.c) {
    const M = Math.max(...secs.map((s) => s.r.v)) / fluid.c;
    out.push({ ok: M < 0.3, label: 'Incompressible: Mach number < 0.3', detail: `Ma = ${M.toFixed(3)}` });
    if (pAbs) out.push({ ok: dpTotal <= 0.1 * pAbs, label: 'Incompressible: pressure drop ≤ 10 % of the absolute pressure', detail: `${((dpTotal / pAbs) * 100).toFixed(1)} %` });
  }
  return out;
}

/* ---------- single pipe and series ---------- */

/** Loss at a sudden change of diameter, referred to the velocity named in `at`: expansion (1 − A₁/A₂)² on v₁, contraction 0.5(1 − A₂/A₁) on v₂. */
export function suddenChange(D1: number, D2: number) {
  const a = (D1 / D2) ** 2; // A1/A2
  if (D2 >= D1) return { K: (1 - a) ** 2, at: 'up' as const }; // expansion, upstream velocity
  return { K: 0.5 * (1 - 1 / a), at: 'down' as const }; // contraction, downstream velocity (A2/A1 = 1/a)
}

export type SeriesIn = { fluid: Fluid; Q: number; sections: Section[]; dz: number; dpMax: number; pAbs?: number };

/**
 * Sections in series, same Q. Between sections a sudden diameter change adds a minor loss.
 * dz = outlet height − inlet height [m]. Total pressure the pump / source must supply = losses + ρ g dz.
 */
export function pipeSeries(p: SeriesIn) {
  const { fluid: fl, Q } = p;
  const secs = p.sections.map((s) => pipeSection(fl, Q, s));
  const joints = p.sections.slice(1).map((s, i) => {
    const prev = p.sections[i];
    const { K, at } = suddenChange(prev.D, s.D);
    const r = at === 'up' ? secs[i] : secs[i + 1];
    return { K, at, dp: K * r.q };
  });
  const dpF = secs.reduce((a, r) => a + r.dpF, 0);
  const dpM = secs.reduce((a, r) => a + r.dpM, 0) + joints.reduce((a, j) => a + j.dp, 0);
  const dpZ = fl.rho * G * p.dz;
  const dpLoss = dpF + dpM;
  const dpTotal = dpLoss + dpZ;
  const head = dpTotal / (fl.rho * G);
  const hydraulicPower = Math.max(dpTotal, 0) * Q; // W
  const L = p.sections.reduce((a, s) => a + s.L, 0);
  const checks = commonChecks(fl, secs.map((r, i) => ({ label: p.sections.length > 1 ? `Section ${i + 1}: ` : '', r })), dpLoss, p.dpMax, p.pAbs);
  return { secs, joints, dpF, dpM, dpZ, dpLoss, dpTotal, head, hLoss: dpLoss / (fl.rho * G), hydraulicPower, L, checks };
}
export type SeriesResult = ReturnType<typeof pipeSeries>;

/**
 * Energy line along the pipe: pressure head + elevation above the outlet [m of fluid] at distance x from the inlet.
 * Friction falls linearly along each section, fittings and diameter changes drop at the section end, the pipe rises
 * (or falls) uniformly by dz. Returns polyline points {x, H, z}.
 */
export function energyLine(p: SeriesIn, r: SeriesResult) {
  const rg = p.fluid.rho * G;
  const pts: { x: number; H: number; z: number }[] = [];
  const zIn = -p.dz; // outlet at z = 0
  let cur = r.dpTotal / rg + zIn; // pressure head + elevation at the inlet; falls to 0 at the outlet (velocity head left out)
  let x = 0;
  pts.push({ x, H: cur, z: zIn });
  p.sections.forEach((s, i) => {
    const sr = r.secs[i];
    x += s.L;
    cur -= sr.hF;
    const z = zIn + (r.L > 0 ? (p.dz * x) / r.L : p.dz);
    pts.push({ x, H: cur, z });
    const minor = sr.hM + (i < r.joints.length ? r.joints[i].dp / rg : 0);
    if (minor > 0) { cur -= minor; pts.push({ x, H: cur, z }); }
  });
  return pts;
}

/* ---------- parallel branches ---------- */

export type ParallelIn = { fluid: Fluid; Q: number; branches: Section[]; dpMax: number; pAbs?: number };

/** Flow in one branch for a given pressure drop (bisection on Q; Δp(Q) is increasing). */
export function branchFlow(fl: FluidRho, s: Section, dp: number) {
  if (dp <= 0) return 0;
  const A = (Math.PI / 4) * s.D * s.D;
  let lo = 0, hi = A * Math.sqrt((2 * dp) / (fl.rho * Math.max(s.K, 0.05))) * 5 + 1e-9; // upper bound: no friction, K floor
  while (pipeSection(fl, hi, s).dp < dp) hi *= 2;
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    if (pipeSection(fl, mid, s).dp < dp) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Total flow Q splits so that every branch has the same pressure drop; solved for that Δp by bisection. */
export function pipeParallel(p: ParallelIn) {
  const g = pipeParallelGen(p);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

/** pipeParallel as a generator: yields after every bisection step (≈ 0.2 ms each), for background scans. */
export function* pipeParallelGen(p: ParallelIn) {
  const fl = p.fluid;
  let lo = 0, hi = 1;
  const total = (dp: number) => p.branches.reduce((a, b) => a + branchFlow(fl, b, dp), 0);
  while (total(hi) < p.Q) { hi *= 2; yield; }
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (total(mid) < p.Q) lo = mid; else hi = mid;
    yield;
  }
  const dp = 0.5 * (lo + hi);
  const flows = p.branches.map((b) => branchFlow(fl, b, dp));
  const sum = flows.reduce((a, b) => a + b, 0);
  const scale = sum > 0 ? p.Q / sum : 1; // remove the residual of the bisection
  const q = flows.map((x) => x * scale);
  const secs = p.branches.map((b, i) => pipeSection(fl, q[i], b));
  const checks = commonChecks(fl, secs.map((r, i) => ({ label: `Branch ${i + 1}: `, r })), dp, p.dpMax, p.pAbs);
  return { dp, flows: q, shares: q.map((x) => x / p.Q), secs, checks, head: dp / (fl.rho * G), hydraulicPower: dp * p.Q };
}
export type ParallelResult = ReturnType<typeof pipeParallel>;

/* ---------- texts ---------- */

export const PIPE_INTRO = 'Fluid pushed through a pipe loses pressure to wall friction and to every bend, valve and change of size. The pump or the height of a tank must pay that bill. Blue = high pressure, light = low; the dots move with the real velocity ratio.';

export const PIPE_NOTES = [
  'Incompressible, steady, fully developed flow of a Newtonian fluid. Darcy–Weisbach Δp = f (L/D) ρv²/2 with Colebrook–White for Re ≥ 4000 and f = 64/Re for Re < 2300; in between the factor is blended linearly and flagged as uncertain. Minor losses Δp = K ρv²/2 with typical high-Reynolds K values (Çengel Table 8-4): real K depends on size, Reynolds number and the exact fitting — treat them as ±30 %.',
  'Roughness ε is for new pipe (Çengel Table 8-2); old pipe can be several times rougher. Water density by Tanaka, viscosity by a Vogel fit; oil: ISO VG with Walther–ASTM D341 through the 40/100 °C points, ρ = 870 − 0.65 (T − 15); air: ideal gas, Sutherland viscosity. Air is only treated as incompressible: checks require Ma < 0.3 and Δp < 10 % of the absolute pressure.',
  'Series: sudden diameter changes add K = (1 − A₁/A₂)² on v₁ (expansion) or 0.5 (1 − A₂/A₁) on v₂ (contraction). Parallel: all branches share the same two junctions, so the same Δp; the flow split is found from that condition (junction losses and elevation ignored). The energy line shows the total head above the outlet; the pump must supply it.',
  'Not modelled: pipe wall thickness (D is the inner diameter), pump curves, water hammer, non-Newtonian fluids, cavitation, two-phase flow.',
];
