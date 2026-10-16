/**
 * Combined cycle and cogeneration: gas turbine → heat recovery steam generator (HRSG, one pressure) → steam turbine,
 * whose exhaust either condenses (power only) or heats a user (back-pressure CHP).
 * Gas turbine with constant specific heats, air (cp 1.005, k 1.4) through the compressor and combustion gas
 * (cp 1.148, k 1.333) through the turbine and the HRSG (Saravanamuttoo, Gas Turbine Theory), natural gas LHV 50 MJ/kg,
 * 4 % combustor and 3 % exhaust pressure loss. Steam from the CoolProp tables (props.ts). HRSG from the pinch:
 * gas leaves the evaporator at T_sat + ΔT_pinch, the economizer brings the feed water to saturation.
 * Primary energy saving after Directive 2012/27/EU Annex II with the harmonised references of Delegated Regulation
 * (EU) 2015/2402 for natural gas (electricity 53 %, hot water 92 %, steam 87 %), no grid-loss correction.
 * Units: T °C, p kPa, h kJ/kg, flows kg/s, power kW.
 */
import { satP, satT, statePH, statePS, statePT, TsatP } from './props.ts';

export const AIRC = { cp: 1.005, k: 1.4 }, GAS = { cp: 1.148, k: 1.333 };
export const LHV = 50000; // kJ/kg natural gas
const K = 273.15;
export const REF = { el: 0.53, hotWater: 0.92, steam: 0.87 };

export type Heat = 'none' | 'water' | 'steam';
export type CCIn = {
  Pgt: number;      // gas turbine electric power [kW]
  rp: number;       // compressor pressure ratio
  T1: number;       // ambient air [°C]
  T3: number;       // turbine inlet temperature [°C]
  etaC: number; etaT: number;
  pS: number;       // live steam pressure [kPa]
  TS: number;       // live steam temperature [°C]
  dTp: number;      // pinch [K]
  etaST: number;    // steam turbine isentropic efficiency
  Tx: number;       // condensing temperature of the steam-turbine exhaust [°C]
  heat: Heat;       // what the exhaust heat does
};

/** Steam cycle per kg of steam: pump from saturated liquid at p_x to p_s, superheat, expand to p_x. */
export function steamCycle(pS: number, TS: number, px: number, etaST = 1, etaP = 1) {
  const satX = satP('water', px), live = statePT('water', pS, TS);
  const xs = statePS('water', px, live.s), hx = live.h - etaST * (live.h - xs.h), exh = statePH('water', px, hx);
  const wp = (satX.vf * (pS - px)) / etaP, hfw = satX.hf + wp;
  return { satX, live, exh, hx, wt: live.h - hx, wp, hfw, wnet: live.h - hx - wp, qin: live.h - hfw };
}

/** Gas turbine per kg of air. */
export function gasTurbine(c: Pick<CCIn, 'rp' | 'T1' | 'T3' | 'etaC' | 'etaT'>) {
  const T1 = c.T1 + K, T3 = c.T3 + K;
  const T2s = T1 * Math.pow(c.rp, (AIRC.k - 1) / AIRC.k), T2 = T1 + (T2s - T1) / c.etaC;
  const wc = AIRC.cp * (T2 - T1);
  const f = (GAS.cp * (T3 - 298.15) - AIRC.cp * (T2 - 298.15)) / (0.99 * LHV - GAS.cp * (T3 - 298.15)); // fuel/air
  const rt = (c.rp * 0.96) / 1.03; // combustor and exhaust (HRSG) pressure losses
  const T4s = T3 / Math.pow(rt, (GAS.k - 1) / GAS.k), T4 = T3 - c.etaT * (T3 - T4s);
  const wt = (1 + f) * GAS.cp * (T3 - T4);
  return { T2: T2 - K, T4: T4 - K, T2s: T2s - K, T4s: T4s - K, wc, wt, wnet: wt - wc, f, qin: f * LHV };
}

const ETA_GEN = 0.985;

export function combined(c: CCIn) {
  const gt = gasTurbine(c);
  const ma = c.Pgt / Math.max(gt.wnet * ETA_GEN, 1e-6), mg = ma * (1 + gt.f);
  const Qfuel = ma * gt.qin;
  const px = satT('water', c.Tx).p;
  const st = steamCycle(c.pS, c.TS, px, c.etaST, 0.8);
  const Tsat = TsatP('water', c.pS), hfS = satP('water', c.pS).hf;
  // pinch at the evaporator outlet (gas side): steam flow from the superheater + evaporator duty
  const Tgp = Tsat + c.dTp;
  let ms = (mg * GAS.cp * (gt.T4 - Tgp)) / Math.max(st.live.h - hfS, 1e-6);
  let Tstack = Tgp - (ms * (hfS - st.hfw)) / (mg * GAS.cp);
  const Tfw = st.satX.T; // feed water ≈ condensate temperature
  let coldEnd = false;
  if (Tstack < Tfw + c.dTp) { // the economizer would need gas colder than the feed water: the cold end limits the steam flow
    coldEnd = true; Tstack = Tfw + c.dTp;
    ms = (mg * GAS.cp * (gt.T4 - Tstack)) / Math.max(st.live.h - st.hfw, 1e-6);
  }
  ms = Math.max(ms, 0);
  const Pst = ms * st.wt * ETA_GEN, Ppump = ms * st.wp;
  const P = c.Pgt + Pst - Ppump;
  const Qx = ms * (st.hx - st.satX.hf); // exhaust heat: to the user or the cooling tower
  const Qheat = c.heat === 'none' ? 0 : Qx;
  const Qstack = mg * GAS.cp * (Tstack - c.T1);
  const etaGT = c.Pgt / Qfuel, etaEl = P / Qfuel, etaH = Qheat / Qfuel, util = etaEl + etaH;
  const refH = c.heat === 'steam' ? REF.steam : REF.hotWater;
  const PES = c.heat === 'none' ? 0 : 1 - 1 / (etaH / refH + etaEl / REF.el);
  const heatRate = 3600 / etaEl; // kJ/kWh
  const HRSG = { // duties [kW]
    sh: ms * (st.live.h - satP('water', c.pS).hg), ev: ms * (satP('water', c.pS).hg - hfS), eco: ms * (hfS - st.hfw),
    Tg: { in: gt.T4, afterSh: gt.T4 - (ms * (st.live.h - satP('water', c.pS).hg)) / (mg * GAS.cp), pinch: Tgp, stack: Tstack },
  };
  const checks: { ok: boolean; label: string; detail: string }[] = [
    { ok: c.T3 <= 1600, label: 'Turbine inlet temperature within today’s machines (≤ 1600 °C)', detail: `T₃ = ${c.T3.toFixed(0)} °C` },
    { ok: gt.T4 <= 650, label: 'Gas turbine exhaust at most 650 °C (HRSG without supplementary firing)', detail: `T₄ = ${gt.T4.toFixed(0)} °C` },
    { ok: c.TS <= gt.T4 - 20, label: 'Live steam at least 20 K below the gas turbine exhaust (approach)', detail: `${c.TS.toFixed(0)} °C ≤ ${(gt.T4 - 20).toFixed(0)} °C` },
    { ok: Tgp < gt.T4 - 30, label: 'Exhaust hot enough to boil at this steam pressure', detail: `T_sat + ΔT_pp = ${Tgp.toFixed(0)} °C, T₄ = ${gt.T4.toFixed(0)} °C` },
    { ok: Tstack >= 80, label: 'Stack at least 80 °C (no condensation in the stack)', detail: `T_stack = ${Tstack.toFixed(0)} °C` },
    { ok: st.exh.x === null || st.exh.x >= 0.88, label: 'Steam turbine exhaust quality at least 0.88 (wet steam erodes the last blades)', detail: st.exh.x === null ? 'superheated exhaust' : `x = ${st.exh.x.toFixed(3)}` },
    { ok: c.heat !== 'none' || c.Tx >= c.T1 + 10, label: 'Condensing at least 10 K above the ambient air (cooling)', detail: `T_x = ${c.Tx.toFixed(0)} °C, ambient ${c.T1.toFixed(0)} °C` },
  ];
  if (c.heat !== 'none') checks.push({ ok: PES >= 0.1, label: 'High-efficiency cogeneration: primary energy saving at least 10 % (Directive 2012/27/EU)', detail: `PES = ${(PES * 100).toFixed(1)} %` });
  return { gt, ma, mg, Qfuel, px, st, Tsat, ms, Tstack, coldEnd, Pst, Ppump, P, Qx, Qheat, Qstack, etaGT, etaEl, etaH, util, PES, heatRate, HRSG, fuel: ma * gt.f, checks };
}
export type CCResult = ReturnType<typeof combined>;

export type CCKind = 'cc' | 'dh' | 'process';
export const CC_PRESETS: Record<CCKind, CCIn> = {
  cc: { Pgt: 280000, rp: 19, T1: 15, T3: 1400, etaC: 0.88, etaT: 0.9, pS: 7000, TS: 565, dTp: 10, etaST: 0.88, Tx: 33, heat: 'none' },
  dh: { Pgt: 40000, rp: 15, T1: 5, T3: 1250, etaC: 0.87, etaT: 0.89, pS: 6000, TS: 480, dTp: 10, etaST: 0.84, Tx: 95, heat: 'water' },
  process: { Pgt: 15000, rp: 14, T1: 15, T3: 1150, etaC: 0.86, etaT: 0.88, pS: 4000, TS: 420, dTp: 12, etaST: 0.8, Tx: 160, heat: 'steam' },
};

export const CC_INTRO = 'A gas turbine throws away exhaust at about 550…650 °C. A combined-cycle plant catches it in a heat recovery steam generator and drives a steam turbine with it, so the same fuel makes half as much power again: close to 60 % of the fuel becomes electricity. If the steam turbine exhausts into a district-heating network or a factory instead of a cooling tower, it makes less power but the heat is used too — cogeneration (CHP) — and most of the fuel becomes something useful.';

export const CC_NOTES = [
  'Gas turbine: constant specific heats — air cp 1.005 kJ/(kg·K), k 1.4 in the compressor; combustion gas cp 1.148, k 1.333 in the turbine and the HRSG (Saravanamuttoo et al., Gas Turbine Theory) — natural gas LHV 50 MJ/kg, combustion efficiency 0.99, 4 % pressure loss in the combustor and 3 % back pressure from the HRSG, no turbine cooling air, generator 0.985. Real machines of the same pressure ratio and firing temperature do a few points better or worse; use the manufacturer’s heat rate for a project.',
  'HRSG with one pressure level: superheater and evaporator from the turbine exhaust down to T_sat + ΔT_pinch, economizer from the feed water up to saturation; when that would leave the gas colder than the feed water plus the pinch, the cold end limits the steam flow instead. No deaerator, drum blowdown, reheat, second or third pressure level or supplementary firing (large plants with three pressures and reheat reach a few points more).',
  'Steam: CoolProp tables, turbine with the isentropic efficiency you set to the exhaust pressure of the condensing temperature, feed pump 0.8. Power only: the exhaust heat goes to the cooling tower. Cogeneration: the exhaust condenses in the heat user (back-pressure turbine): district heating returns at the condensing temperature, process steam is delivered as saturated steam at it.',
  'Primary energy saving PES = 1 − 1/(η_heat/Ref η_H + η_el/Ref η_E) (Directive 2012/27/EU Annex II) with the harmonised reference efficiencies for natural gas of Delegated Regulation (EU) 2015/2402: electricity 53 %, hot water 92 %, steam 87 %, without the grid-loss and climate corrections; high-efficiency cogeneration needs PES ≥ 10 %. VALIDATION: the steam-cycle calculation reproduces Çengel & Boles, Example 10-9 (ideal Rankine 7 MPa, 500 °C, 5 kPa); combined with that example’s gas-side enthalpies (Example 9-6, air tables) it gives the book’s steam/gas mass ratio 0.131, net work 384.8 kJ/kg and efficiency 48.7 %. The gas turbine here uses constant specific heats, so it is not part of that check.',
];
