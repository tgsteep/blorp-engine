/**
 * Ideal ramjet cycle (Mattingly, Elements of Propulsion, ideal ramjet analysis):
 * isentropic inlet and nozzle, constant-pressure combustion, perfect expansion (p₉ = p₀),
 * f ≪ 1 in the thrust equation, calorically perfect air. SI units.
 */

/** ISA standard atmosphere up to 20 km: troposphere (−6.5 K/km) + isothermal lower stratosphere. */
/** ISA / US Standard Atmosphere 1976 layers to 84.852 km (h treated as geopotential height); above that the 186.87 K layer is extended isothermally. */
const ISA_LAYERS: [number, number, number][] = [
  // base height [m], lapse rate [K/m], base temperature [K]
  [0, -0.0065, 288.15], [11000, 0, 216.65], [20000, 0.001, 216.65], [32000, 0.0028, 228.65],
  [47000, 0, 270.65], [51000, -0.0028, 270.65], [71000, -0.002, 214.65], [84852, 0, 186.946],
];
export function isa(h: number) {
  const R = 287.05, g0 = 9.80665;
  let p = 101325, T = 288.15;
  for (let i = 0; i < ISA_LAYERS.length; i++) {
    const [hb, L, Tb] = ISA_LAYERS[i], hTop = i + 1 < ISA_LAYERS.length ? ISA_LAYERS[i + 1][0] : Infinity;
    const dh = Math.min(Math.max(h, 0), hTop) - hb;
    T = Tb + L * dh;
    const pTop = L === 0 ? p * Math.exp((-g0 * dh) / (R * Tb)) : p * Math.pow(T / Tb, -g0 / (L * R));
    if (h <= hTop) { p = pTop; break; }
    p = pTop;
  }
  return { T, p, rho: p / (R * T), a: Math.sqrt(1.4 * R * T) };
}

export type Fuel = { id: string; name: string; hPR: number; fStoich: number };
export const FUELS: Fuel[] = [
  { id: 'kerosene', name: 'Kerosene (JP-7 type)', hPR: 42.8e6, fStoich: 0.0676 },
  { id: 'hydrogen', name: 'Hydrogen', hPR: 120e6, fStoich: 0.0292 },
];

export type RamjetIn = { M0: number; altitude: number; Tt4: number; Dinlet: number; fuel: Fuel; gamma?: number; cp?: number };

export function idealRamjet(p: RamjetIn) {
  const g = p.gamma ?? 1.4, cp = p.cp ?? 1004, R = 287.05, g0 = 9.80665;
  const atm = isa(p.altitude);
  const T0 = atm.T, a0 = Math.sqrt(g * R * T0), V0 = p.M0 * a0;
  const tauR = 1 + ((g - 1) / 2) * p.M0 ** 2; // Tt0/T0
  const tauL = p.Tt4 / T0; // τ_λ = cp·Tt4/(cp·T0)
  const ok = tauL > tauR;
  const V9a0 = ok ? p.M0 * Math.sqrt(tauL / tauR) : p.M0;
  const Fm = a0 * (V9a0 - p.M0); // specific thrust F/ṁ₀ [N/(kg/s)]
  const f = ok ? (cp * T0 * (tauL - tauR)) / p.fuel.hPR : 0;
  const S = Fm > 0 ? f / Fm : NaN; // thrust-specific fuel consumption [kg/(N·s)]
  const Isp = Fm > 0 ? Fm / (f * g0) : NaN; // fuel specific impulse [s]
  const etaT = 1 - 1 / tauR, etaP = ok ? 2 / (Math.sqrt(tauL / tauR) + 1) : 0;
  const Ain = (Math.PI * p.Dinlet ** 2) / 4;
  const mdot0 = atm.rho * V0 * Ain;
  const T9 = ok ? p.Tt4 / tauR : T0; // T₉/T₀ = τ_λ/τ_r
  const Tt0 = T0 * tauR;
  const checks = [
    { ok, label: 'Combustor hotter than ram air (τ_λ > τ_r) → thrust', detail: `τ_λ = ${tauL.toFixed(2)}, τ_r = ${tauR.toFixed(2)}` },
    { ok: p.M0 >= 1.5 && p.M0 <= 5.5, label: 'Flight Mach in practical ramjet range 1.5…5.5', detail: `M₀ = ${p.M0.toFixed(2)} (below: too little ram pressure; above: scramjet)` },
    { ok: f <= p.fuel.fStoich, label: 'Fuel–air ratio ≤ stoichiometric', detail: `f = ${f.toFixed(4)} ≤ ${p.fuel.fStoich}` },
    { ok: p.Tt4 <= 2400, label: 'Combustor exit temperature ≤ 2400 K (liner limit)', detail: `T_t4 = ${p.Tt4.toFixed(0)} K` },
  ];
  return { atm, T0, a0, V0, tauR, tauL, Tt0, V9: V9a0 * a0, Fm, f, S, Isp, etaT, etaP, etaO: etaT * etaP, Ain, mdot0, F: Fm * mdot0, mdotF: f * mdot0, T9, ok, checks };
}

export type RamjetResult = ReturnType<typeof idealRamjet>;

/** Isentropic area ratio A/A* at Mach M. */
export const areaRatio = (M: number, g = 1.4) => (1 / M) * Math.pow((2 / (g + 1)) * (1 + ((g - 1) / 2) * M * M), (g + 1) / (2 * (g - 1)));

/** Weak oblique-shock angle β [rad] for wedge angle θ [rad] at Mach M (θ–β–M relation); NaN if detached. */
export function shockAngle(M: number, theta: number, g = 1.4) {
  const f = (b: number) => (2 / Math.tan(b)) * ((M * M * Math.sin(b) ** 2 - 1) / (M * M * (g + Math.cos(2 * b)) + 2)) - Math.tan(theta);
  let lo = Math.asin(1 / Math.max(M, 1.0001)) + 1e-9, hi = lo;
  let best = NaN; // scan for the first sign change (weak solution)
  for (let b = lo; b < Math.PI / 2; b += 0.002) { if (f(b) >= 0) { hi = b; best = b; break; } lo = b; }
  if (Number.isNaN(best)) return NaN;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (f(m) >= 0) hi = m; else lo = m; }
  return (lo + hi) / 2;
}

/**
 * Engine layout in units of the capture diameter D (radius 0.5 at the cowl lip), from the ideal cycle:
 * throat A₈/A₀ = √(τ_λ/τ_r)/(A/A*)(M₀); exit M₉ = M₀ so A₉/A₀ = √(τ_λ/τ_r); combustor sized for M₄ ≈ 0.25;
 * spike tip placed so a 15° cone's oblique shock (2D wedge estimate) meets the cowl lip.
 */
export function ramjetLayout(p: RamjetIn, r: RamjetResult) {
  const k = r.ok ? Math.sqrt(r.tauL / r.tauR) : 1;
  const M0 = Math.max(p.M0, 1.05);
  const A8 = Math.min(k / areaRatio(M0), 1.6), A9 = Math.min(k, 3.2), A4 = Math.min(Math.max(A8 * areaRatio(0.25), 1.3), 3.2);
  const rad = (A: number) => 0.5 * Math.sqrt(A);
  const r8 = rad(A8), r9 = Math.max(rad(A9), r8), r4 = Math.max(rad(A4), r8 * 1.15, 0.55);
  const cone = (15 * Math.PI) / 180, beta = shockAngle(M0, cone);
  const tip = Number.isFinite(beta) ? -Math.min(0.5 / Math.tan(beta), 2.2) : -0.35; // detached shock: spike pulled in
  const nozzleLen = 0.8 + 2.2 * (r9 - r8);
  const xC0 = 2, xC1 = 5.5, x8 = xC1 + 0.9, x9 = x8 + nozzleLen;
  return { A8, A9, A4, r4, r8, r9, beta, tip, xC0, xC1, x8, x9, rOut: Math.max(r4, r9) + 0.08 };
}
export type RamjetLayout = ReturnType<typeof ramjetLayout>;

export const RAMJET_ASSUMPTIONS =
  'Ideal ramjet cycle (Mattingly): isentropic inlet and nozzle (no shock or friction losses), constant-pressure heat addition, nozzle fully expanded to ambient (p₉ = p₀), ' +
  'fuel mass neglected in the momentum balance (f ≪ 1), air as a perfect gas γ = 1.4, c_p = 1004 J/(kg·K). ISA atmosphere up to 20 km. ' +
  'Real ramjets lose 20…40 % of this thrust to inlet shocks, incomplete combustion and nozzle losses. Drawn geometry follows the ideal cycle: nozzle throat A₈/A₀ = √(τ_λ/τ_r)/(A/A*)(M₀), exit A₉/A₀ = √(τ_λ/τ_r) (M₉ = M₀), combustor sized for M ≈ 0.25, spike set by a 2D oblique-shock estimate for a 15° cone (a real cone shock is weaker). Flow and flame are schematic, not to speed; the person is 1.8 m tall.';

/* ------------ propulsion overview (typical, approximate values) ------------ */
export type Propulsion = { id: string; name: string; kind: 'rocket' | 'air'; how: string; isp: string; uses: string; href?: string };
export const PROPULSION: Propulsion[] = [
  { id: 'solid', kind: 'rocket', name: 'Solid rocket motor', how: 'Fuel and oxidiser are cast together as a rubbery grain; once lit it burns until empty. Simple, storable, cannot be throttled or stopped.', isp: '≈ 250…290 s', uses: 'boosters, missiles, fireworks' },
  { id: 'liquid', kind: 'rocket', name: 'Liquid bipropellant engine', how: 'Pumps feed fuel and oxidiser into a combustion chamber; throttleable and restartable, but complex (turbopumps, valves, cooling).', isp: '≈ 300…455 s', uses: 'launch vehicle main stages, upper stages' },
  { id: 'hybrid', kind: 'rocket', name: 'Hybrid rocket', how: 'Solid fuel grain, liquid or gas oxidiser flowing through it. Safer than solids and can be shut down; lower performance than liquids.', isp: '≈ 250…320 s', uses: 'sounding rockets, space tourism' },
  { id: 'mono', kind: 'rocket', name: 'Monopropellant thruster', how: 'One propellant (e.g. hydrazine) decomposes on a catalyst bed. Very simple, low thrust.', isp: '≈ 200…235 s', uses: 'satellite attitude control' },
  { id: 'electric', kind: 'rocket', name: 'Electric (ion / Hall) thruster', how: 'Electric fields accelerate ionised gas to very high speed. Tiny thrust, extreme efficiency.', isp: '≈ 1500…5000 s', uses: 'satellite station-keeping, deep-space probes' },
  { id: 'turbojet', kind: 'air', name: 'Turbojet / turbofan', how: 'A compressor squeezes air, fuel burns, a turbine drives the compressor, the jet gives thrust. Works from standstill.', isp: '≈ 3000…6000 s (fuel)', uses: 'airliners, fighters (M 0…2.5)' },
  { id: 'ramjet', kind: 'air', name: 'Ramjet', how: 'No compressor: the inlet slows supersonic air and raises its pressure by ram effect, fuel burns at subsonic speed, the nozzle accelerates it. Needs a boost to about M 1.5.', isp: '≈ 1200…1800 s real (fuel)', uses: 'missiles, high-speed test vehicles (M 1.5…5); the ideal cycle in the tool gives more', href: '/aerospace/ramjet' },
  { id: 'scramjet', kind: 'air', name: 'Scramjet', how: 'Supersonic-combustion ramjet: air stays supersonic through the combustor, avoiding extreme inlet temperatures above about M 5.', isp: '≈ 1000…3000 s (H₂ fuel)', uses: 'hypersonic research vehicles (M 5…15)' },
  { id: 'pulsejet', kind: 'air', name: 'Pulsejet', how: 'Intermittent combustion with valves or a resonant tube; very simple and very loud.', isp: '≈ 1000 s', uses: 'V-1 flying bomb, hobby engines' },
];
