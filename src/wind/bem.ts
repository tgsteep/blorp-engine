/**
 * Blade element momentum (BEM) rotor model, steady, for the wind turbine design chain.
 *
 * - blade: the NREL 5-MW reference blade (17 AeroDyn elements, DU and NACA 64 airfoils, `nrel5mw.ts`), scaled
 *   geometrically to the chosen rotor radius (span and chord ∝ R, twist unchanged); with geometric similarity
 *   C_P(λ, β) and C_T(λ, β) do not depend on size (Reynolds-number effects neglected), so they are tabulated once;
 * - element solution after Ning (2014), "A simple solution method for the blade element momentum equations with
 *   guaranteed convergence": one residual in the inflow angle φ, solved by Brent's method, with Prandtl tip and hub
 *   losses, Buhl's empirical correction for high induction (a > 0.4), swirl and drag in the induction;
 * - variable-speed, pitch-regulated control: optimum λ between the minimum and maximum rotor speed, then constant
 *   speed, then pitch to feather above rated power;
 * - Weibull wind distribution and annual energy with availability, wake and electrical losses.
 */
import { AIRFOILS, NREL5MW_BLADE, type Airfoil } from './nrel5mw.ts';

export const B = 3;
/** Shaft tilt and blade precone of the reference turbine [deg]: they lower the wind speed normal to the rotor. */
export const TILT = 5, CONE = 2.5;
export const REF = { R: 63, Rhub: 1.5, H: 90, P: 5e6, rpm: 12.1, rpmMin: 6.9, eta: 0.944, Vin: 3, Vout: 25, mRotor: 110000, mBlade: 17740, mNacelle: 240000, gear: 97 };

/* ---------- polars ---------- */
function interp(xs: number[], ys: number[], x: number) {
  if (x <= xs[0]) return ys[0];
  const n = xs.length; if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  return ys[lo] + ((x - xs[lo]) / (xs[hi] - xs[lo])) * (ys[hi] - ys[lo]);
}
export const polar = (af: Airfoil, alphaDeg: number) => {
  const a = ((((alphaDeg + 180) % 360) + 360) % 360) - 180;
  return { cl: interp(af.alpha, af.cl, a), cd: interp(af.alpha, af.cd, a) };
};

/* ---------- blade elements (reference size, R = 63 m) ---------- */
export type Element = { r: number; dr: number; chord: number; twist: number; af: number };
export const ELEMENTS: Element[] = (() => {
  const nodes = NREL5MW_BLADE.slice(1, 18); // the 17 element centres of the original AeroDyn model
  const out: Element[] = []; let b = 0;
  for (const [s, tw, c, af] of nodes) { const b2 = 2 * s - b; out.push({ r: REF.Rhub + s, dr: b2 - b, chord: c, twist: tw, af }); b = b2; }
  return out;
})();

/* ---------- one element (Ning 2014) ---------- */
const EPS = 1e-6;
type ElOut = { phi: number; alpha: number; a: number; ap: number; F: number; cn: number; ct: number; cl: number; cd: number; W2: number };
/** Element state for free-stream V = 1 and tip-speed ratio λ (local speed ratio λ r/R), pitch β [deg]. */
function elementAt(e: Element, R: number, Rhub: number, lam: number, beta: number): ElOut {
  const af = AIRFOILS[e.af], sig = (B * e.chord) / (2 * Math.PI * e.r);
  const cc = Math.cos((CONE * Math.PI) / 180), ctl = Math.cos((TILT * Math.PI) / 180);
  const vx = ctl * cc, vy = (lam * e.r * cc) / R, lr = vy / vx; // velocity components per unit V: normal to the coned rotor, in-plane
  const theta = ((e.twist + beta) * Math.PI) / 180;
  const state = (phi: number) => {
    const sp = Math.sin(phi), cp = Math.cos(phi);
    const alpha = ((phi - theta) * 180) / Math.PI, { cl, cd } = polar(af, alpha);
    const cn = cl * cp + cd * sp, ct = cl * sp - cd * cp;
    const asp = Math.max(Math.abs(sp), 1e-9);
    const ftip = (2 / Math.PI) * Math.acos(Math.min(1, Math.exp((-B * (R - e.r)) / (2 * e.r * asp))));
    const fhub = (2 / Math.PI) * Math.acos(Math.min(1, Math.exp((-B * (e.r - Rhub)) / (2 * Rhub * asp))));
    const F = Math.max(ftip * fhub, 1e-6);
    const k = (sig * cn) / (4 * F * sp * sp), kp = (sig * ct) / (4 * F * sp * cp);
    let a: number;
    if (phi > 0) {
      if (k <= 2 / 3) a = k / (1 + k);
      else { // Buhl's empirical region
        const g1 = 2 * F * k - (10 / 9 - F), g2 = Math.max(2 * F * k - F * (4 / 3 - F), 0), g3 = 2 * F * k - (25 / 9 - 2 * F);
        a = Math.abs(g3) < 1e-6 ? 1 - 1 / (2 * Math.sqrt(g2)) : (g1 - Math.sqrt(g2)) / g3;
      }
    } else a = k > 1 ? k / (k - 1) : 0; // propeller brake region
    const ap = kp / (1 - kp);
    const f = sp / (1 - a) - (cp / lr) * (1 - kp); // Ning's residual: zero when blade-element and momentum induction agree
    return { f, phi, alpha, a, ap, F, cn, ct, cl, cd };
  };
  // bracket (Ning): normal operation, then propeller brake, then the windmill-brake side
  const tryRoot = (lo: number, hi: number) => {
    let fa = state(lo).f, fb = state(hi).f;
    if (fa * fb > 0) return null;
    let a = lo, b = hi, c = a, fc = fa, d = b - a, e2 = d;
    for (let it = 0; it < 80; it++) { // Brent's method
      if (fb * fc > 0) { c = a; fc = fa; d = b - a; e2 = d; }
      if (Math.abs(fc) < Math.abs(fb)) { a = b; b = c; c = a; fa = fb; fb = fc; fc = fa; }
      const tol = 1e-10, m = 0.5 * (c - b);
      if (Math.abs(m) <= tol || fb === 0) break;
      if (Math.abs(e2) >= tol && Math.abs(fa) > Math.abs(fb)) {
        const s = fb / fa; let p: number, q: number;
        if (a === c) { p = 2 * m * s; q = 1 - s; }
        else { const qq = fa / fc, r = fb / fc; p = s * (2 * m * qq * (qq - r) - (b - a) * (r - 1)); q = (qq - 1) * (r - 1) * (s - 1); }
        if (p > 0) q = -q; else p = -p;
        if (2 * p < Math.min(3 * m * q - Math.abs(tol * q), Math.abs(e2 * q))) { e2 = d; d = p / q; } else { d = m; e2 = d; }
      } else { d = m; e2 = d; }
      a = b; fa = fb;
      b += Math.abs(d) > tol ? d : m > 0 ? tol : -tol;
      fb = state(b).f;
    }
    return b;
  };
  const phi = tryRoot(EPS, Math.PI / 2) ?? tryRoot(-Math.PI / 4, -EPS) ?? tryRoot(Math.PI / 2, Math.PI - EPS) ?? Math.PI / 2;
  const s = state(phi);
  const W2 = (vx * (1 - s.a)) ** 2 + (vy * (1 + s.ap)) ** 2;
  return { phi, alpha: s.alpha, a: s.a, ap: s.ap, F: s.F, cn: s.cn, ct: s.ct, cl: s.cl, cd: s.cd, W2 };
}

/** Whole rotor at tip-speed ratio λ and pitch β (reference geometry, non-dimensional): C_P, C_T and the spanwise state. */
export function rotorCoeffs(lam: number, beta: number) {
  const R = REF.R, A = Math.PI * R * R, cc = Math.cos((CONE * Math.PI) / 180);
  let T = 0, Q = 0, M = 0; const span: (ElOut & { r: number; fn: number; ft: number })[] = [];
  for (const e of ELEMENTS) {
    const s = elementAt(e, R, REF.Rhub, lam, beta);
    const fn = 0.5 * s.W2 * e.chord * s.cn, ft = 0.5 * s.W2 * e.chord * s.ct; // per unit ρ and V² [m]
    T += B * fn * cc * e.dr; Q += B * ft * e.r * cc * e.dr; M += fn * (e.r - REF.Rhub) * e.dr;
    span.push({ ...s, r: e.r, fn, ft });
  }
  const omega = lam / R; // per unit V
  return { cp: (Q * omega) / (0.5 * A), ct: T / (0.5 * A), cm: M / (0.5 * A * R), span };
}

/* ---------- C_P / C_T tables (computed once) ---------- */
export const LAMS = Array.from({ length: 57 }, (_, i) => 1 + i * 0.25);   // 1 … 15
export const BETAS = Array.from({ length: 33 }, (_, i) => -2 + i);        // −2 … 30°
let TAB: { cp: number[][]; ct: number[][]; cm: number[][] } | null = null;
export function tables() {
  if (TAB) return TAB;
  const cp: number[][] = [], ct: number[][] = [], cm: number[][] = [];
  for (const b of BETAS) { const rp: number[] = [], rt: number[] = [], rm: number[] = []; for (const l of LAMS) { const c = rotorCoeffs(l, b); rp.push(c.cp); rt.push(c.ct); rm.push(c.cm); } cp.push(rp); ct.push(rt); cm.push(rm); }
  return (TAB = { cp, ct, cm });
}
function bilin(t: number[][], lam: number, beta: number) {
  const l = Math.min(Math.max(lam, LAMS[0]), LAMS[LAMS.length - 1]), b = Math.min(Math.max(beta, BETAS[0]), BETAS[BETAS.length - 1]);
  const i = Math.min(Math.floor((l - LAMS[0]) / 0.25), LAMS.length - 2), j = Math.min(Math.floor(b - BETAS[0]), BETAS.length - 2);
  const u = (l - LAMS[i]) / 0.25, w = b - BETAS[j];
  return (1 - w) * ((1 - u) * t[j][i] + u * t[j][i + 1]) + w * ((1 - u) * t[j + 1][i] + u * t[j + 1][i + 1]);
}
export const cpAt = (lam: number, beta: number) => bilin(tables().cp, lam, beta);
export const ctAt = (lam: number, beta: number) => bilin(tables().ct, lam, beta);
export const cmAt = (lam: number, beta: number) => bilin(tables().cm, lam, beta);
/** Best tip-speed ratio and C_P at pitch 0 (golden section on the table). */
export function optimum(beta = 0) {
  let a = 3, b = 13; const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a);
  for (let i = 0; i < 60; i++) { if (cpAt(c, beta) > cpAt(d, beta)) b = d; else a = c; c = b - g * (b - a); d = a + g * (b - a); }
  const lam = (a + b) / 2; return { lam, cp: cpAt(lam, beta) };
}

/* ---------- Weibull ---------- */
/** Γ(x) by the Lanczos approximation (g = 7). */
export function gamma(x: number): number {
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  x -= 1; let a = c[0]; const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}
export const weibullC = (vMean: number, k: number) => vMean / gamma(1 + 1 / k);
export const weibullPdf = (v: number, k: number, c: number) => (v <= 0 ? 0 : (k / c) * Math.pow(v / c, k - 1) * Math.exp(-Math.pow(v / c, k)));

/* ---------- turbine ---------- */
/** What the user chooses: size, site and losses. The rest is fixed at typical values of the reference turbine. */
export type RotorIn = {
  D: number; P: number; H: number;   // rotor diameter [m], rated electrical power [W], hub height [m]
  vMean: number; k: number;          // annual mean wind at hub height [m/s], Weibull shape factor
  loss: number;                      // availability, wake and electrical losses together (fraction)
  vOp: number;                       // wind speed for the views [m/s]
  vTip?: number; rho?: number; eta?: number; Vin?: number; Vout?: number; // fixed unless given
};
export const FIXED = { vTip: (REF.rpm * Math.PI * REF.R) / 30, rho: 1.225, eta: REF.eta, Vin: 3, Vout: 25 };
const fx = (p: RotorIn) => ({ vTip: p.vTip ?? FIXED.vTip, rho: p.rho ?? FIXED.rho, eta: p.eta ?? FIXED.eta, Vin: p.Vin ?? FIXED.Vin, Vout: p.Vout ?? FIXED.Vout });

export type OpPoint = { V: number; rpm: number; lam: number; beta: number; P: number; Pm: number; T: number; Q: number; cp: number; ct: number; Mflap: number };

/** Operating point at wind speed V: optimum λ within the speed limits, then pitch to hold rated power. */
export function operate(p0: RotorIn, V: number, lamOpt: number): OpPoint {
  const p = { ...p0, ...fx(p0) }, R = p.D / 2, A = Math.PI * R * R, wMax = p.vTip / R, wMin = wMax * (REF.rpmMin / REF.rpm);
  const off = { V, rpm: 0, lam: 0, beta: 90, P: 0, Pm: 0, T: 0, Q: 0, cp: 0, ct: 0, Mflap: 0 };
  if (V < p.Vin || V > p.Vout) return off;
  const w = Math.min(Math.max((lamOpt * V) / R, wMin), wMax), lam = (w * R) / V;
  const q = 0.5 * p.rho * V * V, pm = (b: number) => q * V * A * cpAt(lam, b);
  let beta = 0;
  if (pm(0) * p.eta > p.P) { // pitch to feather: P falls as β grows
    let lo = 0, hi = 30;
    for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (pm(m) * p.eta > p.P) lo = m; else hi = m; }
    beta = (lo + hi) / 2;
  }
  const cp = cpAt(lam, beta), ct = ctAt(lam, beta), Pm = q * V * A * cp;
  return { V, rpm: (w * 60) / (2 * Math.PI), lam, beta, Pm, P: Pm * p.eta, T: q * A * ct, Q: Pm / w, cp, ct, Mflap: q * A * R * cmAt(lam, beta) };
}

export function rotor(p0: RotorIn) {
  const p = { ...p0, ...fx(p0) }, R = p.D / 2, A = Math.PI * R * R, s = R / REF.R;
  const opt = optimum(0);
  const curve: OpPoint[] = [];
  for (let V = 0; V <= 30.0001; V += 0.25) curve.push(operate(p, V, opt.lam));
  // rated wind speed: first speed where the electrical power reaches rated (bisection on the speed)
  let lo = p.Vin, hi = p.Vout;
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (operate(p, m, opt.lam).P >= p.P * 0.9999) hi = m; else lo = m; }
  const vRated = operate(p, hi, opt.lam).P >= p.P * 0.999 ? hi : NaN;
  const rated = operate(p, Number.isFinite(vRated) ? vRated : p.Vout, opt.lam);
  const peakT = curve.reduce((m, o) => (o.T > m.T ? o : m), curve[0]);
  // annual energy (Weibull, 0.05 m/s steps)
  const c = weibullC(p.vMean, p.k);
  let e = 0, hrs = 0;
  for (let V = 0.025; V < 30; V += 0.05) { const f = weibullPdf(V, p.k, c) * 0.05; hrs += f; e += operate(p, V, opt.lam).P * f; }
  const aepGross = (e * 8760) / 1e6; // MWh
  const aep = aepGross * (1 - p.loss);
  const cf = aep / ((p.P / 1e6) * 8760);
  const op = operate(p, p.vOp, opt.lam);
  const spanOp = op.rpm > 0 ? rotorCoeffs(op.lam, op.beta).span.map((x) => ({ ...x, r: x.r * s })) : [];
  // masses scaled from the reference turbine (blade: NREL cost model, advanced blades 0.4948 R^2.53)
  const mBlade = 0.4948 * Math.pow(R, 2.53), mRotor = REF.mRotor * Math.pow(s, 2.6);
  const specific = p.P / A, tip = rated.rpm * (Math.PI / 30) * R, clear = p.H - R;
  // whether the turbine itself is consistent (rotor size, rated power, hub height): shown on every stage of the chain,
  // since a drivetrain, tower or foundation for a turbine that cannot exist is meaningless
  const sizeChecks = [
    { ok: specific >= 200 && specific <= 500, label: 'Specific power 200…500 W/m² (generator matched to the rotor)', detail: `P/A = ${specific.toFixed(0)} W/m²` },
    { ok: Number.isFinite(vRated) && vRated >= 9 && vRated <= 14, label: 'Rated wind speed 9…14 m/s', detail: Number.isFinite(vRated) ? `V_rated = ${vRated.toFixed(1)} m/s` : 'rated power not reached below cut-out' },
  ];
  const heightCheck = { ok: clear >= 20, label: 'Blade tip at least 20 m above ground', detail: `H − R = ${clear.toFixed(1)} m` };
  const checks = [
    ...sizeChecks, heightCheck,
    { ok: cf >= 0.25, label: 'Net capacity factor ≥ 25 %', detail: `CF = ${(cf * 100).toFixed(1)} %` },
  ];
  return { R, A, s, fixed: fx(p0), opt, curve, vRated, rated, peakT, c, aepGross, aep, cf, hrs, op, spanOp, mBlade, mRotor, specific, tip, sizeChecks, heightCheck, checks };
}
export type RotorResult = ReturnType<typeof rotor>;

export const ROTOR_INTRO = 'How much energy does a wind turbine of a given size make at a given site, and what loads does its rotor pass on? The blade is not designed here: it is the NREL 5-MW reference blade, a published research blade, scaled to the diameter you choose. Blade element momentum (BEM) theory cuts the blade into strips, each a small wing, and sums their lift and drag into power and thrust at every wind speed; the site\'s wind distribution turns that into energy per year.';

export const ROTOR_NOTES = [
  'The blade is fixed: the NREL 5-MW reference blade (Jonkman et al. 2009, NREL/TP-500-38060) with its published DU 93/97 and NACA 64-618 airfoil tables (OpenFAST), scaled geometrically to the chosen diameter. Real blades are designed for their own size, materials and loads; this page does not do that. Steady BEM after Ning (2014) with Prandtl tip and hub losses, Buhl\'s high-induction correction, swirl, and the reference 5° shaft tilt and 2.5° precone; no yaw, wind shear, tower shadow, blade bending or dynamic effects; Reynolds-number effects of scaling ignored. Validation: C_P,max = 0.482 at λ = 7.55 and the pitch angles above rated wind of Jonkman et al. (2009) are reproduced within 1 % and 0.5°.',
  'Fixed values of the reference turbine: rated tip speed 80 m/s, minimum rotor speed 57 % of the rated one, cut-in 3 m/s, cut-out 25 m/s, drive-train and generator efficiency 94.4 %, air density 1.225 kg/m³. Control: best tip-speed ratio at low wind, constant speed near rated, then pitch to feather above rated power.',
  'Annual energy: Weibull wind distribution at hub height, 8760 h, minus the losses given (availability, wake of other turbines, electrical losses; 10…15 % is common for a wind farm). Rotor and blade masses are scaled from the reference turbine and are rough estimates.',
];
