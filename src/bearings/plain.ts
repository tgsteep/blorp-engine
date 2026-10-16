/**
 * Plain (sliding) bearings.
 *  - Bushings: p, v, pv limits of the bearing material (dry or marginally lubricated).
 *  - Hydrodynamic journal bearings: full oil film, Raimondi–Boyd design chart for L/D = 1 (Shigley).
 * Units: mm, N, rpm, MPa, m/s unless noted.
 */

export type PlainMaterial = { id: string; name: string; pMax: number; vMax: number; pvMax: number; mu: number; tMax: number; note: string; cost: string };

/** Typical catalogue limits (rounded; manufacturers differ — check the datasheet). */
export const PLAIN_MATERIALS: PlainMaterial[] = [
  { id: 'polymer', name: 'Engineering plastic (POM / PA), dry', pMax: 15, vMax: 1, pvMax: 0.15, mu: 0.25, tMax: 90, note: 'cheapest; light loads, no lubrication, corrosion-free', cost: '€' },
  { id: 'sinter', name: 'Sintered bronze, oil-impregnated', pMax: 10, vMax: 6, pvMax: 1.8, mu: 0.08, tMax: 90, note: 'small motors, fans, appliances; self-lubricating', cost: '€' },
  { id: 'ptfe', name: 'Steel-backed PTFE composite, dry', pMax: 56, vMax: 2, pvMax: 1.8, mu: 0.12, tMax: 250, note: 'high load, dry running, thin wall', cost: '€€' },
  { id: 'bronze', name: 'Cast bronze (CuSn), greased', pMax: 30, vMax: 2, pvMax: 3, mu: 0.1, tMax: 150, note: 'heavy machinery pins and pivots, needs regreasing', cost: '€€' },
  { id: 'graphite', name: 'Graphite-plugged bronze', pMax: 60, vMax: 0.5, pvMax: 1.6, mu: 0.12, tMax: 300, note: 'slow, heavy, hot or dirty: dams, cranes, furnaces', cost: '€€€' },
];

export type BushingIn = { d: number; L: number; F: number; n: number; mat: PlainMaterial };

export function bushing(p: BushingIn) {
  const pr = p.F / (p.d * p.L); // MPa (N/mm²), projected area
  const v = (Math.PI * p.d * p.n) / 60000; // m/s
  const pv = pr * v;
  const M = (p.mat.mu * p.F * p.d) / 2000; // friction torque N·m
  const Ploss = p.mat.mu * p.F * v; // W
  const use = Math.max(pr / p.mat.pMax, v / p.mat.vMax, pv / p.mat.pvMax);
  const checks = [
    { ok: pr <= p.mat.pMax, label: `Pressure p = F/(d·L) ≤ ${p.mat.pMax} MPa`, detail: `p = ${pr.toFixed(2)} MPa` },
    { ok: v <= p.mat.vMax, label: `Sliding speed v ≤ ${p.mat.vMax} m/s`, detail: `v = ${v.toFixed(3)} m/s` },
    { ok: pv <= p.mat.pvMax, label: `pv ≤ ${p.mat.pvMax} MPa·m/s (heat limit)`, detail: `pv = ${pv.toFixed(3)} MPa·m/s` },
    { ok: p.L / p.d >= 0.5 && p.L / p.d <= 1.5, label: 'Length/diameter 0.5…1.5 (edge loading vs. alignment)', detail: `L/d = ${(p.L / p.d).toFixed(2)}` },
  ];
  return { p: pr, v, pv, M, Ploss, use, checks };
}

/* ---------------- hydrodynamic journal bearing ---------------- */

/** Raimondi–Boyd, full journal bearing, L/D = 1 (as tabulated in Shigley’s Mechanical Engineering Design). */
export const RB = {
  eps: [0.1, 0.2, 0.4, 0.6, 0.8, 0.9, 0.97],
  h0c: [0.9, 0.8, 0.6, 0.4, 0.2, 0.1, 0.03],
  S: [1.33, 0.631, 0.264, 0.121, 0.0446, 0.0188, 0.00474],
  rcf: [26.4, 12.8, 5.79, 3.22, 1.7, 1.05, 0.514],
  q: [3.37, 3.59, 3.99, 4.33, 4.62, 4.74, 4.89], // Q/(r·c·N·l)
  phi: [79.5, 74.02, 63.1, 50.58, 36.24, 26.45, 15.47], // attitude angle [°] between load line and line of centres
};

/** Interpolate the chart in log(S) (S decreasing along the table). */
export function raimondiBoyd(S: number) {
  const ls = Math.log(S), xs = RB.S.map(Math.log);
  let i = xs.findIndex((x) => x < ls);
  if (i <= 0) i = i === 0 ? 1 : xs.length - 1; // clamp to the table ends
  const t = Math.min(Math.max((ls - xs[i - 1]) / (xs[i] - xs[i - 1]), 0), 1);
  const L = (a: number[]) => a[i - 1] + (a[i] - a[i - 1]) * t;
  return { eps: L(RB.eps), h0c: L(RB.h0c), rcf: L(RB.rcf), q: L(RB.q), phi: L(RB.phi), inRange: S <= RB.S[0] && S >= RB.S[RB.S.length - 1] };
}

/** ISO VG oils with viscosity index ≈ 100: ν at 40 °C and 100 °C [mm²/s]. */
export const OILS: Record<string, [number, number]> = { VG22: [22, 4.3], VG32: [32, 5.4], VG46: [46, 6.8], VG68: [68, 8.7], VG100: [100, 11.2], VG150: [150, 14.7] };

/** Kinematic viscosity at T [°C] from the Walther–ASTM D341 relation through the 40/100 °C points. */
export function viscosity(oil: [number, number], T: number) {
  const ll = (nu: number) => Math.log10(Math.log10(nu + 0.7));
  const t1 = Math.log10(313.15), t2 = Math.log10(373.15);
  const B = (ll(oil[0]) - ll(oil[1])) / (t2 - t1), A = ll(oil[0]) + B * t1;
  return Math.pow(10, Math.pow(10, A - B * Math.log10(T + 273.15))) - 0.7;
}

export type JournalIn = { D: number; cr: number; W: number; n: number; oil: string; T: number }; // D mm, radial clearance cr µm, W N, n rpm, film temperature °C

export function journal(p: JournalIn) {
  const r = p.D / 2 / 1000, c = p.cr * 1e-6, L = p.D / 1000; // m (L/D = 1)
  const nu = viscosity(OILS[p.oil], p.T); // mm²/s
  const mu = 870 * nu * 1e-6; // Pa·s
  const Ns = p.n / 60;
  const P = p.W / (2 * r * L); // Pa, unit load on projected area
  const S = (r / c) ** 2 * ((mu * Ns) / P);
  const rb = raimondiBoyd(S);
  const h0 = rb.h0c * c; // m
  const f = rb.rcf / (r / c);
  const v = 2 * Math.PI * r * Ns;
  const Ploss = f * p.W * v;
  const Q = rb.q * r * c * Ns * L; // m³/s supplied flow
  const dT = Ploss / (870 * 1900 * Q); // K, all heat carried by the flow (estimate)
  const petroff = 2 * Math.PI * Math.PI * (r / c) * ((mu * Ns) / P); // Petroff friction (no load eccentricity)
  const hMinTrumpler = (0.00508 + 0.00004 * p.D) / 1000; // m, Trumpler: h₀ ≥ 0.0002 + 0.00004·d (inch)
  const checks = [
    { ok: h0 >= hMinTrumpler, label: 'Oil film h₀ ≥ Trumpler minimum (0.005 mm + 0.00004·D)', detail: `h₀ = ${(h0 * 1e6).toFixed(1)} µm ≥ ${(hMinTrumpler * 1e6).toFixed(1)} µm` },
    { ok: P / 1e6 <= 2.5, label: 'Unit load P ≤ 2.5 MPa (white-metal liner)', detail: `P = ${(P / 1e6).toFixed(2)} MPa` },
    { ok: rb.inRange, label: 'Sommerfeld number inside the chart (0.005…1.3)', detail: `S = ${S.toFixed(4)}` },
    { ok: dT <= 30, label: 'Oil temperature rise ≤ 30 K', detail: `ΔT ≈ ${dT.toFixed(1)} K` },
  ];
  return { r, c, nu, mu, P, S, ...rb, h0, f, v, Ploss, Q, dT, petroff, hMinTrumpler, checks };
}
export type JournalResult = ReturnType<typeof journal>;

/** Film pressure shape around the bearing (short-bearing theory, Ocvirk): p ∝ ε·sin θ/(1 + ε·cos θ)³ for 0 < θ < π, zero elsewhere (cavitation).
 *  θ is measured from the line of centres at the thickest film; returns values normalised to a peak of 1. */
export function filmPressureShape(eps: number, n = 72) {
  const raw = Array.from({ length: n + 1 }, (_, i) => { const th = (2 * Math.PI * i) / n; return { th, p: th < Math.PI ? (eps * Math.sin(th)) / Math.pow(1 + eps * Math.cos(th), 3) : 0 }; });
  const max = Math.max(...raw.map((r) => r.p), 1e-12);
  return raw.map((r) => ({ th: r.th, p: r.p / max }));
}

export const PLAIN_ASSUMPTIONS =
  'Bushing: mean pressure on the projected area p = F/(d·L), sliding speed v = π·d·n, pv as the heat (wear) limit; limits are typical catalogue values for continuous rotation at room temperature — oscillating motion and good heat paths allow more. Friction coefficients are typical dry/boundary values.';
export const JOURNAL_ASSUMPTIONS =
  'Hydrodynamic full journal bearing with L/D = 1, steady load, Raimondi–Boyd design chart (log-interpolated between tabulated points, as reproduced in Shigley). Constant viscosity at the stated film temperature (Walther–ASTM D341 through the ISO VG 40/100 °C values, VI ≈ 100, density 870 kg/m³); no iteration for the temperature rise, which is estimated by assuming the supplied oil carries all the friction heat. Trumpler’s minimum film thickness rule; surface roughness, misalignment and turbulence not modelled.';
