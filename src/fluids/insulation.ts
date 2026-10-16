/**
 * Insulated pipe in still or moving air (in the spirit of EN ISO 12241 / VDI 2055): heat flow per metre through a
 * cylindrical insulation layer whose conductivity depends on its mean temperature, outer surface coefficient from
 * natural (Churchill–Chu) and forced (Churchill–Bernstein) convection plus radiation, iterated for the surface
 * temperature; bare pipe for comparison, critical radius, condensation on cold pipes, yearly loss. SI units.
 */
import { pws } from '../hvac/psychro.ts';

export const SIGMA = 5.670374e-8;
/** Steel pipe outside diameters [mm] (ISO 4200 / EN 10220) by nominal size. */
export const PIPES: { dn: number; od: number }[] = [
  { dn: 15, od: 21.3 }, { dn: 20, od: 26.9 }, { dn: 25, od: 33.7 }, { dn: 32, od: 42.4 }, { dn: 40, od: 48.3 }, { dn: 50, od: 60.3 },
  { dn: 65, od: 76.1 }, { dn: 80, od: 88.9 }, { dn: 100, od: 114.3 }, { dn: 125, od: 139.7 }, { dn: 150, od: 168.3 }, { dn: 200, od: 219.1 },
  { dn: 250, od: 273 }, { dn: 300, od: 323.9 },
];

export type InsId = 'mw' | 'fef' | 'pur' | 'casi' | 'cg';
/** Insulation materials: conductivity λ(θ) = a + bθ + cθ² [W/(m·K), θ in °C] (typical declared curves), service range [°C]. */
export const INSUL: Record<InsId, { name: string; a: number; b: number; c: number; tmin: number; tmax: number; color: string }> = {
  mw: { name: 'Mineral wool pipe section', a: 0.034, b: 1e-4, c: 2.5e-7, tmin: -50, tmax: 650, color: '#E8D27A' },
  fef: { name: 'Elastomeric foam (FEF)', a: 0.033, b: 1e-4, c: 0, tmin: -50, tmax: 105, color: '#3A3D42' },
  pur: { name: 'PUR/PIR foam', a: 0.022, b: 1e-4, c: 0, tmin: -50, tmax: 120, color: '#F3E3B5' },
  casi: { name: 'Calcium silicate', a: 0.052, b: 8e-5, c: 1e-7, tmin: 0, tmax: 1000, color: '#EFEDE6' },
  cg: { name: 'Cellular glass', a: 0.038, b: 1.2e-4, c: 0, tmin: -260, tmax: 430, color: '#4B4F55' },
};
export type CladId = 'alu' | 'steel' | 'paint';
/** Outer surface emissivity of the cladding. */
export const CLAD: Record<CladId, { name: string; eps: number; color: string }> = {
  alu: { name: 'Aluminium sheet', eps: 0.1, color: '#D5D9DE' },
  steel: { name: 'Galvanised steel', eps: 0.25, color: '#B8BEC6' },
  paint: { name: 'Painted / plastic jacket', eps: 0.9, color: '#5D7FB8' },
};
export const EPS_BARE = 0.8;  // oxidised or painted steel pipe

export const lambdaOf = (m: InsId, t: number) => { const x = INSUL[m]; return x.a + x.b * t + x.c * t * t; };

/** Air properties at film temperature [°C]: conductivity, kinematic viscosity, Prandtl number. */
function air(t: number) {
  const T = t + 273.15, mu = (1.458e-6 * T ** 1.5) / (T + 110.4), rho = 101325 / (287.05 * T);
  return { k: 0.02436 + 7.6e-5 * t, nu: mu / rho, Pr: 0.71, beta: 1 / T };
}
/** Outer heat transfer coefficient [W/(m²K)]: convection (natural and forced combined by cubes) + radiation. */
export function hOuter(D: number, ts: number, ta: number, wind: number, eps: number) {
  const tf = (ts + ta) / 2, a = air(tf), dT = Math.max(Math.abs(ts - ta), 1e-3);
  const Ra = (9.81 * a.beta * dT * D ** 3) / (a.nu * a.nu) * a.Pr;
  const Nun = (0.6 + (0.387 * Ra ** (1 / 6)) / (1 + (0.559 / a.Pr) ** (9 / 16)) ** (8 / 27)) ** 2;
  const Re = (wind * D) / a.nu;
  const Nuf = wind > 0 ? 0.3 + ((0.62 * Re ** 0.5 * a.Pr ** (1 / 3)) / (1 + (0.4 / a.Pr) ** (2 / 3)) ** 0.25) * (1 + (Re / 282000) ** (5 / 8)) ** (4 / 5) : 0;
  const hc = (Math.cbrt(Nun ** 3 + Nuf ** 3) * a.k) / D;
  const Ts = ts + 273.15, Ta = ta + 273.15, hr = Math.abs(ts - ta) < 1e-6 ? 4 * eps * SIGMA * Ta ** 3 : (eps * SIGMA * (Ts ** 4 - Ta ** 4)) / (Ts - Ta);
  return { hc, hr, h: hc + hr };
}

/** Heat flow per metre [W/m] of a pipe of outside diameter D1 with insulation thickness s, solved for the surface temperature. */
export function lossPerMetre(D1: number, s: number, tm: number, ta: number, wind: number, mat: InsId, eps: number) {
  const D2 = D1 + 2 * s;
  let ts = ta + 0.2 * (tm - ta), q = 0, lam = lambdaOf(mat, (tm + ts) / 2), h = 10;
  for (let i = 0; i < 100; i++) {
    lam = lambdaOf(mat, (tm + ts) / 2);
    h = hOuter(D2, ts, ta, wind, s > 0 ? eps : EPS_BARE).h;
    const Rins = s > 0 ? Math.log(D2 / D1) / (2 * Math.PI * lam) : 0, Rsurf = 1 / (h * Math.PI * D2);
    q = (tm - ta) / (Rins + Rsurf);
    const tn = ta + q * Rsurf;
    if (Math.abs(tn - ts) < 1e-6) { ts = tn; break; }
    ts = ts + 0.6 * (tn - ts);
  }
  return { q, ts, lam, h, D2 };
}

export type InsIn = {
  dn: number;      // nominal size (index into PIPES via dn)
  tm: number;      // fluid temperature [°C]
  ta: number;      // ambient air [°C]
  rh: number;      // ambient relative humidity (0…1)
  mat: InsId;
  s: number;       // insulation thickness [m]
  clad: CladId;
  wind: number;    // air speed across the pipe [m/s] (0 indoors)
  L: number;       // pipe length [m]
  hours: number;   // operating hours per year
  price: number;   // price of the heat [per kWh]
};
export const T_TOUCH = 55; // °C, usual design limit of the outer surface for personnel protection

export function insulation(p: InsIn) {
  const pipe = PIPES.find((x) => x.dn === p.dn) ?? PIPES[5], D1 = pipe.od / 1000, eps = CLAD[p.clad].eps;
  const ins = lossPerMetre(D1, p.s, p.tm, p.ta, p.wind, p.mat, eps), bare = lossPerMetre(D1, 0, p.tm, p.ta, p.wind, p.mat, eps);
  const hot = p.tm > p.ta, m = INSUL[p.mat];
  const saving = 1 - ins.q / bare.q;
  const Q = Math.abs(ins.q) * p.L, E = (Q * p.hours) / 1000, Ebare = (Math.abs(bare.q) * p.L * p.hours) / 1000, cost = E * p.price, costSaved = (Ebare - E) * p.price;
  const rCrit = ins.lam / ins.h;                                         // critical insulation radius [m]
  let tdew = 0; { const pv = p.rh * pws(p.ta); let lo = -60, hi = 60; for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (pws(mid) < pv) lo = mid; else hi = mid; } tdew = (lo + hi) / 2; }
  // thinnest insulation meeting the surface criterion (touch for hot pipes, dew point + 1 K for cold ones), up to 300 mm
  const meets = (s: number) => { const r = lossPerMetre(D1, s, p.tm, p.ta, p.wind, p.mat, eps); return hot ? r.ts <= T_TOUCH : r.ts >= tdew + 1; };
  let sNeed = 0; if (!meets(0)) { let lo = 0, hi = 0.3; if (!meets(hi)) sNeed = Infinity; else { for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (meets(mid)) hi = mid; else lo = mid; } sNeed = hi; } }
  const vol = (Math.PI / 4) * (ins.D2 ** 2 - D1 ** 2) * p.L;
  const checks = [
    { ok: p.tm >= m.tmin && p.tm <= m.tmax, label: 'Fluid temperature inside the insulation’s service range', detail: `${p.tm.toFixed(0)} °C in ${m.tmin}…${m.tmax} °C (${m.name})` },
    hot
      ? { ok: ins.ts <= T_TOUCH, label: `Outer surface ≤ ${T_TOUCH} °C (safe to touch)`, detail: `θ_s = ${ins.ts.toFixed(1)} °C; thickness needed ${Number.isFinite(sNeed) ? (sNeed * 1000).toFixed(0) + ' mm' : 'over 300 mm'}` }
      : { ok: ins.ts >= tdew + 1, label: 'Outer surface above the dew point of the air (no condensation)', detail: `θ_s = ${ins.ts.toFixed(1)} °C, dew point ${tdew.toFixed(1)} °C; thickness needed ${Number.isFinite(sNeed) ? (sNeed * 1000).toFixed(0) + ' mm' : 'over 300 mm'}` },
    { ok: saving >= 0.8, label: 'Insulation cuts at least 80 % of the bare-pipe heat flow', detail: `${(saving * 100).toFixed(0)} % less than the bare pipe` },
    { ok: D1 / 2 >= rCrit || ins.q < bare.q, label: 'Pipe larger than the critical radius (insulating reduces the loss)', detail: `r_pipe = ${(D1 * 500).toFixed(1)} mm, r_crit = λ/h = ${(rCrit * 1000).toFixed(1)} mm` },
  ];
  return { pipe, D1, ...ins, bare, hot, saving, Q, E, Ebare, cost, costSaved, rCrit, tdew, sNeed, vol, eps, checks };
}
export type InsResult = ReturnType<typeof insulation>;

export const INS_INTRO = 'A hot pipe warms the room it runs through and a cold pipe drips with condensation. A layer of insulation adds a large resistance between the fluid and the air: the heat that gets through falls steeply with the first centimetres and less and less after that. The outer surface also sheds heat by radiation, so a shiny metal jacket runs warmer than a painted one but loses a little less.';

export const INS_NOTES = [
  'Steady heat flow per metre q = (θ_m − θ_a)/(ln(D₂/D₁)/(2πλ) + 1/(π D₂ h)), the resistances of the fluid film and the steel wall neglected (both are small). λ of the insulation at its mean temperature from typical declared curves; use the manufacturer’s values for design. The method follows EN ISO 12241 / VDI 2055 in outline; joints, supports, valves and flanges add losses not counted here.',
  'Outer coefficient h = h_c + h_r: natural convection on a horizontal cylinder (Churchill–Chu) combined with cross-flow convection (Churchill–Bernstein) as (Nu_n³ + Nu_f³)^⅓, radiation εσ(T_s⁴ − T_a⁴)/(T_s − T_a) to surroundings at the air temperature; air properties at the film temperature. The surface temperature is iterated. The bare pipe is taken as oxidised steel, ε = 0.8.',
  'Critical radius r_c = λ/h: below it, a thin insulation layer increases the heat flow of a small tube (more outer area). Touch limit 55 °C is a usual design value for personnel protection; cold pipes need the surface above the dew point of the surrounding air (with a vapour-tight insulation, such as elastomeric foam, to keep moisture out of the layer).',
];
