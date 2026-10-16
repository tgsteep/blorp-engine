/** ISO 261/724 coarse threads, ISO 4762 head (d_W ≈ d_k), ISO 273 medium clearance hole. mm, mm². */
export type Thread = { name: string; d: number; P: number; d2: number; d3: number; As: number; dW: number; dh: number };

export const THREADS: Thread[] = [
  { name: 'M6', d: 6, P: 1, d2: 5.350, d3: 4.773, As: 20.1, dW: 10, dh: 6.6 },
  { name: 'M8', d: 8, P: 1.25, d2: 7.188, d3: 6.466, As: 36.6, dW: 13, dh: 9 },
  { name: 'M10', d: 10, P: 1.5, d2: 9.026, d3: 8.160, As: 58.0, dW: 16, dh: 11 },
  { name: 'M12', d: 12, P: 1.75, d2: 10.863, d3: 9.853, As: 84.3, dW: 18, dh: 13.5 },
  { name: 'M16', d: 16, P: 2, d2: 14.701, d3: 13.546, As: 157, dW: 24, dh: 17.5 },
  { name: 'M20', d: 20, P: 2.5, d2: 18.376, d3: 16.933, As: 245, dW: 30, dh: 22 },
  { name: 'M24', d: 24, P: 3, d2: 22.051, d3: 20.319, As: 353, dW: 36, dh: 26 },
];

export type PropertyClass = '8.8' | '10.9' | '12.9';
export const CLASSES: PropertyClass[] = ['8.8', '10.9', '12.9'];

/** ISO 898-1 minimum yield R_p0.2 and tensile strength R_m [MPa]. */
export function strength(pc: PropertyClass, d: number) {
  if (pc === '8.8') return d <= 16 ? { Rp: 640, Rm: 800 } : { Rp: 660, Rm: 830 };
  if (pc === '10.9') return { Rp: 940, Rm: 1040 };
  return { Rp: 1100, Rm: 1220 };
}

export const E_STEEL = 205000; // MPa
