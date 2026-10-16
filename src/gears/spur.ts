/**
 * External spur gear pair — involute geometry after ISO 21771,
 * standard basic rack (ha* = 1, hf* = 1.25), zero backlash.
 * All lengths in mm, angles in rad unless named *Deg.
 */

export type SpurInput = {
  m: number; // module [mm]
  z1: number; // pinion teeth
  z2: number; // wheel teeth
  alphaDeg: number; // pressure angle [deg]
  x1: number; // profile shift coefficient, pinion
  x2: number; // profile shift coefficient, wheel
  n1: number; // pinion speed [rpm]
  T1: number; // pinion torque [N·m]
};

export type Check = { ok: boolean; label: string; detail: string };

export type SpurResult = {
  u: number;
  d1: number; d2: number;
  db1: number; db2: number;
  da1: number; da2: number;
  df1: number; df2: number;
  a: number; // reference centre distance
  y: number; // centre distance modification coefficient (a_w − a)/m
  k: number; // tip alteration coefficient y − (x₁ + x₂) ≤ 0 (tips shortened to keep the clearance)
  dw1: number; dw2: number; // working pitch diameters
  h: number; // tooth depth
  aw: number; // working centre distance
  alphaW: number; // working pressure angle [rad]
  ga: number; // length of path of contact
  pb: number; // base pitch
  epsAlpha: number; // transverse contact ratio
  xmin1: number; xmin2: number; // undercut limits
  sa1: number; sa2: number; // tip thickness
  c1: number; c2: number; // tip clearances (pinion tip / wheel tip)
  n2: number; T2: number;
  Ft: number; Fr: number; // [N]
  v: number; // pitch line velocity [m/s]
  checks: Check[];
};

export const inv = (a: number) => Math.tan(a) - a;

/** Inverse involute by Newton iteration. */
export function invInverse(target: number): number {
  let a = Math.cbrt(3 * target); // good start for small angles
  for (let i = 0; i < 50; i++) {
    const t = Math.tan(a);
    const step = (t - a - target) / (t * t);
    a -= step;
    if (Math.abs(step) < 1e-14) break;
  }
  return a;
}

export function computeSpur(p: SpurInput): SpurResult {
  const { m, z1, z2, x1, x2 } = p;
  const al = (p.alphaDeg * Math.PI) / 180;
  const d1 = m * z1, d2 = m * z2;
  const db1 = d1 * Math.cos(al), db2 = d2 * Math.cos(al);
  const df1 = d1 - 2 * m * (1.25 - x1), df2 = d2 - 2 * m * (1.25 - x2);

  const alphaW = invInverse(inv(al) + (2 * Math.tan(al) * (x1 + x2)) / (z1 + z2));
  const a = (m * (z1 + z2)) / 2;
  const aw = (a * Math.cos(al)) / Math.cos(alphaW);
  const y = (aw - a) / m;
  const k = Math.min(0, y - (x1 + x2)); // ISO 21771 tip alteration: shorten the tips so c = 0.25 m stays
  const da1 = d1 + 2 * m * (1 + x1 + k), da2 = d2 + 2 * m * (1 + x2 + k);
  const dw1 = (2 * aw * z1) / (z1 + z2), dw2 = (2 * aw * z2) / (z1 + z2);
  const h = (da1 - df1) / 2;

  const ra1 = da1 / 2, ra2 = da2 / 2, rb1 = db1 / 2, rb2 = db2 / 2;
  const ga = Math.sqrt(ra1 ** 2 - rb1 ** 2) + Math.sqrt(ra2 ** 2 - rb2 ** 2) - aw * Math.sin(alphaW);
  const pb = Math.PI * m * Math.cos(al);
  const epsAlpha = ga / pb;

  const s2 = Math.sin(al) ** 2;
  const xmin1 = 1 - (z1 * s2) / 2, xmin2 = 1 - (z2 * s2) / 2;

  const tip = (z: number, x: number, da: number, db: number) =>
    da * (Math.PI / (2 * z) + (2 * x * Math.tan(al)) / z + inv(al) - inv(Math.acos(db / da)));
  const sa1 = tip(z1, x1, da1, db1), sa2 = tip(z2, x2, da2, db2);

  const c1 = aw - ra1 - df2 / 2, c2 = aw - ra2 - df1 / 2;

  const u = z2 / z1;
  const n2 = p.n1 / u, T2 = p.T1 * u;
  const Ft = (2000 * p.T1) / d1;
  const Fr = Ft * Math.tan(alphaW);
  const v = (Math.PI * d1 * p.n1) / 60000;

  const f = (n: number, k = 3) => n.toFixed(k);
  const checks: Check[] = [
    { ok: epsAlpha >= 1.2, label: 'Contact ratio ε_α ≥ 1.2', detail: `ε_α = ${f(epsAlpha)}` },
    { ok: x1 >= xmin1 - 1e-9, label: 'No undercut, pinion', detail: `x₁ = ${f(x1, 2)} ≥ x_min = ${f(xmin1)}` },
    { ok: x2 >= xmin2 - 1e-9, label: 'No undercut, wheel', detail: `x₂ = ${f(x2, 2)} ≥ x_min = ${f(xmin2)}` },
    { ok: Math.min(sa1, sa2) >= 0.25 * m, label: 'Tip thickness s_a ≥ 0.25 m', detail: `s_a1 = ${f(sa1, 2)}, s_a2 = ${f(sa2, 2)} mm` },
    { ok: Math.min(c1, c2) >= 0.1 * m, label: 'Tip clearance c ≥ 0.1 m', detail: `c_min = ${f(Math.min(c1, c2))} mm` },
  ];

  return { u, d1, d2, db1, db2, da1, da2, df1, df2, a, y, k, dw1, dw2, h, aw, alphaW, ga, pb, epsAlpha, xmin1, xmin2, sa1, sa2, c1, c2, n2, T2, Ft, Fr, v, checks };
}

/**
 * General involute outline in polar form [r0, θ0, r1, θ1, …], tooth 0 centred on θ = 0.
 * rp: pitch radius, alpha: profile angle at rp [rad], s: tooth thickness on rp (arc length),
 * ra / rf: tip / root radius. Below the base circle the flank is a radial line.
 */
export function involuteOutline(z: number, rp: number, alpha: number, s: number, ra: number, rf: number, samples = 8, arcPts = 3): number[] {
  const rb = rp * Math.cos(alpha);
  const half = (rr: number) => Math.max(s / (2 * rp) + inv(alpha) - inv(Math.acos(Math.min(1, rb / rr))), 0.002);
  const rs = Math.max(rb, rf);
  const step = (2 * Math.PI) / z;
  const hb = half(rs), ht = half(ra);
  const out: number[] = [];
  for (let i = 0; i < z; i++) {
    const phi = i * step;
    out.push(rf, phi - hb);
    for (let k = 0; k <= samples; k++) { const rr = rs + ((ra - rs) * k) / samples; out.push(rr, phi - half(rr)); }
    for (let k = 1; k < arcPts; k++) out.push(ra, phi - ht + (2 * ht * k) / arcPts);
    for (let k = samples; k >= 0; k--) { const rr = rs + ((ra - rs) * k) / samples; out.push(rr, phi + half(rr)); }
    out.push(rf, phi + hb);
    const gap = step - 2 * hb;
    for (let k = 1; k < arcPts; k++) out.push(rf, phi + hb + (gap * k) / arcPts);
  }
  return out;
}

/** Standard external spur gear outline (basic rack h_a* = 1, h_f* = 1.25), tip alteration k·m. */
export function gearOutline(z: number, m: number, alphaDeg: number, x: number, samples = 8, arcPts = 3, k = 0): number[] {
  const al = (alphaDeg * Math.PI) / 180, r = (m * z) / 2;
  return involuteOutline(z, r, al, m * (Math.PI / 2 + 2 * x * Math.tan(al)), r + m * (1 + x + k), r - m * (1.25 - x), samples, arcPts);
}

/** SVG path of a polar outline rotated by `rot` [rad] and moved to (cx, cy). */
export function outlinePath(polar: number[], rot = 0, cx = 0, cy = 0): string {
  let d = '';
  for (let i = 0; i < polar.length; i += 2) {
    const r = polar[i], t = polar[i + 1] + rot;
    d += (i ? 'L' : 'M') + (cx + r * Math.cos(t)).toFixed(2) + ' ' + (cy + r * Math.sin(t)).toFixed(2);
  }
  return d + 'Z';
}

/** Convenience: unrotated SVG path at the origin. */
export const gearPath = (z: number, m: number, alphaDeg: number, x: number) => outlinePath(gearOutline(z, m, alphaDeg, x));

/** Points for drawing the mesh: pitch point C, base tangent points T1/T2, contact path A→E. */
export function meshPoints(r: SpurResult, z1: number, z2: number) {
  const { aw, alphaW: w } = r;
  const rb1 = r.db1 / 2, rb2 = r.db2 / 2, ra1 = r.da1 / 2, ra2 = r.da2 / 2;
  const rw1 = (aw * z1) / (z1 + z2), rw2 = aw - rw1;
  const dx = Math.sin(w), dy = Math.cos(w);
  const T1 = { x: rb1 * Math.cos(w), y: -rb1 * Math.sin(w) };
  const T2 = { x: rw1 + rw2 * Math.sin(w) * dx, y: rw2 * Math.sin(w) * dy };
  const g1 = Math.sqrt(ra1 ** 2 - rb1 ** 2), g2 = Math.sqrt(ra2 ** 2 - rb2 ** 2);
  const E = { x: T1.x + g1 * dx, y: T1.y + g1 * dy };
  const A = { x: T2.x - g2 * dx, y: T2.y - g2 * dy };
  return { rw1, rw2, T1, T2, A, E };
}

export const SPUR_NOTES =
  'Involute geometry after ISO 21771: standard basic rack (hₐ* = 1, c* = 0.25), zero backlash, η = 1. With profile shift the tips are shortened by k·m (k = y − x₁ − x₂) so the standard tip clearance 0.25 m is kept. Undercut is checked, not drawn. Face width b is the strength input. Validated: the geometry reproduces the worked examples of the KHK Gear Technical Reference (standard pair and profile-shifted pair m 3, z 12/24, x 0.6/0.36: α_w, y, a_w, d, d_b, d_w, d_a, d_f, h) within 0.001 mm; these examples use the same formulas as ISO 21771.';
