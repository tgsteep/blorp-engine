/**
 * Small and medium hydropower plant: penstock, turbine choice, power, water hammer and yearly energy.
 *
 * Turbine choice and runner sizes after the ESHA "Guide on how to develop a small hydropower plant" (Penche, 2004, ch. 6):
 *   specific speed n_QE = n √Q / (g H_n)^¾ (n in rev/s), ranges per type (Table 6.2), runner diameters
 *   (Pelton eqs. 6.16–6.18, Francis 6.20–6.22, Kaplan 6.23–6.24, after de Siervo & Lugaresi / Schweiger & Gregori),
 *   Thoma cavitation coefficient (6.28–6.29) and the setting height of reaction runners (6.27).
 * Penstock: Darcy–Weisbach with Colebrook–White (fluids/pipe.ts), Korteweg wave speed, Joukowsky surge for closure
 * faster than 2L/c and Michaud (Allievi) for slower closure, wall from the hoop stress (Barlow) under static head + surge.
 * Energy: a log-normal daily flow-duration curve, residual (environmental) flow, typical part-load efficiency curves,
 * minimum flow per type, units switched on as the flow rises. SI units; flows m³/s, heads m, power W.
 */
import { pipeSection, waterDensity, waterViscosity } from '../fluids/pipe.ts';
import { isa } from '../aero/ramjet.ts';
import { vapourPressure } from '../fluids/pump.ts';

export const G = 9.81;
const T_WATER = 10; // °C
export const RHO = waterDensity(T_WATER);
const MU = waterViscosity(T_WATER);

export type Turbine = 'pelton' | 'crossflow' | 'francis' | 'kaplan';
export const TURBINES: Turbine[] = ['pelton', 'crossflow', 'francis', 'kaplan'];
export type PipeMat = 'steel' | 'grp' | 'hdpe';

export type HydroIn = {
  Hg: number;               // gross head: intake water level to tail water [m]
  Qd: number;               // design flow of the plant, all units together [m³/s]
  units: number;            // identical turbine–generator units 1…4
  turbine: Turbine | 'auto';
  jets: number;             // Pelton nozzles 1, 2, 4, 6; 0 = choose
  L: number;                // penstock length [m]
  D: number;                // penstock inner diameter [m]
  mat: PipeMat;
  K: number;                // sum of minor-loss coefficients: trash rack, entrance, bends, valve
  tc: number;               // closing time of the guide vanes / nozzles / valve [s]
  alt: number;              // powerhouse altitude [m] (air pressure for the cavitation check)
  Qmean: number;            // mean river flow at the intake [m³/s]
  cv: number;               // coefficient of variation of daily flows (0.3 steady spring-fed … 2 flashy)
  Qres: number;             // residual (environmental) flow left in the river [m³/s]
  avail: number;            // availability (downtime, grid, maintenance) 0…1
};

/** Pipe materials: roughness (ESHA ch. 2: welded steel 0.6 mm), elastic modulus, allowable hoop stress, joint factor,
 *  corrosion allowance, minimum wall, density. Plastics: PE100 (MRS 10 MPa, C = 1.25), GRP typical hoop values. */
export const PIPES: Record<PipeMat, { eps: number; E: number; sa: number; kf: number; es: number; rho: number; minWall: (D: number) => number }> = {
  steel: { eps: 0.6e-3, E: 206e9, sa: 140e6, kf: 0.9, es: 2e-3, rho: 7850, minWall: (D) => (D * 1000 + 508) / 400 / 1000 },
  grp: { eps: 0.03e-3, E: 15e9, sa: 40e6, kf: 1, es: 0, rho: 2000, minWall: (D) => D / 100 },
  hdpe: { eps: 0.007e-3, E: 1.1e9, sa: 8e6, kf: 1, es: 0, rho: 960, minWall: (D) => D / 33 },
};
const K_WATER = 2.1e9; // bulk modulus of water [Pa]

/** n_QE ranges (ESHA Table 6.2); Pelton with n nozzles: ×√n. Head limits are the usual application ranges. */
export const NQE_RANGE: Record<Exclude<Turbine, 'crossflow'>, [number, number]> = { pelton: [0.005, 0.025], francis: [0.05, 0.33], kaplan: [0.19, 1.55] };
export const HEAD_RANGE: Record<Turbine, [number, number]> = { pelton: [20, 1800], crossflow: [1, 200], francis: [5, 700], kaplan: [1.5, 70] };
/** Cross-flow: usual flow per unit [m³/s]. */
export const CROSSFLOW_Q: [number, number] = [0.02, 10];
/** Best efficiency (ESHA Table 6.7; cross-flow typical), minimum usable flow fraction (ESHA §6.2 / 6.4), runaway speed ratio (typical). */
export const ETA_MAX: Record<Turbine, number> = { pelton: 0.9, crossflow: 0.82, francis: 0.94, kaplan: 0.93 };
export const Q_MIN: Record<Turbine, number> = { pelton: 0.1, crossflow: 0.15, francis: 0.4, kaplan: 0.2 };
export const RUNAWAY: Record<Turbine, number> = { pelton: 1.85, crossflow: 1.8, francis: 1.9, kaplan: 2.6 };
const PELTON_1JET = { etaMax: 0.89, qMin: 0.3 };
/** Relative efficiency η/η_max against flow fraction Q/Q_d: typical shapes of manufacturers' curves. */
export const ETA_SHAPE: Record<Turbine, [number, number][]> = {
  pelton: [[0.1, 0.82], [0.2, 0.93], [0.3, 0.97], [0.4, 0.99], [0.6, 1], [0.8, 0.995], [1, 0.98]],
  crossflow: [[0.1, 0.8], [0.2, 0.92], [0.3, 0.96], [0.5, 0.99], [0.7, 1], [1, 0.98]],
  francis: [[0.3, 0.7], [0.4, 0.8], [0.5, 0.87], [0.6, 0.92], [0.7, 0.96], [0.8, 0.99], [0.9, 1], [1, 0.98]],
  kaplan: [[0.15, 0.78], [0.2, 0.86], [0.3, 0.94], [0.4, 0.97], [0.6, 1], [0.8, 1], [1, 0.98]],
};
const interp = (pts: [number, number][], x: number) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [a, fa] = pts[i - 1], [b, fb] = pts[i]; return fa + ((fb - fa) * (x - a)) / (b - a); }
  return pts[pts.length - 1][1];
};
export const etaMaxOf = (t: Turbine, jets = 2) => (t === 'pelton' && jets <= 1 ? PELTON_1JET.etaMax : ETA_MAX[t]);
export const qMinOf = (t: Turbine, jets = 2) => (t === 'pelton' && jets <= 1 ? PELTON_1JET.qMin : Q_MIN[t]);
/** Turbine efficiency at the flow fraction q = Q/Q_d of one unit (0 below the minimum flow). */
export const turbineEta = (t: Turbine, q: number, jets = 2) => (q < qMinOf(t, jets) - 1e-9 || q <= 0 ? 0 : etaMaxOf(t, jets) * interp(ETA_SHAPE[t], Math.min(q, 1.05)));
/** Generator efficiency against its power (ESHA Table 6.8: 0.91 at 10 kW … 0.97 at 1 MW; larger machines typical). */
export const generatorEta = (P: number) => interp([[1e4, 0.91], [5e4, 0.935], [1e5, 0.945], [2.5e5, 0.955], [5e5, 0.962], [1e6, 0.97], [1e7, 0.977], [1e8, 0.985]].map(([p, e]) => [Math.log10(p), e]) as [number, number][], Math.log10(Math.max(P, 1)));

/** Synchronous speeds of a 50 Hz generator directly on the turbine shaft: 3000/p rpm, p = 2…50 pole pairs. */
export const SYNC_RPM = Array.from({ length: 49 }, (_, i) => 3000 / (i + 2));
/** Specific speed n_QE = n √Q / (g H)^¾ with n in rev/s (ESHA eq. 6.5). */
export const nQE = (rpm: number, Q: number, H: number) => ((rpm / 60) * Math.sqrt(Q)) / Math.pow(G * H, 0.75);
/** Thoma coefficient (ESHA 6.28 Francis, 6.29 Kaplan), V = 2 m/s at the draft-tube outlet. */
export const thoma = (t: 'francis' | 'kaplan', nqe: number, H: number, V = 2) => (t === 'francis' ? 1.2715 * Math.pow(nqe, 1.41) : 1.5241 * Math.pow(nqe, 1.46)) + (V * V) / (2 * G * H);
/** Setting height of the runner above tail water (ESHA 6.27): H_s = (p_atm − p_v)/(ρg) + V²/(2g) − σ H_n. */
export const settingHeight = (sigma: number, H: number, alt: number, V = 2) => (isa(alt).p - vapourPressure(T_WATER)) / (RHO * G) + (V * V) / (2 * G) - sigma * H;

/** Runner dimensions [m] (ESHA eqs. 6.16–6.24). */
export const pelton = (Q: number, H: number, rpm: number, jets: number) => ({
  D1: (0.68 * Math.sqrt(H)) / (rpm / 60),                        // pitch diameter of the buckets
  B2: 1.68 * Math.sqrt(Q / (jets * Math.sqrt(H))),               // bucket width
  De: (1.178 * Math.sqrt(Q / jets)) / Math.pow(G * H, 0.25),      // nozzle (jet) diameter
});
export const francis = (H: number, rpm: number, nqe: number) => {
  const D3 = (84.5 * (0.31 + 2.488 * nqe) * Math.sqrt(H)) / rpm; // runner outlet
  const D1 = D3 * (0.4 + 0.095 / nqe);                            // inlet
  return { D3, D1, D2: nqe > 0.164 ? D3 * (0.96 + 0.3781 * nqe) : D1 };
};
export const kaplan = (H: number, rpm: number, nqe: number) => {
  const De = (84.5 * (0.79 + 1.602 * nqe) * Math.sqrt(H)) / rpm; // blade tip
  return { De, Di: De * (0.25 + 0.0951 / nqe) };                  // hub
};
/** Cross-flow runner (Mockmore & Merryfield): n = 39.85 √H / D; a 0.4 m runner, jet thickness 0.1 D (drawing proportions). */
export const crossflow = (Q: number, H: number) => {
  const D = 0.4, rpm = (39.85 * Math.sqrt(H)) / D;
  const b = Q / (0.98 * Math.sqrt(2 * G * H) * 0.1 * D);
  return { D, rpm, b };
};

export type Selection = {
  type: Turbine; rpm: number; nqe: number; jets: number; inRange: boolean; range: [number, number];
  sigma: number; Hs: number; dims: Record<string, number>;
};
export const HS_MIN = 0; // runner above tail water: no excavation of the powerhouse pit (ESHA example)

/** Every candidate (type, jets, synchronous speed) for one unit with flow Qu at net head H. */
function candidates(type: Turbine, Qu: number, H: number, alt: number, jetsIn: number): Selection[] {
  if (type === 'crossflow') {
    const c = crossflow(Qu, H);
    const ok = H >= HEAD_RANGE.crossflow[0] && H <= HEAD_RANGE.crossflow[1] && Qu >= CROSSFLOW_Q[0] && Qu <= CROSSFLOW_Q[1];
    return [{ type, rpm: c.rpm, nqe: nQE(c.rpm, Qu, H), jets: 1, inRange: ok, range: [NaN, NaN], sigma: NaN, Hs: NaN, dims: { D: c.D, b: c.b } }];
  }
  const out: Selection[] = [];
  const jetsList = type === 'pelton' ? (jetsIn > 0 ? [jetsIn] : [1, 2, 4, 6]) : [1];
  const hOk = H >= HEAD_RANGE[type][0] && H <= HEAD_RANGE[type][1];
  for (const jets of jetsList) for (const rpm of SYNC_RPM) {
    const q = nQE(rpm, Qu, H);
    const [lo, hi] = NQE_RANGE[type], k = type === 'pelton' ? Math.sqrt(jets) : 1;
    const range: [number, number] = [lo * k, hi * k];
    let sigma = NaN, Hs = NaN, dims: Record<string, number>;
    if (type === 'pelton') dims = pelton(Qu, H, rpm, jets);
    else { sigma = thoma(type, q, H); Hs = settingHeight(sigma, H, alt); dims = type === 'francis' ? francis(H, rpm, q) : kaplan(H, rpm, q); }
    out.push({ type, rpm, nqe: q, jets, inRange: hOk && q >= range[0] && q <= range[1], range, sigma, Hs, dims });
  }
  return out;
}
/** How far a candidate is outside its range (log scale; 0 inside). */
const miss = (c: Selection) => (c.type === 'crossflow' || !Number.isFinite(c.range[0]) ? 0 : Math.max(0, Math.log(c.range[0] / c.nqe), Math.log(c.nqe / c.range[1])));
const settles = (c: Selection) => c.type === 'pelton' || c.type === 'crossflow' || c.Hs >= HS_MIN;

/** Turbine choice: the fastest synchronous speed (smallest machine and generator) whose n_QE lies in the type's range
 *  and whose reaction runner can sit above tail water (no excavation); Pelton: the fewest nozzles at that speed.
 *  Cross-flow only when no other type fits (or when chosen). */
export function selectTurbine(type: Turbine | 'auto', Qu: number, H: number, alt: number, jets: number): Selection {
  const types: Turbine[] = type === 'auto' ? ['francis', 'kaplan', 'pelton'] : [type];
  const all = types.flatMap((t) => candidates(t, Qu, H, alt, jets));
  const rank = (a: Selection, b: Selection) => b.rpm - a.rpm || a.jets - b.jets || types.indexOf(a.type) - types.indexOf(b.type);
  const good = all.filter((c) => c.inRange && settles(c)).sort(rank);
  if (good.length) return good[0];
  if (type === 'auto') { const cf = candidates('crossflow', Qu, H, alt, jets)[0]; if (cf.inRange) return cf; }
  const inR = all.filter((c) => c.inRange).sort((a, b) => b.Hs - a.Hs || rank(a, b));
  if (inR.length) return inR[0]; // in range, but set deep
  return all.sort((a, b) => miss(a) - miss(b) || rank(a, b))[0];
}

/* ---------- drive between turbine and generator ---------- */

/** ESHA guide (Penche 2004, ch. 6, speed increasers): runners slower than about 400 rpm — mostly low-head Kaplan and
 *  Francis units — usually drive a standard 1000 or 1500 rpm generator through a speed increaser, which in small units
 *  is cheaper than a slow, many-pole generator. Here: units up to 5 MW below 400 rpm get a gearbox to the fastest
 *  standard generator reachable in one parallel-shaft stage (ratio ≤ 5; two stages otherwise), 98 % per stage;
 *  cross-flow turbines drive through a belt (97 %); everything else is coupled directly. */
export const GEARBOX = { belowRpm: 400, maxPower: 5e6, genRpm: [1500, 1000, 750], maxStageRatio: 5, etaStage: 0.98 };
export type Drive = { kind: 'direct' | 'gearbox' | 'belt'; nGen: number; ratio: number; stages: number; eta: number };
export function driveFor(type: Turbine, rpm: number, Pshaft: number): Drive {
  if (type === 'crossflow') return { kind: 'belt', nGen: 1500, ratio: 1500 / rpm, stages: 1, eta: 0.97 };
  if (!(rpm < GEARBOX.belowRpm) || !(Pshaft <= GEARBOX.maxPower)) return { kind: 'direct', nGen: rpm, ratio: 1, stages: 0, eta: 1 };
  const one = GEARBOX.genRpm.find((n) => n / rpm <= GEARBOX.maxStageRatio);
  const nGen = one ?? GEARBOX.genRpm[0];
  const stages = one ? 1 : Math.ceil(Math.log(nGen / rpm) / Math.log(GEARBOX.maxStageRatio) - 1e-9);
  return { kind: 'gearbox', nGen, ratio: nGen / rpm, stages, eta: GEARBOX.etaStage ** stages };
}

/* ---------- flow-duration curve ---------- */

/** Inverse standard normal (Acklam). */
export function normInv(p: number) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
/** River flow exceeded during the fraction p of the year: log-normal with mean Q̄ and coefficient of variation cv. */
export const flowExceeded = (p: number, Qmean: number, cv: number) => {
  const s2 = Math.log(1 + cv * cv), mu = Math.log(Math.max(Qmean, 1e-9)) - s2 / 2;
  return Math.exp(mu + Math.sqrt(s2) * normInv(1 - p));
};
export const FDC_BINS = 100;

/* ---------- the plant ---------- */

export function penstockLoss(p: Pick<HydroIn, 'L' | 'D' | 'mat' | 'K'>, Q: number) {
  if (Q <= 0) return { h: 0, hF: 0, hM: 0, v: 0, f: 0, Re: 0 };
  const s = pipeSection({ rho: RHO, mu: MU }, Q, { D: p.D, L: p.L, eps: PIPES[p.mat].eps, K: p.K });
  return { h: s.hF + s.hM, hF: s.hF, hM: s.hM, v: s.v, f: s.f, Re: s.Re };
}

/** Wave speed (Korteweg, thin elastic pipe free to stretch). */
export const waveSpeed = (D: number, e: number, E: number) => Math.sqrt(K_WATER / RHO) / Math.sqrt(1 + (K_WATER * D) / (E * e));
/** Pressure-head rise for closing in t_c from velocity v: Joukowsky c v/g when t_c ≤ 2L/c, else Michaud 2Lv/(g t_c). */
export const surgeHead = (c: number, v: number, L: number, tc: number) => (tc <= (2 * L) / c ? (c * v) / G : (2 * L * v) / (G * tc));

/** Penstock wall and water hammer at velocity v: the wall depends on the surge, the surge on the wave speed and the
 *  wave speed on the wall, so the three are iterated. Design pressure = static head H_g + surge. */
export function penstockWall(p: Pick<HydroIn, 'D' | 'L' | 'Hg' | 'mat' | 'tc'>, v: number) {
  const pm = PIPES[p.mat];
  let e = pm.minWall(p.D), c = 0, dh = 0, pDes = 0, eReq = 0;
  for (let i = 0; i < 8; i++) {
    c = waveSpeed(p.D, Math.max(e - pm.es, 1e-4), pm.E);
    dh = surgeHead(c, v, p.L, p.tc);
    pDes = RHO * G * (p.Hg + dh);
    eReq = (pDes * p.D) / (2 * pm.sa * pm.kf) + pm.es;
    e = Math.max(pm.minWall(p.D), eReq);
  }
  return { c, dh, Tcrit: (2 * p.L) / c, e, eReq, pDes, mass: pm.rho * Math.PI * (p.D + e) * e * p.L };
}

export function hydro(p: HydroIn) {
  const units = Math.max(1, Math.round(p.units)), Qu = p.Qd / units;
  const loss = penstockLoss(p, p.Qd);
  const Hn = p.Hg - loss.h, Hd = Math.max(Hn, 0.02 * p.Hg); // design net head (sizing never sees ≤ 0)
  const sel = selectTurbine(p.turbine, Qu, Hd, p.alt, p.jets);
  const etaT = turbineEta(sel.type, 1, sel.jets);
  const drive = driveFor(sel.type, sel.rpm, RHO * G * Qu * Math.max(Hn, 0) * etaT), etaDrive = drive.eta;
  const PuShaft = RHO * G * Qu * Math.max(Hn, 0) * etaT * etaDrive;
  const etaG = generatorEta(PuShaft);
  const Pu = PuShaft * etaG, P = Pu * units;
  const Phyd = RHO * G * p.Qd * p.Hg;
  const eta = Phyd > 0 ? P / Phyd : 0;

  const pm = PIPES[p.mat], v = loss.v;
  const { c, dh, Tcrit, e, eReq, pDes, mass } = penstockWall(p, v);

  // yearly energy from the flow-duration curve
  const qMin = qMinOf(sel.type, sel.jets);
  const fdc: { p: number; Qr: number; Qt: number; k: number; P: number }[] = [];
  let E = 0, hoursRun = 0;
  for (let i = 0; i < FDC_BINS; i++) {
    const pp = (i + 0.5) / FDC_BINS, Qr = flowExceeded(pp, p.Qmean, p.cv);
    const Qa = Math.max(0, Qr - p.Qres);
    let Qt = Math.min(Qa, p.Qd), k = Math.min(units, Math.ceil(Qt / Qu - 1e-9));
    let q = k > 0 ? Qt / (k * Qu) : 0;
    if (k <= 1 && q < qMin) { Qt = 0; k = 0; q = 0; }
    let Pb = 0;
    if (Qt > 0) {
      const hn = p.Hg - penstockLoss(p, Qt).h;
      const sh = RHO * G * Qt * Math.max(hn, 0) * turbineEta(sel.type, q, sel.jets) * etaDrive;
      Pb = sh * generatorEta(sh / k);
      hoursRun += 8760 / FDC_BINS;
    }
    fdc.push({ p: pp, Qr, Qt, k, P: Pb });
    E += (Pb * 8760) / FDC_BINS;
  }
  E *= p.avail; hoursRun *= p.avail;
  const CF = P > 0 ? E / (P * 8760) : 0;

  const lossPct = (100 * loss.h) / p.Hg;
  const rr = sel.range;
  const checks: { ok: boolean; label: string; detail: string }[] = [
    { ok: Hn > 0, label: 'Net head left after the penstock losses', detail: `H_n = ${Hn.toFixed(1)} m` },
    { ok: lossPct <= 10, label: 'Penstock head loss at most 10 % of the gross head', detail: `h_L = ${loss.h.toFixed(2)} m = ${lossPct.toFixed(1)} %` },
    { ok: v <= 5, label: 'Penstock velocity at most 5 m/s (wear, surge)', detail: `v = ${v.toFixed(2)} m/s` },
    { ok: p.L >= p.Hg, label: 'Penstock at least as long as the drop', detail: `L = ${p.L.toFixed(0)} m, H_g = ${p.Hg.toFixed(0)} m` },
    sel.type === 'crossflow'
      ? { ok: sel.inRange, label: 'Cross-flow within its usual range: head 1…200 m, 0.02…10 m³/s per unit', detail: `H_n = ${Hd.toFixed(1)} m, Q = ${Qu.toFixed(3)} m³/s` }
      : { ok: sel.inRange, label: 'Specific speed within the range of the turbine type (ESHA Table 6.2)', detail: `n_QE = ${sel.nqe.toFixed(3)}, range ${rr[0].toFixed(3)}…${rr[1].toFixed(3)} at ${sel.rpm.toFixed(0)} rpm; head ${HEAD_RANGE[sel.type][0]}…${HEAD_RANGE[sel.type][1]} m` },
  ];
  if (sel.type === 'pelton') checks.push({ ok: sel.dims.D1 / sel.dims.B2 > 2.7, label: 'Buckets fit the wheel: D₁/B₂ > 2.7', detail: `D₁/B₂ = ${(sel.dims.D1 / sel.dims.B2).toFixed(2)}` });
  if (sel.type === 'francis' || sel.type === 'kaplan') checks.push({ ok: sel.Hs >= HS_MIN, label: 'No cavitation with the runner set above tail water (no excavation)', detail: `H_s = ${sel.Hs.toFixed(2)} m (σ = ${sel.sigma.toFixed(4)})` });
  checks.push({ ok: dh <= 0.5 * p.Hg, label: 'Pressure rise on closing at most 50 % of the static head', detail: `Δh = ${dh.toFixed(1)} m, t_c = ${p.tc.toFixed(1)} s, 2L/c = ${Tcrit.toFixed(2)} s` });
  if (p.mat === 'hdpe') checks.push({ ok: e <= p.D / 7.4, label: 'HDPE pipe within its pressure classes (SDR ≥ 7.4)', detail: `SDR = D/e = ${(p.D / e).toFixed(1)}` });
  if (p.mat === 'grp') checks.push({ ok: pDes <= 3.2e6, label: 'GRP pipe within its pressure classes (≤ PN 32)', detail: `p = ${(pDes / 1e5).toFixed(1)} bar` });
  checks.push({ ok: CF >= 0.3, label: 'Capacity factor at least 30 % (usual for an economic run-of-river plant)', detail: `CF = ${(CF * 100).toFixed(0)} %` });

  return {
    units, Qu, loss, Hn, sel, drive, etaT, etaG, etaDrive, Pu, P, Phyd, eta, runaway: sel.rpm * RUNAWAY[sel.type],
    pipe: { v, c, dh, Tcrit, e, eReq, pDes, mass }, fdc, E, CF, hoursRun, qMin, checks,
  };
}
export type HydroResult = ReturnType<typeof hydro>;

/* ---------- presets ---------- */

export type HydroKind = 'medium' | 'high' | 'low' | 'micro';
export const HYDRO_PRESETS: Record<HydroKind, HydroIn> = {
  medium: { Hg: 210, Qd: 1.5, units: 1, turbine: 'auto', jets: 0, L: 900, D: 0.9, mat: 'steel', K: 1.5, tc: 10, alt: 1000, Qmean: 1.3, cv: 0.8, Qres: 0.1, avail: 0.95 },
  high: { Hg: 420, Qd: 0.42, units: 1, turbine: 'auto', jets: 0, L: 1500, D: 0.5, mat: 'steel', K: 1.5, tc: 20, alt: 1200, Qmean: 0.35, cv: 0.9, Qres: 0.03, avail: 0.95 },
  low: { Hg: 12, Qd: 25, units: 2, turbine: 'auto', jets: 0, L: 40, D: 3.2, mat: 'steel', K: 1, tc: 8, alt: 200, Qmean: 22, cv: 0.7, Qres: 2, avail: 0.95 },
  micro: { Hg: 35, Qd: 0.12, units: 1, turbine: 'crossflow', jets: 0, L: 150, D: 0.3, mat: 'hdpe', K: 2, tc: 10, alt: 600, Qmean: 0.12, cv: 1, Qres: 0.01, avail: 0.93 },
};

export const HYDRO_INTRO = 'Water falling through a height gives up its energy: P = ρ g Q H η. A penstock brings it from the intake down to the powerhouse, losing some head to friction, and the turbine is chosen from the head and flow: Pelton wheels for high heads and small flows, Francis runners in between, Kaplan propellers for low heads and large flows. A river does not give the design flow all year, so the yearly energy comes from its flow-duration curve. Closing the turbine quickly makes a pressure wave (water hammer) that the pipe wall must carry.';

export const HYDRO_NOTES = [
  'Turbine choice and runner sizes after the ESHA Guide on how to develop a small hydropower plant (Penche, 2004, chapter 6): specific speed n_QE = n√Q/(gH_n)^¾ with the ranges of Table 6.2 (Pelton 0.005…0.025 √n_jets, Francis 0.05…0.33, Kaplan 0.19…1.55), runner diameters from statistical correlations (eqs. 6.16–6.24), Thoma coefficient eqs. 6.28–6.29 and setting height (p_atm − p_v)/(ρg) + V²/(2g) − σH_n with V = 2 m/s, standard-atmosphere air pressure at the powerhouse altitude and water at 10 °C. VALIDATION: n_QE, Pelton D₁, B₂, nozzle diameter, Francis D₃, D₁ and σ reproduce the guide’s worked examples (400 m / 0.42 m³/s at 1000 rpm; 200 m / 1.5 m³/s with 1- and 4-nozzle Pelton and Francis at 1500 and 1000 rpm). The bucket-width and nozzle formulas are written in the form that reproduces those examples.',
  'The runner turns at a synchronous speed of a 50 Hz grid (3000/p rpm); the tool takes the fastest speed whose n_QE is in range and whose reaction runner can sit above tail water without cavitation (no excavation), and for Pelton wheels the fewest nozzles at that speed. Cross-flow turbines (belt drive, a 0.4 m runner, n = 39.85√H/D after Mockmore & Merryfield) are chosen only when no other type fits. Head limits per type are usual application ranges, not hard limits. Drive: a runner slower than 400 rpm in a unit up to 5 MW drives a standard 1500, 1000 or 750 rpm generator through a parallel-shaft speed increaser (ratio up to 5 per stage, 98 % per stage; ESHA ch. 6 on speed increasers); faster or larger units are coupled directly to a generator with as many poles as their speed needs.',
  'Efficiencies: best values from ESHA Table 6.7 (Pelton 0.89 one nozzle / 0.90 several, Francis 0.94, Kaplan double regulated 0.93; cross-flow 0.82 typical); the part-load shapes and runaway speeds are typical manufacturers’ curves, not of a specific machine. Minimum flow per unit: Pelton 30 % (one nozzle) or 10 %, cross-flow 15 %, Francis 40 %, Kaplan 20 %. Generator efficiency from ESHA Table 6.8 (0.91 at 10 kW … 0.97 at 1 MW), higher for large machines.',
  'Penstock: Darcy–Weisbach with Colebrook–White at 10 °C (VALIDATION: ESHA Example 2.5, 500 m welded steel pipe at 4 m/s, within 2 %), one pipe for all units, minor losses as one K. Wall: hoop stress e = pD/(2σ_a k_f) + corrosion allowance, with p from the static head plus the surge; steel S235 with σ_a = 140 MPa, weld factor 0.9, 2 mm corrosion, minimum (D + 508 mm)/400 for handling; PE100 σ_a = 8 MPa, minimum SDR 33; GRP typical values. Buckling of an empty pipe (air valves!), supports, anchor blocks and expansion joints are not checked.',
  'Water hammer: Korteweg wave speed c = √(K/ρ)/√(1 + KD/(Ee)), Joukowsky Δh = cv/g when the closing time is shorter than 2L/c, Michaud Δh = 2Lv/(g t_c) otherwise (linear closure, no friction, no surge tank). Real governors close in steps and Pelton wheels use jet deflectors; a long low-head penstock needs a surge tank.',
  'Yearly energy: daily river flows log-normal with the mean and coefficient of variation you set (a smooth stand-in for a measured flow-duration curve: use the station’s record for a real project), minus the residual flow, up to the design flow; units are switched on as the flow rises and share it equally; head loss recalculated at every flow; availability for downtime. No limits from the grid, no flood tail-water rise, no evaporation or ice.',
];
