/**
 * Bolt tightening torque and assembly preload after VDI 2230-1:2015 (the formula behind its Table A1):
 * the bolt is tightened until the von Mises stress in the thread core (tension + thread torsion) reaches
 * ν × R_p0.2, then M_A = F_M (0.16 P + 0.58 d₂ μ_G + D_Km/2 μ_K).
 * Threads ISO 261/724, hex head bearing diameter d_w (ISO 4014/4017), medium clearance hole ISO 273,
 * property classes ISO 898-1 and ISO 3506-1.
 */

export type ThreadRow = {
  d: number; coarse: number; fine?: number;
  s: number;        // hex across flats ISO 4017, mm
  dw: number;       // bearing face diameter d_w,min of the hex head, mm
  dh: number;       // medium clearance hole ISO 273, mm
  key?: number;     // hex key (socket head ISO 4762), mm
};

export const THREADS: ThreadRow[] = [
  { d: 3, coarse: 0.5, s: 5.5, dw: 4.57, dh: 3.4, key: 2.5 }, { d: 4, coarse: 0.7, s: 7, dw: 5.88, dh: 4.5, key: 3 },
  { d: 5, coarse: 0.8, s: 8, dw: 6.88, dh: 5.5, key: 4 }, { d: 6, coarse: 1, s: 10, dw: 8.88, dh: 6.6, key: 5 },
  { d: 8, coarse: 1.25, fine: 1, s: 13, dw: 11.63, dh: 9, key: 6 }, { d: 10, coarse: 1.5, fine: 1.25, s: 16, dw: 14.63, dh: 11, key: 8 },
  { d: 12, coarse: 1.75, fine: 1.25, s: 18, dw: 16.63, dh: 13.5, key: 10 }, { d: 14, coarse: 2, fine: 1.5, s: 21, dw: 19.64, dh: 15.5, key: 12 },
  { d: 16, coarse: 2, fine: 1.5, s: 24, dw: 22.49, dh: 17.5, key: 14 }, { d: 18, coarse: 2.5, fine: 1.5, s: 27, dw: 25.34, dh: 20, key: 14 },
  { d: 20, coarse: 2.5, fine: 1.5, s: 30, dw: 28.19, dh: 22, key: 17 }, { d: 22, coarse: 2.5, fine: 1.5, s: 34, dw: 31.71, dh: 24, key: 17 },
  { d: 24, coarse: 3, fine: 2, s: 36, dw: 33.61, dh: 26, key: 19 }, { d: 27, coarse: 3, fine: 2, s: 41, dw: 38.0, dh: 30, key: 19 },
  { d: 30, coarse: 3.5, fine: 2, s: 46, dw: 42.75, dh: 33, key: 22 }, { d: 33, coarse: 3.5, fine: 2, s: 50, dw: 46.55, dh: 36, key: 24 },
  { d: 36, coarse: 4, fine: 3, s: 55, dw: 51.11, dh: 39, key: 27 }, { d: 39, coarse: 4, fine: 3, s: 60, dw: 55.86, dh: 42 },
  { d: 42, coarse: 4.5, fine: 3, s: 65, dw: 59.95, dh: 45, key: 32 }, { d: 48, coarse: 5, fine: 3, s: 75, dw: 69.45, dh: 52, key: 36 },
  { d: 56, coarse: 5.5, fine: 4, s: 85, dw: 78.66, dh: 62, key: 41 }, { d: 64, coarse: 6, fine: 4, s: 95, dw: 88.16, dh: 70, key: 46 },
];

export type BoltClass = '4.6' | '5.6' | '8.8' | '10.9' | '12.9' | 'A2-70' | 'A4-80';
export const BOLT_CLASSES: BoltClass[] = ['4.6', '5.6', '8.8', '10.9', '12.9', 'A2-70', 'A4-80'];

/** Minimum R_p0.2 (R_eL) and R_m, MPa. Stainless A2/A4 strengths hold up to M24 (ISO 3506-1:2009) — flagged above. */
export function classStrength(c: BoltClass, d: number) {
  switch (c) {
    case '4.6': return { Rp: 240, Rm: 400 };
    case '5.6': return { Rp: 300, Rm: 500 };
    case '8.8': return d <= 16 ? { Rp: 640, Rm: 800 } : { Rp: 660, Rm: 830 };
    case '10.9': return { Rp: 940, Rm: 1040 };
    case '12.9': return { Rp: 1100, Rm: 1220 };
    case 'A2-70': return { Rp: 450, Rm: 700 };
    case 'A4-80': return { Rp: 600, Rm: 800 };
  }
}

/** ISO 724 basic dimensions of a thread: pitch diameter d₂, minor diameter d₃ (bolt), stress area A_s. */
export function threadGeom(d: number, P: number) {
  const d2 = d - 0.649519 * P, d3 = d - 1.226869 * P, ds = (d2 + d3) / 2;
  return { d2, d3, As: (Math.PI / 4) * ds * ds, tap: d - P };
}

export type TorqueIn = { d: number; fine: boolean; cls: BoltClass; muG: number; muK: number; nu: number };
export type TorqueOut = {
  row: ThreadRow; P: number; d2: number; d3: number; As: number; tap: number;
  Rp: number; Rm: number; FM: number; MA: number; sigmaM: number; tauM: number; DKm: number;
  shareThread: number; shareHead: number; sharePitch: number; // parts of the torque
  stainlessLarge: boolean;
};

export function tightening(p: TorqueIn): TorqueOut {
  const row = THREADS.find((r) => r.d === p.d) ?? THREADS[5];
  const P = p.fine && row.fine ? row.fine : row.coarse;
  const { d2, d3, As, tap } = threadGeom(row.d, P);
  const { Rp, Rm } = classStrength(p.cls, row.d);
  const d0 = (d2 + d3) / 2, A0 = (Math.PI / 4) * d0 * d0;
  const k = 1.5 * (d2 / d0) * (P / (Math.PI * d2) + 1.155 * p.muG);
  const sigmaM = (p.nu * Rp) / Math.sqrt(1 + 3 * k * k);
  const FM = sigmaM * A0; // N
  const DKm = (row.dw + row.dh) / 2;
  const a = 0.16 * P, b = 0.58 * d2 * p.muG, c = (DKm / 2) * p.muK, sum = a + b + c;
  const MA = FM * sum / 1000; // N·m
  return {
    row, P, d2, d3, As, tap, Rp, Rm, FM, MA, sigmaM, tauM: sigmaM * k, DKm,
    sharePitch: a / sum, shareThread: b / sum, shareHead: c / sum,
    stainlessLarge: p.cls.startsWith('A') && row.d > 24,
  };
}

/** Friction presets μ_G = μ_K (VDI 2230-1 Table A5 ranges, middle values). */
export const FRICTION_PRESETS: { mu: number; label: string }[] = [
  { mu: 0.08, label: 'MoS₂ paste or wax' }, { mu: 0.10, label: 'oiled, black oxide' }, { mu: 0.12, label: 'lightly oiled, zinc plated (standard)' },
  { mu: 0.14, label: 'zinc flake coating, dry phosphate' }, { mu: 0.18, label: 'dry, as delivered' }, { mu: 0.25, label: 'stainless dry (galling risk)' },
];
