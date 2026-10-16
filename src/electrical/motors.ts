/**
 * Electric motors, steady state. SI units (V, A, Ω, N·m, rad/s); speeds also in rpm.
 *  - Brushed permanent-magnet DC motor: U = R·I + k·ω, T = k·(I − I₀) (k = torque = back-EMF constant).
 *  - Three-phase induction motor: per-phase equivalent circuit, Thevenin form (Chapman), torque–slip curve.
 */
const RPM = 60 / (2 * Math.PI);

/* ------------------------------ DC ------------------------------ */
export type DcIn = { U: number; R: number; k: number; Tf: number; TL: number };

export function dcMotor(p: DcIn) {
  const I0 = p.Tf / p.k; // current to overcome friction
  const Is = p.U / p.R; // stall current
  const Ts = p.k * (Is - I0); // stall output torque
  const w0 = (p.U - p.R * I0) / p.k; // no-load speed
  const at = (T: number) => { // output torque → operating values
    const I = T / p.k + I0, w = (p.U - p.R * I) / p.k;
    const Pout = T * Math.max(w, 0), Pin = p.U * I;
    return { T, I, w, n: w * RPM, Pout, Pin, eta: Pin > 0 ? Pout / Pin : 0, Pcu: I * I * p.R };
  };
  const op = at(Math.min(p.TL, Ts));
  const Imaxeta = Math.sqrt(I0 * Is); // max efficiency current (classic result)
  const etaMax = Is > 0 ? (1 - Math.sqrt(I0 / Is)) ** 2 : 0;
  const checks = [
    { ok: p.TL < Ts, label: 'Load torque below stall torque (motor turns)', detail: `T_L = ${p.TL.toFixed(3)} < T_s = ${Ts.toFixed(3)} N·m` },
    { ok: op.I <= 0.5 * Is, label: 'Current ≤ 50 % of stall (thermally sensible for continuous duty)', detail: `I = ${op.I.toFixed(2)} A, I_s = ${Is.toFixed(1)} A` },
    { ok: op.eta >= 0.6 * etaMax, label: 'Running near the efficient region', detail: `η = ${(op.eta * 100).toFixed(1)} %, η_max = ${(etaMax * 100).toFixed(1)} %` },
  ];
  return { I0, Is, Ts, w0, n0: w0 * RPM, op, at, Imaxeta, etaMax, Pmax: (Ts * w0) / 4, checks };
}

/* ------------------------------ AC induction ------------------------------ */
export type InductionIn = {
  Uline: number; f: number; poles: number; // line voltage (Y), Hz, number of poles
  R1: number; X1: number; R2: number; X2: number; Xm: number; // per phase, referred to stator
  Prot: number; // rotational (friction + windage + core) loss [W], taken as constant
  load: 'constant' | 'fan'; TL: number; // load torque at synchronous speed (fan: ∝ n²)
};

type C = { re: number; im: number };
const cx = (re: number, im = 0): C => ({ re, im });
const add = (a: C, b: C) => cx(a.re + b.re, a.im + b.im);
const mul = (a: C, b: C) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const div = (a: C, b: C) => { const d = b.re * b.re + b.im * b.im; return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d); };
const abs = (a: C) => Math.hypot(a.re, a.im);

export function induction(p: InductionIn) {
  const Vph = p.Uline / Math.sqrt(3);
  const ns = (120 * p.f) / p.poles, ws = (2 * Math.PI * ns) / 60;
  // Thevenin equivalent seen by the rotor (exact)
  const Z1 = cx(p.R1, p.X1), Zm = cx(0, p.Xm);
  const Zth = div(mul(Zm, Z1), add(Z1, Zm));
  const Vth = (Vph * p.Xm) / abs(add(Z1, Zm));
  const Rth = Zth.re, Xth = Zth.im;
  const torque = (s: number) => (3 * Vth * Vth * (p.R2 / s)) / (ws * ((Rth + p.R2 / s) ** 2 + (Xth + p.X2) ** 2));
  const sMax = p.R2 / Math.hypot(Rth, Xth + p.X2);
  const Tmax = (3 * Vth * Vth) / (2 * ws * (Rth + Math.hypot(Rth, Xth + p.X2)));
  const Tstart = torque(1);
  const loadT = (s: number) => (p.load === 'constant' ? p.TL : p.TL * (1 - s) ** 2);
  // stable operating point: torque(s) = load(s) on 0 < s < s_max (motor torque rises with s there)
  let sOp = NaN;
  if (torque(sMax) > loadT(sMax)) {
    let lo = 1e-6, hi = sMax;
    for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (torque(m) < loadT(m)) lo = m; else hi = m; }
    sOp = (lo + hi) / 2;
  }
  const stator = (s: number) => { // stator current and power factor from the full circuit
    const Z2 = cx(p.R2 / s, p.X2);
    const Zin = add(Z1, div(mul(Zm, Z2), add(Zm, Z2)));
    const I1 = Vph / abs(Zin);
    return { I1, pf: Zin.re / abs(Zin) };
  };
  const at = (s: number) => {
    const T = torque(s), n = ns * (1 - s), Pag = T * ws, Pconv = (1 - s) * Pag;
    const Pout = Math.max(Pconv - p.Prot, 0), st = stator(s);
    const Pin = 3 * Vph * st.I1 * st.pf;
    return { s, n, T, Pag, Pconv, Pout, Pin, I1: st.I1, pf: st.pf, eta: Pin > 0 ? Pout / Pin : 0, Tshaft: n > 0 ? Pout / ((2 * Math.PI * n) / 60) : 0 };
  };
  const op = Number.isFinite(sOp) ? at(sOp) : null;
  const Ist = stator(1).I1;
  const checks = [
    { ok: !!op, label: 'Motor torque exceeds the load up to breakdown (it runs)', detail: op ? `s = ${(op.s * 100).toFixed(2)} %` : `T_max = ${Tmax.toFixed(1)} < load` },
    { ok: Tstart > loadT(1), label: 'Starts on its own (T_start > load at standstill)', detail: `T_start = ${Tstart.toFixed(1)} N·m, load ${loadT(1).toFixed(1)} N·m` },
    { ok: !!op && Tmax / op.T >= 1.6, label: 'Breakdown margin T_max/T ≥ 1.6', detail: op ? `${(Tmax / op.T).toFixed(2)}` : '—' },
    { ok: !!op && op.s <= 0.08, label: 'Slip ≤ 8 % (rotor losses small)', detail: op ? `rotor copper loss = s·P_ag = ${(op.s * op.Pag).toFixed(0)} W` : '—' },
  ];
  return { Vph, ns, ws, Vth, Rth, Xth, sMax, Tmax, Tstart, Ist, torque, loadT, at, op, checks };
}
export type InductionResult = ReturnType<typeof induction>;

/** Presets. Chapman's textbook motor (Electric Machinery Fundamentals, induction-motor torque example) and a typical 400 V / 50 Hz 7.5 kW motor. */
export const AC_PRESETS: Record<string, Omit<InductionIn, 'load' | 'TL'> & { label: string; TLdef: number }> = {
  tr75: { label: '7.5 kW · 400 V · 50 Hz · 4-pole', Uline: 400, f: 50, poles: 4, R1: 0.75, X1: 1.25, R2: 0.62, X2: 1.6, Xm: 42, Prot: 180, TLdef: 49 },
  chap: { label: 'Chapman 25 hp · 460 V · 60 Hz', Uline: 460, f: 60, poles: 4, R1: 0.641, X1: 1.106, R2: 0.332, X2: 0.464, Xm: 26.3, Prot: 1100, TLdef: 100 },
};

export const DC_PRESETS: Record<string, DcIn & { label: string }> = {
  small: { label: '24 V · 250 W class', U: 24, R: 0.25, k: 0.06, Tf: 0.03, TL: 0.6 },
  hobby: { label: '12 V hobby motor', U: 12, R: 1.2, k: 0.012, Tf: 0.002, TL: 0.02 },
  big: { label: '220 V · 3 kW class', U: 220, R: 0.8, k: 1.25, Tf: 0.6, TL: 12 },
};

export const MOTOR_ASSUMPTIONS = {
  dc: 'Brushed permanent-magnet DC motor in steady state: U = R·I + k·ω, T = k·(I − I₀), constant friction torque, no brush drop, no armature reaction, cold-to-warm resistance change ignored. Maximum efficiency at I = √(I₀·I_s); maximum power at half the stall torque.',
  ac: 'Three-phase induction motor, star connected, per-phase equivalent circuit (R₁, X₁, R₂′, X₂′, X_m) solved exactly in Thevenin form (Chapman). Rotational losses lumped as a constant, core loss resistance not modelled, parameters constant (no saturation, no deep-bar effect — real starting torque is usually higher). Preset values are typical, not a specific product.',
};
