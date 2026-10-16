/**
 * Simplified load capacity of external SPUR gear pairs after ISO 6336-1/-2/-3/-5
 * (pitting + tooth-root bending). Both gears same material, standard basic rack
 * ISO 53 profile A (h_fP = 1.25 m, ρ_fP = 0.38 m, α = 20°).
 *
 * What is simplified (also listed in GEAR_STRENGTH_ASSUMPTIONS for the UI):
 *  - K_v: ISO 6336-1 Method C empirical formula (K₁, K₂ table by accuracy grade).
 *  - K_Hβ: ISO 6336-1 formula with F_βy from f_Hβ (ISO 1328-1) + pinion bending f_sh
 *    for a stiff shaft between symmetric bearings, c_γβ = 0.85·20 N/(mm·µm), running-in y_β.
 *  - K_Hα = K_Fα = 1, Z_B = Z_D = 1, Z_L = Z_v = Z_R = Z_W = Z_X = 1,
 *    Y_β = Y_B = Y_DT = 1, Y_δrelT = Y_RrelT = Y_X = 1.
 *  - Y_F, Y_S: ISO 6336-3 Method B (load at outer point of single pair contact).
 *  - Life factors Z_NT / Y_NT: ISO 6336-2/-3 tables, log-log interpolation,
 *    0.85 at 10¹⁰ cycles (not the "optimum" 1.0).
 *  - Material limits σ_Hlim, σ_Flim: ISO 6336-5 Table 1, quality MQ.
 * Lengths mm, forces N, stresses N/mm² (MPa), speeds rpm.
 */
import { computeSpur, inv, type Check } from './spur.ts';

const rad = (d: number) => (d * Math.PI) / 180;

/* ---------- materials (ISO 6336-5:2016 Table 1, quality MQ) ---------- */

/** Life-factor curves: [N_L, factor] breakpoints, log-log interpolated, flat outside. */
export type LifeCurve = [number, number][];

/** ISO 6336-2 Table 2: St, V, Eh, IF … no pitting permitted. */
export const ZNT_STEEL: LifeCurve = [[1e5, 1.6], [5e7, 1.0], [1e10, 0.85]];
/** ISO 6336-2 Table 2: NT, NV (nitrided). */
export const ZNT_NITRIDED: LifeCurve = [[1e5, 1.3], [2e6, 1.0], [1e10, 0.85]];
/** ISO 6336-3 Table 3: St, V (through-hardened). */
export const YNT_THROUGH: LifeCurve = [[1e4, 2.5], [3e6, 1.0], [1e10, 0.85]];
/** ISO 6336-3 Table 3: Eh, IF (root) — case/induction hardened. */
export const YNT_CASE: LifeCurve = [[1e3, 2.5], [3e6, 1.0], [1e10, 0.85]];
/** ISO 6336-3 Table 3: NT, NV (nitrided). */
export const YNT_NITRIDED: LifeCurve = [[1e3, 1.6], [3e6, 1.0], [1e10, 0.85]];

export type GearMaterial = {
  id: string;
  name: string;
  treatment: string;
  hardness: string;
  sHlim: number; // σ_Hlim [MPa]
  sFlim: number; // σ_Flim [MPa]  (σ_FE = 2·σ_Flim)
  hardened: boolean; // surface hardened (Eh, NT/NV) → running-in y_β = 0.15 F_βx
  znt: LifeCurve;
  ynt: LifeCurve;
};

export const GEAR_MATERIALS: GearMaterial[] = [
  { id: 'c45', name: 'C45', treatment: 'quenched & tempered', hardness: '200 HV', sHlim: 0.925 * 200 + 360, sFlim: 0.24 * 200 + 163, hardened: false, znt: ZNT_STEEL, ynt: YNT_THROUGH },
  { id: '42crmo4', name: '42CrMo4', treatment: 'quenched & tempered', hardness: '300 HV', sHlim: 1.313 * 300 + 373, sFlim: 0.425 * 300 + 187, hardened: false, znt: ZNT_STEEL, ynt: YNT_THROUGH },
  { id: '42crmo4n', name: '42CrMo4', treatment: 'gas nitrided', hardness: '≥ 450 HV surface', sHlim: 998, sFlim: 363, hardened: true, znt: ZNT_NITRIDED, ynt: YNT_NITRIDED },
  { id: '18crnimo76', name: '18CrNiMo7-6', treatment: 'case hardened', hardness: '58–62 HRC, core ≥ 30 HRC', sHlim: 1500, sFlim: 500, hardened: true, znt: ZNT_STEEL, ynt: YNT_CASE },
];

export function lifeFactor(curve: LifeCurve, N: number): number {
  if (N <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [N0, f0] = curve[i - 1], [N1, f1] = curve[i];
    if (N <= N1) return f0 * Math.pow(f1 / f0, Math.log(N / N0) / Math.log(N1 / N0));
  }
  return curve[curve.length - 1][1];
}

/* ---------- factors ---------- */

/** Zone factor (spur, β = 0): Z_H = √(2 cos α_w / (cos² α · sin α_w)). */
export const zoneFactor = (alpha: number, alphaW: number) => Math.sqrt((2 * Math.cos(alphaW)) / (Math.cos(alpha) ** 2 * Math.sin(alphaW)));

/** Elasticity factor Z_E = √(1 / (π[(1−ν₁²)/E₁ + (1−ν₂²)/E₂])) [√MPa]. */
export const elasticityFactor = (E1 = 206000, nu1 = 0.3, E2 = E1, nu2 = nu1) => Math.sqrt(1 / (Math.PI * ((1 - nu1 ** 2) / E1 + (1 - nu2 ** 2) / E2)));

/** Contact ratio factor, spur: Z_ε = √((4 − ε_α)/3). */
export const contactRatioFactor = (epsAlpha: number) => Math.sqrt((4 - epsAlpha) / 3);

/** ISO 6336-1 Method C, K₁ for spur gears by ISO 1328 accuracy grade 3…12; K₂ = 0.0193. */
export const KV_K1_SPUR: Record<number, number> = { 3: 2.1, 4: 3.9, 5: 7.5, 6: 14.9, 7: 26.8, 8: 39.1, 9: 52.8, 10: 76.6, 11: 102.6, 12: 146.3 };
export const KV_K2_SPUR = 0.0193;

/** K_v = 1 + (K₁/(K_A F_t/b) + K₂)·(v z₁/100)·√(u²/(1+u²)), K_A F_t/b ≥ 100 N/mm. */
export function dynamicFactor(Q: number, KAFtb: number, v: number, z1: number, u: number) {
  const vz = ((v * z1) / 100) * Math.sqrt((u * u) / (1 + u * u));
  const Kv = 1 + (KV_K1_SPUR[Q] / Math.max(KAFtb, 100) + KV_K2_SPUR) * vz;
  return { Kv, vz, valid: vz < 10 };
}

/** Helix slope deviation f_Hβ [µm], ISO 1328-1:1995, grade 5 formula × √2 per grade. */
export const fHbeta = (Q: number, d: number, b: number) => (0.07 * Math.sqrt(d) + 0.45 * Math.sqrt(b) + 3) * Math.pow(2, (Q - 5) / 2);

export type FaceLoadIn = { Fmb: number; b: number; d1: number; Q: number; sHlim: number; hardened: boolean; v: number };

/**
 * K_Hβ (ISO 6336-1): F_βx = 1.33 f_sh + f_ma, f_sh = 0.023 (F_m/b)(b/d₁)² (stiff pinion shaft,
 * symmetric bearings), f_ma = f_Hβ; F_βy = F_βx − y_β; c_γβ = 0.85 · 20 N/(mm·µm).
 */
export function faceLoadFactor(p: FaceLoadIn) {
  const fsh = 0.023 * p.Fmb * (p.b / p.d1) ** 2;
  const fma = fHbeta(p.Q, p.d1, p.b);
  const Fbx = Math.max(1.33 * fsh + fma, 0.005 * p.Fmb, 0.5 * fma);
  let yb: number;
  if (p.hardened) yb = Math.min(0.15 * Fbx, 6);
  else {
    yb = (320 / p.sHlim) * Fbx;
    if (p.v > 10) yb = Math.min(yb, 12800 / p.sHlim);
    else if (p.v > 5) yb = Math.min(yb, 25600 / p.sHlim);
  }
  const Fby = Fbx - yb;
  const cgb = 0.85 * 20;
  const r = (Fby * cgb) / (2 * p.Fmb);
  const KHb = r <= 1 ? 1 + r : Math.sqrt((2 * Fby * cgb) / p.Fmb);
  return { fsh, fma, Fbx, yb, Fby, cgb, KHb };
}

/** K_Fβ = K_Hβ^N_F, N_F = (b/h)² / (1 + b/h + (b/h)²), b/h ≥ 3. */
export function rootFaceLoadFactor(KHb: number, b: number, h: number) {
  const bh = Math.max(b / h, 3);
  const NF = (bh * bh) / (1 + bh + bh * bh);
  return { NF, KFb: Math.pow(KHb, NF) };
}

/**
 * Tooth form factor Y_F and stress correction factor Y_S, ISO 6336-3 Method B,
 * external spur gear generated by rack (no protuberance), load at the outer point
 * of single pair contact. Dimensionless (per unit module) except where noted.
 */
export function formFactor(z: number, x: number, epsAlpha: number, alphaDeg = 20, hfP = 1.25, rhofP = 0.38) {
  const an = rad(alphaDeg);
  const E = Math.PI / 4 - hfP * Math.tan(an) - ((1 - Math.sin(an)) * rhofP) / Math.cos(an);
  const G = rhofP - hfP + x;
  const H = (2 / z) * (Math.PI / 2 - E) - Math.PI / 3;
  let th = Math.PI / 6; // θ = 2G/z · tan θ − H, Newton
  for (let i = 0; i < 50; i++) {
    const f = th - ((2 * G) / z) * Math.tan(th) + H;
    const df = 1 - ((2 * G) / z) / Math.cos(th) ** 2;
    const step = f / df;
    th -= step;
    if (Math.abs(step) < 1e-13) break;
  }
  const sFn = z * Math.sin(Math.PI / 3 - th) + Math.sqrt(3) * (G / Math.cos(th) - rhofP);
  const rhoF = rhofP + (2 * G * G) / (Math.cos(th) * (z * Math.cos(th) ** 2 - 2 * G));
  const da = z + 2 * (1 + x), db = z * Math.cos(an);
  const pb = Math.PI * Math.cos(an);
  const den = 2 * Math.sqrt((Math.sqrt((da / 2) ** 2 - (db / 2) ** 2) - pb * (epsAlpha - 1)) ** 2 + (db / 2) ** 2);
  const alphaEn = Math.acos(db / den);
  const gammaE = (Math.PI / 2 + 2 * x * Math.tan(an)) / z + inv(an) - inv(alphaEn);
  const alphaFen = alphaEn - gammaE;
  const hFe = 0.5 * ((Math.cos(gammaE) - Math.sin(gammaE) * Math.tan(alphaFen)) * den - z * Math.cos(Math.PI / 3 - th) - G / Math.cos(th) + rhofP);
  const YF = (6 * hFe * Math.cos(alphaFen)) / (sFn * sFn * Math.cos(an));
  const L = sFn / hFe;
  const qs = sFn / (2 * rhoF);
  const YS = (1.2 + 0.13 * L) * Math.pow(qs, 1 / (1.21 + 2.3 / L));
  return { theta: th, sFn, rhoF, den, alphaEn, gammaE, alphaFen, hFe, YF, YS, L, qs };
}

/* ---------- full check ---------- */

export type StrengthInput = {
  m: number; z1: number; z2: number; b: number;
  x1?: number; x2?: number;
  n1: number; // pinion speed [rpm]
  T1: number; // pinion torque [N·m]
  KA: number; // application factor
  Q?: number; // ISO 1328 accuracy grade (default 7)
  Lh: number; // required life [h]
  mat: GearMaterial;
  SHmin?: number; // default 1.0
  SFmin?: number; // default 1.4
};

export function gearStrength(p: StrengthInput) {
  const x1 = p.x1 ?? 0, x2 = p.x2 ?? 0, Q = p.Q ?? 7;
  const SHmin = p.SHmin ?? 1.0, SFmin = p.SFmin ?? 1.4;
  const al = rad(20);
  const g = computeSpur({ m: p.m, z1: p.z1, z2: p.z2, alphaDeg: 20, x1, x2, n1: p.n1, T1: p.T1 });
  const { u, d1, Ft, v, epsAlpha, alphaW } = g;

  const kv = dynamicFactor(Q, (p.KA * Ft) / p.b, v, p.z1, u);
  const Fmb = (Ft * p.KA * kv.Kv) / p.b;
  const fl = faceLoadFactor({ Fmb, b: p.b, d1, Q, sHlim: p.mat.sHlim, hardened: p.mat.hardened, v });
  const h = 2.25 * p.m;
  const rf = rootFaceLoadFactor(fl.KHb, p.b, h);
  const KHa = 1, KFa = 1;

  // pitting
  const ZH = zoneFactor(al, alphaW), ZE = elasticityFactor(), Ze = contactRatioFactor(epsAlpha);
  const sH0 = ZH * ZE * Ze * Math.sqrt((Ft / (d1 * p.b)) * ((u + 1) / u));
  const sH = sH0 * Math.sqrt(p.KA * kv.Kv * fl.KHb * KHa);
  const NL1 = 60 * p.n1 * p.Lh, NL2 = NL1 / u;
  const ZNT1 = lifeFactor(p.mat.znt, NL1), ZNT2 = lifeFactor(p.mat.znt, NL2);
  const SH1 = (p.mat.sHlim * ZNT1) / sH, SH2 = (p.mat.sHlim * ZNT2) / sH;

  // bending
  const ff1 = formFactor(p.z1, x1, epsAlpha), ff2 = formFactor(p.z2, x2, epsAlpha);
  const KF = p.KA * kv.Kv * rf.KFb * KFa;
  const sF1 = (Ft / (p.b * p.m)) * ff1.YF * ff1.YS * KF;
  const sF2 = (Ft / (p.b * p.m)) * ff2.YF * ff2.YS * KF;
  const YNT1 = lifeFactor(p.mat.ynt, NL1), YNT2 = lifeFactor(p.mat.ynt, NL2);
  const YST = 2;
  const SF1 = (p.mat.sFlim * YST * YNT1) / sF1, SF2 = (p.mat.sFlim * YST * YNT2) / sF2;

  const f = (n: number, k = 2) => n.toFixed(k);
  const strengthChecks: Check[] = [
    { ok: SH1 >= SHmin, label: `Pitting, pinion S_H1 ≥ ${f(SHmin, 1)}`, detail: `S_H1 = σ_Hlim·Z_NT1/σ_H = ${f(p.mat.sHlim, 0)}·${f(ZNT1, 3)}/${f(sH, 0)} = ${f(SH1)}` },
    { ok: SH2 >= SHmin, label: `Pitting, wheel S_H2 ≥ ${f(SHmin, 1)}`, detail: `S_H2 = ${f(p.mat.sHlim, 0)}·${f(ZNT2, 3)}/${f(sH, 0)} = ${f(SH2)}` },
    { ok: SF1 >= SFmin, label: `Root bending, pinion S_F1 ≥ ${f(SFmin, 1)}`, detail: `S_F1 = σ_Flim·Y_ST·Y_NT1/σ_F1 = ${f(p.mat.sFlim, 0)}·2·${f(YNT1, 3)}/${f(sF1, 0)} = ${f(SF1)}` },
    { ok: SF2 >= SFmin, label: `Root bending, wheel S_F2 ≥ ${f(SFmin, 1)}`, detail: `S_F2 = ${f(p.mat.sFlim, 0)}·2·${f(YNT2, 3)}/${f(sF2, 0)} = ${f(SF2)}` },
    { ok: kv.valid, label: 'K_v formula in range (v·z₁/100·√(u²/(1+u²)) < 10 m/s)', detail: `${f(kv.vz)} m/s` },
  ];
  const checks: Check[] = [...strengthChecks, ...g.checks];

  return {
    geo: g, u, d1, Ft, v, Q,
    Kv: kv.Kv, vz: kv.vz, Fmb, ...fl, NF: rf.NF, KFb: rf.KFb, KHa, KFa,
    ZH, ZE, Ze, sH0, sH, NL1, NL2, ZNT1, ZNT2, SH1, SH2, SHmin,
    ff1, ff2, sF1, sF2, YNT1, YNT2, SF1, SF2, SFmin,
    SH: Math.min(SH1, SH2), SF: Math.min(SF1, SF2),
    ok: checks.every((c) => c.ok),
    strengthOk: strengthChecks.every((c) => c.ok),
    strengthChecks,
    checks,
  };
}

export type StrengthResult = ReturnType<typeof gearStrength>;

/**
 * Application factor K_A, ISO 6336-6 Annex A, uniform driving machine (electric motor):
 * driven machine uniform 1.00, light shocks 1.25, moderate shocks 1.50, heavy shocks 1.75.
 */
export const APPLICATION_FACTORS: { KA: number; label: string }[] = [
  { KA: 1.0, label: 'uniform' },
  { KA: 1.25, label: 'light shocks' },
  { KA: 1.5, label: 'moderate shocks' },
  { KA: 1.75, label: 'heavy shocks' },
];

/** ISO 1328 accuracy grades offered in the UI (K_v table covers 3…12). */
export const ACCURACY_GRADES = [5, 6, 7, 8, 9, 10];

/* ---------- design mode ---------- */

/** ISO 54 series I modules [mm]. */
export const DESIGN_MODULES = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

export type GearDesignReq = {
  P?: number; // power [kW] — give P or T1
  T1?: number; // pinion torque [N·m] (used when given)
  n1: number; // pinion speed [rpm]
  u: number; // target ratio z₂/z₁
  Lh: number; // required life [h]
  KA: number;
  aMax: number; // max centre distance [mm]
  bMax: number; // max face width [mm]
  Q?: number;
  SHmin?: number;
  SFmin?: number;
  materials?: GearMaterial[];
};

export type GearOption = { m: number; z1: number; z2: number; b: number; mat: GearMaterial; a: number; uErr: number; volume: number; mass: number; r: StrengthResult };

/** Which limit stopped the search: ratio (no z₁/z₂ within 2 %), centre (a > a_max), width (b_max < 0.4 d₁), strength (fits, fails checks). */
export type DesignLimit = 'ratio' | 'centre' | 'width' | 'strength';

export const MAX_RATIO_ERROR = 0.02;
export const MAX_B_OVER_D1 = 1.0;
export const MIN_B_OVER_D1 = 0.4;
export const Z1_RANGE: [number, number] = [18, 40];
export const DESIGN_OPTIONS = 8;
/** Steel density for gear mass [kg/mm³] (7850 kg/m³). */
export const STEEL_DENSITY = 7.85e-6;

/**
 * Searches module × pinion teeth × material; for each, the smallest integer face width
 * (0.4 d₁ ≤ b ≤ min(b_max, d₁)) that passes every check. Keeps the lightest pinion-tooth count
 * per module and material, then the DESIGN_OPTIONS lightest overall, ranked by mass of two solid discs
 * ρ·π/4·(d₁² + d₂²)·b. When nothing works, `limit` names the stage that rejected the most candidates last.
 */
export function designGears(q: GearDesignReq) {
  const T1 = q.T1 ?? ((q.P ?? 0) * 1000) / ((2 * Math.PI * q.n1) / 60);
  const P = (T1 * 2 * Math.PI * q.n1) / 60 / 1000;
  const mats = q.materials ?? GEAR_MATERIALS;
  const best = new Map<string, GearOption>(); // key: module + material
  const rejected: Record<DesignLimit, number> = { ratio: 0, centre: 0, width: 0, strength: 0 };
  let evaluated = 0;
  for (const m of DESIGN_MODULES) {
    for (let z1 = Z1_RANGE[0]; z1 <= Z1_RANGE[1]; z1++) {
      const z2 = Math.round(q.u * z1);
      const uErr = Math.abs(z2 / z1 - q.u) / q.u;
      const a = (m * (z1 + z2)) / 2;
      if (uErr > MAX_RATIO_ERROR) { rejected.ratio++; continue; }
      if (a > q.aMax) { rejected.centre++; continue; }
      const d1 = m * z1;
      const bLo = Math.max(1, Math.ceil(MIN_B_OVER_D1 * d1));
      const bHi = Math.floor(Math.min(q.bMax, MAX_B_OVER_D1 * d1));
      if (bHi < bLo) { rejected.width++; continue; }
      for (const mat of mats) {
        const run = (b: number) => { evaluated++; return gearStrength({ m, z1, z2, b, n1: q.n1, T1, KA: q.KA, Q: q.Q, Lh: q.Lh, mat, SHmin: q.SHmin, SFmin: q.SFmin }); };
        if (!run(bHi).ok) { rejected.strength++; continue; }
        let lo = bLo, hi = bHi; // smallest passing b (assumes monotonic in b; result re-checked)
        while (lo < hi) { const mid = (lo + hi) >> 1; if (run(mid).ok) hi = mid; else lo = mid + 1; }
        const r = run(hi);
        if (!r.ok) { rejected.strength++; continue; }
        const volume = (Math.PI / 4) * (d1 ** 2 + (m * z2) ** 2) * hi;
        const opt: GearOption = { m, z1, z2, b: hi, mat, a, uErr, volume, mass: STEEL_DENSITY * volume, r };
        const key = `${m}|${mat.id}`;
        const prev = best.get(key);
        if (!prev || volume < prev.volume - 1e-9 || (Math.abs(volume - prev.volume) < 1e-9 && z1 > prev.z1)) best.set(key, opt);
      }
    }
  }
  const options = [...best.values()].sort((x, y) => x.volume - y.volume).slice(0, DESIGN_OPTIONS);
  // the last stage that rejected anything is the one that blocked a candidate that got furthest
  const limit: DesignLimit | null = options.length ? null : (['strength', 'width', 'centre', 'ratio'] as DesignLimit[]).find((k) => rejected[k] > 0) ?? 'ratio';
  return { T1, P, options, evaluated, rejected, limit };
}

/**
 * Does designGears find at least one pair for these requirements? Same candidates and filters, but stops at the
 * first pair that passes at its widest allowed face (the narrowest passing face is then found by designGears).
 * A generator: it yields after every strength evaluation, so slider pass-range scans stay responsive.
 */
export function* gearDesignFeasible(q: GearDesignReq): Generator<unknown, boolean, unknown> {
  const T1 = q.T1 ?? ((q.P ?? 0) * 1000) / ((2 * Math.PI * q.n1) / 60);
  const mats = q.materials ?? GEAR_MATERIALS;
  for (const m of DESIGN_MODULES) {
    for (let z1 = Z1_RANGE[0]; z1 <= Z1_RANGE[1]; z1++) {
      const z2 = Math.round(q.u * z1);
      if (Math.abs(z2 / z1 - q.u) / q.u > MAX_RATIO_ERROR || (m * (z1 + z2)) / 2 > q.aMax) continue;
      const d1 = m * z1;
      const bLo = Math.max(1, Math.ceil(MIN_B_OVER_D1 * d1)), bHi = Math.floor(Math.min(q.bMax, MAX_B_OVER_D1 * d1));
      if (bHi < bLo) continue;
      for (const mat of mats) {
        if (gearStrength({ m, z1, z2, b: bHi, n1: q.n1, T1, KA: q.KA, Q: q.Q, Lh: q.Lh, mat, SHmin: q.SHmin, SFmin: q.SFmin }).ok) return true;
        yield;
      }
    }
  }
  return false;
}

/** Design mode: what "works" means and how the list is ordered. */
export const GEAR_DESIGN_RANK_NOTES =
  'Works = pitting S_H ≥ S_Hmin and root bending S_F ≥ S_Fmin on both gears, K_v formula in range, contact ratio, no undercut and the other geometry checks. For each module and material the pinion tooth count with the lightest pair is kept; the 8 lightest pairs are listed. Lighter is not always cheaper: case-hardened and nitrided gears need heat treatment and usually grinding.';

/** Strength assumptions shown in Explore (the last one, about the search, only in Design). */
export const GEAR_STRENGTH_ASSUMPTIONS = [
  'Simplified ISO 6336 (parts 1, 2, 3, 5) for external spur gears, β = 0. Not a full standard calculation: use it to size, then verify with a complete ISO 6336 tool.',
  'Both gears same material, ISO 6336-5 quality MQ limits; standard basic rack ISO 53 A (h_fP = 1.25 m, ρ_fP = 0.38 m, α = 20°), no profile shift in Design mode.',
  'K_v: ISO 6336-1 Method C formula, accuracy grade Q 7 unless set. K_Hα = K_Fα = 1.',
  'K_Hβ: f_ma = f_Hβ (ISO 1328-1), pinion bending f_sh for a stiff shaft between symmetric bearings, c_γβ = 17 N/(mm·µm), running-in y_β. Real shafts, overhung pinions and housings can raise K_Hβ a lot.',
  'Z_B = Z_D = 1, Z_L = Z_v = Z_R = Z_W = Z_X = 1 (lubrication, speed, roughness, size not modelled); Y_δrelT = Y_RrelT = Y_X = 1.',
  'Y_F, Y_S by ISO 6336-3 Method B (load at outer point of single pair contact), no protuberance or grinding notch.',
  'Life factors Z_NT, Y_NT from ISO 6336-2/-3 tables, log-log interpolated, 0.85 at 10¹⁰ cycles. Load spectrum = constant at K_A × nominal torque.',
  'Minimum safety factors S_Hmin = 1.0, S_Fmin = 1.4 are common practice (DIN 3990 style), not values set by ISO 6336.',
  'Design search: modules ISO 54 series I 1…10 mm, z₁ = 18…40, ratio error ≤ 2 %, 0.4 ≤ b/d₁ ≤ 1.0, smallest whole-mm b that passes; the lightest z₁ per module and material, then the 8 lightest overall by mass of two solid steel discs (7850 kg/m³) — real gears with webs and bores are lighter.',
];

export const GEAR_STRENGTH_EXPLORE_NOTES = GEAR_STRENGTH_ASSUMPTIONS.slice(0, -1);
