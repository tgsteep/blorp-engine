/**
 * Bolted joint types built on the axial (VDI 2230, simplified) and shear models.
 * Units: N, mm, MPa.
 */
import { computeAxial } from './axial.ts';
import { strength, type PropertyClass, type Thread } from './data.ts';
import { computeShear } from './shear.ts';

export type JointType = 'axial' | 'flange' | 'lap' | 'clevis' | 'bracket';

export const JOINTS: { id: JointType; name: string; short: string }[] = [
  { id: 'axial', name: 'Through-bolt, axial pull', short: 'Axial' },
  { id: 'flange', name: 'Flange, bolt circle', short: 'Flange' },
  { id: 'lap', name: 'Lap joint, single shear', short: 'Lap' },
  { id: 'clevis', name: 'Clevis, double shear', short: 'Clevis' },
  { id: 'bracket', name: 'Eccentric bracket', short: 'Bracket' },
];

export type Check = { ok: boolean; label: string; detail: string };
export type Row = { sym: string; eq: string; val: string; unit?: string };
const f = (v: number, n: number) => (Number.isFinite(v) ? v.toFixed(n) : '—');
const kN = (v: number) => f(v / 1000, 2);

export type Common = { thread: Thread; pc: PropertyClass; mu: number; alphaA: number; S: number; ReP: number };

/** Flange: n bolts on a circle D_t share an axial load F. */
export function computeFlange(c: Common & { n: number; Dt: number; t: number; F: number }) {
  const pitch = (Math.PI * c.Dt) / c.n;
  const DA = Math.min(pitch, c.thread.dW + 2 * c.t);
  const a = computeAxial({ thread: c.thread, pc: c.pc, mu: c.mu, alphaA: c.alphaA, lk: 2 * c.t, DA, FA: c.F / c.n, FKerf: 0 });
  const checks: Check[] = [
    { ok: pitch >= 3 * c.thread.d, label: 'Bolt pitch ≥ 3d (wrench room)', detail: `${f(pitch, 1)} ≥ ${3 * c.thread.d} mm` },
    { ok: a.FKR > 0, label: 'Flange stays closed: F_KR > 0', detail: `F_KR = ${kN(a.FKR)} kN per bolt` },
    ...a.checks.slice(1),
  ];
  const rows: Row[] = [
    { sym: 'F_A', eq: `F/n = ${kN(c.F)}/${c.n}`, val: kN(c.F / c.n), unit: 'kN' },
    { sym: 'p', eq: `π·D_t/n`, val: f(pitch, 1), unit: 'mm' },
    { sym: 'F_M,zul', eq: 'assembly preload per bolt', val: kN(a.FMzul), unit: 'kN' },
    { sym: 'M_A', eq: 'tightening torque', val: f(a.MA, 0), unit: 'N·m' },
    { sym: 'Φ_n', eq: 'load factor', val: f(a.Phi, 3) },
    { sym: 'F_KR', eq: 'F_M,min − F_Z − F_PA', val: kN(a.FKR), unit: 'kN' },
  ];
  return { axial: a, pitch, checks, rows };
}

/** Lap joint: n bolts, single shear. Friction grip first; bearing-type shear/bending if it slips. */
export function computeLap(c: Common & { n: number; t: number; FQ: number; muT: number }) {
  const a = computeAxial({ thread: c.thread, pc: c.pc, mu: c.mu, alphaA: c.alphaA, lk: 2 * c.t, DA: c.thread.dW + 2 * c.t, FA: 0, FKerf: 0 });
  const clamp = a.FMmin - a.FZ; // per bolt, worst case
  const SG = (c.n * c.muT * clamp) / c.FQ; // slip safety
  const Fb = c.FQ / c.n; // per bolt if slipped
  const { Rp } = strength(c.pc, c.thread.d);
  const d3 = c.thread.d3;
  const Mmax = (Fb * c.t) / 2; // uniform bearing, couple taken by head and nut
  const sb = Mmax / ((Math.PI * d3 ** 3) / 32);
  const tau = Fb / c.thread.As; // thread in the shear plane (conservative)
  const p = Fb / (c.thread.d * c.t);
  // V(x), M(x) along the bolt from the head face, plate 1 then plate 2
  const L = 2 * c.t, N = 60;
  const xs = [...Array.from({ length: N + 1 }, (_, i) => (L * i) / N), c.t].sort((x, y) => x - y);
  const Vs = xs.map((x) => (x <= c.t ? (Fb * x) / c.t : Fb * (1 - (x - c.t) / c.t)));
  const Ms = xs.map((x) => (x <= c.t ? -Mmax + (Fb * x * x) / (2 * c.t) : Mmax - (Fb * (L - x) ** 2) / (2 * c.t)));
  const checks: Check[] = [
    { ok: SG >= 1.25, label: 'No slip: S_G = n·μ_T·(F_M,min − F_Z)/F_Q ≥ 1.25', detail: `S_G = ${f(SG, 2)}` },
    { ok: tau <= Rp / (Math.sqrt(3) * c.S), label: 'If slipped: shear τ ≤ R_p0.2/(√3·S)', detail: `${f(tau, 0)} ≤ ${f(Rp / (Math.sqrt(3) * c.S), 0)} MPa` },
    { ok: sb <= Rp / c.S, label: 'If slipped: bending σ_b ≤ R_p0.2/S', detail: `${f(sb, 0)} ≤ ${f(Rp / c.S, 0)} MPa` },
    { ok: p <= c.ReP / c.S, label: 'If slipped: bearing p ≤ R_e,plate/S', detail: `${f(p, 0)} ≤ ${f(c.ReP / c.S, 0)} MPa` },
  ];
  const rows: Row[] = [
    { sym: 'F_M,min', eq: 'F_M,zul/α_A per bolt', val: kN(a.FMmin), unit: 'kN' },
    { sym: 'F_Z', eq: 'embedding loss', val: kN(a.FZ), unit: 'kN' },
    { sym: 'S_G', eq: 'n·μ_T·(F_M,min − F_Z)/F_Q', val: f(SG, 2) },
    { sym: 'F_b', eq: `F_Q/n = ${kN(c.FQ)}/${c.n}`, val: kN(Fb), unit: 'kN' },
    { sym: 'τ', eq: 'F_b/A_s', val: f(tau, 0), unit: 'MPa' },
    { sym: 'M_max', eq: 'F_b·t/2 (at head and nut)', val: f(Mmax / 1000, 2), unit: 'N·m' },
    { sym: 'σ_b', eq: 'M_max/(π·d₃³/32)', val: f(sb, 0), unit: 'MPa' },
    { sym: 'p', eq: 'F_b/(d·t)', val: f(p, 0), unit: 'MPa' },
  ];
  return { axial: a, SG, Fb, Mmax, xs, Vs, Ms, L, checks, rows };
}

/** Clevis: n pins in double shear share F. */
export function computeClevis(c: Common & { n: number; F: number; tS: number; tG: number }) {
  const { Rp } = strength(c.pc, c.thread.d);
  const s = computeShear({ d: c.thread.d, F: c.F / c.n, tS: c.tS, tG: c.tG, Rp, ReP: c.ReP, S: c.S });
  const rows: Row[] = [
    { sym: 'F_b', eq: `F/n = ${kN(c.F)}/${c.n}`, val: kN(c.F / c.n), unit: 'kN' },
    { sym: 'M_max', eq: 'F_b(t_S + 2t_G)/8', val: f(s.Mmax / 1000, 2), unit: 'N·m' },
    { sym: 'σ_b', eq: 'M_max/(πd³/32)', val: f(s.sb, 0), unit: 'MPa' },
    { sym: 'τ_max', eq: '4/3·(F_b/2)/A', val: f(s.tauMax, 0), unit: 'MPa' },
    { sym: 'p_S', eq: 'F_b/(d·t_S)', val: f(s.pS, 0), unit: 'MPa' },
    { sym: 'p_G', eq: '(F_b/2)/(d·t_G)', val: f(s.pG, 0), unit: 'MPa' },
  ];
  return { shear: s, checks: s.checks, rows };
}

/** Eccentric bracket: rows × cols bolt group, vertical load P at offset e from the group centroid (elastic method). */
export function computeBracket(c: Common & { rows: number; cols: number; p: number; g: number; P: number; e: number; t: number }) {
  const bolts: { x: number; y: number; r: number; fx: number; fy: number; F: number }[] = [];
  for (let i = 0; i < c.rows; i++)
    for (let j = 0; j < c.cols; j++)
      bolts.push({ x: (j - (c.cols - 1) / 2) * c.g, y: ((c.rows - 1) / 2 - i) * c.p, r: 0, fx: 0, fy: 0, F: 0 });
  const n = bolts.length;
  const M = c.P * c.e;
  const sumR2 = bolts.reduce((s, b) => s + b.x * b.x + b.y * b.y, 0) || 1;
  // load P acts downward (−y) at x = +e → clockwise moment; secondary force on bolt ⟂ radius
  for (const b of bolts) {
    b.r = Math.hypot(b.x, b.y);
    const k = M / sumR2;
    b.fx = k * b.y; // clockwise: F'' = k·(y, −x)
    b.fy = -c.P / n - k * b.x;
    b.F = Math.hypot(b.fx, b.fy);
  }
  const Fmax = Math.max(...bolts.map((b) => b.F));
  const { Rp } = strength(c.pc, c.thread.d);
  const tau = Fmax / c.thread.As;
  const pB = Fmax / (c.thread.d * c.t);
  const checks: Check[] = [
    { ok: tau <= Rp / (Math.sqrt(3) * c.S), label: 'Most loaded bolt: τ ≤ R_p0.2/(√3·S)', detail: `${f(tau, 0)} ≤ ${f(Rp / (Math.sqrt(3) * c.S), 0)} MPa` },
    { ok: pB <= c.ReP / c.S, label: 'Bearing p ≤ R_e,plate/S', detail: `${f(pB, 0)} ≤ ${f(c.ReP / c.S, 0)} MPa` },
  ];
  const rows: Row[] = [
    { sym: "F'", eq: `P/n = ${kN(c.P)}/${n} (direct)`, val: kN(c.P / n), unit: 'kN' },
    { sym: 'M', eq: `P·e = ${kN(c.P)}×${c.e}`, val: f(M / 1e6, 2), unit: 'kN·m' },
    { sym: 'Σr²', eq: 'Σ(x² + y²)', val: f(sumR2, 0), unit: 'mm²' },
    { sym: "F''_max", eq: 'M·r_max/Σr² (moment share)', val: kN((M * Math.max(...bolts.map((b) => b.r))) / sumR2), unit: 'kN' },
    { sym: 'F_max', eq: "|F' + F''| most loaded bolt", val: kN(Fmax), unit: 'kN' },
    { sym: 'τ', eq: 'F_max/A_s', val: f(tau, 0), unit: 'MPa' },
  ];
  return { bolts, Fmax, M, sumR2, checks, rows };
}
