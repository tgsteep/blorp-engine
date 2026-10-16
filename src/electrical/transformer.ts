/**
 * Three-phase distribution transformer (oil-immersed, Dyn11) from its nameplate: rated currents, turns ratio,
 * per-unit equivalent circuit from the short-circuit test (u_k, P_k) and the no-load test (P₀), exact voltage
 * regulation from the phasor diagram, efficiency against load, maximum efficiency, short-circuit current and
 * yearly losses. SI units; powers in W, voltages line-to-line in V.
 */

/** Standard ratings [kVA] with indicative maximum losses close to the EU Ecodesign Tier 2 limits for liquid-immersed
 * distribution transformers (Regulation (EU) 548/2014): load loss P_k at rated current and 75 °C, no-load loss P₀ [W]. */
export const RATINGS: { S: number; Pk: number; P0: number }[] = [
  { S: 25, Pk: 600, P0: 63 }, { S: 50, Pk: 750, P0: 81 }, { S: 100, Pk: 1250, P0: 130 }, { S: 160, Pk: 1750, P0: 189 },
  { S: 250, Pk: 2350, P0: 270 }, { S: 315, Pk: 2800, P0: 324 }, { S: 400, Pk: 3250, P0: 387 }, { S: 500, Pk: 3900, P0: 459 },
  { S: 630, Pk: 4600, P0: 540 }, { S: 800, Pk: 6000, P0: 585 }, { S: 1000, Pk: 7600, P0: 693 }, { S: 1250, Pk: 9500, P0: 855 },
  { S: 1600, Pk: 12000, P0: 1080 }, { S: 2000, Pk: 15000, P0: 1305 }, { S: 2500, Pk: 18500, P0: 1575 }, { S: 3150, Pk: 23000, P0: 1980 },
];
/** Usual short-circuit impedance (IEC 60076-5 table of minimum values / common practice): 4 % up to 630 kVA, 6 % above. */
export const ukOf = (S: number) => (S <= 630 ? 4 : 6);

export type TrIn = {
  S: number;      // rated power [kVA]
  U1: number;     // primary line voltage [kV]
  U2: number;     // secondary line voltage at no load [V]
  Pk: number;     // load (copper) loss at rated current [W]
  P0: number;     // no-load (iron) loss [W]
  uk: number;     // short-circuit impedance [%]
  beta: number;   // load as a fraction of rated
  pf: number;     // load power factor cos φ
  lead: boolean;  // capacitive (leading) load
  hours: number;  // equivalent full-load hours per year for the load loss (loss load factor × 8760)
  price: number;  // electricity price [per kWh]
};

/** Secondary voltage in per unit for a current β at angle −φ (lagging) through Z = u_r + j u_x, with E = 1: exact phasor solution. */
export function regulation(beta: number, pf: number, lead: boolean, ur: number, ux: number) {
  const s = Math.sqrt(Math.max(0, 1 - pf * pf)) * (lead ? -1 : 1);
  const a = beta * (ur * pf + ux * s), b = beta * (ux * pf - ur * s); // I·Z = a + jb with V on the real axis
  const V = Math.sqrt(Math.max(0, 1 - b * b)) - a;
  return { V, a, b, reg: 1 - V };
}
/** Efficiency at load fraction β: output / (output + P₀ + β² P_k). */
export const efficiency = (S: number, beta: number, pf: number, P0: number, Pk: number) => {
  const out = beta * S * 1e3 * pf; return out > 0 ? out / (out + P0 + beta * beta * Pk) : 0;
};

export function transformer(p: TrIn) {
  const S = p.S * 1e3, U1 = p.U1 * 1e3, U2 = p.U2;
  const I1 = S / (Math.sqrt(3) * U1), I2 = S / (Math.sqrt(3) * U2);
  // Dyn11: delta primary (phase voltage = line), star secondary (phase voltage = line/√3)
  const N = U1 / (U2 / Math.sqrt(3)), U2ph = U2 / Math.sqrt(3);
  const ur = p.Pk / S, uk = p.uk / 100, ux = Math.sqrt(Math.max(0, uk * uk - ur * ur));
  const Zb = (U2 * U2) / S;                                     // base impedance on the LV side [Ω]
  const R2 = ur * Zb, X2 = ux * Zb;                              // per phase, referred to the secondary (star)
  const Rfe = (U2 * U2) / p.P0;                                  // core-loss resistance, star equivalent [Ω]
  const reg = regulation(p.beta, p.pf, p.lead, ur, ux);
  const U2load = reg.V * U2;
  const I = p.beta * I2, Pout = p.beta * S * p.pf, Pcu = p.beta * p.beta * p.Pk, Ploss = p.P0 + Pcu;
  const eta = efficiency(p.S, p.beta, p.pf, p.P0, p.Pk);
  const betaOpt = Math.sqrt(p.P0 / p.Pk), etaMax = efficiency(p.S, betaOpt, p.pf, p.P0, p.Pk);
  const Ik = I2 / uk, ip = Ik * Math.SQRT2 * (1.02 + 0.98 * Math.exp((-3 * R2) / Math.max(X2, 1e-9))); // IEC 60909 κ
  const E0 = (p.P0 * 8760) / 1e3, Ek = (p.Pk * p.hours) / 1e3, Eloss = E0 + Ek; // kWh/year
  const cost = Eloss * p.price;
  const checks = [
    { ok: p.beta <= 1, label: 'Load within the rating (β ≤ 1; short overloads are allowed by IEC 60076-7)', detail: `β = ${(p.beta * 100).toFixed(0)} %, I₂ = ${I.toFixed(0)} A of ${I2.toFixed(0)} A` },
    { ok: reg.V >= 0.95, label: 'Voltage at the transformer terminals ≥ 95 % (leaves room for the cable drop)', detail: `U₂ = ${U2load.toFixed(0)} V (${(reg.V * 100).toFixed(1)} %), regulation ${(reg.reg * 100).toFixed(2)} %` },
    { ok: eta >= 0.97, label: 'Efficiency at this load ≥ 97 %', detail: `η = ${(eta * 100).toFixed(2)} %` },
    { ok: Ik <= 100e3, label: 'LV short-circuit current ≤ 100 kA (largest usual LV breaker rating)', detail: `I_k = I₂/u_k = ${(Ik / 1e3).toFixed(1)} kA` },
    { ok: uk > ur, label: 'Short-circuit impedance larger than its resistive part (u_k > u_r)', detail: `u_k = ${(uk * 100).toFixed(1)} %, u_r = ${(ur * 100).toFixed(2)} %` },
  ];
  return { I1, I2, N, U2ph, ur, ux, uk, Zb, R2, X2, Rfe, reg, U2load, I, Pout, Pcu, Ploss, eta, betaOpt, etaMax, Ik, ip, E0, Ek, Eloss, cost, checks };
}
export type TrResult = ReturnType<typeof transformer>;

/** Rough size and mass of an oil-immersed distribution transformer, scaled from a 400 kVA unit (≈ 1.4 × 0.9 × 1.5 m, 1.6 t). */
export const trSize = (S: number) => { const s = Math.pow(S / 400, 0.25); return { L: 1.4 * s, W: 0.9 * s, H: 1.5 * s, mass: 1600 * Math.pow(S / 400, 0.75) }; };

export const TR_INTRO = 'A transformer passes power from one winding to another through a shared iron core: the voltage changes in the ratio of the turns and the current in the opposite ratio. Two losses heat it — the iron loss, there whenever it is switched on, and the copper loss, growing with the square of the load. Its leakage impedance lets the output voltage sag under load and limits the current of a short circuit.';

export const TR_NOTES = [
  'Three-phase oil-immersed distribution transformer, Dyn11 (delta primary, star secondary with neutral): N₁/N₂ = U₁/(U₂/√3), rated currents I = S/(√3 U). Equivalent circuit per phase on the LV side from the nameplate: u_r = P_k/S, u_x = √(u_k² − u_r²); no-load current and the magnetising branch are left out of the voltage drop (their effect is well under 0.1 %).',
  'Voltage regulation from the exact phasor diagram with the primary at rated voltage: |V + I Z| = 1 per unit; efficiency η = β S cos φ/(β S cos φ + P₀ + β² P_k), largest at β = √(P₀/P_k). Short-circuit current I_k = I_r/u_k with an infinite supply (the network impedance lowers it), peak factor κ = 1.02 + 0.98 e^(−3R/X) as in IEC 60909.',
  'Default losses: indicative values close to the EU Ecodesign Tier 2 maximum losses for liquid-immersed transformers (Regulation (EU) 548/2014), u_k 4 % up to 630 kVA and 6 % above; use the nameplate or test report for a real unit. Sizes and masses in the drawing are rough scalings from a 400 kVA unit. Temperature rise, ageing (IEC 60076-7), harmonics, tap changer and parallel operation are not included.',
];
