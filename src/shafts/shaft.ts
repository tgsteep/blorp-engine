/**
 * Transmission shaft on two bearings (A at x = 0, B at x = L) with one drive element (gear, pulley, sprocket)
 * at x = a — between the bearings or overhung (a > L). Torque enters at a coupling left of A.
 * Bending (rotating, fully reversed) + steady torsion: DE-Goodman fatigue (Shigley eq. 7-8), first-cycle yield
 * (eq. 7-15), deflection and slopes by numerical double integration of M/EI, first critical speed by Rayleigh.
 * Units: mm, N, N·mm, MPa unless noted.
 */

export const E_STEEL = 210000; // MPa
export const G_STEEL = 81000; // MPa
const RHO = 7.85e-6; // kg/mm³
const g0 = 9.81; // m/s²

export type ShaftMaterial = { id: string; name: string; Rm: number; Re: number; note: string };
/** Minimum values for 16 < d ≤ 40 mm (EN 10025-2 / EN 10083); larger bars are weaker — check the standard. */
export const SHAFT_MATERIALS: ShaftMaterial[] = [
  { id: 's235', name: 'S235JR', Rm: 360, Re: 235, note: 'structural steel, light duty' },
  { id: 'e295', name: 'E295', Rm: 490, Re: 295, note: 'standard machine-shaft steel' },
  { id: 'c45', name: 'C45 normalised', Rm: 620, Re: 340, note: 'the common shaft steel' },
  { id: '42crmo4', name: '42CrMo4 quenched & tempered', Rm: 1000, Re: 750, note: 'highly loaded shafts, gears' },
];

export type ElementKind = 'gear' | 'vbelt' | 'chain';
/** Shaft load F per tangential force F_t: spur gear 20° → 1/cos 20°; V-belt F₁ + F₂ with F₁/F₂ ≈ 5 → 1.5; chain (slack side ≈ 0) → 1.0. */
export const LOAD_FACTOR: Record<ElementKind, number> = { gear: 1 / Math.cos((20 * Math.PI) / 180), vbelt: 1.5, chain: 1.0 };

export type Detail = { id: string; name: string; Kt: number; Kts: number };
/** First-iteration stress concentration factors (Shigley Table 7-1). */
export const DETAILS: Detail[] = [
  { id: 'plain', name: 'plain seat (press fit ignored)', Kt: 1, Kts: 1 },
  { id: 'round', name: 'shoulder, well rounded (r/d = 0.1)', Kt: 1.7, Kts: 1.5 },
  { id: 'sharp', name: 'shoulder, sharp (r/d = 0.02)', Kt: 2.7, Kts: 2.2 },
  { id: 'key', name: 'keyseat, end-milled', Kt: 2.14, Kts: 3.0 },
];
/** Notch sensitivity: typical steel shafts (Shigley Fig. 6-20/6-21, r ≈ 1…3 mm). */
export const Q_BEND = 0.8, Q_TORS = 0.9;
export const kf = (Kt: number, q: number) => 1 + q * (Kt - 1);

/** Marin factors (Shigley eqs. 6-19, 6-20): machined surface, rotating bending size factor, 99 % reliability. */
export const kaMachined = (Rm: number) => 4.51 * Math.pow(Rm, -0.265);
export const kbSize = (d: number) => (d <= 51 ? 1.24 * Math.pow(Math.max(d, 2.79), -0.107) : 1.51 * Math.pow(Math.min(d, 254), -0.157));
export const KE_99 = 0.814;
export const enduranceLimit = (Rm: number, d: number) => kaMachined(Rm) * kbSize(d) * KE_99 * (Rm <= 1400 ? 0.5 * Rm : 700);

/** DE-Goodman safety factor (Shigley eq. 7-8), moments in N·mm, d in mm, strengths in MPa. */
export function goodmanDE(d: number, Ma: number, Mm: number, Ta: number, Tm: number, Kf: number, Kfs: number, Se: number, Rm: number) {
  const c = 16 / (Math.PI * d ** 3);
  const inv = c * (Math.sqrt(4 * (Kf * Ma) ** 2 + 3 * (Kfs * Ta) ** 2) / Se + Math.sqrt(4 * (Kf * Mm) ** 2 + 3 * (Kfs * Tm) ** 2) / Rm);
  return 1 / inv;
}

/** Point loads [x mm, F N] (positive = in the load direction) and a uniform load q [N/mm] over 0…xEnd. */
export type BeamLoads = { points: [number, number][]; q?: number };

/**
 * Shaft of constant EI on simple supports at 0 and L, length xEnd ≥ L (overhang beyond B).
 * Returns reactions, M(x) (sagging +), slope and deflection (in the load direction) on n + 1 stations.
 */
export function beam(L: number, xEnd: number, EI: number, loads: BeamLoads, n = 400) {
  const q = loads.q ?? 0;
  const Ftot = loads.points.reduce((s, [, F]) => s + F, 0) + q * xEnd;
  const Mmom = loads.points.reduce((s, [x, F]) => s + F * x, 0) + (q * xEnd * xEnd) / 2; // about A
  const RB = Mmom / L, RA = Ftot - RB;
  const x = Array.from({ length: n + 1 }, (_, i) => (xEnd * i) / n);
  // bending moment from the left: reactions push against the loads
  const M = x.map((xi) => {
    let m = RA * xi - (q * xi * xi) / 2;
    if (xi > L) m += RB * (xi - L);
    for (const [xp, F] of loads.points) if (xi > xp) m -= F * (xi - xp);
    return m;
  });
  // y'' = M/EI with y positive in the load direction → y'' = −M/EI
  const phi = [0], psi = [0];
  for (let i = 1; i <= n; i++) {
    const h = x[i] - x[i - 1];
    phi.push(phi[i - 1] - ((M[i - 1] + M[i]) / 2 / EI) * h);
    psi.push(psi[i - 1] + ((phi[i - 1] + phi[i]) / 2) * h);
  }
  const iL = Math.round((L / xEnd) * n);
  const C1 = -psi[iL] / x[iL];
  const slope = phi.map((p) => p + C1);
  const y = psi.map((p, i) => p + C1 * x[i]);
  return { RA, RB, x, M, slope, y, iL };
}

const at = (xs: number[], vs: number[], xq: number) => {
  const i = Math.min(Math.max(1, xs.findIndex((v) => v >= xq)), xs.length - 1);
  const t = (xq - xs[i - 1]) / (xs[i] - xs[i - 1] || 1);
  return vs[i - 1] + (vs[i] - vs[i - 1]) * t;
};

/** First critical speed [rad/s] by Rayleigh: static deflection under the shaft weight q [N/mm] and point weights [x, W N]. */
export function rayleigh(L: number, xEnd: number, EI: number, q: number, weights: [number, number][], n = 400) {
  const gb = beam(L, xEnd, EI, { points: weights, q }, n);
  let num = 0, den = 0;
  gb.y.forEach((yy, i) => {
    const w = q * (xEnd / n) * (i === 0 || i === n ? 0.5 : 1);
    num += w * Math.abs(yy); den += w * yy * yy;
  });
  for (const [x, W] of weights) { const yy = at(gb.x, gb.y, x); num += W * Math.abs(yy); den += W * yy * yy; }
  return Math.sqrt((g0 * 1000 * num) / den); // y in mm → g in mm/s²
}

export type ShaftIn = {
  P: number; // kW
  n: number; // rpm
  L: number; // bearing span [mm]
  a: number; // element position from bearing A [mm] (a > L: overhung)
  d: number; // shaft diameter [mm]
  D: number; // element pitch diameter [mm]
  kind: ElementKind;
  mElem: number; // element mass [kg]
  mat: ShaftMaterial;
  detail: Detail; // notch at the element seat
};

export const SHAFT_LIMITS = { nf: 1.5, ny: 1.5, slope: 0.001, yGear: 0.13, critRatio: 2 };

export function shaft(p: ShaftIn) {
  const T = (9549.3 * p.P) / p.n * 1000; // N·mm
  const Ft = (2 * T) / p.D; // N
  const F = Ft * LOAD_FACTOR[p.kind];
  const I = (Math.PI * p.d ** 4) / 64, J = 2 * I, EI = E_STEEL * I;
  const xEnd = Math.max(p.L, p.a) + Math.max(0.12 * p.L, p.d); // shaft runs a little past the last part
  const b = beam(p.L, xEnd, EI, { points: [[p.a, F]] });
  const absM = b.M.map(Math.abs);
  const Mmax = Math.max(...absM), xMmax = b.x[absM.indexOf(Mmax)];
  const Mel = Math.abs(at(b.x, b.M, p.a));
  // stress at the element seat (notch) and at the maximum-moment section (plain there unless at the seat)
  const Kf = kf(p.detail.Kt, Q_BEND), Kfs = kf(p.detail.Kts, Q_TORS);
  const Se = enduranceLimit(p.mat.Rm, p.d);
  const nfSeat = goodmanDE(p.d, Mel, 0, 0, T, Kf, Kfs, Se, p.mat.Rm);
  const nfMax = goodmanDE(p.d, Mmax, 0, 0, xMmax <= p.a ? T : 0, 1, 1, Se, p.mat.Rm);
  const nf = Math.min(nfSeat, nfMax);
  const Z = (Math.PI * p.d ** 3) / 32, Zp = 2 * Z;
  const sigA = (Kf * Mel) / Z, tauM = (Kfs * T) / Zp;
  const sigVM = Math.sqrt(Math.max(sigA, Mmax / Z) ** 2 + 3 * tauM ** 2);
  const ny = p.mat.Re / sigVM;
  // deflection and slopes
  const yEl = Math.abs(at(b.x, b.y, p.a));
  const yMax = Math.max(...b.y.map(Math.abs));
  const slopeA = Math.abs(b.slope[0]), slopeB = Math.abs(b.slope[b.iL]);
  // twist over the torque-carrying length (coupling at A to the element)
  const twist = (T * p.a) / (G_STEEL * J); // rad
  const twistPer20d = (twist / p.a) * 20 * p.d * (180 / Math.PI); // degrees over 20 diameters
  // first critical speed (Rayleigh) from the static deflection under gravity: shaft mass + element mass
  const qSelf = RHO * (Math.PI * p.d ** 2) / 4 * g0; // N/mm
  const omegaC = rayleigh(p.L, xEnd, EI, qSelf, [[p.a, p.mElem * g0]]);
  const nCrit = (omegaC * 60) / (2 * Math.PI);
  const lim = SHAFT_LIMITS;
  const checks = [
    { ok: nf >= lim.nf, label: `Fatigue (DE-Goodman) safety n_f ≥ ${lim.nf}`, detail: `n_f = ${nf.toFixed(2)}` },
    { ok: ny >= lim.ny, label: `Yield safety n_y = R_e/σ′_max ≥ ${lim.ny}`, detail: `n_y = ${ny.toFixed(2)}` },
    { ok: Math.max(slopeA, slopeB) <= lim.slope, label: `Slope at the bearings ≤ ${lim.slope} rad (ball bearings)`, detail: `A ${(slopeA * 1000).toFixed(2)}, B ${(slopeB * 1000).toFixed(2)} mrad` },
    p.kind === 'gear'
      ? { ok: yEl <= lim.yGear, label: `Deflection at the gear ≤ ${lim.yGear} mm (good tooth contact)`, detail: `y = ${yEl.toFixed(3)} mm` }
      : { ok: yEl <= p.L / 2000, label: 'Deflection at the element ≤ L/2000', detail: `y = ${yEl.toFixed(3)} mm` },
    { ok: nCrit >= lim.critRatio * p.n, label: `First critical speed ≥ ${lim.critRatio} × running speed`, detail: `n_c = ${Math.round(nCrit)} rpm` },
    { ok: twistPer20d <= 1, label: 'Twist ≤ 1° over 20 diameters (Bach’s rule)', detail: `${twistPer20d.toFixed(2)}° per 20 d` },
  ];
  return { T, Ft, F, RA: b.RA, RB: b.RB, beam: b, Mmax, xMmax, Mel, Kf, Kfs, Se, nf, nfSeat, nfMax, sigA, tauM, sigVM, ny, yEl, yMax, slopeA, slopeB, twist, twistPer20d, nCrit, xEnd, checks };
}
export type ShaftResult = ReturnType<typeof shaft>;

export const SHAFT_INTRO =
  'A shaft carries torque from a motor to a gear, pulley or sprocket, and is bent by the force that part pushes with. Because the shaft turns under a load that stays still, every point on its surface goes from tension to compression once per turn — so shafts fail by fatigue, usually at a keyway or a sharp shoulder. It must also stay stiff: too much deflection or slope ruins gears and bearings, and a shaft running near its critical speed whirls. In 3D the shaft is coloured by bending stress: red tension, blue compression.';

export const SHAFT_ASSUMPTIONS =
  'Solid steel shaft of one diameter on two simple supports (bearings A and B), one element at x = a between them or overhung; torque enters at a coupling beside A. Element force from the transmitted torque only: spur gear 20° F = F_t/cos 20°, V-belt F ≈ 1.5·F_t, chain F ≈ F_t; weights neglected in the stresses. Rotating bending is fully reversed, torque steady (no start-up peaks, no axial load). Fatigue by DE-Goodman with Marin factors for a machined surface, size factor and 99 % reliability (Shigley 6-19…6-20, eq. 7-8); stress concentration from first-iteration factors (Shigley Table 7-1) with notch sensitivity 0.8 / 0.9. Deflection by integrating M/EI (E = 210 GPa); first critical speed by Rayleigh from the static deflection under shaft and element weight. Limits are common guide values (Shigley Table 7-2, Bach).';
