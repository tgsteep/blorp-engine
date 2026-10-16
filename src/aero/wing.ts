/**
 * A wing in steady flight: lift and drag of a straight (unswept) wing from its airfoil, finite-wing lift slope
 * (DATCOM / Helmholtz with Prandtl–Glauert), induced drag with the Oswald factor (Raymer), parabolic drag polar
 * for the whole aircraft, stall speed, best glide and minimum-power speeds, load factor in turns. SI units.
 */
import { isa } from './ramjet.ts';

export const G = 9.80665;

/** NACA four-digit sections: camber m, its position p, thickness t; zero-lift angle, section c_l,max and minimum c_d,
 * approximate values for smooth sections at Re ≈ 6·10⁶ (Abbott & von Doenhoff, Theory of Wing Sections). */
export type AirfoilId = 'n0012' | 'n2412' | 'n4412';
export const AIRFOILS: Record<AirfoilId, { name: string; m: number; p: number; t: number; a0deg: number; clmax: number; cd0: number }> = {
  n0012: { name: 'NACA 0012 (symmetric)', m: 0, p: 0, t: 0.12, a0deg: 0, clmax: 1.55, cd0: 0.0058 },
  n2412: { name: 'NACA 2412 (light aircraft)', m: 0.02, p: 0.4, t: 0.12, a0deg: -2.1, clmax: 1.68, cd0: 0.0062 },
  n4412: { name: 'NACA 4412 (high lift)', m: 0.04, p: 0.4, t: 0.12, a0deg: -4.0, clmax: 1.65, cd0: 0.0065 },
};
export const A0 = 6.0; // section lift slope [1/rad] (measured ≈ 0.105/°, a little below thin-airfoil 2π)

/** NACA four-digit section outline, unit chord: upper surface from the trailing edge to the nose, then lower back (closed). */
export function naca4(m: number, p: number, t: number, n = 40) {
  const pts: [number, number][] = [], up: [number, number][] = [], lo: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const x = (1 - Math.cos((Math.PI * i) / n)) / 2;
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4); // closed trailing edge
    const yc = m === 0 ? 0 : x < p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) ** 2)) * (1 - 2 * p + 2 * p * x - x * x);
    const dy = m === 0 ? 0 : x < p ? ((2 * m) / (p * p)) * (p - x) : ((2 * m) / ((1 - p) ** 2)) * (p - x), th = Math.atan(dy);
    up.push([x - yt * Math.sin(th), yc + yt * Math.cos(th)]); lo.push([x + yt * Math.sin(th), yc - yt * Math.cos(th)]);
  }
  for (let i = n; i >= 0; i--) pts.push(up[i]);
  for (let i = 1; i <= n; i++) pts.push(lo[i]);
  return pts;
}

/** Air viscosity by Sutherland [Pa·s]. */
export const muAir = (T: number) => (1.458e-6 * T ** 1.5) / (T + 110.4);
/** Oswald efficiency of a straight-wing aircraft (Raymer 12.48). */
export const oswald = (A: number) => 1.78 * (1 - 0.045 * Math.pow(A, 0.68)) - 0.64;
/** Finite-wing lift slope [1/rad], unswept, DATCOM form with the Prandtl–Glauert factor β = √(1 − M²). */
export const wingSlope = (A: number, M = 0) => { const eta = A0 / (2 * Math.PI), b = Math.sqrt(Math.max(0.05, 1 - M * M)); return (2 * Math.PI * A) / (2 + Math.sqrt(4 + ((A * b) / eta) ** 2)); };

export type WingIn = {
  airfoil: AirfoilId;
  m: number;     // aircraft mass [kg]
  S: number;     // wing area [m²]
  A: number;     // aspect ratio b²/S
  taper: number; // tip chord / root chord
  CD0: number;   // zero-lift drag coefficient of the whole aircraft
  h: number;     // altitude [m]
  V: number;     // true airspeed [m/s]
  n: number;     // load factor (1 in level flight, 1/cos φ in a level turn)
};

export function wing(p: WingIn) {
  const af = AIRFOILS[p.airfoil], atm = isa(p.h), rho = atm.rho, W = p.m * G, L = p.n * W;
  const b = Math.sqrt(p.A * p.S), cMean = p.S / b, cRoot = (2 * p.S) / (b * (1 + p.taper)), cTip = p.taper * cRoot;
  const q = 0.5 * rho * p.V * p.V, M = p.V / atm.a, mu = muAir(atm.T), Re = (rho * p.V * cMean) / mu;
  const a = wingSlope(p.A, M), e = oswald(p.A), k = 1 / (Math.PI * e * p.A);
  const CLmax = 0.9 * af.clmax, CL = L / (q * p.S);
  const alpha = (CL / a) * (180 / Math.PI) + af.a0deg, alphaStall = (CLmax / a) * (180 / Math.PI) + af.a0deg;
  const CDi = k * CL * CL, CD = p.CD0 + CDi, D = q * p.S * CD, Dp = q * p.S * p.CD0, Di = q * p.S * CDi;
  const P = D * p.V, LD = CL / CD;
  const Vs1 = Math.sqrt((2 * W) / (rho * p.S * CLmax)), Vs = Vs1 * Math.sqrt(p.n);
  const CLmd = Math.sqrt(p.CD0 / k), LDmax = 1 / (2 * Math.sqrt(p.CD0 * k));
  const Vmd = Math.sqrt((2 * W) / (rho * p.S * CLmd)), Vmp = Vmd / Math.pow(3, 0.25);
  const bank = p.n >= 1 ? (Math.acos(1 / p.n) * 180) / Math.PI : 0, turnR = p.n > 1 ? (p.V * p.V) / (G * Math.sqrt(p.n * p.n - 1)) : Infinity;
  const Mroot = (L / 2) * ((4 * (b / 2)) / (3 * Math.PI));                  // elliptic lift, one half-wing
  const sink = p.V / LD;                                                      // glide sink rate at this speed, engine off
  const checks = [
    { ok: CL <= CLmax, label: 'Wing below its stall (C_L ≤ C_L,max)', detail: `C_L = ${CL.toFixed(3)} ≤ ${CLmax.toFixed(2)}, α = ${alpha.toFixed(1)}° (stall at ${alphaStall.toFixed(1)}°)` },
    { ok: p.V >= 1.3 * Vs, label: 'Speed at least 1.3 × the stall speed at this load factor', detail: `V = ${p.V.toFixed(1)} m/s, 1.3 V_s = ${(1.3 * Vs).toFixed(1)} m/s` },
    { ok: M <= 0.6, label: 'Mach number ≤ 0.6 (no shock waves on a straight wing)', detail: `M = ${M.toFixed(3)}` },
    { ok: Re >= 1e6, label: 'Reynolds number ≥ 10⁶ (airfoil data hold; smaller wings lose lift and gain drag)', detail: `Re = ${(Re / 1e6).toFixed(2)}·10⁶` },
  ];
  return { af, rho, T: atm.T, W, L, b, cMean, cRoot, cTip, q, M, Re, a, e, k, CLmax, CL, alpha, alphaStall, CDi, CD, D, Dp, Di, P, LD, Vs1, Vs, CLmd, LDmax, Vmd, Vmp, bank, turnR, Mroot, sink, checks };
}
export type WingResult = ReturnType<typeof wing>;

/** Lift curve for drawing: linear, rounded into the stall at c_l,max, then falling about 0.05 per degree (floor 0.6 c_l,max). */
export function clCurve(alphaDeg: number, slope: number, a0deg: number, clmax: number) {
  const aS = (clmax / slope) * (180 / Math.PI) + a0deg + 1.5;            // stall angle, a little past the straight line's c_l,max
  const lin = (slope * (Math.min(alphaDeg, aS) - a0deg) * Math.PI) / 180, k = 0.8 * clmax;
  const cl = lin <= k ? lin : k + (clmax - k) * Math.tanh((lin - k) / (clmax - k));
  return alphaDeg <= aS ? cl : Math.max(0.6 * clmax, cl - 0.05 * (alphaDeg - aS));
}

export const WING_INTRO = 'A wing pushes air down and the air pushes the wing up. Lift grows with the air density, the square of the speed, the wing area and the angle of attack — until the flow tears off the upper surface and the wing stalls. Making lift costs drag: the slower the flight, the steeper the angle and the stronger the tip vortices, so drag is high when slow and when fast, and lowest in between.';

export const WING_NOTES = [
  'Straight, unswept wing in steady flight: lift L = n W = ½ρV² S C_L, air from the International Standard Atmosphere at the altitude. Finite-wing lift slope a = 2πA/(2 + √(4 + (Aβ/η)²)) with β = √(1 − M²) and η = a₀/2π (DATCOM), a₀ = 6.0 /rad; wing C_L,max = 0.9 c_l,max (Raymer). Section data are approximate values for smooth NACA sections at Re ≈ 6·10⁶ (Abbott & von Doenhoff); flaps, sweep, twist and ground effect are not included.',
  'Drag polar of the whole aircraft: C_D = C_D0 + C_L²/(π e A), Oswald factor e = 1.78(1 − 0.045 A^0.68) − 0.64 for straight wings (Raymer eq. 12.48). Best glide (L/D)_max = ½√(π e A/C_D0) at C_L = √(C_D0 π e A); minimum power at V_md/3^¼. Stall speed V_s = √(2nW/(ρ S C_L,max)); 1.3 V_s is the usual approach margin.',
  'Load factor n = 1/cos φ in a level turn of bank φ, radius V²/(g√(n² − 1)). Root bending moment for an elliptic lift distribution: (L/2)(4 s/(3π)) on each half-wing of semi-span s. Reynolds number on the mean chord with Sutherland viscosity.',
];
