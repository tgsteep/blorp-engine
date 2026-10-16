/**
 * Concentric, axially loaded bolted joint — follows the method of VDI 2230 Part 1, simplified.
 * Units: N, mm, MPa. See ASSUMPTIONS for what is left out.
 */
import { E_STEEL, strength, type PropertyClass, type Thread } from './data.ts';

export type AxialInput = {
  thread: Thread;
  pc: PropertyClass;
  mu: number; // μ_G = μ_K
  alphaA: number; // tightening factor
  lk: number; // clamp length [mm]
  DA: number; // outer diameter of clamped parts [mm]
  FA: number; // axial working load [N]
  FKerf: number; // required residual clamp load [N]
};

export const NU = 0.9; // yield utilisation at assembly
export const N_LOAD = 0.5; // load introduction factor
export const F_Z_UM = 9.5; // embedding [µm]: thread 3 + head 2.5 + nut 2.5 + one interface 1.5

export const AXIAL_ASSUMPTIONS =
  'ISO 4762 cap screw with nut, fully threaded inside the clamp, steel parts (E = 205 GPa), ν = 0.9, n = 0.5, μ_G = μ_K, one inner interface (f_Z = 9.5 µm), k_τ = 0.5, deformation sleeve after VDI 2230 (1986), rolled thread fatigue limit. No bending, transverse load or surface pressure check.';

export function computeAxial(p: AxialInput) {
  const t = p.thread;
  const { Rp } = strength(p.pc, t.d);
  const E = E_STEEL, lk = p.lk, mu = p.mu;
  const AN = (Math.PI * t.d ** 2) / 4, Ad3 = (Math.PI * t.d3 ** 2) / 4, ds = (t.d2 + t.d3) / 2;

  // resilience of the bolt: head 0.4d, clamped thread on A_d3, engaged thread 0.5d, nut 0.4d
  const dS = (0.4 * t.d) / (E * AN) + lk / (E * Ad3) + (0.5 * t.d) / (E * Ad3) + (0.4 * t.d) / (E * AN);

  // clamped parts: equivalent sleeve (VDI 2230:1986)
  const DA = Math.max(p.DA, t.dh + 1);
  const base = (Math.PI / 4) * (t.dW ** 2 - t.dh ** 2);
  let Aers: number;
  if (DA <= t.dW) Aers = (Math.PI / 4) * (DA ** 2 - t.dh ** 2);
  else if (DA <= t.dW + lk) {
    const x = Math.cbrt((lk * t.dW) / DA ** 2);
    Aers = base + (Math.PI / 8) * t.dW * (DA - t.dW) * ((x + 1) ** 2 - 1);
  } else Aers = (Math.PI / 4) * ((t.dW + lk / 10) ** 2 - t.dh ** 2);
  const dP = lk / (E * Aers);
  const Phi = (N_LOAD * dP) / (dS + dP);

  // assembly preload and torque
  const k = 1.5 * (t.d2 / ds) * (t.P / (Math.PI * t.d2) + 1.155 * mu);
  const FMzul = (t.As * NU * Rp) / Math.sqrt(1 + 3 * k * k);
  const DKm = (t.dW + t.dh) / 2;
  const MA = (FMzul * (0.16 * t.P + 0.58 * t.d2 * mu + (mu * DKm) / 2)) / 1000; // N·m
  const FZ = F_Z_UM / 1000 / (dS + dP);
  const FMmin = FMzul / p.alphaA;

  // working state
  const FSA = Phi * p.FA, FPA = (1 - Phi) * p.FA;
  const FKR = FMmin - FZ - FPA;
  const FSmax = FMzul + FSA;
  const sz = FSmax / t.As;
  const MG = FMzul * (0.16 * t.P + 0.58 * t.d2 * mu);
  const tau = MG / ((Math.PI * ds ** 3) / 16);
  const sred = Math.sqrt(sz ** 2 + 3 * (0.5 * tau) ** 2);
  const SF = Rp / sred;
  const sa = FSA / (2 * t.As);
  const sASV = 0.85 * (150 / t.d + 45);
  const SD = sa > 0 ? sASV / sa : Infinity;

  // joint diagram with n-modified resiliences (µm, N)
  const dSn = dS + (1 - N_LOAD) * dP, dPn = N_LOAD * dP;
  const Fm2 = Math.max(FMmin - FZ, 0);
  const diagram = {
    fSM: FMzul * dSn * 1000, fPM: FMzul * dPn * 1000, df: FSA * dSn * 1000,
    fSM2: Fm2 * dSn * 1000, fPM2: Fm2 * dPn * 1000, Fm2,
  };

  const checks = [
    { ok: FKR >= p.FKerf, label: 'Residual clamp load F_KR ≥ F_K,erf', detail: `${(FKR / 1000).toFixed(2)} ≥ ${(p.FKerf / 1000).toFixed(1)} kN` },
    { ok: SF >= 1, label: 'Working stress S_F = R_p0.2/σ_red ≥ 1.0', detail: `S_F = ${SF.toFixed(2)}` },
    { ok: SD >= 1.2, label: 'Fatigue S_D = σ_ASV/σ_a ≥ 1.2', detail: `S_D = ${Number.isFinite(SD) ? SD.toFixed(2) : '∞'}` },
  ];

  return { Rp, DA, dS, dP, Aers, Phi, FMzul, MA, FZ, FMmin, FSA, FPA, FKR, FSmax, sred, SF, sa, sASV, SD, diagram, checks };
}
export type AxialResult = ReturnType<typeof computeAxial>;
