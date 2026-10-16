/**
 * Hybrid stepper motor (1.8°, 50 rotor teeth, two phases) on a chopper drive: above the corner speed
 * ω_c = (V − I R)/(N_r L I) the supply can no longer drive the set current through the winding inductance, and the
 * torque falls roughly as ω_c/ω (constant power, like a synchronous machine). Load: inertia,
 * friction, a speed to reach in an acceleration time; torque margin, inertia ratio, low-speed resonance, pulse rate.
 */
export type Check = { ok: boolean; label: string; detail: string };
export type Frame = 'n17' | 'n23' | 'n34';
/** Typical two-phase bipolar hybrid steppers (datasheet-style, rounded): holding torque [N·m], rated phase current [A],
 *  resistance [Ω], inductance [H], rotor inertia [kg·m²], body size [m]. */
export const STEPPERS: Record<Frame, { name: string; Th: number; I: number; R: number; L: number; J: number; size: number; len: number }> = {
  n17: { name: 'NEMA 17 (42 mm)', Th: 0.45, I: 1.7, R: 1.5, L: 2.8e-3, J: 68e-7, size: 0.042, len: 0.048 },
  n23: { name: 'NEMA 23 (57 mm)', Th: 1.26, I: 2.8, R: 0.9, L: 2.5e-3, J: 300e-7, size: 0.057, len: 0.076 },
  n34: { name: 'NEMA 34 (86 mm)', Th: 4.5, I: 4.2, R: 0.75, L: 6.0e-3, J: 1400e-7, size: 0.086, len: 0.08 },
};
export const NR = 50, STEPS = 200;

export type StepIn = {
  frame: Frame;
  V: number;          // drive supply voltage [V]
  cur: number;        // current setting as a share of rated
  micro: number;      // microsteps per full step
  JL: number;         // load inertia [kg·m²]
  Tf: number;         // friction torque at the motor [N·m]
  rpm: number;        // speed to reach [rpm]
  ta: number;         // acceleration time [s]
  sf: number;         // required torque margin
};

/** Corner speed [rad/s]: the supply, less the resistive drop, just drives the set current through the winding's
 *  inductance at the electrical frequency N_r ω. */
export const cornerW = (V: number, Iset: number, R: number, L: number) => Math.max(1e-3, V - Iset * R) / (NR * L * Iset);
/** Torque-producing phase current [A] at shaft speed ω: the set current below the corner, falling as ω_c/ω above it. */
export const phaseCurrent = (Iset: number, wc: number, w: number) => Iset / Math.sqrt(1 + (w / wc) ** 2);
/** Pull-out torque [N·m] at speed n [rpm]: holding torque scaled by the current, less a 3 % detent/loss share. */
export function pullOut(f: (typeof STEPPERS)[Frame], V: number, cur: number, n: number) {
  const Iset = cur * f.I, wc = cornerW(V, Iset, f.R, f.L), w = (n * 2 * Math.PI) / 60;
  return Math.max(0, (f.Th / f.I) * phaseCurrent(Iset, wc, w) - 0.03 * f.Th);
}

export function stepper(p: StepIn) {
  const f = STEPPERS[p.frame], kt = f.Th / f.I, w = (p.rpm * 2 * Math.PI) / 60;
  const J = f.J + p.JL, alpha = w / p.ta, Tacc = J * alpha, Treq = Tacc + p.Tf;
  const Tpo = pullOut(f, p.V, p.cur, p.rpm), Th = p.cur * f.Th;
  const nCorner = cornerW(p.V, p.cur * f.I, f.R, f.L) * (60 / (2 * Math.PI));
  const fFull = (p.rpm / 60) * STEPS, fPulse = fFull * p.micro;
  const f0 = Math.sqrt((NR * Th) / J) / (2 * Math.PI), nRes = (f0 / STEPS) * 60;   // natural frequency [Hz], speed where full steps hit it
  const res = p.rpm > 0.6 * nRes && p.rpm < 1.6 * nRes;
  const Pcu = 2 * Math.pow(p.cur * f.I, 2) * f.R, Pmech = Treq * w;
  const checks: Check[] = [
    { ok: Tpo >= p.sf * Treq, label: 'Pull-out torque at the top speed covers the load with the margin (otherwise it loses steps)', detail: `${Tpo.toFixed(3)} N·m ≥ ${p.sf} × ${Treq.toFixed(3)} N·m` },
    { ok: p.JL <= 10 * f.J, label: 'Load inertia at most 10 × the rotor inertia', detail: `J_L/J_M = ${(p.JL / f.J).toFixed(1)}` },
    { ok: !res || p.micro >= 8, label: 'Away from the low-speed resonance, or microstepping (≥ 8) to smooth it', detail: `resonance near ${nRes.toFixed(0)} rpm, ${p.micro} microsteps` },
    { ok: fPulse <= 200e3, label: 'Step pulse rate within 200 kHz (typical controller output)', detail: `${(fPulse / 1000).toFixed(1)} kHz` },
    { ok: p.V <= 32 * Math.sqrt(f.L * 1000), label: 'Supply voltage within the usual 32 √L(mH) rule for the winding (insulation, heating)', detail: `${p.V} V ≤ ${(32 * Math.sqrt(f.L * 1000)).toFixed(0)} V` },
  ];
  return { f, kt, w, J, alpha, Tacc, Treq, Tpo, Th, nCorner, fFull, fPulse, f0, nRes, res, Pcu, Pmech, stepDeg: 360 / STEPS / p.micro, checks };
}
export type StepResult = ReturnType<typeof stepper>;

export const STEP_INTRO = 'A stepper motor turns in exact steps — 200 per revolution for the common 1.8° motor — every time the drive switches the current between its two windings, so it positions without any sensor. Its weakness is speed: each winding is a coil, and the faster the steps come the less time the current has to build up, so the torque falls away above a corner speed. If the load ever needs more torque than the motor can give, it silently loses steps — hence generous margins, a higher supply voltage and microstepping.';

export const STEP_NOTES = [
  'Torque model: holding torque ∝ phase current (k_t = T_h/I_rated); the chopper keeps the set current up to the corner speed ω_c = (V − I R)/(N_r L I) with N_r = 50 rotor teeth, above it the current — and the torque — falls as 1/√(1 + (ω/ω_c)²), i.e. about T ω_c/ω (the classic constant-power region, set by V/L and not by the current setting); minus 3 % for detent torque and losses. Real pull-out curves also show mid-band resonance dips and depend on the drive’s decay mode; the curve here is a smooth estimate.',
  'Load: torque to accelerate (J_M + J_L) from rest to the target speed in the ramp time plus friction, compared with the pull-out torque at the top speed with a safety margin (usually 1.5–2 for steppers, which run open loop). Low-speed resonance from the rotor’s small-signal stiffness N_r T_h: f₀ = √(N_r T_h/J)/2π, hit when the full-step rate is near f₀. Voltage rule of thumb from drive makers: V ≤ 32 √L(mH).',
  'Motor data: typical datasheet values for common frame sizes, not one product. Heating I²R of both phases at the set current is shown; actual losses also include iron losses at speed.',
];
