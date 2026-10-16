/**
 * Thermodynamic cycles: air-standard Otto, Diesel, Brayton (cold-air standard, constant specific heats)
 * and vapour cycles Rankine (water) and vapour-compression refrigeration (refrigerant tables).
 * Units: T °C in inputs/outputs (K internally for gas cycles), p kPa, h kJ/kg, s kJ/(kg·K), v m³/kg.
 */
import { satP, satT, statePH, statePS, statePT, superheated, TCRIT, TsatP, type Fluid } from './props.ts';

export const AIR = { cp: 1.005, k: 1.4, cv: 1.005 / 1.4, R: 1.005 - 1.005 / 1.4 }; // cv 0.718, R 0.287 kJ/(kg·K), consistent with k
const K = 273.15;

export type Pt = { T: number; s: number; p?: number; v?: number }; // T °C, s kJ/(kg·K) relative (gas: 0 at state 1)
export type GasState = { n: string; T: number; p: number; v: number; s: number }; // T °C
type Check = { ok: boolean; label: string; detail: string };

/* ---------------- gas cycles (cold-air standard) ---------------- */

const sOf = (T: number, p: number, T1: number, p1: number) => AIR.cp * Math.log((T + K) / (T1 + K)) - AIR.R * Math.log(p / p1);
const gas = (n: string, T: number, p: number, T1: number, p1: number): GasState => ({ n, T, p, v: (AIR.R * (T + K)) / p, s: sOf(T, p, T1, p1) });

/** Points along a process between two gas states for diagrams: 'isentropic' (pv^k), 'v' (const volume), 'p' (const pressure). */
function gasPath(a: GasState, b: GasState, kind: 'isentropic' | 'v' | 'p', T1: number, p1: number, n = 24): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    let v: number, p: number;
    if (kind === 'isentropic') { v = a.v * Math.pow(b.v / a.v, t); p = a.p * Math.pow(a.v / v, AIR.k); }
    else if (kind === 'v') { v = a.v; p = a.p + (b.p - a.p) * t; }
    else { p = a.p; v = a.v + (b.v - a.v) * t; }
    const T = (p * v) / AIR.R - K;
    return { T, s: sOf(T, p, T1, p1), p, v };
  });
}

export type OttoIn = { r: number; T1: number; p1: number; qin: number }; // r compression ratio, T1 °C, p1 kPa, qin kJ/kg
export function otto(c: OttoIn) {
  const { k, cv } = AIR;
  const T1 = c.T1 + K, T2 = T1 * Math.pow(c.r, k - 1), T3 = T2 + c.qin / cv, T4 = T3 / Math.pow(c.r, k - 1);
  const p2 = c.p1 * Math.pow(c.r, k), p3 = (p2 * T3) / T2, p4 = (p3 / Math.pow(c.r, k));
  const S = [gas('1', c.T1, c.p1, c.T1, c.p1), gas('2', T2 - K, p2, c.T1, c.p1), gas('3', T3 - K, p3, c.T1, c.p1), gas('4', T4 - K, p4, c.T1, c.p1)];
  const qout = cv * (T4 - T1), wnet = c.qin - qout, eta = wnet / c.qin;
  const mep = wnet / (S[0].v - S[1].v);
  const path = [...gasPath(S[0], S[1], 'isentropic', c.T1, c.p1), ...gasPath(S[1], S[2], 'v', c.T1, c.p1), ...gasPath(S[2], S[3], 'isentropic', c.T1, c.p1), ...gasPath(S[3], S[0], 'v', c.T1, c.p1)];
  const checks: Check[] = [
    { ok: c.r <= 12, label: 'Compression ratio ≤ 12 (knock limit for petrol engines)', detail: `r = ${c.r}` },
    { ok: T3 - K <= 2500, label: 'Peak temperature T₃ ≤ 2500 °C (real engines lose heat and dissociate above)', detail: `T₃ = ${(T3 - K).toFixed(0)} °C` },
  ];
  return { S, qin: c.qin, qout, wnet, eta, etaFormula: 1 - Math.pow(c.r, 1 - k), mep, path, checks, Tmax: T3 - K };
}

export type DieselIn = { r: number; T1: number; p1: number; qin: number };
export function diesel(c: DieselIn) {
  const { k, cp, cv } = AIR;
  const T1 = c.T1 + K, T2 = T1 * Math.pow(c.r, k - 1), T3 = T2 + c.qin / cp, rc = T3 / T2, T4 = T3 * Math.pow(rc / c.r, k - 1);
  const p2 = c.p1 * Math.pow(c.r, k), p4 = (c.p1 * T4) / T1;
  const S = [gas('1', c.T1, c.p1, c.T1, c.p1), gas('2', T2 - K, p2, c.T1, c.p1), gas('3', T3 - K, p2, c.T1, c.p1), gas('4', T4 - K, p4, c.T1, c.p1)];
  const qout = cv * (T4 - T1), wnet = c.qin - qout, eta = wnet / c.qin;
  const mep = wnet / (S[0].v - S[1].v);
  const path = [...gasPath(S[0], S[1], 'isentropic', c.T1, c.p1), ...gasPath(S[1], S[2], 'p', c.T1, c.p1), ...gasPath(S[2], S[3], 'isentropic', c.T1, c.p1), ...gasPath(S[3], S[0], 'v', c.T1, c.p1)];
  const etaFormula = 1 - (Math.pow(rc, k) - 1) / (Math.pow(c.r, k - 1) * k * (rc - 1));
  const checks: Check[] = [
    { ok: c.r >= 12 && c.r <= 24, label: 'Compression ratio 12…24 (self-ignition needs high r)', detail: `r = ${c.r}` },
    { ok: rc < c.r, label: 'Cut-off before the end of the stroke (r_c < r)', detail: `r_c = ${rc.toFixed(2)}` },
  ];
  return { S, rc, qin: c.qin, qout, wnet, eta, etaFormula, mep, path, checks, Tmax: T3 - K };
}

export type BraytonIn = { rp: number; T1: number; p1: number; T3: number; etaC: number; etaT: number; regen: number }; // regen: regenerator effectiveness 0…1
export function brayton(c: BraytonIn) {
  const { k, cp } = AIR, e = (k - 1) / k;
  const T1 = c.T1 + K, T3 = c.T3 + K;
  const T2s = T1 * Math.pow(c.rp, e), T2 = T1 + (T2s - T1) / c.etaC;
  const T4s = T3 / Math.pow(c.rp, e), T4 = T3 - c.etaT * (T3 - T4s);
  const useRegen = c.regen > 0 && T4 > T2;
  const T5 = useRegen ? T2 + c.regen * (T4 - T2) : T2; // air into the combustor
  const p2 = c.p1 * c.rp;
  const S = [gas('1', c.T1, c.p1, c.T1, c.p1), gas('2', T2 - K, p2, c.T1, c.p1), gas('3', c.T3, p2, c.T1, c.p1), gas('4', T4 - K, c.p1, c.T1, c.p1)];
  const wc = cp * (T2 - T1), wt = cp * (T3 - T4), wnet = wt - wc, qin = cp * (T3 - T5), eta = wnet / qin;
  // diagram: compression and expansion as straight lines in T–s between end states (irreversible), heat at constant p
  const line = (a: GasState, b: GasState, n = 12): Pt[] => Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, T = a.T + (b.T - a.T) * t, p = a.p * Math.pow(b.p / a.p, t);
    return { T, s: a.s + (b.s - a.s) * t, p, v: (AIR.R * (T + K)) / p };
  });
  const path = [...line(S[0], S[1]), ...gasPath(S[1], S[2], 'p', c.T1, c.p1), ...line(S[2], S[3]), ...gasPath(S[3], S[0], 'p', c.T1, c.p1)];
  const checks: Check[] = [
    { ok: c.T3 <= 1500, label: 'Turbine inlet ≤ 1500 °C (cooled blades; uncooled ≈ 1000 °C)', detail: `T₃ = ${c.T3} °C` },
    { ok: wnet > 0, label: 'Positive net work (turbine work > compressor work)', detail: `w_net = ${wnet.toFixed(0)} kJ/kg` },
    { ok: !(c.regen > 0) || useRegen, label: 'Regenerator useful only if turbine exit is hotter than compressor exit', detail: `T₄ = ${(T4 - K).toFixed(0)} °C, T₂ = ${(T2 - K).toFixed(0)} °C` },
  ];
  return { S, T2s: T2s - K, T4s: T4s - K, T5: T5 - K, wc, wt, wnet, qin, eta, bwr: wc / wt, etaIdeal: 1 - Math.pow(c.rp, -e), path, checks, Tmax: c.T3 };
}

/* ---------------- Rankine (water / steam) ---------------- */

export type RankineIn = { pB: number; T1: number; pC: number; etaT: number; etaP: number; Pnet: number }; // pB boiler [kPa], T1 turbine inlet [°C], pC condenser [kPa], Pnet [kW]
export function rankine(c: RankineIn) {
  const f: Fluid = 'water';
  const satB = satP(f, c.pB), satC = satP(f, c.pC);
  const T1 = Math.max(c.T1, satB.T);
  const s1 = statePT(f, c.pB, T1);
  const s2s = statePS(f, c.pC, s1.s);
  const h2 = s1.h - c.etaT * (s1.h - s2s.h);
  const s2 = statePH(f, c.pC, h2);
  const s3 = { T: satC.T, p: c.pC, h: satC.hf, s: satC.sf, x: 0 as number | null };
  const wps = satC.vf * (c.pB - c.pC), wp = wps / c.etaP;
  const s4 = { T: satC.T + (wp - wps) / 4.18, p: c.pB, h: satC.hf + wp, s: satC.sf + (wp - wps) / (satC.T + K), x: null as number | null };
  const wt = s1.h - h2, qin = s1.h - s4.h, qout = h2 - s3.h, wnet = wt - wp, eta = wnet / qin;
  const mdot = c.Pnet / wnet; // kg/s
  const carnot = 1 - (satC.T + K) / (T1 + K);
  // T–s path: pump (3→4), heating along the boiler isobar (liquid ≈ saturated-liquid line), boiling, superheating, expansion, condensation
  const path: Pt[] = [{ T: s3.T, s: s3.s }, { T: s4.T, s: s4.s }];
  for (let T = s4.T + 5; T < satB.T; T += 5) path.push({ T, s: satT(f, T).sf });
  path.push({ T: satB.T, s: satB.sf }, { T: satB.T, s: satB.sg });
  for (let i = 1; i <= 16; i++) { const dT = ((T1 - satB.T) * i) / 16; path.push({ T: satB.T + dT, s: superheated(f, c.pB, dT).s }); }
  path.push({ T: s2.T, s: s2.s }, { T: s3.T, s: s3.s });
  const checks: Check[] = [
    { ok: c.T1 > satB.T, label: 'Turbine inlet superheated (T₁ > T_sat at boiler pressure)', detail: `T₁ = ${c.T1} °C, T_sat = ${satB.T.toFixed(1)} °C` },
    { ok: s2.x === null || s2.x >= 0.88, label: 'Turbine exit quality x₂ ≥ 0.88 (wet steam erodes the last blades)', detail: s2.x === null ? 'superheated exit' : `x₂ = ${s2.x.toFixed(3)}` },
    { ok: c.T1 <= 600, label: 'Turbine inlet ≤ 600 °C (steel creep limit, typical 540…600 °C)', detail: `T₁ = ${c.T1} °C` },
    { ok: c.pB < 22064, label: 'Boiler pressure below the critical point (22.06 MPa) — subcritical model', detail: `p = ${(c.pB / 1000).toFixed(1)} MPa` },
  ];
  return { S: [s1, s2, s3, s4], s2s, satB, satC, wt, wp, qin, qout, wnet, eta, mdot, carnot, bwr: wp / wt, heatRate: 3600 / eta, path, checks };
}

/* ---------------- vapour-compression refrigeration ---------------- */

export type RefrigIn = { fluid: Fluid; Te: number; Tc: number; sh: number; sc: number; etaC: number; QL: number }; // evaporating/condensing T [°C], superheat/subcooling [K], capacity QL [kW]
export function refrigeration(c: RefrigIn) {
  const f = c.fluid;
  const se = satT(f, c.Te), sc = satT(f, c.Tc);
  const pe = se.p, pc = sc.p;
  const s1 = c.sh > 0 ? { ...statePT(f, pe, c.Te + c.sh) } : { T: c.Te, p: pe, h: se.hg, s: se.sg, x: 1 as number | null };
  const s2s = statePS(f, pc, s1.s);
  const h2 = s1.h + (s2s.h - s1.h) / c.etaC;
  const s2 = statePH(f, pc, h2);
  const T3 = c.Tc - c.sc, l3 = satT(f, T3);
  const s3 = { T: T3, p: pc, h: l3.hf, s: l3.sf, x: c.sc > 0 ? null : (0 as number | null) };
  const s4 = statePH(f, pe, s3.h);
  const qL = s1.h - s4.h, w = s2.h - s1.h, qH = s2.h - s3.h;
  const cop = qL / w, copHP = qH / w;
  const carnot = (c.Te + K) / (c.Tc - c.Te);
  const mdot = c.QL / qL, W = mdot * w;
  const path: Pt[] = [{ T: s4.T, s: s4.s }, { T: se.T, s: se.sg }];
  if (c.sh > 0) for (let i = 1; i <= 6; i++) { const dT = (c.sh * i) / 6; path.push({ T: c.Te + dT, s: superheated(f, pe, dT).s }); }
  path.push({ T: s2.T, s: s2.s });
  const dTd = s2.T - sc.T;
  for (let i = 1; i <= 10; i++) { const dT = dTd * (1 - i / 10); path.push({ T: sc.T + dT, s: superheated(f, pc, dT).s }); }
  path.push({ T: sc.T, s: sc.sf });
  if (c.sc > 0) path.push({ T: s3.T, s: s3.s });
  path.push({ T: s4.T, s: s4.s });
  const checks: Check[] = [
    { ok: c.Tc < TCRIT(f) - 10, label: 'Condensing at least 10 K below the critical point', detail: `T_c = ${c.Tc} °C, T_crit = ${TCRIT(f)} °C` },
    { ok: pc / pe <= 10, label: 'Pressure ratio ≤ 10 for a single-stage compressor', detail: `p_c/p_e = ${(pc / pe).toFixed(1)}` },
    { ok: s2.T <= 120, label: 'Discharge temperature ≤ 120 °C (oil breakdown)', detail: `T₂ = ${s2.T.toFixed(0)} °C` },
    { ok: pe >= 100, label: 'Evaporator above atmospheric pressure (no air leaks in)', detail: `p_e = ${pe.toFixed(0)} kPa` },
  ];
  return { S: [s1, s2, s3, s4], s2s, pe, pc, qL, w, qH, cop, copHP, carnot, mdot, W, path, checks };
}

/** Saturation temperature helper for UI labels. */
export const tsat = TsatP;

export const CYCLE_NOTES = {
  gas: 'Cold-air standard: air as an ideal gas with constant c_p = 1.005, c_v = 0.718 kJ/(kg·K), k = 1.4; heat addition replaces combustion, heat rejection replaces exhaust and intake; processes internally reversible except the stated component efficiencies. Real engines reach about half to two thirds of these efficiencies (heat loss, friction, real-gas c_p rising with temperature, combustion timing).',
  rankine: 'Water/steam properties interpolated in tables generated from IAPWS-95 (CoolProp); same reference state as the usual steam tables. Pump inlet saturated liquid; pump and turbine adiabatic with the given isentropic efficiencies; pump work v·Δp; no pressure losses in boiler, condenser and pipes; no reheat or feed-water heating. Heat rate = 3600/η in kJ/kWh.',
  refrig: 'Refrigerant properties interpolated in tables generated from reference equations of state (CoolProp), ASHRAE reference state (h = s = 0 for saturated liquid at −40 °C, as in Çengel’s R-134a tables). Throttling valve isenthalpic; compressor adiabatic with the given isentropic efficiency; no pressure drops; subcooled liquid taken as saturated liquid at its temperature.',
};
