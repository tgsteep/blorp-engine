/**
 * Horizontal-axis wind turbine power — actuator-disc theory + a generic Cp(λ, β) curve,
 * variable-speed / pitch-regulated operation. SI units: m, m/s, W, rad/s, kg/m³.
 */

export const BETZ = 16 / 27;

/** Air density from altitude [m] (ISA pressure) and air temperature [°C]: ρ = p/(R·T). */
export function airDensity(altitude: number, tempC: number) {
  const p = 101325 * Math.pow(1 - 2.25577e-5 * altitude, 5.25588);
  return { p, rho: p / (287.05 * (tempC + 273.15)) };
}

/** Power-law wind shear: v(H) = v_ref·(H/h_ref)^α. */
export const shear = (vRef: number, H: number, alpha: number, hRef = 10) => vRef * Math.pow(H / hRef, alpha);

/**
 * Generic power coefficient (Heier 1998, as used in many turbine models):
 * Cp = 0.5176(116/λ_i − 0.4β − 5)e^(−21/λ_i) + 0.0068λ, 1/λ_i = 1/(λ + 0.08β) − 0.035/(β³ + 1).
 * Peak ≈ 0.48 at λ ≈ 8.1, β = 0. β in degrees.
 */
export function cpHeier(lambda: number, betaDeg = 0) {
  if (lambda <= 0) return 0;
  const inv = 1 / (lambda + 0.08 * betaDeg) - 0.035 / (betaDeg ** 3 + 1);
  const cp = 0.5176 * (116 * inv - 0.4 * betaDeg - 5) * Math.exp(-21 * inv) + 0.0068 * lambda;
  return Math.max(cp, 0);
}

/** λ and Cp at the peak of the β = 0 curve (golden-section search). */
export const CP_OPT = (() => {
  let a = 2, b = 14;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 80; i++) {
    const c = b - g * (b - a), d = a + g * (b - a);
    if (cpHeier(c) > cpHeier(d)) b = d; else a = c;
  }
  const lambda = (a + b) / 2;
  return { lambda, cp: cpHeier(lambda) };
})();

/** Axial induction a ≤ 1/2 from Cp = 4a(1 − a)² (momentum theory) and thrust coefficient C_T = 4a(1 − a). */
export function induction(cp: number) {
  const c = Math.min(Math.max(cp, 0), BETZ);
  let lo = 0, hi = 1 / 3; // Cp(a) rises monotonically on [0, 1/3]
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (4 * m * (1 - m) ** 2 < c) lo = m; else hi = m; }
  const a = (lo + hi) / 2;
  return { a, CT: 4 * a * (1 - a) };
}

export type TurbineIn = {
  D: number; // rotor diameter [m]
  H: number; // hub height [m]
  Pr: number; // rated electrical power [W]
  v10: number; // wind speed at 10 m [m/s]
  alpha: number; // shear exponent
  altitude: number; // site altitude [m]
  tempC: number; // air temperature [°C]
  vTipMax?: number; // tip-speed limit [m/s], default 80
  cpMax?: number; // rotor peak power coefficient, default 0.48 (curve scaled to it)
  etaMech?: number; // mechanical efficiency: gearbox + bearings, default 0.97
  etaEl?: number; // electrical efficiency: generator + converter, default 0.95
  vIn?: number; // cut-in [m/s], default 3
  vOut?: number; // cut-out [m/s], default 25
};

type Op = { region: 'stopped' | 'partial' | 'rated'; omega: number; rpm: number; lambda: number; cp: number; beta: number; Pmech: number; Pgen: number; Pel: number; Q: number; a: number; CT: number; thrust: number; vTip: number };

function defaults(t: TurbineIn) {
  const cpMax = Math.min(t.cpMax ?? CP_OPT.cp, BETZ), etaMech = t.etaMech ?? 0.97, etaEl = t.etaEl ?? 0.95;
  return { vTipMax: t.vTipMax ?? 80, cpMax, etaMech, etaEl, eta: etaMech * etaEl, vIn: t.vIn ?? 3, vOut: t.vOut ?? 25 };
}

/** Rotor C_P: the generic curve scaled so that its peak equals cpMax. */
const cpRotor = (cpMax: number, lambda: number, betaDeg = 0) => (cpHeier(lambda, betaDeg) * cpMax) / CP_OPT.cp;

/** Below rated: λ_opt tracking, capped by the tip-speed limit. Returns electrical power before the rated cap. */
function partialLoad(t: TurbineIn, rho: number, v: number) {
  const { vTipMax, eta, cpMax } = defaults(t);
  const R = t.D / 2, A = (Math.PI * t.D ** 2) / 4;
  const omega = Math.min((CP_OPT.lambda * v) / R, vTipMax / R);
  const lambda = (omega * R) / v;
  const cp = cpRotor(cpMax, lambda);
  const Pmech = 0.5 * rho * A * v ** 3 * cp;
  return { omega, lambda, cp, Pmech, Pel: eta * Pmech };
}

/** Rated wind speed: where the partial-load electrical power first reaches P_r (NaN if not below cut-out). */
export function ratedWindSpeed(t: TurbineIn, rho: number) {
  const { vIn, vOut } = defaults(t);
  if (partialLoad(t, rho, vOut).Pel < t.Pr) return NaN;
  let lo = vIn, hi = vOut;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (partialLoad(t, rho, m).Pel < t.Pr) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/** Operating point at hub wind speed v. Above rated, blades pitch (β > 0) to hold P_r at rated rotor speed. */
export function operatingPoint(t: TurbineIn, rho: number, v: number, vRated = ratedWindSpeed(t, rho)): Op {
  const { eta, vIn, vOut, cpMax } = defaults(t);
  const R = t.D / 2, A = (Math.PI * t.D ** 2) / 4;
  const zero = { omega: 0, rpm: 0, lambda: 0, cp: 0, beta: 0, Pmech: 0, Pgen: 0, Pel: 0, Q: 0, a: 0, CT: 0, thrust: 0, vTip: 0 };
  if (v < vIn || v > vOut) return { region: 'stopped', ...zero };
  const pl = partialLoad(t, rho, v);
  let region: Op['region'] = 'partial', omega = pl.omega, lambda = pl.lambda, cp = pl.cp, beta = 0, Pmech = pl.Pmech, Pel = pl.Pel;
  if (Number.isFinite(vRated) && v >= vRated) {
    region = 'rated';
    omega = partialLoad(t, rho, vRated).omega;
    lambda = (omega * R) / v;
    Pel = t.Pr;
    Pmech = t.Pr / eta;
    cp = Pmech / (0.5 * rho * A * v ** 3);
    const cp0 = cpRotor(cpMax, lambda);
    if (cp0 < cp) { cp = cp0; Pmech = 0.5 * rho * A * v ** 3 * cp; Pel = eta * Pmech; } // cannot hold P_r even at β = 0
    let lo = 0, hi = 60; // Cp falls with β at fixed λ
    for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (cpRotor(cpMax, lambda, m) > cp) lo = m; else hi = m; }
    beta = (lo + hi) / 2;
  }
  const ind = induction(cp);
  const { etaMech } = defaults(t);
  return { region, omega, rpm: (omega * 60) / (2 * Math.PI), lambda, cp, beta, Pmech, Pgen: etaMech * Pmech, Pel, Q: Pmech / omega, a: ind.a, CT: ind.CT, thrust: 0.5 * rho * A * v ** 2 * ind.CT, vTip: omega * R };
}

export function computeTurbine(t: TurbineIn) {
  const d = defaults(t);
  const R = t.D / 2, A = (Math.PI * t.D ** 2) / 4;
  const air = airDensity(t.altitude, t.tempC);
  const rho = air.rho;
  const vHub = shear(t.v10, t.H, t.alpha);
  const vRated = ratedWindSpeed(t, rho);
  const op = operatingPoint(t, rho, vHub, vRated);
  const Pwind = 0.5 * rho * A * vHub ** 3;
  const rated = Number.isFinite(vRated) ? operatingPoint(t, rho, vRated, vRated) : null;
  const curve = Array.from({ length: 61 }, (_, i) => {
    const v = i / 2;
    const o = operatingPoint(t, rho, v, vRated);
    return { v, P: o.Pel, cp: o.cp };
  });
  const specific = t.Pr / A;
  // why C_P is where it is: best λ (C_P max), tip-speed limit (λ falls), rated (pitch spills power)
  const vTipLimit = d.vTipMax / CP_OPT.lambda;
  const limit: 'stopped' | 'optimum' | 'tip' | 'rated' = op.region === 'stopped' ? 'stopped' : op.region === 'rated' ? 'rated' : vHub > vTipLimit ? 'tip' : 'optimum';
  const clearance = t.H - R;
  const f = (n: number, k = 1) => (Number.isFinite(n) ? n.toFixed(k) : '—');
  const checks = [
    { ok: clearance > 0, label: 'Blade tip clears the ground (H − R > 0)', detail: `H − R = ${f(clearance)} m` },
    { ok: vHub >= d.vIn && vHub <= d.vOut, label: `Wind in operating range ${d.vIn}…${d.vOut} m/s`, detail: `v_hub = ${f(vHub, 2)} m/s` },
    { ok: Number.isFinite(vRated), label: 'Rated power reached below cut-out', detail: Number.isFinite(vRated) ? `v_rated = ${f(vRated, 1)} m/s` : 'rotor too small for P_r' },
    { ok: specific >= 150 && specific <= 700, label: 'Specific rating P_r/A typical (150…700 W/m²)', detail: `${f(specific, 0)} W/m²` },
    { ok: op.cp <= BETZ + 1e-12, label: 'C_P ≤ 16/27 (Betz limit)', detail: `C_P = ${f(op.cp, 3)} ≤ 0.593` },
  ];
  return { ...d, R, A, air, rho, vHub, vRated, rated, op, vTipLimit, limit, Pwind, Pbetz: BETZ * Pwind, specific, clearance, curve, checks };
}

export type TurbineResult = ReturnType<typeof computeTurbine>;

export const WIND_ASSUMPTIONS =
  'Actuator-disc (Betz) theory with a generic C_P(λ, β) curve (Heier 1998: C_P,max ≈ 0.48 at λ ≈ 8.1), not a specific turbine’s certified power curve. ' +
  'Variable speed below rated (tracks λ_opt, tip speed capped at v_tip,max), pitch control above rated; cut-in 3 m/s, cut-out 25 m/s, mechanical efficiency η_m (gearbox, bearings) and electrical efficiency η_e (generator, converter) as set; C_P curve shape fixed, scaled to the chosen C_P,max. ' +
  'Wind at hub from the power law v_hub = v₁₀·(H/10)^α; steady, uniform wind, no turbulence, yaw error, tower shadow or wake losses. ' +
  'Air density from ISA pressure at the site altitude and the given air temperature. Thrust from momentum theory, C_T = 4a(1 − a), a ≤ 1/3. ' +
  '3D and 2D views are true to scale for D and H; tower, nacelle and blade shapes are simplified. Reference objects: person 1.78 m, car 5.2 m, bus 12 m, 10-storey building 32 m, Eiffel Tower 330 m.';
