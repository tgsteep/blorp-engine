/**
 * Other fusion concepts: the stellarator (magnetic confinement without a plasma current; 0-D power balance with the
 * ISS04 confinement scaling) and laser (inertial) fusion (an imploding fuel capsule: isobaric hot spot inside cold
 * compressed fuel, energy budget from the laser to the fuel, burn-up fraction from the areal density ρR).
 */
import { E_ALPHA, E_DT, sigmaV_DT } from './nuclear.ts';

const KEV = 1.602176634e-16, MU0 = 4e-7 * Math.PI, U = 1.66053907e-27;

/* ------------------------------ stellarator ------------------------------ */

export type StellIn = { R: number; a: number; B: number; n: number; Paux: number; iota: number; fren: number; Zeff: number }; // m, m, T, 10²⁰ m⁻³, MW, –, –, –

/** ISS04 energy confinement time [s] (Yamada et al. 2005, Nucl. Fusion 45 1684): τ = 0.134 a^2.28 R^0.64 P^−0.61
 *  n₁₉^0.54 B^0.84 ι^0.41 with P the absorbed heating power [MW] and n₁₉ the density in 10¹⁹ m⁻³; f_ren scales it
 *  for a given machine (configuration optimisation). */
export const tauISS04 = (a: number, R: number, P: number, n19: number, B: number, iota: number, fren = 1) =>
  fren * 0.134 * a ** 2.28 * R ** 0.64 * Math.max(P, 1e-3) ** -0.61 * n19 ** 0.54 * B ** 0.84 * iota ** 0.41;

export function stellarator(p: StellIn) {
  const V = 2 * Math.PI * Math.PI * p.R * p.a * p.a, n = p.n * 1e20, sv = (T: number) => sigmaV_DT(T);
  const Pfus = (T: number) => V * (n * n / 4) * sv(T) * E_DT / 1e6; // MW
  const Pbr = (T: number) => 5.35e-37 * p.Zeff * n * n * Math.sqrt(T) * V / 1e6;
  const Pheat = (T: number) => Math.max(p.Paux + Pfus(T) * (E_ALPHA / E_DT) - Pbr(T), 1e-3);
  const W = (T: number) => 3 * n * T * KEV * V / 1e6; // MJ
  const res = (T: number) => W(T) - tauISS04(p.a, p.R, Pheat(T), p.n * 10, p.B, p.iota, p.fren) * Pheat(T);
  // lowest temperature where the stored energy equals the confined energy (heated steady state)
  let T = NaN, ignited = false;
  const N = 240, Ts = Array.from({ length: N }, (_, i) => 0.05 * Math.pow(2000, i / (N - 1))); // 0.05…100 keV
  for (let i = 1; i < N; i++) if (res(Ts[i - 1]) < 0 && res(Ts[i]) >= 0) { let lo = Ts[i - 1], hi = Ts[i]; for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (res(m) < 0) lo = m; else hi = m; } T = (lo + hi) / 2; break; }
  if (!Number.isFinite(T)) { ignited = res(Ts[N - 1]) < 0; T = Ts[N - 1]; }
  const P = Pheat(T), tau = tauISS04(p.a, p.R, P, p.n * 10, p.B, p.iota, p.fren), pf = Pfus(T), Q = p.Paux > 0 ? pf / p.Paux : Infinity;
  const beta = (2 * MU0 * 2 * n * T * KEV) / (p.B * p.B), nSudo = 0.25 * Math.sqrt((P * p.B) / (p.R * p.a * p.a));
  const checks = [
    { ok: !ignited && T >= 5 && T <= 30, label: 'Temperature in the D–T window 5…30 keV', detail: ignited ? 'no steady state below 100 keV: thermal runaway' : `T = ${T.toFixed(1)} keV = ${(T * 11.6).toFixed(0)} million K` },
    { ok: p.n <= nSudo, label: 'Density below the Sudo limit', detail: `n = ${p.n.toFixed(2)} ≤ 0.25 √(P B/(R a²)) = ${nSudo.toFixed(2)}·10²⁰ m⁻³` },
    { ok: beta <= 0.05, label: 'Plasma pressure β ≤ 5 % of the magnetic pressure', detail: `β = ${(100 * beta).toFixed(2)} %` },
    { ok: Q >= 1, label: 'Scientific breakeven Q ≥ 1', detail: `Q = ${Number.isFinite(Q) ? Q.toFixed(2) : '∞'}` },
  ];
  return { V, T, tau, W: W(T), P, Pfus: pf, Palpha: pf * (E_ALPHA / E_DT), Pbr: Pbr(T), Q, beta, nSudo, ignited, triple: n * T * tau, checks };
}
export type StellResult = ReturnType<typeof stellarator>;

export const STELLARATORS: Record<string, StellIn & { label: string; Np: number }> = {
  w7x: { label: 'Wendelstein 7-X (Germany)', R: 5.5, a: 0.53, B: 2.5, n: 0.8, Paux: 8, iota: 1.0, fren: 1.0, Zeff: 1.5, Np: 5 },
  lhd: { label: 'LHD (Japan)', R: 3.7, a: 0.6, B: 2.75, n: 0.5, Paux: 15, iota: 0.6, fren: 1.0, Zeff: 1.5, Np: 10 },
  helias: { label: 'HELIAS-type power plant study', R: 22, a: 1.8, B: 5.7, n: 1.0, Paux: 60, iota: 0.9, fren: 1.6, Zeff: 1.5, Np: 5 },
};

/* ------------------------------ laser (inertial) fusion ------------------------------ */

/** Energy released per gram of D–T fuel burned [J/g]: 17.6 MeV per 5.03 u. */
export const E_PER_G = E_DT / (5.03 * U * 1000);
/** Internal energy of hot D–T plasma per gram: 3/2 kT for 2 ions + 2 electrons per 5.03 u [J/g]. */
export const eHot = (TkeV: number) => (1.5 * 4 * TkeV * KEV) / (5.03 * U * 1000);
/** Fermi (degenerate) energy of D–T per gram at density ρ [g/cm³]: 3/5 E_F per electron, ≈ 3.3·10⁵ ρ^⅔ J/g. */
export function eFermi(rho: number) {
  const ne = (rho * 1e3) / (2.515 * U), hbar = 1.054571817e-34, me = 9.1093837e-31; // electrons per m³ (one per 2.515 u)
  const EF = (hbar * hbar * Math.pow(3 * Math.PI * Math.PI * ne, 2 / 3)) / (2 * me);
  return (0.6 * EF * ne) / (rho * 1e6); // J per gram
}
/** Burn parameter H_B = 8 c_s m_f/⟨σv⟩ [g/cm²] (Atzeni & Meyer-ter-Vehn): burn-up fraction Φ = ρR/(ρR + H_B). */
export function burnParam(TkeV: number) {
  const mf = 2.5 * U, cs = Math.sqrt((2 * TkeV * KEV) / mf);
  return ((8 * cs * mf) / sigmaV_DT(TkeV)) * 0.1; // kg/m² → g/cm²
}

export type IcfIn = { EL: number; etaC: number; etaH: number; m: number; alpha: number; rhoC: number; Th: number; R0: number; etaL: number }; // MJ, –, –, mg, –, g/cm³, keV, mm, –

export function icf(p: IcfIn) {
  const Ek = p.etaC * p.etaH * p.EL * 1e6, mg = p.m * 1e-3; // J in the imploding fuel, g of fuel
  const ec = p.alpha * eFermi(p.rhoC), eh = eHot(p.Th);
  const mhRaw = (Ek - mg * ec) / (eh - ec), mh = Math.min(Math.max(mhRaw, 0), mg), compressed = mhRaw > 0;
  const rhoH = (p.rhoC * ec) / eh; // isobaric: equal pressure 2/3 ρ e in hot spot and cold fuel
  const Rh = Math.cbrt((3 * mh) / (4 * Math.PI * rhoH)), rRh = rhoH * Rh; // cm, g/cm²
  const Ro = Math.cbrt(Rh ** 3 + (3 * (mg - mh)) / (4 * Math.PI * p.rhoC)), rRc = p.rhoC * (Ro - Rh), rRt = rRh + rRc;
  const ignites = compressed && rRh >= 0.3 && p.Th >= 5;
  const HB = burnParam(p.Th), HBburn = burnParam(40);
  const phi = ignites ? rRt / (rRt + HBburn) : (rRh / (rRh + HB)) * (mh / mg);
  const Y = phi * mg * E_PER_G, G = Y / (p.EL * 1e6), CR = (p.R0 / 10) / Math.max(Rh, 1e-9), Gwall = G * p.etaL;
  const pressure = (2 / 3) * rhoH * 1e3 * eh * 1e3 * 1e-14; // Gbar: ρ [kg/m³] e [J/kg] → Pa, 1 Gbar = 10¹⁴ Pa
  const checks = [
    { ok: compressed, label: 'Enough drive energy to compress the fuel and heat a hot spot', detail: `${(Ek / 1e3).toFixed(1)} kJ in the fuel, compression alone needs ${(mg * ec / 1e3).toFixed(1)} kJ` },
    { ok: rRh >= 0.3, label: 'Hot-spot areal density ρR ≥ 0.3 g/cm² (stops the α particles)', detail: `ρR_h = ${rRh.toFixed(3)} g/cm²` },
    { ok: p.Th >= 5, label: 'Hot-spot temperature ≥ 5 keV', detail: `T = ${p.Th.toFixed(1)} keV` },
    { ok: CR <= 40, label: 'Convergence ratio ≤ 40 (instabilities mix the shell into the hot spot)', detail: `CR = R₀/R_h = ${CR.toFixed(0)}` },
    { ok: G >= 1, label: 'Target gain G ≥ 1 (more fusion energy than laser light)', detail: `G = ${G.toFixed(2)}` },
  ];
  return { Ek, ec, eh, mh, rhoH, Rh, rRh, Ro, rRc, rRt, ignites, HB, HBburn, phi, Y, G, CR, Gwall, pressure, compressed, checks };
}
export type IcfResult = ReturnType<typeof icf>;

export const ICF_PRESETS: Record<string, IcfIn & { label: string; drive: 'indirect' | 'direct' }> = {
  nif: { label: 'NIF-scale capsule (indirect drive)', drive: 'indirect', EL: 2.05, etaC: 0.12, etaH: 0.1, m: 0.2, alpha: 1.5, rhoC: 1000, Th: 6, R0: 1.0, etaL: 0.005 },
  direct: { label: 'Direct-drive power plant concept', drive: 'direct', EL: 2.5, etaC: 0.7, etaH: 0.07, m: 1.0, alpha: 2.5, rhoC: 800, Th: 7, R0: 2.2, etaL: 0.1 },
};

export const FC_INTRO = 'Not every fusion machine is a tokamak. A stellarator twists its magnetic cage with oddly shaped coils, so it needs no current in the plasma and can run without pause. Laser fusion takes the opposite road: no magnetic field at all — a millimetre fuel capsule is crushed by laser energy to a thousand times the density of water for a few billionths of a second, so fast that the fuel burns before it flies apart. In 2022 the National Ignition Facility got more fusion energy out of a capsule than the laser light put in.';
export const FC_NOTES = [
  'Stellarator: 0-D power balance with volume-averaged density and temperature (flat profiles), 50/50 D–T, ⟨σv⟩ from Bosch–Hale, bremsstrahlung loss; the temperature is where the stored energy 3nTV equals τ_E × net heating, with τ_E from the ISS04 scaling of measured stellarators (Yamada et al. 2005) times a renormalisation f_ren; Sudo density limit 0.25 √(P B/(R a²)). Existing machines are run with hydrogen or deuterium — their numbers here show what the same plasma would give in D–T. The power-plant preset assumes confinement 1.6 × ISS04, which optimised designs hope for but no stellarator has shown yet. Plasma volume 2π²Ra²; with too little heating the plasma stays on the cold branch even where a hot, burning state would also exist.',
  'Laser fusion: the drive energy reaching the fuel is laser energy × coupling to the capsule (indirect drive: X-rays in a gold hohlraum, about 10–15 %; direct drive: about 70 %) × hydrodynamic efficiency of the implosion. At stagnation a hot spot at temperature T sits inside cold fuel at density ρ with the same pressure (isobaric); the cold fuel costs α times the Fermi energy of degenerate D–T (≈ 3.3·10⁵ ρ^⅔ J/g, α = adiabat), the hot spot 3/2 kT per particle. The rest of the energy decides the hot-spot mass.',
  'Burn: ignition is taken as hot-spot ρR ≥ 0.3 g/cm² at T ≥ 5 keV (Lindl 1995); an igniting capsule burns the fraction ρR/(ρR + H_B) of all its fuel with H_B ≈ 7 g/cm² at burn temperature (Atzeni & Meyer-ter-Vehn); a non-igniting one burns only its hot spot at its own temperature without α self-heating, so the step between the two is sharper than in experiments, where self-heating grows gradually. Instabilities, mix, asymmetry and the ablator are not modelled; preset numbers are rounded and tuned to give the published yield order of magnitude, not measured values.',
];
