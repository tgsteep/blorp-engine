/**
 * Strength of an FDM-printed part against its print orientation. A printed part is anisotropic: along the extruded
 * lines (in a layer) it is nearly as strong as moulded plastic, across the layers only the weld between them carries
 * load. The part is analysed as beams (axial force, bending, transverse shear) on a composite section — a solid shell
 * of wall loops and top/bottom skins around an infill core with Gibson–Ashby-type properties (E ρ², σ ρ^1.5) — and
 * every stress point is checked with the Tsai–Hill criterion in the layer's axes. Loads scale linearly, so the failure
 * load is F/√(Tsai–Hill index). Units: N, mm, MPa, g.
 */
export type Check = { ok: boolean; label: string; detail: string };
export type PsFil = 'pla' | 'petg' | 'abs' | 'asa' | 'pc' | 'pacf';
/** Typical printed-part values (rounded, from published FDM test data; they vary with printer, temperature, layer
 *  height and drying): X tensile strength along the lines, Y across the layers (layer weld), S interlayer shear [MPa];
 *  E1 along the lines, E2 across the layers [MPa]; density [g/cm³]. */
export const PS_FILS: Record<PsFil, { name: string; X: number; Y: number; S: number; E1: number; E2: number; rho: number; color: string }> = {
  pla: { name: 'PLA', X: 50, Y: 30, S: 25, E1: 3200, E2: 2900, rho: 1.24, color: '#E07B00' },
  petg: { name: 'PETG', X: 45, Y: 30, S: 22, E1: 2000, E2: 1800, rho: 1.27, color: '#2E8BC0' },
  abs: { name: 'ABS', X: 35, Y: 18, S: 15, E1: 2100, E2: 1800, rho: 1.04, color: '#D9D9D4' },
  asa: { name: 'ASA', X: 38, Y: 20, S: 16, E1: 2000, E2: 1800, rho: 1.07, color: '#3C4048' },
  pc: { name: 'PC', X: 60, Y: 35, S: 28, E1: 2300, E2: 2100, rho: 1.2, color: '#9DB4C8' },
  pacf: { name: 'Nylon PA-CF', X: 80, Y: 30, S: 25, E1: 6000, E2: 2500, rho: 1.2, color: '#2B2E33' },
};
export type PartId = 'bar' | 'beam' | 'bracket' | 'hook';
export const PARTS: PartId[] = ['bar', 'beam', 'bracket', 'hook'];
/** side: the part's profile plane lies on the bed (layers parallel to the profile, everything in a layer);
 *  tilt: the build direction lies in the profile plane at θ from the part's y axis (θ = 0 → layers stacked along y). */
export type Orient = 'side' | 'tilt';
export const LINE_W = 0.45, LAYER_H = 0.2; // line width and layer height of a 0.4 mm nozzle [mm]
export const BAR = { b: 10, h: 4, L0: 80, area: 2720 }; // ISO 527-2 type 1A: narrow section 10 × 4, gauge 80 mm, outline ≈ 2720 mm²

export type PsIn = {
  part: PartId; fil: PsFil; orient: Orient; theta: number; // build-direction angle [°] (tilt)
  walls: number; skins: number; infill: number;            // wall loops, top/bottom layers, infill fraction 0…1
  F: number;                                               // load [N]
  L: number; b: number; h: number; ri: number;             // span / arm length, width, depth (thickness), hook inner radius [mm]
};

type V2 = [number, number];
/** Tsai–Hill index for in-layer stresses σ1 (along the layer), σ2 (across the layers) and shear τ12. */
export const tsaiHill = (s1: number, s2: number, t12: number, X: number, Y: number, S: number) => (s1 * s1 - s1 * s2) / (X * X) + (s2 * s2) / (Y * Y) + (t12 * t12) / (S * S);
/** Uniaxial strength at an angle θ [rad] between the stress and the layer plane (Tsai–Hill). */
export const offAxisStrength = (th: number, X: number, Y: number, S: number) => { const c = Math.cos(th), s = Math.sin(th); return 1 / Math.sqrt((c ** 4 - c * c * s * s) / (X * X) + s ** 4 / (Y * Y) + (c * c * s * s) / (S * S)); };
/** Modulus along a direction at θ [rad] to the layer plane (orthotropic, ν12 0.35, G12 = E2/2.7). */
export const offAxisModulus = (th: number, E1: number, E2: number) => { const c = Math.cos(th), s = Math.sin(th), G = E2 / 2.7; return 1 / (c ** 4 / E1 + s ** 4 / E2 + (1 / G - 0.7 / E1) * s * s * c * c); };

/** Composite rectangle b (along z) × h (in the profile plane): solid shell ty on the two faces normal to the depth,
 *  tz on the two faces normal to the width, infill core with relative modulus n = ρ². */
export function section(b: number, h: number, ty: number, tz: number, rho: number) {
  const bc = Math.max(0, b - 2 * tz), hc = Math.max(0, h - 2 * ty), n = rho * rho;
  const A = b * h, Ac = bc * hc, Aeff = A - Ac + n * Ac;
  const I = (b * h ** 3) / 12 - (bc * hc ** 3) / 12 + (n * bc * hc ** 3) / 12;
  const Q = (b * h * h) / 8 - (bc * hc * hc) / 8 + (n * bc * hc * hc) / 8, wEff = b - bc + n * bc; // first moment above the axis, effective width
  const solid = bc === 0 || hc === 0;
  return { b, h, ty, tz, bc, hc, n, A, Ac, Aeff, I, Q, wEff, solid, fill: (A - Ac + rho * Ac) / A };
}
export type Section = ReturnType<typeof section>;

/** One beam section of the part: axis direction a in the profile plane, axial force N, moment M, shear V, curved-beam
 *  factor K for the inner fibre, and its name for the result rows. */
type Member = { key: string; name: string; a: V2; N: number; M: number; V: number; K: number };

/** Winkler factor: inner-fibre stress of a curved rectangular beam over the straight-beam value (Shigley eq. 3-65). */
export function winklerKi(ri: number, h: number) {
  const ro = ri + h, rc = ri + h / 2, rn = h / Math.log(ro / ri), e = rc - rn;
  const sCurved = (rn - ri) / (h * e * ri), sStraight = 6 / (h * h); // per unit M and unit width
  return sCurved / sStraight;
}

export function members(p: PsIn): { list: Member[]; b: number; h: number; len: number; defl: ((EI: number) => number) | null; span: number } {
  const F = p.F;
  if (p.part === 'bar') return { list: [{ key: 'gauge', name: 'gauge section', a: [1, 0], N: F, M: 0, V: 0, K: 1 }], b: BAR.b, h: BAR.h, len: BAR.area / BAR.b, defl: null, span: BAR.L0 };
  if (p.part === 'beam') return { list: [{ key: 'mid', name: 'mid-span', a: [1, 0], N: 0, M: (F * p.L) / 4, V: F / 2, K: 1 }], b: p.b, h: p.h, len: p.L + 20, defl: (EI) => (F * p.L ** 3) / (48 * EI), span: p.L };
  if (p.part === 'bracket') return {
    list: [
      { key: 'arm', name: 'arm at the corner', a: [1, 0], N: 0, M: F * p.L, V: F, K: 1 },
      { key: 'leg', name: 'leg at the corner', a: [0, 1], N: F, M: F * p.L, V: 0, K: 1 },
    ], b: p.b, h: p.h, len: 2 * p.L, defl: (EI) => (F * p.L ** 3) / (3 * EI), span: p.L,
  };
  // hook: load hangs at the bottom of the bend; the largest moment F r_c acts where the bend meets the shank (tangent vertical)
  const rc = p.ri + p.h / 2;
  return { list: [{ key: 'bend', name: 'bend beside the shank', a: [0, 1], N: F, M: F * rc, V: 0, K: winklerKi(p.ri, p.h) }], b: p.b, h: p.h, len: 3 * rc + Math.PI * rc, defl: null, span: rc };
}

/** Build direction in the part's axes (x, y in the profile plane, z across it). */
export const buildDir = (o: Orient, thetaDeg: number): [number, number, number] => { const t = (thetaDeg * Math.PI) / 180; return o === 'side' ? [0, 0, 1] : [Math.sin(t), Math.cos(t), 0]; };

export function printStrength(p: PsIn) {
  const M = PS_FILS[p.fil], { list, b, h, len, defl, span } = members(p);
  const bd = buildDir(p.orient, p.theta), tw = Math.max(1, p.walls) * LINE_W, ts = Math.max(1, p.skins) * LAYER_H, rho = Math.min(1, Math.max(0, p.infill));
  const shell = (nx: number, ny: number, nz: number) => { const c = nx * bd[0] + ny * bd[1] + nz * bd[2]; return tw + (ts - tw) * c * c; }; // wall where the face is parallel to the build direction, skin where normal to it
  const pts = list.map((m) => {
    const ty = shell(-m.a[1], m.a[0], 0), tz = shell(0, 0, 1), sec = section(b, h, ty, tz, rho);
    // stresses along the member axis: tension fibre (axial + bending), shear at the neutral axis, edge of the core
    const sig = m.N / sec.Aeff + (m.K * Math.abs(m.M) * h) / 2 / sec.I;
    const tau = sec.wEff > 0 ? (Math.abs(m.V) * sec.Q) / (sec.I * sec.wEff) : 0;
    const sigC = sec.n * (m.N / sec.Aeff + (Math.abs(m.M) * sec.hc) / 2 / sec.I);
    // angle of the axis to the layer plane and the stresses in the layer's axes (1 along, 2 across the layers)
    const ad = m.a[0] * bd[0] + m.a[1] * bd[1], phi = Math.asin(Math.min(1, Math.abs(ad))) * Math.sign(ad || 1);
    const c = Math.cos(phi), s = Math.sin(phi);
    const thAt = (sx: number, txy: number) => {
      if (p.orient === 'side') return (sx * sx + 3 * txy * txy) / (M.X * M.X); // all in one layer: von Mises with the line strength
      const s1 = sx * c * c + 2 * txy * s * c, s2 = sx * s * s - 2 * txy * s * c, t12 = -sx * s * c + txy * (c * c - s * s);
      return tsaiHill(s1, s2, t12, M.X, M.Y, M.S);
    };
    const across = (sx: number, txy: number) => { if (p.orient === 'side') return 0; const s2 = sx * s * s - 2 * txy * s * c, t12 = -sx * s * c + txy * (c * c - s * s), th = thAt(sx, txy); return th > 0 ? (s2 * s2 / (M.Y * M.Y) + t12 * t12 / (M.S * M.S)) / th : 0; };
    const cand = [
      { where: 'outer fibre', th: thAt(sig, 0), inter: across(sig, 0) },
      { where: 'shear at the neutral axis', th: thAt(0, tau), inter: across(0, tau) },
      ...(sec.solid || rho <= 0 ? [] : [{ where: 'infill core', th: thAt(sigC, 0) / rho ** 3, inter: across(sigC, 0) }]),
    ];
    const worst = cand.reduce((a, x) => (x.th > a.th ? x : a));
    const Ea = p.orient === 'side' ? M.E1 : offAxisModulus(Math.abs(phi), M.E1, M.E2);
    return { m, sec, sig, tau, sigC, phiDeg: (Math.abs(phi) * 180) / Math.PI, worst, Ea };
  });
  const crit = pts.reduce((a, x) => (x.worst.th > a.worst.th ? x : a));
  const u = Math.sqrt(Math.max(crit.worst.th, 1e-30)), Ff = p.F / u, SF = 1 / u;
  const interlayer = crit.worst.inter > 0.5;
  const fill = pts[0].sec.fill, mass = ((p.part === 'bar' ? BAR.area * BAR.h : len * b * h) * fill * M.rho) / 1000; // g (mm³ · g/cm³ / 1000)
  const delta = defl ? defl(Math.min(...pts.map((q) => q.Ea)) * Math.min(...pts.map((q) => q.sec.I))) : null;
  return { M, pts, crit, u, Ff, SF, interlayer, mass, delta, span, b, h, bd, tw, ts };
}
export type PsResult = ReturnType<typeof printStrength> & { best: { Ff: number; orient: Orient; theta: number }; checks: Check[] };

/** Failure load against the build angle θ (tilt) — and the side orientation for comparison. */
export function orientSweep(p: PsIn, n = 46) {
  const tilt = Array.from({ length: n }, (_, i) => { const theta = (90 * i) / (n - 1); return { theta, Ff: printStrength({ ...p, orient: 'tilt', theta }).Ff }; });
  return { tilt, side: printStrength({ ...p, orient: 'side' }).Ff };
}

export function printStrengthFull(p: PsIn): PsResult {
  const r = printStrength(p), sw = orientSweep(p, 19);
  const bestTilt = sw.tilt.reduce((a, x) => (x.Ff > a.Ff ? x : a));
  const best = sw.side >= bestTilt.Ff ? { Ff: sw.side, orient: 'side' as Orient, theta: 0 } : { Ff: bestTilt.Ff, orient: 'tilt' as Orient, theta: bestTilt.theta };
  const checks: Check[] = [
    { ok: r.SF >= 2, label: 'Failure load at least twice the load (safety factor 2 for printed parts)', detail: `F_f = ${r.Ff.toFixed(0)} N, SF = ${r.SF.toFixed(2)}` },
    { ok: r.Ff >= 0.9 * best.Ff, label: 'Print orientation within 10 % of the strongest one', detail: `${r.Ff.toFixed(0)} N here, ${best.Ff.toFixed(0)} N at the best orientation` },
    ...(r.delta !== null ? [{ ok: r.delta <= r.span / 100, label: 'Deflection at most 1/100 of the span or arm', detail: `δ = ${r.delta.toFixed(2)} mm ≤ ${(r.span / 100).toFixed(2)} mm` }] : []),
    { ok: p.walls >= 2, label: 'At least 2 walls (load-bearing parts usually 3–4)', detail: `${p.walls} walls = ${r.tw.toFixed(2)} mm` },
  ];
  return { ...r, best, checks };
}

export const PS_INTRO = 'A printed part is built from thin lines welded side by side and layer on layer. Along the lines it is almost as strong as the plastic itself, but across the layers only the weld between them holds — often half as strong or less. So the same part can carry twice the load or break early depending only on how it lay on the print bed. Choose a part, the load and the orientation, and see where and how it fails.';
export const PS_NOTES = [
  'Material values are typical rounded figures for printed parts (strength along the lines X, across the layers Y, interlayer shear S, moduli E1/E2); real values change with the printer, nozzle temperature, layer height, cooling and moisture — test your own prints for anything that matters.',
  'Each part is treated as beams: the tension fibre (axial force plus bending), the transverse shear at the neutral axis and the edge of the infill core are checked. The section is a solid shell — wall loops (0.45 mm each) on faces parallel to the build direction and top/bottom skins (0.2 mm layers) on faces normal to it, blended for faces in between — around an infill core with E·ρ² and strength·ρ^1.5 (Gibson–Ashby-type power laws).',
  'Failure follows the Tsai–Hill criterion in the layer axes (1 along the layer, 2 across the layers); in the side orientation every stress lies in a layer and the line strength is used with von Mises. Compression is checked with the tensile strengths (conservative); stress concentrations at holes, corners and the inner corner of the bracket are not included — round inside corners generously.',
  'Parts: ISO 527-2 type 1A tensile bar (10 × 4 mm narrow section, pulled along its axis); a beam on two supports with a central load; a shelf bracket with the load at the tip of the arm (arm and leg checked at the corner, the leg also carries the load as tension); a hook whose largest moment F·r_c acts where the bend meets the shank, with the Winkler curved-beam factor for the inner fibre. Deflection uses the modulus along the member and the composite section. Creep under a lasting load and fatigue are not included.',
];
