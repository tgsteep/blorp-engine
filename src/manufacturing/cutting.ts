/**
 * Cutting speeds and feeds for turning, face milling and drilling: spindle speed, feed rate, metal removal rate,
 * chip thickness, specific cutting force by Kienzle (k_c = k_c1.1 · h^(−m_c)), cutting force, power, torque,
 * machining time and the theoretical surface roughness of a turned surface.
 * Units: mm, m/min, mm/rev, mm/tooth, N, kW, N·m, min.
 */

export type Check = { ok: boolean; label: string; detail: string };
export type Process = 'turning' | 'milling' | 'drilling';
export type Tool = 'carbide' | 'hss';

/** Typical rounded values from machining handbooks and tool catalogues — confirm with the tool supplier. */
export type CutMaterial = {
  id: string; name: string; iso: 'P' | 'M' | 'K' | 'N' | 'S'; hb: number;
  kc11: number; mc: number; // specific cutting force at h = 1 mm, b = 1 mm [N/mm²] and Kienzle exponent
  vc: Record<Tool, [number, number]>; // recommended cutting speed for turning [m/min]
};
export const CUT_MATERIALS: CutMaterial[] = [
  { id: 'mild', name: 'Mild steel S235', iso: 'P', hb: 120, kc11: 1780, mc: 0.17, vc: { carbide: [200, 320], hss: [30, 45] } },
  { id: 'c45', name: 'Carbon steel C45', iso: 'P', hb: 200, kc11: 2220, mc: 0.14, vc: { carbide: [170, 260], hss: [25, 35] } },
  { id: 'alloy', name: 'Alloy steel 42CrMo4 (Q+T)', iso: 'P', hb: 280, kc11: 2500, mc: 0.26, vc: { carbide: [120, 200], hss: [15, 25] } },
  { id: 'stainless', name: 'Stainless steel 1.4301', iso: 'M', hb: 180, kc11: 2350, mc: 0.21, vc: { carbide: [140, 220], hss: [12, 20] } },
  { id: 'castiron', name: 'Grey cast iron GJL-250', iso: 'K', hb: 210, kc11: 1160, mc: 0.26, vc: { carbide: [150, 250], hss: [18, 28] } },
  { id: 'aluminium', name: 'Aluminium alloy AlMgSi', iso: 'N', hb: 90, kc11: 830, mc: 0.23, vc: { carbide: [300, 900], hss: [100, 250] } },
  { id: 'brass', name: 'Brass CuZn39Pb3', iso: 'N', hb: 110, kc11: 780, mc: 0.18, vc: { carbide: [200, 400], hss: [60, 100] } },
  { id: 'titanium', name: 'Titanium Ti6Al4V', iso: 'S', hb: 330, kc11: 1450, mc: 0.23, vc: { carbide: [40, 80], hss: [8, 15] } },
];
/** Cutting speed of milling and drilling relative to turning (same material and tool family). */
export const PROCESS_VC: Record<Process, Record<Tool, number>> = { turning: { carbide: 1, hss: 1 }, milling: { carbide: 0.9, hss: 0.9 }, drilling: { carbide: 0.5, hss: 0.85 } };
export const vcRange = (m: CutMaterial, p: Process, t: Tool): [number, number] => [m.vc[t][0] * PROCESS_VC[p][t], m.vc[t][1] * PROCESS_VC[p][t]];

/** Kienzle specific cutting force at chip thickness h [mm]. */
export const kc = (m: CutMaterial, h: number) => m.kc11 * Math.pow(Math.max(h, 1e-4), -m.mc);
export const rpm = (vc: number, D: number) => (1000 * vc) / (Math.PI * D);
const rad = (deg: number) => (deg * Math.PI) / 180;

type Machine = { Pmax: number; nmax: number; eta: number }; // spindle power [kW], top speed [rpm], drive efficiency

export type TurnIn = Machine & { mat: CutMaterial; tool: Tool; D: number; vc: number; f: number; ap: number; kappa: number; re: number; L: number; RaMax: number };
export type MillIn = Machine & { mat: CutMaterial; tool: Tool; D: number; z: number; vc: number; fz: number; ap: number; ae: number; kappa: number; L: number };
export type DrillIn = Machine & { mat: CutMaterial; tool: Tool; D: number; vc: number; f: number; point: number; L: number };

function common(p: Machine & { mat: CutMaterial; tool: Tool; vc: number }, proc: Process, n: number, Pc: number) {
  const Pm = Pc / p.eta, [lo, hi] = vcRange(p.mat, proc, p.tool);
  const checks: Check[] = [
    { ok: n <= p.nmax, label: 'Spindle speed within the machine', detail: `n = ${n.toFixed(0)} rpm ≤ ${p.nmax.toFixed(0)} rpm` },
    { ok: Pm <= p.Pmax, label: 'Spindle power is enough', detail: `P = ${Pm.toFixed(2)} kW ≤ ${p.Pmax.toFixed(1)} kW` },
    { ok: p.vc >= lo * 0.8 && p.vc <= hi * 1.15, label: 'Cutting speed in the usual range for this material and tool', detail: `v_c = ${p.vc.toFixed(0)} m/min, typical ${lo.toFixed(0)}…${hi.toFixed(0)}` },
  ];
  return { Pm, lo, hi, checks };
}

export function turning(p: TurnIn) {
  const n = rpm(p.vc, p.D), vf = p.f * n; // mm/min
  const s = Math.sin(rad(p.kappa)), h = p.f * s, b = p.ap / s;
  const k = kc(p.mat, h), Fc = b * h * k; // = a_p f k_c
  const Pc = (Fc * p.vc) / 60000; // kW
  const M = (Fc * p.D) / 2000; // N·m at the workpiece
  const Q = p.vc * p.ap * p.f; // cm³/min
  const Rz = ((p.f * p.f) / (8 * p.re)) * 1000, Ra = Rz / 4; // µm, theoretical (Ra ≈ Rz/4 for the cusp profile)
  const t = p.L / vf;
  const c = common(p, 'turning', n, Pc);
  const checks = [...c.checks,
    { ok: h >= 0.05, label: 'Chip thick enough to cut, not rub: h ≥ 0.05 mm', detail: `h = f sin κ = ${h.toFixed(3)} mm` },
    { ok: p.f <= 0.6 * p.re, label: 'Feed at most 0.6 × nose radius (finish and insert life)', detail: `f = ${p.f.toFixed(2)} ≤ ${(0.6 * p.re).toFixed(2)} mm` },
    { ok: p.ap >= 0.5 * p.re, label: 'Depth of cut at least half the nose radius (chip control)', detail: `a_p = ${p.ap.toFixed(2)} ≥ ${(0.5 * p.re).toFixed(2)} mm` },
    { ok: p.ap <= p.D / 4, label: 'Depth of cut at most a quarter of the diameter', detail: `a_p = ${p.ap.toFixed(2)} ≤ ${(p.D / 4).toFixed(1)} mm` },
    { ok: Ra <= p.RaMax, label: 'Surface roughness meets the drawing', detail: `R_a ≈ ${Ra.toFixed(2)} µm ≤ ${p.RaMax.toFixed(1)} µm` },
  ];
  return { n, vf, h, b, kc: k, Fc, Pc, Pm: c.Pm, M, Q, Rz, Ra, t, vcLo: c.lo, vcHi: c.hi, checks };
}

/** Face milling with the cutter centred on the work (engagement angle φ = 2 asin(a_e/D)). */
export function milling(p: MillIn) {
  const n = rpm(p.vc, p.D), vf = p.fz * p.z * n;
  const ae = Math.min(p.ae, p.D), phi = 2 * Math.asin(ae / p.D), phiDeg = (phi * 180) / Math.PI;
  const hm = (360 * Math.sin(rad(p.kappa)) * ae * p.fz) / (Math.PI * p.D * phiDeg); // mean chip thickness (Sandvik)
  const k = kc(p.mat, hm);
  const Q = (p.ap * ae * vf) / 1000; // cm³/min
  const Pc = (p.ap * ae * vf * k) / 60e6; // kW
  const M = (Pc * 30000) / (Math.PI * n); // N·m
  const zc = Math.max(1, (p.z * phiDeg) / 360); // teeth in cut on average
  const t = (p.L + p.D) / vf;
  const c = common(p, 'milling', n, Pc);
  const checks = [...c.checks,
    { ok: hm >= 0.04, label: 'Mean chip thickness ≥ 0.04 mm (no rubbing)', detail: `h_m = ${hm.toFixed(3)} mm` },
    { ok: hm <= 0.3, label: 'Mean chip thickness ≤ 0.3 mm (edge strength)', detail: `h_m = ${hm.toFixed(3)} mm` },
    { ok: ae >= 0.6 * p.D && ae <= 0.85 * p.D, label: 'Width of cut 60…85 % of the cutter (smooth entry, thin exit)', detail: `a_e/D = ${(ae / p.D * 100).toFixed(0)} %` },
  ];
  return { n, vf, phiDeg, hm, kc: k, Q, Pc, Pm: c.Pm, M, zc, t, vcLo: c.lo, vcHi: c.hi, checks };
}

/** Twist drilling into solid material, two cutting edges. */
export function drilling(p: DrillIn) {
  const n = rpm(p.vc, p.D), vf = p.f * n;
  const s = Math.sin(rad(p.point / 2)), h = (p.f / 2) * s;
  const k = kc(p.mat, h);
  const Fce = (k * p.D * p.f) / 4; // cutting force per edge [N]: k_c · b · h with b = (D/2)/sin(σ/2)
  const M = (k * p.f * p.D * p.D) / 8000; // N·m: two edges at D/4
  const Pc = (p.f * p.vc * p.D * k) / 240000; // kW (= M ω)
  const Ff = 0.6 * 2 * Fce; // N, rough: feed force ≈ 60 % of the summed edge forces
  const Q = (p.vc * p.f * p.D) / 4; // cm³/min
  const t = (p.L + 0.3 * p.D) / vf; // includes the point
  const c = common(p, 'drilling', n, Pc);
  const fr = p.f / p.D;
  const checks = [...c.checks,
    { ok: fr >= 0.005 && fr <= 0.03, label: 'Feed 0.5…3 % of the drill diameter per revolution', detail: `f/D = ${(fr * 100).toFixed(2)} %` },
    { ok: p.L <= 5 * p.D, label: 'Hole depth ≤ 5 × D (deeper: peck drilling or a deep-hole drill)', detail: `L/D = ${(p.L / p.D).toFixed(1)}` },
  ];
  return { n, vf, h, kc: k, Fce, Pc, Pm: c.Pm, M, Ff, Q, t, vcLo: c.lo, vcHi: c.hi, checks };
}

export const CUTTING_INTRO: Record<Process, string> = {
  turning: 'The work turns, the tool moves along it and peels off a chip. Cutting speed (surface speed of the work) is set by the tool and material; feed per revolution and depth of cut set the chip size, the force and the finish. Power = cutting force × cutting speed.',
  milling: 'A cutter with several teeth spins and the work moves under it. Each tooth takes a short, comma-shaped chip; its mean thickness, not the feed per tooth alone, decides the force and the wear. The table feed is feed per tooth × teeth × spindle speed.',
  drilling: 'A twist drill cuts with two edges at its point and lifts the chips out through the flutes. Speed is lower than in turning because the centre barely moves and chips must escape; torque and thrust grow with diameter and feed.',
};

export const CUTTING_NOTES = [
  'Kienzle: k_c = k_c1.1 h^(−m_c) with typical k_c1.1 and m_c for each material (rounded handbook values; tool-maker data can differ by ±20 %). No corrections for rake angle, tool wear, coolant or cutting speed; a worn tool needs about 30 % more force. Recommended cutting speeds are typical ranges for coated carbide and HSS in turning; milling uses 0.9 ×, drilling 0.5 × (carbide) or 0.85 × (HSS) of them. Always start from the tool supplier\'s data.',
  'Turning: F_c = a_p f k_c at h = f sin κ, P_c = F_c v_c/60 000, theoretical roughness R_z = f²/(8 r_ε), R_a ≈ R_z/4 (real surfaces are rougher: vibration, built-up edge). Face milling with the cutter centred: engagement φ = 2 asin(a_e/D), mean chip thickness h_m = 360 sin κ a_e f_z/(π D φ°), P_c = a_p a_e v_f k_c/(60·10⁶). Drilling: h = (f/2) sin(σ/2), torque M = k_c f D²/8000, P_c = f v_c D k_c/240 000 (the same), feed force taken as 60 % of the two edge forces (rough; the chisel edge adds a lot of thrust). Machine power P = P_c/η; time = cutting length/feed rate (no approach, retract or tool change).',
];
