/**
 * Radioactive decay and gamma shielding.
 * Decay: A = λN, λ = ln 2/T½, two-member Bateman chains. Half-lives and main gamma lines: NNDC NuDat 3 (rounded).
 * Shielding: point-isotropic source, uncollided flux S·y/(4πr²)·e^(−μx), dose in soft tissue (water) from the
 * mass energy-absorption coefficient, buildup factor from our Monte Carlo tables (scripts/build-shield-tables.py).
 */
import { SHIELD_DATA } from './shieldTables.ts';

export const NA = 6.02214076e23, YEAR = 365.25 * 86400, CI = 3.7e10, KEV = 1.602176634e-16; // J per keV

export type Nuclide = {
  id: string; name: string; T: number /* s */; M: number /* g/mol */; mode: string; daughter: string;
  gammas: [number, number][] /* keV, photons per decay */; use: string; exempt: number /* Bq, IAEA GSR Part 3 Schedule I */;
};
const y = YEAR, d = 86400, h = 3600, min = 60;
export const NUCLIDES: Nuclide[] = [
  { id: 'Co-60', name: 'Cobalt-60', T: 5.2714 * y, M: 59.9338, mode: 'β⁻, γ', daughter: 'Ni-60', gammas: [[1173.2, 0.9985], [1332.5, 0.9998]], use: 'radiotherapy, sterilisation, industrial radiography', exempt: 1e5 },
  { id: 'Cs-137', name: 'Caesium-137', T: 30.08 * y, M: 136.907, mode: 'β⁻ (γ from Ba-137m)', daughter: 'Ba-137m', gammas: [[661.7, 0.851]], use: 'level and density gauges, calibration, fission product', exempt: 1e4 },
  { id: 'Ir-192', name: 'Iridium-192', T: 73.829 * d, M: 191.963, mode: 'β⁻, EC, γ', daughter: 'Pt-192 / Os-192', gammas: [[316.5, 0.829], [468.1, 0.478], [308.5, 0.300], [296.0, 0.287], [604.4, 0.082], [612.5, 0.053], [588.6, 0.045], [484.6, 0.032]], use: 'weld radiography, brachytherapy', exempt: 1e4 },
  { id: 'I-131', name: 'Iodine-131', T: 8.0252 * d, M: 130.906, mode: 'β⁻, γ', daughter: 'Xe-131', gammas: [[364.5, 0.815], [637.0, 0.0716], [284.3, 0.0612], [80.2, 0.0262], [722.9, 0.0177]], use: 'thyroid therapy, fission product', exempt: 1e6 },
  { id: 'Tc-99m', name: 'Technetium-99m', T: 6.0067 * h, M: 98.906, mode: 'IT, γ', daughter: 'Tc-99', gammas: [[140.5, 0.89]], use: 'medical imaging (most used tracer)', exempt: 1e7 },
  { id: 'Mo-99', name: 'Molybdenum-99', T: 65.976 * h, M: 98.908, mode: 'β⁻, γ', daughter: 'Tc-99m', gammas: [[739.5, 0.121], [181.1, 0.060], [777.9, 0.043]], use: 'Tc-99m generator', exempt: 1e6 },
  { id: 'F-18', name: 'Fluorine-18', T: 109.77 * min, M: 18.0009, mode: 'β⁺ (511 keV annihilation)', daughter: 'O-18', gammas: [[511, 1.935]], use: 'PET imaging', exempt: 1e6 },
  { id: 'Na-22', name: 'Sodium-22', T: 2.6018 * y, M: 21.9944, mode: 'β⁺, γ', daughter: 'Ne-22', gammas: [[511, 1.807], [1274.5, 0.9994]], use: 'calibration, positron source', exempt: 1e6 },
  { id: 'Am-241', name: 'Americium-241', T: 432.6 * y, M: 241.057, mode: 'α, γ', daughter: 'Np-237', gammas: [[59.5, 0.359]], use: 'smoke detectors, density gauges', exempt: 1e4 },
  { id: 'K-40', name: 'Potassium-40', T: 1.248e9 * y, M: 39.964, mode: 'β⁻, EC, γ', daughter: 'Ca-40 / Ar-40', gammas: [[1460.8, 0.1066]], use: 'natural, in every body and banana', exempt: 1e6 },
  { id: 'Sr-90', name: 'Strontium-90', T: 28.79 * y, M: 89.9077, mode: 'β⁻ (no γ)', daughter: 'Y-90', gammas: [], use: 'fission product, RTG heat source', exempt: 1e4 },
  { id: 'H-3', name: 'Tritium', T: 12.32 * y, M: 3.01605, mode: 'β⁻ (no γ)', daughter: 'He-3', gammas: [], use: 'glow signs, fusion fuel', exempt: 1e9 },
  { id: 'C-14', name: 'Carbon-14', T: 5700 * y, M: 14.0032, mode: 'β⁻ (no γ)', daughter: 'N-14', gammas: [], use: 'radiocarbon dating, tracer', exempt: 1e7 },
  { id: 'Ra-226', name: 'Radium-226', T: 1600 * y, M: 226.0254, mode: 'α, γ', daughter: 'Rn-222', gammas: [[186.2, 0.036]], use: 'historic luminous paint, origin of the curie', exempt: 1e4 },
  { id: 'Pu-239', name: 'Plutonium-239', T: 24110 * y, M: 239.0522, mode: 'α', daughter: 'U-235', gammas: [], use: 'reactor and weapon fissile material', exempt: 1e4 },
  { id: 'U-238', name: 'Uranium-238', T: 4.468e9 * y, M: 238.0508, mode: 'α', daughter: 'Th-234', gammas: [], use: 'natural uranium (99.3 %)', exempt: 1e4 },
];
export const nuclide = (id: string) => NUCLIDES.find((n) => n.id === id)!;

/** Parent → daughter pairs for the chain view (branching ratio to the daughter). */
export const CHAINS = [
  { id: 'mo', parent: 'Mo-99', daughter: { id: 'Tc-99m', T: 6.0067 * h }, br: 0.876, kind: 'transient' },
  { id: 'sr', parent: 'Sr-90', daughter: { id: 'Y-90', T: 64.0 * h }, br: 1, kind: 'secular' },
  { id: 'cs', parent: 'Cs-137', daughter: { id: 'Ba-137m', T: 2.552 * min }, br: 0.944, kind: 'secular' },
  { id: 'ra', parent: 'Ra-226', daughter: { id: 'Rn-222', T: 3.8235 * d }, br: 1, kind: 'secular' },
] as const;

// ---------------- decay ----------------
export function decay(nucId: string, A0: number /* Bq */, t: number /* s */) {
  const n = nuclide(nucId), lam = Math.LN2 / n.T, N0 = A0 / lam;
  const f = Math.exp(-lam * t), A = A0 * f, N = N0 * f;
  const m0 = (N0 * n.M) / NA, SA = (lam * NA) / n.M; // g, Bq/g
  const checks = [
    { ok: A <= n.exempt, label: 'Activity at time t below the IAEA exemption level', detail: `A ${fmtBq(A)}, exemption level for ${n.id} ${fmtBq(n.exempt)}` },
    { ok: t >= 10 * n.T || A <= n.exempt, label: 'Decayed for storage: 10 half-lives (activity ÷ 1000) or below exemption', detail: `t = ${(t / n.T).toFixed(2)} half-lives` },
  ];
  return { n, lam, tau: 1 / lam, N0, N, A, f, m0, m: m0 * f, SA, halfLives: t / n.T, decayed: N0 - N, checks };
}

/** Two-member chain (Bateman): parent and daughter activities for a pure parent at t = 0. */
export function chain(id: (typeof CHAINS)[number]['id'], Ap0: number, t: number) {
  const c = CHAINS.find((x) => x.id === id)!, lp = Math.LN2 / nuclide(c.parent).T, ld = Math.LN2 / c.daughter.T;
  const Ap = Ap0 * Math.exp(-lp * t);
  const Ad = c.br * Ap0 * (ld / (ld - lp)) * (Math.exp(-lp * t) - Math.exp(-ld * t));
  const tMax = Math.log(ld / lp) / (ld - lp);
  return { c, lp, ld, Ap, Ad, tMax, ratioEq: (c.br * ld) / (ld - lp) };
}

// ---------------- shielding ----------------
export type ShieldMat = 'lead' | 'steel' | 'concrete' | 'water';
const D = SHIELD_DATA;
const lerpLog = (xs: readonly number[], ys: readonly number[], x: number) => {
  const lx = Math.log(x); let i = 0;
  while (i < xs.length - 2 && lx > Math.log(xs[i + 1])) i++;
  const u = (lx - Math.log(xs[i])) / (Math.log(xs[i + 1]) - Math.log(xs[i]));
  return Math.exp((1 - u) * Math.log(ys[i]) + u * Math.log(ys[i + 1]));
};
/** Linear attenuation coefficient [1/cm] without coherent scattering (as in the buildup Monte Carlo). */
export const muLin = (m: ShieldMat, E: number) => lerpLog(D.E, D.materials[m].mu, E) * D.materials[m].rho;
/** Mass energy-absorption coefficient [cm²/g] of water (soft tissue) or air. */
export const muEn = (m: 'water' | 'air', E: number) => lerpLog(D.E, D.materials[m].men, E);
export const density = (m: ShieldMat) => D.materials[m].rho;

/** Coherent (Rayleigh) part [cm²/g], left out of the transport but part of the NIST total. */
export const muCoh = (m: ShieldMat, E: number) => lerpLog(D.E, D.materials[m].muCoh, E);

/** Scatter model: 'slab' = broad beam through a wall, nothing behind it (default); 'infinite' = point source inside the material everywhere (conservative). */
export type Geom = 'slab' | 'infinite';

/**
 * Buildup factor: the Monte Carlo table interpolated (log B linear in x) up to its last thickness (10 mfp), beyond that
 * continued with the Berger form B = 1 + a·x·e^(b·x) fitted to the table; interpolated in log E between source energies.
 */
export function buildup(m: ShieldMat, E: number, x: number, geom: Geom = 'slab') {
  const mm = D.materials[m] as { B: readonly (readonly number[])[]; Bs: readonly (readonly number[])[]; fit: readonly (readonly [number, number])[]; fitSlab: readonly (readonly [number, number])[] };
  const tab = geom === 'slab' ? mm.Bs : mm.B, fit = geom === 'slab' ? mm.fitSlab : mm.fit, X = geom === 'slab' ? D.slabX : D.mfp, E0 = D.E0;
  const xm = X[X.length - 1];
  const at = (k: number) => {
    const row = tab[k];
    if (x >= xm) { const berger = (z: number) => 1 + fit[k][0] * z * Math.exp(fit[k][1] * Math.min(z, 25)); return row[row.length - 1] * berger(x) / berger(xm); }
    let j = 0; while (j < X.length - 2 && x > X[j + 1]) j++;
    const u = (x - X[j]) / (X[j + 1] - X[j]);
    return Math.exp((1 - u) * Math.log(row[j]) + u * Math.log(row[j + 1]));
  };
  const Ec = Math.min(Math.max(E, E0[0]), E0[E0.length - 1]);
  let i = 0; while (i < E0.length - 2 && Ec > E0[i + 1]) i++;
  const u = (Math.log(Ec) - Math.log(E0[i])) / (Math.log(E0[i + 1]) - Math.log(E0[i]));
  return Math.exp((1 - u) * Math.log(at(i)) + u * Math.log(at(i + 1)));
}

export type ShieldIn = { nuc: string; A: number /* Bq */; r: number /* m */; mat: ShieldMat; x: number /* m */; hours: number /* h/year */; limit: number /* Sv/year */; geom?: Geom };

/** Dose rate in soft tissue [Gy/h] at r behind thickness x (point kernel with buildup); per gamma line terms. */
export function doseRate(nuc: string, A: number, r: number, mat: ShieldMat, x: number, withB = true, geom: Geom = 'slab') {
  const n = nuclide(nuc), rc = r * 100, xc = x * 100;
  let total = 0;
  const lines = n.gammas.map(([E, yld]) => {
    const phi = (A * yld) / (4 * Math.PI * rc * rc); // photons/(cm²·s)
    const mu = muLin(mat, E), B = withB ? buildup(mat, E, mu * xc, geom) : 1;
    const Dr = phi * E * muEn('water', E) * KEV * 1000 * 3600 * B * Math.exp(-mu * xc); // Gy/h
    total += Dr;
    return { E, y: yld, mu, mfp: mu * xc, B, D: Dr };
  });
  return { total, lines };
}

/** Exposure-rate constant Γ [R·m²/(Ci·h)] from the gamma lines (air), for comparison with published tables. */
export function gammaConstant(nuc: string) {
  const n = nuclide(nuc); let s = 0;
  for (const [E, yld] of n.gammas) s += (CI * yld) / (4 * Math.PI * 1e4) * E * muEn('air', E) * KEV * 1000; // Gy/s in air at 1 m per Ci
  return (s * 3600) / 33.97 / 2.58e-4; // air kerma → exposure: W/e = 33.97 J/C, 1 R = 2.58e-4 C/kg
}

export function shield(p: ShieldIn) {
  const g = p.geom ?? 'slab', dr = (x: number) => doseRate(p.nuc, p.A, p.r, p.mat, x, true, g).total;
  const D0 = dr(0);
  const s = doseRate(p.nuc, p.A, p.r, p.mat, p.x, true, g);
  const narrow = doseRate(p.nuc, p.A, p.r, p.mat, p.x, false).total;
  const T = D0 > 0 ? s.total / D0 : 0;
  const main = s.lines.reduce((a, l) => (l.D > a.D ? l : a), s.lines[0] ?? { E: 0, y: 0, mu: 0, mfp: 0, B: 1, D: 0 });
  // broad-beam tenth-value layer of the first decade, and thickness for the dose limit
  const solve = (target: number) => {
    if (D0 <= target) return 0;
    let lo = 0, hi = 0.01; while (dr(hi) > target && hi < 50) hi *= 2;
    if (hi >= 50) return Infinity;
    for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (dr(m) > target) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  const tvl = D0 > 0 ? solve(D0 / 10) : 0, hvl = D0 > 0 ? solve(D0 / 2) : 0;
  // equilibrium tenth-value layer: the third decade (10⁻² → 10⁻³), where the scattered spectrum has settled (as in NCRP tables)
  const tvlEq = D0 > 0 ? solve(D0 / 1000) - solve(D0 / 100) : 0;
  const annual = s.total * p.hours; // Gy (≈ Sv for photons) per year
  const xNeed = solve(p.limit / p.hours);
  const checks = [
    { ok: annual <= p.limit, label: 'Annual dose within the chosen limit', detail: `${fmtSv(annual)} per year at ${p.hours.toFixed(0)} h/year, limit ${fmtSv(p.limit)}` },
    { ok: s.total <= 7.5e-6 || annual <= p.limit, label: 'Dose rate outside a controlled area (≤ 7.5 µSv/h)', detail: `${fmtSv(s.total)}/h` },
    { ok: p.x <= 0 || main.mfp <= 25, label: 'Within the range of the buildup data (≤ 25 mfp)', detail: `${main.mfp.toFixed(1)} mean free paths at ${main.E.toFixed(0)} keV` },
  ];
  return { D0, D: s.total, narrow, T, lines: s.lines, main, tvl, hvl, tvlEq, annual, xNeed, gamma: gammaConstant(p.nuc), checks };
}

// ---------------- formatting ----------------
export function fmtBq(A: number) {
  const u: [number, string][] = [[1e15, 'PBq'], [1e12, 'TBq'], [1e9, 'GBq'], [1e6, 'MBq'], [1e3, 'kBq'], [1, 'Bq']];
  const [f, s] = u.find(([v]) => Math.abs(A) >= v) ?? [1, 'Bq'];
  return `${(A / f).toPrecision(3)} ${s}`;
}
export function fmtSv(D: number) { // Gy ≈ Sv for photons
  const u: [number, string][] = [[1, 'Sv'], [1e-3, 'mSv'], [1e-6, 'µSv'], [1e-9, 'nSv']];
  const [f, s] = u.find(([v]) => Math.abs(D) >= v) ?? [1e-9, 'nSv'];
  return `${(D / f).toPrecision(3)} ${s}`;
}
/** Time with an automatic unit; `unit` may translate the unit symbol (y, d, h, min, s). */
export function fmtTime(t: number, unit: (u: string) => string = (u) => u) {
  const u: [number, string][] = [[YEAR, 'y'], [86400, 'd'], [3600, 'h'], [60, 'min'], [1, 's']];
  const [f, s] = u.find(([v]) => Math.abs(t) >= v) ?? [1, 's'];
  const v = t / f;
  return `${v >= 1e5 ? v.toExponential(2) : v.toPrecision(3)} ${unit(s)}`;
}
export function fmtMass(g: number) {
  const u: [number, string][] = [[1e3, 'kg'], [1, 'g'], [1e-3, 'mg'], [1e-6, 'µg'], [1e-9, 'ng'], [1e-12, 'pg'], [1e-15, 'fg']];
  const [f, s] = u.find(([v]) => Math.abs(g) >= v) ?? [1e-15, 'fg'];
  return `${(g / f).toPrecision(3)} ${s}`;
}

export const DECAY_INTRO =
  'Unstable nuclei change into other nuclei at random, but a large number of them follows a precise law: in every half-life half of what is left decays. Activity (decays per second, becquerel) falls the same way, so a short half-life means intense but brief radiation, a long one weak but lasting.';
export const SHIELD_INTRO =
  'Gamma rays are not stopped at a fixed depth: each centimetre of shield removes the same fraction. Dense, heavy materials like lead do it in the least thickness; concrete and water need more but are cheap. Scattered photons still get through, so the real dose behind a thick shield is higher than the simple exponential (buildup). Distance helps too: twice as far, a quarter of the dose.';

export const DECAY_NOTES = [
  'Exponential decay N = N₀ e^(−λt), A = λN, λ = ln 2/T½; mass from N·M/N_A; specific activity λN_A/M. Half-lives and gamma lines from NNDC NuDat 3, rounded. Chains: two-member Bateman solution for a pure parent at t = 0 with the branching ratio to the daughter; transient equilibrium when the daughter lives shorter (activity ratio λ_d/(λ_d − λ_p)), secular when much shorter (ratio 1).',
  'Exemption levels: IAEA GSR Part 3, Schedule I (activity below which a source needs no licence; national rules may differ). Validation: specific activities of Ra-226 (0.988 Ci/g, the origin of the curie) and Co-60 (1130 Ci/g) as published; Mo-99/Tc-99m maximum daughter activity at about 23 h.',
];
export const SHIELD_NOTES = [
  'Point-isotropic source, dose rate in soft tissue (water) Ḋ = Σ S·y_i/(4πr²)·E_i·(μ_en/ρ)·B·e^(−μx) over the main gamma lines (NNDC); 1 Gy ≈ 1 Sv for photons. No air attenuation, no self-absorption in the source, the shield is anywhere between source and person. Attenuation and energy absorption from the Elam tables (xraydb) up to 800 keV and Klein-Nishina above; pair production neglected.',
  'Buildup factors: our own Monte Carlo (Klein-Nishina scattering, no coherent scattering, no fluorescence or bremsstrahlung), tabulated to 10 mean free paths and continued beyond with the Berger form B = 1 + a·x·e^(b·x) fitted to the table. Wall: broad beam at normal incidence through a slab with nothing behind it. Surrounded: point source inside an infinite medium, the classic conservative case; it reproduces the tabulated values for water, iron and lead at 1 MeV within about 5 %. Oblique rays through the wall are not followed (on-axis only).',
  'Validation: exposure-rate constants of Co-60 (1.30 R·m²/(Ci·h)) and Cs-137 (0.32) and equilibrium broad-beam tenth-value layers of Co-60 and Cs-137 in lead, concrete and iron (NCRP 49, as tabulated by Chilton, Shultis and Faw) are reproduced in the tests within 20 %. Limits: ICRP 103 — 20 mSv/year for workers, 1 mSv/year for the public; 7.5 µSv/h is a common threshold for a controlled area.',
];
