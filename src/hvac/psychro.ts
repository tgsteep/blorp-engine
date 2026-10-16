/**
 * Moist air (psychrometrics) after ASHRAE Handbook — Fundamentals (2017), chapter 1:
 * saturation pressure of water vapour by Hyland–Wexler (eq. 5 over ice, eq. 6 over water) with the enhancement factor of
 * moist air (Buck), humidity ratio (eq. 20/22),
 * enthalpy (eq. 32), specific volume (eq. 26), dew point, thermodynamic wet bulb (eq. 33/35), pressure at altitude (eq. 3);
 * air-conditioning processes: sensible heating or cooling, cooling and dehumidifying coil (apparatus dew point and
 * bypass factor), adiabatic mixing of two streams, steam or adiabatic (spray) humidifying.
 * Units: °C, kPa, kg water per kg dry air, kJ/kg dry air, m³/kg dry air.
 */

export type Check = { ok: boolean; label: string; detail: string };
const K = 273.15;

/** Saturation pressure of water vapour [kPa] over ice (t < 0 °C) or liquid water, Hyland–Wexler. */
export function pws(t: number) {
  const T = t + K;
  const ln = t < 0
    ? -5.6745359e3 / T + 6.3925247 - 9.677843e-3 * T + 6.2215701e-7 * T ** 2 + 2.0747825e-9 * T ** 3 - 9.484024e-13 * T ** 4 + 4.1635019 * Math.log(T)
    : -5.8002206e3 / T + 1.3914993 - 4.8640239e-2 * T + 4.1764768e-5 * T ** 2 - 1.4452093e-8 * T ** 3 + 6.5459673 * Math.log(T);
  return Math.exp(ln) / 1000;
}

/** Saturation vapour pressure in moist air [kPa]: p_ws times the enhancement factor f (Buck 1981: f = 1.0007 + 3.46·10⁻⁶ p
 *  over water, 1.0003 + 4.18·10⁻⁶ p over ice, p in hPa), ≈ 1.004 at sea level — the ASHRAE tables include it. */
export const pwsMoist = (t: number, p: number) => pws(t) * (t < 0 ? 1.0003 + 4.18e-6 * p * 10 : 1.0007 + 3.46e-6 * p * 10);

/** Standard pressure at altitude Z [m] (eq. 3). */
export const pressureAt = (Z: number) => 101.325 * Math.pow(1 - 2.25577e-5 * Z, 5.2559);
export const humidityRatio = (pw: number, p: number) => (0.621945 * pw) / (p - pw);
const pwOf = (W: number, p: number) => (p * W) / (0.621945 + W);
export const enthalpy = (t: number, W: number) => 1.006 * t + W * (2501 + 1.86 * t);
export const specificVolume = (t: number, W: number, p: number) => (0.287042 * (t + K) * (1 + 1.607858 * W)) / p;
/** Dry-bulb temperature from enthalpy and humidity ratio. */
export const tFromHW = (h: number, W: number) => (h - 2501 * W) / (1.006 + 1.86 * W);

/** Dew point [°C] for a vapour pressure, by bisection on the saturation pressure in moist air at p. */
export function dewPoint(pw: number, p = 101.325) {
  if (pw <= 0) return -Infinity;
  let a = -80, b = 100;
  for (let i = 0; i < 80; i++) { const m = (a + b) / 2; if (pwsMoist(m, p) < pw) a = m; else b = m; }
  return (a + b) / 2;
}

/** Humidity ratio from dry bulb and thermodynamic wet bulb (eq. 33 above freezing, eq. 35 below). */
export function wFromWetBulb(t: number, tw: number, p: number) {
  const Wsw = humidityRatio(pwsMoist(tw, p), p);
  return tw >= 0
    ? ((2501 - 2.326 * tw) * Wsw - 1.006 * (t - tw)) / (2501 + 1.86 * t - 4.186 * tw)
    : ((2830 - 0.24 * tw) * Wsw - 1.006 * (t - tw)) / (2830 + 1.86 * t - 2.1 * tw);
}

/** Thermodynamic wet bulb [°C] for a state, by bisection between the dew point and the dry bulb. */
export function wetBulb(t: number, W: number, p: number) {
  let a = Math.max(dewPoint(pwOf(W, p), p) - 1, -60), b = t;
  for (let i = 0; i < 80; i++) { const m = (a + b) / 2; if (wFromWetBulb(t, m, p) > W) b = m; else a = m; }
  return (a + b) / 2;
}

export type State = { t: number; W: number; phi: number; h: number; v: number; td: number; tw: number; pw: number; p: number };
/** Complete state from dry bulb and humidity ratio. */
export function stateTW(t: number, W: number, p: number): State {
  const pw = pwOf(W, p), ps = pwsMoist(t, p);
  return { t, W, phi: pw / ps, h: enthalpy(t, W), v: specificVolume(t, W, p), td: dewPoint(pw, p), tw: wetBulb(t, W, p), pw, p };
}
/** Complete state from dry bulb and relative humidity (0…1). */
export const stateTPhi = (t: number, phi: number, p: number) => stateTW(t, humidityRatio(phi * pwsMoist(t, p), p), p);
/** Saturated state at t. */
export const saturated = (t: number, p: number) => stateTW(t, humidityRatio(pwsMoist(t, p), p), p);

/* ---------------- processes ---------------- */

export type Process = 'heating' | 'cooling' | 'mixing' | 'humidifying';

export type ProcessIn = {
  process: Process; p: number;
  t1: number; phi1: number; V1: number; // entering air: °C, 0…1, volume flow at state 1 [m³/h]
  t2: number; // heating: leaving dry bulb
  adp: number; bf: number; // cooling coil: apparatus dew point [°C], bypass factor
  tB: number; phiB: number; VB: number; // mixing: second stream (outdoor air)
  humid: 'steam' | 'spray'; phiTarget: number; // humidifying
  tSteam: number; // steam temperature [°C] for the steam humidifier (100 at atmospheric)
};

export type ProcessResult = {
  s1: State; s2: State; sB?: State; adpS?: State; path: State[]; ma: number; // ma: dry-air mass flow [kg/s]
  Q: number; Qs: number; Ql: number; // total, sensible, latent [kW] (positive = heat added to the air)
  water: number; // water added (+) or condensed (−) [kg/h]
  SHR: number; checks: Check[];
};

/** Comfort zone after ASHRAE 55 (simplified box): 20…26 °C, 30…60 % RH, W ≤ 0.012. */
export function inComfort(s: State) { return s.t >= 20 && s.t <= 26 && s.phi >= 0.3 && s.phi <= 0.6 && s.W <= 0.012; }

export function runProcess(q: ProcessIn): ProcessResult {
  const p = q.p, s1 = stateTPhi(q.t1, q.phi1, p), ma = q.V1 / 3600 / s1.v;
  const checks: Check[] = [];
  let s2: State, path: State[], sB: State | undefined, adpS: State | undefined, water = 0;
  if (q.process === 'heating') {
    s2 = stateTW(q.t2, s1.W, p); path = [s1, s2];
    if (q.t2 < s1.t) checks.push({ ok: q.t2 > s1.td, label: 'Sensible cooling stays above the dew point (no condensation)', detail: `t₂ = ${q.t2.toFixed(1)} °C > t_d ${s1.td.toFixed(1)} °C` });
    else checks.push({ ok: s2.phi >= 0.3, label: 'Heated air not too dry: φ₂ ≥ 30 % (else humidify)', detail: `φ₂ = ${(s2.phi * 100).toFixed(0)} %` });
  } else if (q.process === 'cooling') {
    adpS = saturated(q.adp, p);
    const t2 = q.adp + q.bf * (q.t1 - q.adp), W2 = Math.min(s1.W, adpS.W + q.bf * (s1.W - adpS.W));
    s2 = stateTW(t2, W2, p); path = [s1, s2];
    water = -ma * (s1.W - W2) * 3600;
    checks.push({ ok: q.adp < s1.td, label: 'Coil surface below the entering dew point (it dehumidifies)', detail: `ADP ${q.adp.toFixed(1)} °C < t_d ${s1.td.toFixed(1)} °C` });
    checks.push({ ok: q.adp >= 2, label: 'Apparatus dew point ≥ 2 °C (no frost on a chilled-water coil)', detail: `ADP = ${q.adp.toFixed(1)} °C` });
    checks.push({ ok: s2.phi <= 0.95, label: 'Leaving air not saturated: φ₂ ≤ 95 %', detail: `φ₂ = ${(s2.phi * 100).toFixed(0)} %` });
  } else if (q.process === 'mixing') {
    sB = stateTPhi(q.tB, q.phiB, p);
    const mB = q.VB / 3600 / sB.v, W3 = (ma * s1.W + mB * sB.W) / (ma + mB), h3 = (ma * s1.h + mB * sB.h) / (ma + mB);
    s2 = stateTW(tFromHW(h3, W3), W3, p); path = [s1, s2, sB];
    checks.push({ ok: s2.phi <= 1, label: 'Mixed air not supersaturated (no fog in the mixing box)', detail: `φ₃ = ${(s2.phi * 100).toFixed(0)} %` });
    checks.push({ ok: mB / (ma + mB) >= 0.1, label: 'Outdoor air ≥ 10 % of the supply (ventilation)', detail: `${((mB / (ma + mB)) * 100).toFixed(0)} % outdoor air` });
    checks.push({ ok: inComfort(s2), label: 'Mixed air inside the comfort zone (20…26 °C, 30…60 %)', detail: `${s2.t.toFixed(1)} °C, ${(s2.phi * 100).toFixed(0)} %` });
    return { s1, s2, sB, path, ma: ma + mB, Q: 0, Qs: 0, Ql: 0, water: 0, SHR: 1, checks }; // no heat added: adiabatic
  } else {
    // humidifying to a target relative humidity
    if (q.humid === 'steam') {
      // steam adds water and the steam's enthalpy (≈ constant dry bulb, t rises slightly)
      const hg = 2501 + 1.86 * q.tSteam;
      let lo = s1.W, hi = s1.W + 0.03, W2 = s1.W;
      for (let i = 0; i < 60; i++) { W2 = (lo + hi) / 2; const t2 = tFromHW(s1.h + (W2 - s1.W) * hg, W2); if (stateTW(t2, W2, p).phi < q.phiTarget) lo = W2; else hi = W2; }
      s2 = stateTW(tFromHW(s1.h + (W2 - s1.W) * hg, W2), W2, p);
    } else {
      // adiabatic spray: along the wet-bulb line (h ≈ constant)
      let lo = s1.tw, hi = s1.t, t2 = s1.t;
      for (let i = 0; i < 60; i++) { t2 = (lo + hi) / 2; if (stateTW(t2, wFromWetBulb(t2, s1.tw, p), p).phi > q.phiTarget) lo = t2; else hi = t2; }
      s2 = stateTW(t2, wFromWetBulb(t2, s1.tw, p), p);
    }
    path = [s1, s2];
    water = ma * (s2.W - s1.W) * 3600;
    checks.push({ ok: q.phiTarget > s1.phi, label: 'Target humidity above the entering humidity', detail: `φ₁ = ${(s1.phi * 100).toFixed(0)} % → ${(q.phiTarget * 100).toFixed(0)} %` });
    checks.push({ ok: q.phiTarget <= 0.7, label: 'Target ≤ 70 % (mould and condensation on cold surfaces)', detail: `φ₂ = ${(q.phiTarget * 100).toFixed(0)} %` });
    if (q.humid === 'spray') checks.push({ ok: s2.t >= 10, label: 'Spray humidifier: air stays ≥ 10 °C (evaporation cools it)', detail: `t₂ = ${s2.t.toFixed(1)} °C` });
  }
  const Q = ma * (s2.h - s1.h); // kW
  const hl = 2501 + 1.86 * s2.t; // latent part: water change × its enthalpy of vaporisation at about t₂
  const Ql = ma * (s2.W - s1.W) * hl, Qs = Q - Ql;
  if (q.process !== 'cooling') checks.push({ ok: inComfort(s2), label: 'Leaving air inside the comfort zone (20…26 °C, 30…60 %)', detail: `${s2.t.toFixed(1)} °C, ${(s2.phi * 100).toFixed(0)} %` });
  else checks.push({ ok: s2.t >= 10 && s2.t <= 18, label: 'Supply air 10…18 °C (cold enough to cool, warm enough not to draught)', detail: `t₂ = ${s2.t.toFixed(1)} °C` });
  return { s1, s2, sB, adpS, path, ma, Q, Qs, Ql, water, SHR: Q !== 0 ? Qs / Q : 1, checks };
}

export const PSYCHRO_INTRO: Record<Process, string> = {
  heating: 'A heater warms the air without adding water: the humidity ratio stays the same, so the relative humidity drops — the reason heated rooms feel dry in winter. Cooling without reaching the dew point works the same way backwards.',
  cooling: 'A cold coil cools the air; where the fins are below the dew point, water condenses and drips off. Air leaves between the coil surface state (apparatus dew point) and the entering air — a bypass factor says how much of the air missed the cold surface.',
  mixing: 'Return air from the room and fresh outdoor air meet in the mixing box. Mass and energy are conserved, so the mixed state lies on the straight line between the two, closer to the bigger stream.',
  humidifying: 'Dry winter air gets water added: a steam humidifier adds vapour at almost the same dry-bulb temperature; a spray (evaporative) humidifier lets water evaporate into the air, which cools it along the wet-bulb line.',
};

export const PSYCHRO_NOTES = [
  'Moist air as an ideal-gas mixture after ASHRAE Handbook — Fundamentals (2017), chapter 1: p_ws by Hyland–Wexler (eq. 5 and 6), W = 0.621945 p_w/(p − p_w), h = 1.006 t + W (2501 + 1.86 t) kJ/kg, v = 0.287042 (t + 273.15)(1 + 1.607858 W)/p, wet bulb from eq. 33/35, pressure at altitude from eq. 3. The saturation pressure in moist air includes the enhancement factor f (Buck, ≈ 1.004 at sea level), as the ASHRAE tables do. Validation: tests reproduce the saturation pressures of ASHRAE Table 3, the saturation humidity ratios of Table 2 and the humidity ratio, relative humidity and volume of the worked Example 2 of chapter 1 (40 °C dry bulb, 20 °C wet bulb).',
  'Cooling coil: leaving state on the straight line from the entering state to the apparatus dew point (coil surface, saturated), t₂ = ADP + BF (t₁ − ADP); real coils follow a curve and the ADP depends on the coil and water temperatures. Steam humidifier: vapour enthalpy at the steam temperature; spray humidifier: adiabatic saturation (constant wet bulb). Latent load = water change × (2501 + 1.86 t₂) kJ/kg. Comfort zone is a simplified box (20…26 °C, 30…60 % RH, W ≤ 12 g/kg), not the full ASHRAE 55 method.',
];
