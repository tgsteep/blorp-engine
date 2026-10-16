/**
 * Pumped hydro storage: two reservoirs, one waterway, reversible Francis pump-turbines.
 * Generating: P = ρ g Q (H_g − h_L) η_t η_mg η_tr; pumping: P_p = ρ g Q_p (H_g + h_L)/(η_p η_mg η_tr).
 * The stored volume is what the units use in t_s hours at rated power at the mean head; pumping takes it back with the
 * pumping power you set. Head loss: Colebrook (fluids/pipe.ts) in a steel-lined waterway; water hammer and wall from
 * hydro.ts. Reservoirs prismatic: levels move linearly with the stored volume. SI units, power W, energy Wh.
 */
import { G, nQE, NQE_RANGE, penstockLoss, penstockWall, RHO, SYNC_RPM, francis } from './hydro.ts';

export const ETA = { turbine: 0.92, pump: 0.91, motorGen: 0.985, transformer: 0.995 };
export const HEAD_RATIO_MAX = 1.25; // single-speed pump-turbine: usual limit of H_max/H_min

export type PumpedIn = {
  Hg: number;        // gross head between the mean reservoir levels [m]
  P: number;         // rated generating power at the grid, all units [W]
  ts: number;        // hours at rated power from a full upper reservoir [h]
  units: number;
  pumpRatio: number; // pumping power taken from the grid / generating power
  L: number;         // waterway length (headrace + penstock + tailrace) [m]
  D: number;         // waterway diameter [m]
  K: number;         // minor losses: intakes, bends, valve, outlet
  du: number;        // usable depth (drawdown) of the upper reservoir [m]
  dl: number;        // usable depth of the lower reservoir [m]
  tc: number;        // closing time on load rejection [s]
  cOff: number;      // price paid for pumping energy [€/MWh]
  cPeak: number;     // price earned for generated energy [€/MWh]
  cycles: number;    // full cycles a year
};

const pipe = (p: PumpedIn) => ({ L: p.L, D: p.D, mat: 'steel' as const, K: p.K });
/** Root of a function that rises with Q, by doubling the bracket and bisection. */
function rising(f: (Q: number) => number, Q0: number) {
  let lo = 0, hi = Math.max(Q0, 1e-6);
  for (let i = 0; i < 60 && f(hi) < 0; i++) { lo = hi; hi *= 2; }
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

export function pumped(p: PumpedIn) {
  const units = Math.max(1, Math.round(p.units));
  const etaGen = ETA.turbine * ETA.motorGen * ETA.transformer, etaPump = ETA.pump * ETA.motorGen * ETA.transformer;
  // generating flow: the power at the grid rises with Q until friction eats the head (maximum at h_L ≈ H_g/3)
  const Pgen = (Q: number) => RHO * G * Q * Math.max(p.Hg - penstockLoss(pipe(p), Q).h, 0) * etaGen;
  let a = 0, b = Math.sqrt((2 * G * p.Hg) / (1 + p.K)) * (Math.PI / 4) * p.D * p.D; // no friction: all head as velocity
  for (let i = 0; i < 60; i++) { const m = (a + b) / 2; if (p.Hg - penstockLoss(pipe(p), m).h > 0) a = m; else b = m; }
  let x0 = 0, x1 = a; // golden section for the power maximum on the rising branch
  for (let i = 0; i < 60; i++) { const m1 = x1 - 0.618 * (x1 - x0), m2 = x0 + 0.618 * (x1 - x0); if (Pgen(m1) < Pgen(m2)) x0 = m1; else x1 = m2; }
  const Qpeak = (x0 + x1) / 2, genOk = Pgen(Qpeak) >= p.P;
  let Qg = Qpeak;
  if (genOk) { let lo = 0, hi = Qpeak; for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (Pgen(m) < p.P) lo = m; else hi = m; } Qg = (lo + hi) / 2; }
  const lossG = penstockLoss(pipe(p), Qg), Hn = p.Hg - lossG.h;
  const Pg = genOk ? p.P : Pgen(Qg);
  // pumping flow from the pumping power
  const Pp = p.P * p.pumpRatio;
  const Qp = rising((Q) => (RHO * G * Q * (p.Hg + penstockLoss(pipe(p), Q).h)) / etaPump - Pp, Qg || 1);
  const lossP = penstockLoss(pipe(p), Qp), Hp = p.Hg + lossP.h;
  // storage
  const V = Qg * p.ts * 3600;
  const Eout = Pg * p.ts, tp = Qp > 0 ? V / Qp / 3600 : Infinity, Ein = Pp * tp;
  const etaRT = Ein > 0 ? Eout / Ein : 0;
  const hydGen = Hn / p.Hg, hydPump = p.Hg / Hp;
  // reservoirs: prismatic, levels linear in the stored volume
  const Au = V / p.du, Al = V / p.dl;
  const Hmax = p.Hg + (p.du + p.dl) / 2, Hmin = p.Hg - (p.du + p.dl) / 2;
  const density = (RHO * G * p.Hg * etaGen * hydGen) / 3.6e6; // kWh per m³ generated
  // machines: reversible Francis, fastest synchronous speed with n_QE (turbine mode) in the Francis range
  const Qu = Qg / units, Hd = Math.max(Hn, 0.02 * p.Hg);
  const speeds = SYNC_RPM.map((rpm) => ({ rpm, nqe: nQE(rpm, Qu, Hd) }));
  const [lo, hi] = NQE_RANGE.francis;
  const fit = speeds.find((x) => x.nqe >= lo && x.nqe <= hi) ?? speeds.reduce((a, b) => (Math.abs(Math.log(b.nqe / 0.15)) < Math.abs(Math.log(a.nqe / 0.15)) ? b : a));
  const runner = francis(Hd, fit.rpm, fit.nqe);
  const inRange = fit.nqe >= lo && fit.nqe <= hi;
  // waterway wall and water hammer on load rejection (generating flow), design pressure from the highest head
  const wall = penstockWall({ D: p.D, L: p.L, Hg: Hmax, mat: 'steel', tc: p.tc }, lossG.v);
  // money (prices per MWh, energies in Wh)
  const perCycle = (Eout / 1e6) * p.cPeak - (Ein / 1e6) * p.cOff;
  const perYear = perCycle * p.cycles;
  const breakEven = etaRT > 0 ? 1 / etaRT : Infinity;
  const v = Math.max(lossG.v, lossP.v);

  const checks: { ok: boolean; label: string; detail: string }[] = [
    { ok: genOk, label: 'The waterway can carry the rated power (friction does not eat the head)', detail: genOk ? `Q = ${Qg.toFixed(1)} m³/s` : `at most ${(Pg / 1e6).toFixed(1)} MW` },
    { ok: lossG.h <= 0.05 * p.Hg, label: 'Head loss when generating at most 5 % of the gross head', detail: `h_L = ${lossG.h.toFixed(2)} m = ${((100 * lossG.h) / p.Hg).toFixed(1)} %` },
    { ok: v <= 6, label: 'Waterway velocity at most 6 m/s', detail: `v = ${v.toFixed(2)} m/s` },
    { ok: p.L >= p.Hg, label: 'Waterway at least as long as the drop', detail: `L = ${p.L.toFixed(0)} m, H_g = ${p.Hg.toFixed(0)} m` },
    { ok: Hmin > 0 && Hmax / Hmin <= HEAD_RATIO_MAX, label: 'Head range suits a single-speed pump-turbine: H_max/H_min ≤ 1.25', detail: `${Hmax.toFixed(1)}/${Hmin.toFixed(1)} m = ${(Hmax / Hmin).toFixed(3)}` },
    { ok: inRange, label: 'Pump-turbine specific speed in the Francis range', detail: `n_QE = ${fit.nqe.toFixed(3)} at ${fit.rpm.toFixed(0)} rpm (0.05…0.33)` },
    { ok: tp + p.ts <= 24, label: 'Pumping and generating fit into one day', detail: `${tp.toFixed(1)} h + ${p.ts.toFixed(1)} h` },
    { ok: wall.dh <= 0.5 * p.Hg, label: 'Pressure rise on load rejection at most 50 % of the static head', detail: `Δh = ${wall.dh.toFixed(1)} m, t_c = ${p.tc.toFixed(1)} s, 2L/c = ${wall.Tcrit.toFixed(2)} s` },
    { ok: etaRT >= 0.7, label: 'Round-trip efficiency at least 70 % (usual for modern plants)', detail: `η_rt = ${(etaRT * 100).toFixed(1)} %` },
    { ok: p.cPeak * etaRT > p.cOff, label: 'The peak price pays for the pumping energy: c_peak η_rt > c_off', detail: `${(p.cPeak * etaRT).toFixed(1)} > ${p.cOff.toFixed(1)} €/MWh` },
  ];
  return {
    units, etaGen, etaPump, Qg, Qp, lossG, lossP, Hn, Hp, Pg, Pp, V, Eout, Ein, tp, etaRT, hydGen, hydPump, Au, Al, Hmax, Hmin,
    density, rpm: fit.rpm, nqe: fit.nqe, runner, Qu, wall, perCycle, perYear, breakEven, checks,
  };
}
export type PumpedResult = ReturnType<typeof pumped>;

/** Where the energy goes in one cycle, as fractions of the pumping energy taken from the grid. */
export function lossSteps(r: PumpedResult) {
  const steps: [string, number][] = [];
  let e = 1;
  const take = (label: string, eta: number) => { const lost = e * (1 - eta); steps.push([label, lost]); e -= lost; };
  take('transformer, pumping', ETA.transformer); take('motor', ETA.motorGen); take('pump', ETA.pump); take('waterway, pumping', r.hydPump);
  take('waterway, generating', r.hydGen); take('turbine', ETA.turbine); take('generator', ETA.motorGen); take('transformer, generating', ETA.transformer);
  return { steps, out: e };
}

/** Day schedule: pumping centred on 03:00, generating centred on 18:00 (hours may wrap past midnight). */
export function daySchedule(r: PumpedResult, ts: number) {
  const pumpStart = 3 - r.tp / 2, genStart = 18 - ts / 2;
  const inBlock = (h: number, s: number, d: number) => (((h - s) % 24) + 24) % 24 < d;
  const mode = (h: number): 'pump' | 'gen' | 'idle' => (inBlock(h, genStart, ts) ? 'gen' : inBlock(h, pumpStart, Math.min(r.tp, 24)) ? 'pump' : 'idle');
  /** Stored share 0…1 (upper reservoir) at hour h: full at the end of pumping, empty at the end of generating. */
  const stored = (h: number) => {
    const sinceP = (((h - pumpStart) % 24) + 24) % 24, sinceG = (((h - genStart) % 24) + 24) % 24;
    if (sinceG < ts) return 1 - sinceG / ts;
    if (sinceP < r.tp) return Math.min(1, sinceP / r.tp);
    return sinceP < sinceG ? 1 : 0; // idle after pumping: full; idle after generating: empty
  };
  return { pumpStart, genStart, mode, stored };
}

export type PumpedKind = 'large' | 'medium' | 'small';
export const PUMPED_PRESETS: Record<PumpedKind, PumpedIn> = {
  large: { Hg: 500, P: 1.6e9, ts: 6, units: 6, pumpRatio: 1.05, L: 3000, D: 9.5, K: 1.5, du: 30, dl: 15, tc: 15, cOff: 40, cPeak: 120, cycles: 300 },
  medium: { Hg: 300, P: 4e8, ts: 8, units: 2, pumpRatio: 1.05, L: 1500, D: 6.5, K: 1.5, du: 20, dl: 10, tc: 15, cOff: 40, cPeak: 120, cycles: 300 },
  small: { Hg: 120, P: 2e7, ts: 6, units: 1, pumpRatio: 1.05, L: 500, D: 2.6, K: 1.5, du: 8, dl: 4, tc: 8, cOff: 40, cPeak: 120, cycles: 300 },
};

export const PUMPED_INTRO = 'A pumped-storage plant is a water battery: when power is cheap it pumps water up to a high reservoir, when power is needed it lets the water down through the same machines running as turbines. The energy stored is the weight of the water times the height, E = ρ g V H, so high heads need far less water. Every kilowatt-hour goes through the pump, the waterway twice and the turbine, and about three quarters comes back.';

export const PUMPED_NOTES = [
  'Generating: P = ρ g Q (H_g − h_L) η_t η_mg η_tr, solved for Q at the rated power and the mean head; pumping: P_p = ρ g Q_p (H_g + h_L)/(η_p η_mg η_tr) with the pumping power you set. Best efficiencies of a modern reversible Francis pump-turbine: turbine 0.92, pump 0.91, motor-generator 0.985, transformer 0.995 (typical published values); constant over the cycle, auxiliaries and standby losses not included.',
  'Stored volume = generating flow × hours at rated power. Reservoirs prismatic, so the levels move linearly with the stored volume and the gross head swings by half the two drawdowns either side of the mean; a single-speed pump-turbine usually needs H_max/H_min ≤ 1.25, variable-speed units accept more. The day schedule centres pumping on 03:00 and generating on 18:00, only to show the cycle.',
  'Waterway: one steel-lined conduit of the given length and diameter (headrace, penstock and tailrace together), Colebrook–White with 0.6 mm roughness at 10 °C, minor losses as one K. Water hammer on load rejection as in the hydropower tool (Korteweg, Joukowsky / Michaud), wall from the hoop stress at the highest head plus the surge; real plants use surge tanks and close the guide vanes in steps.',
  'The pump-turbine speed is the fastest 50 Hz synchronous speed whose turbine-mode n_QE lies in the Francis range of the ESHA guide, and the runner sizes use the turbine correlations (a pump-turbine runner is larger and flatter). Pump-mode cavitation needs the machines deep below the lower reservoir; this setting is not calculated.',
  'Money: revenue per cycle = energy out × peak price − energy in × off-peak price, times cycles a year; no capacity payments, grid fees, ancillary services or investment. Storage only pays when the peak price is above the off-peak price divided by the round-trip efficiency.',
  'In 3D the waterway is cut open along its axis and drawn thicker than to scale, and the powerhouse cavern with the pump-turbines is drawn larger than to scale so the machines can be seen. The white dots are the water: down through the units when generating, up when pumping; the generator-motors turn green when generating and blue when pumping.',
];
