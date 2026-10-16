/**
 * Chain reaction and control: point reactor kinetics with six delayed-neutron groups, fuel-temperature feedback,
 * control-rod events (step, ramp, scram) and an overpower trip. Power is normalised to the rated power (p = P/P_r);
 * the precursor concentrations c_i in the same units. Equations (prompt generation time Λ):
 *   dp/dt = (ρ − β)/Λ · p + Σ λ_i c_i,   dc_i/dt = β_i/Λ · p − λ_i c_i,
 *   fuel: dθ/dt = (p − θ)/τ_th with θ = (T_f − T_c)/ΔT_r (θ = p in steady state), ρ = ρ_ext + α ΔT_r (θ − θ₀).
 * Integrated implicitly (backward Euler, closed form per step) with a step size that limits the change of p.
 */

/** Six-group delayed-neutron data for thermal fission of U-235 and fast fission of Pu-239 (Keepin 1965, as given
 *  in Lamarsh & Baratta Table 7.5): relative yields a_i = β_i/β and decay constants λ_i [1/s]. */
export const GROUPS = {
  u235: { beta: 0.0065, a: [0.033, 0.219, 0.196, 0.395, 0.115, 0.042], lam: [0.0124, 0.0305, 0.111, 0.301, 1.14, 3.01] },
  pu239: { beta: 0.0021, a: [0.035, 0.298, 0.211, 0.326, 0.086, 0.044], lam: [0.0129, 0.0311, 0.134, 0.331, 1.26, 3.21] },
} as const;
export type Fuel = keyof typeof GROUPS;

export type ReactorId = 'pwr' | 'fast' | 'triga';
/** Typical rounded values: prompt generation time, fuel temperature coefficient, fuel heat-up, rated power,
 *  allowed rise of the fuel temperature, control-bank and scram worth. */
export const REACTORS_K: Record<ReactorId, { name: string; fuel: Fuel; beta: number; Lambda: number; alpha: number; tau: number; dTr: number; Pr: number; dTmax: number; bank: number; scram: number; pulse: boolean }> = {
  pwr: { name: 'Pressurised water reactor', fuel: 'u235', beta: 0.0065, Lambda: 2e-5, alpha: -2.5, tau: 5, dTr: 300, Pr: 3000, dTmax: 900, bank: 1500, scram: -6000, pulse: false },
  fast: { name: 'Sodium fast reactor', fuel: 'pu239', beta: 0.0035, Lambda: 4e-7, alpha: -0.8, tau: 2, dTr: 700, Pr: 1500, dTmax: 600, bank: 800, scram: -3000, pulse: false },
  triga: { name: 'TRIGA research reactor', fuel: 'u235', beta: 0.007, Lambda: 4e-5, alpha: -10, tau: 15, dTr: 300, Pr: 1, dTmax: 800, bank: 3000, scram: -6000, pulse: true },
};

export type Event = 'step' | 'ramp' | 'scram';
export type KinIn = {
  reactor: ReactorId; event: Event;
  rho: number;      // step size or ramp end value [pcm] (step, ramp)
  rate: number;     // ramp rate [pcm/s]
  scram: number;    // scram worth [pcm] (negative)
  p0: number;       // initial power, share of rated
  alpha: number;    // fuel temperature coefficient [pcm/K]
  feedback: boolean;
  trip: boolean;    // overpower trip at 118 % (step, ramp)
  window: number;   // time shown [s]
};

/** Reactivity data of a reactor (β_i = a_i β with the reactor's effective β). */
export function groupsOf(id: ReactorId) {
  const R = REACTORS_K[id], g = GROUPS[R.fuel];
  return { beta: R.beta, b: g.a.map((a) => a * R.beta), lam: [...g.lam], Lambda: R.Lambda };
}

/** Inhour equation ρ = ωΛ + Σ β_i ω/(ω + λ_i): the stable inverse period ω [1/s] for a constant reactivity ρ (absolute,
 *  not pcm). Largest root: ω > 0 for ρ > 0, −λ_min < ω < 0 for ρ < 0. */
export function inhourOmega(rho: number, b: number[], lam: number[], Lambda: number) {
  const f = (w: number) => w * Lambda + b.reduce((s, bi, i) => s + (bi * w) / (w + lam[i]), 0) - rho;
  if (rho === 0) return 0;
  let lo: number, hi: number;
  if (rho > 0) { lo = 0; hi = 1; while (f(hi) < 0) hi *= 2; }
  else { lo = -Math.min(...lam) * (1 - 1e-12); hi = 0; }
  for (let k = 0; k < 200; k++) { const m = (lo + hi) / 2; if (f(m) > 0) hi = m; else lo = m; }
  return (lo + hi) / 2;
}

/** Rod bank S-curve: share of the bank worth released when withdrawn to x (0 = fully in, 1 = fully out). */
export const rodS = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c - Math.sin(2 * Math.PI * c) / (2 * Math.PI); };
/** Inverse of rodS by bisection. */
export function rodX(s: number) { let lo = 0, hi = 1; const t = Math.min(1, Math.max(0, s)); for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (rodS(m) < t) lo = m; else hi = m; } return (lo + hi) / 2; }

/** External reactivity [pcm] of an event at time t (before a trip). */
export function rhoExt(p: KinIn, t: number) {
  if (p.event === 'step') return t >= 0 ? p.rho : 0;
  if (p.event === 'ramp') return Math.sign(p.rho) * Math.min(Math.abs(p.rate) * Math.max(t, 0), Math.abs(p.rho));
  return scramRho(p.scram, t - 1); // scram at t = 1 s
}
/** Scram: rods fall in about 2 s; reactivity follows the S-curve from fully out. */
const DROP = 2;
export const scramRho = (worth: number, ts: number) => (ts <= 0 ? 0 : worth * rodS(Math.min(ts / DROP, 1)));

/** Time history of a transient. */
export function simulate(p: KinIn) {
  const R = REACTORS_K[p.reactor], { beta, b, lam, Lambda } = groupsOf(p.reactor), n = b.length, aT = p.feedback ? p.alpha * 1e-5 * R.dTr : 0;
  let P = p.p0, th = p.p0, t = 0, tripAt = -1, peak = P, tPeak = 0, energy = 0, thMax = th;
  const c = b.map((bi, i) => (bi * P) / (Lambda * lam[i]));
  const T: number[] = [0], Pw: number[] = [P], Th: number[] = [th], Rho: number[] = [0], Rx: number[] = [0], C: number[][] = [c.map((x) => x / (P || 1))];
  const ext = (tt: number) => (tripAt >= 0 && tt >= tripAt + 0.2 ? rhoExt(p, tt) + scramRho(R.scram, tt - tripAt - 0.2) : rhoExt(p, tt)) * 1e-5;
  const tEnd = p.window;
  let dt = Math.min(1e-4, tEnd / 1e4), steps = 0;
  const dtMax = tEnd / 400;
  while (t < tEnd && steps < 200000) {
    steps++;
    const h = Math.min(dt, tEnd - t), t1 = t + h, re = ext(t1);
    let Pn = P, thn = th;
    for (let pass = 0; pass < 2; pass++) {
      const rho = re + aT * (thn - p.p0);
      let A = 1 - (h * (rho - beta)) / Lambda, B = P;
      for (let i = 0; i < n; i++) { const d = 1 + h * lam[i]; A -= (h * lam[i] * h * b[i]) / (Lambda * d); B += (h * lam[i] * c[i]) / d; }
      Pn = Math.max(B / A, 0);
      thn = (th + (h * Pn) / R.tau) / (1 + h / R.tau);
    }
    for (let i = 0; i < n; i++) c[i] = (c[i] + (h * b[i] * Pn) / Lambda) / (1 + h * lam[i]);
    energy += 0.5 * (P + Pn) * h;
    const rel = Math.abs(Pn - P) / Math.max(P, Pn, 1e-30);
    P = Pn; th = thn; t = t1;
    if (P > peak) { peak = P; tPeak = t; }
    thMax = Math.max(thMax, th);
    if (p.trip && p.event !== 'scram' && !R.pulse && tripAt < 0 && P >= 1.18) tripAt = t;
    const last = T[T.length - 1];
    if (t - last >= tEnd / 600 || rel > 0.05 || t >= tEnd) {
      const rhoNow = re + aT * (th - p.p0);
      T.push(t); Pw.push(P); Th.push(th); Rho.push(rhoNow * 1e5); Rx.push(re * 1e5); C.push(c.map((x, i) => x / ((b[i] * Math.max(p.p0, 1e-30)) / (Lambda * lam[i]))));
    }
    dt = Math.min(dtMax, Math.max(1e-7, h * (rel > 0 ? Math.min(2, Math.max(0.5, 0.01 / rel)) : 2)));
  }
  return { t: T, p: Pw, th: Th, rho: Rho, rhoExt: Rx, c: C, tripAt, peak, tPeak, energy, thMax, final: P, finalTh: th };
}
export type KinSim = ReturnType<typeof simulate>;

/** Bank positions (share withdrawn: 0 = fully in) and the interpolated state at time tt, for the drawings.
 *  The control bank starts 60 % out and moves with the event's reactivity; the shutdown bank waits fully out and
 *  falls on a scram or trip. */
export const BANK0 = 0.6;
export function stateAt(p: KinIn, s: KinSim, tt: number) {
  const R = REACTORS_K[p.reactor], t = s.t;
  let lo = 0, hi = t.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= tt) lo = m; else hi = m; }
  const w = t[hi] > t[lo] ? Math.min(1, Math.max(0, (tt - t[lo]) / (t[hi] - t[lo]))) : 0, L = (a: number[]) => a[lo] + w * (a[hi] - a[lo]);
  const ctrl = p.event === 'scram' ? BANK0 : rodX(rodS(BANK0) + rhoExt(p, tt) / R.bank);
  const ts = p.event === 'scram' ? tt - 1 : s.tripAt >= 0 ? tt - s.tripAt - 0.2 : -1;
  const shut = ts <= 0 ? 1 : 1 - Math.min(ts / DROP, 1) ** 2;
  const lp = (x: number) => Math.log(Math.max(x, 1e-12));
  return { P: Math.exp(lp(s.p[lo]) + w * (lp(s.p[hi]) - lp(s.p[lo]))), th: L(s.th), c: s.c[lo].map((x, i) => x + w * (s.c[hi][i] - x)), ctrl, shut, rho: L(s.rho) };
}

export function kinetics(p: KinIn) {
  const R = REACTORS_K[p.reactor], g = groupsOf(p.reactor), beta = g.beta;
  const rhoMax = p.event === 'scram' ? p.scram : p.rho, rhoA = rhoMax * 1e-5, dollars = rhoA / beta;
  const omega = inhourOmega(rhoA, g.b, g.lam, g.Lambda), period = omega !== 0 ? 1 / omega : Infinity;
  const promptJump = rhoA < beta ? beta / (beta - rhoA) : Infinity;
  const promptOnly = rhoA !== 0 ? g.Lambda / rhoA : Infinity; // period if every neutron were prompt
  const keff = 1 / (1 - rhoA), meanLife = g.Lambda + g.b.reduce((s, bi, i) => s + bi / g.lam[i], 0); // effective generation time with delayed neutrons
  const sim = simulate(p);
  // steady power after feedback balances the inserted reactivity (no trip)
  const pFinalEq = p.feedback && p.alpha < 0 && p.event !== 'scram' ? p.p0 - (rhoMax * 1e-5) / (p.alpha * 1e-5 * R.dTr) : NaN;
  const dTrise = (sim.thMax - p.p0) * R.dTr;
  const checks: { ok: boolean; label: string; detail: string }[] = [];
  if (p.event !== 'scram') {
    if (!R.pulse) checks.push({ ok: rhoA < beta, label: 'Below prompt critical (ρ < β, $1)', detail: `ρ = $${dollars.toFixed(2)} (${rhoMax.toFixed(0)} pcm), β = ${(beta * 1e5).toFixed(0)} pcm` });
    if (rhoMax > 0 && !R.pulse) checks.push({ ok: period >= 20, label: 'Reactor period ≥ 20 s (operating limit)', detail: `T = ${Number.isFinite(period) ? period.toFixed(period < 1 ? 3 : 1) : '∞'} s` });
    checks.push({ ok: R.pulse || sim.tripAt < 0 && sim.peak < 1.18, label: R.pulse ? 'Pulse within the fuel limit' : 'Power stays below the trip setpoint (118 %)', detail: R.pulse ? `peak ${(sim.peak * R.Pr).toFixed(0)} MW` : sim.tripAt >= 0 ? `trip at t = ${sim.tripAt.toFixed(2)} s, peak ${(100 * sim.peak).toFixed(0)} %` : `peak ${(100 * sim.peak).toFixed(1)} %` });
  } else {
    checks.push({ ok: p.scram <= -1300, label: 'Shutdown margin: scram worth ≥ 1300 pcm', detail: `${(-p.scram).toFixed(0)} pcm = $${(-p.scram * 1e-5 / beta).toFixed(1)}` });
    const i10 = sim.t.findIndex((x) => x >= 11);
    checks.push({ ok: i10 >= 0 && sim.p[i10] < 0.1 * p.p0, label: 'Fission power below 10 % ten seconds after the scram', detail: i10 >= 0 ? `${(100 * sim.p[i10] / p.p0).toFixed(1)} % of the initial power` : 'window too short' });
  }
  checks.push({ ok: dTrise <= R.dTmax, label: `Fuel temperature rise ≤ ${R.dTmax} K`, detail: `${dTrise.toFixed(0)} K above the start` });
  return { R, g, beta, rhoMax, dollars, omega, period, promptJump, promptOnly, keff, meanLife, sim, pFinalEq, dTrise, checks };
}
export type KinResult = ReturnType<typeof kinetics>;

export const KIN_INTRO = 'A chain reaction runs steady when each fission causes exactly one more: k = 1. Push k a little above 1 and the neutron population grows — but how fast? Prompt neutrons appear within 10⁻⁵ s, yet about 0.65 % of the neutrons from uranium come seconds later from decaying fission products. These few delayed neutrons slow every change down to a pace that control rods and operators can follow. Pull or drop the rods and watch the power, the reactor period and the fuel temperature that pushes back.';
export const KIN_NOTES = [
  'Point kinetics: the whole core behaves as one neutron population (no spatial effects), six delayed-neutron groups with Keepin\'s yields and decay constants (U-235 thermal, Pu-239 fast), the reactor\'s effective delayed fraction β_eff and prompt generation time Λ as typical rounded values. Integrated implicitly (backward Euler with an adaptive step); tests compare the stable period with the inhour equation and the prompt jump with β/(β − ρ).',
  'Feedback: one lumped fuel temperature with a heat-up time constant τ_th and a fuel temperature (Doppler) coefficient; moderator, coolant, void and xenon effects are not modelled, so slow transients over many minutes are indicative only.',
  'Control rods: one bank with an S-shaped worth curve; a scram drops all rods in about 2 s starting 1 s into the run (the trip adds 0.2 s delay). Fission power only — after shutdown about 6 % of the rated power remains as decay heat from fission products for minutes (see Fission reactors).',
  'Reactivity ρ = (k − 1)/k, shown in pcm (10⁻⁵) and in dollars ($1 = β). Above $1 the reactor is prompt critical: it multiplies on prompt neutrons alone and the power rises in milliseconds — only pulsing reactors like TRIGA, with a very fast negative fuel coefficient, are built for that.',
];
