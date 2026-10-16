/**
 * Control valve sizing after IEC 60534-2-1 (= ANSI/ISA-75.01.01): required flow coefficient Kv (Cv = 1.156 Kv) for
 * turbulent flow of liquids and gases, without attached fittings (valve size = pipe size). Liquids: choked flow at
 * ΔP_ch = F_L²(p₁ − F_F p_v), flashing when p₂ ≤ p_v; gases: expansion factor Y, choked at x = F_γ x_T. Valve Reynolds
 * number to confirm turbulent flow. Then a valve size: typical capacity of the style and the travel at the design point
 * for an equal-percentage or linear characteristic. Units in: kPa abs, m³/h, kg/h, °C, mm, mm²/s (cSt).
 */

export type Service = 'liquid' | 'gas';
const fx = (v: number, n: number) => (Number.isFinite(v) ? v.toFixed(n) : '—'); // a missing result reads as a dash
/** Typical full-open factors (IEC 60534-2-1 Annex A table) and capacity C_d = Cv/d² (d in inches, rule of thumb). */
export const STYLES = [
  { id: 'globeO', name: 'Globe, parabolic plug, flow-to-open', FL: 0.9, xT: 0.72, Fd: 0.46, Cd: 10 },
  { id: 'globeC', name: 'Globe, parabolic plug, flow-to-close', FL: 0.8, xT: 0.55, Fd: 1.0, Cd: 10 },
  { id: 'cage', name: 'Globe, cage-guided, 4 ports', FL: 0.9, xT: 0.75, Fd: 0.25, Cd: 12 },
  { id: 'rotary', name: 'Eccentric rotary plug', FL: 0.85, xT: 0.6, Fd: 0.42, Cd: 12 },
  { id: 'vball', name: 'Segmented ball (V-ball)', FL: 0.6, xT: 0.3, Fd: 0.98, Cd: 20 },
  { id: 'butterfly', name: 'Butterfly, swing-through, 70°', FL: 0.62, xT: 0.35, Fd: 0.57, Cd: 20 },
] as const;
export type StyleId = (typeof STYLES)[number]['id'];
export const DN = [15, 20, 25, 32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300, 400];

/** Numerical constants of IEC 60534-2-1 Table 1 for Kv (kPa, m³/h, kg/h, mm, m²/s). */
export const N = { N1: 0.1, N2: 1.6e-3, N4: 7.07e-2, N6: 3.16 };
const RU = 8314.462618; // J/(kmol K)

export type ValveIn = {
  service: Service; style: StyleId; dn: number; char: 'eq' | 'lin';
  p1: number; p2: number;   // inlet, outlet pressure [kPa abs]
  T: number;                // inlet temperature [°C]
  Q: number;                // liquid: volume flow [m³/h]; gas: mass flow [kg/h]
  rho: number;              // liquid density [kg/m³]
  pv: number; pc: number;   // liquid vapour pressure and critical pressure [kPa abs]
  nu: number;               // kinematic viscosity [mm²/s]
  M: number; k: number; Z: number; // gas: molar mass [kg/kmol], specific heat ratio, compressibility
};

/** Liquid critical pressure ratio factor F_F = 0.96 − 0.28 √(p_v/p_c). */
export const FF = (pv: number, pc: number) => 0.96 - 0.28 * Math.sqrt(Math.max(pv, 0) / pc);

/** Liquid: required Kv, choked flow limit. */
export function liquidKv(Q: number, p1: number, p2: number, rho: number, pv: number, pc: number, FL: number) {
  const ff = FF(pv, pc), dp = p1 - p2, dpCh = FL * FL * (p1 - ff * pv), choked = dp >= dpCh;
  const Kv = (Q / N.N1) * Math.sqrt(rho / 1000 / Math.min(dp, dpCh));
  return { ff, dp, dpCh, choked, Kv };
}
/** Gas: required Kv from mass flow, Y = 1 − x/(3 F_γ x_T), x limited to the choked ratio F_γ x_T. */
export function gasKv(W: number, p1: number, p2: number, T: number, M: number, k: number, Z: number, xT: number) {
  const Fg = k / 1.4, x = (p1 - p2) / p1, xCh = Fg * xT, choked = x >= xCh, xs = Math.min(x, xCh);
  const Y = 1 - xs / (3 * Fg * xT), rho1 = (p1 * 1000 * M) / (Z * RU * (T + 273.15));
  const Kv = W / (N.N6 * Y * Math.sqrt(xs * p1 * rho1));
  return { Fg, x, xCh, choked, Y, rho1, Kv };
}
/** Valve Reynolds number (IEC 60534-2-1 eq. 28), Q actual m³/h, ν m²/s, D mm. */
export function reynolds(Q: number, nu: number, Kv: number, FL: number, Fd: number, D: number) {
  return ((N.N4 * Fd * Q) / (nu * Math.sqrt(Kv * FL))) * Math.pow((FL * FL * Kv * Kv) / (N.N2 * D ** 4) + 1, 0.25);
}
/** Relative travel h for a relative Kv: equal percentage Kv/Kvs = R^(h − 1), R = 50; linear Kv/Kvs = h. */
export const travel = (ratio: number, ch: 'eq' | 'lin', R = 50) => (ch === 'lin' ? ratio : 1 + Math.log(Math.max(ratio, 1e-9)) / Math.log(R));
export const kvOfTravel = (h: number, ch: 'eq' | 'lin', R = 50) => (ch === 'lin' ? h : Math.pow(R, h - 1));
/** Typical rated capacity of a style and size: Cv = C_d d² (d in inches), Kvs = Cv/1.156. */
export const kvsOf = (style: StyleId, dn: number) => (STYLES.find((s) => s.id === style)!.Cd * (dn / 25.4) ** 2) / 1.156;

export function valve(p: ValveIn) {
  const st = STYLES.find((s) => s.id === p.style)!, liq = p.service === 'liquid';
  const L = liquidKv(p.Q, p.p1, p.p2, p.rho, p.pv, p.pc, st.FL);
  const Gs = gasKv(p.Q, p.p1, p.p2, p.T, p.M, p.k, p.Z, st.xT);
  const Kv = liq ? L.Kv : Gs.Kv, Cv = 1.156 * Kv;
  const Qact = liq ? p.Q : p.Q / Gs.rho1; // actual volume flow at the inlet [m³/h]
  const Re = reynolds(Qact, p.nu * 1e-6, Kv, st.FL, st.Fd, p.dn);
  const Kvs = kvsOf(p.style, p.dn), h = travel(Kv / Kvs, p.char);
  // pressure at the vena contracta (liquid): p_vc = p₁ − ΔP/F_L² (not below the vapour pressure)
  const pvc = liq ? Math.max(p.p1 - L.dp / (st.FL * st.FL), Math.min(p.pv, p.p1)) : NaN;
  const xF = liq ? L.dp / (p.p1 - p.pv) : NaN; // differential pressure ratio for cavitation
  // gas outlet velocity in the valve outlet (isothermal estimate) and its Mach number
  const A = (Math.PI * (p.dn / 1000) ** 2) / 4, rho2 = (Gs.rho1 * p.p2) / p.p1, v2 = liq ? p.Q / 3600 / A : p.Q / 3600 / (rho2 * A);
  const c = Math.sqrt((p.k * p.Z * RU * (p.T + 273.15)) / p.M), Ma = v2 / c;
  const smallest = DN.find((d) => travel(Kv / kvsOf(p.style, d), p.char) <= 0.8) ?? NaN;
  const checks = [
    { ok: p.p2 < p.p1, label: 'Outlet pressure below the inlet pressure', detail: `p₁ = ${fx(p.p1, 0)} kPa, p₂ = ${fx(p.p2, 0)} kPa` },
    ...(liq ? [
      { ok: L.dpCh > 0, label: 'Liquid at the inlet: p₁ above F_F p_v (otherwise it already boils)', detail: `p₁ = ${fx(p.p1, 0)} kPa, F_F p_v = ${fx((L.ff * p.pv), 1)} kPa` },
      { ok: p.p2 > p.pv, label: 'No flashing: outlet pressure above the vapour pressure', detail: `p₂ = ${fx(p.p2, 0)} kPa, p_v = ${fx(p.pv, 1)} kPa` },
      { ok: !L.choked, label: 'Not choked: ΔP < F_L²(p₁ − F_F p_v) (no fully developed cavitation)', detail: `ΔP = ${fx(L.dp, 0)} kPa, limit ${fx(L.dpCh, 0)} kPa` },
    ] : [
      { ok: !Gs.choked, label: 'Not choked: x < F_γ x_T', detail: `x = ${fx(Gs.x, 3)}, limit ${fx(Gs.xCh, 3)}` },
      { ok: Ma <= 0.3, label: 'Outlet Mach number ≤ 0.3 (noise, erosion)', detail: `Ma = ${fx(Ma, 2)}, v = ${fx(v2, 0)} m/s` },
    ]),
    { ok: Re >= 1e4, label: 'Turbulent flow: valve Reynolds number ≥ 10 000 (no viscosity correction needed)', detail: `Re_v = ${Number.isFinite(Re) ? Re.toExponential(2) : "—"}` },
    { ok: h >= 0.2 && h <= 0.8, label: 'Valve travel at the design flow 20…80 %', detail: `${fx((h * 100), 0)} % open for Kv ${fx(Kv, 1)} of Kvs ${fx(Kvs, 0)} (DN ${p.dn})` },
  ];
  return { st, liq, L, Gs, Kv, Cv, Qact, Re, Kvs, h, pvc, xF, v2, Ma, smallest, checks };
}
export type ValveResult = ReturnType<typeof valve>;

/** Flow through a valve of capacity Kv against the pressure drop at fixed p₁: rises with √ΔP, then levels off when choked. */
export function flowCurve(p: ValveIn, Kv: number, n = 60) {
  const st = STYLES.find((s) => s.id === p.style)!;
  return Array.from({ length: n + 1 }, (_, i) => {
    const p2 = p.p1 - ((p.p1 - 1) * i) / n, dp = p.p1 - p2;
    const fin = (q: number) => (Number.isFinite(q) && q > 0 ? q : 0); // a flashing liquid (p₁ < F_F p_v) or a degenerate gas case gives no flow, never NaN
    if (p.service === 'liquid') { const lim = st.FL * st.FL * (p.p1 - FF(p.pv, p.pc) * p.pv); return { dp, q: fin(Kv * N.N1 * Math.sqrt(Math.max(Math.min(dp, lim), 0) / (p.rho / 1000))) }; }
    const g = gasKv(1, p.p1, p2, p.T, p.M, p.k, p.Z, st.xT); // kg/h per unit Kv
    return { dp, q: i === 0 ? 0 : fin(Kv / g.Kv) };
  });
}

export const VALVE_INTRO = 'A control valve throttles a flow by making a pressure drop. Its size is described by one number, the flow coefficient Kv (m³/h of water at 1 bar drop; Cv in US gallons per minute at 1 psi): the valve must reach the flow you need with the pressure drop you can spend. Liquids speed up in the narrowest part of the valve, where the pressure falls the most; if it falls below the vapour pressure the liquid boils and the bubbles collapse again downstream — cavitation — and at the limit the flow stops growing (choked). Gases expand instead and choke near the speed of sound.';
export const VALVE_NOTES = [
  'Sizing equations of IEC 60534-2-1 (= ANSI/ISA-75.01.01) for turbulent flow without attached fittings (valve size = pipe size, F_P = 1). Liquid: Kv = Q/N₁ √((ρ/ρ₀)/ΔP), ΔP limited to the choked value F_L²(p₁ − F_F p_v), F_F = 0.96 − 0.28 √(p_v/p_c). Gas: Kv = W/(N₆ Y √(x p₁ ρ₁)), Y = 1 − x/(3 F_γ x_T), F_γ = γ/1.40, x limited to F_γ x_T, ideal-gas density with Z. Valve Reynolds number by eq. 28; below 10 000 a viscosity correction (not done here) is needed. Validation: liquid examples 1 and 2 of ANSI/ISA-75.01.01-2002 Annex F (water at 363 K, globe 165 Kv and choked segmented ball 238 Kv, Re_v 2.97 × 10⁶).',
  'F_L, x_T and F_d are typical full-open values of each valve style from the standard\'s informative table; real values depend on the valve and the opening — use the manufacturer\'s data. The rated capacity Kvs is a rule of thumb (Cv ≈ C_d d², d in inches: globe 10, cage and rotary plug 12, segmented ball and butterfly 20) to pick a size; catalogues differ. Travel: equal-percentage characteristic with rangeability 50 (Kv/Kvs = 50^(h − 1)) or linear, inherent (no installed characteristic).',
  'Pressure inside the valve: the drawing shows the pressure falling to the vena contracta, p_vc = p₁ − ΔP/F_L², and recovering to p₂ — a schematic of the recovery that F_L describes, not a measured profile. Cavitation starts before choking (at x_F = ΔP/(p₁ − p_v) above the valve\'s incipient value, from the manufacturer or IEC 60534-8-4); noise (IEC 60534-8-3/8-4) and actuator force are not checked. Gas outlet velocity: isothermal estimate at the valve outlet.',
];
