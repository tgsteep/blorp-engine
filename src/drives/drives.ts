/**
 * Belt and chain drives between two parallel shafts (open drive).
 *  - Geometry: wrap angles, exact belt length, chain links and the centre distance they give.
 *  - V-belt (narrow wedge belts ISO 4184 / DIN 7753): Euler–Eytelwein tensions with an effective wedge friction,
 *    centrifugal tension, number of belts from a typical allowable tight-side force, bending frequency, shaft load.
 *  - Roller chain (ISO 606 B-series simplex): chain pull, static safety, joint (pin) pressure, polygon effect.
 * Units: mm, N, kW, rpm, m/s.
 */

/** Small-pulley wrap angle and exact open-belt length (pitch diameters). */
export function openDrive(d1: number, d2: number, a: number) {
  const g = Math.asin(Math.min(1, Math.abs(d2 - d1) / (2 * a)));
  const beta1 = Math.PI - 2 * g, beta2 = Math.PI + 2 * g;
  const L = 2 * a * Math.cos(g) + (Math.PI * (d1 + d2)) / 2 + g * Math.abs(d2 - d1);
  return { gamma: g, beta1, beta2, L };
}

export const SERVICE = [
  { id: 'light', name: 'smooth (fans, pumps, conveyors)', c: 1.0 },
  { id: 'medium', name: 'moderate shocks (machine tools, mixers)', c: 1.25 },
  { id: 'heavy', name: 'heavy shocks (crushers, presses)', c: 1.6 },
];

/** Narrow V-belt sections: mass per metre, smallest pulley, indicative allowable tight-side force per belt, max speed. */
export const BELTS = [
  { id: 'SPZ', top: 9.7, h: 8, m: 0.074, dMin: 63, Fallow: 300, vMax: 40 },
  { id: 'SPA', top: 12.7, h: 10, m: 0.12, dMin: 90, Fallow: 500, vMax: 40 },
  { id: 'SPB', top: 16.3, h: 13, m: 0.2, dMin: 140, Fallow: 900, vMax: 40 },
  { id: 'SPC', top: 22, h: 18, m: 0.37, dMin: 224, Fallow: 1900, vMax: 40 },
];
export type Belt = (typeof BELTS)[number];
/** Effective friction coefficient of a V-belt in its groove (wedge effect with slip reserve): e^{μ′π} ≈ 4.8. */
export const MU_V = 0.5;
export const BELT_LIMITS = { beta: 120, fB: 100, zMax: 6 };

export type BeltIn = { P: number; n1: number; d1: number; i: number; a: number; belt: Belt; cS: number };

export function beltDrive(p: BeltIn) {
  const d2 = p.d1 * p.i;
  const g = openDrive(p.d1, d2, p.a);
  const v = (Math.PI * p.d1 * p.n1) / 60000; // m/s
  const n2 = p.n1 / p.i;
  const Pd = p.P * p.cS; // design power
  const Ft = (Pd * 1000) / v; // N
  const e = Math.exp(MU_V * g.beta1);
  const Fc = p.belt.m * v * v; // centrifugal tension per belt
  const F1tot = (Ft * e) / (e - 1), F2tot = Ft / (e - 1); // all belts, without Fc
  const z = Math.max(1, Math.ceil(F1tot / (p.belt.Fallow - Fc > 0 ? p.belt.Fallow - Fc : 1e-9)));
  const F1 = F1tot / z + Fc, F2 = F2tot / z + Fc; // per belt
  const Fw = z * Math.sqrt((F1 - Fc) ** 2 + (F2 - Fc) ** 2 - 2 * (F1 - Fc) * (F2 - Fc) * Math.cos(g.beta1)); // shaft load (Fc does not reach the shafts)
  const fB = (2 * v * 1000) / g.L; // bending frequency, 2 pulleys [1/s]
  const T1 = (p.P * 9549.3) / p.n1;
  const lim = BELT_LIMITS;
  const beta1Deg = (g.beta1 * 180) / Math.PI;
  const checks = [
    { ok: p.d1 >= p.belt.dMin, label: `Small pulley d₁ ≥ ${p.belt.dMin} mm for ${p.belt.id} (bending)`, detail: `d₁ = ${p.d1} mm` },
    { ok: v <= p.belt.vMax && v >= 2, label: `Belt speed 2…${p.belt.vMax} m/s`, detail: `v = ${v.toFixed(1)} m/s` },
    { ok: beta1Deg >= lim.beta, label: `Wrap angle on the small pulley β₁ ≥ ${lim.beta}°`, detail: `β₁ = ${beta1Deg.toFixed(0)}°` },
    { ok: p.a >= 0.7 * (p.d1 + d2) && p.a <= 2 * (p.d1 + d2), label: 'Centre distance 0.7…2·(d₁ + d₂)', detail: `a/(d₁ + d₂) = ${(p.a / (p.d1 + d2)).toFixed(2)}` },
    { ok: fB <= lim.fB, label: `Bending frequency f_B = 2v/L ≤ ${lim.fB} 1/s`, detail: `f_B = ${fB.toFixed(0)} 1/s` },
    { ok: z <= lim.zMax, label: `Number of belts ≤ ${lim.zMax} (otherwise a larger section)`, detail: `z = ${z}` },
  ];
  return { d2, ...g, beta1Deg, v, n2, Pd, Ft, e, Fc, F1, F2, z, Fw, fB, T1, checks };
}
export type BeltResult = ReturnType<typeof beltDrive>;

/** Euler–Eytelwein: belt tension (one belt) after wrapping φ of the active arc, from F₂ to F₁. */
export const eulerTension = (F2: number, Fc: number, phi: number) => (F2 - Fc) * Math.exp(MU_V * phi) + Fc;

/** ISO 606 B-series simplex roller chains: pitch, roller Ø, inner width, min. tensile strength F_B, mass, joint area. */
export const CHAINS = [
  { id: '08B-1', p: 12.7, dr: 8.51, b: 7.75, FB: 17800, m: 0.7, A: 50 },
  { id: '10B-1', p: 15.875, dr: 10.16, b: 9.65, FB: 22200, m: 0.95, A: 67 },
  { id: '12B-1', p: 19.05, dr: 12.07, b: 11.68, FB: 28900, m: 1.25, A: 89 },
  { id: '16B-1', p: 25.4, dr: 15.88, b: 17.02, FB: 60000, m: 2.7, A: 210 },
  { id: '20B-1', p: 31.75, dr: 19.05, b: 19.56, FB: 95000, m: 3.6, A: 296 },
  { id: '24B-1', p: 38.1, dr: 25.4, b: 25.4, FB: 160000, m: 6.7, A: 554 },
];
export type Chain = (typeof CHAINS)[number];
export const CHAIN_LIMITS = { z1: 17, S: 7, pJ: 25, v: 15, aMin: 30, aMax: 80 };

export const sprocketD = (p: number, z: number) => p / Math.sin(Math.PI / z);
/** Links for a centre distance, and the exact centre distance an even number of links gives. */
export function chainLinks(p: number, z1: number, z2: number, a: number) {
  const k = ((z2 - z1) / (2 * Math.PI)) ** 2;
  const Xr = (2 * a) / p + (z1 + z2) / 2 + (k * p) / a;
  const X = 2 * Math.ceil(Xr / 2);
  const s = X - (z1 + z2) / 2;
  const aX = (p / 4) * (s + Math.sqrt(s * s - 8 * k));
  return { Xr, X, aX };
}

export type ChainIn = { P: number; n1: number; z1: number; z2: number; a: number; chain: Chain; cS: number };

export function chainDrive(p: ChainIn) {
  const c = p.chain;
  const d1 = sprocketD(c.p, p.z1), d2 = sprocketD(c.p, p.z2);
  const { X, aX } = chainLinks(c.p, p.z1, p.z2, p.a);
  const g = openDrive(d1, d2, aX);
  const v = (p.z1 * c.p * p.n1) / 60000; // mean chain speed m/s
  const n2 = (p.n1 * p.z1) / p.z2;
  const Ft = (p.P * p.cS * 1000) / v;
  const Fc = c.m * v * v;
  const F = Ft + Fc;
  const S = c.FB / F; // static safety
  const pJ = F / c.A; // joint pressure MPa
  const poly = 1 - Math.cos(Math.PI / p.z1); // relative speed variation of the polygon effect
  const T1 = (p.P * 9549.3) / p.n1;
  const lim = CHAIN_LIMITS;
  const beta1Deg = (g.beta1 * 180) / Math.PI;
  const checks = [
    { ok: p.z1 >= lim.z1, label: `Small sprocket z₁ ≥ ${lim.z1} teeth (smooth running)`, detail: `z₁ = ${p.z1}, speed ripple ${(poly * 100).toFixed(1)} %` },
    { ok: S >= lim.S, label: `Static safety F_B/F ≥ ${lim.S}`, detail: `S = ${S.toFixed(1)}` },
    { ok: pJ <= lim.pJ, label: `Joint pressure F/A ≤ ${lim.pJ} MPa (wear, good lubrication)`, detail: `p = ${pJ.toFixed(1)} MPa` },
    { ok: v <= lim.v, label: `Chain speed ≤ ${lim.v} m/s`, detail: `v = ${v.toFixed(2)} m/s` },
    { ok: aX >= lim.aMin * c.p && aX <= lim.aMax * c.p, label: `Centre distance ${lim.aMin}…${lim.aMax} pitches`, detail: `a = ${(aX / c.p).toFixed(0)} p` },
    { ok: beta1Deg >= 120, label: 'Wrap angle on the small sprocket ≥ 120°', detail: `β₁ = ${beta1Deg.toFixed(0)}°` },
  ];
  return { d1, d2, X, aX, ...g, beta1Deg, v, n2, Ft, Fc, F, S, pJ, poly, T1, checks };
}
export type ChainResult = ReturnType<typeof chainDrive>;

export const DRIVE_INTRO =
  'Belts and chains carry power between shafts that are far apart. A belt grips by friction: the tight side pulls harder than the slack side, and the ratio of the two can grow only exponentially with the wrap angle (Euler–Eytelwein) — so belts need pre-tension and enough wrap. A chain grips by teeth and cannot slip, but it runs over a polygon, not a circle: with few teeth the chain speed pulses and the joints wear. Both turn a small pulley into a large one: the ratio is d₂/d₁ or z₂/z₁.';

export const DRIVE_ASSUMPTIONS =
  'Open drive between two parallel shafts, steady power. Belt: narrow V-belts, pitch diameters, slip ignored; tight/slack tensions by Euler–Eytelwein with an effective wedge friction μ′ = 0.5 (F₁/F₂ ≈ 4.8 at 180° wrap, includes a slip reserve) plus centrifugal tension m′v²; number of belts from an indicative allowable tight-side force per belt — real ratings depend on pulley size, speed and length (ISO 5292, DIN 7753, manufacturer tables). Chain: ISO 606 B-series simplex, chain pull F_t + m′v², minimum tensile strength and joint area from typical tables; joint pressure limit 25 MPa for good lubrication; wear life, lubrication regime and impact at high speed (ISO 10823) not calculated. Service factor multiplies the power.';
