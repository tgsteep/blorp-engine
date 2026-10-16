/**
 * Tensile test (ISO 6892-1 round proportional specimen) and the stress–strain curve of typical engineering materials.
 *
 * The engineering curve σ = F/S₀ against e = ΔL/L₀ is built from the material's catalogue values so that it passes
 * exactly through them:
 *  - continuous yielding metals: Ramberg–Osgood e_p = 0.002 (σ/R_p0.2)^N up to the 0.2 % proof stress, then
 *    σ = R_p0.2 + (R_m − R_p0.2)·(1 − (1 − s)^m), s = (e_p − 0.002)/(e_p,u − 0.002), so the curve peaks at R_m with zero
 *    slope at the uniform elongation A_g (start of necking); N is set so the slope is continuous at R_p0.2 — for
 *    materials with a rounder knee a given N is matched by a fast-saturating share β of the hardening, β (1 − (1 − s)^100);
 *  - mild steels: elastic to the upper yield point R_eH, drop to the lower yield point R_eL, Lüders plateau, then the
 *    same hardening law from the end of the plateau;
 *  - after necking (A_g … A): σ = R_m (1 − drop·s²) — schematic, it depends on the gauge length;
 *  - grey cast iron: Ramberg–Osgood with the 0.1 % proof stress to fracture at R_m, no necking;
 *  - thermoplastics: rise to the yield stress σ_y at e_y, drop to the drawing stress while a neck forms, cold drawing
 *    (the neck runs along the specimen at the natural draw ratio λ), then strain hardening to break.
 * True stress σ_t = σ (1 + e) and true strain ε = ln(1 + e) hold up to necking (uniform deformation); there the
 * curve satisfies Considère's condition dσ_t/dε = σ_t. In the neck the true values come from the reduction of area Z:
 * ε_f = ln(1/(1 − Z)), σ_t,f = σ_f/(1 − Z) (no Bridgman correction for the triaxial stress).
 * Units: MPa, mm, kN, strains as fractions.
 */

export type Check = { ok: boolean; label: string; detail: string };
export type MatKind = 'plateau' | 'round' | 'brittle' | 'polymer';

export type TensileMat = {
  id: string; name: string; short: string; kind: MatKind;
  E: number; nu: number; rho: number;        // Young's modulus [MPa], Poisson's ratio, density [kg/m³]
  Re: number;                                // R_eL (mild steel), R_p0.2, R_p0.1 (cast iron) or yield stress σ_y (polymer) [MPa]
  Rm: number;                                // tensile strength (highest engineering stress) [MPa]
  A: number;                                 // elongation after fracture (polymers: at break)
  Ag?: number; Z?: number;                   // uniform elongation, reduction of area (metals that neck)
  ReH?: number; eL?: number;                 // upper yield point, end of the Lüders plateau (total strain)
  m?: number; drop?: number;                 // hardening shape exponent, fall of the engineering stress to fracture / R_m
  N?: number;                                // Ramberg–Osgood exponent below R_p0.2 (rounder knee; default: from the hardening slope)
  ey?: number; sd?: number; lam?: number; sb?: number; // polymer: strain at yield, drawing stress, natural draw ratio, stress at break
  note: string;
};

/** Typical rounded values (EN/ASTM minimum strengths where a standard gives them, typical ductility). Check the certificate. */
export const MATERIALS: TensileMat[] = [
  { id: 's235', name: 'Structural steel S235JR (EN 10025-2)', short: 'S235', kind: 'plateau', E: 210000, nu: 0.3, rho: 7850, Re: 235, ReH: 250, Rm: 400, Ag: 0.2, A: 0.26, Z: 0.6, eL: 0.015, m: 2.2, drop: 0.28, note: 'EN 10025-2, t ≤ 16 mm' },
  { id: 's355', name: 'Structural steel S355J2 (EN 10025-2)', short: 'S355', kind: 'plateau', E: 210000, nu: 0.3, rho: 7850, Re: 355, ReH: 375, Rm: 510, Ag: 0.16, A: 0.22, Z: 0.55, eL: 0.012, m: 2.2, drop: 0.25, note: 'EN 10025-2, t ≤ 16 mm' },
  { id: 'c45', name: 'Steel C45, quenched and tempered (EN ISO 683-1)', short: 'C45 +QT', kind: 'round', E: 210000, nu: 0.3, rho: 7850, Re: 490, Rm: 750, Ag: 0.08, A: 0.14, Z: 0.45, m: 2.5, drop: 0.22, note: 'EN ISO 683-1, d ≤ 16 mm' },
  { id: '42crmo4', name: 'Steel 42CrMo4, quenched and tempered (EN ISO 683-2)', short: '42CrMo4 +QT', kind: 'round', E: 210000, nu: 0.3, rho: 7850, Re: 900, Rm: 1100, Ag: 0.05, A: 0.12, Z: 0.5, m: 2.5, drop: 0.25, note: 'EN ISO 683-2, d ≤ 16 mm' },
  { id: '304', name: 'Stainless steel 1.4301 (304), annealed (EN 10088-2)', short: 'Stainless 304', kind: 'round', E: 200000, nu: 0.29, rho: 7900, Re: 230, Rm: 600, Ag: 0.5, A: 0.55, Z: 0.7, m: 1.4, N: 7, drop: 0.15, note: 'EN 10088-2' },
  { id: 'al5754', name: 'Aluminium 5754-O, annealed (EN 485-2)', short: 'Al 5754-O', kind: 'round', E: 70000, nu: 0.33, rho: 2670, Re: 90, Rm: 210, Ag: 0.18, A: 0.22, Z: 0.65, m: 1.8, N: 12, drop: 0.15, note: 'EN 485-2' },
  { id: 'al6082', name: 'Aluminium 6082-T6 (EN 755-2)', short: 'Al 6082-T6', kind: 'round', E: 70000, nu: 0.33, rho: 2700, Re: 260, Rm: 310, Ag: 0.07, A: 0.1, Z: 0.35, m: 3, N: 25, drop: 0.18, note: 'EN 755-2' },
  { id: 'cu', name: 'Copper Cu-ETP R220, annealed (EN 13601)', short: 'Copper', kind: 'round', E: 120000, nu: 0.34, rho: 8930, Re: 70, Rm: 230, Ag: 0.35, A: 0.45, Z: 0.8, m: 1.6, N: 10, drop: 0.3, note: 'EN 13601, R220' },
  { id: 'ti64', name: 'Titanium Ti-6Al-4V, annealed (ASTM B265 grade 5)', short: 'Ti-6Al-4V', kind: 'round', E: 114000, nu: 0.34, rho: 4430, Re: 880, Rm: 950, Ag: 0.08, A: 0.14, Z: 0.35, m: 3, N: 30, drop: 0.2, note: 'ASTM B265 grade 5' },
  { id: 'gjl250', name: 'Grey cast iron EN-GJL-250 (EN 1561)', short: 'Grey cast iron', kind: 'brittle', E: 110000, nu: 0.26, rho: 7200, Re: 170, Rm: 250, A: 0.006, note: 'EN 1561, R_p0.1' },
  { id: 'pc', name: 'Polycarbonate PC (ISO 527, 23 °C)', short: 'Polycarbonate', kind: 'polymer', E: 2400, nu: 0.37, rho: 1200, Re: 62, Rm: 66, A: 1.1, ey: 0.06, sd: 52, lam: 1.9, sb: 66, note: 'ISO 527, 23 °C, 50 mm/min' },
  { id: 'hdpe', name: 'High-density polyethylene HDPE (ISO 527, 23 °C)', short: 'HDPE', kind: 'polymer', E: 1000, nu: 0.45, rho: 955, Re: 26, Rm: 30, A: 6, ey: 0.1, sd: 18, lam: 5.5, sb: 30, note: 'ISO 527, 23 °C, 50 mm/min' },
];

/** Name of the yield value shown for this material. */
export const yieldName = (m: TensileMat) => (m.kind === 'plateau' ? 'R_eL' : m.kind === 'brittle' ? 'R_p0.1' : m.kind === 'polymer' ? 'σ_y' : 'R_p0.2');
export const isMetal = (m: TensileMat) => m.kind !== 'polymer';

/** Shape parameters of the curve (see the file header). */
export function curveParams(m: TensileMat) {
  if (m.kind === 'round' || m.kind === 'plateau') {
    const Ag = m.Ag!, mm = m.m ?? 3, epu = Ag - m.Rm / m.E;
    const ep0 = m.kind === 'plateau' ? m.eL! - m.Re / m.E : 0.002; // plastic strain where hardening starts
    // slope continuity at R_p0.2: R_e/(0.002 N) = (R_m − R_e) g'(0)/(e_p,u − 0.002), g'(0) = (1 − β) m + β·100
    const g0 = (N: number) => (m.Re * (epu - 0.002)) / (0.002 * N * (m.Rm - m.Re));
    let beta = m.kind === 'round' && m.N ? Math.min(Math.max((g0(m.N) - mm) / (M2 - mm), 0), 0.6) : 0;
    const N = m.kind === 'round' ? (m.Re * (epu - 0.002)) / (0.002 * ((1 - beta) * mm + beta * M2) * (m.Rm - m.Re)) : 0;
    if (m.kind !== 'round') beta = 0;
    return { mm, epu, ep0, N, beta };
  }
  if (m.kind === 'brittle') {
    // e_p = 0.001 (σ/R_p0.1)^N, fracture at R_m with total strain A
    const N = Math.log((m.A - m.Rm / m.E) / 0.001) / Math.log(m.Rm / m.Re);
    return { mm: 0, epu: m.A - m.Rm / m.E, ep0: 0.001, N, beta: 0 };
  }
  return { mm: 0, epu: 0, ep0: 0, N: (m.E * m.ey!) / m.Re, beta: 0 }; // polymer: N = initial-slope exponent k
}

/** Engineering stress at engineering strain e (0 … A); after A: 0 (broken). */
export function stressAt(m: TensileMat, e: number): number {
  if (e <= 0) return 0;
  if (e > m.A) return 0;
  const P = curveParams(m);
  if (m.kind === 'polymer') {
    const ey = m.ey!, sy = m.Re, sd = m.sd!, eh = m.lam! - 1, D = 0.6 * ey;
    if (e <= ey) return sy * (1 - Math.pow(1 - e / ey, P.N));
    if (e <= ey + D) return sd + ((sy - sd) * (1 + Math.cos((Math.PI * (e - ey)) / D))) / 2;
    if (e <= eh) return sd;
    return sd + (m.sb! - sd) * ((e - eh) / (m.A - eh)) ** 2;
  }
  if (m.kind === 'brittle') return sigmaRO(m, e, 0.001, P.N, m.Rm);
  // post necking
  if (e > m.Ag!) { const s = (e - m.Ag!) / (m.A - m.Ag!); return m.Rm * (1 - m.drop! * s * s); }
  if (m.kind === 'plateau') {
    const eH = m.ReH! / m.E, eD = eH + 0.0015;
    if (e <= eH) return m.E * e;
    if (e <= eD) { const s = (e - eH) / (eD - eH); return m.ReH! + (m.Re - m.ReH!) * (s * s * (3 - 2 * s)); }
    if (e <= m.eL!) return m.Re;
    return hardening(m, e, P.ep0, P.epu, P.mm, 0);
  }
  // round: Ramberg–Osgood up to the proof stress, then the hardening law
  const eProof = m.Re / m.E + 0.002;
  if (e <= eProof) return sigmaRO(m, e, 0.002, P.N, m.Re);
  return hardening(m, e, P.ep0, P.epu, P.mm, P.beta);
}

/** σ from e = σ/E + off·(σ/σ_ref)^N, solved by bisection (σ ≤ σ_max). */
function sigmaRO(m: TensileMat, e: number, off: number, N: number, sMax: number) {
  let lo = 0, hi = Math.min(sMax * 1.0001, m.E * e);
  for (let i = 0; i < 60; i++) { const s = (lo + hi) / 2; if (s / m.E + off * Math.pow(s / m.Re, N) > e) hi = s; else lo = s; }
  return (lo + hi) / 2;
}

const M2 = 100;
/** σ = R_e + (R_m − R_e)((1 − β)(1 − (1 − s)^m) + β(1 − (1 − s)^100)) in plastic strain from ep0 to ep,u; e_p = e − σ/E solved by bisection. */
function hardening(m: TensileMat, e: number, ep0: number, epu: number, mm: number, beta: number) {
  const g = (sig: number) => { const s = Math.min(Math.max((e - sig / m.E - ep0) / (epu - ep0), 0), 1); return m.Re + (m.Rm - m.Re) * ((1 - beta) * (1 - Math.pow(1 - s, mm)) + beta * (1 - Math.pow(1 - s, M2))); };
  let lo = m.Re, hi = m.Rm; // σ − g(σ) is increasing in σ
  for (let i = 0; i < 60; i++) { const s = (lo + hi) / 2; if (s - g(s) > 0) hi = s; else lo = s; }
  return (lo + hi) / 2;
}

export type CurvePt = { e: number; s: number };

/** Engineering curve sampled densely (fine in the elastic and yield region), ending at fracture. */
export function engCurve(m: TensileMat, n = 360): CurvePt[] {
  const eY = m.kind === 'polymer' ? m.ey! : m.Re / m.E + 0.002, pts: CurvePt[] = [{ e: 0, s: 0 }];
  const knots = m.kind === 'plateau' ? [m.ReH! / m.E, m.ReH! / m.E + 0.0015, m.eL!] : [];
  const n1 = Math.round(n * 0.3), zone = Math.min(m.A, Math.max(3 * eY, m.kind === 'plateau' ? m.eL! * 1.4 : 0));
  if (m.Ag !== undefined) knots.push(m.Ag);
  const es = new Set<number>(knots.filter((k) => k < m.A));
  for (let i = 1; i <= n1; i++) es.add((zone * i) / n1);
  for (let i = 1; i <= n - n1; i++) es.add(zone + ((m.A - zone) * i) / (n - n1));
  for (const e of [...es].sort((a, b) => a - b)) pts.push({ e, s: stressAt(m, Math.min(e, m.A)) });
  return pts;
}

/** True curve: uniform part from the engineering curve, then a straight line to the true fracture point in the neck. */
export function trueCurve(m: TensileMat, eng: CurvePt[]) {
  if (m.kind === 'polymer') return { uniform: [] as CurvePt[], neck: null as null | [CurvePt, CurvePt] };
  const eu = m.kind === 'brittle' ? m.A : m.Ag!;
  const uniform = eng.filter((p) => p.e <= eu + 1e-12).map((p) => ({ e: Math.log(1 + p.e), s: p.s * (1 + p.e) }));
  if (m.kind === 'brittle') return { uniform, neck: null };
  const last = uniform[uniform.length - 1], sf = stressAt(m, m.A);
  return { uniform, neck: [last, { e: Math.log(1 / (1 - m.Z!)), s: sf / (1 - m.Z!) }] as [CurvePt, CurvePt] };
}

/** Engineering strain at a given engineering stress on the rising part of the curve (NaN if never reached). */
export function strainAt(m: TensileMat, sigma: number, eng: CurvePt[]) {
  if (sigma <= 0) return 0;
  for (let i = 1; i < eng.length; i++) {
    const a = eng[i - 1], b = eng[i];
    if (b.s >= sigma && a.s < sigma) return a.e + ((sigma - a.s) / (b.s - a.s)) * (b.e - a.e);
  }
  return NaN;
}

export type TensileIn = {
  mat: TensileMat;
  d0: number;    // specimen (and bar) diameter [mm]
  Fw: number;    // working load on a bar of the same diameter [kN]
  Fmax: number;  // testing machine capacity [kN]
};

export function tensile(p: TensileIn) {
  const m = p.mat, eng = engCurve(m), tc = trueCurve(m, eng);
  const S0 = (Math.PI * p.d0 * p.d0) / 4, L0 = 5.65 * Math.sqrt(S0); // ISO 6892-1 proportional: L₀ = 5.65 √S₀ (= 5 d₀)
  const Fe = (m.Re * S0) / 1000, Fm = (m.Rm * S0) / 1000;
  const dL = m.A * L0, Ag = m.Ag ?? (m.kind === 'brittle' ? m.A : NaN);
  const du = m.kind === 'polymer' ? NaN : p.d0 / Math.sqrt(1 + Ag);
  const df = m.Z !== undefined ? p.d0 * Math.sqrt(1 - m.Z) : m.kind === 'brittle' ? p.d0 * (1 - (m.nu * m.Rm) / m.E) : p.d0 / Math.sqrt(m.lam!);
  const sTu = m.kind === 'polymer' ? NaN : m.Rm * (1 + Ag), eTu = m.kind === 'polymer' ? NaN : Math.log(1 + Ag);
  const sf = stressAt(m, m.A), sTf = m.Z !== undefined ? sf / (1 - m.Z) : NaN, eTf = m.Z !== undefined ? Math.log(1 / (1 - m.Z)) : NaN;
  const Ur = (m.Re * m.Re) / (2 * m.E); // MJ/m³ (= MPa)
  let UT = 0; for (let i = 1; i < eng.length; i++) UT += ((eng[i].s + eng[i - 1].s) / 2) * (eng[i].e - eng[i - 1].e);
  // working load on a bar of the same diameter
  const sw = (p.Fw * 1000) / S0, ew = strainAt(m, sw, eng), epw = Math.max(ew - sw / m.E, 0);
  const ddw = Number.isFinite(ew) ? p.d0 * ((1 - (m.nu * sw) / m.E) / Math.sqrt(1 + epw) - 1) : NaN; // Poisson + volume constancy
  const Sy = sw > 0 ? m.Re / sw : Infinity, Sm = sw > 0 ? m.Rm / sw : Infinity;
  const SyReq = m.kind === 'polymer' ? 2 : 1.5, SmReq = m.kind === 'brittle' ? 3 : 2;
  const yN = yieldName(m);
  const checks: Check[] = [
    ...(m.kind !== 'brittle' ? [{ ok: Sy >= SyReq, label: `Safety against yielding ≥ ${SyReq}`, detail: `${yN}/σ = ${m.Re}/${sw.toFixed(1)} = ${Number.isFinite(Sy) ? Sy.toFixed(2) : '∞'}` }] : []),
    { ok: Sm >= SmReq, label: `Safety against fracture ≥ ${SmReq}`, detail: `R_m/σ = ${m.Rm}/${sw.toFixed(1)} = ${Number.isFinite(Sm) ? Sm.toFixed(2) : '∞'}` },
    { ok: m.A >= 0.05, label: 'Ductile: stretches visibly before it breaks (A ≥ 5 %)', detail: `A = ${(m.A * 100).toFixed(1)} %` },
    { ok: Fm <= p.Fmax, label: 'Testing machine can break the specimen', detail: `F_m = ${Fm.toFixed(1)} kN ≤ ${p.Fmax.toFixed(0)} kN` },
  ];
  return {
    eng, tc, S0, L0, Fe, Fm, dL, Ag, du, df, sTu, eTu, sf, sTf, eTf, Ur, UT,
    sw, ew, epw, dLw: ew * L0, ddw, Sy, Sm,
    specStiff: m.E / m.rho, specStr: (m.Rm * 1000) / m.rho, // E/ρ in MN·m/kg, R_m/ρ in kN·m/kg
    checks,
  };
}
export type TensileResult = ReturnType<typeof tensile>;

/**
 * Specimen shape during the test at engineering strain e: local stretch λ(Z) over the material coordinate Z of the
 * parallel length (|Z| ≤ Lc/2, from the middle). Used by the drawings; length from λ_z, radius from λ_r.
 */
export function stretchAt(m: TensileMat, e: number, Z: number, d0: number, Lc: number) {
  if (m.kind === 'polymer') {
    const ey = m.ey!, lam = m.lam!, eh = lam - 1;
    if (e <= ey) return { lz: 1 + e, lr: 1 + 2 * m.nu * e }; // radius factor 1/√lr ≈ 1 − ν e
    if (e <= eh) {
      const ld = ((e - ey) * Lc) / (lam - 1 - ey), w = 0.25 * d0; // drawn length in material coordinates, shoulder width
      const f = 0.5 * (1 - Math.tanh((Math.abs(Z) - ld / 2) / w));
      const l = 1 + ey + (lam - 1 - ey) * f;
      return { lz: l, lr: l };
    }
    const l = lam * (1 + (e - eh) / lam); // whole length drawn, then uniform hardening
    return { lz: l, lr: l };
  }
  if (m.kind === 'brittle' || e <= m.Ag!) {
    const s = stressAt(m, e), ep = Math.max(e - s / m.E, 0);
    return { lz: 1 + e, lr: (1 + ep) * (1 + 2 * m.nu * (s / m.E)) };
  }
  // necking: the uniform part keeps A_g, the extra length goes into a neck in the middle
  const lu = 1 + m.Ag!, w = 0.35 * d0, g = Math.exp(-((Z / w) ** 2));
  const cz = ((e - m.Ag!) * Lc) / (w * Math.sqrt(Math.PI));     // keeps the gauge elongation equal to e
  const cr = (1 / (1 - m.Z!) - lu) * ((e - m.Ag!) / (m.A - m.Ag!)); // minimum diameter reaches √(1 − Z) d₀ at fracture
  return { lz: lu + cz * g, lr: lu + cr * g };
}

export const TENSILE_INTRO = 'A tensile test pulls a round bar with gauge marks until it breaks and records force and elongation. Divided by the original section and length they give the stress–strain curve: a straight elastic part (slope E), yielding, work hardening up to the tensile strength R_m, then a neck that thins until the bar breaks. Pick a material and compare: steels, aluminium, copper, titanium, cast iron and plastics behave very differently.';

export const TENSILE_NOTES = [
  'Specimen: round proportional test piece of ISO 6892-1 with L₀ = 5.65 √S₀ = 5 d₀. R_eH/R_eL = upper/lower yield point, R_p0.2 = stress at 0.2 % plastic elongation (offset line with slope E), R_m = highest force / S₀, A_g = elongation at the highest force (uniform elongation), A = elongation after fracture, Z = reduction of area. Values are typical and rounded (minimum yield and tensile strengths of the cited standards, typical ductility); real heats and product forms differ, use the inspection certificate.',
  'The curve is a smooth fit through these values (Ramberg–Osgood to the proof stress, a hardening law that peaks at R_m with zero slope at A_g, schematic fall after necking). Up to necking the true stress σ(1 + e) and true strain ln(1 + e) follow from volume constancy, and the peak satisfies Considère\'s condition dσ_t/dε = σ_t; the equivalent Hollomon exponent is n ≈ ln(1 + A_g). In the neck the true values come from Z (no Bridgman correction). The post-necking part depends on the gauge length.',
  'Plastics (ISO 527, 23 °C, moderate speed): the yield stress σ_y is the first maximum; a neck forms and runs along the bar at the natural draw ratio (cold drawing), then the stretched chains harden until break. Their values depend strongly on temperature, speed, moisture (PA) and time under load (creep), so a static safety factor of 2 on σ_y is used here; long-term loads need creep data. Grey cast iron has no yield point; its curve is non-linear from the start and E is a secant value.',
  'Working load: an axial force on a bar of the same diameter, without stress raisers (notches, holes, threads), fatigue or buckling. Safety factors used: 1.5 on yield and 2 on fracture for ductile metals, 3 on R_m for cast iron. Resilience U_r = R_e²/(2E) is the elastic energy per volume, toughness U_T the area under the engineering curve to fracture.',
];
