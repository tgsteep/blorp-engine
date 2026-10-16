/**
 * Reference tables for the workshop: typical material properties, hot-rolled steel sections (EN 10365 dimensions)
 * and steel pipe sizes (ASME B36.10M schedules, EN 10255 threadable tubes).
 * Section properties of I and H sections are computed from the nominal dimensions with the root fillets
 * (as the catalogues do); channels and angles carry the catalogue area and second moment.
 */

/* ---------------- materials ---------------- */

export type MatGroup = 'steel' | 'nonferrous' | 'polymer' | 'other';
/** ρ kg/m³, E GPa, ν, α 10⁻⁶/K, λ W/(m·K), c J/(kg·K), Re (R_p0.2) and Rm MPa (typical minimum; plastics: tensile strength). */
export type MatRow = { id: string; name: string; group: MatGroup; rho: number; E: number; nu: number; alpha: number; lambda: number; c: number; Re?: number; Rm: number; note?: string };

export const MATS: MatRow[] = [
  { id: 's235', name: 'Structural steel S235', group: 'steel', rho: 7850, E: 210, nu: 0.3, alpha: 12, lambda: 50, c: 460, Re: 235, Rm: 360, note: 'EN 10025-2, t ≤ 16 mm' },
  { id: 's355', name: 'Structural steel S355', group: 'steel', rho: 7850, E: 210, nu: 0.3, alpha: 12, lambda: 50, c: 460, Re: 355, Rm: 470, note: 'EN 10025-2, t ≤ 16 mm' },
  { id: 'c45', name: 'Carbon steel C45 (normalised)', group: 'steel', rho: 7850, E: 210, nu: 0.3, alpha: 11.5, lambda: 45, c: 470, Re: 340, Rm: 620, note: 'EN ISO 683-1 +N, d ≤ 16 mm' },
  { id: '42crmo4', name: 'Alloy steel 42CrMo4 (quenched and tempered)', group: 'steel', rho: 7850, E: 210, nu: 0.3, alpha: 11.5, lambda: 42, c: 460, Re: 900, Rm: 1100, note: 'EN ISO 683-2 +QT, d ≤ 16 mm' },
  { id: '304', name: 'Stainless steel 1.4301 (304)', group: 'steel', rho: 7900, E: 200, nu: 0.29, alpha: 16, lambda: 15, c: 500, Re: 210, Rm: 520, note: 'EN 10088-2, annealed' },
  { id: '316', name: 'Stainless steel 1.4404 (316L)', group: 'steel', rho: 8000, E: 200, nu: 0.29, alpha: 16, lambda: 15, c: 500, Re: 220, Rm: 520, note: 'EN 10088-2, annealed' },
  { id: 'gjl', name: 'Grey cast iron EN-GJL-250', group: 'steel', rho: 7200, E: 110, nu: 0.26, alpha: 10, lambda: 48, c: 460, Rm: 250, note: 'EN 1561; E falls with stress' },
  { id: 'gjs', name: 'Ductile iron EN-GJS-400-15', group: 'steel', rho: 7100, E: 169, nu: 0.275, alpha: 12.5, lambda: 36, c: 515, Re: 250, Rm: 400, note: 'EN 1563' },
  { id: 'al6061', name: 'Aluminium 6061-T6', group: 'nonferrous', rho: 2700, E: 69, nu: 0.33, alpha: 23.6, lambda: 167, c: 896, Re: 240, Rm: 260, note: 'EN 755-2 extrusion' },
  { id: 'al6082', name: 'Aluminium 6082-T6', group: 'nonferrous', rho: 2700, E: 70, nu: 0.33, alpha: 23.4, lambda: 170, c: 900, Re: 260, Rm: 310, note: 'EN 755-2 extrusion' },
  { id: 'al5754', name: 'Aluminium 5754-H22 (sheet)', group: 'nonferrous', rho: 2670, E: 70, nu: 0.33, alpha: 23.7, lambda: 140, c: 900, Re: 130, Rm: 220, note: 'EN 485-2' },
  { id: 'al7075', name: 'Aluminium 7075-T6', group: 'nonferrous', rho: 2810, E: 72, nu: 0.33, alpha: 23.4, lambda: 130, c: 960, Re: 460, Rm: 540, note: 'EN 755-2' },
  { id: 'cu', name: 'Copper Cu-ETP', group: 'nonferrous', rho: 8930, E: 120, nu: 0.34, alpha: 17, lambda: 390, c: 385, Re: 70, Rm: 220, note: 'EN 13601, annealed R220' },
  { id: 'brass', name: 'Brass CuZn39Pb3', group: 'nonferrous', rho: 8470, E: 96, nu: 0.34, alpha: 20.9, lambda: 123, c: 377, Re: 250, Rm: 430, note: 'EN 12164, free-cutting' },
  { id: 'bronze', name: 'Tin bronze CuSn8', group: 'nonferrous', rho: 8800, E: 115, nu: 0.34, alpha: 18.5, lambda: 67, c: 380, Re: 300, Rm: 450, note: 'EN 1652, R450' },
  { id: 'ti2', name: 'Titanium grade 2', group: 'nonferrous', rho: 4510, E: 105, nu: 0.37, alpha: 8.6, lambda: 16.4, c: 523, Re: 275, Rm: 345, note: 'ASTM B265' },
  { id: 'ti64', name: 'Titanium Ti-6Al-4V', group: 'nonferrous', rho: 4430, E: 114, nu: 0.34, alpha: 8.6, lambda: 6.7, c: 526, Re: 880, Rm: 950, note: 'ASTM B265 grade 5' },
  { id: 'mg', name: 'Magnesium AZ31B', group: 'nonferrous', rho: 1770, E: 45, nu: 0.35, alpha: 26, lambda: 96, c: 1020, Re: 200, Rm: 260, note: 'sheet, H24' },
  { id: 'zn', name: 'Zinc (rolled)', group: 'nonferrous', rho: 7140, E: 95, nu: 0.25, alpha: 30, lambda: 113, c: 390, Rm: 150 },
  { id: 'pb', name: 'Lead', group: 'nonferrous', rho: 11340, E: 16, nu: 0.44, alpha: 29, lambda: 35, c: 129, Rm: 17 },
  { id: 'in718', name: 'Nickel alloy 718 (aged)', group: 'nonferrous', rho: 8190, E: 200, nu: 0.29, alpha: 13, lambda: 11.4, c: 435, Re: 1030, Rm: 1240, note: 'AMS 5662/5663' },
  { id: 'pe', name: 'Polyethylene PE-HD', group: 'polymer', rho: 955, E: 1.0, nu: 0.45, alpha: 180, lambda: 0.45, c: 1900, Rm: 25, note: '23 °C' },
  { id: 'pp', name: 'Polypropylene PP', group: 'polymer', rho: 905, E: 1.4, nu: 0.42, alpha: 150, lambda: 0.22, c: 1900, Rm: 32, note: '23 °C' },
  { id: 'pvc', name: 'PVC-U (rigid)', group: 'polymer', rho: 1400, E: 3.0, nu: 0.38, alpha: 70, lambda: 0.16, c: 1000, Rm: 50, note: '23 °C' },
  { id: 'pa6', name: 'Polyamide PA6 (dry)', group: 'polymer', rho: 1140, E: 3.0, nu: 0.39, alpha: 85, lambda: 0.25, c: 1700, Rm: 80, note: 'dry as moulded; conditioned about ⅓ less stiff' },
  { id: 'pom', name: 'Acetal POM-C', group: 'polymer', rho: 1410, E: 2.8, nu: 0.35, alpha: 110, lambda: 0.31, c: 1460, Rm: 65, note: '23 °C' },
  { id: 'pc', name: 'Polycarbonate PC', group: 'polymer', rho: 1200, E: 2.4, nu: 0.37, alpha: 65, lambda: 0.2, c: 1200, Rm: 65, note: '23 °C' },
  { id: 'pmma', name: 'Acrylic PMMA', group: 'polymer', rho: 1190, E: 3.2, nu: 0.37, alpha: 70, lambda: 0.19, c: 1450, Rm: 70, note: '23 °C' },
  { id: 'ptfe', name: 'PTFE', group: 'polymer', rho: 2170, E: 0.5, nu: 0.46, alpha: 120, lambda: 0.25, c: 1000, Rm: 25, note: '23 °C' },
  { id: 'peek', name: 'PEEK', group: 'polymer', rho: 1300, E: 3.6, nu: 0.38, alpha: 47, lambda: 0.25, c: 1340, Rm: 100, note: '23 °C' },
  { id: 'concrete', name: 'Concrete C30/37', group: 'other', rho: 2400, E: 33, nu: 0.2, alpha: 10, lambda: 1.8, c: 880, Rm: 30, note: 'EN 1992-1-1; Rm = f_ck in compression' },
  { id: 'glass', name: 'Glass (soda-lime)', group: 'other', rho: 2500, E: 70, nu: 0.22, alpha: 9, lambda: 1.0, c: 840, Rm: 45, note: 'bending strength, annealed' },
  { id: 'c24', name: 'Softwood C24', group: 'other', rho: 420, E: 11, nu: 0.3, alpha: 5, lambda: 0.13, c: 1600, Rm: 24, note: 'EN 338; along the grain, Rm = f_m,k' },
];

export const matById = (id: string) => MATS.find((m) => m.id === id);

/* ---------------- sections ---------------- */

export type SectionFamily = 'IPE' | 'HEA' | 'HEB' | 'UPN' | 'L';
/** Dimensions mm; A cm², G kg/m, I cm⁴, W cm³ (y = strong axis). For angles y = z (equal legs) and e = centroid distance from the back, cm. */
export type SectionRow = { name: string; h: number; b: number; tw: number; tf: number; r: number; A: number; G: number; Iy: number; Wy: number; Iz: number; Wz: number; e?: number };

const STEEL = 7850;
/** I/H section from h, b, tw, tf, r (four root fillets of radius r). */
function iSection(name: string, h: number, b: number, tw: number, tf: number, r: number): SectionRow {
  // fillet (spandrel) area; its centroid sits 0.2234 r from both straight edges, own second moment ≈ 0.0075 r⁴
  const fa = (1 - Math.PI / 4) * r * r, k = 0.2234 * r, hw = h - 2 * tf;
  const A = 2 * b * tf + hw * tw + 4 * fa;
  const Iy = (b * h ** 3 - (b - tw) * hw ** 3) / 12 + 4 * fa * (hw / 2 - k) ** 2 + 4 * 0.0075 * r ** 4;
  const Iz = 2 * tf * b ** 3 / 12 + hw * tw ** 3 / 12 + 4 * fa * (tw / 2 + k) ** 2 + 4 * 0.0075 * r ** 4;
  return { name, h, b, tw, tf, r, A: A / 100, G: (A * 1e-6) * STEEL, Iy: Iy / 1e4, Wy: Iy / (h / 2) / 1e3, Iz: Iz / 1e4, Wz: Iz / (b / 2) / 1e3 };
}

const IPE_D: [number, number, number, number, number][] = [
  [80, 46, 3.8, 5.2, 5], [100, 55, 4.1, 5.7, 7], [120, 64, 4.4, 6.3, 7], [140, 73, 4.7, 6.9, 7], [160, 82, 5.0, 7.4, 9], [180, 91, 5.3, 8.0, 9],
  [200, 100, 5.6, 8.5, 12], [220, 110, 5.9, 9.2, 12], [240, 120, 6.2, 9.8, 15], [270, 135, 6.6, 10.2, 15], [300, 150, 7.1, 10.7, 15], [330, 160, 7.5, 11.5, 18],
  [360, 170, 8.0, 12.7, 18], [400, 180, 8.6, 13.5, 21], [450, 190, 9.4, 14.6, 21], [500, 200, 10.2, 16.0, 21], [550, 210, 11.1, 17.2, 24], [600, 220, 12.0, 19.0, 24],
];
/** HEA / HEB: [size, h, b, tw, tf, r] */
const HEA_D: [number, number, number, number, number, number][] = [
  [100, 96, 100, 5, 8, 12], [120, 114, 120, 5, 8, 12], [140, 133, 140, 5.5, 8.5, 12], [160, 152, 160, 6, 9, 15], [180, 171, 180, 6, 9.5, 15], [200, 190, 200, 6.5, 10, 18],
  [220, 210, 220, 7, 11, 18], [240, 230, 240, 7.5, 12, 21], [260, 250, 260, 7.5, 12.5, 24], [280, 270, 280, 8, 13, 24], [300, 290, 300, 8.5, 14, 27], [320, 310, 300, 9, 15.5, 27],
  [340, 330, 300, 9.5, 16.5, 27], [360, 350, 300, 10, 17.5, 27], [400, 390, 300, 11, 19, 27], [450, 440, 300, 11.5, 21, 27], [500, 490, 300, 12, 23, 27],
];
const HEB_D: [number, number, number, number, number, number][] = [
  [100, 100, 100, 6, 10, 12], [120, 120, 120, 6.5, 11, 12], [140, 140, 140, 7, 12, 12], [160, 160, 160, 8, 13, 15], [180, 180, 180, 8.5, 14, 15], [200, 200, 200, 9, 15, 18],
  [220, 220, 220, 9.5, 16, 18], [240, 240, 240, 10, 17, 21], [260, 260, 260, 10, 17.5, 24], [280, 280, 280, 10.5, 18, 24], [300, 300, 300, 11, 19, 27], [320, 320, 300, 11.5, 20.5, 27],
  [340, 340, 300, 12, 21.5, 27], [360, 360, 300, 12.5, 22.5, 27], [400, 400, 300, 13.5, 24, 27], [450, 450, 300, 14, 26, 27], [500, 500, 300, 14.5, 28, 27],
];
/** UPN (tapered flanges, 8 %): [h, b, tw, tf (mean), r, A cm², Iy cm⁴, Iz cm⁴] — catalogue values (EN 10365). */
const UPN_D: [number, number, number, number, number, number, number, number][] = [
  [80, 45, 6, 8, 8, 11.0, 106, 19.4], [100, 50, 6, 8.5, 8.5, 13.5, 206, 29.3], [120, 55, 7, 9, 9, 17.0, 364, 43.2], [140, 60, 7, 10, 10, 20.4, 605, 62.7],
  [160, 65, 7.5, 10.5, 10.5, 24.0, 925, 85.3], [180, 70, 8, 11, 11, 28.0, 1350, 114], [200, 75, 8.5, 11.5, 11.5, 32.2, 1910, 148], [220, 80, 9, 12.5, 12.5, 37.4, 2690, 197],
  [240, 85, 9.5, 13, 13, 42.3, 3600, 248], [260, 90, 10, 14, 14, 48.3, 4820, 317], [280, 95, 10, 15, 15, 53.3, 6280, 399], [300, 100, 10, 16, 16, 58.8, 8030, 495],
];
/** Equal angles EN 10056-1: [a, t, r1, A cm², I cm⁴, e cm] — catalogue values. */
const L_D: [number, number, number, number, number, number][] = [
  [20, 3, 3.5, 1.12, 0.39, 0.60], [25, 3, 3.5, 1.42, 0.80, 0.72], [25, 4, 3.5, 1.85, 1.01, 0.76], [30, 3, 5, 1.74, 1.40, 0.84], [30, 4, 5, 2.27, 1.80, 0.88],
  [35, 4, 5, 2.67, 2.95, 1.00], [40, 4, 6, 3.08, 4.47, 1.12], [40, 5, 6, 3.79, 5.43, 1.16], [45, 5, 7, 4.30, 7.84, 1.28], [50, 5, 7, 4.80, 11.0, 1.40],
  [50, 6, 7, 5.69, 12.8, 1.45], [60, 6, 8, 6.91, 22.8, 1.69], [60, 8, 8, 9.03, 29.2, 1.77], [70, 7, 9, 9.40, 42.3, 1.97], [80, 8, 10, 12.3, 72.2, 2.26],
  [90, 9, 11, 15.5, 116, 2.54], [100, 10, 12, 19.2, 177, 2.82], [120, 12, 13, 27.5, 368, 3.40], [150, 15, 16, 43.0, 898, 4.25],
];

export const SECTIONS_TABLE: Record<SectionFamily, SectionRow[]> = {
  IPE: IPE_D.map(([h, b, tw, tf, r]) => iSection(`IPE ${h}`, h, b, tw, tf, r)),
  HEA: HEA_D.map(([n, h, b, tw, tf, r]) => iSection(`HEA ${n}`, h, b, tw, tf, r)),
  HEB: HEB_D.map(([n, h, b, tw, tf, r]) => iSection(`HEB ${n}`, h, b, tw, tf, r)),
  UPN: UPN_D.map(([h, b, tw, tf, r, A, Iy, Iz]) => {
    // centroid from the back of the web (thin-wall estimate) for W_z to the flange tips
    const Af = b * tf, Aw = (h - 2 * tf) * tw, ez = (2 * Af * b / 2 + Aw * tw / 2) / (2 * Af + Aw);
    return { name: `UPN ${h}`, h, b, tw, tf, r, A, G: A * 1e-4 * STEEL, Iy, Wy: Iy / (h / 20), Iz, Wz: Iz / ((b - ez) / 10) };
  }),
  L: L_D.map(([a, t, r, A, I, e]) => ({ name: `L ${a}×${a}×${t}`, h: a, b: a, tw: t, tf: t, r, A, G: A * 1e-4 * STEEL, Iy: I, Wy: I / (a / 10 - e), Iz: I, Wz: I / (a / 10 - e), e })),
};

/** Area of an equal angle from a, t and the root fillet (toe radii ignored), mm² — consistency check of the table. */
export const angleArea = (a: number, t: number, r: number) => t * (2 * a - t) + (1 - Math.PI / 4) * r * r;
/** Area of a channel with mean flange thickness (fillets ignored), mm². */
export const channelArea = (h: number, b: number, tw: number, tf: number) => 2 * b * tf + (h - 2 * tf) * tw;

/* ---------------- pipes ---------------- */

/** ASME B36.10M: NPS, DN, OD mm, wall mm for Sch 10 / 40 / 80 (Sch 10 below 1/2 in from B36.19M). */
export type PipeRow = { nps: string; dn: number; od: number; walls: number[] };
export const ASME_SCHEDULES = ['Sch 10', 'Sch 40', 'Sch 80'];
export const ASME_PIPES: PipeRow[] = [
  { nps: '1/8', dn: 6, od: 10.3, walls: [1.24, 1.73, 2.41] }, { nps: '1/4', dn: 8, od: 13.7, walls: [1.65, 2.24, 3.02] },
  { nps: '3/8', dn: 10, od: 17.1, walls: [1.65, 2.31, 3.20] }, { nps: '1/2', dn: 15, od: 21.3, walls: [2.11, 2.77, 3.73] },
  { nps: '3/4', dn: 20, od: 26.7, walls: [2.11, 2.87, 3.91] }, { nps: '1', dn: 25, od: 33.4, walls: [2.77, 3.38, 4.55] },
  { nps: '1 1/4', dn: 32, od: 42.2, walls: [2.77, 3.56, 4.85] }, { nps: '1 1/2', dn: 40, od: 48.3, walls: [2.77, 3.68, 5.08] },
  { nps: '2', dn: 50, od: 60.3, walls: [2.77, 3.91, 5.54] }, { nps: '2 1/2', dn: 65, od: 73.0, walls: [3.05, 5.16, 7.01] },
  { nps: '3', dn: 80, od: 88.9, walls: [3.05, 5.49, 7.62] }, { nps: '4', dn: 100, od: 114.3, walls: [3.05, 6.02, 8.56] },
  { nps: '5', dn: 125, od: 141.3, walls: [3.40, 6.55, 9.53] }, { nps: '6', dn: 150, od: 168.3, walls: [3.40, 7.11, 10.97] },
  { nps: '8', dn: 200, od: 219.1, walls: [3.76, 8.18, 12.70] }, { nps: '10', dn: 250, od: 273.1, walls: [4.19, 9.27, 15.09] },
  { nps: '12', dn: 300, od: 323.9, walls: [4.57, 10.31, 17.48] }, { nps: '14', dn: 350, od: 355.6, walls: [6.35, 11.13, 19.05] },
  { nps: '16', dn: 400, od: 406.4, walls: [6.35, 12.70, 21.44] }, { nps: '18', dn: 450, od: 457.0, walls: [6.35, 14.27, 23.83] },
  { nps: '20', dn: 500, od: 508.0, walls: [6.35, 15.09, 26.19] }, { nps: '24', dn: 600, od: 610.0, walls: [6.35, 17.48, 30.96] },
];
/** EN 10255 threadable steel tubes: medium (M) and heavy (H) series walls, mm; R = pipe thread size in inches. */
export const EN10255_SERIES = ['Medium', 'Heavy'];
export const EN10255_PIPES: PipeRow[] = [
  { nps: '1/8', dn: 6, od: 10.2, walls: [2.0, 2.6] }, { nps: '1/4', dn: 8, od: 13.5, walls: [2.3, 2.9] }, { nps: '3/8', dn: 10, od: 17.2, walls: [2.3, 2.9] },
  { nps: '1/2', dn: 15, od: 21.3, walls: [2.6, 3.2] }, { nps: '3/4', dn: 20, od: 26.9, walls: [2.6, 3.2] }, { nps: '1', dn: 25, od: 33.7, walls: [3.2, 4.0] },
  { nps: '1 1/4', dn: 32, od: 42.4, walls: [3.2, 4.0] }, { nps: '1 1/2', dn: 40, od: 48.3, walls: [3.2, 4.0] }, { nps: '2', dn: 50, od: 60.3, walls: [3.6, 4.5] },
  { nps: '2 1/2', dn: 65, od: 76.1, walls: [3.6, 4.5] }, { nps: '3', dn: 80, od: 88.9, walls: [4.0, 5.0] }, { nps: '4', dn: 100, od: 114.3, walls: [4.5, 5.4] },
  { nps: '5', dn: 125, od: 139.7, walls: [5.0, 5.4] }, { nps: '6', dn: 150, od: 165.1, walls: [5.0, 5.4] },
];

/** Inside diameter, steel mass per metre, water content and inside area of a pipe. */
export function pipeProps(od: number, t: number, rho = STEEL) {
  const di = od - 2 * t, A = (Math.PI / 4) * (od * od - di * di);
  return { di, kgm: A * 1e-6 * rho, litres: (Math.PI / 4) * di * di * 1e-3, Ai: (Math.PI / 4) * di * di, A };
}
