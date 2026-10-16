/**
 * Vibration isolation of a machine on springs: single degree of freedom (vertical), viscous damping,
 * rotating unbalance m·e·ω² as the exciting force. Textbook relations (Rao, Mechanical Vibrations; Thomson):
 * ω_n = √(k/m), ζ = c/(2√(km)), r = ω/ω_n, amplitude X = (F₀/k)/√((1 − r²)² + (2ζr)²),
 * transmissibility T = √(1 + (2ζr)²)/√((1 − r²)² + (2ζr)²), transmitted force F_T = T F₀. SI units.
 */
export const G = 9.81;

export type IsoType = 'rubber' | 'spring' | 'springDamped' | 'air';
/** Typical damping ratios of isolator types (manufacturers' catalogues: rubber 0.05…0.1, steel springs ≈ 0.005…0.01). */
export const ISOLATORS: Record<IsoType, { zeta: number; name: string }> = {
  rubber: { zeta: 0.07, name: 'Rubber mounts' },
  spring: { zeta: 0.01, name: 'Steel springs' },
  springDamped: { zeta: 0.15, name: 'Springs with dampers' },
  air: { zeta: 0.05, name: 'Air springs' },
};

export type VibIn = {
  m: number;      // machine mass on the mounts [kg]
  rpm: number;    // running speed [1/min]
  me: number;     // unbalance m·e [kg·mm] (ISO 21940 balance grade G × m / ω gives typical values)
  n: number;      // number of mounts
  kEach: number;  // stiffness of one mount [kN/m]
  iso: IsoType;
  zeta?: number;  // overrides the type's damping ratio
};

/** Steady response at frequency ratio r for damping ratio ζ. */
export const magnification = (r: number, z: number) => 1 / Math.sqrt((1 - r * r) ** 2 + (2 * z * r) ** 2);
export const transmissibility = (r: number, z: number) => Math.sqrt(1 + (2 * z * r) ** 2) * magnification(r, z);

export function vibration(p: VibIn) {
  const k = p.n * p.kEach * 1e3, zeta = p.zeta ?? ISOLATORS[p.iso].zeta;
  const wn = Math.sqrt(k / p.m), fn = wn / (2 * Math.PI), w = (p.rpm * 2 * Math.PI) / 60, f = w / (2 * Math.PI);
  const r = w / wn, c = 2 * zeta * Math.sqrt(k * p.m);
  const F0 = (p.me / 1000) * w * w;                       // unbalance force amplitude [N]
  const MF = magnification(r, zeta), T = transmissibility(r, zeta);
  const X = (F0 / k) * MF, FT = T * F0, phase = Math.atan2(2 * zeta * r, 1 - r * r);
  const dst = (p.m * G) / k;                              // static deflection of the mounts
  const v = X * w;                                        // vibration velocity amplitude [m/s]
  // passing through resonance on start-up: response at r = 1 for the unbalance force at that speed
  const F0res = (p.me / 1000) * wn * wn, Xres = F0res / k / (2 * zeta), FTres = F0res * transmissibility(1, zeta);
  const vRms = (v / Math.SQRT2) * 1000;                   // mm/s rms (ISO 10816 / 20816 uses rms velocity)
  const checks = [
    { ok: r >= Math.SQRT2 * 2, label: 'Isolation: running at least 2.8 times the natural frequency (r ≥ 2√2)', detail: `r = f/f_n = ${r.toFixed(2)}, f = ${f.toFixed(1)} Hz, f_n = ${fn.toFixed(2)} Hz` },
    { ok: T <= 0.2, label: 'At least 80 % of the force kept from the floor (T ≤ 0.2)', detail: `T = ${T.toFixed(3)}, isolation ${((1 - T) * 100).toFixed(0)} %` },
    { ok: vRms <= 4.5, label: 'Machine vibration velocity ≤ 4.5 mm/s rms (ISO 20816 zone B, rigid foundation, typical)', detail: `v = ${vRms.toFixed(2)} mm/s rms` },
    { ok: Xres <= 0.02, label: 'Start-up through resonance stays below 20 mm', detail: `X at resonance = ${(Xres * 1000).toFixed(1)} mm (ζ = ${zeta.toFixed(3)})` },
    { ok: dst <= 0.05, label: 'Static deflection of the mounts ≤ 50 mm', detail: `δ_st = ${(dst * 1000).toFixed(1)} mm` },
  ];
  return { k, zeta, wn, fn, w, f, r, c, F0, MF, T, X, FT, phase, dst, v, vRms, Xres, FTres, eff: 1 - T, checks };
}
export type VibResult = ReturnType<typeof vibration>;

/** Stiffness per mount for a target frequency ratio: k = m (ω/r)²/n. */
export const kForRatio = (m: number, rpm: number, n: number, r: number) => (m * ((rpm * Math.PI) / 30 / r) ** 2) / n / 1e3;

export const VIB_INTRO = 'A machine with an unbalanced rotor shakes at its running speed. Put on springs, it moves more but passes less force to the floor — as long as it runs well above the natural frequency of the machine on its springs. Near that frequency (resonance) the motion grows large, held back only by damping; far above it, soft springs keep the force away from the building.';

export const VIB_NOTES = [
  'One degree of freedom, vertical: machine as a rigid mass on n identical mounts in parallel, viscous damping with the damping ratio typical of the mount type (rubber 0.07, steel springs 0.01, springs with dampers 0.15, air springs 0.05 — use the manufacturer’s value). Rocking, horizontal modes, the floor’s own flexibility and the mounts’ frequency-dependent stiffness are not included.',
  'Exciting force from the rotating unbalance F₀ = m·e·ω²; amplitude X = (F₀/k)/√((1 − r²)² + (2ζr)²), transmissibility T = √(1 + (2ζr)²)/√((1 − r²)² + (2ζr)²) (Rao, Mechanical Vibrations; Thomson, Theory of Vibration). Isolation needs r > √2; r ≥ 2√2 (≈ 88 % isolation without damping) is a common design rule. Damping lowers the start-up peak but raises T above r = √2.',
  'Vibration severity: rms velocity v = Xω/√2 compared with 4.5 mm/s, the zone A/B boundary for medium machines on rigid foundations in ISO 20816-3 (indicative; the standard’s zones depend on machine group and support). Unbalance m·e from the balance grade: e = G/ω with G in mm/s (ISO 21940-11), e.g. G 6.3 for fans and pumps.',
];
