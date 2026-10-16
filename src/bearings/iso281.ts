/**
 * Rolling bearing life after ISO 281:2007 (basic and modified rating life), simplified where noted.
 * Units: kN, mm, rpm, mm²/s, hours.
 */

export type BearingType = 'ball' | 'angular' | 'selfalign' | 'thrust' | 'roller' | 'tapered' | 'spherical';
/**
 * e, Y…: catalogue load factors where the type needs them (tapered: e, Y, Y0; spherical: e, Y1, Y2, Y0).
 * Deep groove uses ISO 281 Table 3; angular contact (40°) uses the fixed ISO 281 factors.
 */
export type Bearing = { name: string; type: BearingType; d: number; D: number; B: number; C: number; C0: number; Pu: number; e?: number; Y?: number; Y1?: number; Y2?: number; Y0?: number };

/** Bearing families with what they are good at (for the UI and Design ranking). */
export const BEARING_TYPES: Record<BearingType, { label: string; short: string; how: string; axial: string; misalign: string; cost: number }> = {
  ball: { label: 'Deep groove ball', short: 'ball', how: 'The everyday bearing: cheap, fast, quiet; takes radial and some axial load both ways.', axial: 'moderate, both ways', misalign: '≈ 0.1°', cost: 1 },
  angular: { label: 'Angular contact ball (40°)', short: 'angular', how: 'Raceways offset so balls press at 40°: high axial load in one direction, high speed. Usually mounted in pairs.', axial: 'high, one way', misalign: '≈ 0.05°', cost: 2.5 },
  selfalign: { label: 'Self-aligning ball', short: 'self-aligning', how: 'Two rows of balls in a spherical outer raceway: tolerates shaft bending and housing misalignment; low friction, lighter loads than spherical rollers.', axial: 'light, both ways', misalign: '≈ 2…3°', cost: 1.6 },
  thrust: { label: 'Thrust ball (511)', short: 'thrust', how: 'Balls between two flat washers: pure axial load in one direction, no radial load at all. Turntables, vertical shafts, screw jacks.', axial: 'only axial, one way', misalign: 'none', cost: 1.4 },
  roller: { label: 'Cylindrical roller (NU)', short: 'NU', how: 'Line contact rollers: very high radial load; NU type lets the shaft float axially, takes no axial load.', axial: 'none (NU)', misalign: '≈ 0.05°', cost: 2.2 },
  tapered: { label: 'Tapered roller', short: 'tapered', how: 'Conical rollers: heavy combined radial + axial load in one direction. Mounted in pairs, adjusted (wheel hubs, gearboxes).', axial: 'high, one way', misalign: '≈ 0.05°', cost: 1.8 },
  spherical: { label: 'Spherical roller', short: 'spherical', how: 'Two rows of barrel rollers in a spherical outer raceway: self-aligning, very high load, shrugs off shocks and shaft bending.', axial: 'moderate, both ways', misalign: '≈ 1.5…2°', cost: 3.5 },
};

/** Applications: load factor f_d on P (shocks, vibration) and the cleanliness to assume at least. */
export const APPLICATIONS = [
  { id: 'light', label: 'Light & clean', fd: 1.0, ecMax: 1, note: 'fans, appliances, office machines, indoor' },
  { id: 'general', label: 'General machinery', fd: 1.2, ecMax: 1, note: 'pumps, gearboxes, conveyors, machine tools' },
  { id: 'harsh', label: 'Heavy / harsh', fd: 1.8, ecMax: 0.3, note: 'crushers, vibrating screens, construction, mining: shocks, dirt, misalignment' },
] as const;
export type AppId = (typeof APPLICATIONS)[number]['id'];

const b = (name: string, type: BearingType, d: number, D: number, B: number, C: number, C0: number, Pu: number, x: Partial<Bearing> = {}): Bearing => ({ name, type, d, D, B, C, C0, Pu, ...x });

/**
 * Typical catalogue values for standard series (deep groove 60/62/63, angular contact 72 B, cylindrical
 * roller NU 2, tapered roller 302, spherical roller 222). Rounded, manufacturer-like figures for
 * learning — always confirm with the real catalogue.
 */
export const CATALOGUE: Bearing[] = [
  // deep groove ball, 60 (light)
  b('6000', 'ball', 10, 26, 8, 4.75, 1.96, 0.083), b('6001', 'ball', 12, 28, 8, 5.4, 2.36, 0.1), b('6002', 'ball', 15, 32, 9, 5.85, 2.85, 0.12),
  b('6003', 'ball', 17, 35, 10, 6.37, 3.25, 0.137), b('6004', 'ball', 20, 42, 12, 9.95, 5, 0.212), b('6005', 'ball', 25, 47, 12, 11.9, 6.55, 0.275),
  b('6006', 'ball', 30, 55, 13, 13.8, 8.3, 0.355), b('6007', 'ball', 35, 62, 14, 16.8, 10.2, 0.44), b('6008', 'ball', 40, 68, 15, 17.8, 11.6, 0.49),
  b('6010', 'ball', 50, 80, 16, 22.9, 15.6, 0.71), b('6012', 'ball', 60, 95, 18, 30.7, 23.2, 0.98),
  // deep groove ball, 62 (medium)
  b('6200', 'ball', 10, 30, 9, 5.4, 2.36, 0.1), b('6201', 'ball', 12, 32, 10, 7.28, 3.1, 0.132), b('6202', 'ball', 15, 35, 11, 8.06, 3.75, 0.16),
  b('6203', 'ball', 17, 40, 12, 9.95, 4.75, 0.2), b('6204', 'ball', 20, 47, 14, 13.5, 6.55, 0.28), b('6205', 'ball', 25, 52, 15, 14.8, 7.8, 0.335),
  b('6206', 'ball', 30, 62, 16, 20.3, 11.2, 0.475), b('6207', 'ball', 35, 72, 17, 27, 15.3, 0.655), b('6208', 'ball', 40, 80, 18, 32.5, 19, 0.8),
  b('6209', 'ball', 45, 85, 19, 35.1, 21.6, 0.915), b('6210', 'ball', 50, 90, 20, 37.1, 23.2, 0.98), b('6211', 'ball', 55, 100, 21, 46.2, 29, 1.25),
  b('6212', 'ball', 60, 110, 22, 55.3, 36, 1.53), b('6214', 'ball', 70, 125, 24, 63.7, 45, 1.9), b('6216', 'ball', 80, 140, 26, 72.8, 55, 2.2),
  b('6220', 'ball', 100, 180, 34, 127, 93, 3.55),
  // deep groove ball, 63 (heavy)
  b('6300', 'ball', 10, 35, 11, 8.52, 3.4, 0.143), b('6302', 'ball', 15, 42, 13, 11.9, 5.4, 0.228), b('6304', 'ball', 20, 52, 15, 16.8, 7.8, 0.335),
  b('6305', 'ball', 25, 62, 17, 23.4, 11.6, 0.49), b('6306', 'ball', 30, 72, 19, 29.6, 16, 0.67), b('6307', 'ball', 35, 80, 21, 35.1, 19, 0.815),
  b('6308', 'ball', 40, 90, 23, 42.3, 24, 1.02), b('6309', 'ball', 45, 100, 25, 55.3, 31.5, 1.34), b('6310', 'ball', 50, 110, 27, 65, 38, 1.6),
  b('6312', 'ball', 60, 130, 31, 85.2, 52, 2.2), b('6316', 'ball', 80, 170, 39, 130, 86.5, 3.25),
  // self-aligning ball, 12
  b('1204', 'selfalign', 20, 47, 14, 12.7, 3.4, 0.176, { e: 0.27, Y1: 2.3, Y2: 3.6, Y0: 2.5 }), b('1205', 'selfalign', 25, 52, 15, 14.3, 4, 0.21, { e: 0.27, Y1: 2.3, Y2: 3.6, Y0: 2.5 }),
  b('1206', 'selfalign', 30, 62, 16, 15.6, 4.65, 0.24, { e: 0.24, Y1: 2.6, Y2: 4.0, Y0: 2.8 }), b('1208', 'selfalign', 40, 80, 18, 19.9, 6.95, 0.36, { e: 0.22, Y1: 2.9, Y2: 4.4, Y0: 3.0 }),
  b('1210', 'selfalign', 50, 90, 20, 22.9, 8.15, 0.425, { e: 0.21, Y1: 3.0, Y2: 4.6, Y0: 3.2 }), b('1212', 'selfalign', 60, 110, 22, 31.2, 12.2, 0.63, { e: 0.18, Y1: 3.5, Y2: 5.4, Y0: 3.6 }),
  // thrust ball, 511 (single direction)
  b('51104', 'thrust', 20, 35, 10, 15.9, 25, 0.93), b('51105', 'thrust', 25, 42, 11, 19.5, 32.5, 1.2), b('51106', 'thrust', 30, 47, 11, 20.3, 37.5, 1.4),
  b('51108', 'thrust', 40, 60, 13, 28.1, 56, 2.08), b('51110', 'thrust', 50, 70, 14, 30.7, 67, 2.5), b('51112', 'thrust', 60, 85, 17, 43.6, 98, 3.65),
  // angular contact ball, 72 B (40°)
  b('7204 B', 'angular', 20, 47, 14, 14.3, 8.3, 0.355), b('7205 B', 'angular', 25, 52, 15, 15.6, 10, 0.43), b('7206 B', 'angular', 30, 62, 16, 23.8, 15.6, 0.655),
  b('7208 B', 'angular', 40, 80, 18, 36.4, 26, 1.1), b('7210 B', 'angular', 50, 90, 20, 37.7, 28.5, 1.2), b('7212 B', 'angular', 60, 110, 22, 57.2, 45, 1.9),
  // cylindrical roller, NU 2
  b('NU 204', 'roller', 20, 47, 14, 25.1, 22, 2.75), b('NU 205', 'roller', 25, 52, 15, 28.6, 27, 3.35), b('NU 206', 'roller', 30, 62, 16, 44, 36.5, 4.5),
  b('NU 207', 'roller', 35, 72, 17, 56, 48, 6.1), b('NU 208', 'roller', 40, 80, 18, 62, 53, 6.7), b('NU 210', 'roller', 50, 90, 20, 73.5, 69.5, 8.8),
  b('NU 212', 'roller', 60, 110, 22, 108, 102, 13.4), b('NU 214', 'roller', 70, 125, 24, 137, 137, 17), b('NU 216', 'roller', 80, 140, 26, 160, 166, 20.4),
  b('NU 220', 'roller', 100, 180, 34, 297, 335, 38),
  // tapered roller, 302
  b('30204', 'tapered', 20, 47, 15.25, 33, 32.5, 3.4, { e: 0.35, Y: 1.7, Y0: 0.9 }), b('30205', 'tapered', 25, 52, 16.25, 37.4, 40, 4.3, { e: 0.37, Y: 1.6, Y0: 0.9 }),
  b('30206', 'tapered', 30, 62, 17.25, 50.1, 50, 5.6, { e: 0.37, Y: 1.6, Y0: 0.9 }), b('30208', 'tapered', 40, 80, 19.75, 76.5, 86.5, 9.8, { e: 0.37, Y: 1.6, Y0: 0.9 }),
  b('30210', 'tapered', 50, 90, 21.75, 92.1, 110, 12.5, { e: 0.43, Y: 1.4, Y0: 0.8 }), b('30212', 'tapered', 60, 110, 23.75, 123, 150, 17, { e: 0.4, Y: 1.5, Y0: 0.8 }),
  b('30216', 'tapered', 80, 140, 28.25, 183, 245, 27, { e: 0.43, Y: 1.4, Y0: 0.8 }),
  // spherical roller, 222
  b('22205', 'spherical', 25, 52, 18, 49, 44, 4.75, { e: 0.35, Y1: 1.9, Y2: 2.9, Y0: 1.8 }), b('22206', 'spherical', 30, 62, 20, 64, 60, 6.4, { e: 0.31, Y1: 2.2, Y2: 3.2, Y0: 2 }),
  b('22208', 'spherical', 40, 80, 23, 96.5, 90, 9.8, { e: 0.28, Y1: 2.4, Y2: 3.6, Y0: 2.5 }), b('22210', 'spherical', 50, 90, 23, 104, 108, 11.8, { e: 0.24, Y1: 2.8, Y2: 4.2, Y0: 2.8 }),
  b('22212', 'spherical', 60, 110, 28, 156, 166, 18.6, { e: 0.24, Y1: 2.8, Y2: 4.2, Y0: 2.8 }), b('22216', 'spherical', 80, 140, 33, 236, 270, 29, { e: 0.22, Y1: 3, Y2: 4.5, Y0: 2.8 }),
  b('22220', 'spherical', 100, 180, 46, 425, 490, 48, { e: 0.25, Y1: 2.7, Y2: 4, Y0: 2.5 }),
];

/** Rough price class from family and size (∝ steel volume): € … €€€€. Relative guide only, not a quote. */
export function priceIndex(br: Bearing) {
  const series = br.type === 'ball' && br.name.startsWith('63') ? 1.2 : 1;
  return BEARING_TYPES[br.type].cost * series * ((br.D * br.D * br.B) / (52 * 52 * 15));
}
export const priceClass = (br: Bearing) => { const i = priceIndex(br); return i <= 1.5 ? '€' : i <= 5 ? '€€' : i <= 15 ? '€€€' : '€€€€'; };
const isBallLike = (t: BearingType) => t === 'ball' || t === 'angular' || t === 'selfalign' || t === 'thrust';

/** ISO 281 Table 3, radial deep groove ball bearings, normal clearance: f₀F_a/C₀ → e, Y (X = 0.56). */
const TAB = { r: [0.172, 0.345, 0.689, 1.03, 1.38, 2.07, 3.45, 5.17, 6.89], e: [0.19, 0.22, 0.26, 0.28, 0.3, 0.34, 0.38, 0.42, 0.44], Y: [2.3, 1.99, 1.71, 1.55, 1.45, 1.31, 1.15, 1.04, 1.0] };
const interp = (x: number, xs: number[], ys: number[]) => {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  const i = xs.findIndex((v) => v >= x);
  return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
};
export const F0 = 13; // f₀ for 62/63 series (≈ 12…14), simplified

export function equivalentLoad(b: Bearing, Fr: number, Fa: number) {
  if (b.type === 'roller') return { P: Fr, X: 1, Y: 0, e: 0, P0: Fr };
  if (b.type === 'angular') { // ISO 281 / ISO 76, single row, α = 40°
    const e = 1.14, big = Fr <= 0 ? Fa > 0 : Fa / Fr > e;
    return { P: big ? 0.35 * Fr + 0.57 * Fa : Fr, X: big ? 0.35 : 1, Y: big ? 0.57 : 0, e, P0: Math.max(Fr, 0.5 * Fr + 0.26 * Fa) };
  }
  if (b.type === 'thrust') return { P: Fa, X: 0, Y: 1, e: 0, P0: Fa }; // α = 90°: axial only
  if (b.type === 'selfalign') { // P = F_r + Y₁F_a (≤ e) or 0.65F_r + Y₂F_a
    const e = b.e ?? 0.25, big = Fr <= 0 ? Fa > 0 : Fa / Fr > e;
    return big ? { P: 0.65 * Fr + (b.Y2 ?? 4) * Fa, X: 0.65, Y: b.Y2 ?? 4, e, P0: Fr + (b.Y0 ?? 2.8) * Fa } : { P: Fr + (b.Y1 ?? 2.6) * Fa, X: 1, Y: b.Y1 ?? 2.6, e, P0: Fr + (b.Y0 ?? 2.8) * Fa };
  }
  if (b.type === 'tapered') { // single row: P = F_r, or 0.4F_r + Y·F_a above e
    const e = b.e ?? 0.37, Y = b.Y ?? 1.6, big = Fr <= 0 ? Fa > 0 : Fa / Fr > e;
    return { P: big ? 0.4 * Fr + Y * Fa : Fr, X: big ? 0.4 : 1, Y: big ? Y : 0, e, P0: Math.max(Fr, 0.5 * Fr + (b.Y0 ?? 0.9) * Fa) };
  }
  if (b.type === 'spherical') { // P = F_r + Y₁F_a (≤ e) or 0.67F_r + Y₂F_a
    const e = b.e ?? 0.25, big = Fr <= 0 ? Fa > 0 : Fa / Fr > e;
    return big ? { P: 0.67 * Fr + (b.Y2 ?? 4) * Fa, X: 0.67, Y: b.Y2 ?? 4, e, P0: Fr + (b.Y0 ?? 2.5) * Fa } : { P: Fr + (b.Y1 ?? 2.7) * Fa, X: 1, Y: b.Y1 ?? 2.7, e, P0: Fr + (b.Y0 ?? 2.5) * Fa };
  }
  const ratio = (F0 * Fa) / b.C0;
  const e = interp(ratio, TAB.r, TAB.e), Y = interp(ratio, TAB.r, TAB.Y);
  const big = Fr <= 0 ? Fa > 0 : Fa / Fr > e;
  const P = big ? 0.56 * Fr + Y * Fa : Fr;
  const P0 = Math.max(Fr, 0.6 * Fr + 0.5 * Fa);
  return { P, X: big ? 0.56 : 1, Y: big ? Y : 0, e, P0 };
}

/** Rated viscosity ν₁ (ISO 281 Annex, fitted curves). */
export const nu1 = (n: number, dm: number) => (n < 1000 ? 45000 * Math.pow(n, -0.83) * Math.pow(dm, -0.5) : 4500 * Math.pow(n, -0.5) * Math.pow(dm, -0.5));

/** Life modification factor a_ISO (ISO 281:2007, Eq. 13–16), capped at 50. */
export function aISO(type: 'ball' | 'roller', kappa: number, ecPuP: number) {
  const k = Math.min(Math.max(kappa, 0.1), 4);
  let base: number;
  if (type === 'ball') {
    base = k < 0.4 ? 2.5671 - 2.2649 / Math.pow(k, 0.054381) : k < 1 ? 2.5671 - 1.9987 / Math.pow(k, 0.19087) : 2.5671 - 1.9987 / Math.pow(k, 0.071739);
    const q = 1 - Math.pow(base, 0.83) * Math.pow(ecPuP, 1 / 3);
    return q <= 0 ? 50 : Math.min(0.1 * Math.pow(q, -9.3), 50);
  }
  base = k < 0.4 ? 1.5859 - 1.3993 / Math.pow(k, 0.054381) : k < 1 ? 1.5859 - 1.2348 / Math.pow(k, 0.19087) : 1.5859 - 1.2348 / Math.pow(k, 0.071739);
  const q = 1 - base * Math.pow(ecPuP, 0.4);
  return q <= 0 ? 50 : Math.min(0.1 * Math.pow(q, -9.185), 50);
}

export const RELIABILITY: Record<number, number> = { 90: 1, 95: 0.64, 96: 0.55, 97: 0.47, 98: 0.37, 99: 0.25 };
export const CONTAMINATION: { label: string; ec: number }[] = [
  { label: 'very clean', ec: 0.8 },
  { label: 'clean', ec: 0.6 },
  { label: 'normal', ec: 0.5 },
  { label: 'slightly dirty', ec: 0.3 },
  { label: 'dirty', ec: 0.1 },
];

export type LifeIn = { b: Bearing; Fr: number; Fa: number; n: number; nu: number; ec: number; rel: number; Lreq: number; fd?: number };

export function computeLife(p: LifeIn) {
  const { b } = p;
  const pexp = isBallLike(b.type) ? 3 : 10 / 3;
  const fd = p.fd ?? 1;
  const eq0 = equivalentLoad(b, p.Fr, p.Fa);
  const eq = { ...eq0, P: fd * eq0.P, P0: fd * eq0.P0 }; // application (shock) factor f_d
  const P = Math.max(eq.P, 1e-6);
  const L10 = Math.pow(b.C / P, pexp); // million revolutions
  const L10h = (L10 * 1e6) / (60 * p.n);
  const dm = (b.d + b.D) / 2;
  const v1 = nu1(p.n, dm);
  const kappa = p.nu / v1;
  const a = aISO(isBallLike(b.type) ? 'ball' : 'roller', kappa, (p.ec * b.Pu) / P);
  const a1 = RELIABILITY[p.rel] ?? 1;
  const Lnmh = a1 * a * L10h;
  const s0 = b.C0 / Math.max(eq.P0, 1e-6);
  const minLoad = (isBallLike(b.type) ? 0.01 : 0.02) * b.C;
  const checks = [
    { ok: Lnmh >= p.Lreq, label: 'Modified life L_nm ≥ required life', detail: `${fmtH(Lnmh)} ≥ ${fmtH(p.Lreq)}` },
    { ok: kappa >= 1, label: 'Lubrication κ = ν/ν₁ ≥ 1 (full oil film)', detail: `κ = ${kappa.toFixed(2)}` },
    { ok: s0 >= 1, label: 'Static safety s₀ = C₀/P₀ ≥ 1', detail: `s₀ = ${s0.toFixed(1)}` },
    { ok: P >= minLoad, label: 'Minimum load (no skidding)', detail: `P = ${P.toFixed(2)} ≥ ${minLoad.toFixed(2)} kN` },
    ...(b.type === 'roller' && p.Fa > 0 ? [{ ok: false, label: 'NU bearings take no axial load', detail: `F_a = ${p.Fa} kN` }] : []),
    ...(b.type === 'thrust' && p.Fr > 0 ? [{ ok: false, label: 'Thrust ball bearings take no radial load (add a radial bearing)', detail: `F_r = ${p.Fr} kN` }] : []),
    ...((b.type === 'angular' || b.type === 'tapered' || b.type === 'thrust') && p.Fa > 0 ? [{ ok: true, label: 'Axial load one way only: mount as a pair (back-to-back / face-to-face)', detail: 'single bearing shown' }] : []),
  ];
  return { ...eq, P, Pnom: eq0.P, fd, pexp, L10, L10h, dm, v1, kappa, a, a1, Lnmh, s0, checks };
}

export const fmtH = (h: number) => (h >= 1e6 ? `${(h / 1e6).toFixed(1)} M h` : h >= 1e4 ? `${(h / 1000).toFixed(0)} k h` : `${h.toFixed(0)} h`);

/**
 * Design mode: every catalogue bearing that fits the shaft. Ranked: working ones first; then, for harsh
 * duty, self-aligning / heavy types first; then cheapest price class; then smallest outer diameter.
 */
export function selectBearings(q: Omit<LifeIn, 'b'> & { d: number; type: BearingType | 'any'; app?: AppId }) {
  const app = APPLICATIONS.find((a) => a.id === (q.app ?? 'general'))!;
  const ec = Math.min(q.ec, app.ecMax);
  const harshRank = (t: BearingType) => (app.id !== 'harsh' ? 0 : t === 'spherical' ? 0 : t === 'tapered' || t === 'roller' ? 1 : 2);
  return CATALOGUE.filter((br) => br.d === q.d && (q.type === 'any' || br.type === q.type))
    .map((br) => {
      const r = computeLife({ ...q, ec, fd: app.fd, b: br });
      const ok = r.checks.every((c) => c.ok || c.label.startsWith('Lubrication'));
      return { b: br, r, ok, price: priceClass(br), priceIdx: priceIndex(br) };
    })
    .sort((x, y) => Number(y.ok) - Number(x.ok) || harshRank(x.b.type) - harshRank(y.b.type) || x.priceIdx - y.priceIdx || x.b.D - y.b.D);
}

export const BORES = [...new Set(CATALOGUE.map((b) => b.d))].sort((a, b) => a - b);
