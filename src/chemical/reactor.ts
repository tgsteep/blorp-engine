/**
 * Ideal isothermal reactors for one irreversible reaction A → products with rate −r_A = k C_A^n, k from Arrhenius:
 * batch, continuous stirred tank (CSTR), plug flow (PFR) and N equal CSTRs in series. Conversion for a given volume,
 * the volume for a target conversion, the Levenspiel plot, heat of reaction and the adiabatic temperature rise.
 * Units: m³, h, kmol/m³ (= mol/L), kJ/mol, °C.
 */

export type Kind = 'cstr' | 'pfr' | 'batch' | 'series';
export type ReactIn = {
  kind: Kind;
  n: number;      // reaction order
  k25: number;    // rate constant at 25 °C [(m³/kmol)^(n−1) / h]
  Ea: number;     // activation energy [kJ/mol]
  T: number;      // reactor temperature [°C]
  C0: number;     // feed concentration of A [kmol/m³]
  v0: number;     // feed flow [m³/h] (batch: not used)
  V: number;      // reactor volume [m³] (series: total of all tanks)
  t: number;      // batch time [h]
  N: number;      // tanks in series
  Xt: number;     // target conversion
  dH: number;     // heat of reaction [kJ/mol], negative = exothermic
  rhoCp: number;  // volumetric heat capacity of the mixture [kJ/(m³ K)]
};

const R = 8.314462618e-3; // kJ/(mol K)
export const kAt = (k25: number, Ea: number, T: number) => k25 * Math.exp((-Ea / R) * (1 / (T + 273.15) - 1 / 298.15));

/** Outlet concentration of a plug flow reactor (or batch) after residence time τ: dC/dτ = −k Cⁿ. */
export function pfrC(C0: number, k: number, n: number, tau: number) {
  if (Math.abs(n - 1) < 1e-9) return C0 * Math.exp(-k * tau);
  const a = Math.pow(C0, 1 - n) - (1 - n) * k * tau;
  if (n < 1) return a <= 0 ? 0 : Math.pow(a, 1 / (1 - n));
  return Math.pow(a, 1 / (1 - n));
}
/** Outlet concentration of one CSTR: C₀ − C = τ k Cⁿ (bisection; the left side falls, the right rises with C). */
export function cstrC(C0: number, k: number, n: number, tau: number) {
  let lo = 0, hi = C0;
  for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (C0 - m - tau * k * Math.pow(m, n) > 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
/** Conversion of each reactor type at total residence time τ (N tanks share τ equally). */
export function conversion(kind: Kind, C0: number, k: number, n: number, tau: number, N = 1) {
  if (kind === 'pfr' || kind === 'batch') return 1 - pfrC(C0, k, n, tau) / C0;
  if (kind === 'cstr') return 1 - cstrC(C0, k, n, tau) / C0;
  let C = C0; for (let i = 0; i < N; i++) C = cstrC(C, k, n, tau / N);
  return 1 - C / C0;
}
/** Residence time for a target conversion (bisection on log τ). */
export function tauFor(kind: Kind, C0: number, k: number, n: number, X: number, N = 1) {
  let lo = Math.log(1e-8), hi = Math.log(1e8);
  if (conversion(kind, C0, k, n, Math.exp(hi), N) < X) return Infinity;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (conversion(kind, C0, k, n, Math.exp(m), N) >= X) hi = m; else lo = m; }
  return Math.exp(hi);
}

export function reactor(p: ReactIn) {
  const k = kAt(p.k25, p.Ea, p.T), N = p.kind === 'series' ? Math.max(1, Math.round(p.N)) : 1;
  const tau = p.kind === 'batch' ? p.t : p.V / p.v0;
  const X = conversion(p.kind, p.C0, k, p.n, tau, N), C = p.C0 * (1 - X);
  const Da = k * tau * Math.pow(p.C0, p.n - 1);
  const tauT = tauFor(p.kind, p.C0, k, p.n, p.Xt, N), Vt = p.kind === 'batch' ? NaN : tauT * p.v0;
  const FA0 = p.kind === 'batch' ? (p.C0 * p.V) / Math.max(p.t, 1e-9) : p.C0 * p.v0; // kmol/h (batch: per hour of reaction time)
  const prod = FA0 * X, Q = (-p.dH * 1000 * prod) / 3600; // kW released (kJ/kmol × kmol/h)
  const dTad = (-p.dH * 1000 * p.C0 * X) / p.rhoCp; // K
  // stage conversions for tanks in series, profile along a PFR / batch time
  const stages: number[] = [];
  if (p.kind === 'series') { let c = p.C0; for (let i = 0; i < N; i++) { c = cstrC(c, k, p.n, tau / N); stages.push(1 - c / p.C0); } }
  const profile = Array.from({ length: 41 }, (_, i) => { const s = (i / 40) * tau; return { s, X: 1 - pfrC(p.C0, k, p.n, s) / p.C0 }; });
  const checks = [
    { ok: X >= p.Xt, label: 'Conversion reaches the target', detail: `X = ${(X * 100).toFixed(1)} % ≥ ${(p.Xt * 100).toFixed(0)} %` },
    { ok: Math.abs(dTad) <= 50, label: 'Adiabatic temperature rise ≤ 50 K (low severity if cooling fails; Stoessel)', detail: `ΔT_ad = ${dTad.toFixed(0)} K at this conversion` },
    { ok: p.T <= 200 && p.T >= 0, label: 'Temperature 0…200 °C (liquid-phase range of the model)', detail: `${p.T.toFixed(0)} °C` },
  ];
  return { k, N, tau, X, C, Da, tauT, Vt, FA0, prod, Q, dTad, stages, profile, checks };
}
export type ReactResult = ReturnType<typeof reactor>;

export const REACT_INTRO = 'A reactor turns a feed into product; how far it gets depends on how long the fluid stays inside (the residence time τ = V/v₀) and how fast the reaction runs (its rate constant, which grows steeply with temperature). A well-stirred tank (CSTR) works everywhere at the low outlet concentration, so it reacts slowly; a plug-flow tube keeps the high concentration at its inlet and needs less volume for the same conversion; several tanks in series sit between the two. A batch reactor is a plug-flow tube in time.';
export const REACT_NOTES = [
  'Ideal reactors, isothermal, constant density, one irreversible reaction A → products with −r_A = k C_Aⁿ and k = k₂₅ exp[−(E_a/R)(1/T − 1/298.15 K)]. Mole balances: batch and plug flow dC/dτ = −k Cⁿ (closed form), CSTR C₀ − C = τ k Cⁿ (solved numerically), N equal tanks in series each with τ/N. Checks against the closed forms of Fogler (Elements of Chemical Reaction Engineering) for first and second order are in the tests.',
  'Levenspiel plot: F_A0/(−r_A) against X; the CSTR volume is the rectangle up to the outlet conversion, the plug-flow volume the area under the curve. For orders above zero the plug-flow reactor is always the smaller one.',
  'Heat: released Q = (−ΔH) F_A0 X; adiabatic temperature rise ΔT_ad = (−ΔH) C_A0 X/(ρ c_p) — the rise if cooling fails. ΔT_ad ≤ 50 K is the low-severity class of Stoessel\'s criticality assessment; above it, runaway must be studied (not done here). Non-isothermal operation, reversible and multiple reactions, mixing and residence-time distribution are not modelled.',
];
