/**
 * Further gear types. Geometry after ISO 21771 / DIN 3960 style formulas, simplified where noted.
 * Units: mm, N, N·m, rpm, angles in degrees at the interface.
 */
import { computeSpur, inv, invInverse } from './spur.ts';

export type Check = { ok: boolean; label: string; detail: string };
export type Row = { sym: string; eq: string; val: string; unit?: string };
const R = Math.PI / 180;
const f = (v: number, n = 3) => (Number.isFinite(v) ? v.toFixed(n) : '—');

/* ---------------- Helical pair ---------------- */
export type HelicalIn = { mn: number; z1: number; z2: number; betaDeg: number; alphaNDeg: number; x1: number; x2: number; b: number; n1: number; T1: number };
export function computeHelical(p: HelicalIn) {
  const b = p.betaDeg * R, an = p.alphaNDeg * R;
  const at = Math.atan(Math.tan(an) / Math.cos(b));
  const mt = p.mn / Math.cos(b);
  const d1 = mt * p.z1, d2 = mt * p.z2;
  const db1 = d1 * Math.cos(at), db2 = d2 * Math.cos(at);
  const da1 = d1 + 2 * p.mn * (1 + p.x1), da2 = d2 + 2 * p.mn * (1 + p.x2);
  const df1 = d1 - 2 * p.mn * (1.25 - p.x1), df2 = d2 - 2 * p.mn * (1.25 - p.x2);
  const awt = invInverse(inv(at) + (2 * Math.tan(an) * (p.x1 + p.x2)) / (p.z1 + p.z2));
  const a = (d1 + d2) / 2, aw = (a * Math.cos(at)) / Math.cos(awt);
  const ga = Math.sqrt((da1 / 2) ** 2 - (db1 / 2) ** 2) + Math.sqrt((da2 / 2) ** 2 - (db2 / 2) ** 2) - aw * Math.sin(awt);
  const epsA = ga / (Math.PI * mt * Math.cos(at));
  const epsB = (p.b * Math.sin(b)) / (Math.PI * p.mn);
  const u = p.z2 / p.z1;
  const Ft = (2000 * p.T1) / d1, Fr = Ft * Math.tan(awt), Fa = Ft * Math.tan(b);
  const zn1 = p.z1 / Math.cos(b) ** 3;
  const xmin1 = 1 - (zn1 * Math.sin(an) ** 2) / 2;
  const checks: Check[] = [
    { ok: epsA >= 1.1, label: 'Transverse contact ratio ε_α ≥ 1.1', detail: `ε_α = ${f(epsA)}` },
    { ok: epsB >= 1, label: 'Overlap ratio ε_β ≥ 1 (quiet running)', detail: `ε_β = ${f(epsB)}` },
    { ok: p.x1 >= xmin1 - 1e-9, label: 'No undercut, pinion (virtual z_n)', detail: `x₁ = ${f(p.x1, 2)} ≥ ${f(xmin1)}` },
  ];
  const rows: Row[] = [
    { sym: 'm_t', eq: `m_n/cos β = ${p.mn}/cos ${p.betaDeg}°`, val: f(mt), unit: 'mm' },
    { sym: 'α_t', eq: 'atan(tan α_n / cos β)', val: f(at / R), unit: '°' },
    { sym: 'd₁', eq: `m_t·z₁`, val: f(d1, 2), unit: 'mm' },
    { sym: 'd₂', eq: `m_t·z₂`, val: f(d2, 2), unit: 'mm' },
    { sym: 'a_w', eq: 'a·cos α_t / cos α_wt', val: f(aw), unit: 'mm' },
    { sym: 'ε_α', eq: 'g_α / (π m_t cos α_t)', val: f(epsA) },
    { sym: 'ε_β', eq: `b·sin β / (π m_n)`, val: f(epsB) },
    { sym: 'ε_γ', eq: 'ε_α + ε_β (total)', val: f(epsA + epsB) },
    { sym: 'F_t', eq: '2T₁/d₁', val: f(Ft / 1000), unit: 'kN' },
    { sym: 'F_r', eq: 'F_t·tan α_wt', val: f(Fr / 1000), unit: 'kN' },
    { sym: 'F_a', eq: 'F_t·tan β (axial thrust!)', val: f(Fa / 1000), unit: 'kN' },
  ];
  return { mt, at, d1, d2, db1, db2, da1, da2, df1, df2, aw, awt, epsA, epsB, u, Ft, Fr, Fa, checks, rows };
}

/* ---------------- Internal pair (ring + pinion), x = 0 ---------------- */
export type InternalIn = { m: number; z1: number; z2: number; alphaDeg: number; n1: number; T1: number };
export function computeInternal(p: InternalIn) {
  const al = p.alphaDeg * R;
  const r1 = (p.m * p.z1) / 2, r2 = (p.m * p.z2) / 2;
  const rb1 = r1 * Math.cos(al), rb2 = r2 * Math.cos(al);
  const ra1 = r1 + p.m, ra2 = r2 - p.m; // ring tip is inside
  const a = r2 - r1;
  const ga = Math.sqrt(ra1 ** 2 - rb1 ** 2) - Math.sqrt(Math.max(ra2 ** 2 - rb2 ** 2, 0)) + a * Math.sin(al);
  const eps = ga / (Math.PI * p.m * Math.cos(al));
  const u = p.z2 / p.z1;
  const n2 = p.n1 / u, T2 = p.T1 * u, Ft = (2000 * p.T1) / (2 * r1);
  const checks: Check[] = [
    { ok: eps >= 1.2, label: 'Contact ratio ε_α ≥ 1.2', detail: `ε_α = ${f(eps)}` },
    { ok: p.z2 - p.z1 >= 10, label: 'Tooth difference z₂ − z₁ ≥ 10 (no tip interference, α = 20°)', detail: `z₂ − z₁ = ${p.z2 - p.z1}` },
    { ok: ra2 > rb2, label: 'Ring tip outside its base circle', detail: `r_a2 = ${f(ra2, 2)} > r_b2 = ${f(rb2, 2)}` },
  ];
  const rows: Row[] = [
    { sym: 'u', eq: `z₂/z₁ = ${p.z2}/${p.z1} (same direction!)`, val: f(u) },
    { sym: 'a', eq: 'm(z₂ − z₁)/2', val: f(a, 2), unit: 'mm' },
    { sym: 'd_a2', eq: 'm·z₂ − 2m (ring tip inside)', val: f(2 * ra2, 2), unit: 'mm' },
    { sym: 'ε_α', eq: '(√(r_a1²−r_b1²) − √(r_a2²−r_b2²) + a·sin α)/(π m cos α)', val: f(eps) },
    { sym: 'n₂', eq: 'n₁/u', val: f(n2, 1), unit: 'rpm' },
    { sym: 'T₂', eq: 'u·T₁ (η = 1)', val: f(T2, 1), unit: 'N·m' },
    { sym: 'F_t', eq: '2T₁/d₁', val: f(Ft / 1000), unit: 'kN' },
  ];
  return { r1, r2, rb1, rb2, ra1, ra2, a, eps, u, checks, rows };
}

/* ---------------- Rack and pinion ---------------- */
export type RackIn = { m: number; z: number; alphaDeg: number; x: number; n: number; T: number };
export function computeRack(p: RackIn) {
  const al = p.alphaDeg * R;
  const r = (p.m * p.z) / 2, rb = r * Math.cos(al), ra = r + p.m * (1 + p.x);
  const ga = Math.sqrt(ra ** 2 - rb ** 2) - r * Math.sin(al) + (p.m * (1 - p.x)) / Math.sin(al);
  const eps = ga / (Math.PI * p.m * Math.cos(al));
  const travel = Math.PI * p.m * p.z; // per pinion revolution
  const v = (travel * p.n) / 60000; // m/s
  const Ft = (2000 * p.T) / (2 * r), Fr = Ft * Math.tan(al);
  const xmin = 1 - (p.z * Math.sin(al) ** 2) / 2;
  const checks: Check[] = [
    { ok: eps >= 1.2, label: 'Contact ratio ε_α ≥ 1.2', detail: `ε_α = ${f(eps)}` },
    { ok: p.x >= xmin - 1e-9, label: 'No undercut on the pinion', detail: `x = ${f(p.x, 2)} ≥ ${f(xmin)}` },
  ];
  const rows: Row[] = [
    { sym: 'd', eq: `m·z = ${p.m}×${p.z}`, val: f(2 * r, 2), unit: 'mm' },
    { sym: 's/rev', eq: 'π·m·z (rack travel per turn)', val: f(travel, 2), unit: 'mm' },
    { sym: 'v', eq: 'π·d·n/60', val: f(v, 3), unit: 'm/s' },
    { sym: 'ε_α', eq: '(√(r_a²−r_b²) − r sin α + m(1−x)/sin α)/(π m cos α)', val: f(eps) },
    { sym: 'F_t', eq: '2T/d (rack pushing force)', val: f(Ft / 1000), unit: 'kN' },
    { sym: 'F_r', eq: 'F_t·tan α (separating force)', val: f(Fr / 1000), unit: 'kN' },
  ];
  return { r, rb, ra, eps, travel, v, Ft, Fr, checks, rows };
}

/* ---------------- Straight bevel pair, Σ = 90° ---------------- */
export type BevelIn = { m: number; z1: number; z2: number; b: number; alphaDeg: number; T1: number };
export function computeBevel(p: BevelIn) {
  const d1 = Math.atan(p.z1 / p.z2), d2 = Math.PI / 2 - d1;
  const de1 = p.m * p.z1, de2 = p.m * p.z2;
  const Re = de1 / (2 * Math.sin(d1));
  const dm1 = de1 - p.b * Math.sin(d1);
  const zv1 = p.z1 / Math.cos(d1), zv2 = p.z2 / Math.cos(d2);
  const mm = p.m * (1 - (0.5 * p.b) / Re); // mean module
  const sp = computeSpur({ m: mm, z1: zv1, z2: zv2, alphaDeg: p.alphaDeg, x1: 0, x2: 0, n1: 0, T1: 0 });
  const al = p.alphaDeg * R;
  const Ft = (2000 * p.T1) / dm1;
  const Fr1 = Ft * Math.tan(al) * Math.cos(d1), Fa1 = Ft * Math.tan(al) * Math.sin(d1);
  const checks: Check[] = [
    { ok: p.b <= Re / 3, label: 'Face width b ≤ R_e/3', detail: `${p.b} ≤ ${f(Re / 3, 1)} mm` },
    { ok: p.b <= 10 * p.m, label: 'Face width b ≤ 10·m', detail: `${p.b} ≤ ${10 * p.m} mm` },
    { ok: sp.epsAlpha >= 1.2, label: 'Contact ratio (virtual spur) ε_α ≥ 1.2', detail: `ε_α = ${f(sp.epsAlpha)}` },
  ];
  const rows: Row[] = [
    { sym: 'δ₁', eq: `atan(z₁/z₂)`, val: f(d1 / R), unit: '°' },
    { sym: 'δ₂', eq: '90° − δ₁', val: f(d2 / R), unit: '°' },
    { sym: 'd_e1', eq: 'm·z₁ (at the heel)', val: f(de1, 2), unit: 'mm' },
    { sym: 'R_e', eq: 'd_e1 / (2 sin δ₁) (cone length)', val: f(Re, 2), unit: 'mm' },
    { sym: 'z_v1', eq: 'z₁/cos δ₁ (virtual spur)', val: f(zv1, 2) },
    { sym: 'ε_α', eq: 'contact ratio of the virtual spur pair', val: f(sp.epsAlpha) },
    { sym: 'F_t', eq: '2T₁/d_m1 (at mid face)', val: f(Ft / 1000), unit: 'kN' },
    { sym: 'F_r1', eq: 'F_t·tan α·cos δ₁', val: f(Fr1 / 1000), unit: 'kN' },
    { sym: 'F_a1', eq: 'F_t·tan α·sin δ₁', val: f(Fa1 / 1000), unit: 'kN' },
  ];
  return { d1, d2, de1, de2, Re, dm1, zv1, zv2, eps: sp.epsAlpha, Ft, Fr1, Fa1, checks, rows };
}

/* ---------------- Worm gear, Σ = 90° ---------------- */
export type WormIn = { m: number; z1: number; q: number; z2: number; mu: number; n1: number; T1: number };
export const wormEfficiency = (gamma: number, rho: number) => Math.tan(gamma) / Math.tan(gamma + rho);
export function computeWorm(p: WormIn) {
  const an = 20 * R;
  const d1 = p.q * p.m, d2 = p.m * p.z2;
  const gamma = Math.atan(p.z1 / p.q);
  const rho = Math.atan(p.mu / Math.cos(an));
  const eta = wormEfficiency(gamma, rho);
  const etaBack = gamma > rho ? Math.tan(gamma - rho) / Math.tan(gamma) : 0;
  const u = p.z2 / p.z1, a = (d1 + d2) / 2;
  const vs = (Math.PI * d1 * p.n1) / 60000 / Math.cos(gamma);
  const Ft1 = (2000 * p.T1) / d1, Ft2 = Ft1 / Math.tan(gamma + rho), Fr = Ft2 * Math.tan(an);
  const T2 = p.T1 * u * eta;
  const checks: Check[] = [
    { ok: eta >= 0.5, label: 'Efficiency η ≥ 50 %', detail: `η = ${f(eta * 100, 1)} %` },
    { ok: true, label: gamma <= rho ? 'Self-locking: the wheel cannot drive the worm' : 'Not self-locking: the load can back-drive', detail: `γ = ${f(gamma / R, 2)}°, ρ′ = ${f(rho / R, 2)}°` },
    { ok: p.z2 >= 28, label: 'Wheel teeth z₂ ≥ 28 (no undercut, α = 20°)', detail: `z₂ = ${p.z2}` },
  ];
  const rows: Row[] = [
    { sym: 'd₁', eq: `q·m = ${p.q}×${p.m}`, val: f(d1, 2), unit: 'mm' },
    { sym: 'd₂', eq: `m·z₂`, val: f(d2, 2), unit: 'mm' },
    { sym: 'a', eq: '(d₁ + d₂)/2', val: f(a, 2), unit: 'mm' },
    { sym: 'γ', eq: `atan(z₁/q) (lead angle)`, val: f(gamma / R, 2), unit: '°' },
    { sym: 'ρ′', eq: 'atan(μ/cos α_n) (friction angle)', val: f(rho / R, 2), unit: '°' },
    { sym: 'η', eq: 'tan γ / tan(γ + ρ′)', val: f(eta * 100, 1), unit: '%' },
    { sym: 'u', eq: `z₂/z₁ = ${p.z2}/${p.z1}`, val: f(u, 1) },
    { sym: 'v_s', eq: 'π d₁ n₁ / cos γ (sliding speed)', val: f(vs, 2), unit: 'm/s' },
    { sym: 'T₂', eq: 'T₁·u·η', val: f(T2, 1), unit: 'N·m' },
    { sym: 'F_t2', eq: 'F_t1 / tan(γ + ρ′) = F_a1', val: f(Ft2 / 1000), unit: 'kN' },
  ];
  return { d1, d2, a, gamma, rho, eta, etaBack, u, vs, Ft1, Ft2, Fr, T2, checks, rows };
}

/* ---------------- Planetary set ---------------- */
export type Fixed = 'ring' | 'carrier' | 'sun';
export type PlanetIn = { m: number; zs: number; zp: number; np: number; fixed: Fixed; nIn: number; TIn: number };
export function computePlanetary(p: PlanetIn) {
  const zr = p.zs + 2 * p.zp;
  const a = (p.m * (p.zs + p.zp)) / 2;
  // Willis: (n_s − n_c)/(n_r − n_c) = −z_r/z_s
  let ns = 0, nc = 0, nr = 0, inName = '', outName = '', i = 0;
  if (p.fixed === 'ring') { ns = p.nIn; nc = ns / (1 + zr / p.zs); inName = 'sun'; outName = 'carrier'; i = ns / nc; }
  else if (p.fixed === 'carrier') { ns = p.nIn; nr = (-ns * p.zs) / zr; inName = 'sun'; outName = 'ring'; i = ns / nr; }
  else { nr = p.nIn; nc = nr / (1 + p.zs / zr); inName = 'ring'; outName = 'carrier'; i = nr / nc; }
  const np_rel = ((ns - nc) * -p.zs) / p.zp; // planet speed relative to carrier
  const assembly = (p.zs + zr) / p.np;
  const daP = p.m * (p.zp + 2);
  const gap = 2 * a * Math.sin(Math.PI / p.np) - daP;
  const TOut = p.TIn * Math.abs(i); // η = 1
  const checks: Check[] = [
    { ok: Math.abs(assembly - Math.round(assembly)) < 1e-9, label: 'Equal spacing possible: (z_s + z_r)/n_p is a whole number', detail: `${p.zs + zr}/${p.np} = ${f(assembly, 2)}` },
    { ok: gap > 0.5 * p.m, label: 'Neighbouring planets do not touch', detail: `gap = ${f(gap, 2)} mm` },
    { ok: p.zs >= 13 && p.zp >= 13, label: 'Sun and planets ≥ 13 teeth (no undercut, simplified)', detail: `z_s = ${p.zs}, z_p = ${p.zp}` },
  ];
  const rows: Row[] = [
    { sym: 'z_r', eq: `z_s + 2z_p = ${p.zs} + 2×${p.zp}`, val: String(zr) },
    { sym: 'a', eq: 'm(z_s + z_p)/2 (sun–planet centre distance)', val: f(a, 2), unit: 'mm' },
    { sym: 'i', eq: `n_${inName}/n_${outName}`, val: f(i, 3) },
    { sym: 'n_s', eq: 'sun speed', val: f(ns, 1), unit: 'rpm' },
    { sym: 'n_c', eq: 'carrier speed', val: f(nc, 1), unit: 'rpm' },
    { sym: 'n_r', eq: 'ring speed', val: f(nr, 1), unit: 'rpm' },
    { sym: 'T_out', eq: '|i|·T_in (η = 1)', val: f(TOut, 1), unit: 'N·m' },
  ];
  return { zr, a, ns, nc, nr, np_rel, i, inName, outName, TOut, checks, rows };
}
