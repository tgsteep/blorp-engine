/**
 * Surface roughness: a synthetic measured profile for turning, face milling or grinding, filtered as a stylus
 * instrument does (ISO 16610-21 Gaussian filter at the cut-off λc chosen by ISO 4288), and the ISO 4287 / ISO 21920-2
 * parameters Ra, Rq, Rz, Rt, Rsk, Rku, RSm and the material ratio curve. Turning and face milling: cusps of the
 * corner radius r spaced by the feed (theoretical Rz = f²/8r) plus scatter; milling adds the runout of one tooth;
 * grinding: a random profile with given Rq and correlation length. Units: mm for lengths along the surface, µm for heights.
 */
export type Check = { ok: boolean; label: string; detail: string };
export type RoughProc = 'turning' | 'milling' | 'grinding';

/** Typical Ra ranges [µm] of processes (ISO 1302 / handbook charts, average applications). */
export const PROCESSES: { name: string; lo: number; hi: number }[] = [
  { name: 'Sand casting', lo: 6.3, hi: 25 },
  { name: 'Forging', lo: 1.6, hi: 12.5 },
  { name: 'Flame / plasma cutting', lo: 6.3, hi: 25 },
  { name: 'Laser cutting', lo: 1.6, hi: 12.5 },
  { name: 'FDM 3D printing', lo: 6.3, hi: 25 },
  { name: 'Die casting', lo: 0.8, hi: 3.2 },
  { name: 'Drilling', lo: 1.6, hi: 6.3 },
  { name: 'Milling', lo: 0.8, hi: 6.3 },
  { name: 'Turning', lo: 0.4, hi: 6.3 },
  { name: 'EDM', lo: 0.8, hi: 6.3 },
  { name: 'Reaming', lo: 0.4, hi: 3.2 },
  { name: 'Grinding', lo: 0.1, hi: 1.6 },
  { name: 'Honing', lo: 0.1, hi: 0.8 },
  { name: 'Polishing', lo: 0.05, hi: 0.4 },
  { name: 'Lapping', lo: 0.025, hi: 0.2 },
];
export const PROC_RANGE: Record<RoughProc, [number, number]> = { turning: [0.4, 6.3], milling: [0.8, 6.3], grinding: [0.1, 1.6] };

/** ISO 1302 roughness grade numbers N1…N12 and their Ra [µm]. */
export const NGRADES = [0.025, 0.05, 0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.3, 12.5, 25, 50];
export const nGrade = (Ra: number) => { const i = NGRADES.findIndex((r) => Ra <= r * 1.0001); return i < 0 ? 'above N12' : `N${i + 1}`; };

/** ISO 4288 cut-off: periodic profiles by RSm [mm], non-periodic by Ra [µm]. */
export function cutoff(periodic: boolean, RSm: number, Ra: number) {
  if (periodic) return RSm <= 0.04 ? 0.08 : RSm <= 0.13 ? 0.25 : RSm <= 0.4 ? 0.8 : RSm <= 1.3 ? 2.5 : 8;
  return Ra <= 0.02 ? 0.08 : Ra <= 0.1 ? 0.25 : Ra <= 2 ? 0.8 : Ra <= 10 ? 2.5 : 8;
}

/** Turning: theoretical cusp height and Ra of circular-arc cusps (f ≤ 2r): Rz = f²/8r, Ra = f²/(18√3 r) [µm from mm]. */
export const RzTheo = (f: number, r: number) => ((f * f) / (8 * r)) * 1000;
export const RaTheo = (f: number, r: number) => ((f * f) / (18 * Math.sqrt(3) * r)) * 1000;

/** Small deterministic random generator (same profile for the same inputs). */
export function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());

/** Gaussian mean line (ISO 16610-21) of z sampled at dx with cut-off lc; α = √(ln 2/π). The weight function is cut at
 *  ±0.8 λc, where it has fallen to 10⁻⁴ of its peak; near the ends the weights are renormalised. */
export function gaussianMean(z: number[], dx: number, lc: number) {
  const a = Math.sqrt(Math.log(2) / Math.PI), half = Math.ceil((0.8 * lc) / dx), w = new Float64Array(2 * half + 1), n = z.length, out = new Array<number>(n);
  for (let k = -half; k <= half; k++) w[k + half] = Math.exp(-Math.PI * Math.pow((k * dx) / (a * lc), 2));
  for (let i = 0; i < n; i++) {
    let s = 0, sw = 0; const k0 = Math.max(-half, -i), k1 = Math.min(half, n - 1 - i);
    for (let k = k0; k <= k1; k++) { const wk = w[k + half]; s += wk * z[i + k]; sw += wk; }
    out[i] = s / sw;
  }
  return out;
}

/** ISO 4287 parameters of a roughness profile r (µm) over n sampling lengths, sampled at dx [mm]. */
export function params(r: number[], dx: number, nSamp = 5) {
  const n = r.length, mean = r.reduce((s, v) => s + v, 0) / n, z = r.map((v) => v - mean);
  const Ra = z.reduce((s, v) => s + Math.abs(v), 0) / n, Rq = Math.sqrt(z.reduce((s, v) => s + v * v, 0) / n);
  const Rsk = z.reduce((s, v) => s + v * v * v, 0) / n / Math.pow(Rq || 1, 3), Rku = z.reduce((s, v) => s + v ** 4, 0) / n / Math.pow(Rq || 1, 4);
  const per = Math.floor(n / nSamp), Rzs: number[] = [];
  for (let k = 0; k < nSamp; k++) { const seg = z.slice(k * per, (k + 1) * per); Rzs.push(Math.max(...seg) - Math.min(...seg)); }
  const Rz = Rzs.reduce((s, v) => s + v, 0) / nSamp, Rt = Math.max(...z) - Math.min(...z), Rp = Math.max(...z), Rv = -Math.min(...z);
  // mean width of profile elements: spacing of up-crossings of the mean line (with a 10 % Rz hysteresis)
  const hyst = 0.1 * Rz; let last = -1, state = 0; const cross: number[] = [];
  for (let i = 0; i < n; i++) { if (state <= 0 && z[i] > hyst) { if (state < 0) cross.push(i); state = 1; } else if (state >= 0 && z[i] < -hyst) state = -1; }
  if (cross.length >= 2) last = (cross[cross.length - 1] - cross[0]) / (cross.length - 1);
  const RSm = last > 0 ? last * dx : NaN;
  const sorted = [...z].sort((a, b) => b - a);
  const mr = (c: number) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] >= c) lo = m + 1; else hi = m; } return lo / n; }; // Rmr(c): share above level c
  const at = (q: number) => sorted[Math.min(n - 1, Math.max(0, Math.round(q * (n - 1))))];
  return { z, Ra, Rq, Rsk, Rku, Rz, Rzs, Rt, Rp, Rv, RSm, mr, at };
}

export type RoughIn = {
  proc: RoughProc;
  f: number; r: number;          // feed per rev / per tooth [mm], corner radius [mm]
  scatter: number;               // random scatter on top of the cusps, Rq [µm]
  runout: number;                // milling: one tooth sticks out [µm]
  z: number;                     // milling: teeth
  Rq: number; beta: number;      // grinding: Rq [µm], correlation length [mm]
  wav: number;                   // waviness amplitude [µm] (wavelength 4 λc, removed by the filter)
  spec: number;                  // required Ra [µm] from the drawing
};

/** Build the primary profile over 7 λc (½ λc run-in and run-out discarded after filtering → 5 λc evaluated + spare). */
export function primary(p: RoughIn, lc: number) {
  const L = 6 * lc, Npts = 1600, dx = L / Npts, R = rng(Math.round(p.f * 1e5 + p.r * 1e3 + p.Rq * 1e4 + p.beta * 1e3 + p.z + 7)), x: number[] = [], z: number[] = [];
  const cR = p.r * 1000; // corner radius in µm for the cusp shape
  // random part as a correlated (first-order) process: grinding with its correlation length β, machining with a
  // fifth of the feed (scatter of the cutting edge from one point of the cusp to the next), unit variance
  const corr = p.proc === 'grinding' ? p.beta : Math.max(0.2 * p.f, 2 * dx);
  let e = 0; const phi = Math.exp(-dx / Math.max(corr, dx)), sc = Math.sqrt(1 - phi * phi);
  for (let i = 0; i < Npts; i++) {
    const xi = i * dx; x.push(xi);
    let zi: number;
    if (p.proc === 'grinding') { e = phi * e + sc * gauss(R); zi = p.Rq * e; }
    else {
      const f = p.f, u = ((xi % f) + f) % f - f / 2, k = Math.floor(xi / f);          // position within the cusp [mm]
      const xu = u * 1000, arc = cR - Math.sqrt(Math.max(cR * cR - xu * xu, 0));          // circular arc of the tool corner [µm]
      zi = arc - (p.f * p.f) / (8 * p.r) * 1000;                                          // valleys at −Rz, peaks at 0
      if (p.proc === 'milling' && p.z > 0 && k % p.z === 0) zi -= p.runout;               // the high tooth cuts deeper every z-th cusp
      e = phi * e + sc * gauss(R); zi += p.scatter * e;
    }
    zi += p.wav * Math.sin((2 * Math.PI * xi) / (4 * lc));
    z.push(zi);
  }
  return { x, z, dx };
}

export function roughness(p: RoughIn) {
  const periodic = p.proc !== 'grinding';
  const est = periodic ? RaTheo(p.f, p.r) : p.Rq * 0.8;
  let lc = cutoff(periodic, p.f, est);
  let prof = primary(p, lc), mean = gaussianMean(prof.z, prof.dx, lc);
  // evaluation length 5 λc in the middle
  const cut = (pr: typeof prof, m: number[]) => { const i0 = Math.round((0.5 * lc) / pr.dx), i1 = i0 + Math.round((5 * lc) / pr.dx); return { x: pr.x.slice(i0, i1), P: pr.z.slice(i0, i1), W: m.slice(i0, i1) }; };
  let ev = cut(prof, mean), par = params(ev.P.map((v, i) => v - ev.W[i]), prof.dx);
  // ISO 4288: check the cut-off against the result and measure again if another one applies
  const lc2 = cutoff(periodic, Number.isFinite(par.RSm) ? par.RSm : p.f, par.Ra);
  if (lc2 !== lc) { lc = lc2; prof = primary(p, lc); mean = gaussianMean(prof.z, prof.dx, lc); ev = cut(prof, mean); par = params(ev.P.map((v, i) => v - ev.W[i]), prof.dx); }
  const theo = periodic ? { Rz: RzTheo(p.f, p.r), Ra: RaTheo(p.f, p.r) } : null;
  const [lo, hi] = PROC_RANGE[p.proc];
  const checks: Check[] = [
    { ok: par.Ra <= p.spec, label: 'Ra meets the drawing requirement', detail: `Ra = ${par.Ra.toFixed(2)} µm ≤ ${p.spec.toFixed(2)} µm (${nGrade(p.spec)})` },
    { ok: par.Ra >= 0.5 * lo && par.Ra <= 1.5 * hi, label: 'Result in the usual range of the process (otherwise check the inputs)', detail: `typical Ra ${lo}…${hi} µm` },
    ...(periodic ? [{ ok: p.f <= p.r, label: 'Feed not larger than the corner radius (cusps shaped by the radius)', detail: `f = ${p.f.toFixed(3)} mm ≤ r = ${p.r.toFixed(2)} mm` }] : []),
    { ok: par.Rz <= 10 * par.Ra, label: 'No isolated deep scratches or peaks (Rz ≤ 10 Ra)', detail: `Rz/Ra = ${(par.Rz / par.Ra).toFixed(1)}` },
  ];
  return { lc, ln: 5 * lc, dx: prof.dx, x: ev.x, P: ev.P, W: ev.W, R: par.z, ...par, theo, grade: nGrade(par.Ra), periodic, checks };
}
export type RoughResult = ReturnType<typeof roughness>;

export const ROUGH_INTRO = 'Every machined surface is a landscape of tiny ridges and valleys — a turned shaft carries the print of the tool’s rounded corner once per revolution. A stylus a few micrometres wide traces it, a filter separates the short roughness from the longer waviness, and a handful of numbers describe what is left: Ra, the average height, is the one written on most drawings; Rz, the average peak-to-valley height, catches what Ra smooths over. Finer surfaces cost more: each step down in roughness usually means another, slower process.';

export const ROUGH_NOTES = [
  'Profile parameters after ISO 4287 / ISO 21920-2: Ra = mean |z|, Rq = rms, Rz = mean of the five sampling-length peak-to-valley heights, Rt over the evaluation length, Rsk, Rku, RSm from mean-line crossings (10 % Rz hysteresis), material ratio Rmr(c). Filter: Gaussian mean line (ISO 16610-21, 50 % transmission at λc), cut-off from ISO 4288 (periodic profiles by RSm, others by Ra), evaluation length 5 λc after ½ λc run-in and run-out. The short-wave filter λs and the stylus tip shape are not applied.',
  'Turning and face milling: cusps of the tool corner radius r spaced by the feed f, theoretical Rz = f²/8r and Ra = f²/(18√3 r) (valid for f ≤ 2r); real surfaces are rougher by built-up edge, vibration and tool wear — added here as a correlated random scatter. Face milling: one tooth with runout cuts deeper every z-th cusp (no wiper inserts). Grinding: a correlated Gaussian random profile (exponential autocorrelation) with the chosen Rq and correlation length; real ground surfaces are often slightly negatively skewed.',
  'Process ranges are the usual ISO 1302 / handbook chart values for average applications; special practice reaches beyond them. N grades after ISO 1302 (N1 = 0.025 µm … N12 = 50 µm Ra).',
];
