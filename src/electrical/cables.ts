/**
 * Low-voltage cable sizing after IEC 60364-5-52 (simplified): current-carrying capacity × correction
 * factors ≥ protective device rating ≥ design current, voltage drop, adiabatic short-circuit check.
 * Units: A, V, m, mm², s.
 */

export const SIZES = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240];

export type Method = 'A1' | 'B1' | 'C' | 'E';
export const METHODS: Record<Method, string> = {
  A1: 'A1 · in conduit inside an insulated wall',
  B1: 'B1 · in conduit / trunking on a wall',
  C: 'C · clipped directly on a wall',
  E: 'E · multicore cable on a tray / in free air',
};

/**
 * Copper, PVC (70 °C), ambient 30 °C — IEC 60364-5-52 Table B.52.2 (two loaded conductors) and
 * B.52.4 (three loaded conductors), typical published values.
 */
const PVC_CU: Record<2 | 3, Record<Method, number[]>> = {
  2: {
    A1: [14.5, 19.5, 26, 34, 46, 61, 80, 99, 119, 151, 182, 210, 240, 273, 320],
    B1: [17.5, 24, 32, 41, 57, 76, 101, 125, 151, 192, 232, 269, 300, 341, 400],
    C: [19.5, 27, 36, 46, 63, 85, 112, 138, 168, 213, 258, 299, 344, 392, 461],
    E: [22, 30, 40, 51, 70, 94, 119, 148, 180, 232, 282, 328, 379, 434, 514],
  },
  3: {
    A1: [13.5, 18, 24, 31, 42, 56, 73, 89, 108, 136, 164, 188, 216, 245, 286],
    B1: [15.5, 21, 28, 36, 50, 68, 89, 110, 134, 171, 207, 239, 266, 302, 354],
    C: [17.5, 24, 32, 41, 57, 76, 96, 119, 144, 184, 223, 259, 299, 341, 403],
    E: [18.5, 25, 34, 43, 60, 80, 101, 126, 153, 196, 238, 276, 319, 364, 430],
  },
};
/** XLPE (90 °C) gains over PVC, method C, by size (from IEC tables, interpolated). */
const XLPE_GAIN = (S: number) => 1.18 + 0.1 * Math.min(Math.log10(S / 1.5) / Math.log10(240 / 1.5), 1);
/** Aluminium ≈ 0.78 × copper of the same size (IEC tables, sizes ≥ 16 mm² in practice). */
const AL_FACTOR = 0.78;

/** Ambient temperature correction, cables in air (IEC 60364-5-52 Table B.52.14). */
const TEMP_T = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
const TEMP_PVC = [1.22, 1.17, 1.12, 1.06, 1.0, 0.94, 0.87, 0.79, 0.71, 0.61, 0.5];
const TEMP_XLPE = [1.15, 1.12, 1.08, 1.04, 1.0, 0.96, 0.91, 0.87, 0.82, 0.76, 0.71];
/** Grouping, bunched circuits (Table B.52.17, row 1). */
const GROUP = [1, 0.8, 0.7, 0.65, 0.6, 0.57, 0.54, 0.52, 0.5];
export const BREAKERS = [6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400];

const interp = (x: number, xs: number[], ys: number[]) => {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  const i = xs.findIndex((v) => v >= x);
  return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
};

export type Insulation = 'PVC' | 'XLPE';
export type Metal = 'Cu' | 'Al';
export type System = '1ph' | '3ph' | 'dc';

export const tempFactor = (ins: Insulation, T: number) => interp(T, TEMP_T, ins === 'PVC' ? TEMP_PVC : TEMP_XLPE);
export const groupFactor = (n: number) => GROUP[Math.min(Math.max(Math.round(n), 1), GROUP.length) - 1];

/** Tabulated capacity I_z0 (before correction factors). */
export function baseCapacity(S: number, method: Method, loaded: 2 | 3, ins: Insulation, metal: Metal) {
  const i = SIZES.indexOf(S);
  const cu = PVC_CU[loaded][method][i];
  return cu * (ins === 'XLPE' ? XLPE_GAIN(S) : 1) * (metal === 'Al' ? AL_FACTOR : 1);
}

/** Conductor resistance at operating temperature [Ω/m]: ρ₂₀·(1 + α·(θ − 20))/S. */
export function resistance(S: number, metal: Metal, ins: Insulation) {
  const rho20 = metal === 'Cu' ? 0.017241 : 0.028264, alpha = metal === 'Cu' ? 0.00393 : 0.00403;
  const theta = ins === 'PVC' ? 70 : 90;
  return (rho20 * (1 + alpha * (theta - 20))) / S;
}
export const REACTANCE = 0.08e-3; // Ω/m, typical for LV multicore cables

/** Adiabatic k factor (IEC 60364-5-54 / 4-43). */
export const kFactor = (metal: Metal, ins: Insulation) => (metal === 'Cu' ? (ins === 'PVC' ? 115 : 143) : ins === 'PVC' ? 76 : 94);

export type CableIn = {
  system: System; U: number; // V (line for 3ph)
  P: number; cosphi: number; // load kW, power factor (1 for DC)
  L: number; method: Method; ins: Insulation; metal: Metal;
  Tamb: number; groups: number; dUmax: number; // % limit
  Ik: number; tk: number; // short-circuit current [kA] and clearing time [s]
};

export function designCurrent(c: CableIn) {
  const P = c.P * 1000;
  return c.system === '3ph' ? P / (Math.sqrt(3) * c.U * c.cosphi) : P / (c.U * (c.system === 'dc' ? 1 : c.cosphi));
}

export function voltageDrop(c: CableIn, S: number, I: number) {
  const R = resistance(S, c.metal, c.ins), X = c.system === 'dc' ? 0 : REACTANCE;
  const sin = Math.sqrt(Math.max(1 - c.cosphi ** 2, 0)), cos = c.system === 'dc' ? 1 : c.cosphi;
  const factor = c.system === '3ph' ? Math.sqrt(3) : 2;
  const dU = factor * c.L * I * (R * cos + X * sin);
  return { R, dU, pct: (100 * dU) / c.U };
}

export function sizeCable(c: CableIn) {
  const Ib = designCurrent(c);
  const loaded: 2 | 3 = c.system === '3ph' ? 3 : 2;
  const kT = tempFactor(c.ins, c.Tamb), kG = groupFactor(c.groups);
  const In = BREAKERS.find((b) => b >= Ib) ?? NaN;
  const k = kFactor(c.metal, c.ins);
  const Ssc = c.Ik > 0 ? (c.Ik * 1000 * Math.sqrt(c.tk)) / k : 0;
  const minS = c.metal === 'Al' ? 16 : 1.5;
  const rows = SIZES.filter((S) => S >= minS).map((S) => {
    const Iz0 = baseCapacity(S, c.method, loaded, c.ins, c.metal);
    const Iz = Iz0 * kT * kG;
    const vd = voltageDrop(c, S, Ib);
    const okI = Iz >= In, okU = vd.pct <= c.dUmax, okK = S >= Ssc;
    return { S, Iz0, Iz, ...vd, okI, okU, okK, ok: okI && okU && okK };
  });
  const pick = rows.find((r) => r.ok) ?? null;
  const byCurrent = rows.find((r) => r.okI) ?? null; // what ampacity alone would choose
  const ploss = pick ? (c.system === '3ph' ? 3 : 2) * Ib * Ib * pick.R * c.L : NaN;
  const checks = pick ? [
    { ok: pick.Iz >= In && In >= Ib, label: 'I_b ≤ I_n ≤ I_z (cable protected by the breaker)', detail: `${Ib.toFixed(1)} ≤ ${In} ≤ ${pick.Iz.toFixed(1)} A` },
    { ok: pick.okU, label: `Voltage drop ≤ ${c.dUmax} %`, detail: `ΔU = ${pick.dU.toFixed(2)} V = ${pick.pct.toFixed(2)} %` },
    { ok: pick.okK, label: 'Short-circuit: S ≥ I_k·√t/k (adiabatic)', detail: c.Ik > 0 ? `S_min = ${Ssc.toFixed(1)} mm²` : 'not checked (I_k = 0)' },
  ] : [{ ok: false, label: 'No size up to 240 mm² satisfies all conditions', detail: 'use parallel cables, a higher voltage or a shorter run' }];
  return { Ib, In, loaded, kT, kG, k, Ssc, rows, pick, byCurrent, ploss, checks };
}
export type CableResult = ReturnType<typeof sizeCable>;

/** Common cable types by application (European / Turkish designations; HD 361 codes where they exist). */
export const CABLE_TYPES = [
  { id: 'nya', name: 'H07V-U / H07V-R (NYA)', use: 'Building wiring in conduit or trunking — single cores, never without conduit', ins: 'PVC', temp: '70 °C', where: 'indoor, dry' },
  { id: 'nym', name: 'NYM-J', use: 'House and office installation, surface or flush, fixed', ins: 'PVC', temp: '70 °C', where: 'indoor, dry/damp' },
  { id: 'nyy', name: 'NYY-J', use: 'Power distribution: underground, outdoor, cable trays', ins: 'PVC', temp: '70 °C', where: 'outdoor, buried' },
  { id: 'n2xy', name: 'N2XY / NA2XY (Al)', use: 'Feeders and distribution with higher current per mm²', ins: 'XLPE', temp: '90 °C', where: 'outdoor, buried, trays' },
  { id: 'n2xh', name: 'N2XH / NHXMH (LSZH)', use: 'Hospitals, schools, tunnels, malls: halogen-free, low smoke if burning', ins: 'XLPE, halogen-free', temp: '90 °C', where: 'public buildings' },
  { id: 'fe180', name: 'N2XH-FE180 E30/E90', use: 'Emergency lighting, fire pumps, smoke fans: keeps working in a fire (30/90 min)', ins: 'XLPE + mica tape', temp: '90 °C', where: 'safety circuits' },
  { id: 'rnf', name: 'H07RN-F', use: 'Heavy flexible: construction sites, outdoor tools, mobile machines', ins: 'rubber', temp: '60 °C', where: 'outdoor, oily, moving' },
  { id: 'vvf', name: 'H05VV-F', use: 'Light flexible: appliances, extension cords indoors', ins: 'PVC', temp: '70 °C', where: 'indoor' },
  { id: 'pv', name: 'H1Z2Z2-K (EN 50618)', use: 'Solar PV DC strings: UV and ozone resistant, 1500 V DC', ins: 'cross-linked, halogen-free', temp: '90 °C (120 °C short)', where: 'outdoor, roofs' },
  { id: 'swa', name: 'NYRY / N2XRY (armoured)', use: 'Where cables can be hit: industry, direct burial without duct', ins: 'PVC / XLPE + steel wire', temp: '70 / 90 °C', where: 'industrial, buried' },
  { id: 'vfd', name: '2YSLCY-J (screened, symmetrical)', use: 'Motors on inverters (VFD): screen limits interference', ins: 'PE / PVC + braid', temp: '70 °C', where: 'industrial' },
  { id: 'liycy', name: 'LiYCY', use: 'Control and sensor signals, screened against interference', ins: 'PVC + braid', temp: '70 °C', where: 'panels, machines' },
];

export const CABLE_ASSUMPTIONS =
  'Simplified IEC 60364-5-52: copper PVC capacities from Tables B.52.2 (two loaded conductors) and B.52.4 (three loaded conductors), typical published values; XLPE as PVC × 1.18…1.28 and aluminium as copper × 0.78 (approximations of the XLPE and aluminium tables). ' +
  'Corrections: ambient temperature (Table B.52.14, in air) and grouping of bunched circuits (Table B.52.17); no soil resistivity, harmonics or solar radiation. Voltage drop ΔU = b·L·I·(R·cos φ + X·sin φ) with b = 2 (single phase, DC) or √3 (three phase), R at the insulation’s maximum temperature, X = 0.08 mΩ/m. ' +
  'Short circuit: adiabatic S ≥ I_k·√t/k. Common limits: 3 % lighting, 5 % other circuits (IEC 60364-5-52 Annex G); national rules can be stricter — in Türkiye check the Elektrik İç Tesisleri Yönetmeliği and TS HD 60364. A qualified electrician must design and verify real installations.';
