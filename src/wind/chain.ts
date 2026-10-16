/**
 * Wind turbine, stages after the rotor: drivetrain, tower and foundation. Every stage takes its loads from the
 * rotor result (rated torque, peak thrust, rotor mass) of the scaled NREL 5-MW reference turbine, and stays simple:
 * a few inputs, first-estimate sizes and the main checks. Units: SI (m, N, kg) unless noted.
 */
import { classic, type BearingIn } from '../civil/bearing.ts';
import { FIXED, REF, type RotorResult } from './bem.ts';

const G = 9.81;
export type Check = { ok: boolean; label: string; detail: string };
/** Load factors of IEC 61400-1 for normal design situations: aerodynamic loads 1.35, gravity 1.1. */
export const GAMMA_AERO = 1.35, GAMMA_GRAV = 1.1;

/* ---------------- drivetrain ---------------- */

export const GENERATORS = [
  { id: 'high', name: 'High-speed generator, three-stage gearbox', rpm: 1173.7, stages: 3 },
  { id: 'medium', name: 'Medium-speed generator, two-stage gearbox', rpm: 400, stages: 2 },
  { id: 'direct', name: 'Direct drive (no gearbox)', rpm: 0, stages: 0 },
] as const;
export type GenId = (typeof GENERATORS)[number]['id'];

export type DriveIn = { gen: GenId; d: number }; // generator concept, main shaft diameter [m]

/** Masses after the NREL cost and scaling model (Fingersh, Hand and Laxson 2006), torque Q in kNm, power P in kW. */
export function driveMasses(gen: GenId, QkNm: number, PkW: number) {
  if (gen === 'high') return { gearbox: 70.94 * Math.pow(QkNm, 0.759), generator: 6.47 * Math.pow(PkW, 0.9223) };
  if (gen === 'medium') return { gearbox: 88.29 * Math.pow(QkNm, 0.774), generator: 10.51 * Math.pow(PkW, 0.9223) };
  return { gearbox: 0, generator: 661.25 * Math.pow(QkNm, 0.606) };
}

/** Main shaft material: forged 42CrMo4 +QT, large section (EN 10083-3: R_m 750…900 MPa, R_e ≥ 500 MPa above 160 mm). */
export const SHAFT = { Sut: 800e6, fy: 500e6, nFat: 1.5, ke: 0.814 };

/**
 * Solid main shaft at the front bearing: bending moment M from the rotor weight (rotating → fully reversed), rated rotor
 * torque Q (mean). Fatigue: DE-Goodman (Shigley eq. 7-7) with K_f = 1, Marin factors k_a machined (6-19), k_b size (6-20,
 * extrapolated above 254 mm), k_e 99 % reliability. Static: von Mises with 1.1 × weight moment and 1.35 × torque ≤ f_y/1.1.
 */
export function shaftCheck(M: number, Q: number, d: number) {
  const ka = 4.51 * Math.pow(SHAFT.Sut / 1e6, -0.265), kb = Math.min(1, 1.51 * Math.pow(d * 1000, -0.157));
  const Se = 0.5 * SHAFT.Sut * ka * kb * SHAFT.ke, k = 16 / (Math.PI * d ** 3);
  const sa = 2 * k * M, tm = k * Q, n = 1 / (sa / Se + (Math.sqrt(3) * tm) / SHAFT.Sut);
  const sb = 2 * k * GAMMA_GRAV * M, tau = k * GAMMA_AERO * Q, svm = Math.sqrt(sb * sb + 3 * tau * tau), sRd = SHAFT.fy / 1.1;
  return { ka, kb, Se, sa, tm, n, sb, tau, svm, sRd, okFat: n >= SHAFT.nFat, okStat: svm <= sRd };
}
/** Smallest diameter that passes a test which is monotonic in d (bisection). */
export function dReqFor(ok: (d: number) => boolean) {
  let lo = 0.02, hi = 6;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (ok(m)) hi = m; else lo = m; }
  return hi;
}
/** Smallest solid geared-drive main shaft that passes both checks. */
export const shaftDReq = (M: number, Q: number) => dReqFor((d) => { const c = shaftCheck(M, Q, d); return c.okFat && c.okStat; });

/**
 * Direct drive (sizes × scale s, measured back from the hub centre): the generator (Ø 6.4 m, from 2.0 to 3.1 m) sits on
 * the front flange of the cast neck at 3.3 m; a hollow stationary shaft (kingpin, bore 0.6 d) runs from the flange through
 * the generator to the hub and carries the main bearings at 2.3 and 2.9 m; the hub turns on them and drives the generator
 * rotor (40 % of the generator mass, assumed). Air gap ≈ D_gen/1000; deflection allowed 20 % of it.
 */
export const DD = { root: 3.3, gen0: 2.0, genL: 1.1, Dgen: 6.4, b1: 2.3, b2: 2.9, bore: 0.6, rotFrac: 0.4, gapFrac: 0.2 };
/** Kingpin as a cantilever from the neck flange: rotor weight W at the hub centre, generator rotor weight at its middle.
 * No torque (hub → generator rotor directly), no rotation (static bending). */
export function kingpinCheck(W: number, mGen: number, s: number, d: number) {
  const a = DD.root * s, xg = (DD.root - DD.gen0 - DD.genL / 2) * s, Wg = DD.rotFrac * mGen * G;
  const Mroot = W * a + Wg * xg, I = (Math.PI * d ** 4 * (1 - DD.bore ** 4)) / 64, Zk = I / (d / 2);
  const sk = (GAMMA_GRAV * Mroot) / Zk, sRd = SHAFT.fy / 1.1;
  const delta = ((W * xg * xg * (3 * a - xg)) / 6 + (Wg * xg ** 3) / 3) / (TOWER_REF.E * I), gap = (DD.Dgen * s) / 1000, dAllow = DD.gapFrac * gap;
  return { a, xg, Wg, Mroot, Zk, sk, sRd, delta, gap, dAllow, okStat: sk <= sRd, okGap: delta <= dAllow };
}

/** Loads on the main shaft of the scaled reference turbine with rotor diameter D and rated power P (rated torque at the tip-speed limit). */
export function shaftLoads(D: number, P: number) {
  const R = D / 2, s = R / REF.R, w = FIXED.vTip / R, W = REF.mRotor * Math.pow(s, 2.6) * G;
  return { s, W, Q: P / FIXED.eta / w, M: W * 1.9 * s };
}
/** Main shaft (or kingpin for direct drive) needed by a turbine of rated power P at the given specific power P/A (W/m²). */
export function shaftForPower(P: number, specific: number, gen: GenId = 'high') {
  const D = Math.sqrt((4 * P) / (Math.PI * specific)), l = shaftLoads(D, P);
  if (gen !== 'direct') return { D, ...l, dReq: shaftDReq(l.M, l.Q) };
  const mGen = driveMasses('direct', l.Q / 1e3, P / 1e3).generator;
  return { D, ...l, dReq: dReqFor((d) => { const k = kingpinCheck(l.W, mGen, l.s, d); return k.okStat && k.okGap; }) };
}
/** Largest rated power a shaft of diameter d carries at the given specific power (bisection on log P). */
export function shaftPowerLimit(d: number, specific: number, gen: GenId = 'high') {
  let lo = Math.log(1e4), hi = Math.log(1e8);
  if (shaftForPower(Math.exp(hi), specific, gen).dReq <= d) return Math.exp(hi);
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (shaftForPower(Math.exp(m), specific, gen).dReq <= d) lo = m; else hi = m; }
  return Math.exp(lo);
}

export function drivetrain(r: RotorResult, p: DriveIn, Prated: number) {
  const g = GENERATORS.find((x) => x.id === p.gen)!, nRot = r.rated.rpm, Q = r.rated.Q, dd = !g.stages;
  const ratio = g.stages ? g.rpm / nRot : 1, stage = g.stages ? Math.pow(ratio, 1 / g.stages) : 1;
  const etaStage = 0.985; // per gear stage
  // shafts along the chain: rotor/low-speed shaft, after each stage
  const shafts = [{ n: nRot, Q }];
  for (let i = 0; i < g.stages; i++) { const prev = shafts[shafts.length - 1]; shafts.push({ n: prev.n * stage, Q: (prev.Q / stage) * etaStage }); }
  // geared: rotating main shaft, rotor weight on an overhang (fully reversed bending) and the rated torque.
  // direct drive: stationary kingpin, bearings close to the hub
  const over = (dd ? DD.b1 : 1.9) * r.s, span = (dd ? DD.b2 - DD.b1 : 2.5) * r.s; // hub centre to front main bearing, bearing spacing (scaled)
  const W = r.mRotor * G, M = W * 1.9 * r.s, T = GAMMA_AERO * Q;
  const m = driveMasses(p.gen, Q / 1e3, Prated / 1e3);
  const sc = shaftCheck(M, Q, p.d), kp = kingpinCheck(W, m.generator, r.s, p.d);
  const dReq = dd ? dReqFor((d) => { const k = kingpinCheck(W, m.generator, r.s, d); return k.okStat && k.okGap; }) : shaftDReq(M, Q);
  const shaftOk = dd ? kp.okStat && kp.okGap : sc.okFat && sc.okStat;
  // bearing loads (two-bearing arrangement): front bearing carries weight + moment, and the thrust
  const Ffront = W * (1 + over / span), Frear = W * (over / span), Fa = r.peakT.T;
  const mm = (x: number) => (x * 1000).toFixed(0);
  const checks: Check[] = [
    ...r.sizeChecks,
    ...(g.stages ? [{ ok: stage <= 7, label: 'Gear ratio per stage ≤ 7', detail: `${stage.toFixed(2)} in each of ${g.stages} stages (total ${ratio.toFixed(1)})` }] : []),
    ...(dd ? [
      { ok: kp.okStat, label: 'Stationary shaft strength: σ = 1.1 M/Z ≤ f_y/1.1', detail: `σ = ${(kp.sk / 1e6).toFixed(0)} ≤ ${(kp.sRd / 1e6).toFixed(0)} MPa at d = ${mm(p.d)} mm; this turbine needs d ≥ ${mm(dReq)} mm` },
      { ok: kp.okGap, label: 'Air gap: shaft deflection at the generator ≤ 20 % of the air gap', detail: `δ = ${(kp.delta * 1000).toFixed(2)} ≤ ${(kp.dAllow * 1000).toFixed(2)} mm (air gap ${(kp.gap * 1000).toFixed(1)} mm)` },
    ] : [
      { ok: sc.okFat, label: 'Main shaft fatigue: safety n ≥ 1.5 (DE-Goodman)', detail: `n = ${sc.n.toFixed(2)} at d = ${mm(p.d)} mm; this turbine needs d ≥ ${mm(dReq)} mm` },
      { ok: sc.okStat, label: 'Main shaft static strength: σ_vM ≤ f_y/1.1', detail: `σ_vM = ${(sc.svm / 1e6).toFixed(0)} ≤ ${(sc.sRd / 1e6).toFixed(0)} MPa` },
    ]),
  ];
  return { g, ratio, stage, shafts, over, span, W, M, T, ...sc, kp, shaftOk, Ffront, Frear, Fa, mGear: m.gearbox, mGen: m.generator, dReq, Pmax: shaftPowerLimit(p.d, r.specific, p.gen), checks };
}
export type DriveResult = ReturnType<typeof drivetrain>;

/* ---------------- tower ---------------- */

/** M-thread stress areas [mm²] (ISO 898-1) for large flange bolts, grade 10.9 (f_ub = 1000 MPa). */
export const FLANGE_BOLTS = [
  { name: 'M30', d: 30, As: 561 }, { name: 'M36', d: 36, As: 817 }, { name: 'M42', d: 42, As: 1121 },
  { name: 'M48', d: 48, As: 1473 }, { name: 'M56', d: 56, As: 2030 }, { name: 'M64', d: 64, As: 2676 },
];
export type TowerIn = { Db: number; tb: number; nb: number; bolt: string }; // base diameter [m], base wall [m], bolts in the base flange
/** Reference tower (NREL 5 MW onshore, ElastoDyn tower file): 87.6 m, Ø 6 → 3.87 m, wall 35.1 → 24.7 mm (from the published
 * mass and stiffness), ρ 8500 kg/m³ (flanges, paint), E 210 GPa; first fore-aft frequency 0.324 Hz (Jonkman et al. 2009). */
export const TOWER_REF = { L: 87.6, Db: 6, Dt: 3.87, tb: 0.0351, tt: 0.0247, rho: 8500, E: 210e9, fy: 345e6, mNacelle: 240000, f1: 0.324 };

/** Tower as N segments; first bending frequency by Rayleigh's method with the static deflection under lateral self-weight. */
export function towerModes(L: number, Db: number, Dt: number, tb: number, tt: number, mTop: number, N = 60) {
  const E = TOWER_REF.E, rho = TOWER_REF.rho, dz = L / N, segs: { z: number; D: number; t: number; I: number; m: number }[] = [];
  for (let i = 0; i < N; i++) {
    const z = (i + 0.5) * dz, u = z / L, D = Db + u * (Dt - Db), t = tb + u * (tt - tb);
    const Di = D - 2 * t; segs.push({ z, D, t, I: (Math.PI / 64) * (D ** 4 - Di ** 4), m: rho * (Math.PI / 4) * (D * D - Di * Di) * dz });
  }
  // lateral loads F_i = m_i g at segment centres, top mass at z = L; moments, curvature, slope, deflection (cantilever)
  const zs = [...segs.map((s) => s.z), L], F = [...segs.map((s) => s.m * G), mTop * G];
  const Mz = (z: number) => zs.reduce((m, zi, i) => (zi > z ? m + F[i] * (zi - z) : m), 0);
  const nodes = N + 1, y = new Array(nodes).fill(0), th = new Array(nodes).fill(0);
  for (let i = 1; i < nodes; i++) {
    const za = (i - 1) * dz, zb = i * dz, s = segs[i - 1];
    const ka = Mz(za) / (E * s.I), kb = Mz(zb) / (E * s.I);
    th[i] = th[i - 1] + 0.5 * (ka + kb) * dz;
    y[i] = y[i - 1] + 0.5 * (th[i - 1] + th[i]) * dz;
  }
  const yAt = (z: number) => { const k = Math.min(z / dz, nodes - 1), i = Math.floor(k), f = k - i; return i >= nodes - 1 ? y[nodes - 1] : y[i] + f * (y[i + 1] - y[i]); };
  let num = 0, den = 0;
  for (let i = 0; i < zs.length; i++) { const m = F[i] / G, yi = yAt(zs[i]); num += m * yi; den += m * yi * yi; }
  const omega = Math.sqrt((G * num) / den), mTower = segs.reduce((a, s) => a + s.m, 0);
  return { f1: omega / (2 * Math.PI), mTower, shape: Array.from({ length: nodes }, (_, i) => ({ z: i * dz, y: y[i] / y[nodes - 1] })), segs };
}

export function tower(r: RotorResult, p: TowerIn, H: number) {
  const s = r.s, L = Math.max(H - 2.4 * s, 5), taperD = TOWER_REF.Dt / TOWER_REF.Db, taperT = TOWER_REF.tt / TOWER_REF.tb;
  const Dt = p.Db * taperD, tt = p.tb * taperT, mNac = TOWER_REF.mNacelle * Math.pow(s, 2.6), mTop = r.mRotor + mNac;
  const md = towerModes(L, p.Db, Dt, p.tb, tt, mTop);
  const nMax = r.rated.rpm, nMin = nMax * (REF.rpmMin / REF.rpm), f1P = nMax / 60, f3Pmin = (3 * nMin) / 60;
  // base section, ultimate: 1.35 × peak thrust at hub height, 1.1 × weights
  const Mb = GAMMA_AERO * r.peakT.T * H, Nb = GAMMA_GRAV * (mTop + md.mTower) * G;
  const A = Math.PI * p.Db * p.tb, W = (Math.PI / 4) * p.Db ** 2 * p.tb;
  const sig = Nb / A + Mb / W, sigRd = TOWER_REF.fy / 1.1;
  // base flange: bolts on a circle just inside the shell, no prying
  const b = FLANGE_BOLTS.find((x) => x.name === p.bolt) ?? FLANGE_BOLTS[3], Dbolt = p.Db - 0.15 * s;
  const Fbolt = (4 * Mb) / (p.nb * Dbolt) - Nb / p.nb, FtRd = (0.9 * 1000e6 * b.As * 1e-6) / 1.25;
  const pitch = (Math.PI * Dbolt) / p.nb, minPitch = 3 * b.d * 1e-3 * 1.1;
  const checks: Check[] = [
    ...r.sizeChecks, r.heightCheck,
    { ok: md.f1 > 1.1 * f1P, label: 'First tower frequency at least 10 % above 1P (rotor speed)', detail: `f₁ = ${md.f1.toFixed(3)} Hz, 1P = ${f1P.toFixed(3)} Hz` },
    { ok: md.f1 < f3Pmin, label: 'First tower frequency below 3P (blade passing at the lowest rotor speed)', detail: `f₁ = ${md.f1.toFixed(3)} Hz, 3P from ${f3Pmin.toFixed(3)} Hz` },
    { ok: sig <= sigRd, label: 'Tower base stress ≤ f_y/γ_M (S355, γ_M = 1.1)', detail: `σ = ${(sig / 1e6).toFixed(0)} ≤ ${(sigRd / 1e6).toFixed(0)} MPa` },
    { ok: p.Db / p.tb <= 300, label: 'Wall slenderness D/t ≤ 300 (local buckling, simple limit)', detail: `D/t = ${(p.Db / p.tb).toFixed(0)}` },
    { ok: Fbolt <= FtRd, label: 'Base flange bolt tension ≤ F_t,Rd (EN 1993-1-8, 10.9)', detail: `${(Fbolt / 1e3).toFixed(0)} ≤ ${(FtRd / 1e3).toFixed(0)} kN per bolt` },
    { ok: pitch >= minPitch, label: 'Bolts fit on the flange circle (spacing ≥ 3.3 d)', detail: `${(pitch * 1000).toFixed(0)} mm ≥ ${(minPitch * 1000).toFixed(0)} mm` },
  ];
  return { L, Dt, tt, mNac, mTop, ...md, f1P, f3Pmin, f3Pmax: (3 * nMax) / 60, nMin, nMax, Mb, Nb, A, W, sig, sigRd, b, Dbolt, Fbolt, FtRd, pitch, checks };
}
export type TowerResult = ReturnType<typeof tower>;

/* ---------------- foundation ---------------- */

export const SOILS = [
  { id: 'dense', name: 'Dense sand', drained: true, phi: 36, c: 0, cu: 0, gamma: 19, E: 80e6 },
  { id: 'medium', name: 'Medium sand', drained: true, phi: 32, c: 0, cu: 0, gamma: 18, E: 40e6 },
  { id: 'clay', name: 'Stiff clay', drained: false, phi: 0, c: 0, cu: 150, gamma: 19, E: 30e6 },
] as const;
export type SoilId = (typeof SOILS)[number]['id'];
export const FOUND_TYPES = [
  { id: 'slab', name: 'Flat slab (shallow)', Df: 3 },
  { id: 'dome', name: 'Buried dome (deeper)', Df: 4.5 },
] as const;
export type FoundType = (typeof FOUND_TYPES)[number]['id'];
export type FoundIn = { type: FoundType; B: number; Df: number; soil: SoilId }; // type, circular footing diameter [m], depth of the base [m]
/** Concrete 25 kN/m³, backfill on the footing 18 kN/m³. */
export const GAMMA_C = 25e3, GAMMA_FILL = 18e3;

/**
 * Half profile (r, z) of the footing body, z = 0 at ground, base at −D_f; closed along the axis. Slab: rim, conical top
 * rising to the pedestal (scaled sizes of a 5-MW footing). Dome: thin rim, then a spherical dome up to just below the
 * ground, so it is buried under the backfill; both carry a pedestal 0.4 m (scaled) above ground.
 */
export function footingProfile(type: FoundType, B: number, Df: number, s: number, pr: number): [number, number][] {
  const R = B / 2, top = 0.4 * s;
  if (type === 'slab') {
    const hs = Math.min(0.45 * Df, 1.6 * s);
    return [[0, -Df], [R, -Df], [R, -Df + hs * 0.6], [pr, -Df + hs * 1.6], [pr, top], [0, top]];
  }
  const rim = Math.min(0.5 * s, 0.25 * Df), zTop = -Math.min(0.5 * s, 0.2 * Df), h = zTop - (-Df + rim); // dome rises h from the rim to its crown
  const pts: [number, number][] = [[0, -Df], [R, -Df], [R, -Df + rim]];
  for (let i = 1; i <= 16; i++) { const u = i / 16, r = R - u * (R - pr); pts.push([r, -Df + rim + h * Math.sqrt(Math.max(0, 1 - ((r - pr) / (R - pr)) ** 2))]); }
  pts.push([pr, top], [0, top]);
  return pts;
}
/** Volume of the solid of revolution of a closed (r, z) polygon (Pappus), and the part below z = 0. */
export function revolvedVolume(pts: [number, number][], zCut = Infinity) {
  const c = pts.map(([r, z]) => [r, Math.min(z, zCut)] as [number, number]);
  let v = 0;
  for (let i = 0; i < c.length; i++) { const [r1, z1] = c[i], [r2, z2] = c[(i + 1) % c.length]; v += (r1 * z2 - r2 * z1) * (r1 + r2); }
  return Math.abs((Math.PI * v) / 3);
}

/** Concrete C35/45 for the footing, tension steel ratio 0.5 %, 0.1 m from the bottom face to the bar centres. */
export const SLAB = { fck: 35, rho: 0.005, cover: 0.1 };
/**
 * Radial strip of the footing as a cantilever from the pedestal face to the rim, on the most loaded side: upward soil
 * pressure q(x) = V/A + M x/I (linear, circle) minus the local weight of concrete and backfill, × 1.35. Bending
 * K = M_Ed/(b d² f_ck) and shear v_Ed = V_Ed/(b d) against v_Rd,c (EC2 6.2.2) at 24 sections; the worst of each.
 */
export function footingSlab(prof: [number, number][], B: number, Df: number, pr: number, V: number, M: number) {
  const R = B / 2, A = (Math.PI * B * B) / 4, I = (Math.PI * R ** 4) / 4, top = prof.slice(2, prof.length - 2); // rim → pedestal face
  const zTop = (x: number) => {
    for (let i = 0; i < top.length - 1; i++) { const [r1, z1] = top[i], [r2, z2] = top[i + 1]; if (x <= r1 + 1e-9 && x >= r2 - 1e-9) return r1 === r2 ? Math.max(z1, z2) : z1 + ((x - r1) / (r2 - r1)) * (z2 - z1); }
    return top[top.length - 1][1];
  };
  const net = (x: number) => { const z = zTop(x); return V / A + (M * x) / I - GAMMA_C * (z + Df) - GAMMA_FILL * Math.max(0, -z); };
  let K = 0, rK = pr, dK = 0, v = 0, vRd = 1, rV = pr, worstV = -Infinity;
  for (let j = 0; j < 24; j++) {
    const r = pr + ((R - pr) * j) / 24, N = 40, h = (R - r) / N;
    let Vs = 0, Ms = 0;
    for (let i = 0; i < N; i++) { const x = r + (i + 0.5) * h, q = net(x); Vs += q * h; Ms += q * (x - r) * h; }
    const VEd = 1.35 * Math.max(Vs, 0), MEd = 1.35 * Math.max(Ms, 0), d = Math.max(zTop(r) + Df - SLAB.cover, 0.01);
    const k = Math.min(1 + Math.sqrt(200 / (d * 1000)), 2), vr = Math.max(0.12 * k * Math.cbrt(100 * SLAB.rho * SLAB.fck), 0.035 * k ** 1.5 * Math.sqrt(SLAB.fck));
    const Kj = MEd / (d * d * SLAB.fck * 1e6), vj = VEd / d / 1e6;
    if (Kj > K) { K = Kj; rK = r; dK = d; }
    if (vj / vr > worstV) { worstV = vj / vr; v = vj; vRd = vr; rV = r; }
  }
  return { K, rK, dK, v, vRd, rV, tFace: zTop(pr) + Df };
}

export function foundation(r: RotorResult, t: TowerResult, p: FoundIn, H: number) {
  const soil = SOILS.find((x) => x.id === p.soil)!;
  // characteristic loads at the tower base (no load factors: classic global safety factors below)
  const Hk = r.peakT.T, Mtk = Hk * H, Gt = (t.mTop + t.mTower) * G;
  const A = (Math.PI * p.B ** 2) / 4, pr = t.Dbolt / 2 + 1 * r.s;
  const prof = footingProfile(p.type, p.B, p.Df, r.s, pr);
  const vol = revolvedVolume(prof), volBelow = revolvedVolume(prof, 0), soilOn = Math.max(A * p.Df - volBelow, 0);
  const Gc = GAMMA_C * vol, Gs = GAMMA_FILL * soilOn, Gf = Gc + Gs; // concrete, backfill on the footing
  const V = Gt + Gf, M = Mtk + Hk * p.Df, e = M / V;
  const FSot = (V * p.B) / 2 / M;
  const bin: BearingIn = { shape: 'circle', B: p.B, L: p.B, Df: p.Df, drainage: soil.drained ? 'drained' : 'undrained', c: soil.c, phi: soil.phi, cu: soil.cu, gamma: soil.gamma, gammaSat: soil.gamma + 1, Dw: 100, G: V / 1e3, Q: 0, H: Hk / 1e3, e, FS: 3, approach: 'DA1' };
  const bc = classic(bin);
  const sl = footingSlab(prof, p.B, p.Df, pr, V, M);
  const checks: Check[] = [
    ...r.sizeChecks, r.heightCheck,
    { ok: e <= p.B / 8, label: 'No gap under the footing: e ≤ D/8 (kern of a circle)', detail: `e = ${e.toFixed(2)} m ≤ ${(p.B / 8).toFixed(2)} m` },
    { ok: FSot >= 1.5, label: 'Overturning: restoring / overturning moment ≥ 1.5', detail: `FS = ${FSot.toFixed(2)}` },
    { ok: bc.FS >= 3, label: 'Bearing capacity FS ≥ 3 (effective area, inclined load)', detail: `FS = ${bc.FS.toFixed(2)}` },
    { ok: bc.FSslide >= 1.5, label: 'Sliding FS ≥ 1.5', detail: `FS = ${bc.FSslide.toFixed(2)}` },
    { ok: sl.K <= 0.167, label: 'Footing thick enough for bending: K = M/(d² f_ck) ≤ 0.167 (EC2, C35/45)', detail: `K = ${sl.K.toFixed(3)} at r = ${sl.rK.toFixed(1)} m (d = ${sl.dK.toFixed(2)} m)` },
    { ok: sl.v <= sl.vRd, label: 'Footing shear without stirrups: v_Ed ≤ v_Rd,c (EC2 6.2.2)', detail: `v = ${sl.v.toFixed(2)} ≤ ${sl.vRd.toFixed(2)} MPa at r = ${sl.rV.toFixed(1)} m` },
  ];
  return { soil, Hk, Mtk, Gt, Gf, Gc, Gs, A, V, M, e, FSot, bc, vol, soilOn, prof, pr, sl, checks };
}
export type FoundResult = ReturnType<typeof foundation>;

export const DRIVE_INTRO = 'The rotor turns slowly with a huge torque; a generator wants speed. A gearbox trades torque for speed in a few stages (power stays almost the same), or a large direct-drive generator turns with the rotor. The main shaft carries the rotor\'s weight and torque into the nacelle.';
export const DRIVE_NOTES = [
  'Gear ratio = generator speed / rated rotor speed, split equally over the stages (high-speed: 1173.7 rpm as in the NREL 5-MW reference, three stages; medium-speed: 400 rpm, two stages), 98.5 % efficiency per stage. Real gearboxes split the ratio unequally (a planetary first stage takes more) and are sized gear by gear (ISO 6336); use the Gears tools for single stages.',
  'Main shaft as a solid shaft of forged 42CrMo4 (R_m 800 MPa, R_e 500 MPa) at the front bearing: the rotor weight on a 1.9 m overhang (scaled) bends it once per turn (fully reversed), the rated torque twists it. Fatigue: DE-Goodman n = 1/(σ_a/S_e + √3 τ_m/R_m) ≥ 1.5 with S_e = 0.5 R_m k_a k_b k_e (machined, size factor extrapolated above 254 mm, 99 % reliability; Shigley ch. 6–7); static: √((1.1 σ_b)² + 3 (1.35 τ)²) ≤ R_e/1.1. The torque grows with the rated power and the rotor size, so the needed diameter does too: about 0.39 m at 2 MW, 0.67 m at 5 MW for the reference proportions. Not included: wind moments on the hub (tilt and yaw moments from wind shear and gusts, often larger than the weight), thrust, the hollow bore and the notch at the shoulders (K_f) — real main shafts are larger. Bearing loads: two bearings 2.5 m apart (scaled); pick bearings with the Rolling bearings tool.',
  'Masses: NREL cost and scaling model (Fingersh, Hand and Laxson 2006) from the rotor torque and rated power — first estimates only.',
  'Direct drive: the generator (Ø 6.4 m, scaled) sits on the front flange of the cast neck; a hollow stationary shaft (bore 0.6 d) runs from the flange through the generator to the hub and carries the two main bearings. The hub turns on them and drives the generator rotor directly, so this shaft carries no torque and does not rotate: the weights of the rotor (at the hub centre, 3.3 m from the flange, scaled) and of the generator rotor (40 % of the generator mass, assumed) bend it statically. Checks: σ = 1.1 M/Z ≤ R_e/1.1, and the deflection at the generator ≤ 20 % of the air gap (air gap ≈ D_gen/1000) — keeping the air gap is what sizes real direct-drive frames. Wind moments on the hub are not included here either; they make a real stationary shaft much larger.',
];
export const TOWER_INTRO = 'The tower carries the nacelle and rotor and the push of the wind. Two things decide its size: strength at the base, where the bending moment is largest, and stiffness, so that its natural sway does not match the rotor speed (1P) or the blade-passing speed (3P), which would make it resonate.';
export const TOWER_NOTES = [
  'Tapered steel tube with the reference proportions (top/base diameter 0.645, wall 0.704), ρ = 8500 kg/m³ for flanges and paint, E = 210 GPa; nacelle mass scaled from the reference (240 t ∝ scale^2.6). First bending frequency by Rayleigh\'s method on a cantilever with the tower-top mass, rigid foundation; validation: NREL 5-MW onshore tower mass 347.5 t and first fore-aft frequency 0.324 Hz (Jonkman et al. 2009) within 5 %.',
  'Ultimate check at the base only: rotor peak thrust × 1.35 at hub height and weights × 1.1 (IEC 61400-1 normal load factors), σ = N/A + M/W against f_y/γ_M (S355, 345 MPa for thick plate). Not checked: fatigue (often decisive for towers), the 50-year storm, shell buckling to EN 1993-1-6 (only a D/t limit), doors and welds.',
  'Base flange: bolts on one circle, F = 4M/(n D_b) − N/n per bolt against F_t,Rd = 0.9 f_ub A_s/γ_M2 (EN 1993-1-8, grade 10.9); prying in the L-flange and preload are not modelled and raise the real bolt force.',
];
export const FOUND_INTRO = 'A gravity foundation holds the turbine up by its own weight: a wide concrete slab with soil on top. The wind\'s push at hub height makes a large overturning moment at the base, so the footing must be wide and heavy enough that it never lifts off on one side and the soil under the other side does not fail.';
export const FOUND_NOTES = [
  'Characteristic loads (no load factors): rotor peak thrust at hub height, weights of rotor, nacelle and tower; the footing body from its shape (concrete 25 kN/m³) and the backfill on it (18 kN/m³). Two shapes: a flat slab with a sloped top near the surface, and a buried dome (a thicker, dome-shaped body set deeper and covered with soil, so more weight comes from the backfill). Circular footing: no gap while the eccentricity e = M/V stays inside the kern D/8; overturning FS = V (D/2)/M.',
  'Bearing capacity: general bearing capacity equation with Vesić factors, effective area for the eccentric load and inclination factors (same model as the Bearing capacity tool), global FS ≥ 3; sliding with base friction tan(2φ/3) or the undrained strength. Soils are typical values; a site investigation decides. Not checked: soil stiffness (rotational stiffness of the footing), settlement, the 50-year storm, fatigue of the anchor cage, reinforcement.',
  'Footing structure: a radial strip from the pedestal face to the rim on the most loaded side, as a cantilever pushed up by the soil pressure (linear, V/A + M x/I) less the weight of concrete and backfill on it, × 1.35. Bending K = M_Ed/(b d² f_ck) ≤ 0.167 (above it the section needs compression steel) and shear v_Ed ≤ v_Rd,c without stirrups (EC2 6.2.2, ρ_l = 0.5 %) at 24 sections, C35/45, d = thickness − 0.1 m. A thin slab or dome fails here even when it is heavy enough. Not checked: punching at the pedestal, the other side (top steel), ring moments, the anchor cage.',
];
