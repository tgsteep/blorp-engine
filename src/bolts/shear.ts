/**
 * Bolt (pin) in double shear — clevis / fork joint, loose fit in all parts.
 * Beam model: the middle plate loads the pin with F spread uniformly over t_S,
 * each fork plate reacts F/2 spread uniformly over t_G. Statically determinate.
 * Units: N, mm, MPa.
 */
export type ShearInput = {
  d: number; // pin / shank diameter [mm]
  F: number; // transverse load [N]
  tS: number; // middle plate thickness [mm]
  tG: number; // each fork plate thickness [mm]
  Rp: number; // bolt yield [MPa]
  ReP: number; // plate yield [MPa]
  S: number; // required safety factor
};

export const SHEAR_ASSUMPTIONS =
  'Loose fit in all three parts, uniform bearing pressure over each plate, no friction from preload (worst case: the joint has slipped), static load. Yield checks with von Mises: τ_allow = R_p0.2/(√3·S). Bearing limit simplified to R_e,plate/S.';

export function computeShear(p: ShearInput) {
  const { d, F, tS, tG } = p;
  const L = 2 * tG + tS;
  const A = (Math.PI * d * d) / 4;
  const W = (Math.PI * d ** 3) / 32;

  // shear force V(x) and bending moment M(x) along the pin, x from the outer face of fork plate 1
  const w1 = F / 2 / tG, w2 = F / tS;
  const V = (x: number) => {
    if (x <= tG) return w1 * x;
    if (x <= tG + tS) return F / 2 - w2 * (x - tG);
    return -F / 2 + w1 * (x - tG - tS);
  };
  const M = (x: number) => {
    if (x <= tG) return (w1 * x * x) / 2;
    if (x <= tG + tS) { const u = x - tG; return (F * tG) / 4 + (F / 2) * u - (w2 * u * u) / 2; }
    const u = L - x;
    return (w1 * u * u) / 2;
  };
  const N = 60;
  const xs = [...Array.from({ length: N + 1 }, (_, i) => (L * i) / N), tG, tG + tS / 2, tG + tS].sort((a, b) => a - b);
  const Vs = xs.map(V), Ms = xs.map(M);

  const Mmax = (F * (tS + 2 * tG)) / 8;
  const sb = Mmax / W;
  const tauAvg = F / 2 / A;
  const tauMax = (4 / 3) * tauAvg; // solid circle, at the neutral axis
  const pS = F / (d * tS), pG = F / 2 / (d * tG);
  const sbAllow = p.Rp / p.S, tauAllow = p.Rp / (Math.sqrt(3) * p.S), pAllow = p.ReP / p.S;

  const checks = [
    { ok: sb <= sbAllow, label: 'Bending σ_b ≤ R_p0.2/S', detail: `${sb.toFixed(0)} ≤ ${sbAllow.toFixed(0)} MPa` },
    { ok: tauMax <= tauAllow, label: 'Shear τ_max ≤ R_p0.2/(√3·S)', detail: `${tauMax.toFixed(0)} ≤ ${tauAllow.toFixed(0)} MPa` },
    { ok: Math.max(pS, pG) <= pAllow, label: 'Bearing p ≤ R_e,plate/S', detail: `${Math.max(pS, pG).toFixed(0)} ≤ ${pAllow.toFixed(0)} MPa` },
  ];
  return { L, A, W, xs, Vs, Ms, Mmax, sb, tauAvg, tauMax, pS, pG, sbAllow, tauAllow, pAllow, checks };
}
export type ShearResult = ReturnType<typeof computeShear>;
