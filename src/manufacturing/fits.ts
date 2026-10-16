/**
 * ISO 286 limits and fits, nominal sizes up to 500 mm:
 *  - standard tolerance grades IT1…IT18 (ISO 286-1 Table 1),
 *  - fundamental deviations of the common shaft positions c…u and hole positions C…U (ISO 286-1 Tables 2 and 3;
 *    holes from the shaft values with the standard's rules, including the Δ rule for K, M, N ≤ IT8 and P…U ≤ IT7),
 *  - the fit: limits, clearance / transition / interference,
 *  - a press-fit estimate for interference: Lamé thick-walled cylinders (Shigley eq. 3-56), smoothing of the
 *    roughness peaks 0.8 (R_z,hub + R_z,shaft) (DIN 7190), torque and assembly force with one friction value,
 *    hub heating for a shrink fit.
 * Units: mm and µm for sizes and deviations, MPa, N, N·m.
 */

export type Check = { ok: boolean; label: string; detail: string };

/** Main size steps (upper bounds, "above … up to and including"), ISO 286-1 Table 1. */
export const STEPS = [3, 6, 10, 18, 30, 50, 80, 120, 180, 250, 315, 400, 500];
/** Intermediate steps used by the fundamental deviations (Tables 2 and 3). */
export const STEPS_I = [3, 6, 10, 14, 18, 24, 30, 40, 50, 65, 80, 100, 120, 140, 160, 180, 200, 225, 250, 280, 315, 355, 400, 450, 500];

/** IT1…IT18 in µm for each main step (ISO 286-1 Table 1; IT12 and up are given in mm there). */
const IT_TABLE: number[][] = [
  // IT1  IT2  IT3 IT4 IT5 IT6 IT7 IT8 IT9 IT10 IT11 IT12 IT13 IT14 IT15 IT16 IT17 IT18
  [0.8, 1.2, 2, 3, 4, 6, 10, 14, 25, 40, 60, 100, 140, 250, 400, 600, 1000, 1400], // 0–3
  [1, 1.5, 2.5, 4, 5, 8, 12, 18, 30, 48, 75, 120, 180, 300, 480, 750, 1200, 1800], // 3–6
  [1, 1.5, 2.5, 4, 6, 9, 15, 22, 36, 58, 90, 150, 220, 360, 580, 900, 1500, 2200], // 6–10
  [1.2, 2, 3, 5, 8, 11, 18, 27, 43, 70, 110, 180, 270, 430, 700, 1100, 1800, 2700], // 10–18
  [1.5, 2.5, 4, 6, 9, 13, 21, 33, 52, 84, 130, 210, 330, 520, 840, 1300, 2100, 3300], // 18–30
  [1.5, 2.5, 4, 7, 11, 16, 25, 39, 62, 100, 160, 250, 390, 620, 1000, 1600, 2500, 3900], // 30–50
  [2, 3, 5, 8, 13, 19, 30, 46, 74, 120, 190, 300, 460, 740, 1200, 1900, 3000, 4600], // 50–80
  [2.5, 4, 6, 10, 15, 22, 35, 54, 87, 140, 220, 350, 540, 870, 1400, 2200, 3500, 5400], // 80–120
  [3.5, 5, 8, 12, 18, 25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300], // 120–180
  [4.5, 7, 10, 14, 20, 29, 46, 72, 115, 185, 290, 460, 720, 1150, 1850, 2900, 4600, 7200], // 180–250
  [6, 8, 12, 16, 23, 32, 52, 81, 130, 210, 320, 520, 810, 1300, 2100, 3200, 5200, 8100], // 250–315
  [7, 9, 13, 18, 25, 36, 57, 89, 140, 230, 360, 570, 890, 1400, 2300, 3600, 5700, 8900], // 315–400
  [8, 10, 15, 20, 27, 40, 63, 97, 155, 250, 400, 630, 970, 1550, 2500, 4000, 6300, 9700], // 400–500
];

/** Shaft upper deviations es (µm) for c…h, per intermediate step (ISO 286-1 Table 2). */
const ES_SHAFT: Record<string, number[]> = {
  c: [-60, -70, -80, -95, -95, -110, -110, -120, -130, -140, -150, -170, -180, -200, -210, -230, -240, -260, -280, -300, -330, -360, -400, -440, -480],
  d: [-20, -30, -40, -50, -50, -65, -65, -80, -80, -100, -100, -120, -120, -145, -145, -145, -170, -170, -170, -190, -190, -210, -210, -230, -230],
  e: [-14, -20, -25, -32, -32, -40, -40, -50, -50, -60, -60, -72, -72, -85, -85, -85, -100, -100, -100, -110, -110, -125, -125, -135, -135],
  f: [-6, -10, -13, -16, -16, -20, -20, -25, -25, -30, -30, -36, -36, -43, -43, -43, -50, -50, -50, -56, -56, -62, -62, -68, -68],
  g: [-2, -4, -5, -6, -6, -7, -7, -9, -9, -10, -10, -12, -12, -14, -14, -14, -15, -15, -15, -17, -17, -18, -18, -20, -20],
  h: Array(25).fill(0),
};
/** Shaft lower deviations ei (µm) for k…u, per intermediate step (ISO 286-1 Table 3); k: grades IT4…IT7 (otherwise 0). */
const EI_SHAFT: Record<string, number[]> = {
  k: [0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 5, 5],
  m: [2, 4, 6, 7, 7, 8, 8, 9, 9, 11, 11, 13, 13, 15, 15, 15, 17, 17, 17, 20, 20, 21, 21, 23, 23],
  n: [4, 8, 10, 12, 12, 15, 15, 17, 17, 20, 20, 23, 23, 27, 27, 27, 31, 31, 31, 34, 34, 37, 37, 40, 40],
  p: [6, 12, 15, 18, 18, 22, 22, 26, 26, 32, 32, 37, 37, 43, 43, 43, 50, 50, 50, 56, 56, 62, 62, 68, 68],
  r: [10, 15, 19, 23, 23, 28, 28, 34, 34, 41, 43, 51, 54, 63, 65, 68, 77, 80, 84, 94, 98, 108, 114, 126, 132],
  s: [14, 19, 23, 28, 28, 35, 35, 43, 43, 53, 59, 71, 79, 92, 100, 108, 122, 130, 140, 158, 170, 190, 208, 232, 252],
  u: [18, 23, 28, 33, 33, 41, 48, 60, 70, 87, 102, 124, 144, 170, 190, 210, 236, 258, 284, 315, 350, 390, 435, 490, 540],
};

export const SHAFT_LETTERS = ['c', 'd', 'e', 'f', 'g', 'h', 'js', 'k', 'm', 'n', 'p', 'r', 's', 'u'] as const;
export const HOLE_LETTERS = ['C', 'D', 'E', 'F', 'G', 'H', 'JS', 'K', 'M', 'N', 'P', 'R', 'S', 'U'] as const;
export type ShaftLetter = (typeof SHAFT_LETTERS)[number];
export type HoleLetter = (typeof HOLE_LETTERS)[number];
export const GRADES = [5, 6, 7, 8, 9, 10, 11] as const;

const stepIndex = (d: number, steps: number[]) => {
  if (!(d > 0) || d > 500) throw new Error('nominal size must be above 0 and up to 500 mm');
  return steps.findIndex((u) => d <= u);
};

/** Standard tolerance ITn (µm) for nominal size d (mm). */
export function it(grade: number, d: number) {
  if (grade < 1 || grade > 18 || !Number.isInteger(grade)) throw new Error('grade must be IT1…IT18');
  return IT_TABLE[stepIndex(d, STEPS)][grade - 1];
}

/** js / JS: ±IT/2, an odd IT value in grades 7…11 rounded down to the even value below (ISO 286-1). */
const halfIT = (grade: number, d: number) => { const v = it(grade, d); return (grade >= 7 && grade <= 11 && v % 2 === 1 ? v - 1 : v) / 2; };

/** Shaft limits es, ei (µm). */
export function shaftDeviations(letter: ShaftLetter, grade: number, d: number) {
  const T = it(grade, d), i = stepIndex(d, STEPS_I);
  if (letter === 'js') { const h = halfIT(grade, d); return { es: h, ei: -h, fundamental: 'es = +IT/2' }; }
  if (letter in ES_SHAFT) { const es = ES_SHAFT[letter][i]; return { es, ei: es - T, fundamental: 'es' }; }
  const ei = letter === 'k' ? (grade >= 4 && grade <= 7 ? EI_SHAFT.k[i] : 0) : EI_SHAFT[letter][i];
  return { es: ei + T, ei, fundamental: 'ei' };
}

/** Hole limits ES, EI (µm), from the shaft deviation of the same letter by the ISO 286-1 rules. */
export function holeDeviations(letter: HoleLetter, grade: number, d: number) {
  const T = it(grade, d), i = stepIndex(d, STEPS_I), lower = letter.toLowerCase();
  if (letter === 'JS') { const h = halfIT(grade, d); return { ES: h, EI: -h, delta: 0, fundamental: 'ES = +IT/2' }; }
  if (lower in ES_SHAFT) { const EI = 0 - ES_SHAFT[lower][i]; return { ES: EI + T, EI, delta: 0, fundamental: 'EI = −es' }; } // 0 − x: no −0 for H
  // K…U: upper deviation ES
  const small = d <= 3;
  const delta = grade > 1 ? T - it(grade - 1, d) : 0;
  const useDelta = !small && ((['K', 'M', 'N'].includes(letter) && grade <= 8) || (!['K', 'M', 'N'].includes(letter) && grade <= 7));
  let ES: number;
  if (letter === 'K') ES = small || grade > 8 ? 0 : -EI_SHAFT.k[i] + delta;
  else if (letter === 'N' && grade > 8 && !small) ES = 0;
  else ES = -EI_SHAFT[lower][i] + (useDelta ? delta : 0);
  return { ES, EI: ES - T, delta: useDelta ? delta : 0, fundamental: useDelta ? 'ES = −ei + Δ' : 'ES = −ei' };
}

export type FitKind = 'clearance' | 'transition' | 'interference';

/** Limits of a fit (µm): clearance positive, interference negative clearance. */
export function fit(d: number, hole: { letter: HoleLetter; grade: number }, shaft: { letter: ShaftLetter; grade: number }) {
  const h = holeDeviations(hole.letter, hole.grade, d), s = shaftDeviations(shaft.letter, shaft.grade, d);
  const Cmax = h.ES - s.ei, Cmin = h.EI - s.es; // largest and smallest clearance
  const kind: FitKind = Cmin >= 0 ? 'clearance' : Cmax <= 0 ? 'interference' : 'transition';
  return { d, hole: { ...hole, ...h, IT: it(hole.grade, d) }, shaft: { ...shaft, ...s, IT: it(shaft.grade, d) }, Cmax, Cmin, Imax: -Cmin, Imin: -Cmax, kind };
}
export type FitResult = ReturnType<typeof fit>;

/** Typical way to reach a grade (rounded guide, depends on size and machine). */
export function processFor(grade: number) {
  return grade <= 5 ? 'grinding, honing, lapping' : grade <= 6 ? 'grinding, fine turning' : grade <= 7 ? 'fine turning, reaming, broaching' : grade <= 9 ? 'turning, milling, boring' : grade <= 11 ? 'drilling, rough turning' : 'rough work, sawing, casting';
}

/* ---------------- press fit (interference) ---------------- */

export type FitMaterial = { id: string; name: string; E: number; nu: number; Re: number; alpha: number }; // MPa, –, MPa, 1/K
export const FIT_MATERIALS: FitMaterial[] = [
  { id: 'steel', name: 'Steel C45', E: 210000, nu: 0.3, Re: 430, alpha: 11.5e-6 },
  { id: 'alloy', name: 'Steel 42CrMo4 (Q+T)', E: 210000, nu: 0.3, Re: 750, alpha: 11.5e-6 },
  { id: 'castiron', name: 'Grey cast iron GJL-250', E: 110000, nu: 0.26, Re: 165, alpha: 10e-6 }, // R_e: ≈ 0.66 R_m (no yield point)
  { id: 'nodular', name: 'Ductile iron GJS-400', E: 169000, nu: 0.275, Re: 250, alpha: 12.5e-6 },
  { id: 'aluminium', name: 'Aluminium EN AW-6082 T6', E: 70000, nu: 0.33, Re: 250, alpha: 23e-6 },
  { id: 'bronze', name: 'Bronze CuSn12', E: 100000, nu: 0.34, Re: 150, alpha: 18e-6 },
];

export type PressIn = {
  d: number; D: number; di: number; L: number; // nominal joint diameter, hub outer, shaft bore (0 = solid), joint length [mm]
  hub: FitMaterial; shaft: FitMaterial;
  mu: number; RzHub: number; RzShaft: number; // friction, roughness R_z [µm]
  T: number; // torque to transmit [N·m] (0 = none)
  Imax: number; Imin: number; // interference limits from the fit [µm]
};

/** Contact pressure (MPa) for a diametral interference δ (µm) — Lamé, plane stress. */
export function contactPressure(p: Pick<PressIn, 'd' | 'D' | 'di' | 'hub' | 'shaft'>, delta: number) {
  if (delta <= 0) return 0;
  const { d, D, di, hub, shaft } = p;
  const kh = ((D * D + d * d) / (D * D - d * d) + hub.nu) / hub.E;
  const ks = ((d * d + di * di) / (d * d - di * di) - shaft.nu) / shaft.E;
  return (delta / 1000) / (d * (kh + ks));
}

export function pressFit(p: PressIn) {
  const G = 0.8 * (p.RzHub + p.RzShaft); // smoothing of the peaks on assembly [µm]
  const dMax = p.Imax - G, dMin = p.Imin - G; // effective interference [µm]
  const pMax = contactPressure(p, dMax), pMin = contactPressure(p, dMin);
  const Q = p.d / p.D, qi = p.di / p.d;
  // hub bore: σ_t = p (1 + Q²)/(1 − Q²), σ_r = −p; shaft: hollow → σ_t = −2p/(1 − qi²) at the bore, solid → σ_t = σ_r = −p
  const sHubT = (pMax * (1 + Q * Q)) / (1 - Q * Q), sHubVM = Math.sqrt(sHubT ** 2 + pMax ** 2 + sHubT * pMax);
  const sShaft = p.di > 0 ? (2 * pMax) / (1 - qi * qi) : pMax;
  const area = Math.PI * p.d * p.L; // contact area [mm²]
  const Tcap = (p.mu * pMin * area * p.d) / 2 / 1000; // N·m at the smallest interference
  const Fpress = p.mu * pMax * area; // N, press-in force at the largest interference
  const joinGap = 0.001 * p.d * 1000; // µm: assembly clearance for a shrink fit, ≈ 0.1 % of d
  const dT = ((Math.max(dMax, 0) + joinGap) / 1000) / (p.hub.alpha * p.d); // K
  const checks: Check[] = [];
  checks.push({ ok: sHubVM <= p.hub.Re, label: 'Hub does not yield at the largest interference', detail: `σ_vM = ${sHubVM.toFixed(0)} MPa ≤ R_e ${p.hub.Re} MPa` });
  checks.push({ ok: sShaft <= p.shaft.Re, label: 'Shaft does not yield at the largest interference', detail: `σ = ${sShaft.toFixed(0)} MPa ≤ R_e ${p.shaft.Re} MPa` });
  if (p.T > 0) checks.push({ ok: Tcap >= p.T, label: 'Smallest interference still transmits the torque (no key)', detail: dMin > 0 ? `T_min = ${Tcap.toFixed(0)} N·m ≥ ${p.T.toFixed(0)} N·m` : `no interference left (${dMin.toFixed(1)} µm after smoothing)` });
  checks.push({ ok: Q <= 0.7, label: 'Hub wall thick enough: d/D ≤ 0.7', detail: `d/D = ${Q.toFixed(2)}` });
  if (dMax > 0) checks.push({ ok: dT <= 250, label: 'Shrink fit: hub heating ≤ 250 K (no tempering of the steel)', detail: `ΔT = ${dT.toFixed(0)} K` });
  return { G, dMax, dMin, pMax, pMin, Q, sHubT, sHubVM, sShaft, area, Tcap, Fpress, joinGap, dT, checks };
}

/* ---------------- texts ---------------- */

export const FITS_INTRO = 'A fit is how a shaft sits in a hole. Both sizes may only vary inside tolerance zones; their position (letter) and width (grade) decide whether the parts always slide, sometimes touch, or are always pressed together — and with how much pressure.';

export const FITS_NOTES = [
  'ISO 286-1/-2 (2010): standard tolerance grades IT1…IT18 and the fundamental deviations of the shaft positions c, d, e, f, g, h, js, k, m, n, p, r, s, u and the hole positions C … U for nominal sizes up to 500 mm, taken from the standard\'s tables. Hole deviations follow the standard\'s rules: A…H mirror the shaft (EI = −es); K, M, N up to IT8 and P…U up to IT7 add Δ = IT_n − IT_n−1 (sizes above 3 mm); js/JS are ±IT/2 with odd values in IT7…IT11 rounded down. Positions a, b, cd, ef, fg, j, t, v…zc are not included. Validation: tests reproduce ISO 286-2 table values (25 H7, g6, k6, p6, s6, P7; 10 K7; 60 M7; 100 F8; 200 u6 and others).',
  'Press fit: elastic thick-walled cylinders (Lamé, plane stress, Shigley eq. 3-56) with the same nominal diameter for hub and shaft and a uniform pressure over the joint length; the roughness peaks are flattened on assembly by 0.8 (R_z,hub + R_z,shaft) (DIN 7190). One friction value is used for torque and press-in force (typical: 0.1 pressed in dry, 0.14 shrink fit, 0.07 lubricated). Hub stresses at the bore (von Mises), shaft stress at its surface or bore. Not included: stress concentration at the hub ends, centrifugal loosening at high speed, temperature differences in service, plastic (elasto-plastic) fits, fretting. The shrink temperature includes a joining clearance of 0.1 % of d.',
  'Grade → process is a rough guide: what a machine reaches depends on size, material, stiffness and skill.',
];

/** Radial and hoop stress (MPa) across shaft and hub at contact pressure p (Lamé), n points per part, for the stress chart. */
export function lameProfile(d: number, D: number, di: number, p: number, n = 40) {
  const a = d / 2, b = D / 2, c = di / 2, out: { r: number; sr: number; st: number; part: 'shaft' | 'hub' }[] = [];
  for (let i = 0; i <= n; i++) { // shaft: from the bore (or the axis) to the joint
    const r = c + ((a - c) * i) / n;
    if (c > 0) { const k = (p * a * a) / (a * a - c * c); out.push({ r, sr: -k * (1 - (c * c) / (r * r)), st: -k * (1 + (c * c) / (r * r)), part: 'shaft' }); }
    else out.push({ r, sr: -p, st: -p, part: 'shaft' });
  }
  for (let i = 0; i <= n; i++) { // hub: from the joint to the outside
    const r = a + ((b - a) * i) / n, k = (p * a * a) / (b * b - a * a);
    out.push({ r, sr: k * (1 - (b * b) / (r * r)), st: k * (1 + (b * b) / (r * r)), part: 'hub' });
  }
  return out;
}
