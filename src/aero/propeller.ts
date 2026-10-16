/**
 * Fixed-pitch propeller by blade element momentum theory (BEM): the blade cut into elements, each with an
 * airfoil lift and drag, the induced axial and swirl velocities from momentum balance on annuli with Prandtl's
 * tip loss. Written with the induced velocity so the static case (no forward speed) works too.
 * Thrust, torque, power, efficiency, the coefficients C_T, C_P against the advance ratio J. SI units.
 */
import { isa } from './ramjet.ts';

export type PropIn = {
  D: number;      // diameter [m]
  B: number;      // number of blades
  PD: number;     // geometric pitch / diameter
  width: number;  // blade width factor (1 = typical light-aircraft blade)
  rpm: number;    // shaft speed [1/min]
  V: number;      // flight speed [m/s]
  h: number;      // altitude [m]
  Peng: number;   // engine shaft power available [W]
};

export const HUB = 0.15;          // hub radius / tip radius
export const ALPHA0 = -4;         // zero-lift angle of the cambered section [°]
export const A_SEC = 5.7;         // section lift slope [1/rad]
export const CLMAX = 1.25, CLMIN = -0.6;

/** Chord / radius along the blade, x = r/R: a typical broad-mid, rounded-tip planform (c/D ≈ 0.1 at the widest). */
export const chordR = (x: number, width = 1) => width * (0.42 * Math.pow(x, 0.8) * Math.sqrt(Math.max(0, 1 - x)) + 0.03);

/** Section lift and drag of a Clark-Y-like cambered section, attached and stalled. */
export function section(alphaDeg: number) {
  const aS = (CLMAX / A_SEC) * (180 / Math.PI) + ALPHA0, aN = (CLMIN / A_SEC) * (180 / Math.PI) + ALPHA0;
  if (alphaDeg > aS) { const d = alphaDeg - aS; return { cl: Math.max(0.8, CLMAX - 0.03 * d), cd: 0.025 + 1.8 * Math.sin((d * Math.PI) / 180) ** 2, stall: true }; }
  if (alphaDeg < aN) { const d = aN - alphaDeg; return { cl: Math.min(-0.3, CLMIN + 0.03 * d), cd: 0.025 + 1.8 * Math.sin((d * Math.PI) / 180) ** 2, stall: true }; }
  const cl = (A_SEC * (alphaDeg - ALPHA0) * Math.PI) / 180;
  return { cl, cd: 0.0085 + 0.007 * (cl - 0.4) ** 2, stall: false };
}

export type Element = { x: number; r: number; dr: number; c: number; beta: number; phi: number; alpha: number; cl: number; cd: number; vi: number; wt: number; dT: number; dQ: number; F: number; stall: boolean };

/** BEM solution for one operating point. */
export function bem(p: PropIn, rho: number, nEl = 24) {
  const R = p.D / 2, W = (p.rpm * Math.PI) / 30, els: Element[] = [];
  let T = 0, Q = 0;
  for (let i = 0; i < nEl; i++) {
    // cosine spacing, denser at hub and tip; element midpoints and widths
    const xa = HUB + (1 - HUB) * (1 - Math.cos((Math.PI * i) / nEl)) / 2, xb = HUB + (1 - HUB) * (1 - Math.cos((Math.PI * (i + 1)) / nEl)) / 2;
    const x = (xa + xb) / 2, r = x * R, dr = (xb - xa) * R, c = chordR(x, p.width) * R;
    const beta = Math.atan(p.PD * p.D / (2 * Math.PI * r));
    let vi = 0.02 * (Math.abs(p.V) + W * r * 0.1), wt = 0, phi = 0, F = 1, sec = section(0), dTb = 0, dQb = 0;
    for (let it = 0; it < 200; it++) {
      const U = p.V + vi, Ut = Math.max(W * r - wt, 1e-6);
      phi = Math.atan2(U, Ut);
      const sp = Math.max(Math.abs(Math.sin(phi)), 1e-4);
      F = (2 / Math.PI) * Math.acos(Math.min(1, Math.exp((-p.B * (R - r)) / (2 * r * sp))));
      F = Math.max(F, 1e-3);
      sec = section(((beta - phi) * 180) / Math.PI);
      const W2 = U * U + Ut * Ut, k = 0.5 * rho * W2 * p.B * c;
      dTb = k * (sec.cl * Math.cos(phi) - sec.cd * Math.sin(phi));
      dQb = k * (sec.cl * Math.sin(phi) + sec.cd * Math.cos(phi)) * r;
      // momentum on the annulus: dT = 4π r ρ F U v_i, dQ = 4π r² ρ F U w_t (per unit radius)
      const s = dTb / (Math.PI * r * rho * F);
      const viN = (-p.V + Math.sqrt(Math.max(p.V * p.V + s, 0))) / 2; // negative when the element windmills
      const Un = Math.max(p.V + viN, 1e-3), wtN = Math.max(0, dQb / (4 * Math.PI * r * r * rho * F * Un));
      const nvi = vi + 0.3 * (viN - vi), nwt = wt + 0.3 * (Math.min(wtN, 0.5 * W * r) - wt);
      const done = Math.abs(nvi - vi) < 1e-6 * (1 + Math.abs(vi)) && Math.abs(nwt - wt) < 1e-6 * (1 + wt);
      vi = nvi; wt = nwt;
      if (done) break;
    }
    T += dTb * dr; Q += dQb * dr;
    els.push({ x, r, dr, c, beta, phi, alpha: ((beta - phi) * 180) / Math.PI, cl: sec.cl, cd: sec.cd, vi, wt, dT: dTb, dQ: dQb, F, stall: sec.stall });
  }
  const n = p.rpm / 60, P = Q * W;
  return { T, Q, P, n, Omega: W, els, CT: T / (rho * n * n * p.D ** 4), CP: P / (rho * n ** 3 * p.D ** 5), J: p.V / (n * p.D), eta: P > 0 && T > 0 ? (T * p.V) / P : 0 };
}

export function propeller(p: PropIn) {
  const atm = isa(p.h), rho = atm.rho, R = p.D / 2, A = Math.PI * R * R;
  const s = bem(p, rho);
  const tipSpeed = s.Omega * R, Mtip = Math.hypot(p.V, tipSpeed) / atm.a;
  const etaIdeal = p.V > 0 && s.T > 0 ? 2 / (1 + Math.sqrt(1 + s.T / (0.5 * rho * p.V * p.V * A))) : 0;
  const FM = s.P > 0 && s.T > 0 ? Math.pow(s.T, 1.5) / (s.P * Math.sqrt(2 * rho * A)) : 0; // static figure of merit (meaningful at V ≈ 0)
  const vSlip = (-p.V + Math.sqrt(p.V * p.V + (2 * Math.max(s.T, 0)) / (rho * A))) / 2;   // mean induced velocity at the disc
  const span = s.els.reduce((a, e) => a + e.dr, 0), stalled = s.els.reduce((a, e) => a + (e.stall ? e.dr : 0), 0) / span;
  const solidity = (p.B * s.els.reduce((a, e) => a + e.c * e.dr, 0)) / (Math.PI * R * R); // blade area / disc area
  const pitch = p.PD * p.D, slip = p.V > 0 ? 1 - p.V / (pitch * s.n) : 1;
  const checks = [
    { ok: s.T > 0, label: 'The propeller pulls (thrust above zero; at higher speed it would windmill)', detail: `T = ${s.T.toFixed(0)} N` },
    { ok: Mtip <= 0.85, label: 'Helical tip Mach number ≤ 0.85 (above it noise and losses rise fast)', detail: `M_tip = ${Mtip.toFixed(3)}, tip speed ${tipSpeed.toFixed(0)} m/s` },
    { ok: s.P <= p.Peng, label: 'Engine can turn the propeller at this speed (power absorbed ≤ engine power)', detail: `${(s.P / 1e3).toFixed(1)} kW ≤ ${(p.Peng / 1e3).toFixed(0)} kW` },
    { ok: stalled <= 0.2, label: 'Blade sections not stalled over more than a fifth of the span', detail: `${(stalled * 100).toFixed(0)} % stalled (common at take-off with a coarse pitch)` },
  ];
  return { ...s, rho, a: atm.a, R, A, tipSpeed, Mtip, etaIdeal, FM, vSlip, stalled, solidity, pitch, slip, checks };
}
export type PropResult = ReturnType<typeof propeller>;

export const PROP_INTRO = 'A propeller is a rotating wing: each blade section meets the air at its own speed and angle and makes lift, which here points forward as thrust. The blade is twisted so that every section works near its best angle at one flight speed — the advance ratio J = V/(nD). Pushing a lot of air a little faster is efficient; a small, heavily loaded propeller throws away more energy in its slipstream.';

export const PROP_NOTES = [
  'Blade element momentum theory: the blade split into 24 elements; each element’s lift and drag (cambered Clark-Y-like section: zero-lift angle −4°, slope 5.7 /rad, c_l from −0.6 to 1.25, simple post-stall model) balanced against the momentum change of its annulus, with Prandtl’s tip loss and swirl. Induced velocities are iterated directly, so the static case works; the hub (15 % of the radius) makes no thrust.',
  'Geometry: constant geometric pitch, blade angle β = atan(P/(2πr)); a typical light-aircraft planform (widest chord about 0.1 D near mid-span, rounded tip) scaled by the width factor. No Reynolds-number or compressibility corrections to the section, no interference with a spinner, cowling or fuselage; real propellers are often 3–8 % less efficient.',
  'Coefficients: J = V/(nD), C_T = T/(ρn²D⁴), C_P = P/(ρn³D⁵), η = T V/P = J C_T/C_P. Ideal (momentum) efficiency 2/(1 + √(1 + T/(q A))) is the upper limit for that thrust. Figure of merit T^1.5/(P√(2ρA)) rates the static (hover-like) case.',
];
