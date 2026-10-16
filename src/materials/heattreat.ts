/**
 * Hardening of steel bars: critical temperatures (Andrews 1965), largest as-quenched hardness and the hardness at
 * 50 % martensite from the carbon content (Hodge–Orehoski fits), hardenability as Grossmann's ideal critical
 * diameter D_I (ASTM A255 base and alloy factors, grain size 7), and Grossmann's link between D_I, the quench
 * severity H and a real bar through the transient heat conduction of a cylinder (Bessel series): the bar hardens
 * (≥ 50 % martensite) where it cools at least as fast as the centre of the ideally quenched D_I bar.
 * Case hardening: carburised case depth after Harris. SI units except where stated.
 */
import { gradeOf, type Comp } from './steels.ts';

export const HT_GRADES = ['C22E', 'C45E', 'C60E', '41Cr4', '25CrMo4', '42CrMo4', '34CrNiMo6', '51CrV4', '100Cr6', '90MnCrV8'];
export const CASE_GRADES = ['C22E', '16MnCr5', '20MnCr5', '18CrNiMo7-6'];

/** Grossmann quench severity H [1/in] (typical values). */
export type Quench = 'oilStill' | 'oilAgit' | 'polymer' | 'water' | 'waterAgit' | 'brine';
export const QUENCH: Record<Quench, { name: string; H: number }> = {
  oilStill: { name: 'Oil, still', H: 0.3 }, oilAgit: { name: 'Oil, agitated', H: 0.5 }, polymer: { name: 'Polymer solution', H: 0.8 },
  water: { name: 'Water, still', H: 1.0 }, waterAgit: { name: 'Water, agitated', H: 1.6 }, brine: { name: 'Brine, agitated', H: 3.0 },
};

/** Andrews (1965) critical temperatures [°C]. */
export const ac1 = (x: Comp) => 723 - 10.7 * x.Mn - 16.9 * x.Ni + 29.1 * x.Si + 16.9 * x.Cr + 6.38 * (x.W ?? 0);
export const ac3 = (x: Comp) => 910 - 203 * Math.sqrt(x.C) - 15.2 * x.Ni + 44.7 * x.Si + 104 * x.V + 31.5 * x.Mo + 13.1 * (x.W ?? 0);
export const msTemp = (x: Comp) => 539 - 423 * x.C - 30.4 * x.Mn - 17.7 * x.Ni - 12.1 * x.Cr - 7.5 * x.Mo;
/** As-quenched hardness [HRC] of 100 % and 50 % martensite (Hodge & Orehoski fits). */
export const hrcMax = (C: number) => Math.min(66, 20 + 60 * Math.sqrt(C));
export const hrc50 = (C: number) => Math.min(58, 14 + 44 * Math.sqrt(C));
/** Ferrite–pearlite hardness, rough [HRC-equivalent]. */
export const hrcSoft = (C: number) => Math.min(25, 8 + 25 * C);

/** Grossmann ideal critical diameter [mm], ASTM A255 factors for ASTM grain size 7. */
export function idealDiameter(x: Comp) {
  const C = Math.min(x.C, 0.75);
  const base = C <= 0.39 ? 0.54 * C : C <= 0.55 ? 0.171 + 0.001 * C + 0.265 * C * C : 0.115 + 0.268 * C - 0.038 * C * C; // in
  const fMn = x.Mn <= 1.2 ? 1 + 3.3333 * x.Mn : 5.1 * x.Mn - 1.12;
  const f = fMn * (1 + 0.7 * x.Si) * (1 + 0.363 * x.Ni) * (1 + 2.16 * x.Cr) * (1 + 3.0 * x.Mo) * (1 + 1.73 * x.V);
  return base * f * 25.4;
}

// ---- Bessel functions (Numerical Recipes rational approximations) ----
export function besselJ0(x: number) {
  const ax = Math.abs(x);
  if (ax < 8) { const y = x * x; return (57568490574.0 + y * (-13362590354.0 + y * (651619640.7 + y * (-11214424.18 + y * (77392.33017 + y * -184.9052456))))) / (57568490411.0 + y * (1029532985.0 + y * (9494680.718 + y * (59272.64853 + y * (267.8532712 + y))))); }
  const z = 8 / ax, y = z * z, xx = ax - 0.785398164;
  const a = 1 + y * (-0.1098628627e-2 + y * (0.2734510407e-4 + y * (-0.2073370639e-5 + y * 0.2093887211e-6)));
  const b = -0.1562499995e-1 + y * (0.1430488765e-3 + y * (-0.6911147651e-5 + y * (0.7621095161e-6 - y * 0.934935152e-7)));
  return Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * a - z * Math.sin(xx) * b);
}
export function besselJ1(x: number) {
  const ax = Math.abs(x);
  if (ax < 8) { const y = x * x; return (x * (72362614232.0 + y * (-7895059235.0 + y * (242396853.1 + y * (-2972611.439 + y * (15704.4826 + y * -30.16036606)))))) / (144725228442.0 + y * (2300535178.0 + y * (18583304.74 + y * (99447.43394 + y * (376.9991397 + y))))); }
  const z = 8 / ax, y = z * z, xx = ax - 2.356194491;
  const a = 1 + y * (0.183105e-2 + y * (-0.3516396496e-4 + y * (0.2457520174e-5 + y * -0.240337019e-6)));
  const b = 0.04687499995 + y * (-0.2002690873e-3 + y * (0.8449199096e-5 + y * (-0.88228987e-6 + y * 0.105787412e-6)));
  return Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * a - z * Math.sin(xx) * b) * Math.sign(x);
}

/** First n roots of ζ J1(ζ) = Bi J0(ζ) (Bi = ∞: zeros of J0) and their series coefficients for the centre-referenced solution. */
const EIG = new Map<number, { z: number; Cn: number }[]>();
function eigen(Bi: number, n = 16) {
  const key = Number.isFinite(Bi) ? Math.round(Bi * 1e6) / 1e6 : -1, hit = EIG.get(key); if (hit) return hit;
  const out: { z: number; Cn: number }[] = [];
  const f = (z: number) => (Number.isFinite(Bi) ? z * besselJ1(z) - Bi * besselJ0(z) : besselJ0(z));
  let a = 1e-6, fa = f(a);
  for (let z = 0.05; out.length < n && z < 4 * n + 10; z += 0.05) {
    const fz = f(z);
    if (fa * fz <= 0) {
      let lo = a, hi = z; for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (f(lo) * f(m) <= 0) hi = m; else lo = m; }
      const r = (lo + hi) / 2, J0 = besselJ0(r), J1 = besselJ1(r);
      out.push({ z: r, Cn: Number.isFinite(Bi) ? (2 / r) * J1 / (J0 * J0 + J1 * J1) : 2 / (r * J1) });
    }
    a = z; fa = fz;
  }
  if (EIG.size > 400) EIG.clear();
  EIG.set(key, out);
  return out;
}
/** Dimensionless temperature (T − T_q)/(T_0 − T_q) at radius fraction s = r/R after Fourier number Fo. */
export const theta = (eig: { z: number; Cn: number }[], s: number, Fo: number) => eig.reduce((acc, e) => acc + e.Cn * Math.exp(-e.z * e.z * Fo) * besselJ0(e.z * s), 0);
/** Fourier number at which radius fraction s reaches half the temperature drop. */
export function foHalf(eig: { z: number; Cn: number }[], s: number) {
  let lo = 1e-6, hi = 20;
  for (let k = 0; k < 60; k++) { const m = Math.sqrt(lo * hi); if (theta(eig, s, m) > 0.5) lo = m; else hi = m; }
  return Math.sqrt(lo * hi);
}
const FO_INF = (() => { const e = eigen(Infinity); return foHalf(e, 0); })();   // centre of an ideally quenched bar

/** Half-cooling time of the point at radius fraction s of a bar of diameter D [mm] with quench severity H [1/in], relative
 * to the centre of the ideal bar of diameter D_I: ratio < 1 means it cools faster (hardens beyond 50 % martensite). */
export function timeRatio(D: number, H: number, DI: number, s: number) {
  const eig = eigen(H * (D / 25.4));
  return (foHalf(eig, s) * D * D) / (FO_INF * DI * DI);
}
/** Critical diameter [mm]: the largest bar whose centre still gets 50 % martensite with severity H. */
export function criticalDiameter(DI: number, H: number) {
  let lo = 0.5, hi = DI * 1.0001;
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (timeRatio(m, H, DI, 0) <= 1) lo = m; else hi = m; }
  return lo;
}
/** Martensite fraction from the cooling-time ratio (0.5 at ratio 1; a smooth step of the usual sigmoid shape). */
export const martFraction = (ratio: number) => 1 / (1 + Math.pow(ratio, 3));
export function hardnessAt(C: number, f: number) {
  const hm = hrcMax(C), h5 = hrc50(C), hs = Math.min(hrcSoft(C), h5 - 1);
  return f >= 0.5 ? h5 + ((hm - h5) * (f - 0.5)) / 0.5 : hs + ((h5 - hs) * f) / 0.5;
}

/** Harris: carburised case depth [mm] after t hours at T [°C]: 31.6 √t / 10^(6700/T[°R]) inches. */
export const harris = (TC: number, hours: number) => (25.4 * 31.6 * Math.sqrt(hours)) / Math.pow(10, 6700 / ((TC + 273.15) * 1.8));
export const harrisTime = (TC: number, depth: number) => Math.pow((depth / 25.4 / 31.6) * Math.pow(10, 6700 / ((TC + 273.15) * 1.8)), 2);

export type HTMode = 'through' | 'case';
export type HTIn = {
  mode: HTMode;
  grade: string;
  D: number;          // bar diameter [mm]
  quench: Quench;
  Tc: number;         // carburising temperature [°C]
  hours: number;      // carburising time [h]
  caseReq: number;    // required case depth [mm]
};

export function heatTreat(p: HTIn) {
  const g = gradeOf(p.grade), x = g.comp, H = QUENCH[p.quench].H;
  const A1 = ac1(x), A3 = ac3(x), Ms = msTemp(x), Mf = Ms - 215;
  const Taus = x.C < 0.77 ? A3 + 40 : A1 + 50;
  const DI = idealDiameter(x), Dcrit = criticalDiameter(DI, H);
  // hardness profile across the radius (core carbon; for case hardening the case is added on top)
  const n = 24, prof = Array.from({ length: n + 1 }, (_, i) => {
    const s = i / n, ratio = timeRatio(p.D, H, DI, s), f = martFraction(ratio);
    return { s, ratio, f, hrc: hardnessAt(x.C, f) };
  });
  const core = prof[0], surf = prof[n];
  let r50 = 1; for (let i = 0; i <= n; i++) if (prof[i].f >= 0.5) { r50 = i === 0 ? 0 : prof[i].s; break; }
  const depth50 = core.f >= 0.5 ? p.D / 2 : surf.f >= 0.5 ? (1 - r50) * p.D / 2 : 0;
  const caseDepth = harris(p.Tc, p.hours), tNeed = harrisTime(p.Tc, p.caseReq);
  const surfCase = Math.min(62, hrcMax(0.8) - 4);   // carburised surface ≈ 0.8 % C, some retained austenite
  const alloy = x.Cr + x.Mo + x.Ni + x.V > 0.3;
  const checks = p.mode === 'through'
    ? [
      { ok: p.D <= Dcrit, label: 'Hardens through: at least 50 % martensite in the centre', detail: `D = ${p.D.toFixed(0)} mm ≤ D_crit = ${Dcrit.toFixed(0)} mm (${QUENCH[p.quench].name})` },
      { ok: !(H >= 1 && x.C >= 0.35 && alloy) && !(H >= 1.5 && x.C >= 0.45), label: 'Quench not too severe for the steel (risk of cracking and distortion)', detail: `H = ${H} 1/in, C = ${x.C.toFixed(2)} %, ${alloy ? 'alloyed' : 'plain carbon'}` },
    ]
    : [
      { ok: caseDepth >= p.caseReq, label: 'Case depth reaches the requirement', detail: `${caseDepth.toFixed(2)} mm ≥ ${p.caseReq.toFixed(2)} mm (needs ${tNeed.toFixed(1)} h at ${p.Tc.toFixed(0)} °C)` },
      { ok: p.Tc <= 950, label: 'Carburising at ≤ 950 °C (above it grains grow unless the steel is fine-grain treated)', detail: `${p.Tc.toFixed(0)} °C` },
      { ok: caseDepth <= 0.2 * p.D, label: 'Case not deeper than a fifth of the diameter (keeps a tough core)', detail: `${caseDepth.toFixed(2)} mm, D/5 = ${(p.D / 5).toFixed(1)} mm` },
    ];
  return { g, x, H, A1, A3, Ms, Mf, Taus, DI, Dcrit, prof, core, surf, depth50, caseDepth, tNeed, surfCase, hmax: hrcMax(x.C), h50: hrc50(x.C), checks };
}
export type HTResult = ReturnType<typeof heatTreat>;

export const HT_INTRO = 'Heated above about 800 °C, steel turns into austenite; quenched fast enough, the carbon is trapped in a hard, strained structure — martensite. Too slow, and soft ferrite and pearlite form instead. The surface of a bar always cools faster than its centre, so a thick bar of plain carbon steel hardens only in a shell; chromium, molybdenum and nickel slow the soft transformation down and let thicker parts harden through. Case hardening adds carbon to the surface of a low-carbon steel instead, for a hard skin over a tough core.';

export const HT_NOTES = [
  'Critical temperatures after Andrews (1965): Ac1 = 723 − 10.7Mn − 16.9Ni + 29.1Si + 16.9Cr, Ac3 = 910 − 203√C − 15.2Ni + 44.7Si + 104V + 31.5Mo, Ms = 539 − 423C − 30.4Mn − 17.7Ni − 12.1Cr − 7.5Mo (mass %, °C); austenitising Ac3 + 40 °C (hypoeutectoid) or Ac1 + 50 °C. As-quenched hardness 100 % martensite ≈ 20 + 60√C HRC, 50 % martensite ≈ 14 + 44√C HRC (Hodge & Orehoski fits); ferrite–pearlite hardness rough.',
  'Hardenability: Grossmann ideal critical diameter D_I = base(C) × f_Mn f_Si f_Ni f_Cr f_Mo f_V (ASTM A255 factors, grain size 7, typical mid-range composition — real heats vary, so use the heat’s analysis or its Jominy test). A real bar quenched with severity H hardens to 50 % martensite where its half-cooling time does not exceed that of the centre of the ideally quenched D_I bar; half-cooling times from the exact Bessel-series solution of transient conduction in a cylinder with Biot number H·D (Grossmann’s definition). The martensite fraction around that point is a smooth step — the hardness profile is indicative; a constant H underestimates how fast the surface of a water quench cools (boiling), so the surface hardness shown for water is low.',
  'Case depth after Harris: d = 31.6 √t / 10^(6700/T) inches (t in hours, T in °R), total depth of carbon penetration for gas carburising; the effective case depth (to 550 HV) is usually about two thirds of it. Surface carbon about 0.8 %, surface hardness about 60–62 HRC after quenching and low tempering. Tempering, distortion, retained austenite and decarburisation are not modelled.',
];
