/**
 * Activated sludge (complete-mix reactor + secondary clarifier) after Metcalf & Eddy.
 *
 * - heterotrophs on BOD₅ (M&E 3rd ed. typical domestic values): k = 5 d⁻¹, K_s = 60 mg/L, Y = 0.6 g VSS/g BOD₅, k_d = 0.06 d⁻¹;
 *   temperature: k·1.07^(T−20), k_d·1.04^(T−20);
 * - effluent soluble BOD S = K_s(1 + k_d θc)/(θc(Yk − k_d) − 1); biomass P_x = Y Q (S₀ − S)/(1 + k_d θc) = V X/θc;
 * - nitrifiers (M&E 4th ed.): μ_max 0.75 d⁻¹ (1.07), K_n 0.74 mg/L (1.053), k_dn 0.08 d⁻¹ (1.04), K_o 0.5 mg/L DO;
 * - oxygen: O₂ = Q(S₀ − S)/f − 1.42 P_x + 4.57 Q ΔN with f = BOD₅/BOD_u = 0.68; N into biomass 0.12 P_x;
 * - aeration: AOTR/SOTR = α(β C̄_s,T − DO)/C̄_s,20 · 1.024^(T−20), C̄_s at mid-depth; diffuser SOTE per metre of submergence;
 *   blower power by adiabatic compression;
 * - clarifier: overflow rate Q/A and solids loading (Q + Q_r) MLSS/A; return ratio from the clarifier mass balance.
 * Units: m, d, mg/L (= g/m³), kg/d.
 */

export type Check = { ok: boolean; label: string; detail: string };

export const KIN = { k: 5, Ks: 60, Y: 0.6, kd: 0.06, thK: 1.07, thKd: 1.04, f: 0.68 };
export const NIT = { mu: 0.75, Kn: 0.74, kdn: 0.08, Ko: 0.5, thMu: 1.07, thKn: 1.053, thKd: 1.04, Yn: 0.12 };
export const FV = 0.8; // VSS/TSS of the mixed liquor

/** Oxygen saturation in fresh water at 1 atm [mg/L] (Benson–Krause equation as in APHA Standard Methods 4500-O). */
export const cs = (T: number) => { const K = T + 273.15; return Math.exp(-139.34411 + 1.575701e5 / K - 6.642308e7 / K ** 2 + 1.2438e10 / K ** 3 - 8.621949e11 / K ** 4); };

export const DIFFUSERS = [
  { id: 'fine', alpha: 0.5, ote: 0.065, name: 'Fine bubble (membrane discs)' },
  { id: 'coarse', alpha: 0.8, ote: 0.025, name: 'Coarse bubble' },
] as const;
export type DiffId = (typeof DIFFUSERS)[number]['id'];

/** Heterotroph rates at T. */
export const hetero = (T: number) => ({ k: KIN.k * KIN.thK ** (T - 20), kd: KIN.kd * KIN.thKd ** (T - 20) });
/** Nitrifier rates at T and dissolved oxygen DO. */
export const nitri = (T: number, DO: number) => {
  const mu = NIT.mu * NIT.thMu ** (T - 20) * (DO / (NIT.Ko + DO)), kdn = NIT.kdn * NIT.thKd ** (T - 20), Kn = NIT.Kn * NIT.thKn ** (T - 20);
  return { mu, kdn, Kn, srtMin: mu > kdn ? 1 / (mu - kdn) : Infinity };
};
/** Effluent soluble BOD₅ [mg/L] at sludge age θc (S₀ on washout). */
export function effluentS(S0: number, T: number, srt: number) {
  const { k, kd } = hetero(T), den = srt * (KIN.Y * k - kd) - 1;
  return den <= 0 ? S0 : Math.min(S0, (KIN.Ks * (1 + kd * srt)) / den);
}
/** Effluent NH₄-N [mg/L] at θc (N₀ when nitrifiers wash out). */
export function effluentN(N0: number, T: number, DO: number, srt: number) {
  const n = nitri(T, DO), den = srt * (n.mu - n.kdn) - 1;
  return den <= 0 ? N0 : Math.min(N0, (n.Kn * (1 + n.kdn * srt)) / den);
}

export type WwIn = {
  Q: number; S0: number; TKN: number; alk: number; T: number; // m³/d, mg/L BOD₅, mg/L N, mg/L as CaCO₃, °C
  srt: number; X: number; Xr: number; DO: number;              // d, MLVSS mg/L, return sludge TSS mg/L, mg/L
  h: number; diff: DiffId;                                       // aeration depth m, diffuser
  TSSe: number; nC: number; D: number;                           // effluent TSS mg/L, clarifiers, diameter m
  nitrify: boolean;                                              // ammonia removal required
};

export function activatedSludge(p: WwIn) {
  const { k, kd } = hetero(p.T), srtMinH = 1 / (KIN.Y * k - kd);
  const S = effluentS(p.S0, p.T, p.srt), dS = p.S0 - S;
  const Px = (KIN.Y * p.Q * dS) / (1 + kd * p.srt) / 1000;          // kg VSS/d
  const V = Math.max((p.srt * Px * 1000) / p.X, 1);                  // m³
  const hrt = (V / p.Q) * 24;                                         // h
  const FM = (p.Q * p.S0) / (V * p.X), VL = (p.Q * p.S0) / 1000 / V; // kg BOD/(kg VSS·d), kg BOD/(m³·d)
  const Yobs = dS > 0 ? (Px * 1000) / (p.Q * dS) : 0;
  const mlss = p.X / FV, PxTSS = Px / FV;
  // nitrification
  const n = nitri(p.T, p.DO), Ne = effluentN(p.TKN, p.T, p.DO, p.srt);
  const Nsyn = Math.min(p.TKN, (0.12 * Px * 1000) / p.Q);             // mg/L into biomass
  const dN = Math.max(0, p.TKN - Nsyn - Ne);                          // nitrified
  const PxN = (NIT.Yn * p.Q * dN) / (1 + n.kdn * p.srt) / 1000;       // nitrifier biomass kg/d
  const alkOut = p.alk - 7.14 * dN;
  // oxygen
  const O2c = (p.Q * dS) / KIN.f / 1000 - 1.42 * Px, O2n = (4.57 * p.Q * dN) / 1000, O2 = O2c + O2n; // kg/d
  // aeration
  const dif = DIFFUSERS.find((d) => d.id === p.diff)!, sub = Math.max(p.h - 0.3, 0.5);
  const depthF = 1 + (0.5 * 9.81 * sub) / 101.325;
  const ratio = (dif.alpha * (0.95 * cs(p.T) * depthF - p.DO)) / (cs(20) * depthF) * 1.024 ** (p.T - 20);
  const SOTR = ratio > 0 ? O2 / ratio : Infinity;                     // kg/d
  const SOTE = Math.min(dif.ote * sub, 0.45), air = SOTR / (SOTE * 0.2793) / 24; // m³/h at 20 °C, 1 atm
  const p2 = 101.325 + 9.81 * sub + 10, w = (air * 1.204) / 3600;
  const Pbl = ((w * 287 * 293.15) / (0.2857 * 0.7)) * ((p2 / 101.325) ** 0.2857 - 1) / 1000; // kW
  const AE = O2 / 24 / Pbl;                                            // kg O₂/kWh
  // sludge wasting and return (VSS balance; effluent solids leave too)
  const Xe = p.TSSe * FV, Xrv = p.Xr * FV;
  const Qw = Math.max((V * p.X / p.srt - p.Q * Xe) / (Xrv - Xe), 0);
  const R = p.Xr > mlss ? mlss / (p.Xr - mlss) : Infinity, Qr = R * p.Q;
  const Ac = (p.nC * Math.PI * p.D * p.D) / 4, SOR = p.Q / Ac, SLR = ((p.Q + Qr) * mlss) / 1000 / Ac / 24; // m/d, kg/(m²·h)
  const BODe = S + p.TSSe * FV * 0.65 * 1.42 * KIN.f;                // soluble + from effluent solids
  const PE = (p.Q * p.S0) / 60;                                        // 60 g BOD₅ per person and day
  const checks: Check[] = [
    { ok: BODe <= 25, label: 'Effluent BOD₅ ≤ 25 mg/L (EU 91/271/EEC)', detail: `${BODe.toFixed(1)} mg/L (soluble ${S.toFixed(1)} + solids ${(BODe - S).toFixed(1)})` },
    { ok: p.TSSe <= 35, label: 'Effluent suspended solids ≤ 35 mg/L (EU 91/271/EEC)', detail: `TSS = ${p.TSSe.toFixed(0)} mg/L` },
    { ok: FM >= 0.04 && FM <= 0.6, label: 'F/M 0.04…0.6 kg BOD/(kg VSS·d) (extended aeration … conventional)', detail: `F/M = ${FM.toFixed(2)}` },
    { ok: mlss >= 1500 && mlss <= 5000, label: 'MLSS 1500…5000 mg/L', detail: `MLSS = ${mlss.toFixed(0)} mg/L` },
    { ok: !p.nitrify || p.srt >= 1.5 * n.srtMin, label: 'Sludge age ≥ 1.5 × minimum for nitrification', detail: p.nitrify ? `θc = ${p.srt.toFixed(1)} d, minimum ${Number.isFinite(n.srtMin) ? n.srtMin.toFixed(1) : '∞'} d` : 'not required' },
    { ok: !p.nitrify || alkOut >= 70, label: 'Alkalinity left after nitrification ≥ 70 mg/L as CaCO₃', detail: p.nitrify ? `${alkOut.toFixed(0)} mg/L` : 'not required' },
    { ok: p.DO >= (p.nitrify ? 2 : 1.5), label: 'Dissolved oxygen ≥ 2 mg/L (1.5 without nitrification)', detail: `DO = ${p.DO.toFixed(1)} mg/L` },
    { ok: R <= 1, label: 'Return sludge ratio ≤ 1 (25…100 % of Q)', detail: Number.isFinite(R) ? `R = ${R.toFixed(2)}` : 'X_r must exceed the MLSS' },
    { ok: SOR <= 28, label: 'Clarifier overflow rate ≤ 28 m³/(m²·d)', detail: `${SOR.toFixed(1)} m³/(m²·d)` },
    { ok: SLR <= 6, label: 'Clarifier solids loading ≤ 6 kg/(m²·h)', detail: `${SLR.toFixed(2)} kg/(m²·h)` },
  ];
  return { k, kd, srtMinH, S, dS, Px, PxTSS, PxN, V, hrt, FM, VL, Yobs, mlss, n, Ne, Nsyn, dN, alkOut, O2c, O2n, O2, ratio, SOTR, SOTE, air, p2, Pbl, AE, Qw, R, Qr, Ac, SOR, SLR, BODe, PE, checks };
}
export type WwResult = ReturnType<typeof activatedSludge>;

export const WW_INTRO = 'In an activated sludge plant, bacteria eat the dissolved organic matter (BOD) of sewage in an aerated tank, and a clarifier lets them settle so most of the sludge returns to the tank. The sludge age – how many days the bacteria stay – sets how clean the water gets, how much sludge must be removed, and whether the slow-growing nitrifiers survive to turn ammonia into nitrate. Air blowers supply the oxygen and use most of the plant\'s energy.';

export const WW_NOTES = [
  'Complete-mix activated sludge with a steady state (Metcalf & Eddy). Heterotroph kinetics on BOD₅ with typical domestic values k = 5 d⁻¹, K_s = 60 mg/L, Y = 0.6 g VSS/g BOD₅, k_d = 0.06 d⁻¹ (M&E 3rd ed.), corrected with θ = 1.07 and 1.04; nitrifiers μ_max = 0.75 d⁻¹, K_n = 0.74 mg/L, k_dn = 0.08 d⁻¹, K_o = 0.5 mg/L (M&E 4th ed.). Real kinetics vary from plant to plant. Inert and non-biodegradable solids, denitrification, phosphorus removal, primary treatment and peak flows are not modelled; the tank volume counts only the active heterotrophs (MLVSS = 0.8 MLSS).',
  'Oxygen: O₂ = Q(S₀ − S)/0.68 − 1.42 P_x + 4.57 Q ΔN, nitrified nitrogen ΔN = TKN − 0.12 P_x/Q − NH₄-N out; nitrification uses 7.14 g alkalinity (as CaCO₃) per g N. Field to standard oxygen transfer with α = 0.5 (fine bubble) or 0.8 (coarse), β = 0.95, saturation at mid-depth, θ = 1.024; SOTE about 6.5 %/m (fine) or 2.5 %/m (coarse) of submergence. Blower power from adiabatic compression with 70 % wire-to-air efficiency and 10 kPa pipe and diffuser loss.',
  'Effluent BOD₅ adds the solids that escape the clarifier (0.65 biodegradable × 1.42 × 0.68 per g VSS). Clarifier checks use average-flow values (overflow ≤ 28 m³/(m²·d), solids loading ≤ 6 kg/(m²·h)); good settling (SVI) is assumed. Limits: EU Urban Waste Water Directive 91/271/EEC (BOD₅ 25 mg/L, TSS 35 mg/L); national rules and permits decide.',
];
