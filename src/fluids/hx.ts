/**
 * Heat exchangers: rating by the ε-NTU method, LMTD with correction factor F, temperature profiles and sizing.
 * Steady state, constant specific heats and overall coefficient U, no heat loss, no phase change.
 * Arrangements: counterflow and parallel-flow double pipe, shell-and-tube with one shell pass and two (or 2n) tube
 * passes, cross flow with both fluids unmixed, gasketed plate (modelled as pure counterflow).
 */
export type HxType = 'counter' | 'parallel' | 'shell' | 'cross' | 'plate';
export type Side = { m: number; cp: number; Tin: number }; // kg/s, J/(kg·K), °C
export type HxIn = { type: HxType; hot: Side; cold: Side; U: number; A: number };
export type Check = { ok: boolean; label: string; detail: string };

export const FLUIDS: { id: string; name: string; cp: number }[] = [
  { id: 'water', name: 'Water', cp: 4180 },
  { id: 'glycol', name: 'Water–glycol 50 %', cp: 3400 },
  { id: 'oil', name: 'Thermal oil', cp: 2100 },
  { id: 'air', name: 'Air', cp: 1007 },
];

/** Typical overall coefficients U [W/(m²·K)] (Incropera Table 11.2 and common practice, rounded). */
export const U_TYPICAL: { id: string; name: string; U: number }[] = [
  { id: 'ww-plate', name: 'Water–water, plate', U: 3000 },
  { id: 'ww-tube', name: 'Water–water, tubes', U: 1000 },
  { id: 'oil-water', name: 'Oil–water', U: 300 },
  { id: 'gas-water', name: 'Gas–water, finned', U: 60 },
  { id: 'air-air', name: 'Air–air', U: 20 },
];

/** Effectiveness ε(NTU, Cr) of each arrangement. */
export function effectiveness(type: HxType, NTU: number, Cr: number): number {
  if (NTU <= 0) return 0;
  switch (type) {
    case 'counter': case 'plate':
      if (Math.abs(1 - Cr) < 1e-9) return NTU / (1 + NTU);
      return (1 - Math.exp(-NTU * (1 - Cr))) / (1 - Cr * Math.exp(-NTU * (1 - Cr)));
    case 'parallel':
      return (1 - Math.exp(-NTU * (1 + Cr))) / (1 + Cr);
    case 'shell': { // one shell pass, 2, 4 … tube passes (Incropera eq. 11.31a)
      const s = Math.sqrt(1 + Cr * Cr), e = Math.exp(-NTU * s);
      return 2 / (1 + Cr + s * (1 + e) / (1 - e));
    }
    case 'cross': { // both fluids unmixed: exact series solution (Mason 1955), Σ_n [1 − e^(−N) Σ_m≤n N^m/m!][1 − e^(−CrN) Σ_m≤n (CrN)^m/m!]/(Cr N)
      if (Cr < 1e-9) return 1 - Math.exp(-NTU);
      const terms = Math.min(600, Math.ceil(40 + 4 * NTU));
      let s = 0, a = 0, b = 0, fa = 1, fb = 1;
      for (let n = 0; n < terms; n++) {
        if (n) { fa *= NTU / n; fb *= (Cr * NTU) / n; }
        a += fa; b += fb;
        s += (1 - Math.exp(-NTU) * a) * (1 - Math.exp(-Cr * NTU) * b);
      }
      return s / (Cr * NTU);
    }
  }
}

/** Highest effectiveness reachable with unlimited area (NTU → ∞). */
export const epsMax = (type: HxType, Cr: number) => (type === 'parallel' ? 1 / (1 + Cr) : effectiveness(type, 60, Cr));

/** NTU for a required effectiveness (bisection on the monotonic ε(NTU)); null if it cannot be reached. */
export function ntuFor(type: HxType, eps: number, Cr: number): number | null {
  if (eps <= 0) return 0;
  if (eps >= epsMax(type, Cr) * (1 - 1e-6)) return null;
  let lo = 0, hi = 60;
  for (let k = 0; k < 200; k++) { const mid = 0.5 * (lo + hi); if (effectiveness(type, mid, Cr) < eps) lo = mid; else hi = mid; }
  return 0.5 * (lo + hi);
}

/** Log-mean temperature difference of two end differences. */
export const lmtd = (d1: number, d2: number) => (Math.abs(d1 - d2) < 1e-9 * Math.max(1, Math.abs(d1)) ? d1 : (d1 - d2) / Math.log(d1 / d2));

/** Bowman's F for one shell pass and an even number of tube passes (cross-check of the ε-NTU result). */
export function fBowman(P: number, R: number): number {
  const s = Math.sqrt(R * R + 1);
  if (Math.abs(R - 1) < 1e-6) return (s * P) / ((1 - P) * Math.log((2 - P * (2 - s)) / (2 - P * (2 + s))));
  return (s * Math.log((1 - P) / (1 - R * P))) / ((R - 1) * Math.log((2 - P * (R + 1 - s)) / (2 - P * (R + 1 + s))));
}

export type Profile = { x: number[]; lines: { id: 'hot' | 'cold' | 'pass1' | 'pass2' | 'hotOut' | 'coldOut'; T: number[] }[]; xLabel: string };

export type HxResult = {
  Ch: number; Cc: number; Cmin: number; Cmax: number; Cr: number; NTU: number; eps: number; Qmax: number; Q: number;
  ThOut: number; TcOut: number; dTlm: number; dTlmBasis: 'counter' | 'parallel'; F: number; approach: number;
  profile: Profile; field?: { n: number; Th: number[][]; Tc: number[][] }; checks: Check[];
};

/** RK4 for a small ODE system y' = f(x, y) from x = 0 to 1 with n steps; returns the samples. */
function rk4(f: (y: number[]) => number[], y0: number[], n: number): number[][] {
  const out = [y0.slice()], h = 1 / n;
  let y = y0.slice();
  for (let i = 0; i < n; i++) {
    const k1 = f(y), k2 = f(y.map((v, j) => v + (h / 2) * k1[j])), k3 = f(y.map((v, j) => v + (h / 2) * k2[j])), k4 = f(y.map((v, j) => v + h * k3[j]));
    y = y.map((v, j) => v + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
    out.push(y.slice());
  }
  return out;
}

/** Cross flow, both unmixed, on an n × n grid: hot runs along x (rows), cold along y (columns); cell-wise ε of a tiny exchanger. */
export function crossGrid(hot: Side, cold: Side, UA: number, n = 40) {
  const ch = (hot.m * hot.cp) / n, cc = (cold.m * cold.cp) / n, ua = UA / (n * n);
  const Th = Array.from({ length: n }, () => new Array(n).fill(0)), Tc = Array.from({ length: n }, () => new Array(n).fill(0));
  const hotIn = new Array(n).fill(hot.Tin); // per row, updated as the hot stream moves in +x
  const coldIn = new Array(n).fill(cold.Tin); // per column, updated as the cold stream moves in +y
  for (let j = 0; j < n; j++) { // row (y)
    for (let i = 0; i < n; i++) { // column (x)
      const th = hotIn[j], tc = coldIn[i];
      // a cell is a tiny exchanger: q = ε_cell Cmin ΔT with ε from the parallel-flow formula (exact enough for small NTU)
      const cmin = Math.min(ch, cc), cr = cmin / Math.max(ch, cc), ntu = ua / cmin;
      const q = effectiveness('parallel', ntu, cr) * cmin * (th - tc);
      hotIn[j] = th - q / ch; coldIn[i] = tc + q / cc;
      Th[j][i] = hotIn[j]; Tc[j][i] = coldIn[i];
    }
  }
  const ThOut = hotIn.reduce((a, b) => a + b, 0) / n, TcOut = coldIn.reduce((a, b) => a + b, 0) / n;
  return { Th, Tc, ThOut, TcOut, hotOut: hotIn, coldOut: coldIn };
}

export function rateHx(p: HxIn): HxResult {
  const Ch = p.hot.m * p.hot.cp, Cc = p.cold.m * p.cold.cp;
  const Cmin = Math.min(Ch, Cc), Cmax = Math.max(Ch, Cc), Cr = Cmin / Cmax;
  const UA = p.U * p.A, NTU = UA / Cmin;
  const dTin = p.hot.Tin - p.cold.Tin, Qmax = Cmin * dTin;
  let eps = effectiveness(p.type, NTU, Cr);
  let field: HxResult['field'];
  let profile: Profile;
  const N = 100, xs = Array.from({ length: N + 1 }, (_, i) => i / N);
  if (p.type === 'cross') {
    const g = crossGrid(p.hot, p.cold, UA, 40);
    field = { n: 40, Th: g.Th, Tc: g.Tc };
    profile = { x: g.hotOut.map((_, i) => (i + 0.5) / 40), lines: [{ id: 'hotOut', T: g.hotOut }, { id: 'coldOut', T: g.coldOut }], xLabel: 'position across the face' };
  } else profile = { x: xs, lines: [], xLabel: 'position along the exchanger' };
  const Q = eps * Qmax;
  const ThOut = p.hot.Tin - Q / Ch, TcOut = p.cold.Tin + Q / Cc;
  const k = UA; // profiles in x ∈ [0, 1], hot enters at x = 0
  if (p.type === 'counter' || p.type === 'plate') {
    const s = rk4(([th, tc]) => [-(k / Ch) * (th - tc), -(k / Cc) * (th - tc)], [p.hot.Tin, TcOut], N);
    profile.lines = [{ id: 'hot', T: s.map((v) => v[0]) }, { id: 'cold', T: s.map((v) => v[1]) }];
  } else if (p.type === 'parallel') {
    const s = rk4(([th, tc]) => [-(k / Ch) * (th - tc), (k / Cc) * (th - tc)], [p.hot.Tin, p.cold.Tin], N);
    profile.lines = [{ id: 'hot', T: s.map((v) => v[0]) }, { id: 'cold', T: s.map((v) => v[1]) }];
  } else if (p.type === 'shell') {
    // hot in the shell (x: 0 → 1), cold in the tubes: pass 1 with the shell flow, pass 2 back against it
    const f = ([ts, t1, t2]: number[]) => [-(k / 2 / Ch) * ((ts - t1) + (ts - t2)), (k / 2 / Cc) * (ts - t1), -(k / 2 / Cc) * (ts - t2)];
    const end = (g: number) => { const s = rk4(f, [p.hot.Tin, p.cold.Tin, g], N); const l = s[N]; return { s, miss: l[2] - l[1] }; };
    const a = end(p.cold.Tin), b = end(p.hot.Tin);
    const g = a.miss === b.miss ? p.cold.Tin : p.cold.Tin + ((p.hot.Tin - p.cold.Tin) * -a.miss) / (b.miss - a.miss); // linear in the guess
    const s = end(g).s;
    profile.lines = [{ id: 'hot', T: s.map((v) => v[0]) }, { id: 'pass1', T: s.map((v) => v[1]) }, { id: 'pass2', T: s.map((v) => v[2]) }];
  }
  // LMTD on the counterflow basis (parallel flow on its own basis) and F = Q/(UA ΔT_lm)
  const basis: 'counter' | 'parallel' = p.type === 'parallel' ? 'parallel' : 'counter';
  const dTlm = basis === 'parallel' ? lmtd(p.hot.Tin - p.cold.Tin, ThOut - TcOut) : lmtd(p.hot.Tin - TcOut, ThOut - p.cold.Tin);
  const F = p.type === 'shell' || p.type === 'cross' ? Q / (UA * dTlm) : 1;
  const approach = basis === 'parallel' ? ThOut - TcOut : Math.min(p.hot.Tin - TcOut, ThOut - p.cold.Tin);
  eps = Q / Qmax;
  const r: HxResult = { Ch, Cc, Cmin, Cmax, Cr, NTU, eps, Qmax, Q, ThOut, TcOut, dTlm, dTlmBasis: basis, F, approach, profile, field, checks: [] };
  r.checks = hxChecks(p, r);
  return r;
}

function hxChecks(p: HxIn, r: HxResult): Check[] {
  const f1 = (v: number) => v.toFixed(1);
  const out: Check[] = [
    { ok: r.approach >= 5, label: 'Approach temperature ≥ 5 K', detail: `smallest end difference ${f1(r.approach)} K` },
    { ok: r.NTU <= 4, label: 'Area is used well (NTU ≤ 4)', detail: r.NTU <= 4 ? `NTU ${r.NTU.toFixed(2)}` : `NTU ${r.NTU.toFixed(2)}: more area adds little heat (ε ${(r.eps * 100).toFixed(0)} %)` },
  ];
  if (p.type === 'shell') out.push({ ok: r.F >= 0.75, label: 'Correction factor F ≥ 0.75', detail: r.F >= 0.75 ? `F = ${r.F.toFixed(2)}` : `F = ${r.F.toFixed(2)}: temperature cross, use two shells in series` });
  const water = (s: Side) => s.cp === 4180;
  const hotT = Math.max(p.hot.Tin, r.ThOut), coldT = Math.max(p.cold.Tin, r.TcOut);
  if (water(p.hot) || water(p.cold)) {
    const tmax = Math.max(water(p.hot) ? hotT : -273, water(p.cold) ? coldT : -273);
    out.push({ ok: tmax <= 100, label: 'Water stays liquid at 1 atm (≤ 100 °C)', detail: tmax <= 100 ? `highest water temperature ${f1(tmax)} °C` : `${f1(tmax)} °C: needs a pressurised circuit` });
  }
  return out;
}

/** Sizing: area (and double-pipe length) for a required hot outlet temperature. */
export function sizeHx(type: HxType, hot: Side, cold: Side, U: number, ThOut: number, D: number) {
  const Ch = hot.m * hot.cp, Cc = cold.m * cold.cp, Cmin = Math.min(Ch, Cc), Cr = Cmin / Math.max(Ch, Cc);
  const Q = Ch * (hot.Tin - ThOut), eps = Q / (Cmin * (hot.Tin - cold.Tin));
  const NTU = ntuFor(type, eps, Cr);
  const A = NTU === null ? null : (NTU * Cmin) / U;
  return { Q, eps, NTU, A, L: A === null ? null : A / (Math.PI * D), TcOut: cold.Tin + Q / Cc, epsMax: epsMax(type, Cr) };
}

/** Temperature → colour from blue (cold inlet) to red (hot inlet). */
export function tempColor(T: number, Tc: number, Th: number): string {
  const f = Math.min(1, Math.max(0, (T - Tc) / Math.max(1e-9, Th - Tc)));
  const c0 = [47, 111, 224], c1 = [224, 64, 40];
  const mid = [234, 214, 120];
  const lerp = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const c = f < 0.5 ? lerp(c0, mid, f * 2) : lerp(mid, c1, (f - 0.5) * 2);
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

export const HX_INTRO: Record<HxType, string> = {
  counter: 'Double pipe, counterflow: the fluids run in opposite directions, so the cold fluid can leave hotter than the hot fluid leaves. The most effective arrangement for a given area.',
  parallel: 'Double pipe, parallel flow: both fluids enter at the same end. The temperatures approach each other quickly and the cold outlet can never exceed the hot outlet.',
  shell: 'Shell and tube, one shell pass and two tube passes: the hot fluid flows around baffles in the shell, the cold fluid goes through the tube bundle and back. The workhorse of process plants.',
  cross: 'Cross flow, both fluids unmixed: the fluids cross at right angles through finned channels, like a car radiator or an air-to-air recuperator. Each outlet is warmer on one side than the other.',
  plate: 'Gasketed plate exchanger: thin corrugated plates with the fluids in alternate gaps, close to pure counterflow with a high U in a small volume.',
};

export const HX_NOTES = [
  'ε-NTU method: C = ṁ·c_p for each fluid, NTU = U·A/C_min, C_r = C_min/C_max; the effectiveness ε(NTU, C_r) of each arrangement gives Q = ε·C_min·(T_h,in − T_c,in) and the outlets. Formulas: counterflow and parallel flow exact; one shell pass with 2, 4 … tube passes Incropera eq. 11.31; cross flow with both fluids unmixed the exact series solution (Mason; the common approximation, Incropera eq. 11.32, differs by up to about 3 %); the plate exchanger is treated as pure counterflow.',
  'LMTD: Q = U·A·F·ΔT_lm with ΔT_lm on the counterflow basis (parallel flow on its own basis); F follows from the ε-NTU result and agrees with Bowman’s formula for the shell-and-tube case. Profiles: counterflow and parallel flow by integrating the two energy balances, the two-pass shell-and-tube by shooting on the return pass, cross flow on a 40 × 40 grid of small cells.',
  'Assumed: steady state, constant c_p and U along the exchanger (U from the typical values or your own), no heat loss to the surroundings, no phase change, no fouling margin and no pressure-drop calculation. Validation: the sizing reproduces Incropera Example 11.1 (oil cooled by water in a counterflow double pipe).',
];
