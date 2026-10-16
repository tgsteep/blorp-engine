/**
 * Binary distillation by McCabe–Thiele: ideal vapour–liquid equilibrium (Raoult's law with Antoine vapour pressures) at
 * the column pressure, constant molar overflow, total condenser, partial reboiler as the last stage. Operating lines
 * from the reflux ratio and the feed condition q, stages stepped off from the top, optimal feed stage; minimum reflux
 * at the q-line pinch, minimum stages at total reflux (stepping and Fenske). Units: kPa, °C, kmol/h, kW.
 */

/** Antoine constants, log10(p/mmHg) = A − B/(C + t/°C), with the range they were fitted in. */
export const COMPONENTS = {
  'n-pentane': { A: 6.87632, B: 1075.78, C: 233.205, M: 72.15 },
  'n-hexane': { A: 6.87601, B: 1171.17, C: 224.41, M: 86.18 },
  'n-heptane': { A: 6.89677, B: 1264.9, C: 216.54, M: 100.2 },
  benzene: { A: 6.90565, B: 1211.033, C: 220.79, M: 78.11 },
  toluene: { A: 6.95464, B: 1344.8, C: 219.482, M: 92.14 },
  'p-xylene': { A: 6.99052, B: 1453.43, C: 215.307, M: 106.17 },
  methanol: { A: 8.08097, B: 1582.271, C: 239.726, M: 32.04 },
  ethanol: { A: 8.1122, B: 1592.864, C: 226.184, M: 46.07 },
} as const;
export type CompId = keyof typeof COMPONENTS;
export const PAIRS: { id: string; name: string; light: CompId; heavy: CompId }[] = [
  { id: 'bt', name: 'Benzene – toluene', light: 'benzene', heavy: 'toluene' },
  { id: 'hh', name: 'n-Hexane – n-heptane', light: 'n-hexane', heavy: 'n-heptane' },
  { id: 'ph', name: 'n-Pentane – n-hexane', light: 'n-pentane', heavy: 'n-hexane' },
  { id: 'tx', name: 'Toluene – p-xylene', light: 'toluene', heavy: 'p-xylene' },
  { id: 'me', name: 'Methanol – ethanol', light: 'methanol', heavy: 'ethanol' },
];

export const psat = (c: CompId, t: number) => { const k = COMPONENTS[c]; return (Math.pow(10, k.A - k.B / (k.C + t)) * 101.325) / 760; }; // kPa
/** Latent heat from the slope of the vapour-pressure curve (Clausius–Clapeyron), J/mol. */
export const latent = (c: CompId, t: number) => { const k = COMPONENTS[c], T = t + 273.15; return 8.314462618 * T * T * Math.LN10 * (k.B / (k.C + t) ** 2); };

function bisect(f: (t: number) => number, lo = -100, hi = 400) {
  let flo = f(lo);
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2, fm = f(m); if (Math.sign(fm) === Math.sign(flo)) { lo = m; flo = fm; } else hi = m; }
  return (lo + hi) / 2;
}
/** Bubble point at liquid fraction x: temperature and vapour fraction y. */
export function bubble(L: CompId, H: CompId, P: number, x: number) {
  const t = bisect((t) => x * psat(L, t) + (1 - x) * psat(H, t) - P);
  return { t, y: (x * psat(L, t)) / P };
}
/** Dew point at vapour fraction y: temperature and liquid fraction x. */
export function dew(L: CompId, H: CompId, P: number, y: number) {
  const t = bisect((t) => 1 - P * (y / psat(L, t) + (1 - y) / psat(H, t)));
  return { t, x: (y * P) / psat(L, t) };
}

export type DistIn = {
  pair: string; P: number;    // column pressure [kPa abs]
  F: number; xF: number; q: number; // feed [kmol/h], light fraction, feed condition (1 saturated liquid, 0 saturated vapour)
  xD: number; xB: number;     // distillate and bottoms light fractions
  Rf: number;                 // reflux ratio as a multiple of the minimum
  E: number;                  // overall tray efficiency
  spacing: number;            // tray spacing [m]
};

/** q-line ∩ equilibrium curve (the pinch for minimum reflux of an ideal mixture). */
function pinch(eq: (x: number) => number, xF: number, q: number) {
  if (Math.abs(q - 1) < 1e-9) return { x: xF, y: eq(xF) };
  const g = (x: number) => eq(x) - (q / (q - 1)) * x + xF / (q - 1);
  let lo = 1e-9, hi = 1 - 1e-9;
  if (Math.sign(g(lo)) === Math.sign(g(hi))) return { x: xF, y: eq(xF) };
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (Math.sign(g(m)) === Math.sign(g(lo))) lo = m; else hi = m; }
  const x = (lo + hi) / 2; return { x, y: eq(x) };
}

/** Steps from the top: horizontal to equilibrium, vertical to the operating line; fractional last step. */
export function stepOff(xD: number, xB: number, eqX: (y: number) => number, op: (x: number) => number, xSwitch: number, maxN = 200) {
  const steps: { x0: number; y: number; x: number }[] = [];
  let y = xD, x0 = xD, feed = 0, n = 0;
  while (n < maxN) {
    const x = eqX(y); n++;
    steps.push({ x0, y, x });
    if (!feed && x < xSwitch) feed = n;
    if (x <= xB) return { steps, N: n - 1 + (x0 - xB) / (x0 - x), feed: feed || n, ok: true };
    if (n > 1 && x >= x0 - 1e-9) break; // pinched: no progress
    const yn = op(x);
    if (yn < x - 1e-12) break; // operating line below the diagonal
    x0 = x; y = yn;
  }
  return { steps, N: Infinity, feed, ok: false };
}

export function distill(p: DistIn) {
  const pr = PAIRS.find((x) => x.id === p.pair) ?? PAIRS[0], L = pr.light, H = pr.heavy;
  const eq = (x: number) => bubble(L, H, p.P, x).y, eqX = (y: number) => dew(L, H, p.P, y).x;
  const top = bubble(L, H, p.P, p.xD), bot = bubble(L, H, p.P, p.xB), feedBub = bubble(L, H, p.P, p.xF);
  const alpha = (t: number) => psat(L, t) / psat(H, t), aTop = alpha(top.t), aBot = alpha(bot.t), aAv = Math.sqrt(aTop * aBot);
  const D = (p.F * (p.xF - p.xB)) / (p.xD - p.xB), B = p.F - D;
  const pn = pinch(eq, p.xF, p.q), Rmin = Math.max((p.xD - pn.y) / (pn.y - pn.x), 0), R = p.Rf * Rmin;
  // operating lines: rectifying y = R/(R+1) x + xD/(R+1); intersection with the q-line; stripping through (xB, xB)
  const rect = (x: number) => (R / (R + 1)) * x + p.xD / (R + 1);
  const xi = Math.abs(p.q - 1) < 1e-9 ? p.xF : (p.xF / (p.q - 1) + p.xD / (R + 1)) / (p.q / (p.q - 1) - R / (R + 1)), yi = rect(xi);
  const strip = (x: number) => p.xB + ((yi - p.xB) / (xi - p.xB)) * (x - p.xB);
  const op = (x: number) => (x >= xi ? rect(x) : strip(x));
  const st = stepOff(p.xD, p.xB, eqX, op, xi);
  const total = stepOff(p.xD, p.xB, eqX, (x) => x, -1);
  const fenske = Math.log((p.xD / (1 - p.xD)) * ((1 - p.xB) / p.xB)) / Math.log(aAv);
  // flows and duties (constant molar overflow), latent heats at the condenser and reboiler temperatures
  const V = (R + 1) * D, Lr = R * D, Vs = V - (1 - p.q) * p.F, Ls = Lr + p.q * p.F;
  const lamTop = p.xD * latent(L, top.t) + (1 - p.xD) * latent(H, top.t), lamBot = p.xB * latent(L, bot.t) + (1 - p.xB) * latent(H, bot.t);
  const Qc = (V * 1000 * lamTop) / 3600 / 1000, Qr = (Vs * 1000 * lamBot) / 3600 / 1000; // kW
  const trays = st.ok ? Math.max(st.N - 1, 0) : Infinity, real = Math.ceil(trays / p.E - 1e-9), height = (real + 3) * p.spacing; // + top, bottom and feed space
  // indicative diameter at the top: vapour F-factor u √ρ_v = 2 Pa^½ (rule of thumb for sieve trays)
  const Mtop = p.xD * COMPONENTS[L].M + (1 - p.xD) * COMPONENTS[H].M, rhoV = (p.P * 1000 * Mtop) / 1000 / (8.314462618 * (top.t + 273.15));
  const uV = 2 / Math.sqrt(rhoV), Dcol = Math.sqrt((4 * ((V * Mtop) / 3600 / rhoV / uV)) / Math.PI);
  const feedReal = st.ok ? Math.max(1, Math.round((st.feed - 0.5) / p.E)) : NaN;
  const profile = st.steps.map((s, i) => ({ n: i + 1, x: s.x, y: s.y, t: bubble(L, H, p.P, s.x).t }));
  const checks = [
    { ok: aAv >= 1.1, label: 'Relative volatility ≥ 1.1 (distillation practical)', detail: `α = ${aTop.toFixed(2)} at the top, ${aBot.toFixed(2)} at the bottom` },
    { ok: p.Rf >= 1.1 && p.Rf <= 2, label: 'Reflux ratio 1.1…2 × minimum (usual economic range)', detail: `R = ${R.toFixed(2)} = ${p.Rf.toFixed(2)} × R_min ${Rmin.toFixed(2)}` },
    { ok: st.ok && st.N <= 80, label: 'Number of theoretical stages ≤ 80', detail: st.ok ? `N = ${st.N.toFixed(1)} (incl. reboiler)` : 'the operating line touches the equilibrium curve: infinite stages' },
    { ok: bot.t <= 250 && top.t >= -40, label: 'Temperatures −40…250 °C (cooling water or refrigeration at the top, steam at the bottom)', detail: `top ${top.t.toFixed(1)} °C, bottom ${bot.t.toFixed(1)} °C` },
  ];
  return { pr, L, H, eq, top, bot, feedBub, aTop, aBot, aAv, D, B, pn, Rmin, R, xi, yi, rect, strip, st, total, fenske, V, Lr, Vs, Ls, Qc, Qr, trays, real, height, feedReal, profile, rhoV, uV, Dcol, checks };
}
export type DistResult = ReturnType<typeof distill>;

/** Theoretical stages against the reflux ratio (for the design chart). */
export function stagesVsReflux(p: DistIn, n = 24) {
  const out: { Rf: number; R: number; N: number }[] = [];
  for (let i = 0; i <= n; i++) { const Rf = 1.03 + (4 * i) / n; const r = distill({ ...p, Rf }); out.push({ Rf, R: r.R, N: r.st.N }); }
  return out;
}

export const DIST_INTRO = 'A distillation column separates two liquids by their boiling points: vapour rising through the trays meets liquid flowing down, and on every tray the lighter component moves into the vapour and the heavier into the liquid. The McCabe–Thiele diagram shows this as steps between the equilibrium curve and the operating lines: each step is one ideal tray. More reflux (liquid returned to the top) means fewer trays but more heat; below the minimum reflux no number of trays is enough.';
export const DIST_NOTES = [
  'Ideal mixture: Raoult\'s law with Antoine vapour pressures (log₁₀ p/mmHg = A − B/(C + t), common handbook constants), so the equilibrium curve follows the pressure; non-ideal mixtures and azeotropes (ethanol–water, methanol–water) are not covered. Validation of the equilibrium: benzene–toluene at 101.32 kPa against Geankoplis Table 11.1-1 data within 0.012 mole fraction.',
  'McCabe–Thiele with constant molar overflow, total condenser (distillate = reflux composition) and a partial reboiler counted as the last stage; theoretical trays = stages − 1. Stages stepped off from the top with the optimal feed stage (switching lines at the q-line); the last step is counted as a fraction. Minimum reflux at the q-line pinch (valid for normal, ideal curves); minimum stages at total reflux by stepping and by Fenske with α = √(α_top α_bottom).',
  'Real trays = theoretical trays / overall efficiency (O\'Connell-type values 0.5…0.8); height = (trays + 3) × tray spacing. Duties from the vapour flow and the latent heat (Clausius–Clapeyron from the Antoine slope, ideal vapour: about 4 % high); the diameter is indicative only (vapour F-factor 2 Pa^½ at the top); feed enthalpy, heat losses, flooding, pressure drop and the tray hydraulics are not included.',
];
