/**
 * Nuclear energy at engineering-overview level. SI units unless noted (MeV, keV, GWd/tU where customary).
 */
export const MEV = 1.602176634e-13; // J
export const NA = 6.02214076e23;

/* ------------------------------ fission ------------------------------ */

export type ReactorType = { id: string; name: string; coolant: string; moderator: string; fuel: string; enrich: number; pressure: string; tOut: number; eta: number; burnup: number; how: string; example: string };

/** Typical design values (rounded) for the main reactor families. */
export const REACTORS: ReactorType[] = [
  { id: 'pwr', name: 'Pressurised water (PWR / VVER)', coolant: 'light water, kept liquid at 15.5 MPa', moderator: 'the same water', fuel: 'UO₂, 3…5 % U-235', enrich: 4.0, pressure: '15.5 MPa', tOut: 325, eta: 0.34, burnup: 50, how: 'Water at 15.5 MPa is heated in the core but cannot boil. It gives its heat to a second water loop in the steam generators; that steam drives the turbine. Two loops keep radioactive water away from the turbine.', example: 'Akkuyu (VVER-1200, 4 units), most of the world fleet' },
  { id: 'bwr', name: 'Boiling water (BWR)', coolant: 'light water, boiling at 7 MPa', moderator: 'the same water', fuel: 'UO₂, 3…5 % U-235', enrich: 4.0, pressure: '7 MPa', tOut: 286, eta: 0.33, burnup: 45, how: 'Water boils directly in the core; steam separators and dryers above the core send dry steam straight to the turbine. One loop, simpler plant, but the turbine hall sees slightly radioactive steam.', example: 'Fukushima Daiichi, many Japanese and US plants' },
  { id: 'phwr', name: 'Heavy water (CANDU / PHWR)', coolant: 'heavy water in pressure tubes, 10 MPa', moderator: 'cold heavy water in a calandria tank', fuel: 'natural UO₂, 0.71 % U-235', enrich: 0.711, pressure: '10 MPa', tOut: 310, eta: 0.3, burnup: 7.5, how: 'Heavy water absorbs so few neutrons that natural uranium can sustain the chain reaction — no enrichment needed. Horizontal pressure tubes allow refuelling at full power.', example: 'Canada, India, Romania (Cernavodă)' },
  { id: 'sfr', name: 'Sodium-cooled fast (SFR)', coolant: 'liquid sodium, near atmospheric pressure', moderator: 'none — fast neutrons', fuel: 'MOX / U-Pu, ~20 % fissile', enrich: 20, pressure: '≈ 0.1 MPa', tOut: 550, eta: 0.4, burnup: 100, how: 'No moderator: fast neutrons can breed new fuel from U-238. Sodium carries heat at high temperature but low pressure; an intermediate sodium loop separates the radioactive pool from the water/steam side.', example: 'BN-600 / BN-800 (Russia), Phénix, Superphénix' },
];

/** Recoverable energy per U-235 fission ≈ 200 MeV. */
export const E_FISSION = 200 * MEV;

/** Fission rate [1/s] and U-235 fissioned [g/day] for a thermal power [W]. */
export function fissionRate(Pth: number) {
  const rate = Pth / E_FISSION;
  const gPerDay = (rate * 86400 * 235.04) / NA;
  return { rate, gPerDay, gConsumedPerDay: gPerDay * 1.17 }; // + radiative capture (α ≈ 0.17 thermal)
}

/** Decay heat after shutdown, Way–Wigner: P/P₀ = 0.0622·[t^−0.2 − (t + T_op)^−0.2], t and T_op in seconds. */
export const decayHeat = (t: number, Top: number) => 0.0622 * (Math.pow(Math.max(t, 0.1), -0.2) - Math.pow(Math.max(t, 0.1) + Top, -0.2));

/** Enrichment mass balance: natural-uranium feed per kg product, F/P = (x_p − x_t)/(x_f − x_t). */
export const feedPerProduct = (xp: number, xt = 0.25, xf = 0.711) => (xp - xt) / (xf - xt);

/** Separative work per kg product [SWU/kg]: V(x) = (2x − 1)·ln(x/(1 − x)). */
export function swuPerProduct(xp: number, xt = 0.25, xf = 0.711) {
  const V = (x: number) => (2 * x - 1) * Math.log(x / (1 - x));
  const p = xp / 100, t = xt / 100, f = xf / 100, F = feedPerProduct(xp, xt, xf);
  return V(p) + (F - 1) * V(t) - F * V(f);
}

export type FissionIn = { Pth: number; eta: number; cf: number; burnup: number; enrich: number; Top: number };

export function fissionPlant(p: FissionIn) {
  const Pe = p.Pth * p.eta;
  const fr = fissionRate(p.Pth * 1e6);
  const days = 365 * p.cf;
  const hmPerYear = (p.Pth * days) / (p.burnup * 1000); // tU heavy metal (P in MW, burnup GWd/t → MWd/kg)
  const natU = p.enrich > 0.711 ? hmPerYear * feedPerProduct(p.enrich) : hmPerYear;
  const swu = p.enrich > 0.711 ? hmPerYear * 1000 * swuPerProduct(p.enrich) : 0;
  const Ee = Pe * 1e6 * days * 86400; // J electric per year
  const coalT = Ee / (0.38 * 24e6) / 1000; // t of coal (24 MJ/kg, 38 % plant)
  const homes = (Pe * 1000 * days * 24) / 3500; // households at 3500 kWh/year
  const decay = [1, 60, 3600, 86400, 7 * 86400, 30 * 86400].map((t) => ({ t, frac: decayHeat(t, p.Top), MW: decayHeat(t, p.Top) * p.Pth }));
  return { Pe, ...fr, hmPerYear, natU, swu, coalT, homes, decay, days };
}

export const FISSION_ASSUMPTIONS =
  '200 MeV recovered per fission; U-235 consumed includes radiative capture (≈ 17 % extra). Fuel use from the discharge burnup (energy per tonne of heavy metal); natural uranium from the enrichment mass balance with 0.25 % tails; separative work from the value function. ' +
  'Decay heat by the Way–Wigner formula (±30 %, good to show the trend, not for safety analysis). Coal comparison: 24 MJ/kg coal in a 38 % efficient plant; households at 3500 kWh/year. Reactor data are typical rounded design values.';

/* ------------------------------ fusion ------------------------------ */

/** D–T: 17.6 MeV per reaction (α 3.5 MeV stays in the plasma, neutron 14.1 MeV goes to the blanket). */
export const E_DT = 17.59 * MEV, E_ALPHA = 3.52 * MEV;
const KEV = 1.602176634e-16; // J

/** D–T fusion reactivity ⟨σv⟩ [m³/s], Bosch & Hale (1992) fit, 0.2…100 keV. */
export function sigmaV_DT(TkeV: number) {
  const T = Math.min(Math.max(TkeV, 0.2), 100);
  const BG = 34.3827, mrc2 = 1124656, C1 = 1.17302e-9, C2 = 1.51361e-2, C3 = 7.51886e-2, C4 = 4.60643e-3, C5 = 1.35e-2, C6 = -1.0675e-4, C7 = 1.366e-5;
  const theta = T / (1 - (T * (C2 + T * (C4 + T * C6))) / (1 + T * (C3 + T * (C5 + T * C7))));
  const xi = Math.cbrt((BG * BG) / (4 * theta));
  return C1 * theta * Math.sqrt(xi / (mrc2 * T * T * T)) * Math.exp(-3 * xi) * 1e-6; // cm³/s → m³/s
}

/** Ignition condition (α heating = transport loss, no radiation): n·τ_E ≥ 12·T/(E_α·⟨σv⟩). Returns n·τ_E [s/m³]. */
export const ignitionNTau = (TkeV: number) => (12 * TkeV * KEV) / (E_ALPHA * sigmaV_DT(TkeV));

export type FusionIn = { R: number; a: number; kappa: number; n: number; T: number; tauE: number; Zeff: number };

/** 0-D tokamak power balance (volume-averaged, flat profiles, 50/50 D–T, n_e = n_i = n). */
export function tokamak(p: FusionIn) {
  const V = 2 * Math.PI * Math.PI * p.R * p.a * p.a * p.kappa;
  const sv = sigmaV_DT(p.T);
  const Pfus = V * ((p.n * p.n) / 4) * sv * E_DT;
  const Palpha = Pfus * (E_ALPHA / E_DT), Pn = Pfus - Palpha;
  const W = 3 * p.n * p.T * KEV * V; // thermal energy (electrons + ions)
  const Ptr = W / p.tauE;
  const Pbr = 5.35e-37 * p.Zeff * p.n * p.n * Math.sqrt(p.T) * V; // bremsstrahlung [W], n in m⁻³, T in keV
  const Paux = Math.max(Ptr + Pbr - Palpha, 0);
  const Q = Paux > 0 ? Pfus / Paux : Infinity;
  const triple = p.n * p.T * p.tauE;
  const needNT = ignitionNTau(p.T);
  const fuelPerDay = (Pfus / E_DT) * 86400 * (2.014 + 3.016) / NA / 1000; // kg D+T burned per day
  const checks = [
    { ok: p.T >= 5 && p.T <= 30, label: 'Temperature in the D–T window 5…30 keV (≈ 60…350 million K)', detail: `T = ${p.T.toFixed(1)} keV = ${(p.T * 11.6).toFixed(0)} million K` },
    { ok: Q >= 1, label: 'Scientific breakeven Q ≥ 1', detail: Number.isFinite(Q) ? `Q = ${Q.toFixed(2)}` : 'ignited (Q → ∞)' },
    { ok: Q >= 5, label: 'Burning plasma: α heating ≥ external heating (Q ≥ 5)', detail: p.n * p.tauE >= needNT ? 'ignited: above the Lawson curve' : `n·τ_E = ${(p.n * p.tauE).toExponential(2)}, ignition needs ${needNT.toExponential(2)} s/m³` },
  ];
  return { V, sv, Pfus, Palpha, Pn, W, Ptr, Pbr, Paux, Q, triple, needNT, fuelPerDay, checks };
}
export type TokamakResult = ReturnType<typeof tokamak>;

export const TOKAMAKS: Record<string, FusionIn & { label: string; B: number }> = {
  iter: { label: 'ITER (France, under construction)', R: 6.2, a: 2.0, kappa: 1.7, n: 1.0e20, T: 8.0, tauE: 3.4, Zeff: 1.7, B: 5.3 },
  jet: { label: 'JET (UK, 1983–2023)', R: 2.96, a: 1.25, kappa: 1.68, n: 0.6e20, T: 8, tauE: 0.6, Zeff: 2, B: 3.45 },
  compact: { label: 'Compact high-field (SPARC-like)', R: 1.85, a: 0.57, kappa: 1.97, n: 3.0e20, T: 7, tauE: 0.77, Zeff: 1.5, B: 12.2 },
};

export const FUSION_ASSUMPTIONS =
  '0-D power balance with volume-averaged density and temperature (flat profiles), 50/50 deuterium–tritium, n_e = n_i, ⟨σv⟩ from the Bosch–Hale fit. Losses: transport W/τ_E plus bremsstrahlung (Z_eff); line radiation, fuel dilution by helium and profile peaking are not modelled, so Q is indicative only (ITER’s design target is Q = 10 at 500 MW). ' +
  'Plasma volume 2π²·R·a²·κ. Ignition curve: α heating = transport loss, no radiation. Preset numbers are rounded public design values.';
