/**
 * Euler–Bernoulli beam of constant EI on four support cases, loaded by point loads, distributed loads and moments.
 * Cubic Hermite finite elements for deflection and the support reactions; shear force and bending moment by exact statics from the reactions.
 * SI units throughout: m, N, N/m, N·m, Pa, m⁴. Loads act downward; applied moments are clockwise; sagging moment is positive.
 */

export type Support = 'simple' | 'cantilever' | 'fixed' | 'propped';
export type Load =
  | { kind: 'point'; a: number; P: number } // N downward at x = a
  | { kind: 'udl'; a: number; b: number; w: number } // N/m downward from a to b
  | { kind: 'moment'; a: number; M: number }; // N·m clockwise at x = a

export type BeamIn = { L: number; support: Support; loads: Load[]; EI: number; wSelf?: number; n?: number };

const EPS = 1e-9;

/** Support reactions (upward positive) at positions x with the wall moment (counter-clockwise on the beam) when fixed. */
export type Reaction = { x: number; R: number; Mw: number };

export function solveBeam(p: BeamIn) {
  const { L, EI } = p;
  const loads: Load[] = [...p.loads.filter((l) => (l.kind === 'udl' ? l.w !== 0 && l.b > l.a : l.kind === 'point' ? l.P !== 0 : l.M !== 0))];
  if (p.wSelf) loads.push({ kind: 'udl', a: 0, b: L, w: p.wSelf });
  // nodes: uniform grid plus every load position, so loads always sit on a node
  const base = p.n ?? 120;
  const xs = Array.from({ length: base + 1 }, (_, i) => (L * i) / base);
  for (const l of loads) { xs.push(l.a); if (l.kind === 'udl') xs.push(l.b); }
  xs.sort((a, b) => a - b);
  const x: number[] = [];
  for (const v of xs) if (!x.length || v - x[x.length - 1] > EPS * L) x.push(Math.min(Math.max(v, 0), L));
  const nn = x.length, nd = 2 * nn;
  const idx = (pos: number) => { let b = 0; for (let i = 0; i < nn; i++) if (Math.abs(x[i] - pos) < Math.abs(x[b] - pos)) b = i; return b; };
  const K = Array.from({ length: nd }, () => new Float64Array(nd));
  const F = new Float64Array(nd);
  for (let e = 0; e < nn - 1; e++) {
    const l = x[e + 1] - x[e], c = EI / (l * l * l), o = 2 * e;
    const k = [
      [12, 6 * l, -12, 6 * l], [6 * l, 4 * l * l, -6 * l, 2 * l * l], [-12, -6 * l, 12, -6 * l], [6 * l, 2 * l * l, -6 * l, 4 * l * l],
    ];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) K[o + i][o + j] += c * k[i][j];
  }
  for (const ld of loads) {
    if (ld.kind === 'point') F[2 * idx(ld.a)] -= ld.P;
    else if (ld.kind === 'moment') F[2 * idx(ld.a) + 1] -= ld.M;
    else {
      for (let e = 0; e < nn - 1; e++) {
        if (x[e] >= ld.a - EPS * L && x[e + 1] <= ld.b + EPS * L) {
          const l = x[e + 1] - x[e], o = 2 * e;
          F[o] -= (ld.w * l) / 2; F[o + 1] -= (ld.w * l * l) / 12; F[o + 2] -= (ld.w * l) / 2; F[o + 3] += (ld.w * l * l) / 12;
        }
      }
    }
  }
  const last = nn - 1;
  const fixed: number[] = p.support === 'simple' ? [0, 2 * last]
    : p.support === 'cantilever' ? [0, 1]
    : p.support === 'fixed' ? [0, 1, 2 * last, 2 * last + 1]
    : [0, 1, 2 * last];
  const K0 = K.map((r) => Float64Array.from(r)), F0 = Float64Array.from(F);
  for (const d of fixed) { for (let j = 0; j < nd; j++) { K[d][j] = 0; K[j][d] = 0; } K[d][d] = 1; F[d] = 0; }
  // banded Gaussian elimination (half-bandwidth 3, no pivoting: the matrix is positive definite)
  const bw = 3;
  for (let k = 0; k < nd; k++) {
    const hi = Math.min(nd - 1, k + bw);
    for (let i = k + 1; i <= hi; i++) {
      const f = K[i][k] / K[k][k];
      if (f === 0) continue;
      for (let j = k; j <= hi; j++) K[i][j] -= f * K[k][j];
      F[i] -= f * F[k];
    }
  }
  const u = new Float64Array(nd);
  for (let i = nd - 1; i >= 0; i--) {
    let s = F[i];
    for (let j = i + 1; j <= Math.min(nd - 1, i + bw); j++) s -= K[i][j] * u[j];
    u[i] = s / K[i][i];
  }
  const v = x.map((_, i) => u[2 * i]), th = x.map((_, i) => u[2 * i + 1]);
  // reactions r = K u − F at the constrained dofs
  const reactions: Reaction[] = [];
  const resid = (d: number) => { let s = -F0[d]; for (let j = 0; j < nd; j++) s += K0[d][j] * u[j]; return s; };
  for (const node of [0, last]) {
    const dv = 2 * node, dt = 2 * node + 1;
    const hasV = fixed.includes(dv), hasT = fixed.includes(dt);
    if (hasV || hasT) reactions.push({ x: x[node], R: hasV ? resid(dv) : 0, Mw: hasT ? resid(dt) : 0 });
  }

  const eps = EPS * L;
  /** Shear force and bending moment at x, from the part of the beam on the left side ('left' = just before x, 'right' = just after). */
  const section = (xc: number, side: 'left' | 'right') => {
    const before = (pos: number) => (side === 'left' ? pos < xc - eps : pos <= xc + eps);
    let V = 0, M = 0;
    for (const r of reactions) if (before(r.x)) { V += r.R; M += r.R * (xc - r.x) - r.Mw; }
    for (const ld of loads) {
      if (ld.kind === 'point' && before(ld.a)) { V -= ld.P; M -= ld.P * (xc - ld.a); }
      else if (ld.kind === 'moment' && before(ld.a)) M += ld.M;
      else if (ld.kind === 'udl' && xc > ld.a) {
        const e = Math.min(xc, ld.b), len = e - ld.a;
        V -= ld.w * len; M -= ld.w * len * (xc - ld.a - len / 2);
      }
    }
    return { V, M };
  };
  // plot points: two values at every node so jumps in V (point loads) and M (moments) draw as steps
  const xp: number[] = [], Vp: number[] = [], Mp: number[] = [];
  x.forEach((xc, i) => {
    const a = section(xc, 'left'), b = section(xc, 'right');
    if (i === 0) { xp.push(xc); Vp.push(b.V); Mp.push(b.M); return; }
    xp.push(xc); Vp.push(a.V); Mp.push(a.M);
    if (Math.abs(a.V - b.V) > 1e-9 * (1 + Math.abs(a.V)) || Math.abs(a.M - b.M) > 1e-9 * (1 + Math.abs(a.M))) { xp.push(xc); Vp.push(b.V); Mp.push(b.M); }
  });
  const argmax = (a: number[], f: (t: number) => number) => a.reduce((b, t, i) => (f(t) > f(a[b]) ? i : b), 0);
  const iV = argmax(Vp, Math.abs), iM = argmax(Mp, Math.abs), iS = argmax(Mp, (t) => t), iH = argmax(Mp, (t) => -t), iD = argmax(v, Math.abs);
  return {
    x, v, th, reactions, xp, Vp, Mp,
    Vmax: Math.abs(Vp[iV]), xV: xp[iV],
    Mmax: Math.abs(Mp[iM]), xM: xp[iM],
    Msag: Math.max(0, Mp[iS]), xSag: xp[iS], Mhog: Math.max(0, -Mp[iH]), xHog: xp[iH],
    vmax: Math.abs(v[iD]), xv: x[iD],
    section,
  };
}
export type BeamResult = ReturnType<typeof solveBeam>;

/* ---------- sections ---------- */

/** Standard IPE: h, b, tw, tf [mm], A [cm²], I_y [cm⁴] (from the section tables). */
export const IPE: { name: string; h: number; b: number; tw: number; tf: number; A: number; I: number }[] = [
  { name: 'IPE 80', h: 80, b: 46, tw: 3.8, tf: 5.2, A: 7.64, I: 80.1 },
  { name: 'IPE 100', h: 100, b: 55, tw: 4.1, tf: 5.7, A: 10.3, I: 171 },
  { name: 'IPE 120', h: 120, b: 64, tw: 4.4, tf: 6.3, A: 13.2, I: 318 },
  { name: 'IPE 140', h: 140, b: 73, tw: 4.7, tf: 6.9, A: 16.4, I: 541 },
  { name: 'IPE 160', h: 160, b: 82, tw: 5.0, tf: 7.4, A: 20.1, I: 869 },
  { name: 'IPE 180', h: 180, b: 91, tw: 5.3, tf: 8.0, A: 23.9, I: 1317 },
  { name: 'IPE 200', h: 200, b: 100, tw: 5.6, tf: 8.5, A: 28.5, I: 1943 },
  { name: 'IPE 220', h: 220, b: 110, tw: 5.9, tf: 9.2, A: 33.4, I: 2772 },
  { name: 'IPE 240', h: 240, b: 120, tw: 6.2, tf: 9.8, A: 39.1, I: 3892 },
  { name: 'IPE 270', h: 270, b: 135, tw: 6.6, tf: 10.2, A: 45.9, I: 5790 },
  { name: 'IPE 300', h: 300, b: 150, tw: 7.1, tf: 10.7, A: 53.8, I: 8356 },
  { name: 'IPE 330', h: 330, b: 160, tw: 7.5, tf: 11.5, A: 62.6, I: 11770 },
  { name: 'IPE 360', h: 360, b: 170, tw: 8.0, tf: 12.7, A: 72.7, I: 16270 },
  { name: 'IPE 400', h: 400, b: 180, tw: 8.6, tf: 13.5, A: 84.5, I: 23130 },
  { name: 'IPE 450', h: 450, b: 190, tw: 9.4, tf: 14.6, A: 98.8, I: 33740 },
  { name: 'IPE 500', h: 500, b: 200, tw: 10.2, tf: 16.0, A: 116, I: 48200 },
  { name: 'IPE 550', h: 550, b: 210, tw: 11.1, tf: 17.2, A: 134, I: 67120 },
  { name: 'IPE 600', h: 600, b: 220, tw: 12.0, tf: 19.0, A: 156, I: 92080 },
];

export type Sect =
  | { kind: 'rect'; b: number; h: number } // mm
  | { kind: 'circle'; d: number }
  | { kind: 'tube'; D: number; t: number }
  | { kind: 'ipe'; name: string };

/** Section properties in SI: A [m²], I [m⁴], c = distance to the extreme fibre [m], W = I/c [m³], depth h and width b [m], outline in mm (y up, z across). */
export function sectionProps(s: Sect) {
  const mm = 1e-3;
  if (s.kind === 'rect') {
    const A = s.b * s.h, I = (s.b * s.h ** 3) / 12;
    return { A: A * mm * mm, I: I * mm ** 4, c: (s.h / 2) * mm, h: s.h * mm, b: s.b * mm, tauK: 1.5, outline: [[-s.h / 2, -s.b / 2], [-s.h / 2, s.b / 2], [s.h / 2, s.b / 2], [s.h / 2, -s.b / 2]] as [number, number][], hole: null as [number, number][] | null };
  }
  if (s.kind === 'circle') {
    const A = (Math.PI / 4) * s.d * s.d, I = (Math.PI / 64) * s.d ** 4;
    return { A: A * mm * mm, I: I * mm ** 4, c: (s.d / 2) * mm, h: s.d * mm, b: s.d * mm, tauK: 4 / 3, outline: circlePts(s.d / 2), hole: null as [number, number][] | null };
  }
  if (s.kind === 'tube') {
    const d = s.D - 2 * s.t, R = s.D / 2, r = d / 2;
    const A = (Math.PI / 4) * (s.D * s.D - d * d), I = (Math.PI / 64) * (s.D ** 4 - d ** 4);
    return { A: A * mm * mm, I: I * mm ** 4, c: R * mm, h: s.D * mm, b: s.D * mm, tauK: ((4 / 3) * (R * R + R * r + r * r)) / (R * R + r * r), outline: circlePts(R), hole: circlePts(r) };
  }
  const e = IPE.find((x) => x.name === s.name) ?? IPE[0];
  const { h, b, tw, tf } = e;
  const outline: [number, number][] = [
    [-h / 2, -b / 2], [-h / 2, b / 2], [-h / 2 + tf, b / 2], [-h / 2 + tf, tw / 2], [h / 2 - tf, tw / 2], [h / 2 - tf, b / 2],
    [h / 2, b / 2], [h / 2, -b / 2], [h / 2 - tf, -b / 2], [h / 2 - tf, -tw / 2], [-h / 2 + tf, -tw / 2], [-h / 2 + tf, -b / 2],
  ];
  const A = e.A * 1e2, I = e.I * 1e4; // mm², mm⁴
  const Q = (b * tf * (h - tf)) / 2 + (tw * (h / 2 - tf) ** 2) / 2; // first moment of half the section about the neutral axis [mm³]
  return { A: A * mm * mm, I: I * mm ** 4, c: (h / 2) * mm, h: h * mm, b: b * mm, tauK: (Q * A) / (I * tw), outline, hole: null as [number, number][] | null };
}
function circlePts(r: number, n = 32): [number, number][] {
  return Array.from({ length: n }, (_, i) => [r * Math.sin((2 * Math.PI * i) / n), r * Math.cos((2 * Math.PI * i) / n)] as [number, number]);
}

/** Maximum shear stress [Pa] at shear force V [N]: τ = k V/A with k from the section (rectangle 1.5, circle 4/3, tube, I-section from V Q/(I t_w)). */
export const shearStress = (s: Sect, V: number) => { const q = sectionProps(s); return (q.tauK * Math.abs(V)) / q.A; };

/* ---------- materials ---------- */

export type Material = { id: string; name: string; E: number; rho: number; f: number; tau: number; note?: string }; // Pa, kg/m³, bending strength [Pa], shear strength [Pa]
export const MATERIALS: Material[] = [
  { id: 's235', name: 'Steel S235', E: 210e9, rho: 7850, f: 235e6, tau: 0.577 * 235e6 },
  { id: 's355', name: 'Steel S355', E: 210e9, rho: 7850, f: 355e6, tau: 0.577 * 355e6 },
  { id: 'al', name: 'Aluminium 6061-T6', E: 69e9, rho: 2700, f: 240e6, tau: 0.577 * 240e6 },
  { id: 'c24', name: 'Timber C24', E: 11e9, rho: 420, f: 24e6, tau: 4e6 },
  { id: 'conc', name: 'Concrete C30/37 (plain)', E: 33e9, rho: 2400, f: 3e6, tau: 0.6e6 },
];

export const G = 9.80665;

/* ---------- complete analysis ---------- */

export type AnalysisIn = { L: number; support: Support; loads: Load[]; sect: Sect; mat: Material; selfWeight: boolean; n: number; defl: number };

export function analyseBeam(a: AnalysisIn) {
  const q = sectionProps(a.sect);
  const wSelf = a.selfWeight ? a.mat.rho * G * q.A : 0;
  const r = solveBeam({ L: a.L, support: a.support, loads: a.loads, EI: a.mat.E * q.I, wSelf });
  const sigma = (r.Mmax * q.c) / q.I;
  const tau = shearStress(a.sect, r.Vmax);
  const Leff = a.support === 'cantilever' ? 2 * a.L : a.L;
  const dLim = Leff / a.defl;
  const checks = [
    { ok: sigma <= a.mat.f / a.n, label: 'Bending stress σ ≤ f/n (strength with safety factor)', detail: `${(sigma / 1e6).toFixed(1)} MPa vs ${(a.mat.f / a.n / 1e6).toFixed(1)} MPa` },
    { ok: tau <= a.mat.tau / a.n, label: 'Shear stress τ ≤ τ_allow/n', detail: `${(tau / 1e6).toFixed(2)} MPa vs ${(a.mat.tau / a.n / 1e6).toFixed(2)} MPa` },
    { ok: r.vmax <= dLim, label: a.support === 'cantilever' ? 'Deflection ≤ 2L/n_d (cantilever: twice the length)' : 'Deflection ≤ L/n_d', detail: `${(r.vmax * 1000).toFixed(2)} mm vs ${(dLim * 1000).toFixed(2)} mm` },
  ];
  return { ...r, q, wSelf, sigma, tau, dLim, checks, utilisation: sigma / (a.mat.f / a.n) };
}
export type Analysis = ReturnType<typeof analyseBeam>;

export const BEAM_INTRO = 'A beam carries load by bending. The bending moment makes the top and bottom fibres pull and push, the shear force slides neighbouring slices past each other, and the beam sags. Orange = highest bending stress at the outer fibres; the sag is drawn exaggerated.';

export const BEAM_NOTES = [
  'Euler–Bernoulli beam theory: plane sections stay plane, small deflections, constant EI, linear elastic. Deflection and the support reactions come from cubic Hermite finite elements (exact at the nodes for point and uniform loads); shear force and bending moment follow from exact statics. Reactions, V, M and δ of the standard cases are checked against the beam tables of Gere & Goodno.',
  'Strength: σ = M_max c/I against f/n, τ = k V_max/A (k = 1.5 rectangle, 4/3 circle, V Q/(I t_w) for the I-section) against the shear strength/n. Material values are typical (steel yield, timber C24 characteristic bending strength, plain concrete flexural tension): not design values of a standard; the safety factor n is yours to choose.',
  'Serviceability: deflection limit L/n_d (L/250 is a common general value; cantilevers use twice their length). Section properties of IPE profiles are from the section tables.',
  'Not modelled: shear deformation (Timoshenko), lateral-torsional and local buckling, web crippling, bearing, connections, second-order effects, creep (timber, concrete), reinforcement (concrete is plain: unreinforced concrete is weak in tension), dynamic loads.',
];
