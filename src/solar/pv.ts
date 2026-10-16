/**
 * Monthly PV yield on a tilted surface from monthly-mean daily irradiation (Duffie & Beckman,
 * Solar Engineering of Thermal Processes, ch. 1–2): isotropic-sky model with the beam factor R̄_b
 * integrated over the month's average day, NOCT cell temperature, linear power temperature
 * coefficient, lumped system losses and inverter efficiency.
 * Angles in degrees unless named *Rad; irradiation in kWh/m²/day; power in W.
 */
import type { CityClimate } from './climateTR.ts';

const D2R = Math.PI / 180;
export const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** Klein's recommended average day of each month (day of year). */
export const AVG_DAY = [17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344];
export const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Solar declination (Cooper): δ = 23.45·sin(360·(284 + n)/365). */
export const declination = (n: number) => 23.45 * Math.sin(((360 * (284 + n)) / 365) * D2R);

/** Sunset hour angle ω_s = arccos(−tan φ·tan δ) [deg]. */
export const sunsetHourAngle = (lat: number, decl: number) => Math.acos(Math.max(-1, Math.min(1, -Math.tan(lat * D2R) * Math.tan(decl * D2R)))) / D2R;

/** cos θ of beam incidence on a surface (D&B eq. 1.6.2); γ: 0 = south, + west; ω: hour angle. */
export function cosIncidence(lat: number, decl: number, tilt: number, azim: number, omega: number) {
  const [f, d, b, g, w] = [lat, decl, tilt, azim, omega].map((x) => x * D2R);
  return Math.sin(d) * Math.sin(f) * Math.cos(b) - Math.sin(d) * Math.cos(f) * Math.sin(b) * Math.cos(g)
    + Math.cos(d) * Math.cos(f) * Math.cos(b) * Math.cos(w) + Math.cos(d) * Math.sin(f) * Math.sin(b) * Math.cos(g) * Math.cos(w)
    + Math.cos(d) * Math.sin(b) * Math.sin(g) * Math.sin(w);
}

/** R̄_b: ratio of daily beam on the tilted surface to horizontal, integrated over the day (any azimuth). */
export function beamRatio(lat: number, decl: number, tilt: number, azim: number, steps = 360) {
  const ws = sunsetHourAngle(lat, decl);
  let num = 0, den = 0;
  for (let i = 0; i < steps; i++) {
    const w = -ws + ((i + 0.5) * 2 * ws) / steps;
    const cz = cosIncidence(lat, decl, 0, 0, w);
    if (cz <= 0) continue;
    num += Math.max(cosIncidence(lat, decl, tilt, azim, w), 0);
    den += cz;
  }
  return den > 0 ? num / den : 0;
}

/** Closed form R̄_b for a surface facing the equator (northern hemisphere), D&B eq. 2.19.3. */
export function beamRatioSouth(lat: number, decl: number, tilt: number) {
  const ws = sunsetHourAngle(lat, decl), ws2 = Math.min(ws, sunsetHourAngle(lat - tilt, decl));
  const f = lat * D2R, fb = (lat - tilt) * D2R, d = decl * D2R;
  const num = Math.cos(fb) * Math.cos(d) * Math.sin(ws2 * D2R) + ws2 * D2R * Math.sin(fb) * Math.sin(d);
  const den = Math.cos(f) * Math.cos(d) * Math.sin(ws * D2R) + ws * D2R * Math.sin(f) * Math.sin(d);
  return num / den;
}

/** Isotropic sky: H_T = H_b·R̄_b + H_d·(1 + cos β)/2 + H·ρ_g·(1 − cos β)/2. */
export function tiltedIrradiation(H: number, Hd: number, Rb: number, tilt: number, albedo: number) {
  const c = Math.cos(tilt * D2R);
  const beam = Math.max(H - Hd, 0) * Rb, diffuse = (Hd * (1 + c)) / 2, ground = (H * albedo * (1 - c)) / 2;
  return { beam, diffuse, ground, HT: beam + diffuse + ground };
}

/** Energy-weighted mean irradiance over a half-sine day is π²/8 × the daylight mean. */
export const ENERGY_WEIGHT = (Math.PI * Math.PI) / 8;

/** NOCT cell temperature: T_c = T_a + (NOCT − 20)/800·G. */
export const cellTemp = (Ta: number, G: number, noct: number) => Ta + ((noct - 20) / 800) * G;

export type PanelType = { id: string; name: string; eta: number; gammaP: number; noct: number; note: string };

/** Typical datasheet values (rounded, current mass-market modules). */
export const PANEL_TYPES: PanelType[] = [
  { id: 'poly', name: 'Polycrystalline', eta: 0.17, gammaP: -0.4, noct: 45, note: 'cheapest, older technology' },
  { id: 'perc', name: 'Mono PERC', eta: 0.21, gammaP: -0.35, noct: 44, note: 'most common today' },
  { id: 'topcon', name: 'n-type TOPCon', eta: 0.225, gammaP: -0.3, noct: 43, note: 'higher efficiency, less heat loss' },
  { id: 'hjt', name: 'Heterojunction (HJT)', eta: 0.225, gammaP: -0.26, noct: 43, note: 'best in hot climates' },
  { id: 'cdte', name: 'Thin film CdTe', eta: 0.18, gammaP: -0.28, noct: 45, note: 'large areas, utility plants' },
];

export type PvIn = {
  city: CityClimate;
  nPanels: number;
  panelW: number; // rated power per panel at STC [W]
  panel: PanelType;
  tilt: number; // [deg]
  azim: number; // [deg] 0 = south, −90 = east, +90 = west
  albedo?: number; // ground reflectance, default 0.2
  losses?: number; // soiling, wiring, mismatch, ageing … default 0.10
  etaInv?: number; // inverter efficiency, default 0.96
};

export function pvMonthly(p: PvIn) {
  const albedo = p.albedo ?? 0.2, losses = p.losses ?? 0.1, etaInv = p.etaInv ?? 0.96;
  const Pstc = (p.nPanels * p.panelW) / 1000; // kWp
  const lat = p.city.lat;
  const months = p.city.ghi.map((H, m) => {
    const Hd = Math.min(p.city.dhi[m], H);
    const decl = declination(AVG_DAY[m]);
    const Rb = beamRatio(lat, decl, p.tilt, p.azim);
    const t = tiltedIrradiation(H, Hd, Rb, p.tilt, albedo);
    const dayLength = (2 * sunsetHourAngle(lat, decl)) / 15; // h
    const Gmean = (t.HT * 1000) / dayLength; // W/m², daylight mean on the panel
    const Tc = cellTemp(p.city.t2m[m], ENERGY_WEIGHT * Gmean, p.panel.noct);
    const fT = 1 + (p.panel.gammaP / 100) * (Tc - 25);
    const dc = Pstc * t.HT * fT * (1 - losses) * DAYS[m]; // kWh
    return { m, H, Hd, decl, Rb, ...t, dayLength, Gmean, Tc, fT, dc, ac: dc * etaInv };
  });
  const sum = (k: 'H' | 'HT' | 'ac' | 'dc') => months.reduce((a, x) => a + x[k] * (k === 'H' || k === 'HT' ? DAYS[x.m] : 1), 0);
  const annualH = sum('H'), annualHT = sum('HT'), annualAC = sum('ac');
  const area = (p.nPanels * p.panelW) / (1000 * p.panel.eta);
  return {
    months, Pstc, area, annualH, annualHT, annualAC,
    specificYield: Pstc > 0 ? annualAC / Pstc : 0, // kWh/kWp
    PR: annualHT > 0 && Pstc > 0 ? annualAC / (Pstc * annualHT) : 0, // performance ratio
    etaInv, losses, albedo,
  };
}

/** Annual tilted irradiation for tilt 0…90° (for the "best tilt" curve). */
/** Tilt with the most yearly irradiation on the panel (same 5° grid as tiltSweep), as a generator that yields
 *  after each tilt so a background scan (slider pass ranges) never blocks the screen for long. */
export function* bestTiltGen(city: CityClimate, azim: number, albedo = 0.2, step = 5): Generator<unknown, number, unknown> {
  let best = { tilt: 0, HT: -Infinity };
  for (let tilt = 0; tilt <= 90; tilt += step) {
    const HT = tiltSweepAt(city, azim, tilt, albedo);
    if (HT > best.HT) best = { tilt, HT };
    yield;
  }
  return best.tilt;
}

function tiltSweepAt(city: CityClimate, azim: number, tilt: number, albedo: number) {
  let HT = 0;
  city.ghi.forEach((H, m) => {
    const decl = declination(AVG_DAY[m]);
    HT += tiltedIrradiation(H, Math.min(city.dhi[m], H), beamRatio(city.lat, decl, tilt, azim, 120), tilt, albedo).HT * DAYS[m];
  });
  return HT;
}

export function tiltSweep(city: CityClimate, azim: number, albedo = 0.2, step = 5) {
  const out: { tilt: number; HT: number }[] = [];
  for (let tilt = 0; tilt <= 90; tilt += step) out.push({ tilt, HT: tiltSweepAt(city, azim, tilt, albedo) });
  return out;
}

/** Noon sun altitude α = 90° − |φ − δ|. */
export const noonAltitude = (lat: number, decl: number) => 90 - Math.abs(lat - decl);

export const SOLAR_ASSUMPTIONS =
  'Monthly method after Duffie & Beckman: average day of each month (Klein), beam factor R̄_b integrated over that day, isotropic diffuse sky, ground albedo 0.2. ' +
  'Irradiation and air temperature: NASA POWER long-term monthly means for the province centre (data bundled, works offline). ' +
  'Cell temperature from NOCT with the energy-weighted daylight irradiance (π²/8 × daylight mean, half-sine day); power falls linearly with the panel temperature coefficient. ' +
  'No shading, snow, angle-of-incidence or low-light losses; other losses (soiling, wiring, mismatch, ageing) lumped as set; inverter efficiency constant. ' +
  'Panel efficiencies and coefficients are typical datasheet values, not a specific product. Expect ±10 % against a detailed tool such as PVGIS.';
