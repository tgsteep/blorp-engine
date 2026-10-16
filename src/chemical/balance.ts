/**
 * Mass and energy balances on two simple units with liquid (water-based) streams. Mixer + heater: total mass, solute
 * and enthalpy balances (constant c_p, reference 0 °C), heater duty and steam to reach a target temperature.
 * Single-effect evaporator: solute and total mass balances give product and vapour; the enthalpy balance (feed heated
 * to the boiling point, water evaporated) gives the heat load, the steam and the heating area. Steam and water
 * saturation properties from the CoolProp tables of the Cycles tool. Units: kg/h, °C, kPa abs, kW, m².
 */
import { satP } from '../thermo/props.ts';

export type MixIn = { m1: number; x1: number; T1: number; m2: number; x2: number; T2: number; cp: number; Tt: number; ps: number };
export type EvapIn = { F: number; xF: number; TF: number; xP: number; P1: number; bpr: number; ps: number; U: number; cp: number };

/** Latent heat [kJ/kg] and saturation temperature [°C] of water at pressure p [kPa]. */
export function steam(p: number) { const s = satP('water', p); return { T: s.T, lambda: s.hg - s.hf }; }

export function mixer(p: MixIn) {
  const m3 = p.m1 + p.m2, x3 = (p.m1 * p.x1 + p.m2 * p.x2) / m3;
  const T3 = (p.m1 * p.T1 + p.m2 * p.T2) / m3; // equal c_p
  const Q = (m3 * p.cp * (p.Tt - T3)) / 3600; // kW (negative = cooling)
  const st = steam(p.ps), ms = Q > 0 ? (Q * 3600) / st.lambda : 0; // kg/h of steam condensed
  const checks = [
    { ok: p.Tt < 100, label: 'Outlet below 100 °C (stays liquid at atmospheric pressure)', detail: `T_out = ${p.Tt.toFixed(1)} °C` },
    { ok: Q <= 0 || st.T >= p.Tt + 10, label: 'Steam at least 10 K hotter than the target (heater driving force)', detail: `steam ${st.T.toFixed(1)} °C, target ${p.Tt.toFixed(1)} °C` },
  ];
  return { m3, x3, T3, Q, st, ms, checks };
}

export function evaporator(p: EvapIn) {
  const L = (p.F * p.xF) / p.xP, V = p.F - L; // kg/h product and vapour
  const s1 = steam(p.P1), T1 = s1.T + p.bpr, lam1 = s1.lambda; // boiling point, latent heat in the body
  const ss = steam(p.ps), dT = ss.T - T1;
  const qSens = (p.F * p.cp * (T1 - p.TF)) / 3600, qLat = (V * lam1) / 3600, q = qSens + qLat; // kW
  const S = (q * 3600) / ss.lambda, A = (q * 1000) / (p.U * dT), economy = V / S;
  const checks = [
    { ok: p.xP > p.xF, label: 'Product more concentrated than the feed', detail: `x_P = ${(p.xP * 100).toFixed(1)} % > x_F = ${(p.xF * 100).toFixed(1)} %` },
    { ok: dT >= 10, label: 'Temperature difference steam − boiling liquid ≥ 10 K', detail: `ΔT = ${dT.toFixed(1)} K` },
    { ok: p.TF <= T1, label: 'Feed not hotter than the boiling liquid (no flash)', detail: `T_F = ${p.TF.toFixed(1)} °C ≤ T₁ = ${T1.toFixed(1)} °C` },
    { ok: dT > 0 && A <= 1000, label: 'Heating area ≤ 1000 m² (one evaporator body)', detail: `A = ${A.toFixed(1)} m²` },
  ];
  return { L, V, T1, lam1, s1, ss, dT, qSens, qLat, q, S, A, economy, checks };
}
export type MixResult = ReturnType<typeof mixer>;
export type EvapResult = ReturnType<typeof evaporator>;

export const BAL_INTRO = 'What goes in must come out: every process is first a set of balances. Mass is conserved in total and for each substance; energy is conserved too, so the enthalpy brought in by the streams and the heat added equal the enthalpy leaving. Writing these balances around a unit — a mixer, a heater, an evaporator — gives the flows, compositions, temperatures and the heat or steam it needs.';
export const BAL_NOTES = [
  'Mixer: m₃ = m₁ + m₂, x₃ m₃ = x₁ m₁ + x₂ m₂ (mass fraction of a dissolved substance), enthalpy with one constant c_p for all streams (heat of mixing and of solution neglected), so T₃ is the mass-weighted mean; heater duty Q = m₃ c_p (T_target − T₃), steam condensing at the chosen pressure (latent heat from CoolProp-generated water tables).',
  'Evaporator (single effect): L = F x_F/x_P, V = F − L; the liquid boils at the saturation temperature of the body pressure plus the boiling-point rise; heat load q = F c_p (T₁ − T_F) + V λ₁ (enthalpy reference: liquid at T₁, as in Geankoplis), steam S = q/λ_s, area A = q/(U (T_s − T₁)), economy V/S. Validation: Geankoplis Example 8.4-1 (9072 kg/h, 1.0 → 1.5 wt %, 311 K, 101.325 kPa, steam 143.3 kPa, U 1704 W/m²K): L 6048 kg/h, V 3024 kg/h, A 149.3 m².',
  'Not included: heats of solution and mixing, heat losses, sub-cooled condensate, entrainment, multiple effects and vapour recompression (each extra effect roughly divides the steam by the number of effects).',
];
