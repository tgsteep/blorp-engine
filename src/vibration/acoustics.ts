/**
 * Outdoor noise from machines: sound power level L_W → sound pressure level L_p at a distance (point source,
 * free field with directivity Q), n identical sources, background noise, a thin barrier (Maekawa), and the
 * rules for adding decibels. L_p = L_W + 10 lg(Q/(4πr²)) dB.
 */
export const C_AIR = 343; // speed of sound [m/s] at 20 °C

/** Sum of levels: 10 lg Σ 10^(L/10). */
export const addDb = (...L: number[]) => 10 * Math.log10(L.reduce((s, x) => s + Math.pow(10, x / 10), 0));
/** What the quieter of two levels adds to the louder: 10 lg(1 + 10^(−Δ/10)). */
export const addOn = (diff: number) => 10 * Math.log10(1 + Math.pow(10, -diff / 10));
/** Sound pressure level of a point source at r [m] with directivity factor Q (1 free, 2 on the ground, 4 at a wall, 8 in a corner). */
export const lpAt = (Lw: number, r: number, Q: number) => Lw + 10 * Math.log10(Q / (4 * Math.PI * r * r));
/** Maekawa barrier attenuation for Fresnel number N = 2δ/λ: 10 lg(3 + 20N), 0 when the line of sight is free, at most 20 dB (ISO 9613-2 cap). */
export const maekawa = (N: number) => (N <= -0.1 ? 0 : Math.min(20, Math.max(0, 10 * Math.log10(3 + 20 * N))));

export type Limit = 'work85' | 'work80' | 'day55' | 'night45';
export const LIMITS: Record<Limit, { L: number; name: string }> = {
  work85: { L: 85, name: 'Workplace, upper action value 85 dB(A)' },
  work80: { L: 80, name: 'Workplace, lower action value 80 dB(A)' },
  day55: { L: 55, name: 'Homes by day 55 dB(A)' },
  night45: { L: 45, name: 'Homes at night 45 dB(A)' },
};

export type AcIn = {
  Lw: number;   // A-weighted sound power level of one machine [dB(A)]
  n: number;    // identical machines at the same place
  r: number;    // distance to the listener [m]
  Q: 1 | 2 | 4 | 8;
  Lbg: number;  // background level at the listener [dB(A)]
  barrier: boolean;
  db: number;   // distance source → barrier [m]
  hb: number;   // barrier height [m]
  f: number;    // frequency for the barrier [Hz] (500 Hz as a typical A-weighted noise)
  limit: Limit;
};
export const H_SRC = 1, H_RCV = 1.6, H_AIR = 6; // source and listener heights [m]; a machine 'in the air' stands on a 6 m mast
/** Height of the noise source: 1 m on the ground, at a wall or in a corner; 6 m up on a mast when it is in the air (Q = 1). */
export const srcH = (Q: number) => (Q === 1 ? H_AIR : H_SRC);

export function acoustics(p: AcIn) {
  const Lw = p.Lw + 10 * Math.log10(p.n);
  const Lfree = lpAt(Lw, p.r, p.Q);
  // barrier: path difference over the top (source at srcH, listener at H_RCV, both on the ground plane)
  const hs = srcH(p.Q), db = Math.min(p.db, p.r * 0.95), dr = p.r - db;
  const direct = Math.hypot(p.r, H_RCV - hs), over = Math.hypot(db, p.hb - hs) + Math.hypot(dr, p.hb - H_RCV);
  const yLine = hs + ((H_RCV - hs) * db) / p.r, delta = (p.hb >= yLine ? 1 : -1) * (over - direct);
  const lam = C_AIR / p.f, N = (2 * delta) / lam;
  const Ab = p.barrier ? maekawa(N) : 0;
  const Lp = Lfree - Ab, Ltot = addDb(Lp, p.Lbg);
  const lim = LIMITS[p.limit].L;
  // distance at which the machines alone meet the limit (free field, no barrier): r = √(Q/(4π)) 10^((L_W − L)/20)
  const rLim = Math.sqrt(p.Q / (4 * Math.PI)) * Math.pow(10, (Lw - lim + (p.barrier ? -Ab : 0)) / 20);
  const checks = [
    { ok: Ltot <= lim, label: 'Level at the listener within the chosen limit', detail: `L = ${Ltot.toFixed(1)} dB(A) ≤ ${lim} dB(A)` },
    { ok: Lp - p.Lbg >= 3 || Ltot <= lim, label: 'The machines can be told apart from the background (≥ 3 dB above it) or the limit is met anyway', detail: `machines ${Lp.toFixed(1)} dB(A), background ${p.Lbg.toFixed(0)} dB(A)` },
    ...(p.barrier ? [{ ok: N > 0, label: 'Barrier breaks the line of sight', detail: `δ = ${(delta * 100).toFixed(1)} cm, N = ${N.toFixed(2)}` }] : []),
  ];
  return { Lw, Lfree, delta, lam, N, Ab, Lp, Ltot, lim, rLim, db, checks };
}
export type AcResult = ReturnType<typeof acoustics>;

export const AC_INTRO = 'Decibels are logarithms, so they do not add like ordinary numbers: two equal machines are 3 dB louder than one, ten are 10 dB louder, and a source 10 dB quieter than another adds almost nothing. Away from a machine the sound spreads over a growing sphere and the level drops 6 dB every time the distance doubles. A wall that hides the machine from the listener takes off a few more decibels, more for high pitches than for low.';

export const AC_NOTES = [
  'Point source in a free field: L_p = L_W + 10 lg(Q/(4πr²)) with directivity Q = 1 (in the air), 2 (on hard ground), 4 (at a wall), 8 (in a corner). A-weighted levels throughout; air absorption, ground effect, wind and temperature gradients (ISO 9613-2) and room reverberation are not included, so far away and indoors the real level differs.',
  'Adding levels: L = 10 lg Σ 10^(L_i/10); n equal sources add 10 lg n. Barrier: Maekawa’s chart as 10 lg(3 + 20N), Fresnel number N = 2δ/λ from the path difference δ over the top of a long thin wall (source 1 m high, 6 m on its mast when in the air; listener 1.6 m high), at one frequency (500 Hz is typical for A-weighted machine noise), capped at 20 dB as in ISO 9613-2; sound around the ends of the wall is not counted.',
  'Limits for comparison only: 80 and 85 dB(A) are the lower and upper exposure action values of the EU noise directive 2003/10/EC (8-hour daily exposure, the level here is taken as constant over the day); 55 dB(A) by day and 45 dB(A) at night are WHO-style guide values for homes — local regulations differ.',
];
