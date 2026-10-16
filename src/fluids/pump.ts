/**
 * Centrifugal pump on a pipe system: pump curve from three points, system curve from Pipe flow,
 * operating point, single / parallel / series pumps, affinity laws, NPSH.
 * SI units throughout: m, m³/s, Pa, kg/m³, W, rpm ratio r = N/N_rated.
 */
import { G, pipeSection, type Section } from './pipe.ts';

type Check = { ok: boolean; label: string; detail: string };

/* ---------- pump curve ---------- */

/** Rated-speed data: shutoff head H0 [m], duty point (Qd [m³/s], Hd [m]) = best-efficiency point, run-out flow Qmax (H = 0), η at the duty point, NPSH required at the duty point [m]. */
export type Pump = { H0: number; Qd: number; Hd: number; Qmax: number; etaMax: number; NPSHrd: number };

/** H = H0 + a Q + b Q² through (0, H0), (Qd, Hd), (Qmax, 0). */
export function pumpCoeffs(p: Pump) {
  const b = (-p.H0 - (p.Qmax * (p.Hd - p.H0)) / p.Qd) / (p.Qmax * (p.Qmax - p.Qd));
  const a = (p.Hd - p.H0) / p.Qd - b * p.Qd;
  // stable (falling) curve: no rise of head from shutoff, i.e. dH/dQ ≤ 0 at Q = 0
  return { a, b, stable: a <= 1e-12 };
}

/** Head at flow Q and speed ratio r (affinity: H = r² H_rated(Q/r)); 0 beyond run-out. */
export function pumpHead(p: Pump, Q: number, r = 1) {
  const { a, b } = pumpCoeffs(p);
  const x = Q / r;
  if (x > p.Qmax) return 0;
  return Math.max(0, r * r * (p.H0 + a * x + b * x * x));
}

/** Efficiency: parabola through zero at Q = 0 and Q = 2 Q_d, maximum at the duty point; moves with the speed (η(Q, r) = η(Q/r)). */
export function pumpEta(p: Pump, Q: number, r = 1) {
  const x = Q / (r * p.Qd);
  return Math.max(0, p.etaMax * (1 - (x - 1) * (x - 1)));
}

/** NPSH required: ∝ Q² with a floor at half the duty value, and ∝ r² with speed. */
export function npshRequired(p: Pump, Q: number, r = 1) {
  const x = Q / (r * p.Qd);
  return p.NPSHrd * r * r * Math.max(0.5, x * x);
}

/* ---------- arrangement ---------- */

export type Arrangement = { mode: 'single' | 'parallel' | 'series'; n: number };

/** Head of the identical pumps together at total flow Q: parallel adds flows, series adds heads. */
export function combinedHead(p: Pump, arr: Arrangement, Q: number, r = 1) {
  if (arr.mode === 'parallel') return pumpHead(p, Q / arr.n, r);
  if (arr.mode === 'series') return arr.n * pumpHead(p, Q, r);
  return pumpHead(p, Q, r);
}
const count = (arr: Arrangement) => (arr.mode === 'single' ? 1 : arr.n);
/** Largest flow the group can deliver (head 0). */
export const combinedQmax = (p: Pump, arr: Arrangement, r = 1) => (arr.mode === 'parallel' ? arr.n : 1) * r * p.Qmax;

/* ---------- system ---------- */

/** Pipe system (one section from Pipe flow) between two reservoirs: static head plus friction and fittings. */
export type System = { rho: number; mu: number; Hs: number; pipe: Section };

/** Head the system needs at flow Q: H_s + (Δp_f + Δp_m)/(ρ g). */
export function systemHead(s: System, Q: number) {
  const r = pipeSection({ rho: s.rho, mu: s.mu }, Math.max(Q, 1e-9), s.pipe);
  return s.Hs + r.dp / (s.rho * G);
}

/* ---------- vapour pressure and NPSH available ---------- */

/** Water vapour pressure [Pa], Antoine (1…100 °C): log₁₀ p[mmHg] = 8.07131 − 1730.63/(233.426 + T). */
export const vapourPressure = (T: number) => 133.322 * Math.pow(10, 8.07131 - 1730.63 / (233.426 + T));

export type Suction = { pAbs: number; T: number; zs: number; hLossD: number }; // surface pressure [Pa abs], water T [°C], level above pump axis [m], suction-line loss at the duty flow [m]

/** NPSH_a = (p − p_v)/(ρ g) + z_s − h_loss, suction loss ∝ Q². */
export function npshAvailable(s: Suction, rho: number, Q: number, Qd: number) {
  return (s.pAbs - vapourPressure(s.T)) / (rho * G) + s.zs - s.hLossD * (Q / Qd) ** 2;
}

/* ---------- operating point ---------- */

/** Flow where the pump (group) curve meets the system curve: the largest crossing, so a rising piece of the curve cannot hide the stable point. */
export function operatingFlow(p: Pump, arr: Arrangement, r: number, s: System) {
  const Qm = combinedQmax(p, arr, r);
  const g = (Q: number) => combinedHead(p, arr, Q, r) - systemHead(s, Q);
  if (g(0) < 0) return 0; // cannot lift the static head
  const N = 400;
  let hi = Qm, lo = 0, found = false;
  for (let i = N; i >= 1; i--) {
    const q1 = (Qm * i) / N, q0 = (Qm * (i - 1)) / N;
    if (g(q1) <= 0 && g(q0) > 0) { lo = q0; hi = q1; found = true; break; }
  }
  if (!found) return Qm;
  for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (g(m) > 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

export function operatingPoint(p: Pump, arr: Arrangement, r: number, s: System, suc: Suction) {
  const n = count(arr);
  const Q = operatingFlow(p, arr, r, s);
  const H = systemHead(s, Q);
  const q = arr.mode === 'parallel' ? Q / n : Q; // flow through each pump
  const h = arr.mode === 'series' ? H / n : H; // head of each pump
  const eta = pumpEta(p, q, r);
  const Phyd = s.rho * G * Q * H;
  const Pshaft = eta > 0.02 ? (n * s.rho * G * q * h) / eta : Infinity; // all pumps together
  const npshR = npshRequired(p, q, r);
  const npshA = npshAvailable(suc, s.rho, q, p.Qd);
  const bep = q / (r * p.Qd);
  return { Q, H, q, h, eta, Phyd, Pshaft, npshR, npshA, bep, n, v: Q / ((Math.PI / 4) * s.pipe.D ** 2), qBest: r * p.Qd };
}
export type OperatingResult = ReturnType<typeof operatingPoint>;

/* ---------- affinity laws: speed for a target flow, throttling comparison ---------- */

/** Speed ratio at which the group delivers Q_t into the system; null when out of 0.2…1.6. */
export function speedForFlow(p: Pump, arr: Arrangement, s: System, Qt: number) {
  const f = (r: number) => operatingFlow(p, arr, r, s) - Qt;
  let lo = 0.2, hi = 1.6;
  if (f(lo) > 0 || f(hi) < 0) return null;
  for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/** Shaft power to deliver Q_t with the rated speed and a throttling valve (pump runs at its own head H_p(Q_t); the valve burns the excess) against a speed-controlled pump. */
export function throttlingVsSpeed(p: Pump, arr: Arrangement, s: System, Qt: number) {
  const n = count(arr);
  const per = (r: number, H: number) => {
    const q = arr.mode === 'parallel' ? Qt / n : Qt, h = arr.mode === 'series' ? H / n : H;
    const eta = pumpEta(p, q, r);
    return eta > 0.02 ? (n * s.rho * G * q * h) / eta : Infinity;
  };
  const Hsys = systemHead(s, Qt);
  const Hp = combinedHead(p, arr, Qt, 1);
  const r = speedForFlow(p, arr, s, Qt);
  return { throttled: Hp >= Hsys ? per(1, Hp) : Infinity, Hp, Hsys, r, speed: r ? per(r, Hsys) : Infinity };
}

/* ---------- checks ---------- */

export function pumpChecks(p: Pump, r: number, op: OperatingResult, s: System, arr: Arrangement): Check[] {
  const out: Check[] = [];
  out.push({ ok: op.Q > 0, label: 'The pump lifts the static head (shutoff head above H_s)', detail: `shutoff ${combinedHead(p, arr, 0, r).toFixed(1)} m vs H_s ${s.Hs.toFixed(1)} m` });
  out.push({ ok: op.bep >= 0.7 && op.bep <= 1.2, label: 'Operating flow within 70…120 % of the best-efficiency flow', detail: `${(op.bep * 100).toFixed(0)} % of Q_BEP` });
  out.push({ ok: op.npshA >= 1.3 * op.npshR, label: 'NPSH available ≥ 1.3 × NPSH required (cavitation margin)', detail: `NPSH_a ${op.npshA.toFixed(1)} m vs 1.3 NPSH_r ${(1.3 * op.npshR).toFixed(1)} m` });
  out.push({ ok: pumpCoeffs(p).stable, label: 'Pump curve falls steadily from shutoff (stable)', detail: pumpCoeffs(p).stable ? 'dH/dQ ≤ 0' : 'head rises first: may hunt in parallel' });
  out.push({ ok: op.v >= 0.5 && op.v <= 3, label: 'Pipe velocity 0.5…3 m/s (usual range for water)', detail: `v = ${op.v.toFixed(2)} m/s` });
  out.push({ ok: r <= 1.1, label: 'Speed ≤ 110 % of the rated speed', detail: `speed ${(r * 100).toFixed(0)} % of rated` });
  return out;
}

export const PUMP_INTRO = 'A centrifugal pump delivers less head the more flow you ask of it; the pipe asks for more head the more flow you push. The pump runs where the two curves cross. Blue = pump curve, orange = system curve; the white dots follow the flow, the impeller turns with the speed ratio.';

export const PUMP_NOTES = [
  'Pump curve: a parabola H = H₀ + a Q + b Q² through the three points you give (shutoff, duty, run-out). Real curves come from the manufacturer’s test; replace the three points with catalogue values. The duty point is taken as the best-efficiency point (BEP). Efficiency is a parabola, zero at Q = 0 and 2 Q_BEP.',
  'System curve: H = H_s + (friction + fittings)/(ρ g) of one pipe from Pipe flow (Colebrook–White, K minor losses), water properties at your temperature. Pumps in parallel add flows at equal head, pumps in series add heads at equal flow; identical pumps only. The operating point is the largest flow where the curves cross.',
  'Affinity laws: Q ∝ N, H ∝ N², P ∝ N³ with constant efficiency; in practice efficiency falls a little when the speed is far from rated. NPSH required is a typical shape (∝ Q², floor at half the duty value, ∝ N²): use the manufacturer’s NPSH curve. NPSH available = (p − p_v)/(ρ g) + z_s − h_loss with Antoine vapour pressure; the 1.3 margin is a rule of thumb.',
  'Not modelled: system curve changes by valve position other than the fittings you count, unequal pumps, minimum-flow and recirculation, viscosity correction for oils, motor and drive efficiency, pump start-up.',
];
