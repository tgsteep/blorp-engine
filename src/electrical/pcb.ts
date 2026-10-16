/**
 * Printed circuit board traces: width for a current after IPC-2221 (the IPC-D-275 design curves,
 * I = k ΔT^0.44 A^0.725 with A in mil², k 0.048 outer / 0.024 inner layers), resistance, voltage drop and heat,
 * vias for the current, Onderdonk fusing current, and the minimum spacing for a voltage (IPC-2221 Table 6-1).
 */
export const MIL = 25.4e-6;                 // 1 mil [m]
export const OZ = 34.79e-6;                 // copper thickness of 1 oz/ft² [m] (≈ 35 µm)
export const RHO_CU = 1.724e-8, ALPHA_CU = 0.00393; // annealed copper at 20 °C [Ω·m], [1/K]
export const T_MELT = 1083;                 // copper melting point [°C]
export const T_BOARD = 105;                 // usual highest continuous temperature for FR-4 boards [°C]

export type Layer = 'outer' | 'inner';
export type PcbIn = {
  I: number;        // current [A]
  dTmax: number;    // allowed temperature rise [K]
  oz: number;       // copper weight [oz/ft²]
  layer: Layer;
  w: number;        // chosen trace width [mm]
  L: number;        // trace length [mm]
  Ta: number;       // ambient (board) temperature [°C]
  V: number;        // voltage to the next conductor [V]
  gap: number;      // chosen gap to the next conductor [mm]
  coated: boolean;  // outer layer under a permanent polymer coating (solder mask alone does not count)
  viaD: number;     // via drill diameter [mm]
  board: number;    // board thickness [mm]
};

export const kOf = (layer: Layer) => (layer === 'outer' ? 0.048 : 0.024);
/** IPC-2221 current for a cross-section A [mil²] and a temperature rise ΔT [K]. */
export const ipcCurrent = (A: number, dT: number, layer: Layer) => kOf(layer) * Math.pow(dT, 0.44) * Math.pow(A, 0.725);
/** Cross-section [mil²] needed for current I at temperature rise ΔT. */
export const ipcArea = (I: number, dT: number, layer: Layer) => Math.pow(I / (kOf(layer) * Math.pow(dT, 0.44)), 1 / 0.725);
/** Temperature rise [K] of a cross-section A [mil²] carrying I. */
export const ipcRise = (I: number, A: number, layer: Layer) => Math.pow(I / (kOf(layer) * Math.pow(A, 0.725)), 1 / 0.44);
/** Required width [mm] for a current. */
export const widthFor = (I: number, dT: number, oz: number, layer: Layer) => (ipcArea(I, dT, layer) / ((oz * OZ) / MIL)) * MIL * 1e3;

/** Onderdonk fusing current [A] of a copper conductor of cross-section A [m²] for a time t [s] from ambient T_a. */
export const fusing = (A: number, t: number, Ta: number) => {
  const cmil = (A / (MIL * MIL)) * (4 / Math.PI);
  return cmil * Math.sqrt(Math.log10((T_MELT - Ta) / (234 + Ta) + 1) / (33 * t));
};

/** IPC-2221 Table 6-1 minimum conductor spacing [mm]: B1 inner layers, B2 outer uncoated (sea level to 3050 m), B4 outer with permanent polymer coating. */
const SPACING: { v: number; B1: number; B2: number; B4: number }[] = [
  { v: 15, B1: 0.05, B2: 0.1, B4: 0.05 }, { v: 30, B1: 0.05, B2: 0.1, B4: 0.05 }, { v: 50, B1: 0.1, B2: 0.6, B4: 0.13 },
  { v: 100, B1: 0.1, B2: 0.6, B4: 0.13 }, { v: 150, B1: 0.2, B2: 0.6, B4: 0.4 }, { v: 170, B1: 0.2, B2: 1.25, B4: 0.4 },
  { v: 250, B1: 0.2, B2: 1.25, B4: 0.4 }, { v: 300, B1: 0.2, B2: 1.25, B4: 0.4 }, { v: 500, B1: 0.25, B2: 2.5, B4: 0.8 },
];
const PER_V = { B1: 0.0025, B2: 0.005, B4: 0.00305 };
export type SpacingClass = 'B1' | 'B2' | 'B4';
export const spacingClass = (layer: Layer, coated: boolean): SpacingClass => (layer === 'inner' ? 'B1' : coated ? 'B4' : 'B2');
export function minSpacing(V: number, cls: SpacingClass) {
  const row = SPACING.find((r) => V <= r.v);
  return row ? row[cls] : PER_V[cls] * V;
}

export const VIA_PLATING = 25e-6; // copper in the via barrel [m] (IPC-6012 class 2 asks ≥ 20 µm average)

export function pcb(p: PcbIn) {
  const t = p.oz * OZ, tMil = t / MIL;
  const wReq = widthFor(p.I, p.dTmax, p.oz, p.layer);
  const A = (p.w / 1e3) * t, Amil = A / (MIL * MIL);
  const dT = ipcRise(p.I, Amil, p.layer), T = p.Ta + dT;
  const rho = RHO_CU * (1 + ALPHA_CU * (T - 20));
  const R = (rho * (p.L / 1e3)) / A, dU = p.I * R, P = p.I * p.I * R;
  const Ifuse1 = fusing(A, 1, p.Ta), Ifuse10ms = fusing(A, 0.01, p.Ta);
  const Imax = ipcCurrent(Amil, p.dTmax, p.layer);
  // via: plated barrel as a tube, rated like an outer-layer conductor
  const d = p.viaD / 1e3, Avia = Math.PI * (d - VIA_PLATING) * VIA_PLATING;
  const Ivia = ipcCurrent(Avia / (MIL * MIL), p.dTmax, 'outer'), nVia = Math.max(1, Math.ceil(p.I / Ivia));
  const Rvia = (RHO_CU * (1 + ALPHA_CU * (T - 20)) * (p.board / 1e3)) / Avia;
  const cls = spacingClass(p.layer, p.coated), sMin = minSpacing(p.V, cls);
  const checks = [
    { ok: dT <= p.dTmax + 1e-9, label: 'Trace wide enough: temperature rise within the allowed value', detail: `ΔT = ${dT.toFixed(1)} K ≤ ${p.dTmax} K; width needed ${wReq.toFixed(2)} mm, chosen ${p.w.toFixed(2)} mm` },
    { ok: T <= T_BOARD, label: `Trace temperature ≤ ${T_BOARD} °C (usual limit for FR-4 boards)`, detail: `T = ${p.Ta.toFixed(0)} + ${dT.toFixed(1)} = ${T.toFixed(1)} °C` },
    { ok: p.gap >= sMin, label: 'Gap to the next conductor at least the IPC-2221 minimum for the voltage', detail: `${p.gap.toFixed(2)} mm ≥ ${sMin.toFixed(2)} mm (${cls}, ${p.V.toFixed(0)} V)` },
    { ok: p.w >= 0.15 && p.gap >= 0.15, label: 'Width and gap ≥ 0.15 mm (usual limit of low-cost board makers)', detail: `w = ${p.w.toFixed(2)} mm, gap = ${p.gap.toFixed(2)} mm` },
    { ok: p.I <= 35 && p.w <= 10.16, label: 'Inside the range of the IPC-2221 curves (I ≤ 35 A, w ≤ 10 mm)', detail: `I = ${p.I.toFixed(1)} A, w = ${p.w.toFixed(2)} mm` },
  ];
  return { t, tMil, wReq, A, Amil, dT, T, rho, R, dU, P, Ifuse1, Ifuse10ms, Imax, Avia, Ivia, nVia, Rvia, cls, sMin, checks };
}
export type PcbResult = ReturnType<typeof pcb>;

export const PCB_INTRO = 'A copper trace on a circuit board is a very flat wire: a 1 oz layer is only 35 µm thick, so the current needs width instead. The trace warms until the heat it makes (I²R) leaves through the board and the air; outer layers cool better than inner ones buried in the board. Higher voltages need wider gaps to the next trace so that no spark jumps over or creeps along the surface.';

export const PCB_NOTES = [
  'Width from IPC-2221 (the IPC-D-275 design curves): I = k ΔT^0.44 A^0.725 with A in mil², k = 0.048 for outer and 0.024 for inner layers, fitted for I ≤ 35 A, widths ≤ 400 mil (10 mm), ΔT 10…100 K. The newer IPC-2152 charts show that inner layers in a board with copper planes run about as cool as outer ones, so the inner-layer values here are conservative; nearby heat sources, planes, board thickness and airflow change the real temperature.',
  'Resistance R = ρ L/(w t) with ρ = 1.724·10⁻⁸ Ω·m (1 + 0.00393 (T − 20)) at the trace temperature; 1 oz/ft² = 35 µm (finished outer layers are often thicker after plating). Via: plated barrel 25 µm thick taken as a tube and rated like an outer-layer trace — a common rule of thumb. Fusing current from Onderdonk’s equation for a wire, I = A_cmil √(lg(1 + (T_m − T_a)/(234 + T_a))/(33 t)); a trace on a board cools better, so it fuses a little later.',
  'Minimum spacing from IPC-2221 Table 6-1 (DC or AC peak voltage): B1 inner layers, B2 outer layers uncoated (sea level to 3050 m), B4 outer layers with a permanent polymer coating; mains products must also meet the creepage and clearance of their safety standard (IEC 62368-1, IEC 60664-1), which are usually larger.',
];
