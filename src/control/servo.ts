/**
 * Motor and gearbox sizing for a positioning axis: a trapezoidal move (accelerate, cruise, decelerate, dwell) of a
 * ball-screw table, a belt-driven carriage or a rotary table; load inertia and torque reflected through a planetary
 * gearbox; peak and RMS torque, speed and inertia ratio checked against generic AC servo motors; the smallest motor
 * that passes is chosen automatically. SI units (mm, rpm and kg·cm² shown on the page).
 */
export type Check = { ok: boolean; label: string; detail: string };
export type AxisKind = 'screw' | 'belt' | 'rotary';

/** Generic 3000 rpm AC servo motors (typical catalogue values, rounded). J in kg·m². */
export const MOTORS = [
  { id: '100W', P: 100, Tr: 0.32, Tp: 0.95, nr: 3000, nmax: 6000, J: 0.06e-4, frame: 40, len: 0.08 },
  { id: '200W', P: 200, Tr: 0.64, Tp: 1.91, nr: 3000, nmax: 6000, J: 0.14e-4, frame: 60, len: 0.09 },
  { id: '400W', P: 400, Tr: 1.27, Tp: 3.82, nr: 3000, nmax: 6000, J: 0.26e-4, frame: 60, len: 0.12 },
  { id: '750W', P: 750, Tr: 2.39, Tp: 7.16, nr: 3000, nmax: 6000, J: 0.87e-4, frame: 80, len: 0.14 },
  { id: '1kW', P: 1000, Tr: 3.18, Tp: 9.55, nr: 3000, nmax: 5000, J: 1.5e-4, frame: 100, len: 0.16 },
  { id: '1.5kW', P: 1500, Tr: 4.77, Tp: 14.3, nr: 3000, nmax: 5000, J: 2.5e-4, frame: 100, len: 0.19 },
  { id: '2kW', P: 2000, Tr: 6.37, Tp: 19.1, nr: 3000, nmax: 5000, J: 3.3e-4, frame: 130, len: 0.2 },
  { id: '3kW', P: 3000, Tr: 9.55, Tp: 28.6, nr: 3000, nmax: 4500, J: 7.0e-4, frame: 130, len: 0.24 },
  { id: '5kW', P: 5000, Tr: 15.9, Tp: 47.7, nr: 3000, nmax: 4500, J: 12e-4, frame: 180, len: 0.26 },
];
export type Motor = (typeof MOTORS)[number];
export const STEEL = { rho: 7850, E: 2.1e11 };

export type ServoIn = {
  kind: AxisKind;
  m: number;            // moving mass [kg] (screw/belt) or table mass (rotary)
  lead: number;         // screw lead [mm]
  d: number; L: number; // screw diameter, length [mm]; belt pulley diameter [mm] (d); rotary table diameter [mm] (d)
  mu: number;           // friction coefficient of the guides
  Fext: number;         // process force along the motion [N] (screw/belt) or torque [N·m] (rotary)
  vertical: boolean;    // screw/belt axis lifts the load
  s: number;            // move: distance [mm] or angle [°]
  tm: number; fa: number; dwell: number; // move time [s], accel share of the move time, dwell [s]
  i: number;            // gearbox ratio (1 = direct)
  motor: string;        // 'auto' or a motor id
  sf: number;           // safety factor on the load torque
};

/** Reflected quantities at the load side: inertia [kg·m²], steady torque [N·m], and the conversion load rad ↔ motion. */
export function loadSide(p: ServoIn) {
  const g = 9.81;
  if (p.kind === 'rotary') {
    const R = p.d / 2000, J = 0.5 * p.m * R * R, T = p.Fext + p.mu * p.m * g * 0.6 * R; // friction on a bearing at 0.6 R
    return { J, T, unit: Math.PI / 180, eta: 1, Jpart: { table: J } };
  }
  const F = p.Fext + p.mu * p.m * g + (p.vertical ? p.m * g : 0);
  if (p.kind === 'screw') {
    const r = p.lead / 1000 / (2 * Math.PI), eta = 0.9, Js = (Math.PI * STEEL.rho * (p.L / 1000) * Math.pow(p.d / 1000, 4)) / 32;
    return { J: p.m * r * r + Js, T: (F * r) / eta, unit: 1 / 1000 / r, eta, Jpart: { mass: p.m * r * r, screw: Js } };
  }
  const R = p.d / 2000, eta = 0.95, Jp = 2 * 0.5 * (2700 * Math.PI * R * R * 0.03) * R * R; // two aluminium pulleys 30 mm wide
  return { J: p.m * R * R + Jp, T: (F * R) / eta, unit: 1 / 1000 / R, eta, Jpart: { mass: p.m * R * R, pulleys: Jp } };
}

export const gearEta = (i: number) => (i <= 1 ? 1 : i <= 10 ? 0.97 : 0.94);
/** Trapezoidal move: peak speed and acceleration in load units per s (mm or °). */
export const trapezoid = (s: number, tm: number, fa: number) => { const ta = fa * tm, v = s / (tm - ta); return { ta, tc: tm - 2 * ta, v, a: v / ta }; };

export function torques(p: ServoIn, mot: Motor) {
  const ld = loadSide(p), tr = trapezoid(p.s, p.tm, p.fa), eg = gearEta(p.i);
  const wL = tr.v * ld.unit, aL = tr.a * ld.unit;                // load-side rad/s, rad/s²
  const wM = wL * p.i, aM = aL * p.i, nM = (wM * 60) / (2 * Math.PI);
  const Jg = p.i > 1 ? 0.25 * mot.J : 0;                         // gearbox input inertia (typical share)
  const JL = ld.J / (p.i * p.i), Jt = mot.J + Jg + JL / eg, TL = (p.sf * ld.T) / (p.i * eg);
  const Ta = Jt * aM + TL, Tc = TL, Td = TL - Jt * aM;
  const tcyc = p.tm + p.dwell, Trms = Math.sqrt((Ta * Ta * tr.ta + Tc * Tc * tr.tc + Td * Td * tr.ta + (p.vertical ? TL * TL * p.dwell : 0)) / tcyc);
  const Tpk = Math.max(Math.abs(Ta), Math.abs(Td));
  return { ld, tr, eg, wL, aL, wM, aM, nM, Jg, JL, Jt, TL, Ta, Tc, Td, tcyc, Trms, Tpk, ratio: JL / mot.J };
}

/** First bending critical speed of a pinned–pinned screw [rpm]: n = 60 (π d/8 L²) √(E/ρ). */
export const screwCritical = (d: number, L: number) => 60 * ((Math.PI * (d / 1000)) / (8 * Math.pow(L / 1000, 2))) * Math.sqrt(STEEL.E / STEEL.rho);

function checksFor(p: ServoIn, mot: Motor, t: ReturnType<typeof torques>): Check[] {
  const nScrew = (t.wL * 60) / (2 * Math.PI), nc = p.kind === 'screw' ? screwCritical(p.d, p.L) : Infinity;
  return [
    { ok: t.Trms <= mot.Tr, label: 'RMS torque within the motor’s continuous torque (it does not overheat)', detail: `T_rms = ${t.Trms.toFixed(2)} N·m ≤ ${mot.Tr} N·m` },
    { ok: t.Tpk <= 0.9 * mot.Tp, label: 'Peak torque within 90 % of the motor’s peak torque', detail: `T_pk = ${t.Tpk.toFixed(2)} N·m ≤ ${(0.9 * mot.Tp).toFixed(2)} N·m` },
    { ok: t.nM <= mot.nr, label: 'Top speed within the rated speed (full torque available)', detail: `n = ${t.nM.toFixed(0)} rpm ≤ ${mot.nr} rpm` },
    { ok: t.ratio <= 10, label: 'Load inertia at most 10 × the motor inertia (stable, well-tuned servo)', detail: `J_L/J_M = ${t.ratio.toFixed(1)}` },
    ...(p.kind === 'screw' ? [{ ok: nScrew <= 0.8 * nc, label: 'Screw below 80 % of its critical (whirling) speed', detail: `${nScrew.toFixed(0)} rpm ≤ 0.8 × ${nc.toFixed(0)} rpm` }] : []),
    { ok: p.fa <= 0.5, label: 'Move fits: acceleration and deceleration take at most the whole move', detail: `t_a = ${(p.fa * p.tm).toFixed(2)} s` },
  ];
}

export function servo(p: ServoIn) {
  const auto = p.motor === 'auto';
  let mot = MOTORS.find((m) => m.id === p.motor) ?? MOTORS[MOTORS.length - 1];
  if (auto) mot = MOTORS.find((m) => checksFor(p, m, torques(p, m)).every((c) => c.ok)) ?? MOTORS[MOTORS.length - 1];
  const t = torques(p, mot), checks = checksFor(p, mot, t);
  const iOpt = Math.sqrt(t.ld.J / mot.J); // ratio that minimises the motor torque to accelerate a pure inertia
  const nc = p.kind === 'screw' ? screwCritical(p.d, p.L) : NaN;
  return { mot, auto, ...t, iOpt, nc, checks, Pmax: (Math.max(Math.abs(t.Ta), Math.abs(t.Td)) * t.wM) / 1000 };
}
export type ServoResult = ReturnType<typeof servo>;

export const SERVO_INTRO = 'A positioning axis moves a load a set distance in a set time, again and again. The motor must deliver a high torque while it accelerates and brakes, and its average heating — the root-mean-square torque over the whole cycle — must stay within what it can carry continuously. A gearbox trades speed for torque and divides the load’s inertia by the square of its ratio; a servo motor stays well behaved when the load it sees is no more than about ten times its own rotor inertia.';

export const SERVO_NOTES = [
  'Move: symmetric trapezoid (acceleration time = deceleration time = share × move time), then dwell. Load side: ball screw J = m (p/2π)² + π ρ L d⁴/32, torque F p/(2π η) with η = 0.9; belt J = m R² + two aluminium pulleys, torque F R/η with η = 0.95; rotary table J = m R²/2, friction on a bearing at 0.6 R. Force F = process force + μ m g (+ m g on a vertical axis, which also holds through the dwell).',
  'At the motor: J_total = J_M + J_gearbox + J_L/(i² η_g), load torque × safety factor/(i η_g), acceleration torque J_total α. RMS torque √(Σ T² t / t_cycle). Planetary gearbox η 0.97 (one stage, i ≤ 10) or 0.94 (two stages); gearbox input inertia taken as 25 % of the motor’s. Belt stretch, screw stiffness, motor torque drop above the rated speed and the drive’s current limits are not modelled.',
  'Motors: generic 3000 rpm AC servo data rounded from typical catalogues; check the real catalogue (torque–speed curve, brake, encoder, IP rating) before buying. Screw critical speed for pinned–pinned supports (a fixed bearing raises it by about 1.5×); the optimum ratio √(J_L/J_M) minimises the acceleration torque of a pure inertia.',
];
