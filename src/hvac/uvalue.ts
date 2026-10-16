/**
 * U-value of a wall built from layers (EN ISO 6946), temperatures through the wall, interior surface condensation
 * and mould risk (EN ISO 13788 temperature factor) and interstitial condensation by the Glaser method for one
 * design condition, yearly heat loss from degree-days. SI units.
 */
import { pws } from './psychro.ts';

export type MatId = 'gypsum' | 'board' | 'render' | 'brick' | 'hollow' | 'aac' | 'concrete' | 'eps' | 'xps' | 'mw' | 'pir' | 'osb' | 'fibre' | 'air' | 'vb';
/** Typical design values in the style of EN ISO 10456: conductivity λ [W/(m·K)], vapour resistance factor μ, density ρ [kg/m³]. */
export const MATS: Record<MatId, { name: string; lambda: number; mu: number; rho: number; color: string; ins?: boolean }> = {
  gypsum: { name: 'Gypsum plaster', lambda: 0.4, mu: 10, rho: 1000, color: '#EDE7DA' },
  board: { name: 'Gypsum board', lambda: 0.25, mu: 8, rho: 900, color: '#F2EFE8' },
  render: { name: 'Cement-lime render', lambda: 0.87, mu: 20, rho: 1800, color: '#D9D2C3' },
  brick: { name: 'Solid clay brick', lambda: 0.77, mu: 10, rho: 1800, color: '#B5543A' },
  hollow: { name: 'Hollow clay block', lambda: 0.45, mu: 5, rho: 900, color: '#C46A4A' },
  aac: { name: 'Aerated concrete block', lambda: 0.14, mu: 8, rho: 500, color: '#E4E1DA' },
  concrete: { name: 'Reinforced concrete', lambda: 2.3, mu: 100, rho: 2400, color: '#A9AAA6' },
  eps: { name: 'EPS (expanded polystyrene)', lambda: 0.035, mu: 60, rho: 20, color: '#F7F7F2', ins: true },
  xps: { name: 'XPS (extruded polystyrene)', lambda: 0.033, mu: 150, rho: 35, color: '#9FC5E8', ins: true },
  mw: { name: 'Mineral wool', lambda: 0.035, mu: 1, rho: 60, color: '#E8D27A', ins: true },
  pir: { name: 'PIR board', lambda: 0.023, mu: 60, rho: 32, color: '#F3E3B5', ins: true },
  osb: { name: 'OSB board', lambda: 0.13, mu: 50, rho: 600, color: '#D7B06A' },
  fibre: { name: 'Wood fibre board', lambda: 0.045, mu: 5, rho: 160, color: '#B98E58' },
  air: { name: 'Unventilated air layer', lambda: 0, mu: 1, rho: 1.2, color: '#FFFFFF' },
  vb: { name: 'Vapour barrier (PE foil)', lambda: 0.33, mu: 100000, rho: 950, color: '#5C6BC0' },
};
export const INS: MatId[] = ['eps', 'xps', 'mw', 'pir'];

export type Layer = { mat: MatId; d: number; role?: 'main' | 'ins' | 'vb' }; // d [m]
export type WallId = 'etics' | 'concrete' | 'timber' | 'aac' | 'cavity';
/** Wall build-ups from inside to outside; 'main' and 'ins' layers take their thickness (and insulation material) from the inputs. */
export const WALLS: Record<WallId, { name: string; layers: Layer[]; main: [number, number, number]; ins: number; insMat: MatId }> = {
  etics: { name: 'Brick + external insulation', layers: [{ mat: 'gypsum', d: 0.015 }, { mat: 'hollow', d: 0.19, role: 'main' }, { mat: 'eps', d: 0.08, role: 'ins' }, { mat: 'render', d: 0.008 }], main: [0.085, 0.3, 0.19], ins: 0.08, insMat: 'eps' },
  concrete: { name: 'Concrete + XPS', layers: [{ mat: 'gypsum', d: 0.015 }, { mat: 'concrete', d: 0.2, role: 'main' }, { mat: 'xps', d: 0.06, role: 'ins' }, { mat: 'render', d: 0.008 }], main: [0.15, 0.4, 0.2], ins: 0.06, insMat: 'xps' },
  timber: { name: 'Timber frame', layers: [{ mat: 'board', d: 0.0125 }, { mat: 'vb', d: 0.0002, role: 'vb' }, { mat: 'mw', d: 0.16, role: 'ins' }, { mat: 'osb', d: 0.015, role: 'main' }, { mat: 'fibre', d: 0.06 }, { mat: 'render', d: 0.008 }], main: [0.012, 0.025, 0.015], ins: 0.16, insMat: 'mw' },
  aac: { name: 'Aerated concrete block', layers: [{ mat: 'gypsum', d: 0.015 }, { mat: 'aac', d: 0.25, role: 'main' }, { mat: 'eps', d: 0, role: 'ins' }, { mat: 'render', d: 0.015 }], main: [0.15, 0.5, 0.25], ins: 0, insMat: 'eps' },
  cavity: { name: 'Cavity wall', layers: [{ mat: 'gypsum', d: 0.015 }, { mat: 'brick', d: 0.115, role: 'main' }, { mat: 'mw', d: 0.1, role: 'ins' }, { mat: 'air', d: 0.04 }, { mat: 'brick', d: 0.115 }], main: [0.1, 0.25, 0.115], ins: 0.1, insMat: 'mw' },
};

export const RSI = 0.13, RSE = 0.04;      // surface resistances, horizontal heat flow [m²K/W] (EN ISO 6946 Table 7)
export const R_AIR = 0.18;                // unventilated air layer ≥ 25 mm, horizontal heat flow (EN ISO 6946 Table 8)
export const DELTA0 = 2e-10;              // vapour permeability of still air [kg/(m·s·Pa)]

export type UIn = {
  wall: WallId;
  main: number;    // thickness of the main (load-bearing) layer [m]
  ins: number;     // insulation thickness [m]
  insMat: MatId;
  vb: boolean;     // vapour barrier present (timber frame)
  ti: number;      // indoor temperature [°C]
  rhi: number;     // indoor relative humidity (0…1)
  te: number;      // outdoor design temperature [°C]
  rhe: number;     // outdoor relative humidity (0…1)
  Utarget: number; // required U [W/(m²K)]
  A: number;       // wall area [m²]
  hdd: number;     // heating degree-days [K·d]
};

export const layerR = (l: Layer) => (l.mat === 'air' ? (l.d >= 0.025 ? R_AIR : (R_AIR * l.d) / 0.025) : l.d / MATS[l.mat].lambda);

export function buildLayers(p: UIn): Layer[] {
  return WALLS[p.wall].layers
    .map((l) => (l.role === 'main' ? { ...l, d: p.main } : l.role === 'ins' ? { ...l, d: p.ins, mat: p.insMat } : l))
    .filter((l) => l.d > 0 && !(l.role === 'vb' && !p.vb));
}

export function uvalue(p: UIn) {
  const layers = buildLayers(p);
  const R = layers.map(layerR), Rt = RSI + R.reduce((a, b) => a + b, 0) + RSE, U = 1 / Rt;
  const dT = p.ti - p.te;
  // interface temperatures: indoor air, inner surface, after each layer (last = outer surface), outdoor air
  const x: number[] = [0], th: number[] = [];
  let acc = RSI;
  th.push(p.ti - dT * (RSI / Rt));
  layers.forEach((l, i) => { acc += R[i]; x.push(x[i] + l.d); th.push(p.ti - dT * (acc / Rt)); });
  const tsi = th[0], tse = th[th.length - 1];
  // vapour: s_d = μ d, linear pressure in s_d between indoor and outdoor partial pressures (surface resistances neglected)
  const sd = layers.map((l) => MATS[l.mat].mu * l.d), sdT = sd.reduce((a, b) => a + b, 0);
  const pi = p.rhi * pws(p.ti) * 1000, pe = p.rhe * pws(p.te) * 1000;   // Pa (pws in kPa)
  const sdx: number[] = [0]; sd.forEach((s, i) => sdx.push(sdx[i] + s));
  const pv = sdx.map((s) => pi - ((pi - pe) * s) / Math.max(sdT, 1e-9));
  const psat = th.map((t) => pws(t) * 1000);
  // Glaser, one plane: at each interface where the straight line exceeds saturation, the net flow into it; the worst one
  let gc = 0, plane = -1;
  for (let i = 1; i < th.length - 1; i++) {
    if (pv[i] <= psat[i]) continue;
    const zi = Math.max(sdx[i], 1e-6), ze = Math.max(sdT - sdx[i], 1e-6);
    const g = DELTA0 * ((pi - psat[i]) / zi - (psat[i] - pe) / ze);   // kg/(m²·s)
    if (g > gc) { gc = g; plane = i; }
  }
  // mould: surface relative humidity ≤ 80 % → minimum surface temperature and temperature factor (EN ISO 13788)
  const psatMin = pi / 0.8;
  let tsMin = -20; { let lo = -40, hi = 40; for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (pws(m) * 1000 < psatMin) lo = m; else hi = m; } tsMin = (lo + hi) / 2; }
  const fRsi = (tsi - p.te) / dT, fRsiMin = (tsMin - p.te) / dT;
  let tdew = 0; { let lo = -40, hi = 40; for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (pws(m) * 1000 < pi) lo = m; else hi = m; } tdew = (lo + hi) / 2; }
  const Q = U * p.A * dT, Eyear = (U * p.A * p.hdd * 24) / 1000;   // W, kWh/year
  const mass = layers.reduce((a, l) => a + MATS[l.mat].rho * l.d, 0), thick = x[x.length - 1];
  const insL = layers.find((l) => l.role === 'ins');
  // insulation thickness that would just meet the target with this insulation material
  const Rother = Rt - (insL ? layerR(insL) : 0), dNeed = Math.max(0, (1 / p.Utarget - Rother) * MATS[p.insMat].lambda);
  const checks = [
    { ok: U <= p.Utarget + 1e-9, label: 'U-value at most the required value', detail: `U = ${U.toFixed(3)} ≤ ${p.Utarget.toFixed(2)} W/(m²K); insulation needed ${(dNeed * 1000).toFixed(0)} mm` },
    { ok: fRsi >= fRsiMin, label: 'No mould on the inner surface (surface humidity ≤ 80 %, EN ISO 13788)', detail: `f_Rsi = ${fRsi.toFixed(3)} ≥ ${fRsiMin.toFixed(3)}; θ_si = ${tsi.toFixed(1)} °C ≥ ${tsMin.toFixed(1)} °C` },
    { ok: gc <= 0, label: 'No condensation inside the wall at the design condition (Glaser)', detail: gc > 0 ? `${(gc * 86400 * 1000).toFixed(1)} g/(m²·day) at the face ${plane}` : 'vapour pressure below saturation everywhere' },
    { ok: tsi >= tdew, label: 'Inner surface above the dew point of the room air', detail: `θ_si = ${tsi.toFixed(1)} °C, dew point ${tdew.toFixed(1)} °C` },
  ];
  return { layers, R, Rt, U, x, th, tsi, tse, sd, sdT, sdx, pi, pe, pv, psat, gc, plane, tsMin, fRsi, fRsiMin, tdew, Q, Eyear, mass, thick, dNeed, checks };
}
export type UResult = ReturnType<typeof uvalue>;

export const U_INTRO = 'Heat flows through a wall from the warm side to the cold side, and every layer resists it: its resistance is its thickness divided by its conductivity. Add the resistances, turn the sum upside down and you have the U-value — the watts lost per square metre for each degree of difference. A thin layer of insulation does more than a thick layer of brick. Water vapour also travels outwards; where it meets a layer cold enough it condenses, so dense layers belong on the warm side.';

export const U_NOTES = [
  'EN ISO 6946: R_T = R_si + Σ d/λ + R_se with R_si = 0.13 and R_se = 0.04 m²K/W (horizontal heat flow), an unventilated air layer ≥ 25 mm as R = 0.18 m²K/W. Layers are taken as uniform: studs, mortar joints, wall ties and fixings (thermal bridges, typically +0.02…0.1 W/(m²K)) are not included. Material values are typical design values in the style of EN ISO 10456 — use the manufacturer’s declared λ.',
  'Moisture: inner-surface mould criterion of EN ISO 13788 (surface relative humidity ≤ 80 %), temperature factor f_Rsi = (θ_si − θ_e)/(θ_i − θ_e). Interstitial condensation by Glaser for one steady design condition: vapour pressure straight in the equivalent air thickness s_d = μ d between the indoor and outdoor partial pressures; where it exceeds saturation, the flow into that face δ₀(Δp_in/Z_in − Δp_out/Z_out) with δ₀ = 2·10⁻¹⁰ kg/(m·s·Pa). The full standard checks the yearly balance month by month (condensate that dries out in summer can be acceptable).',
  'Heat loss Q = U A (θ_i − θ_e) at the design temperature; yearly energy U A × degree-days × 24 h. Required U-values depend on the country and climate zone (for example 0.2…0.6 W/(m²K) for new walls in Europe) — set the target to your regulation.',
];
