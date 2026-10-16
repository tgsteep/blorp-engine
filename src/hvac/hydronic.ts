/**
 * Hydronic heating pipe sizing: water flow from the heat load and the supply/return temperature difference,
 * smallest pipe of a series (steel EN 10255, copper EN 1057, PE-X/multilayer) meeting a velocity and a
 * pressure-gradient limit, Darcy–Weisbach with Colebrook, fittings as a share of the pipe friction,
 * circulation pump head and power. SI units.
 */
import { frictionFactor, G, waterDensity, waterViscosity } from '../fluids/pipe.ts';

export type Series = 'steel' | 'copper' | 'pex';
/** Pipe series: label, inside diameter [mm]; roughness [mm]. */
export const SERIES: Record<Series, { name: string; eps: number; sizes: { label: string; di: number; od: number }[] }> = {
  steel: { name: 'Steel EN 10255 medium', eps: 0.045, sizes: [
    { label: 'DN15', di: 16.1, od: 21.3 }, { label: 'DN20', di: 21.7, od: 26.9 }, { label: 'DN25', di: 27.3, od: 33.7 }, { label: 'DN32', di: 36.0, od: 42.4 },
    { label: 'DN40', di: 41.9, od: 48.3 }, { label: 'DN50', di: 53.1, od: 60.3 }, { label: 'DN65', di: 68.9, od: 76.1 }, { label: 'DN80', di: 80.9, od: 88.9 }, { label: 'DN100', di: 105.3, od: 114.3 }] },
  copper: { name: 'Copper EN 1057', eps: 0.0015, sizes: [
    { label: '15 × 1', di: 13, od: 15 }, { label: '18 × 1', di: 16, od: 18 }, { label: '22 × 1', di: 20, od: 22 }, { label: '28 × 1', di: 26, od: 28 }, { label: '35 × 1.2', di: 32.6, od: 35 },
    { label: '42 × 1.2', di: 39.6, od: 42 }, { label: '54 × 1.5', di: 51, od: 54 }, { label: '76.1 × 2', di: 72.1, od: 76.1 }, { label: '108 × 2.5', di: 103, od: 108 }] },
  pex: { name: 'PE-X / multilayer', eps: 0.007, sizes: [
    { label: '16 × 2', di: 12, od: 16 }, { label: '20 × 2', di: 16, od: 20 }, { label: '26 × 3', di: 20, od: 26 }, { label: '32 × 3', di: 26, od: 32 }, { label: '40 × 3.5', di: 33, od: 40 },
    { label: '50 × 4', di: 42, od: 50 }, { label: '63 × 4.5', di: 54, od: 63 }] },
};

export type HUse = 'home' | 'building';
export const HUSES: Record<HUse, { name: string; vmax: number; Rmax: number; Hmax: number }> = {
  home: { name: 'Home (quiet, small circulator)', vmax: 0.7, Rmax: 150, Hmax: 6 },
  building: { name: 'Larger building (main pipes)', vmax: 1.5, Rmax: 250, Hmax: 15 },
};
export const CP_W = 4190; // J/(kg·K)

export type HydIn = {
  Q: number;       // heat load [kW]
  ts: number;      // supply temperature [°C]
  dT: number;      // supply − return [K]
  series: Series;
  L: number;       // pipe length of the index circuit, supply + return [m]
  z: number;       // fittings and valves as a share of the pipe friction (0.3 = 30 %)
  dpComp: number;  // boiler/heat pump, emitter, control valve [kPa]
  use: HUse;
  eta: number;     // pump wire-to-water efficiency
};

export function pipeFlow(mDot: number, diMm: number, eps: number, T: number) {
  const rho = waterDensity(T), mu = waterViscosity(T), d = diMm / 1000, A = (Math.PI / 4) * d * d;
  const v = mDot / (rho * A), Re = (rho * v * d) / mu, f = frictionFactor(Re, eps / 1000 / d);
  return { v, Re, f, R: (f / d) * 0.5 * rho * v * v, A };
}

export function hydronic(p: HydIn) {
  const tr = p.ts - p.dT, tm = (p.ts + tr) / 2, rho = waterDensity(tm);
  const mDot = (p.Q * 1000) / (CP_W * p.dT), Vh = (mDot / rho) * 3600;   // kg/s, m³/h
  const s = SERIES[p.series], u = HUSES[p.use];
  const ok = (di: number) => { const f = pipeFlow(mDot, di, s.eps, tm); return f.v <= u.vmax && f.R <= u.Rmax; };
  const pick = s.sizes.find((x) => ok(x.di)) ?? s.sizes[s.sizes.length - 1];
  const fl = pipeFlow(mDot, pick.di, s.eps, tm);
  const dpPipe = fl.R * p.L, dpFit = p.z * dpPipe, dpTot = dpPipe + dpFit + p.dpComp * 1000;
  const H = dpTot / (rho * G), Phyd = (mDot / rho) * dpTot, Pel = Phyd / p.eta;
  const vol = fl.A * p.L * 1000;  // litres in the pipe
  const checks = [
    { ok: fl.v <= u.vmax, label: 'Water velocity within the limit (noise, erosion)', detail: `v = ${fl.v.toFixed(2)} m/s ≤ ${u.vmax} m/s` },
    { ok: fl.R <= u.Rmax, label: 'Pressure gradient within the limit', detail: `R = ${fl.R.toFixed(0)} Pa/m ≤ ${u.Rmax} Pa/m` },
    { ok: fl.v >= 0.2, label: 'Velocity ≥ 0.2 m/s (carries air bubbles to the vents)', detail: `v = ${fl.v.toFixed(2)} m/s` },
    { ok: H <= u.Hmax, label: 'Pump head within a usual pump for the use', detail: `H = ${H.toFixed(2)} m ≤ ${u.Hmax} m` },
    { ok: tr <= 55, label: 'Return ≤ 55 °C (a gas boiler condenses; a heat pump wants it lower)', detail: `return ${tr.toFixed(0)} °C` },
    { ok: ok(pick.di), label: 'A pipe in the series meets both limits', detail: `${s.name}, ${pick.label}` },
  ];
  return { tr, tm, rho, mDot, Vh, pick, ...fl, dpPipe, dpFit, dpTot, H, Phyd, Pel, vol, checks };
}
export type HydResult = ReturnType<typeof hydronic>;

export const HYD_INTRO = 'Water carries heat from the boiler or heat pump to the radiators: every kilogram that cools by ΔT gives up 4.19 kJ per kelvin. A small temperature drop — typical for heat pumps — means much more water and thicker pipes. Friction in the pipes grows about with the square of the speed, and the circulation pump must push the water round against it.';

export const HYD_NOTES = [
  'Flow ṁ = Q/(c_p ΔT) with c_p = 4.19 kJ/(kg·K), water density and viscosity at the mean temperature. Darcy–Weisbach with Colebrook; roughness steel 0.045 mm, copper 0.0015 mm, PE-X 0.007 mm. Pipe inside diameters from the EN 10255 (medium), EN 1057 and common PE-X/multilayer series — check the manufacturer’s table.',
  'Sizing: the smallest size of the series whose velocity and pressure gradient stay within the limits (homes 0.7 m/s and 150 Pa/m, larger buildings 1.5 m/s and 250 Pa/m — usual design guidance). Fittings, valves and bends taken as a share of the straight-pipe friction (often 30…50 %); boiler, emitter and control valve as one pressure drop.',
  'Pump: head H = Δp/(ρg) for the index (longest) circuit, hydraulic power V̇ Δp, electric power with a wire-to-water efficiency (small circulators 0.2…0.5). Branches, balancing and the pump curve are not modelled.',
];
