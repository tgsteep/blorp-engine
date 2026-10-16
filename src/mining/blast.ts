/**
 * Open-pit bench blasting, rules of thumb as taught in mining courses (Konya & Walter): burden from the hole diameter
 * and the explosive/rock densities, spacing, stemming and subdrill as multiples of the burden, charge per hole and
 * powder factor; fragmentation by the Kuz–Ram model (Cunningham 1983/1987: Kuznetsov mean size, Rosin–Rammler
 * curve with the uniformity index); ground vibration by the USBM scaled-distance law. Units: m, mm (hole), kg, s.
 */
export type Check = { ok: boolean; label: string; detail: string };
export type RockId = 'limestone' | 'sandstone' | 'granite' | 'basalt' | 'ore';
/** Typical rock data: density [t/m³], Kuz–Ram rock factor A (Cunningham, 0.8…22), uniaxial strength [MPa]. */
export const ROCKS: Record<RockId, { name: string; rho: number; A: number; ucs: number; color: string }> = {
  limestone: { name: 'Limestone', rho: 2.6, A: 7, ucs: 80, color: '#C9C2B0' },
  sandstone: { name: 'Sandstone', rho: 2.4, A: 5, ucs: 50, color: '#C8A878' },
  granite: { name: 'Granite', rho: 2.7, A: 10, ucs: 180, color: '#A8A29E' },
  basalt: { name: 'Basalt', rho: 2.9, A: 12, ucs: 250, color: '#5B5F66' },
  ore: { name: 'Iron ore', rho: 3.5, A: 10, ucs: 150, color: '#7A4A3A' },
};
export type ExpId = 'anfo' | 'hanfo' | 'emulsion';
/** Typical bulk explosives: density [g/cm³], weight strength relative to ANFO [%], water resistance. */
export const EXPLOSIVES: Record<ExpId, { name: string; rho: number; rws: number; wet: boolean }> = {
  anfo: { name: 'ANFO', rho: 0.82, rws: 100, wet: false },
  hanfo: { name: 'Heavy ANFO (50 % emulsion)', rho: 1.25, rws: 105, wet: true },
  emulsion: { name: 'Bulk emulsion', rho: 1.2, rws: 85, wet: true },
};
export const PPV_K = 1140, PPV_B = 1.6; // USBM RI 8507 "average" site law, PPV [mm/s] = K (R/√W)^−β

export type BlastIn = {
  rock: RockId; exp: ExpId;
  d: number; H: number;           // hole diameter [mm], bench height [m]
  kB: number;                     // burden as a share of the Konya burden (1 = rule of thumb)
  sb: number; tb: number; jb: number; // spacing, stemming, subdrill as multiples of the burden
  rows: number; perRow: number;   // pattern
  dev: number;                    // drilling accuracy (standard deviation) [m]
  wet: boolean;                   // water in the holes
  xmax: number;                   // largest acceptable block (crusher feed / bucket) [m]
  R: number; ppvMax: number;      // distance to the nearest building [m], vibration limit [mm/s]
};

/** Konya burden [m] for a hole of d [mm]: B = 0.012 (2 ρ_e/ρ_r + 1.5) d. */
export const konyaBurden = (rhoE: number, rhoR: number, d: number) => 0.012 * ((2 * rhoE) / rhoR + 1.5) * d;
/** Kuznetsov–Cunningham mean fragment size X50 [m] (A rock factor, K powder factor kg/m³, Q kg per hole, E RWS %). */
export const x50 = (A: number, K: number, Q: number, E: number) => (A * Math.pow(K, -0.8) * Math.pow(Q, 1 / 6) * Math.pow(115 / E, 19 / 30)) / 100;
/** Cunningham uniformity index (B m, d mm, W drilling deviation m, Lc charge length m, H bench height m). */
export const uniformity = (B: number, d: number, S: number, W: number, Lc: number, H: number) =>
  (2.2 - (14 * B) / d) * (1 - W / B) * ((1 + S / B) / 2) * (Lc / H);
/** Share passing a size x for a Rosin–Rammler curve through X50 with uniformity n. */
export const passing = (x: number, X50: number, n: number) => 1 - Math.exp(-0.693 * Math.pow(Math.max(x, 0) / X50, n));
export const ppv = (R: number, W: number) => PPV_K * Math.pow(R / Math.sqrt(W), -PPV_B);

export function blast(p: BlastIn) {
  const rock = ROCKS[p.rock], ex = EXPLOSIVES[p.exp];
  const B0 = konyaBurden(ex.rho, rock.rho, p.d), B = p.kB * B0, S = p.sb * B, T = p.tb * B, J = p.jb * B;
  const L = p.H + J, Lc = Math.max(0, L - T), lin = (Math.PI * Math.pow(p.d / 1000, 2) / 4) * ex.rho * 1000; // kg/m
  const Q = lin * Lc, V = B * S * p.H, K = Q / V, Kt = K / rock.rho; // kg per hole, m³ per hole, kg/m³, kg/t
  const nHoles = p.rows * p.perRow, Vtot = V * nHoles, tonnes = Vtot * rock.rho, Qtot = Q * nHoles, drill = L * nHoles;
  const X50 = Q > 0 ? x50(rock.A, K, Q, ex.rws) : NaN;
  const n = Math.min(2.5, Math.max(0.5, uniformity(B, p.d, S, p.dev, Lc, p.H)));
  const over = Number.isFinite(X50) ? 1 - passing(p.xmax, X50, n) : 1;
  const SD = p.R / Math.sqrt(Math.max(Q, 1e-9)), PPV = Q > 0 ? ppv(p.R, Q) : 0;
  const Rmin = Math.sqrt(Math.max(Q, 0)) * Math.pow(p.ppvMax / PPV_K, -1 / PPV_B); // distance where PPV = limit
  const checks: Check[] = [
    { ok: Lc > 0.3 * p.H, label: 'Explosive column long enough (at least 30 % of the bench)', detail: `L_c = ${Lc.toFixed(2)} m of L = ${L.toFixed(2)} m` },
    { ok: p.H / B >= 2, label: 'Bench stiff enough: H/B ≥ 2 (otherwise toes and boulders)', detail: `H/B = ${(p.H / B).toFixed(2)}` },
    { ok: p.sb >= 1 && p.sb <= 1.5, label: 'Spacing 1.0…1.5 × burden', detail: `S/B = ${p.sb.toFixed(2)}` },
    { ok: p.tb >= 0.7, label: 'Stemming at least 0.7 × burden (confines the gases, limits flyrock and air blast)', detail: `T = ${T.toFixed(2)} m = ${p.tb.toFixed(2)} B` },
    { ok: K >= 0.2 && K <= 1.0, label: 'Powder factor in the usual range 0.2…1.0 kg/m³', detail: `q = ${K.toFixed(2)} kg/m³ = ${Kt.toFixed(3)} kg/t` },
    { ok: over <= 0.1, label: 'Oversize at most 10 % (blocks larger than the crusher or bucket)', detail: `${(100 * over).toFixed(1)} % above ${p.xmax.toFixed(2)} m, X50 = ${(X50 * 100).toFixed(0)} cm` },
    { ok: PPV <= p.ppvMax, label: 'Ground vibration at the nearest building within the limit (one hole per delay)', detail: `PPV = ${PPV.toFixed(1)} mm/s ≤ ${p.ppvMax} mm/s at ${p.R.toFixed(0)} m` },
    { ok: !p.wet || ex.wet, label: 'Explosive suits wet holes (ANFO dissolves in water)', detail: p.wet ? `${ex.name} in wet holes` : 'dry holes' },
  ];
  return { rock, ex, B0, B, S, T, J, L, Lc, lin, Q, V, K, Kt, nHoles, Vtot, tonnes, Qtot, drill, drillPerM3: L / V, X50, n, over, SD, PPV, Rmin, checks };
}
export type BlastResult = ReturnType<typeof blast>;

export const BLAST_INTRO = 'In an open pit or quarry the rock is broken by a row-by-row pattern of drilled holes. Each hole has rock in front of it to move — the burden — and the explosive in its lower part pushes that rock forward into the free space in front of the bench; the top of the hole is filled with crushed stone (stemming) so the gases do their work in the rock instead of escaping. Burden and spacing set how much rock each hole breaks; together with the rock they decide how fine the muckpile is and how much the ground shakes at the neighbours.';

export const BLAST_NOTES = [
  'Pattern after Konya & Walter: burden B = 0.012 (2 ρ_e/ρ_r + 1.5) d (m, d in mm), spacing, stemming and subdrill as multiples of B (rules of thumb S = 1.0…1.5 B, T ≈ 0.7 B, J ≈ 0.3 B). Charge = linear charge density π d²/4 ρ_e × charge length, fully coupled; powder factor = charge/(B S H). Real designs adjust to the rock mass, joints, water and the free face; this is a first estimate for learning, not a blast plan.',
  'Fragmentation by Kuz–Ram (Cunningham 1983/1987): X50 = A q^−0.8 Q^(1/6) (115/RWS)^(19/30) cm, uniformity n = (2.2 − 14 B/d)(1 − W/B)((1 + S/B)/2)(L_c/H), Rosin–Rammler passing 1 − exp(−0.693 (x/X50)^n). The rock factor A is a typical value for the rock name; it really depends on the joint spacing and strength. Kuz–Ram tends to under-predict fines.',
  'Ground vibration: USBM scaled distance with average site constants, PPV = 1140 (R/√W)^−1.6 mm/s, W the charge firing in one delay (here one hole). Site laws vary widely; regulations (e.g. DIN 4150-3, USBM RI 8507) give limits that depend on frequency and building type. Blasting is done only by licensed shot-firers under the local regulations; flyrock and air blast are not calculated.',
];
