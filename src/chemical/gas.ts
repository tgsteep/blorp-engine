/**
 * Gas mixtures: ideal-gas state with Dalton partial pressures, molar mass, density, heat capacities and speed of sound,
 * and the real-gas compressibility factor from the generalized (Pitzer–Abbott) virial correlation with Kay's
 * pseudo-critical constants. Water dew check. Units: bar, °C, m³, kg, J/(mol K).
 */

/** Critical temperature [K], critical pressure [bar], acentric factor, molar mass [kg/kmol], ideal-gas c_p at 25 °C [J/(mol K)]
 * (Smith, Van Ness & Abbott, Appendix B; c_p from NIST). */
export const GASES = {
  N2: { name: 'Nitrogen', Tc: 126.2, Pc: 34.0, w: 0.038, M: 28.014, cp: 29.12, col: '#4F7CAC' },
  O2: { name: 'Oxygen', Tc: 154.6, Pc: 50.43, w: 0.022, M: 31.999, cp: 29.38, col: '#D9534F' },
  Ar: { name: 'Argon', Tc: 150.9, Pc: 48.98, w: 0, M: 39.948, cp: 20.79, col: '#9B59B6' },
  CO2: { name: 'Carbon dioxide', Tc: 304.2, Pc: 73.83, w: 0.224, M: 44.01, cp: 37.12, col: '#555555' },
  H2O: { name: 'Water vapour', Tc: 647.1, Pc: 220.55, w: 0.345, M: 18.015, cp: 33.58, col: '#5DADE2' },
  CH4: { name: 'Methane', Tc: 190.6, Pc: 45.99, w: 0.012, M: 16.043, cp: 35.69, col: '#E0A33A' },
  C2H6: { name: 'Ethane', Tc: 305.3, Pc: 48.72, w: 0.1, M: 30.07, cp: 52.49, col: '#C27C0E' },
  C3H8: { name: 'Propane', Tc: 369.8, Pc: 42.48, w: 0.152, M: 44.097, cp: 73.6, col: '#A04000' },
  C4H10: { name: 'n-Butane', Tc: 425.1, Pc: 37.96, w: 0.2, M: 58.123, cp: 98.49, col: '#784212' },
  H2: { name: 'Hydrogen', Tc: 33.19, Pc: 13.13, w: -0.216, M: 2.016, cp: 28.84, col: '#F4F6F7' },
  CO: { name: 'Carbon monoxide', Tc: 132.9, Pc: 34.99, w: 0.048, M: 28.01, cp: 29.14, col: '#7F8C8D' },
  He: { name: 'Helium', Tc: 5.2, Pc: 2.28, w: -0.39, M: 4.003, cp: 20.79, col: '#F7DC6F' },
  NH3: { name: 'Ammonia', Tc: 405.7, Pc: 112.8, w: 0.253, M: 17.031, cp: 35.06, col: '#48C9B0' },
} as const;
export type GasId = keyof typeof GASES;
export type Mix = Partial<Record<GasId, number>>;

/** Preset mixtures; T [°C] is the temperature they are shown at (flue gas in the stack, butane vapour warm enough to stay near ideal). */
export const MIXES: { id: string; name: string; y: Mix; T?: number }[] = [
  { id: 'air', name: 'Dry air', y: { N2: 0.7808, O2: 0.2095, Ar: 0.0093, CO2: 0.0004 } },
  { id: 'ng', name: 'Natural gas', y: { CH4: 0.9, C2H6: 0.05, C3H8: 0.02, N2: 0.02, CO2: 0.01 } },
  { id: 'biogas', name: 'Biogas', y: { CH4: 0.6, CO2: 0.38, H2O: 0.02 } },
  { id: 'flue', name: 'Flue gas (natural gas)', y: { N2: 0.715, H2O: 0.175, CO2: 0.085, O2: 0.025 }, T: 150 },
  { id: 'syngas', name: 'Syngas', y: { H2: 0.5, CO: 0.4, CO2: 0.1 } },
  { id: 'c4', name: 'n-Butane', y: { C4H10: 1 }, T: 80 },
  { id: 'h2', name: 'Hydrogen', y: { H2: 1 } },
  { id: 'co2', name: 'Carbon dioxide', y: { CO2: 1 } },
];

export const RU = 8.314462618; // J/(mol K)
/** Saturation pressure of water [bar] (Antoine, 1–100 °C; used for the dew check). */
export const pSatWater = (t: number) => (Math.pow(10, 8.07131 - 1730.63 / (233.426 + t)) * 1.01325) / 760;

/** Normalised mole fractions as a list. */
export const comps = (y: Mix) => { const e = Object.entries(y).filter(([, v]) => (v ?? 0) > 0) as [GasId, number][], s = e.reduce((a, [, v]) => a + v, 0); return e.map(([id, v]) => ({ id, y: v / s, ...GASES[id] })); };

/** Pitzer–Abbott generalized second virial coefficient: Z = 1 + (B⁰ + ω B¹) P_r/T_r. */
export function virialZ(Tr: number, Pr: number, w: number) {
  const B0 = 0.083 - 0.422 / Math.pow(Tr, 1.6), B1 = 0.139 - 0.172 / Math.pow(Tr, 4.2);
  return { B0, B1, Z: 1 + ((B0 + w * B1) * Pr) / Tr };
}

export type GasIn = { y: Mix; P: number; T: number; V: number }; // bar abs, °C, m³

export function gasState(p: GasIn) {
  const c = comps(p.y), T = p.T + 273.15, Pa = p.P * 1e5;
  const M = c.reduce((a, x) => a + x.y * x.M, 0), Rs = (RU * 1000) / M; // J/(kg K)
  const Tpc = c.reduce((a, x) => a + x.y * x.Tc, 0), Ppc = c.reduce((a, x) => a + x.y * x.Pc, 0), w = c.reduce((a, x) => a + x.y * x.w, 0);
  const Tr = T / Tpc, Pr = p.P / Ppc, vir = virialZ(Tr, Pr, w), Z = vir.Z;
  const rhoIdeal = Pa / (Rs * T), rho = rhoIdeal / Z, n = (Pa * p.V) / (Z * RU * T) / 1000; // kmol
  const cp = c.reduce((a, x) => a + x.y * x.cp, 0), cv = cp - RU, k = cp / cv, a = Math.sqrt((k * Rs * T) / 1); // ideal-gas speed of sound
  const parts = c.map((x) => ({ ...x, p: x.y * p.P, wmass: (x.y * x.M) / M }));
  const vMolar = (Z * RU * T) / Pa; // m³/mol
  const nNormal = (n * 1000 * RU * 273.15) / 101325; // Nm³ at 0 °C, 1.01325 bar (ideal)
  const h2o = parts.find((x) => x.id === 'H2O'), pSat = pSatWater(p.T), Zc = 0.29, vrOk = Pr <= (Z * Tr) / (2 * Zc);
  const tDew = h2o ? bisectT((t) => pSatWater(t) - h2o.p) : NaN;
  const checks = [
    { ok: Math.abs(Z - 1) <= 0.02, label: 'Ideal gas within 2 % (|Z − 1| ≤ 0.02)', detail: `Z = ${Z.toFixed(4)}` },
    { ok: vrOk && Tr > 0.6, label: 'Virial correlation valid (reduced volume V_r ≥ 2, Smith–Van Ness–Abbott)', detail: `T_r = ${Tr.toFixed(2)}, P_r = ${Pr.toFixed(2)}` },
    ...(h2o ? [{ ok: h2o.p <= pSat, label: 'No water condensation: p_H₂O ≤ p_sat(T)', detail: `p_H₂O = ${(h2o.p * 1000).toFixed(1)} mbar, p_sat = ${(pSat * 1000).toFixed(1)} mbar (dew point ${tDew.toFixed(1)} °C)` }] : []),
  ];
  return { c, M, Rs, Tpc, Ppc, w, Tr, Pr, vir, Z, rhoIdeal, rho, n, m: n * M, cp, cv, k, a, parts, vMolar, nNormal, h2o, pSat, tDew, checks };
}
function bisectT(f: (t: number) => number, lo = -60, hi = 370) { for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (f(m) > 0) hi = m; else lo = m; } return (lo + hi) / 2; }
export type GasResult = ReturnType<typeof gasState>;

/** Z against pressure at the present temperature (for the chart), with the virial validity limit. */
export function zCurve(p: GasIn, Pmax: number, n = 60) {
  return Array.from({ length: n + 1 }, (_, i) => { const P = 0.01 + (Pmax * i) / n; const r = gasState({ ...p, P }); return { P, Z: r.Z, ok: r.checks[1].ok }; });
}

export const GAS_INTRO = 'A gas is mostly empty space with molecules flying about; each kind of molecule pushes on the walls in proportion to how many of them there are (Dalton\'s law), so a mixture behaves like one gas with an average molar mass. The ideal-gas law pV = nRT holds while the molecules are far apart; at high pressure or near condensation they attract each other and the gas is denser than the law says — the compressibility factor Z tells by how much.';
export const GAS_NOTES = [
  'Ideal-gas mixture: partial pressure p_i = y_i p (Dalton), molar mass M = Σ y_i M_i, density ρ = p M/(Z R T), c_p = Σ y_i c_p,i at 25 °C (ideal-gas values; c_v = c_p − R), speed of sound √(k R T/M) for the ideal gas. Normal volume at 0 °C and 1.01325 bar.',
  'Real gas: generalized second-virial correlation of Pitzer and Abbott, Z = 1 + (B⁰ + ω B¹) P_r/T_r with B⁰ = 0.083 − 0.422/T_r^1.6 and B¹ = 0.139 − 0.172/T_r^4.2, for mixtures with Kay\'s pseudo-critical constants (mole-fraction averages of T_c, P_c, ω). Valid for reduced volumes V_r ≥ 2 (moderate pressures, approximated with Z_c = 0.29); hydrogen and helium are better described with quantum-corrected constants, and polar gases (water, ammonia) less accurately. Validation: n-butane at 510 K and 25 bar, Z = 0.879 and V = 1489 cm³/mol (Smith, Van Ness and Abbott).',
  'Water: condensation when its partial pressure exceeds the saturation pressure (Antoine equation for water, 1…100 °C); the dew point is where they are equal.',
];
