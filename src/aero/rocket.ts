/**
 * Rocket equation (Tsiolkovsky) for a single stage or a stack of 2–3 stages in series (tandem staging),
 * burn profile at constant thrust, and optimal staging by the Lagrange-multiplier method
 * (minimum lift-off mass for a required Δv; Curtis, Orbital Mechanics for Engineering Students, § 11.6).
 */
export const G0 = 9.80665;

/** Propellant presets: vacuum-ish average I_sp [s] and bulk density of the propellant load [kg/m³] (sets tank size in the drawing). */
export const PROPELLANTS = [
  { id: 'solid', name: 'Solid (APCP)', isp: 265, rho: 1750, flame: '#FFB347' },
  { id: 'kerolox', name: 'Kerosene / LOX', isp: 311, rho: 1030, flame: '#FF9A3C' },
  { id: 'methalox', name: 'Methane / LOX', isp: 340, rho: 830, flame: '#8FB7FF' },
  { id: 'hypergolic', name: 'Hypergolic (MMH / NTO)', isp: 320, rho: 1180, flame: '#FFC870' },
  { id: 'hydrolox', name: 'Hydrogen / LOX', isp: 450, rho: 360, flame: '#B9D4FF' },
] as const;
export type PropId = (typeof PROPELLANTS)[number]['id'];

/** Typical mission Δv budgets [km/s] (launch figures include gravity and drag losses). */
export const TARGETS = [
  { id: 'sub', name: 'Suborbital, 100 km', dv: 2.0 },
  { id: 'leo', name: 'Low Earth orbit', dv: 9.4 },
  { id: 'gto', name: 'LEO → GTO', dv: 2.44 },
  { id: 'moon', name: 'LEO → Moon', dv: 3.15 },
  { id: 'esc', name: 'LEO → escape', dv: 3.22 },
  { id: 'mars', name: 'LEO → Mars', dv: 3.6 },
] as const;

/** One stage: propellant id, I_sp [s], propellant mass m_p [kg], structural fraction ε = m_s/(m_s + m_p). */
export type Stage = { prop: PropId; isp: number; mp: number; eps: number };
export type RocketIn = { stages: Stage[]; payload: number; tw: number; target: number /* m/s */ };

export type StageResult = {
  ve: number; mp: number; ms: number; m0: number; mf: number; above: number; R: number; dv: number;
  F: number; mdot: number; tb: number; lambda: number; dvMax: number; vol: number;
};
type Check = { ok: boolean; label: string; detail: string };
export type RocketResult = {
  stages: StageResult[]; m0: number; dv: number; payloadFrac: number; tb: number; gravLoss: number; checks: Check[];
};

export const structMass = (mp: number, eps: number) => (mp * eps) / (1 - eps);
export const tsiolkovsky = (ve: number, m0: number, mf: number) => ve * Math.log(m0 / mf);

/**
 * Stage 1 is the bottom stage. m₀,i = payload + all stages i…n; m_f,i = m₀,i − m_p,i; Δv_i = v_e,i ln(m₀,i/m_f,i).
 * Each stage ignites with thrust F_i = (T/W)·m₀,i·g₀ and burns at constant ṁ_i = F_i/v_e,i.
 */
export function rocket(p: RocketIn): RocketResult {
  const n = p.stages.length;
  const rs: StageResult[] = new Array(n);
  let above = p.payload;
  for (let i = n - 1; i >= 0; i--) {
    const s = p.stages[i], ve = s.isp * G0, ms = structMass(s.mp, s.eps);
    const m0 = above + s.mp + ms, mf = m0 - s.mp, F = p.tw * m0 * G0, mdot = F / ve;
    const rho = PROPELLANTS.find((x) => x.id === s.prop)?.rho ?? 1000;
    rs[i] = {
      ve, mp: s.mp, ms, m0, mf, above, R: m0 / mf, dv: tsiolkovsky(ve, m0, mf), F, mdot, tb: s.mp / mdot,
      lambda: above / (s.mp + ms), dvMax: ve * Math.log(1 / s.eps), vol: s.mp / rho,
    };
    above = m0;
  }
  const m0 = rs[0].m0, dv = rs.reduce((a, s) => a + s.dv, 0), tb = rs.reduce((a, s) => a + s.tb, 0);
  const minEps = Math.min(...p.stages.map((s) => s.eps));
  const checks: Check[] = [
    { ok: dv >= p.target, label: 'Δv reaches the mission target', detail: `Δv ${(dv / 1000).toFixed(2)} km/s, target ${(p.target / 1000).toFixed(2)} km/s` },
    { ok: minEps >= 0.04, label: 'Structural fraction achievable (ε ≥ 4 %)', detail: `smallest ε ${(minEps * 100).toFixed(1)} % — the best flown stages reach about 4 to 6 %` },
    { ok: p.tw > 1, label: 'Lifts off: thrust above weight (T/W > 1)', detail: `T/W ${p.tw.toFixed(2)} at ignition` },
  ];
  return { stages: rs, m0, dv, payloadFrac: p.payload / m0, tb, gravLoss: G0 * tb, checks };
}

/** Flight history sampled at constant thrust: ideal speed (no gravity, no drag), speed in vertical flight under g₀, mass. */
export function burnProfile(r: RocketResult, nPer = 60) {
  const t: number[] = [], v: number[] = [], vg: number[] = [], m: number[] = [], stage: number[] = [];
  let t0 = 0, v0 = 0;
  r.stages.forEach((s, i) => {
    for (let k = 0; k <= nPer; k++) {
      const tt = (k / nPer) * s.tb, mm = s.m0 - s.mdot * tt;
      t.push(t0 + tt); m.push(mm); stage.push(i);
      const vv = v0 + s.ve * Math.log(s.m0 / mm);
      v.push(vv); vg.push(vv - G0 * (t0 + tt));
    }
    t0 += s.tb; v0 += s.dv;
  });
  return { t, v, vg, m, stage };
}

/**
 * Optimal staging (Lagrange multiplier η): stage mass ratios n_i = (v_e,i η − 1)/(v_e,i ε_i η) with
 * Σ v_e,i ln n_i = Δv, solved for η by bisection; then stage masses from the top down,
 * m_i = (n_i − 1)/(1 − n_i ε_i)·(payload + stages above). Null when the target is beyond Σ v_e,i ln(1/ε_i).
 */
export function optimalStaging(ve: number[], eps: number[], dv: number, payload: number) {
  const dvOf = (eta: number) => ve.reduce((a, v, i) => a + v * Math.log((v * eta - 1) / (v * eps[i] * eta)), 0);
  const dvLim = ve.reduce((a, v, i) => a + v * Math.log(1 / eps[i]), 0);
  if (dv >= dvLim * 0.999) return null;
  // n_i ≥ 1 for every stage needs η ≥ 1/(v_e,i (1 − ε_i))
  let lo = Math.max(...ve.map((v, i) => 1 / (v * (1 - eps[i])))) * (1 + 1e-12), hi = lo * 2;
  if (dvOf(lo) > dv) return null; // a stage would get a mass ratio below 1: drop a stage
  while (dvOf(hi) < dv) hi *= 2;
  for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; if (dvOf(mid) < dv) lo = mid; else hi = mid; }
  const eta = (lo + hi) / 2;
  const n = ve.map((v, i) => (v * eta - 1) / (v * eps[i] * eta));
  const N = ve.length, m = new Array<number>(N), mp = new Array<number>(N), ms = new Array<number>(N);
  let above = payload;
  for (let i = N - 1; i >= 0; i--) {
    m[i] = ((n[i] - 1) / (1 - n[i] * eps[i])) * above;
    ms[i] = eps[i] * m[i]; mp[i] = m[i] - ms[i];
    above += m[i];
  }
  return { eta, n, m, mp, ms, m0: above };
}

export const ROCKET_INTRO: Record<'single' | 'multi', string> = {
  single:
    'A rocket pushes itself by throwing mass backwards. Tsiolkovsky’s equation says the speed it can gain depends only on how fast the exhaust leaves (I_sp) and on the mass ratio, full against empty: Δv = v_e ln(m₀/m_f). Because the tank and engines must be carried to the end, one stage has a hard limit, v_e ln(1/ε), however much propellant it holds.',
  multi:
    'Staging drops empty tanks and engines on the way, so each upper stage starts light and the mass ratios multiply. The total Δv is the sum of the stages’ Δv. Watch the stages burn out and fall away; the folded sections show the burn over time and the lightest split of stages for the target.',
};

export const ROCKET_NOTES = [
  'Ideal rocket equation: constant effective exhaust velocity v_e = I_sp·g₀ per stage, no drag, no gravity and no steering losses in Δv. Mission targets are typical budgets; the launch figures already include about 1.5 to 2 km/s of gravity and drag losses.',
  'Stage masses: structure m_s = ε·m_p/(1 − ε), where ε covers tanks, engines, interstage and avionics of that stage. Each stage ignites with the same thrust-to-weight ratio and burns at constant thrust; real upper stages often start at T/W 0.5 to 1. The vertical-flight curve subtracts g₀·t from the ideal speed, an upper bound of gravity loss (a launcher turns horizontal and loses less).',
  'Optimal staging by the Lagrange-multiplier method (Curtis, Orbital Mechanics for Engineering Students, § 11.6): minimum lift-off mass for the target Δv with the stages’ I_sp and ε held fixed. Propellant I_sp values are rounded averages between sea level and vacuum; tank sizes in the drawing use a typical bulk density of the propellant load. Concept level: not checked against a published worked example yet.',
];
