/**
 * Hardness conversion for unalloyed and low-alloy steels and cast steel after ISO 18265:2013 Table A.1
 * (the same values as DIN EN ISO 18265 and the former DIN 50150): tensile strength R_m, Vickers HV, Brinell HB,
 * Rockwell HRB and HRC. Values between table rows are interpolated linearly (as the standard allows); values the
 * table gives in brackets lie outside the defined range of that method and are flagged.
 *
 * Indentation size for the same hardness from the definitions of the tests:
 *  - Brinell ISO 6506-1: HBW = 0.102·2F/(πD(D − √(D² − d²))), depth h = (D − √(D² − d²))/2; valid for 0.24 D ≤ d ≤ 0.6 D,
 *    test force F = 30 D² kgf for steel; minimum specimen thickness 8 h;
 *  - Vickers ISO 6507-1: HV = 0.1891 F/d² (F in N, 136° pyramid), depth h = d/(2√2 tan 68°) ≈ d/7; thickness ≥ 1.5 d;
 *  - Rockwell ISO 6508-1: HRC = 100 − h/0.002 mm (120° diamond cone, 1471 N), HRB = 130 − h/0.002 mm (1/16" ball, 980.7 N),
 *    h = permanent increase of depth; thickness ≥ 10 h (cone), 15 h (ball).
 * Units: N, mm, MPa.
 */

export type Check = { ok: boolean; label: string; detail: string };
export type Scale = 'HV' | 'HB' | 'HRC' | 'HRB' | 'Rm';

/** ISO 18265 Table A.1: [R_m, HV, HB, HRB, HRC]; NaN = no value; HB above 470 HV and HRB above 100 are bracketed in the table. */
const T: [number, number, number, number, number][] = [
  [255, 80, 76, NaN, NaN], [270, 85, 80.7, 41, NaN], [285, 90, 85.5, 48, NaN], [305, 95, 90.2, 52, NaN], [320, 100, 95, 56.2, NaN],
  [335, 105, 99.8, NaN, NaN], [350, 110, 105, 62.3, NaN], [370, 115, 109, NaN, NaN], [385, 120, 114, 66.7, NaN], [400, 125, 119, NaN, NaN],
  [415, 130, 124, 71.2, NaN], [430, 135, 128, NaN, NaN], [450, 140, 133, 75, NaN], [465, 145, 138, NaN, NaN], [480, 150, 143, 78.7, NaN],
  [495, 155, 147, NaN, NaN], [510, 160, 152, 81.7, NaN], [530, 165, 156, NaN, NaN], [545, 170, 162, 85, NaN], [560, 175, 166, NaN, NaN],
  [575, 180, 171, 87.1, NaN], [595, 185, 176, NaN, NaN], [610, 190, 181, 89.5, NaN], [625, 195, 185, NaN, NaN], [640, 200, 190, 91.5, NaN],
  [660, 205, 195, 92.5, NaN], [675, 210, 199, 93.5, NaN], [690, 215, 204, 94, NaN], [705, 220, 209, 95, NaN], [720, 225, 214, 96, NaN],
  [740, 230, 219, 96.7, NaN], [755, 235, 223, NaN, NaN], [770, 240, 228, 98.1, 20.3], [785, 245, 233, NaN, 21.3], [800, 250, 238, 99.5, 22.2],
  [820, 255, 242, 101, 23.1], [835, 260, 247, NaN, 24], [850, 265, 252, 102, 24.8], [865, 270, 257, NaN, 25.6], [880, 275, 261, 104, 26.4],
  [900, 280, 266, NaN, 27.1], [915, 285, 271, 105, 27.8], [930, 290, 276, NaN, 28.5], [950, 295, 280, NaN, 29.2], [965, 300, 285, NaN, 29.8],
  [995, 310, 295, NaN, 31], [1030, 320, 304, NaN, 32.2], [1060, 330, 314, NaN, 33.3], [1095, 340, 323, NaN, 34.3], [1125, 350, 333, NaN, 35.5],
  [1155, 360, 342, NaN, 36.6], [1190, 370, 352, NaN, 37.7], [1220, 380, 361, NaN, 38.8], [1255, 390, 371, NaN, 39.8], [1290, 400, 380, NaN, 40.8],
  [1320, 410, 390, NaN, 41.8], [1350, 420, 399, NaN, 42.7], [1385, 430, 409, NaN, 43.6], [1420, 440, 418, NaN, 44.5], [1455, 450, 428, NaN, 45.3],
  [1485, 460, 437, NaN, 46.1], [1520, 470, 447, NaN, 46.9], [1555, 480, 456, NaN, 47.7], [1595, 490, 466, NaN, 48.4], [1630, 500, 475, NaN, 49.1],
  [1665, 510, 485, NaN, 49.8], [1700, 520, 494, NaN, 50.5], [1740, 530, 504, NaN, 51.1], [1775, 540, 513, NaN, 51.7], [1810, 550, 523, NaN, 52.3],
  [1845, 560, 532, NaN, 53], [1880, 570, 542, NaN, 53.6], [1920, 580, 551, NaN, 54.1], [1955, 590, 561, NaN, 54.7], [1995, 600, 570, NaN, 55.2],
  [2030, 610, 580, NaN, 55.7], [2070, 620, 589, NaN, 56.3], [2105, 630, 599, NaN, 56.8], [2145, 640, 608, NaN, 57.3], [2180, 650, 618, NaN, 57.8],
  [NaN, 660, NaN, NaN, 58.3], [NaN, 670, NaN, NaN, 58.8], [NaN, 680, NaN, NaN, 59.2], [NaN, 690, NaN, NaN, 59.7], [NaN, 700, NaN, NaN, 60.1],
  [NaN, 720, NaN, NaN, 61], [NaN, 740, NaN, NaN, 61.8], [NaN, 760, NaN, NaN, 62.5], [NaN, 780, NaN, NaN, 63.3], [NaN, 800, NaN, NaN, 64],
  [NaN, 820, NaN, NaN, 64.7], [NaN, 840, NaN, NaN, 65.3], [NaN, 860, NaN, NaN, 65.9], [NaN, 880, NaN, NaN, 66.4], [NaN, 900, NaN, NaN, 67],
  [NaN, 920, NaN, NaN, 67.5], [NaN, 940, NaN, NaN, 68],
];
const COL: Record<Scale, number> = { Rm: 0, HV: 1, HB: 2, HRB: 3, HRC: 4 };
export const TABLE = T.map(([Rm, HV, HB, HRB, HRC]) => ({ Rm, HV, HB, HRB, HRC }));
export const HB_DEFINED_MAX_HV = 470; // HB in brackets above (steel-ball era limit of the table)
export const HRB_DEFINED_MAX = 100;   // HRB in brackets above

/** Range of each scale covered by the table [min, max]. */
export function scaleRange(s: Scale): [number, number] {
  const v = T.map((r) => r[COL[s]]).filter(Number.isFinite);
  return [Math.min(...v), Math.max(...v)];
}

/** Linear interpolation of column `to` against column `from` over the rows where both exist (both increase with hardness). */
function interp(from: Scale, to: Scale, x: number) {
  const rows = T.filter((r) => Number.isFinite(r[COL[from]]) && Number.isFinite(r[COL[to]]));
  if (!rows.length) return NaN;
  const a = rows[0][COL[from]], b = rows[rows.length - 1][COL[from]];
  if (x < a - 1e-9 || x > b + 1e-9) return NaN;
  for (let i = 1; i < rows.length; i++) {
    const x0 = rows[i - 1][COL[from]], x1 = rows[i][COL[from]];
    if (x <= x1 + 1e-9) return rows[i - 1][COL[to]] + ((x - x0) / (x1 - x0)) * (rows[i][COL[to]] - rows[i - 1][COL[to]]);
  }
  return rows[rows.length - 1][COL[to]];
}

/** All scales for a value given in one scale (through HV, which every row has). */
export function convert(s: Scale, v: number) {
  const HV = s === 'HV' ? v : interp(s, 'HV', v);
  return { HV, HB: interp('HV', 'HB', HV), HRC: interp('HV', 'HRC', HV), HRB: interp('HV', 'HRB', HV), Rm: interp('HV', 'Rm', HV) };
}

const KGF = 9.80665;
/** Brinell: ball D [mm], F = 30 D² kgf (steel); diameter and depth of the indentation for a hardness HBW. */
export function brinell(HB: number, D: number) {
  const F = 30 * D * D * KGF, twoH = (0.204 * F) / (Math.PI * D * HB); // D − √(D² − d²) = 2h
  const d = twoH < D ? Math.sqrt(D * D - (D - twoH) ** 2) : NaN;
  return { F, d, h: twoH / 2 };
}
/** Brinell hardness from the measured indentation diameter. */
export const hbFromD = (d: number, D: number, F = 30 * D * D * KGF) => (0.102 * 2 * F) / (Math.PI * D * (D - Math.sqrt(D * D - d * d)));
/** Vickers: test force [N]; mean diagonal and depth for a hardness HV. */
export function vickers(HV: number, F: number) {
  const d = Math.sqrt((0.1891 * F) / HV);
  return { F, d, h: d / (2 * Math.SQRT2 * Math.tan((68 * Math.PI) / 180)) };
}
/** Rockwell: permanent depth increase h [mm] (0.002 mm per point). */
export const rockwellDepth = (scale: 'HRC' | 'HRB', v: number) => (scale === 'HRC' ? 100 - v : 130 - v) * 0.002;

export const VICKERS_LOADS = [1, 5, 10, 30, 50] as const; // HV1 … HV50 (kgf)
export const BALLS = [10, 5, 2.5, 1] as const;              // Brinell ball diameters [mm], F/D² = 30

export type HardIn = { scale: Scale; value: number; D: number; hvLoad: number; t: number };

export function hardness(p: HardIn) {
  const c = convert(p.scale, p.value);
  const rock: 'HRC' | 'HRB' = Number.isFinite(c.HRC) ? 'HRC' : 'HRB';
  const rv = rock === 'HRC' ? c.HRC : c.HRB;
  const b = brinell(c.HB, p.D), v = vickers(c.HV, p.hvLoad * KGF), hR = rockwellDepth(rock, rv);
  const rMin = rock === 'HRC' ? 10 * hR : 15 * hR;
  const fmt = (x: number, n = 0) => (Number.isFinite(x) ? x.toFixed(n) : '—');
  const checks: Check[] = [
    { ok: Number.isFinite(c.HB) && c.HV <= HB_DEFINED_MAX_HV, label: 'Brinell number inside the defined range of the table', detail: Number.isFinite(c.HB) ? `${fmt(c.HB)} HB${c.HV > HB_DEFINED_MAX_HV ? ' (in brackets)' : ''}` : 'beyond 650 HV' },
    { ok: Number.isFinite(b.d) && b.d >= 0.24 * p.D && b.d <= 0.6 * p.D, label: 'Brinell indentation 0.24 D ≤ d ≤ 0.6 D (valid test)', detail: `d = ${fmt(b.d, 2)} mm, ${fmt(0.24 * p.D, 2)}…${fmt(0.6 * p.D, 2)} mm` },
    { ok: Number.isFinite(rv) && (rock === 'HRC' || rv <= HRB_DEFINED_MAX), label: 'A Rockwell scale fits (HRB 41…100 or HRC 20…68)', detail: Number.isFinite(rv) ? `${rv.toFixed(1)} ${rock}` : 'too soft for HRB' },
    { ok: Number.isFinite(b.h) && p.t >= 8 * b.h, label: 'Specimen thick enough for Brinell (t ≥ 8 h)', detail: `${fmt(p.t, 2)} ≥ ${fmt(8 * b.h, 2)} mm` },
    { ok: p.t >= 1.5 * v.d, label: 'Specimen thick enough for Vickers (t ≥ 1.5 d)', detail: `${fmt(p.t, 2)} ≥ ${fmt(1.5 * v.d, 2)} mm` },
    { ok: Number.isFinite(hR) && p.t >= rMin, label: rock === 'HRC' ? 'Specimen thick enough for Rockwell C (t ≥ 10 h)' : 'Specimen thick enough for Rockwell B (t ≥ 15 h)', detail: `${fmt(p.t, 2)} ≥ ${fmt(rMin, 2)} mm` },
  ];
  return { ...c, rock, rv, b, v, hR, rMin, ratio: c.Rm / c.HV, checks };
}
export type HardResult = ReturnType<typeof hardness>;

export const HARD_INTRO = 'Hardness is the resistance to a permanent dent. Brinell presses a hard ball, Vickers a diamond pyramid, Rockwell a diamond cone or a small ball; each measures the dent differently, so the numbers are on different scales. For ordinary steels they are linked through tables (ISO 18265), and also to the tensile strength — a quick way to estimate R_m from a hardness test.';

export const HARD_NOTES = [
  'Conversion: ISO 18265:2013 Table A.1 for unalloyed and low-alloy steels and cast steel (same values as the former DIN 50150), linear interpolation between rows. Brinell values above 470 HV and HRB values above 100 are in brackets in the table (outside the defined range). Conversions are approximate — every conversion adds uncertainty; for stainless steels, non-ferrous metals, cold-worked, case-hardened or surface-treated parts other tables apply (ISO 18265 Annexes B…F) or none at all. ASTM E140 Table 1 gives nearly the same values (HRC 20…60 within about 1 %).',
  'Test definitions: Brinell ISO 6506-1 (tungsten carbide ball, F = 30 D² kgf for steel, HBW up to 650; valid when 0.24 D ≤ d ≤ 0.6 D; specimen at least 8 h thick). Vickers ISO 6507-1 (136° diamond pyramid, HV = 0.1891 F/d², d = mean diagonal; thickness ≥ 1.5 d). Rockwell ISO 6508-1 (preload 98 N, HRC: 120° diamond cone with 1471 N total, HRB: 1/16 in ball with 980.7 N; one point = 0.002 mm of permanent depth; thickness ≥ 10 h for the cone and 15 h for the ball). Edge and spacing distances of the standards also apply.',
  'Tensile strength from hardness is an estimate for homogeneous material (about R_m ≈ 3.2 HV for steels); it does not give the yield strength or the ductility.',
];
