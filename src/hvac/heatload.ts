/**
 * Room heat load, quick estimate:
 *  - heating (EN 12831 simplified): transmission Σ U A ΔT through exterior walls (with a thermal-bridge allowance),
 *    window, roof and floor (ground floor with a temperature factor), plus ventilation 0.34 n V ΔT;
 *  - cooling (ASHRAE-style peak hour, simplified): walls and roof with a sol-air temperature allowance per
 *    orientation, window conduction and solar gain SHGC A I, people, lights, equipment, and outdoor air sensible and
 *    latent (moist-air properties from psychro.ts).
 * Footprint L (east–west) × B (north–south); north and south walls are L long, east and west walls B long.
 * Units: m, m², W/(m²K), °C, W.
 */
import { humidityRatio, pressureAt, pwsMoist, specificVolume } from './psychro.ts';

export type Check = { ok: boolean; label: string; detail: string };
export type Orientation = 'N' | 'E' | 'S' | 'W';
export const ORIENTS: Orientation[] = ['N', 'E', 'S', 'W'];
export const OR_NAME: Record<Orientation, string> = { N: 'north', E: 'east', S: 'south', W: 'west' };

export type LoadIn = {
  L: number; B: number; H: number; // footprint east–west, north–south, room height [m]
  ext: Orientation[]; // exterior walls
  winOr: Orientation; Awin: number; // window wall and glazed area [m²]
  Uwall: number; Uwin: number; Uroof: number; Ufloor: number;
  roof: boolean; ground: boolean; // roof above is outside; floor is on the ground (else heated rooms around)
  tiW: number; teW: number; // winter design indoor / outdoor [°C]
  tiS: number; teS: number; phiS: number; phiIn: number; // summer design indoor / outdoor, outdoor and indoor RH (0…1)
  ach: number; // outdoor air changes per hour (ventilation + infiltration)
  people: number; lights: number; equip: number; // persons, W/m², W
  shgc: number; shade: number; // solar heat gain coefficient of the glazing, shading factor (1 = none)
  altitude: number; // m, for the air density in the latent load
};

/** Allowance on the outdoor temperature for sunlit opaque surfaces at the summer peak [K] (medium-weight wall, dark roof). */
export const SOLAIR: Record<Orientation | 'roof', number> = { N: 3, E: 7, S: 6, W: 9, roof: 18 };
/** Peak solar irradiance on the glass on a clear July day at about 40° N [W/m²] (direct + diffuse, rounded). */
export const IRRAD: Record<Orientation, number> = { N: 130, E: 600, S: 350, W: 600 };
export const THERMAL_BRIDGE = 0.05; // W/(m²K) added to the wall U-value (EN 12831 simplified default)
export const GROUND_FACTOR = 0.5; // ground floor: the ground is warmer than the outdoor design temperature
export const PERSON = { sensible: 75, latent: 55 }; // W, seated office work (ASHRAE Fundamentals ch. 18)

export const wallLength = (p: LoadIn, o: Orientation) => (o === 'N' || o === 'S' ? p.L : p.B);
export type Part = { key: string; label: string; W: number; kind: 'sensible' | 'latent' };

export function heatLoad(p: LoadIn) {
  const A = p.L * p.B, V = A * p.H, dW = p.tiW - p.teW, dS = p.teS - p.tiS;
  const winOnExt = p.ext.includes(p.winOr);
  const wallArea = (o: Orientation) => Math.max(wallLength(p, o) * p.H - (o === p.winOr && winOnExt ? p.Awin : 0), 0);
  const Aw = winOnExt ? p.Awin : 0;
  // heating
  const heat: Part[] = [];
  for (const o of p.ext) heat.push({ key: `wall${o}`, label: `${OR_NAME[o]} wall`, W: (p.Uwall + THERMAL_BRIDGE) * wallArea(o) * dW, kind: 'sensible' });
  if (Aw > 0) heat.push({ key: 'win', label: 'window', W: p.Uwin * Aw * dW, kind: 'sensible' });
  if (p.roof) heat.push({ key: 'roof', label: 'roof', W: p.Uroof * A * dW, kind: 'sensible' });
  if (p.ground) heat.push({ key: 'floor', label: 'floor on ground', W: p.Ufloor * A * dW * GROUND_FACTOR, kind: 'sensible' });
  heat.push({ key: 'vent', label: 'ventilation', W: 0.34 * p.ach * V * dW, kind: 'sensible' });
  const PhiT = heat.filter((x) => x.key !== 'vent').reduce((s, x) => s + x.W, 0), PhiV = 0.34 * p.ach * V * dW, Phi = PhiT + PhiV;
  // cooling
  const P = pressureAt(p.altitude), Wo = humidityRatio(p.phiS * pwsMoist(p.teS, P), P), Wi = humidityRatio(p.phiIn * pwsMoist(p.tiS, P), P);
  const ma = (p.ach * V) / 3600 / specificVolume(p.teS, Wo, P); // kg/s dry air
  const cool: Part[] = [];
  for (const o of p.ext) cool.push({ key: `wall${o}`, label: `${OR_NAME[o]} wall`, W: (p.Uwall + THERMAL_BRIDGE) * wallArea(o) * (dS + SOLAIR[o]), kind: 'sensible' });
  if (Aw > 0) {
    cool.push({ key: 'winC', label: 'window conduction', W: p.Uwin * Aw * dS, kind: 'sensible' });
    cool.push({ key: 'sun', label: 'sun through the window', W: p.shgc * Aw * IRRAD[p.winOr] * p.shade, kind: 'sensible' });
  }
  if (p.roof) cool.push({ key: 'roof', label: 'roof', W: p.Uroof * A * (dS + SOLAIR.roof), kind: 'sensible' });
  cool.push({ key: 'people', label: 'people', W: p.people * PERSON.sensible, kind: 'sensible' });
  cool.push({ key: 'lights', label: 'lights', W: p.lights * A, kind: 'sensible' });
  cool.push({ key: 'equip', label: 'equipment', W: p.equip, kind: 'sensible' });
  cool.push({ key: 'ventS', label: 'outdoor air, sensible', W: 0.34 * p.ach * V * dS, kind: 'sensible' });
  cool.push({ key: 'peopleL', label: 'people, moisture', W: p.people * PERSON.latent, kind: 'latent' });
  cool.push({ key: 'ventL', label: 'outdoor air, moisture', W: Math.max(ma * (Wo - Wi) * 2501e3, 0), kind: 'latent' });
  const Qs = cool.filter((x) => x.kind === 'sensible').reduce((s, x) => s + x.W, 0), Ql = cool.filter((x) => x.kind === 'latent').reduce((s, x) => s + x.W, 0), Q = Qs + Ql;
  const facade = winOnExt ? wallLength(p, p.winOr) * p.H : 0;
  const checks: Check[] = [
    { ok: p.Uwall <= 0.4, label: 'Wall U-value within a typical current limit (≤ 0.40 W/m²K)', detail: `U = ${p.Uwall.toFixed(2)} W/m²K` },
    { ok: p.Uwin <= 1.8, label: 'Window U-value within a typical current limit (≤ 1.8 W/m²K)', detail: `U = ${p.Uwin.toFixed(2)} W/m²K` },
    { ok: !p.roof || p.Uroof <= 0.3, label: 'Roof U-value within a typical current limit (≤ 0.30 W/m²K)', detail: p.roof ? `U = ${p.Uroof.toFixed(2)} W/m²K` : 'no roof above' },
    { ok: Phi / A <= 80, label: 'Specific heating load ≤ 80 W/m² (well-insulated room)', detail: `${(Phi / A).toFixed(0)} W/m²` },
    { ok: Q / A <= 100, label: 'Specific cooling load ≤ 100 W/m²', detail: `${(Q / A).toFixed(0)} W/m²` },
    { ok: !winOnExt || p.Awin / facade <= 0.4, label: 'Window ≤ 40 % of its wall (overheating, heat loss)', detail: winOnExt ? `${((p.Awin / facade) * 100).toFixed(0)} %` : 'window on an inner wall' },
    { ok: winOnExt, label: 'Window on an exterior wall', detail: winOnExt ? `${OR_NAME[p.winOr]} wall` : 'move it to an exterior wall' },
  ];
  return { A, V, heat, PhiT, PhiV, Phi, cool, Qs, Ql, Q, SHR: Qs / Q, Wo, Wi, ma, P, unit: Q * 1.1, checks };
}
export type LoadResult = ReturnType<typeof heatLoad>;

export const LOAD_INTRO = 'In winter a room loses heat through every outside surface and with every litre of cold air that comes in; the heater must replace it at the coldest design hour. In summer the same surfaces, the sun through the window, people, lights and equipment heat the room, and humid outdoor air adds moisture the cooler must remove.';

export const LOAD_NOTES = [
  'Heating, EN 12831 simplified: Φ_T = Σ U A (θ_int − θ_e) for exterior walls (U + 0.05 W/m²K thermal-bridge allowance), window, roof and ground floor (× 0.5 because the ground is warmer than the outdoor design temperature); ventilation Φ_V = 0.34 n V (θ_int − θ_e) with 0.34 Wh/(m³K) = ρ c_p of air. No heat-up allowance, no adjacent rooms at other temperatures, no internal gains in winter.',
  'Cooling, simplified peak-hour estimate in the ASHRAE style (not the RTS or CLTD method in full): opaque walls and roof with the outdoor-indoor difference plus a sol-air allowance (N 3, E 7, S 6, W 9, dark roof 18 K), window conduction U A ΔT plus solar gain SHGC · A · I · shading with clear-sky July peak irradiances at about 40° N (N 130, E 600, S 350, W 600 W/m²); all peaks are added as if they happened at the same hour, which overestimates a little. People 75 W sensible + 55 W latent each, lights and equipment fully sensible, outdoor air sensible 0.34 n V ΔT and latent ṁ (W_out − W_in) · 2501 kJ/kg (moist air from the psychrometrics page). Unit size = 1.1 × total.',
  'U-value limits are typical of current energy codes (e.g. the colder zones of TS 825 and many EU codes); your local code and climate zone decide. Design temperatures depend on the city (e.g. −3 °C Istanbul, −12 °C Ankara in winter).',
];
