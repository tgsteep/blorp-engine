/**
 * Mine ventilation, one circuit: intake shaft → intake drift → n parallel working panels → return drift → return shaft
 * with the main fan on the upcast shaft. Atkinson's square law p = R Q² with R = k C L/A³ for every airway (k friction
 * factor, C perimeter, A area, shock losses as extra length), parallel panels 1/√R = Σ 1/√R_i, natural ventilation
 * pressure from the air density difference between the shafts, a fan curve through its rated duty scaled by the fan
 * laws, and the airflow required by the diesel power, the people, the methane and the minimum air speed. SI units.
 */
export type Check = { ok: boolean; label: string; detail: string };
export type MineKind = 'metal' | 'coal';

export type VentIn = {
  kind: MineKind;
  D: number; Ds: number; ks: number;          // shaft depth, diameter [m], friction factor [kg/m³]
  Ld: number; w: number; h: number; kd: number; // drift length, width, height [m], friction factor
  n: number; Lp: number; kp: number;          // working panels in parallel, panel length [m], friction factor
  shock: number;                              // shock losses as extra length share
  Qr: number; pr: number; speed: number; eta: number; // fan rated flow [m³/s], pressure [Pa], speed share, best efficiency
  diesel: number; people: number; ch4: number; // diesel power underground [kW], persons, methane emission [m³/min]
  Ts: number; Tr: number;                     // surface air and return air temperature [°C]
  price: number;                              // electricity per kWh
};

export const atkinson = (k: number, C: number, L: number, A: number) => (k * C * L) / (A * A * A);
export const parallelR = (Rs: number[]) => 1 / Math.pow(Rs.reduce((s, r) => s + 1 / Math.sqrt(r), 0), 2);
/** Fan pressure on a parabola through shut-off 1.5 p_r and the rated duty, scaled by the speed share s (fan laws). */
export const fanP = (Q: number, Qr: number, pr: number, s: number) => 1.5 * pr * s * s - 0.5 * (pr / (Qr * Qr)) * Q * Q;
export const fanEta = (Q: number, Qr: number, s: number, etaMax: number) => { const x = Q / (s * Qr); return Math.max(0.2, etaMax * (1 - Math.pow((x - 1) / 0.8, 2))); };
const rhoAir = (T: number) => 1.2 * 293.15 / (T + 273.15);
export const QREQ = { diesel: 0.06, person: 0.1, ch4: 0.0075, vPanel: 0.3 }; // m³/s per kW, per person; methane design limit; panel air speed m/s

export function ventilation(p: VentIn) {
  const As = Math.PI * p.Ds * p.Ds / 4, Cs = Math.PI * p.Ds, Ad = p.w * p.h, Cd = 2 * (p.w + p.h), f = 1 + p.shock;
  const Rs = atkinson(p.ks, Cs, p.D * f, As), Rd = atkinson(p.kd, Cd, p.Ld * f, Ad), Rp1 = atkinson(p.kp, Cd, p.Lp * f, Ad);
  const Rp = parallelR(Array(Math.max(1, p.n)).fill(Rp1));
  const R = 2 * Rs + 2 * Rd + Rp;
  const NVP = 9.81 * p.D * (rhoAir(p.Ts) - rhoAir(p.Tr)); // positive when the return air is warmer (helps the fan)
  const b = 0.5 * p.pr / (p.Qr * p.Qr), top = 1.5 * p.pr * p.speed * p.speed + NVP;
  const Q = top > 0 ? Math.sqrt(top / (R + b)) : 0, pf = fanP(Q, p.Qr, p.pr, p.speed), eta = fanEta(Q, p.Qr, p.speed, p.eta);
  const Pair = pf * Q / 1000, Pshaft = Pair / eta, kWh = Pshaft * 8760, cost = kWh * p.price;
  const parts = [{ id: 'intake shaft', R: Rs, Q }, { id: 'intake drift', R: Rd, Q }, { id: 'panels', R: Rp, Q }, { id: 'return drift', R: Rd, Q }, { id: 'return shaft', R: Rs, Q }].map((a) => ({ ...a, dp: a.R * Q * Q }));
  const vs = Q / As, vd = Q / Ad, vp = Q / p.n / Ad;
  const req = { diesel: QREQ.diesel * p.diesel, people: QREQ.person * p.people, ch4: p.kind === 'coal' ? (p.ch4 / 60) / QREQ.ch4 : 0, speed: QREQ.vPanel * Ad * p.n };
  const Qreq = Math.max(req.diesel, req.people, req.ch4, req.speed);
  const ch4pct = p.kind === 'coal' && Q > 0 ? (100 * p.ch4 / 60) / Q : 0;
  const x = Q / (p.speed * p.Qr);
  const checks: Check[] = [
    { ok: Q >= Qreq, label: 'Airflow covers the requirement (diesel, people, methane, air speed in the panels)', detail: `Q = ${Q.toFixed(1)} m³/s ≥ ${Qreq.toFixed(1)} m³/s` },
    { ok: x >= 0.65, label: 'Fan works right of its stall region (Q ≥ 0.65 × rated at this speed)', detail: `Q/Q_r = ${x.toFixed(2)}` },
    { ok: vs <= 10, label: 'Shaft air speed at most 10 m/s', detail: `v = ${vs.toFixed(1)} m/s` },
    { ok: vd <= 6, label: 'Drift air speed at most 6 m/s (dust, comfort)', detail: `v = ${vd.toFixed(1)} m/s` },
    { ok: vp >= QREQ.vPanel, label: 'Air speed in each working panel at least 0.3 m/s', detail: `v = ${vp.toFixed(2)} m/s` },
    ...(p.kind === 'coal' ? [{ ok: ch4pct <= 1, label: 'Methane in the return air at most 1 %', detail: `${ch4pct.toFixed(2)} %` }] : []),
  ];
  return { As, Ad, Rs, Rd, Rp1, Rp, R, NVP, b, Q, pf, eta, Pair, Pshaft, kWh, cost, parts, vs, vd, vp, req, Qreq, ch4pct, x, checks };
}
export type VentResult = ReturnType<typeof ventilation>;

export const VENT_INTRO = 'An underground mine needs a steady stream of fresh air: to breathe, to carry away diesel exhaust, dust and heat, and in coal mines to dilute methane below its explosive range. A main fan on the surface pulls air down one shaft, through the drifts and working places and up another. Every airway resists the flow like a pipe — the pressure needed grows with the square of the airflow (Atkinson’s law) — so the fan settles where its curve meets the mine’s resistance curve.';

export const VENT_NOTES = [
  'Atkinson: p = R Q², R = k C L/A³ with friction factors k typical of McPherson’s tables (smooth concrete-lined shaft about 0.004, rock drift 0.010–0.014, rough or timbered drift 0.015–0.025 kg/m³, at air density 1.2 kg/m³); shock losses at bends, junctions and doors as an extra share of the length. Parallel panels share the air equally (same resistance); leakage through doors and old workings, which often takes 20–50 % of the fan air, is not included.',
  'Natural ventilation pressure ΔP = g D (ρ_surface − ρ_return) from the air temperatures (ideal gas at sea-level pressure); it helps the fan when the upcast air is warmer. Fan: a parabola through shut-off pressure 1.5 p_r and the rated duty (Q_r, p_r), scaled by the fan laws (Q ∝ n, p ∝ n²); efficiency parabolic around the rated flow. Real axial fans have a stall dip left of the peak; the 0.65 Q_r check keeps the duty away from it.',
  'Airflow requirement: the largest of 0.06 m³/s per kW of diesel engines, 0.1 m³/s per person, methane diluted to 0.75 % (design value below the usual 1 % limit) and 0.3 m/s in every working panel. Actual national regulations differ; heat load and dust are not included.',
];
