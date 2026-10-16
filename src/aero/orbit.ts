/**
 * Orbits around one body (two-body problem, Kepler): circular speed and period, escape speed, Hohmann transfer
 * between two circular orbits with an optional plane change combined into the burn at the larger radius,
 * bi-elliptic transfer for comparison, and the propellant the transfer needs (Tsiolkovsky). SI units.
 */
export const G0 = 9.80665;

export type BodyId = 'earth' | 'moon' | 'mars';
/** μ [m³/s²], equatorial radius [m], lowest practical circular orbit [m] (atmosphere / terrain), sphere of influence [m]. */
export const BODIES: Record<BodyId, { name: string; mu: number; R: number; hMin: number; soi: number; color: string }> = {
  earth: { name: 'Earth', mu: 3.986004418e14, R: 6378.137e3, hMin: 160e3, soi: 924e6, color: '#2F6DB5' },
  moon: { name: 'Moon', mu: 4.9028e12, R: 1737.4e3, hMin: 10e3, soi: 66.1e6, color: '#A9A49A' },
  mars: { name: 'Mars', mu: 4.282837e13, R: 3396.2e3, hMin: 130e3, soi: 577e6, color: '#C1440E' },
};

export const vCirc = (mu: number, r: number) => Math.sqrt(mu / r);
export const period = (mu: number, a: number) => 2 * Math.PI * Math.sqrt((a * a * a) / mu);
/** Vis-viva: speed at radius r on an orbit of semi-major axis a. */
export const visViva = (mu: number, r: number, a: number) => Math.sqrt(mu * (2 / r - 1 / a));

/** Hohmann transfer r1 → r2 (either direction); plane change Δi [rad] made in the burn at the larger radius. */
export function hohmann(mu: number, r1: number, r2: number, di = 0) {
  const a = (r1 + r2) / 2, v1 = vCirc(mu, r1), v2 = vCirc(mu, r2), vt1 = visViva(mu, r1, a), vt2 = visViva(mu, r2, a);
  const burn = (vt: number, vc: number, i: number) => Math.sqrt(Math.max(0, vt * vt + vc * vc - 2 * vt * vc * Math.cos(i)));
  const dv1 = burn(vt1, v1, r1 > r2 ? di : 0), dv2 = burn(vt2, v2, r2 >= r1 ? di : 0);
  return { a, e: Math.abs(r2 - r1) / (r1 + r2), v1, v2, vt1, vt2, dv1, dv2, dv: dv1 + dv2, t: period(mu, a) / 2 };
}

/** Bi-elliptic transfer r1 → rb → r2 (rb ≥ r1, r2): three burns. rb = Infinity gives the parabolic limit. */
export function biElliptic(mu: number, r1: number, r2: number, rb: number) {
  const v1 = vCirc(mu, r1), v2 = vCirc(mu, r2);
  if (!Number.isFinite(rb)) return { dv: (Math.SQRT2 - 1) * (v1 + v2), t: Infinity };
  const a1 = (r1 + rb) / 2, a2 = (r2 + rb) / 2;
  const dv = Math.abs(visViva(mu, r1, a1) - v1) + Math.abs(visViva(mu, rb, a2) - visViva(mu, rb, a1)) + Math.abs(visViva(mu, r2, a2) - v2);
  return { dv, t: period(mu, a1) / 2 + period(mu, a2) / 2 };
}

export type OrbitIn = {
  body: BodyId;
  h1: number;    // altitude of the starting circular orbit [m]
  h2: number;    // altitude of the target circular orbit [m]
  di: number;    // plane change [deg]
  mDry: number;  // spacecraft mass without propellant [kg]
  mProp: number; // propellant loaded [kg]
  Isp: number;   // specific impulse of the engine [s]
};

export function orbit(p: OrbitIn) {
  const b = BODIES[p.body], mu = b.mu, r1 = b.R + p.h1, r2 = b.R + p.h2, di = (p.di * Math.PI) / 180;
  const h = hohmann(mu, r1, r2, di), h0 = hohmann(mu, r1, r2, 0);
  const T1 = period(mu, r1), T2 = period(mu, r2), vEsc1 = Math.SQRT2 * h.v1;
  const dvPlaneLow = 2 * Math.min(h.v1, h.v2) * Math.sin(di / 2);  // plane change alone at the slower (outer) orbit
  const dvSeparate = h0.dv + dvPlaneLow;                            // same job with the plane change as its own burn
  const bi = biElliptic(mu, r1, r2, 2 * Math.max(r1, r2)), biInf = biElliptic(mu, r1, r2, Infinity);
  const ve = p.Isp * G0, m0 = p.mDry + p.mProp;
  const dvAvail = ve * Math.log(m0 / p.mDry);
  const mUsed = m0 * (1 - Math.exp(-h.dv / ve));
  const dvEscape = vEsc1 - h.v1;                                    // to leave the body from the starting orbit
  const g1 = mu / (r1 * r1);                                        // gravity at the starting orbit
  const checks = [
    { ok: p.h1 >= b.hMin && p.h2 >= b.hMin, label: `Both orbits above the lowest practical altitude (${(b.hMin / 1e3).toFixed(0)} km for the ${b.name})`, detail: `h₁ = ${(p.h1 / 1e3).toFixed(0)} km, h₂ = ${(p.h2 / 1e3).toFixed(0)} km` },
    { ok: r2 < b.soi && r1 < b.soi, label: 'Target orbit inside the sphere of influence (the body still dominates)', detail: `r₂ = ${(r2 / 1e3).toFixed(0)} km < ${(b.soi / 1e3).toFixed(0)} km` },
    { ok: h.dv <= dvAvail, label: 'Spacecraft carries enough propellant for the transfer', detail: `Δv = ${(h.dv / 1e3).toFixed(3)} km/s ≤ ${(dvAvail / 1e3).toFixed(3)} km/s available` },
    { ok: Math.max(r1, r2) / Math.min(r1, r2) <= 11.94, label: 'Hohmann is the cheapest transfer (r₂/r₁ ≤ 11.94; above that a bi-elliptic transfer needs less Δv)', detail: `r₂/r₁ = ${(Math.max(r1, r2) / Math.min(r1, r2)).toFixed(2)}` },
  ];
  return { b, mu, r1, r2, ...h, T1, T2, vEsc1, dvPlaneLow, dvSeparate, dvNoPlane: h0.dv, bi, biInf, ve, dvAvail, mUsed, dvEscape, g1, checks };
}
export type OrbitResult = ReturnType<typeof orbit>;

/** Eccentric anomaly from the mean anomaly (Newton), for drawing a craft moving along an ellipse at the right pace. */
export function eccAnomaly(M: number, e: number) {
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 30; i++) { const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-12) break; }
  return E;
}

export const ORBIT_INTRO = 'A spacecraft in orbit is falling all the time, but moving sideways so fast that the ground curves away beneath it. Lower orbits are faster and shorter. To climb to a higher orbit the craft speeds up, coasts half way round on an ellipse, and speeds up again at the top — the Hohmann transfer, the cheapest way with two burns between circular orbits.';

export const ORBIT_NOTES = [
  'Two-body problem: a point-mass spacecraft around a spherical body, no drag, no other bodies, burns taken as instantaneous (impulsive). Circular speed v = √(μ/r), period T = 2π√(a³/μ), vis-viva v = √(μ(2/r − 1/a)), escape speed √2 v. μ and radii: Earth 398 600.4418 km³/s² (WGS 84), Moon 4902.8, Mars 42 828.37 km³/s².',
  'Hohmann transfer between coplanar circular orbits: a = (r₁ + r₂)/2, Δv₁ = v_t1 − v₁, Δv₂ = v₂ − v_t2, time π√(a³/μ). A plane change Δi is combined with the burn at the larger radius, where the speeds are lowest: Δv = √(v_t² + v_c² − 2 v_t v_c cos Δi). Bi-elliptic for comparison with the intermediate radius r_b = 2 r_max and the limit r_b → ∞; for r₂/r₁ > 11.94 the limit beats Hohmann, at the cost of a very long trip.',
  'Propellant from the rocket equation: m_p = m₀ (1 − e^(−Δv/(I_sp g₀))); finite burn losses, phasing, launch and gravity losses, station keeping and the lowest orbit (set by atmospheric drag, roughly 160 km for Earth) are not included.',
];
