/**
 * Wageningen B-series open-water polynomials after Oosterveld & van Oossanen (1975), "Further computer-analyzed data of
 * the Wageningen B-screw series", International Shipbuilding Progress 22 (251): K_T (39 terms) and K_Q (47 terms) as
 * Σ C J^s (P/D)^t (A_E/A_0)^u Z^v at the series' Reynolds number 2·10⁶ (no scale correction). Valid for Z 2…7,
 * A_E/A_0 0.30…1.05, P/D 0.5…1.4. Coefficients as tabulated by Bernitsas, Ray & Kinley (1981).
 */

/** [C, s, t, u, v] for K_T. */
const KT_TERMS: readonly (readonly [number, number, number, number, number])[] = [
  [0.00880496, 0, 0, 0, 0], [-0.204554, 1, 0, 0, 0], [0.166351, 0, 1, 0, 0], [0.158114, 0, 2, 0, 0],
  [-0.147581, 2, 0, 1, 0], [-0.481497, 1, 1, 1, 0], [0.415437, 0, 2, 1, 0], [0.0144043, 0, 0, 0, 1],
  [-0.0530054, 2, 0, 0, 1], [0.0143481, 0, 1, 0, 1], [0.0606826, 1, 1, 0, 1], [-0.0125894, 0, 0, 1, 1],
  [0.0109689, 1, 0, 1, 1], [-0.133698, 0, 3, 0, 0], [0.00638407, 0, 6, 0, 0], [-0.00132718, 2, 6, 0, 0],
  [0.168496, 3, 0, 1, 0], [-0.0507214, 0, 0, 2, 0], [0.0854559, 2, 0, 2, 0], [-0.0504475, 3, 0, 2, 0],
  [0.010465, 1, 6, 2, 0], [-0.00648272, 2, 6, 2, 0], [-0.00841728, 0, 3, 0, 1], [0.0168424, 1, 3, 0, 1],
  [-0.00102296, 3, 3, 0, 1], [-0.0317791, 0, 3, 1, 1], [0.018604, 1, 0, 2, 1], [-0.00410798, 0, 2, 2, 1],
  [-0.000606848, 0, 0, 0, 2], [-0.0049819, 1, 0, 0, 2], [0.0025983, 2, 0, 0, 2], [-0.000560528, 3, 0, 0, 2],
  [-0.00163652, 1, 2, 0, 2], [-0.000328787, 1, 6, 0, 2], [0.000116502, 2, 6, 0, 2], [0.000690904, 0, 0, 1, 2],
  [0.00421749, 0, 3, 1, 2], [5.65229e-05, 3, 6, 1, 2], [-0.00146564, 0, 3, 2, 2],
];
/** [C, s, t, u, v] for K_Q. */
const KQ_TERMS: readonly (readonly [number, number, number, number, number])[] = [
  [0.00379368, 0, 0, 0, 0], [0.00886523, 2, 0, 0, 0], [-0.032241, 1, 1, 0, 0], [0.00344778, 0, 2, 0, 0],
  [-0.0408811, 0, 1, 1, 0], [-0.108009, 1, 1, 1, 0], [-0.0885381, 2, 1, 1, 0], [0.188561, 0, 2, 1, 0],
  [-0.00370871, 1, 0, 0, 1], [0.00513696, 0, 1, 0, 1], [0.0209449, 1, 1, 0, 1], [0.00474319, 2, 1, 0, 1],
  [-0.00723408, 2, 0, 1, 1], [0.00438388, 1, 1, 1, 1], [-0.0269403, 0, 2, 1, 1], [0.0558082, 3, 0, 1, 0],
  [0.0161886, 0, 3, 1, 0], [0.00318086, 1, 3, 1, 0], [0.015896, 0, 0, 2, 0], [0.0471729, 1, 0, 2, 0],
  [0.0196283, 3, 0, 2, 0], [-0.0502782, 0, 1, 2, 0], [-0.030055, 3, 1, 2, 0], [0.0417122, 2, 2, 2, 0],
  [-0.0397722, 0, 3, 2, 0], [-0.00350024, 0, 6, 2, 0], [-0.0106854, 3, 0, 0, 1], [0.00110903, 3, 3, 0, 1],
  [-0.000313912, 0, 6, 0, 1], [0.0035985, 3, 0, 1, 1], [-0.00142121, 0, 6, 1, 1], [-0.00383637, 1, 0, 2, 1],
  [0.0126803, 0, 2, 2, 1], [-0.00318278, 2, 3, 2, 1], [0.00334268, 0, 6, 2, 1], [-0.00183491, 1, 1, 0, 2],
  [0.000112451, 3, 2, 0, 2], [-2.97228e-05, 3, 6, 0, 2], [0.000269551, 1, 0, 1, 2], [0.00083265, 2, 0, 1, 2],
  [0.00155334, 0, 2, 1, 2], [0.000302683, 0, 6, 1, 2], [-0.0001843, 0, 0, 2, 2], [-0.000425399, 0, 3, 2, 2],
  [8.69243e-05, 3, 3, 2, 2], [-0.0004659, 0, 6, 2, 2], [5.54194e-05, 1, 6, 2, 2],
];

/** Tested blade-area range of the series for each blade number (Kuiper 1992). */
export const AE_RANGE: Record<number, [number, number]> = { 3: [0.35, 0.8], 4: [0.4, 1.0], 5: [0.45, 1.05], 6: [0.5, 0.8], 7: [0.55, 0.85] };
export const PD_RANGE: [number, number] = [0.5, 1.4];

/** K_T and K_Q are cubics in J for a given propeller: coefficients [J⁰, J¹, J², J³] of both. */
export function cubics(PD: number, AE: number, Z: number) {
  const pd = [1, PD, PD * PD, PD ** 3, PD ** 4, PD ** 5, PD ** 6], a = [1, AE, AE * AE], z = [1, Z, Z * Z];
  const kt = [0, 0, 0, 0], kq = [0, 0, 0, 0];
  for (const [c, s, t, u, v] of KT_TERMS) kt[s] += c * pd[t] * a[u] * z[v];
  for (const [c, s, t, u, v] of KQ_TERMS) kq[s] += c * pd[t] * a[u] * z[v];
  return { kt, kq };
}
const cub = (k: number[], J: number) => k[0] + J * (k[1] + J * (k[2] + J * k[3]));
/** Open-water thrust and torque coefficients K_T = T/(ρn²D⁴), K_Q = Q/(ρn²D⁵). */
export const bseries = (J: number, PD: number, AE: number, Z: number) => { const c = cubics(PD, AE, Z); return { KT: cub(c.kt, J), KQ: cub(c.kq, J) }; };
/** Open-water efficiency η_O = J K_T/(2π K_Q). */
export const etaOpen = (J: number, KT: number, KQ: number) => (KQ > 0 && KT > 0 ? (J * KT) / (2 * Math.PI * KQ) : 0);

/** First J where the cubic k(J) − c J² falls to zero (bisection after a coarse scan); NaN when it is not positive at J = 0. */
function firstZero(k: number[], c: number) {
  const f = (J: number) => cub(k, J) - c * J * J;
  if (!(f(0) > 0)) return NaN;
  let lo = 0, hi = 0.05;
  while (hi < 3 && f(hi) > 0) { lo = hi; hi += 0.05; }
  if (hi >= 3) return 3;
  for (let i = 0; i < 44; i++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
/** Advance ratio where K_T falls to zero (end of the useful curve); NaN when there is no thrust even at J = 0. */
export const jZero = (PD: number, AE: number, Z: number) => firstZero(cubics(PD, AE, Z).kt, 0);

/**
 * Operating point that gives thrust T at advance speed V_A with diameter D: K_T(J) = c J², c = T/(ρ V_A² D²) — the
 * "thrust demand" parabola through the open-water K_T curve. Returns J, K_T, K_Q, η_O, n [1/s], torque [N·m], power [W].
 */
export function atThrust(T: number, VA: number, D: number, PD: number, AE: number, Z: number, rho = 1025) {
  const k = cubics(PD, AE, Z), J0 = firstZero(k.kt, 0), c = T / (rho * VA * VA * D * D);
  if (!(J0 > 0) || !(T > 0) || !(VA > 0) || !(D > 0)) return { J: NaN, KT: NaN, KQ: NaN, eta: NaN, n: NaN, Q: NaN, P: NaN, J0, c };
  const J = firstZero(k.kt, c), KT = cub(k.kt, J), KQ = cub(k.kq, J), n = VA / (J * D), Q = rho * n * n * D ** 5 * KQ;
  return { J, KT, KQ, eta: etaOpen(J, KT, KQ), n, Q, P: 2 * Math.PI * n * Q, J0, c };
}

/** Pitch ratio with the best open-water efficiency for this thrust, speed and diameter (scan, then golden section). */
export function bestPitch(T: number, VA: number, D: number, AE: number, Z: number, rho = 1025, lo = PD_RANGE[0], hi = PD_RANGE[1]) {
  const eta = (pd: number) => { const e = atThrust(T, VA, D, pd, AE, Z, rho).eta; return Number.isFinite(e) ? e : -1; };
  const N = 9; let k = 0, best = -Infinity;
  for (let i = 0; i <= N; i++) { const e = eta(lo + ((hi - lo) * i) / N); if (e > best) { best = e; k = i; } }
  let a = lo + ((hi - lo) * Math.max(0, k - 1)) / N, b = lo + ((hi - lo) * Math.min(N, k + 1)) / N;
  const gr = (Math.sqrt(5) - 1) / 2;
  let x1 = b - gr * (b - a), x2 = a + gr * (b - a), f1 = eta(x1), f2 = eta(x2);
  for (let i = 0; i < 18; i++) {
    if (f1 > f2) { b = x2; x2 = x1; f2 = f1; x1 = b - gr * (b - a); f1 = eta(x1); }
    else { a = x1; x1 = x2; f1 = f2; x2 = a + gr * (b - a); f2 = eta(x2); }
  }
  const PD = (a + b) / 2, e = eta(PD);
  return { PD, eta: e > 0 ? e : NaN };
}

/** Keller's minimum blade-area ratio against cavitation: (1.3 + 0.3 Z) T/(D² (p₀ + ρ g h − p_v)) + K (K 0.2 single, 0.1 twin screw). */
export const P0_PV = 101325 - 1700; // atmospheric minus vapour pressure of sea water at 15 °C [Pa]
export const keller = (T: number, D: number, Z: number, h: number, screws: 1 | 2, rho = 1025) =>
  ((1.3 + 0.3 * Z) * T) / (D * D * (P0_PV + rho * 9.81 * h)) + (screws === 1 ? 0.2 : 0.1);
