/**
 * Liquid rocket engine, ideal rocket theory (Sutton & Biblarz ch. 3): one-dimensional isentropic nozzle flow of a
 * perfect gas with constant isentropic exponent k, using NASA CEA chamber temperature, molar mass and k
 * (shifting equilibrium) for the chosen propellant, chamber pressure and mixture ratio.
 */
import { CEA, CEA_EPS, CEA_PC, type CeaTable } from './ceaTables.ts';
import { isa } from './ramjet.ts';

export const G0 = 9.80665, RU = 8314.46;

export const ENGINE_PROPS = [
  { id: 'kerolox', name: 'Kerosene / LOX', mr0: 2.6, lstar: 1.1, flame: '#FF9A3C' },
  { id: 'methalox', name: 'Methane / LOX', mr0: 3.4, lstar: 1.0, flame: '#8FB7FF' },
  { id: 'hydrolox', name: 'Hydrogen / LOX', mr0: 6.0, lstar: 0.9, flame: '#C9DCFF' },
  { id: 'hypergolic', name: 'Hypergolic (MMH / NTO)', mr0: 2.0, lstar: 0.8, flame: '#FFC870' },
] as const;
export type EngineProp = (typeof ENGINE_PROPS)[number]['id'];
export const table = (id: EngineProp) => CEA.find((t) => t.id === id)!;
export const mrRange = (id: EngineProp) => { const m = table(id).mr; return [m[0], m[m.length - 1]] as const; };

/** Bilinear interpolation in a CEA table (log of chamber pressure × mixture ratio), clamped to the grid. */
function bilin(tb: CeaTable, q: number[][], pcBar: number, mr: number) {
  const lp = Math.log(Math.min(Math.max(pcBar, CEA_PC[0]), CEA_PC[CEA_PC.length - 1]));
  const m = Math.min(Math.max(mr, tb.mr[0]), tb.mr[tb.mr.length - 1]);
  let i = 0; while (i < CEA_PC.length - 2 && lp > Math.log(CEA_PC[i + 1])) i++;
  let j = 0; while (j < tb.mr.length - 2 && m > tb.mr[j + 1]) j++;
  const u = (lp - Math.log(CEA_PC[i])) / (Math.log(CEA_PC[i + 1]) - Math.log(CEA_PC[i])), v = (m - tb.mr[j]) / (tb.mr[j + 1] - tb.mr[j]);
  return (1 - u) * (1 - v) * q[i][j] + u * (1 - v) * q[i + 1][j] + (1 - u) * v * q[i][j + 1] + u * v * q[i + 1][j + 1];
}

/** Chamber gas from CEA at p_c [Pa] and O/F. */
export function chamberGas(prop: EngineProp, pc: number, mr: number) {
  const tb = table(prop), pb = pc / 1e5;
  const ispVac = (eps: number) => { // CEA shifting-equilibrium vacuum I_sp at ε (log-interpolated in ε), reference only
    const le = Math.log(Math.min(Math.max(eps, CEA_EPS[0]), CEA_EPS[CEA_EPS.length - 1]));
    let k = 0; while (k < CEA_EPS.length - 2 && le > Math.log(CEA_EPS[k + 1])) k++;
    const w = (le - Math.log(CEA_EPS[k])) / (Math.log(CEA_EPS[k + 1]) - Math.log(CEA_EPS[k]));
    const at = (kk: number) => bilin(tb, tb.ispVac.map((row) => row.map((c) => c[kk])), pb, mr);
    return (1 - w) * at(k) + w * at(k + 1);
  };
  return { Tc: bilin(tb, tb.Tc, pb, mr), M: bilin(tb, tb.M, pb, mr), k: bilin(tb, tb.k, pb, mr), cstarCEA: bilin(tb, tb.cstar, pb, mr), mu: bilin(tb, tb.mu, pb, mr), cp: bilin(tb, tb.cp, pb, mr), pr: bilin(tb, tb.pr, pb, mr), ispVacCEA: ispVac };
}

export const gammaFn = (k: number) => Math.sqrt(k) * Math.pow(2 / (k + 1), (k + 1) / (2 * (k - 1)));
/** A/A* of isentropic flow at Mach M. */
export const areaRatio = (M: number, k: number) => (1 / M) * Math.pow((2 / (k + 1)) * (1 + ((k - 1) / 2) * M * M), (k + 1) / (2 * (k - 1)));
/** Supersonic Mach number for an area ratio ε ≥ 1 (bisection). */
export function machFromArea(eps: number, k: number) {
  let lo = 1, hi = 2;
  while (areaRatio(hi, k) < eps) hi *= 2;
  for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (areaRatio(m, k) < eps) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
/** Subsonic Mach number for an area ratio ε ≥ 1 (bisection). */
export function machFromAreaSub(eps: number, k: number) {
  let lo = 1e-6, hi = 1;
  for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (areaRatio(m, k) > eps) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
export const pRatio = (M: number, k: number) => Math.pow(1 + ((k - 1) / 2) * M * M, -k / (k - 1)); // p/p_c
/** Ideal exhaust velocity for a pressure ratio p_e/p_c (Sutton eq. 3-16). */
export const exhaustVelocity = (k: number, R: number, Tc: number, pe_pc: number) => Math.sqrt(((2 * k) / (k - 1)) * R * Tc * (1 - Math.pow(pe_pc, (k - 1) / k)));
/** Thrust coefficient (Sutton eq. 3-30). */
export const thrustCoef = (k: number, eps: number, pc_pa: number) => {
  const pe_pc = pRatio(machFromArea(eps, k), k);
  return gammaFn(k) * Math.sqrt(((2 * k) / (k - 1)) * (1 - Math.pow(pe_pc, (k - 1) / k))) + (pe_pc - (pc_pa > 0 ? 1 / pc_pa : 0)) * eps;
};
/** Area ratio whose exit pressure equals the ambient (optimum expansion) for p_c/p_a. */
export const optimumEps = (k: number, pc_pa: number) => {
  const Me = Math.sqrt((2 / (k - 1)) * (Math.pow(pc_pa, (k - 1) / k) - 1));
  return areaRatio(Me, k);
};

export type EngineIn = { prop: EngineProp; pc: number /* Pa */; mr: number; eps: number; Dt: number /* m */; alt: number /* m */ };
type Check = { ok: boolean; label: string; detail: string };

/** Schmucker criterion: an over-expanded nozzle separates when p_e < p_a·(1.88 M_e − 1)^(−0.64) (≈ 0.25 to 0.4 p_a). */
export const sepRatio = (Me: number) => Math.pow(Math.max(1.88 * Me - 1, 1), -0.64);
/** Bartz throat heat flux limit used for the check: about the highest flown (Space Shuttle main engine). */
export const QMAX = 160e6;

export function engine(p: EngineIn) {
  const g = chamberGas(p.prop, p.pc, p.mr), k = g.k, R = RU / g.M;
  const G = gammaFn(k), cstar = Math.sqrt(R * g.Tc) / G;
  const At = (Math.PI * p.Dt * p.Dt) / 4, Ae = At * p.eps;
  const mdot = (p.pc * At) / cstar;
  // throat (M = 1) and exit
  const Tt = (2 * g.Tc) / (k + 1), pt = p.pc * Math.pow(2 / (k + 1), k / (k - 1)), vt = Math.sqrt(k * R * Tt);
  const Me = machFromArea(p.eps, k), pe_pc = pRatio(Me, k), pe = p.pc * pe_pc, Te = g.Tc / (1 + ((k - 1) / 2) * Me * Me);
  const ve = exhaustVelocity(k, R, g.Tc, pe_pc);
  const pa = isa(p.alt).p;
  const CFv = G * Math.sqrt(((2 * k) / (k - 1)) * (1 - Math.pow(pe_pc, (k - 1) / k))) + pe_pc * p.eps;
  const CF = CFv - (pa / p.pc) * p.eps;
  const F = CF * p.pc * At, Fvac = CFv * p.pc * At, Fsl = (CFv - (101325 / p.pc) * p.eps) * p.pc * At;
  const Isp = F / (mdot * G0), IspVac = Fvac / (mdot * G0), IspSl = Fsl / (mdot * G0);
  const epsOpt = pa > 0 ? optimumEps(k, p.pc / pa) : Infinity;
  const pSep = sepRatio(Me) * pa, separated = pe < pSep;
  // Bartz (Sutton eq. 8-23 with σ = 1, throat radius of curvature 1.5 R_t): frozen chamber transport properties
  const rc = 0.75 * p.Dt;
  const hg = (0.026 / Math.pow(p.Dt, 0.2)) * ((Math.pow(g.mu, 0.2) * g.cp) / Math.pow(g.pr, 0.6)) * Math.pow(p.pc / cstar, 0.8) * Math.pow(p.Dt / rc, 0.1);
  const recov = Math.pow(g.pr, 1 / 3), Taw = (g.Tc * (1 + recov * ((k - 1) / 2))) / (1 + (k - 1) / 2), Twall = 800;
  const qt = hg * (Taw - Twall);
  const state = separated ? 'separated' : pa <= 0 || pe > 1.02 * pa ? 'under' : pe < 0.98 * pa ? 'over' : 'optimum';
  const checks: Check[] = [
    { ok: !separated, label: 'No flow separation in the nozzle (Schmucker)', detail: `p_e ${(pe / 1000).toFixed(1)} kPa, separation below ${(pSep / 1000).toFixed(1)} kPa` },
    { ok: qt <= QMAX, label: 'Throat heat flux within flown practice (Bartz ≤ 160 MW/m²)', detail: `q ≈ ${(qt / 1e6).toFixed(0)} MW/m² with a 800 K wall` },
    { ok: F > 0, label: 'Positive thrust at this altitude', detail: `F ${(F / 1000).toFixed(1)} kN` },
  ];
  return {
    gas: g, k, R, G, cstar, At, Ae, mdot, Tt, pt, vt, Me, pe, pe_pc, Te, ve, pa, CF, CFv, F, Fvac, Fsl, Isp, IspVac, IspSl,
    epsOpt, pSep, separated, state, hg, Taw, Twall, qt, mdotOx: (mdot * p.mr) / (1 + p.mr), mdotF: mdot / (1 + p.mr), checks,
  };
}
export type EngineResult = ReturnType<typeof engine>;

/** Thrust and I_sp from sea level to 100 km for this engine, and the I_sp of an ideally adapted nozzle (p_e = p_a) at each altitude. */
export function altitudeSweep(p: EngineIn, n = 60) {
  return Array.from({ length: n + 1 }, (_, i) => {
    const alt = (i / n) * 100000, r = engine({ ...p, alt });
    const pc_pa = p.pc / r.pa;
    const adapted = (r.cstar * gammaFn(r.k) * Math.sqrt(((2 * r.k) / (r.k - 1)) * (1 - Math.pow(1 / pc_pa, (r.k - 1) / r.k)))) / G0;
    return { alt, F: r.F, Isp: r.Isp, adapted, separated: r.separated };
  });
}

/**
 * Chamber and bell for the drawings [m, axial x from injector face, r]: contraction ratio 3, L* of the propellant,
 * 30° converging cone, throat arcs 1.5 R_t upstream / 0.382 R_t downstream, 80 % Rao bell as a quadratic Bézier.
 */
export function engineGeometry(prop: EngineProp, Dt: number, eps: number) {
  const Rt = Dt / 2, Rc = Rt * Math.sqrt(3), Re = Rt * Math.sqrt(eps);
  const lstar = ENGINE_PROPS.find((x) => x.id === prop)!.lstar;
  const conv = 30 * (Math.PI / 180);
  const rT = Rt + 1.5 * Rt * (1 - Math.cos(conv)); // where the cone meets the upstream throat arc
  const Lconv = (Rc - rT) / Math.tan(conv) + 1.5 * Rt * Math.sin(conv);
  const Vc = lstar * Math.PI * Rt * Rt, Vconv = (Math.PI / 3) * Lconv * (Rc * Rc + Rc * Rt + Rt * Rt);
  const Lcyl = Math.max(0.6 * Rc, (Vc - Vconv) / (Math.PI * Rc * Rc));
  const le = Math.log(Math.min(Math.max(eps, 4), 200));
  const thN = (21 + 3.3 * le) * (Math.PI / 180), thE = Math.max(4, 14 - 1.6 * le) * (Math.PI / 180); // Rao 80 % bell angles (fit)
  const Ln = (0.8 * (Math.sqrt(eps) - 1) * Rt) / Math.tan(15 * (Math.PI / 180));
  const xt = Lcyl + Lconv;
  const pts: [number, number][] = [[0, Rc], [Lcyl, Rc]];
  // straight 30° cone, then the upstream throat arc (radius 1.5 R_t)
  for (let i = 0; i <= 8; i++) { const a = -conv + (i / 8) * conv; pts.push([xt + 1.5 * Rt * Math.sin(a), Rt + 1.5 * Rt * (1 - Math.cos(a))]); }
  const xN = xt + 0.382 * Rt * Math.sin(thN), rN = Rt + 0.382 * Rt * (1 - Math.cos(thN));
  for (let i = 1; i <= 6; i++) { const a = (i / 6) * thN; pts.push([xt + 0.382 * Rt * Math.sin(a), Rt + 0.382 * Rt * (1 - Math.cos(a))]); }
  // Bézier from N (angle θ_n) to E (angle θ_e)
  const xE = xt + Ln, rE = Re;
  const m1 = Math.tan(thN), m2 = Math.tan(thE), c1 = rN - m1 * xN, c2 = rE - m2 * xE;
  const xQ = (c2 - c1) / (m1 - m2), rQ = m1 * xQ + c1;
  for (let i = 1; i <= 24; i++) { const t = i / 24; pts.push([(1 - t) ** 2 * xN + 2 * t * (1 - t) * xQ + t * t * xE, (1 - t) ** 2 * rN + 2 * t * (1 - t) * rQ + t * t * rE]); }
  return { pts, Rc, Rt, Re, Lcyl, xt, xE, L: xE };
}

/** Mach, temperature, velocity and p/p_c along the contour (subsonic before the throat, supersonic after). */
export function flowAlong(geo: ReturnType<typeof engineGeometry>, k: number, R: number, Tc: number) {
  return geo.pts.map(([x, r]) => {
    const e = Math.max((r / geo.Rt) ** 2, 1 + 1e-9);
    const M = x < geo.xt - 1e-12 ? machFromAreaSub(e, k) : machFromArea(e, k);
    const T = Tc / (1 + ((k - 1) / 2) * M * M);
    return { x, r, M, T, v: M * Math.sqrt(k * R * T), p: pRatio(M, k) };
  });
}

export const ENGINE_INTRO =
  'Fuel and oxidizer burn in the chamber at high pressure; the hot gas speeds up to the speed of sound in the narrow throat and keeps accelerating in the widening bell. A bigger bell turns more heat into speed, but at low altitude the outside air pushes back: the exhaust pinches in (over-expanded) and can tear off the wall. High up it spreads wide (under-expanded).';

export const ENGINE_NOTES = [
  'Ideal rocket (Sutton & Biblarz ch. 3): steady one-dimensional isentropic flow of a perfect gas with one isentropic exponent k from injector to exit, no friction, no heat loss, no divergence loss. Chamber temperature, molar mass and k come from NASA CEA (shifting equilibrium, via RocketCEA) interpolated in chamber pressure and mixture ratio; at the usual mixture ratios this one-k model gives vacuum I_sp within about 1 % of CEA for kerosene and methane, 3 % for hydrogen and 4 % for the hypergolic pair (too high), up to about 6 % at extreme mixture ratios; the CEA value is shown for comparison. Real engines reach about 92 to 98 % of these values.',
  'Ambient pressure from the US Standard Atmosphere 1976. Flow separation by the Schmucker criterion p_e < p_a·(1.88 M_e − 1)^(−0.64), about 0.25 to 0.4 p_a (the older Summerfield rule says 0.4); when it separates the thrust shown is not valid (a separated nozzle actually loses less, but the side loads can break it). Throat heat flux by the Bartz equation with σ = 1, frozen chamber transport properties from CEA, throat curvature radius 1.5 R_t and an 800 K hot wall; the 160 MW/m² limit is about the Space Shuttle main engine level.',
  'Drawing: contraction ratio 3, characteristic length L* typical of the propellant, 30° converging cone and an 80 % Rao bell drawn as a parabola with fitted start and exit angles. Validation: the exhaust velocity reproduces Braeunig, Rocket and Space Technology, Problem 1.5 (LOX/kerosene, 50 atm to 1 atm, v_e = 2749 m/s). Concept level.',
];
