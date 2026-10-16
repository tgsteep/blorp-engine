/**
 * Welded joints under static load, EN 1993-1-8 (Eurocode 3), directional method for fillet welds:
 *   √(σ⊥² + 3(τ⊥² + τ∥²)) ≤ f_u/(β_w·γ_M2)  and  σ⊥ ≤ 0.9·f_u/γ_M2,
 * stresses on the throat section a·l. Full-penetration butt welds: resistance of the weaker plate.
 * Units: mm, N, MPa.
 */

export const GAMMA_M0 = 1.0, GAMMA_M2 = 1.25;

export type Steel = { id: string; fy: number; fu: number; bw: number };
/** EN 10025-2, t ≤ 40 mm; correlation factor β_w from EN 1993-1-8 Table 4.1. */
export const STEELS: Steel[] = [
  { id: 'S235', fy: 235, fu: 360, bw: 0.8 },
  { id: 'S275', fy: 275, fu: 430, bw: 0.85 },
  { id: 'S355', fy: 355, fu: 490, bw: 0.9 },
];

export type WeldCase = 'longitudinal' | 'transverse' | 'bracket' | 'butt';
export type WeldIn = { kind: WeldCase; F: number; l: number; a: number; t: number; e: number; steel: Steel };

/** Long-joint reduction for lap joints longer than 150a (EN 1993-1-8 §4.11). */
export const betaLw = (l: number, a: number) => (l > 150 * a ? Math.min(1, 1.2 - (0.2 * l) / (150 * a)) : 1);

export function weld(p: WeldIn) {
  const { F, l, a, t, e, steel: s } = p;
  const fvw = s.fu / (s.bw * GAMMA_M2); // limit of the equivalent stress
  const fperp = (0.9 * s.fu) / GAMMA_M2;
  let sp = 0, tp = 0, tl = 0, sigButt = 0, bLw = 1, Aw = 0, Ww = 0, sigW = 0;
  if (p.kind === 'butt') {
    sigButt = F / (t * l); // full penetration: weld = plate
  } else {
    Aw = 2 * a * l; // two fillet welds
    if (p.kind === 'longitudinal') { bLw = betaLw(l, a); tl = F / (Aw * bLw); }
    else if (p.kind === 'transverse') { sp = tp = F / (Math.SQRT2 * Aw); }
    else { // bracket: shear along the welds + bending about the weld group
      tl = F / Aw;
      Ww = (2 * a * l * l) / 6;
      sigW = (F * e) / Ww; // normal stress on the throat (projected), at the top end
      sp = tp = sigW / Math.SQRT2;
    }
  }
  const sigEq = Math.sqrt(sp * sp + 3 * (tp * tp + tl * tl));
  const fillet = p.kind !== 'butt';
  const use = fillet ? Math.max(sigEq / fvw, sp / fperp) : sigButt / (s.fy / GAMMA_M0);
  const aReq = fillet ? a * use : NaN; // all fillet stresses scale with 1/a (β_Lw kept)
  const aMax = 0.7 * t, aMin = Math.max(3, Math.sqrt(t) - 0.5);
  const checks = fillet
    ? [
      { ok: sigEq <= fvw, label: 'Equivalent stress √(σ⊥² + 3(τ⊥² + τ∥²)) ≤ f_u/(β_w·γ_M2)', detail: `${sigEq.toFixed(0)} ≤ ${fvw.toFixed(0)} MPa` },
      { ok: sp <= fperp, label: 'Normal stress σ⊥ ≤ 0.9·f_u/γ_M2', detail: `${sp.toFixed(0)} ≤ ${fperp.toFixed(0)} MPa` },
      { ok: a >= aMin, label: 'Throat a ≥ 3 mm and ≥ √t_max − 0.5 (no cold cracks)', detail: `a = ${a} ≥ ${aMin.toFixed(1)} mm` },
      { ok: a <= aMax, label: 'Throat a ≤ 0.7·t (plate not burnt through)', detail: `a = ${a} ≤ ${aMax.toFixed(1)} mm` },
      { ok: l >= Math.max(30, 6 * a), label: 'Weld length l ≥ max(30 mm, 6a) (EN 1993-1-8 §4.5.1)', detail: `l = ${l} mm` },
      ...(p.kind === 'longitudinal' ? [{ ok: bLw >= 1, label: 'Lap length ≤ 150a (else long-joint reduction β_Lw)', detail: `β_Lw = ${bLw.toFixed(2)}` }] : []),
    ]
    : [
      { ok: sigButt <= s.fy / GAMMA_M0, label: 'Full-penetration butt weld: σ = F/(t·l) ≤ f_y/γ_M0 (as the plate)', detail: `${sigButt.toFixed(0)} ≤ ${s.fy} MPa` },
      { ok: t <= 40, label: 'Plate thickness ≤ 40 mm (strengths used)', detail: `t = ${t} mm` },
    ];
  return { fvw, fperp, sp, tp, tl, sigEq, sigButt, bLw, Aw, Ww, sigW, use, aReq, aMin, aMax, checks };
}
export type WeldResult = ReturnType<typeof weld>;

export const WELD_INTRO =
  'A weld joins parts by melting them together. Most welds in machines and steel structures are fillet welds — the triangular bead in a corner — and they are designed on their throat a, the smallest thickness of the triangle. The load is split into stresses on that throat: across it (σ⊥, τ⊥) and along it (τ∥), and Eurocode 3 combines them into one equivalent stress. A full-penetration butt weld is as strong as the plate, so the plate is checked instead.';

export const WELD_ASSUMPTIONS =
  'Static loads, EN 1993-1-8 directional method on the throat section a·l of two equal fillet welds; matching filler metal, β_w from Table 4.1, γ_M2 = 1.25; stresses taken uniform along each weld, end craters ignored (the full length counts). Bracket: shear shared evenly by both welds, bending by the elastic section modulus of the weld lines (2·a·l²/6), the peak at the weld ends. Longitudinal lap welds longer than 150a are reduced by β_Lw (§4.11). Full-penetration butt weld: resistance of the plate, f_y/γ_M0. Detailing limits a ≥ √t − 0.5 and a ≤ 0.7t are common good practice (DIN 18800). Fatigue (EN 1993-1-9 detail categories), residual stresses and the base metal next to the weld are not checked.';
