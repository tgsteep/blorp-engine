/**
 * PID control of a linear plant: step response (RK4 time simulation), loop frequency response with gain and phase margins,
 * and classical tuning rules (Ziegler–Nichols reaction curve and ultimate gain, Cohen–Coon).
 * All times in s, frequencies in rad/s. Responses are for a unit setpoint step (or a unit load step on the plant input).
 */

export type PlantId = 'first' | 'second' | 'integrator' | 'motor';
export type PlantSpec = {
  id: PlantId;
  K: number; // first order / integrator gain; second order DC gain
  tau: number; // first order time constant [s]
  wn: number; // second order natural frequency [rad/s]
  zeta: number; // second order damping ratio
  Rm: number; Lm: number; J: number; b: number; Kt: number; // DC motor: R [Ω], L [H], J [kg·m²], b [N·m·s], Kt = Ke [N·m/A = V·s/rad]
  thetaRatio: number; // dead time as a multiple of the plant time scale T₀
};

/** Plant G(s) = K e^(−θ s) / (a₂ s² + a₁ s + a₀). */
export type PlantTF = {
  K: number; a0: number; a1: number; a2: number; theta: number;
  T0: number; // slowest time scale of the plant (without dead time) [s]
  Tfast: number; // fastest time scale [s]
  poles: [number, number][]; // [re, im]
  dc: number; // steady-state gain K/a₀ (∞ for an integrator)
};

export type CtrlType = 'P' | 'PI' | 'PID';
/** C(s) = Kp (1 + 1/(Ti s) + Td s/(1 + Td s/N)). */
export type Ctrl = { type: CtrlType; Kp: number; Ti: number; Td: number; N: number };
export const useI = (c: Ctrl) => c.type !== 'P';
export const useD = (c: Ctrl) => c.type === 'PID';

export const PLANT_DEFAULTS: Record<PlantId, { spec: PlantSpec; ctrl: Ctrl; tLimit: number }> = (() => {
  const base: PlantSpec = { id: 'first', K: 2, tau: 5, wn: 2, zeta: 0.4, Rm: 1, Lm: 0.001, J: 0.005, b: 0.001, Kt: 0.1, thetaRatio: 0.2 };
  return {
    first: { spec: { ...base, id: 'first' }, ctrl: { type: 'PI', Kp: 1.2, Ti: 5, Td: 1, N: 10 }, tLimit: 25 },
    second: { spec: { ...base, id: 'second', K: 1, thetaRatio: 0 }, ctrl: { type: 'PID', Kp: 3, Ti: 1, Td: 0.2, N: 10 }, tLimit: 8 },
    integrator: { spec: { ...base, id: 'integrator', K: 0.5, thetaRatio: 0.25 }, ctrl: { type: 'PI', Kp: 1.2, Ti: 12, Td: 1, N: 10 }, tLimit: 40 },
    motor: { spec: { ...base, id: 'motor', thetaRatio: 0 }, ctrl: { type: 'PI', Kp: 0.2, Ti: 0.5, Td: 0.05, N: 10 }, tLimit: 3 },
  };
})();

export function plantTF(s: PlantSpec): PlantTF {
  let K: number, a0: number, a1: number, a2: number;
  if (s.id === 'first') { K = s.K; a0 = 1; a1 = s.tau; a2 = 0; }
  else if (s.id === 'second') { K = s.K; a0 = 1; a1 = (2 * s.zeta) / s.wn; a2 = 1 / (s.wn * s.wn); }
  else if (s.id === 'integrator') { K = s.K; a0 = 0; a1 = 1; a2 = 0; }
  else { K = s.Kt; a0 = s.b * s.Rm + s.Kt * s.Kt; a1 = s.J * s.Rm + s.b * s.Lm; a2 = s.J * s.Lm; }
  const poles: [number, number][] = [];
  if (a2 > 0) {
    const disc = a1 * a1 - 4 * a2 * a0;
    if (disc >= 0) { poles.push([(-a1 + Math.sqrt(disc)) / (2 * a2), 0], [(-a1 - Math.sqrt(disc)) / (2 * a2), 0]); }
    else { const re = -a1 / (2 * a2), im = Math.sqrt(-disc) / (2 * a2); poles.push([re, im], [re, -im]); }
  } else poles.push([-a0 / a1, 0]);
  let T0 = 0, Tfast = Infinity;
  for (const [re, im] of poles) {
    const mag = Math.hypot(re, im);
    if (Math.abs(re) > 1e-12) T0 = Math.max(T0, 1 / Math.abs(re));
    if (mag > 1e-12) Tfast = Math.min(Tfast, 1 / mag);
  }
  if (T0 === 0) T0 = 1 / Math.abs(K); // integrator: time to reach 1 for a unit input
  if (!Number.isFinite(Tfast)) Tfast = T0;
  return { K, a0, a1, a2, theta: s.thetaRatio * T0, T0, Tfast, poles, dc: a0 > 0 ? K / a0 : Infinity };
}

/* ---------------- frequency response ---------------- */

/** Loop L = C G at ω: magnitude and unwrapped phase [rad] (C has a positive real part, G's phase is −arg of the denominator minus θ ω). */
export function loopAt(p: PlantTF, c: Ctrl | null, w: number): { mag: number; ph: number } {
  const dr = p.a0 - p.a2 * w * w, di = p.a1 * w;
  let mag = p.K / Math.hypot(dr, di), ph = -Math.atan2(di, dr) - p.theta * w;
  if (c) {
    const x = (c.Td * w) / c.N;
    const re = 1 + (useD(c) ? (c.Td * w * x) / (1 + x * x) : 0);
    const im = (useI(c) ? -1 / (c.Ti * w) : 0) + (useD(c) ? (c.Td * w) / (1 + x * x) : 0);
    mag *= c.Kp * Math.hypot(re, im); ph += Math.atan2(im, re);
  }
  return { mag, ph };
}

export function freqGrid(p: PlantTF): number[] {
  const lo = Math.floor(Math.log10(0.01 / p.T0));
  const hi = Math.max(Math.ceil(Math.log10(100 / p.T0)), Math.ceil(Math.log10(10 / p.Tfast)));
  const top = Math.min(hi, lo + 8);
  const per = 40, w: number[] = [];
  for (let i = 0; i <= (top - lo) * per; i++) w.push(Math.pow(10, lo + i / per));
  return w;
}

export type Margins = { wgc: number | null; pm: number | null; wpc: number | null; gm: number | null };

/** Gain crossover (first |L| = 1 going down) with phase margin [°] and phase crossover (first φ = −180°) with gain margin [dB]. */
export function margins(p: PlantTF, c: Ctrl | null, w: number[]): Margins & { mag: number[]; ph: number[] } {
  const L = w.map((x) => loopAt(p, c, x));
  const mag = L.map((l) => 20 * Math.log10(l.mag)), ph = L.map((l) => (l.ph * 180) / Math.PI);
  let wgc: number | null = null, pm: number | null = null, wpc: number | null = null, gm: number | null = null;
  for (let i = 1; i < w.length; i++) {
    if (wgc === null && mag[i - 1] >= 0 && mag[i] < 0) {
      const f = mag[i - 1] / (mag[i - 1] - mag[i]);
      wgc = Math.pow(10, Math.log10(w[i - 1]) + f * (Math.log10(w[i]) - Math.log10(w[i - 1])));
      pm = 180 + ph[i - 1] + f * (ph[i] - ph[i - 1]);
    }
    if (wpc === null && ph[i - 1] >= -180 && ph[i] < -180) {
      const f = (ph[i - 1] + 180) / (ph[i - 1] - ph[i]);
      wpc = Math.pow(10, Math.log10(w[i - 1]) + f * (Math.log10(w[i]) - Math.log10(w[i - 1])));
      gm = -(mag[i - 1] + f * (mag[i] - mag[i - 1]));
    }
  }
  return { wgc, pm, wpc, gm, mag, ph };
}

/* ---------------- time simulation ---------------- */

export type Mode = 'setpoint' | 'disturbance';
export type Sim = { t: number[]; y: number[]; u: number[]; r: number[]; Tend: number; diverged: boolean };

/** Matrix exponential of a small square matrix: scaling and squaring with a 14-term Taylor series. */
export function expm(M: number[][]): number[][] {
  const n = M.length;
  const norm = Math.max(...M.map((r) => r.reduce((a, v) => a + Math.abs(v), 0)));
  const sq = norm > 0.5 ? Math.ceil(Math.log2(norm / 0.5)) : 0;
  const A = M.map((r) => r.map((v) => v / Math.pow(2, sq)));
  const mul = (X: number[][], Y: number[][]) => X.map((r) => Y[0].map((_, j) => r.reduce((a, v, k) => a + v * Y[k][j], 0)));
  let E: number[][] = M.map((_, i) => M.map((__, j) => (i === j ? 1 : 0)));
  let T = E.map((r) => r.slice());
  for (let k = 1; k <= 14; k++) { T = mul(T, A).map((r) => r.map((v) => v / k)); E = E.map((r, i) => r.map((v, j) => v + T[i][j])); }
  for (let k = 0; k < sq; k++) E = mul(E, E);
  return E;
}

/**
 * Time simulation. Closed loop (c given): setpoint step r = 1, or load step d = 1 on the plant input with r = 0.
 * Open loop (c = null): unit input step. The derivative acts on the error through the first-order filter Td/N.
 * Without dead time the loop is linear and time-invariant, so each output step is taken exactly with the matrix
 * exponential of the closed-loop state matrix (no step-size limit, stiff motors and fast filters included).
 * With dead time θ the plant is advanced exactly over short sub-steps (zero-order hold) and the controller output
 * passes through a delay line; the sub-step is 1/40 of the loop time scale (1/ω_gc, θ/2, 2T_d/N).
 */
export function simulate(p: PlantTF, c: Ctrl | null, o: { mode: Mode; Tend: number; n?: number; wc?: number | null }): Sim {
  const n = o.n ?? 1200, dtD = o.Tend / n;
  const closed = !!c;
  const r = closed && o.mode === 'setpoint' ? 1 : closed ? 0 : 1;
  const d = closed && o.mode === 'disturbance' ? 1 : 0;
  const order2 = p.a2 > 0;
  const I_ = c ? useI(c) : false, D_ = c ? useD(c) : false;
  // controller output u = Kp (e + xi/Ti + N (e − xd)) = cu0 + cy·y + ci·xi + cd·xd
  const Kp = c ? c.Kp : 0, Ti = c ? c.Ti : 1, N = c ? c.N : 10, Td = c ? c.Td : 1;
  const ge = closed ? Kp * (1 + (D_ ? N : 0)) : 0; // gain on e
  const ci = I_ ? Kp / Ti : 0, cd = D_ ? -Kp * N : 0;
  const uOf = (y: number, xi: number, xd: number) => (closed ? ge * (r - y) + ci * xi + cd * xd : 1);
  // plant x' = Ap x + bp·(input): states [y, y']
  const Ap = order2 ? [[0, 1], [-p.a0 / p.a2, -p.a1 / p.a2]] : [[-p.a0 / p.a1, 0], [0, 0]];
  const bp = order2 ? [0, p.K / p.a2] : [p.K / p.a1, 0];
  const t: number[] = [], y: number[] = [], u: number[] = [], rr: number[] = [];
  let diverged = false;
  const record = (i: number, yy: number, uu: number) => {
    if (!Number.isFinite(yy) || Math.abs(yy) > 1e9 || !Number.isFinite(uu)) { diverged = true; return false; }
    t.push(i * dtD); y.push(yy); u.push(uu); rr.push(r); return true;
  };
  if (p.theta <= 0) {
    // exact: z = [y, y', xi, xd, 1]
    const A: number[][] = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]);
    const row = (i: number, k: number) => { // add k·(u + d) to row i
      A[i][0] += k * (closed ? -ge : 0); A[i][2] += k * ci; A[i][3] += k * cd; A[i][4] += k * ((closed ? ge * r : 1) + d);
    };
    A[0][0] += Ap[0][0]; A[0][1] += Ap[0][1]; A[1][0] += Ap[1][0]; A[1][1] += Ap[1][1];
    row(0, bp[0]); row(1, bp[1]);
    if (closed && I_) { A[2][0] = -1; A[2][4] = r; }
    if (closed && D_) { const g = N / Td; A[3][0] = -g; A[3][3] = -g; A[3][4] = g * r; }
    const E = expm(A.map((rw) => rw.map((v) => v * dtD)));
    let z = [0, 0, 0, 0, 1];
    for (let i = 0; i <= n; i++) {
      if (!record(i, z[0], uOf(z[0], z[2], z[3]))) break;
      if (i < n) z = E.map((rw) => rw.reduce((a, v, k) => a + v * z[k], 0));
    }
    return { t, y, u, r: rr, Tend: o.Tend, diverged };
  }
  // dead time: exact plant over sub-steps with the input held, controller states updated per sub-step
  let fast = o.wc ? 1 / o.wc : Infinity;
  fast = Math.min(fast, p.theta / 2);
  if (D_) fast = Math.min(fast, (2 * Td) / N); // the derivative path feeds e straight through: sample it finely
  const m = Math.min(400, Math.max(1, Math.ceil(dtD / (fast / 40))));
  const dt = dtD / m;
  const nd = Math.max(1, Math.round(p.theta / dt));
  const buf = new Float64Array(nd);
  const P = expm([[Ap[0][0] * dt, Ap[0][1] * dt, bp[0] * dt], [Ap[1][0] * dt, Ap[1][1] * dt, bp[1] * dt], [0, 0, 0]]);
  const fd = D_ ? Math.exp((-N * dt) / Td) : 0;
  let x0 = 0, x1 = 0, xi = 0, xd = 0, step = 0;
  for (let i = 0; i <= n; i++) {
    if (!record(i, x0, uOf(x0, xi, xd))) break;
    if (i === n) break;
    for (let j = 0; j < m; j++, step++) {
      const u0 = uOf(x0, xi, xd), e = r - x0;
      const ud = buf[step % nd]; buf[step % nd] = u0;
      const inp = ud + d;
      const n0 = P[0][0] * x0 + P[0][1] * x1 + P[0][2] * inp, n1 = P[1][0] * x0 + P[1][1] * x1 + P[1][2] * inp;
      x0 = n0; x1 = n1;
      if (I_) xi += e * dt;
      if (D_) xd = e + (xd - e) * fd;
    }
  }
  return { t, y, u, r: rr, Tend: o.Tend, diverged };
}

export type Metrics = {
  yf: number; ess: number; overshoot: number; rise: number; settle: number; peak: number; umax: number; settled: boolean; unstable: boolean;
};

export function metrics(sim: Sim, mode: Mode): Metrics {
  const { t, y, u } = sim, n = y.length;
  const peak = Math.max(...y.map(Math.abs)), umax = Math.max(...u.map(Math.abs));
  const q = (a: number, b: number) => Math.max(...y.slice(Math.floor(n * a), Math.max(Math.floor(n * a) + 1, Math.floor(n * b))).map(Math.abs));
  const qa = q(0.5, 0.75), qb = q(0.75, 1);
  const unstable = sim.diverged || (qb > 1.2 * qa && qb > 0.3 * peak && qb > 1e-6);
  const tail = y.slice(Math.floor(n * 0.97));
  const yf = tail.reduce((a, b) => a + b, 0) / tail.length;
  const out: Metrics = { yf, ess: mode === 'setpoint' ? 1 - yf : -yf, overshoot: 0, rise: NaN, settle: Infinity, peak, umax, settled: false, unstable };
  if (unstable) return out;
  const band = mode === 'setpoint' ? 0.02 * Math.max(Math.abs(yf), 1e-3) : 0.02 * Math.max(peak, 1e-12);
  let last = -1;
  for (let i = n - 1; i >= 0; i--) if (Math.abs(y[i] - yf) > band) { last = i; break; }
  if (last < n - 1) { out.settle = last < 0 ? 0 : t[last + 1]; out.settled = true; }
  if (mode === 'setpoint' && yf > 1e-9) {
    out.overshoot = Math.max(0, (Math.max(...y) - yf) / yf) * 100;
    const cross = (lvl: number) => {
      for (let i = 1; i < n; i++) if (y[i] >= lvl && y[i - 1] < lvl) return t[i - 1] + ((lvl - y[i - 1]) / (y[i] - y[i - 1])) * (t[i] - t[i - 1]);
      return NaN;
    };
    out.rise = cross(0.9 * yf) - cross(0.1 * yf);
  }
  return out;
}

/* ---------------- analysis (everything the screen shows) ---------------- */

export type Check = { ok: boolean; label: string; detail: string };
export type Analysis = {
  plant: PlantTF; sim: Sim; met: Metrics; w: number[]; mag: number[]; ph: number[]; mar: Margins; stable: boolean; checks: Check[];
};

export function analyse(spec: PlantSpec, c: Ctrl, mode: Mode, lim: { overshoot: number; settle: number }, Tend0?: number): Analysis {
  const plant = plantTF(spec);
  const w = freqGrid(plant);
  const fr = margins(plant, c, w);
  const mar: Margins = { wgc: fr.wgc, pm: fr.pm, wpc: fr.wpc, gm: fr.gm };
  let Tend = Tend0 ?? 8 * plant.T0 + 5 * plant.theta;
  if (Tend0 === undefined && useI(c)) Tend = Math.max(Tend, Math.min(4 * c.Ti, 30 * plant.T0));
  let sim = simulate(plant, c, { mode, Tend, wc: mar.wgc });
  let met = metrics(sim, mode);
  for (let k = 0; k < 4 && !met.settled && !met.unstable; k++) {
    Tend *= 2.5;
    sim = simulate(plant, c, { mode, Tend, wc: mar.wgc });
    met = metrics(sim, mode);
  }
  if (Tend0 === undefined && met.settled && met.settle > 0 && Tend > 3.5 * met.settle) {
    Tend = Math.max(2.5 * met.settle, 1e-9);
    sim = simulate(plant, c, { mode, Tend, wc: mar.wgc });
    met = metrics(sim, mode);
  }
  const stable = !met.unstable && (mar.pm === null || mar.pm > 0) && (mar.gm === null || mar.gm > 0);
  const fx = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
  const checks: Check[] = [
    { ok: stable, label: 'Closed loop is stable', detail: stable ? `${mar.pm === null ? 'no gain crossover' : `PM ${fx(mar.pm, 0)}°`}, ${mar.gm === null ? 'no phase crossover' : `GM ${fx(mar.gm, 1)} dB`}` : 'the response diverges or a margin is negative' },
  ];
  if (mode === 'setpoint') {
    checks.push({ ok: stable && met.overshoot <= lim.overshoot, label: `Overshoot ≤ ${lim.overshoot} %`, detail: stable ? `${fx(met.overshoot)} %` : 'unstable' });
  }
  checks.push(
    { ok: stable && met.settled && met.settle <= lim.settle, label: `Settling time (2 % band) ≤ ${fx(lim.settle, 2)} s`, detail: stable && met.settled ? `${fx(met.settle, 2)} s` : 'not settled in the window' },
    { ok: stable && met.settled && Math.abs(met.ess) <= (mode === 'setpoint' ? 0.02 : 0.02 * met.peak), label: mode === 'setpoint' ? 'Steady-state error ≤ 2 %' : 'Remaining deviation ≤ 2 % of the peak', detail: stable && met.settled ? `${fx(Math.abs(met.ess) * (mode === 'setpoint' ? 100 : 100 / Math.max(met.peak, 1e-12)), 2)} %` : 'unstable' },
    { ok: mar.pm === null || mar.pm >= 45, label: 'Phase margin ≥ 45°', detail: mar.pm === null ? 'no gain crossover' : `${fx(mar.pm, 0)}°` },
    { ok: mar.gm === null || mar.gm >= 6, label: 'Gain margin ≥ 6 dB', detail: mar.gm === null ? 'no phase crossover' : `${fx(mar.gm, 1)} dB` },
  );
  return { plant, sim, met, w, mag: fr.mag, ph: fr.ph, mar, stable, checks };
}

/* ---------------- tuning rules ---------------- */

export type Fopdt = { dc: number; T: number; L: number; R: number; floored: boolean };

/** Tangent (reaction-curve) fit of the open-loop unit step: R = steepest slope, L = where that tangent meets zero, T = dc/R. */
export function fitFopdt(p: PlantTF): Fopdt {
  const Tend = 12 * p.T0 + 2 * p.theta;
  const sim = simulate(p, null, { mode: 'setpoint', Tend, n: 4000 });
  let R = 0, k = 1;
  for (let i = 2; i < sim.t.length - 2; i++) {
    const s = (sim.y[i + 2] - sim.y[i - 2]) / (sim.t[i + 2] - sim.t[i - 2]);
    if (s > R) { R = s; k = i; }
  }
  const Lraw = Math.max(0, sim.t[k] - sim.y[k] / R);
  const T = Number.isFinite(p.dc) ? p.dc / R : Infinity;
  const Tref = Number.isFinite(T) ? T : 1 / R;
  const L = Math.max(Lraw, 0.05 * Tref);
  return { dc: p.dc, T, L, R, floored: L > Lraw + 1e-12 };
}

/** Ultimate gain K_u = 1/|G(jω₁₈₀)| and period P_u = 2π/ω₁₈₀ of the plant alone; null without a −180° crossing. */
export function ultimate(p: PlantTF): { Ku: number; Pu: number } | null {
  const w = freqGrid(p);
  for (let i = 1; i < w.length; i++) {
    const a = loopAt(p, null, w[i - 1]), b = loopAt(p, null, w[i]);
    if (a.ph > -Math.PI && b.ph <= -Math.PI) {
      let lo = w[i - 1], hi = w[i];
      for (let k = 0; k < 60; k++) { const mid = Math.sqrt(lo * hi); if (loopAt(p, null, mid).ph > -Math.PI) lo = mid; else hi = mid; }
      const wc = Math.sqrt(lo * hi);
      return { Ku: 1 / loopAt(p, null, wc).mag, Pu: (2 * Math.PI) / wc };
    }
  }
  return null;
}

export type TuneMethod = 'zn' | 'znu' | 'cc';
export type Tuned = { Kp: number; Ti: number; Td: number; fit: Fopdt; ult: { Ku: number; Pu: number } | null } | { na: string };

export function tuneGains(method: TuneMethod, type: CtrlType, p: PlantTF): Tuned {
  const fit = fitFopdt(p), ult = ultimate(p);
  const { L, R } = fit;
  const invA = 1 / (R * L); // T/(K L)
  const r = Number.isFinite(fit.T) ? L / fit.T : 0;
  let Kp = 0, Ti = Infinity, Td = 0;
  if (method === 'zn') {
    if (type === 'P') Kp = invA;
    else if (type === 'PI') { Kp = 0.9 * invA; Ti = 3.33 * L; }
    else { Kp = 1.2 * invA; Ti = 2 * L; Td = 0.5 * L; }
  } else if (method === 'cc') {
    if (type === 'P') Kp = invA * (1 + r / 3);
    else if (type === 'PI') { Kp = invA * (0.9 + r / 12); Ti = (L * (30 + 3 * r)) / (9 + 20 * r); }
    else { Kp = invA * (4 / 3 + r / 4); Ti = (L * (32 + 6 * r)) / (13 + 8 * r); Td = (4 * L) / (11 + 2 * r); }
  } else {
    if (!ult) return { na: 'This plant never reaches −180° phase, so it has no ultimate gain.' };
    const { Ku, Pu } = ult;
    if (type === 'P') Kp = 0.5 * Ku;
    else if (type === 'PI') { Kp = 0.45 * Ku; Ti = Pu / 1.2; }
    else { Kp = 0.6 * Ku; Ti = Pu / 2; Td = Pu / 8; }
  }
  return { Kp, Ti: Number.isFinite(Ti) ? Ti : 1, Td, fit, ult };
}

/** Mass–spring–damper driven by an actuator force K_a·u: x/u = (K_a/k)·ω_n²/(s² + 2ζω_n s + ω_n²), ω_n = √(k/m), ζ = c/(2√(k m)). */
export function massSpring(m: number, c: number, k: number, Ka: number) {
  return { K: Ka / k, wn: Math.sqrt(k / m), zeta: c / (2 * Math.sqrt(k * m)) };
}

/** The four example loops, each a real object (hub cards and page intros). */
export type PidObject = 'level' | 'motor' | 'position' | 'conveyor';
export const PID_OBJECT_PLANT: Record<PidObject, PlantId> = { level: 'first', motor: 'motor', position: 'second', conveyor: 'integrator' };
export const PID_LEVEL_INTRO = 'Tank level: the controller opens the inlet valve; water leaves through the outlet, so the level settles by itself (first-order process with a time constant τ). Dead time = delay in the feed pipe. Change the gains and watch the level reach the red setpoint ring.';
export const PID_MOTOR_INTRO = 'Motor speed: the controller sets the armature voltage of a DC motor turning a flywheel. Speed follows the voltage through the electrical (L/R) and mechanical (J/b) time scales. A load step is a sudden braking torque.';
export const PID_POSITION_INTRO = 'Position of a mass on a spring with a damper: the controller pushes with a force (orange arrow). Little damping makes it overshoot and ring; derivative action T_d adds damping.';
export const PID_CONVEYOR_INTRO = 'Conveyor position: the controller sets the belt speed, the box position is the integral of that speed. The process does not settle by itself, so a P controller alone already removes the offset; integral action adds overshoot.';

export const PID_INTRO = 'A controller compares the measured output with the setpoint and drives the plant with P (now), I (past) and D (trend) action. Raise K_p for speed, shorten T_i to remove the offset faster, add T_d to damp the oscillation. The step response shows what you get; the loop’s phase and gain margins show how close it is to instability.';

export const PID_NOTES = [
  'Controller: C(s) = K_p [1 + 1/(T_i s) + T_d s/(1 + T_d s/N)] with N = 10 unless you change it; the derivative acts on the error (setpoint kick appears), there is no output limit and no anti-windup. Plants: first order K/(τ s + 1), second order K ω_n²/(s² + 2ζω_n s + ω_n²), integrator K/s, and a DC motor speed ω/V = K_t/[(J s + b)(L s + R) + K_t²] (K_t = K_e). Optional dead time θ (a multiple of the plant time scale T₀) is an exact delay.',
  'Time response: RK4 integration of the plant and controller states; unit setpoint step or a unit load step on the plant input. Overshoot is relative to the final value, rise time is 10–90 %, settling time uses a ±2 % band around the final value. The time window is chosen automatically. Stability is judged from the simulation and from the margins.',
  'Frequency response: loop L(jω) = C(jω) G(jω). Gain crossover = first |L| = 1, phase margin = 180° + arg L there; phase crossover = first arg L = −180°, gain margin = 1/|L| there. Phase margin ≥ 45° and gain margin ≥ 6 dB are common design targets, not code requirements.',
  'Tuning rules: Ziegler–Nichols reaction curve and Cohen–Coon use a tangent fit of the open-loop step (steepest slope R, dead time L, time constant T; L is floored at 5 % of the time scale when the plant has no real delay). Ziegler–Nichols ultimate gain uses K_u and P_u of the plant alone. The rules give a starting point (about 25 % overshoot for Ziegler–Nichols); expect to refine them. Not modelled: actuator saturation and rate limits, anti-windup, measurement noise, sampling, nonlinear or time-varying plants, setpoint weighting, higher-order plants.',
];
