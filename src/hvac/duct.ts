/**
 * Air duct sizing: round (EN 1506 sizes) or rectangular (50 mm steps) duct for an airflow by the equal-friction or
 * the velocity method; Darcy–Weisbach with Colebrook friction on galvanised steel, equivalent diameter of a
 * rectangular duct (Huebscher), fitting losses as K × dynamic pressure, fan pressure and power, specific fan power.
 */
import { frictionFactor } from '../fluids/pipe.ts';

export const ROUND = [63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600]; // mm, EN 1506
export const EPS_DUCT = 0.09e-3;  // galvanised steel, ASHRAE "medium smooth" [m]
export const K_ELBOW = { round: 0.3, rect: 0.25 }; // smooth 90° bend r/D ≈ 1.5 / with turning vanes (typical)

export type Use = 'home' | 'office' | 'industry';
export const USES: Record<Use, { name: string; vmax: number }> = {
  home: { name: 'Homes, bedrooms (quiet)', vmax: 4 },
  office: { name: 'Offices, shops', vmax: 7 },
  industry: { name: 'Industry, plant rooms', vmax: 12 },
};

export type DuctIn = {
  Q: number;          // airflow [m³/h]
  shape: 'round' | 'rect';
  aspect: number;     // rectangular width / height
  method: 'friction' | 'velocity';
  Rt: number;         // design friction rate [Pa/m]
  vt: number;         // design velocity [m/s]
  L: number;          // duct length [m]
  elbows: number;     // number of 90° bends
  dpComp: number;     // filter, coil, silencer, grilles [Pa]
  use: Use;
  etaFan: number;     // fan total efficiency incl. motor
  T: number;          // air temperature [°C]
};

export const airRho = (T: number) => 101325 / (287.05 * (T + 273.15));
export const airMu = (T: number) => 1.716e-5 * Math.pow((T + 273.15) / 273.15, 1.5) * (273.15 + 110.4) / (T + 273.15 + 110.4);
/** Huebscher equivalent diameter of an a × b rectangle (same friction at the same airflow). */
export const deRect = (a: number, b: number) => (1.3 * Math.pow(a * b, 0.625)) / Math.pow(a + b, 0.25);

/** Friction rate [Pa/m] and velocity for airflow Q [m³/s] in a duct of hydraulic size: area A and friction diameter D. */
export function friction(Qs: number, A: number, D: number, T: number) {
  const rho = airRho(T), v = Qs / A, vD = Qs / ((Math.PI / 4) * D * D);   // velocity in the equivalent circle for friction
  const Re = (rho * vD * D) / airMu(T), f = frictionFactor(Re, EPS_DUCT / D);
  return { v, vD, Re, f, R: (f / D) * 0.5 * rho * vD * vD };
}

/** Candidate ducts from small to large. */
function candidates(p: DuctIn) {
  if (p.shape === 'round') return ROUND.map((d) => { const D = d / 1000; return { a: D, b: D, D, A: (Math.PI / 4) * D * D, label: `Ø${d}` }; });
  const out: { a: number; b: number; D: number; A: number; label: string }[] = [];
  for (let h = 100; h <= 2000; h += 50) { const w = Math.max(h, Math.round((p.aspect * h) / 50) * 50); out.push({ a: w / 1000, b: h / 1000, D: deRect(w / 1000, h / 1000), A: (w * h) / 1e6, label: `${w} × ${h}` }); }
  return out;
}

export function duct(p: DuctIn) {
  const Qs = p.Q / 3600, rho = airRho(p.T);
  const cand = candidates(p);
  const meets = (c: (typeof cand)[number]) => { const fr = friction(Qs, c.A, c.D, p.T); return p.method === 'friction' ? fr.R <= p.Rt : fr.v <= p.vt; };
  const pick = cand.find(meets) ?? cand[cand.length - 1];
  const fr = friction(Qs, pick.A, pick.D, p.T);
  const pd = 0.5 * rho * fr.v * fr.v, K = K_ELBOW[p.shape];
  const dpDuct = fr.R * p.L, dpFit = p.elbows * K * pd, dpTot = dpDuct + dpFit + p.dpComp;
  const Pfan = (Qs * dpTot) / p.etaFan, SFP = Pfan / Qs;
  // exact round diameter for the design friction rate (for comparison)
  let lo = 0.02, hi = 4; for (let i = 0; i < 60; i++) { const m = Math.sqrt(lo * hi); if (friction(Qs, (Math.PI / 4) * m * m, m, p.T).R > p.Rt) lo = m; else hi = m; }
  const Dexact = hi;
  const vmax = USES[p.use].vmax;
  const checks = [
    { ok: fr.v <= vmax, label: 'Air velocity quiet enough for the use', detail: `v = ${fr.v.toFixed(2)} m/s ≤ ${vmax} m/s (${USES[p.use].name})` },
    { ok: fr.R <= 2, label: 'Friction rate ≤ 2 Pa/m (above it fan energy grows quickly)', detail: `R = ${fr.R.toFixed(2)} Pa/m` },
    { ok: SFP <= 1250, label: 'Specific fan power ≤ 1250 W per m³/s (SFP 3 of EN 16798-3)', detail: `SFP = ${SFP.toFixed(0)} W/(m³/s), fan ${Pfan.toFixed(0)} W` },
    ...(p.shape === 'rect' ? [{ ok: pick.a / pick.b <= 4, label: 'Aspect ratio ≤ 4 (flatter ducts cost more and lose more)', detail: `${(pick.a / pick.b).toFixed(2)}` }] : []),
    { ok: meets(pick), label: 'A standard size meets the sizing rule', detail: pick.label },
  ];
  return { Qs, rho, pick, ...fr, pd, K, dpDuct, dpFit, dpTot, Pfan, SFP, Dexact, vmax, checks };
}
export type DuctResult = ReturnType<typeof duct>;

export const DUCT_INTRO = 'A duct carries air from the fan to the rooms. A small duct is cheap and fits above the ceiling, but the air must rush through it: friction and noise grow roughly with the square of the speed, and the fan has to work harder all year. The usual way is to pick a friction rate or a velocity that keeps the system quiet and the fan power low, then choose the next standard size.';

export const DUCT_NOTES = [
  'Darcy–Weisbach with the Colebrook friction factor, galvanised steel ε = 0.09 mm (ASHRAE "medium smooth"), air density from the ideal gas at 101.325 kPa and the given temperature, Sutherland viscosity. Rectangular ducts by their Huebscher equivalent diameter D_e = 1.30 (ab)^0.625/(a + b)^0.25 (same friction at the same airflow); the velocity shown is the real one in the rectangle.',
  'Sizing: the smallest standard size (round EN 1506, rectangular in 50 mm steps at the chosen aspect ratio) whose friction rate or velocity stays at or below the design value. 90° bends as K × ½ρv² with K = 0.3 (round, r/D ≈ 1.5) or 0.25 (rectangular with turning vanes); filters, coils, silencers and grilles as one pressure drop. Branches, tees and system effects at the fan are not included.',
  'Fan electric power P = Q Δp/η_total; specific fan power SFP = P/Q compared with SFP 3 (1250 W per m³/s) of EN 16798-3. Velocity limits are typical comfort guidance for main ducts (homes 4, offices 7, plant 12 m/s); branch ducts near the rooms should be slower.',
];
