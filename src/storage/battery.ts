/**
 * Battery pack sizing and behaviour: cells in series for the voltage, strings in parallel for the energy.
 * Each cell is an open-circuit voltage that depends on the state of charge (typical curves per chemistry) behind a
 * series resistance; a constant-power discharge and a constant-power charge (then constant voltage) are integrated
 * over the state of charge. Lead-acid capacity falls with current after Peukert. Cycle life against depth of discharge
 * by a power law through the datasheet point; calendar life as a ceiling. Typical datasheet values, SI units
 * (V, A, Ah, Ω, W, Wh, kg).
 */

export type Chem = 'lfp' | 'nmc' | 'lto' | 'lead';
export type Cell = {
  name: string; shape: 'prism' | 'cyl' | 'block';
  V: number; C: number; R: number;              // nominal voltage, capacity [Ah], DC internal resistance [Ω]
  Vmin: number; Vmax: number;                   // discharge cut-off, charge voltage
  ocv: [number, number][];                      // [SoC, open-circuit voltage]
  m: number; dims: [number, number, number];    // mass [kg]; prism/block L × W × H, cylinder Ø × H × 0 [m]
  cCh: number; cDis: number;                    // largest continuous charge / discharge C-rate
  cycles: number; dodRef: number; b: number;    // cycle life to 80 % at the reference depth, exponent of the DoD law
  years: number;                                // calendar life at about 25 °C
  etaC: number;                                 // coulombic (charge) efficiency
  peukert: number;                              // Peukert exponent k (1 = none), 20 h reference
  pack: number;                                 // pack mass / cell mass (modules, BMS, cabling, rack)
  perModule: number;                            // cells per module for the drawing
};

/** Typical datasheet cells. LFP: 280 Ah prismatic (8000 cycles 0.5C/0.5C, 2.5–3.65 V to 80 %, under compression — 6000 at
 *  80 % DoD used here); NMC: 21700 4.9 Ah (500 cycles to 80 %, 9.8 A continuous, 4.9 A charge, 69 g); LTO: 66160 40 Ah;
 *  lead-acid: 12 V 200 Ah AGM deep-cycle block (C20 rating). */
export const CELLS: Record<Chem, Cell> = {
  lfp: {
    name: 'LFP prismatic 280 Ah', shape: 'prism', V: 3.2, C: 280, R: 0.5e-3, Vmin: 2.5, Vmax: 3.65,
    ocv: [[0, 2.5], [0.03, 2.9], [0.07, 3.15], [0.15, 3.24], [0.3, 3.28], [0.5, 3.3], [0.7, 3.32], [0.9, 3.34], [0.97, 3.37], [1, 3.42]],
    m: 5.45, dims: [0.1737, 0.072, 0.2075], cCh: 0.5, cDis: 1, cycles: 6000, dodRef: 0.8, b: 1.1, years: 15, etaC: 0.995, peukert: 1, pack: 1.35, perModule: 16,
  },
  nmc: {
    name: 'NMC cylindrical 21700, 4.9 Ah', shape: 'cyl', V: 3.6, C: 4.9, R: 0.03, Vmin: 2.5, Vmax: 4.2,
    ocv: [[0, 3.0], [0.05, 3.3], [0.1, 3.45], [0.2, 3.55], [0.3, 3.62], [0.4, 3.68], [0.5, 3.73], [0.6, 3.8], [0.7, 3.88], [0.8, 3.96], [0.9, 4.06], [1, 4.18]],
    m: 0.069, dims: [0.0211, 0.0706, 0], cCh: 1, cDis: 2, cycles: 500, dodRef: 1, b: 1.4, years: 10, etaC: 0.995, peukert: 1, pack: 1.5, perModule: 140,
  },
  lto: {
    name: 'LTO cylindrical 40 Ah', shape: 'cyl', V: 2.3, C: 40, R: 0.8e-3, Vmin: 1.5, Vmax: 2.8,
    ocv: [[0, 1.8], [0.05, 2.05], [0.1, 2.15], [0.2, 2.22], [0.3, 2.25], [0.5, 2.3], [0.7, 2.36], [0.9, 2.48], [1, 2.62]],
    m: 1.21, dims: [0.066, 0.16, 0], cCh: 5, cDis: 10, cycles: 20000, dodRef: 1, b: 0.9, years: 20, etaC: 0.998, peukert: 1, pack: 1.3, perModule: 12,
  },
  lead: {
    name: 'Lead-acid AGM block 12 V 200 Ah', shape: 'block', V: 12, C: 200, R: 3.5e-3, Vmin: 10.5, Vmax: 14.4,
    ocv: [[0, 11.8], [0.2, 12.05], [0.5, 12.3], [0.8, 12.55], [1, 12.73]],
    m: 60, dims: [0.522, 0.24, 0.218], cCh: 0.25, cDis: 0.5, cycles: 600, dodRef: 0.5, b: 1.3, years: 8, etaC: 0.9, peukert: 1.15, pack: 1.1, perModule: 1,
  },
};
export const CHEMS: Chem[] = ['lfp', 'nmc', 'lto', 'lead'];

const interp = (pts: [number, number][], x: number) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [a, fa] = pts[i - 1], [b, fb] = pts[i]; return fa + ((fb - fa) * (x - a)) / (b - a); }
  return pts[pts.length - 1][1];
};
export const ocv = (c: Cell, soc: number) => interp(c.ocv, soc);
/** Capacity available at current I (Peukert, referred to the 20-hour rate). */
export const capacityAt = (c: Cell, I: number) => (c.peukert === 1 || I <= 0 ? c.C : c.C * Math.pow(c.C / 20 / I, c.peukert - 1));
/** Cycle life at depth of discharge DoD: N = N_ref (DoD_ref/DoD)^b. */
export const cycleLife = (c: Cell, dod: number) => c.cycles * Math.pow(c.dodRef / Math.max(dod, 0.01), c.b);

export type BattIn = {
  chem: Chem;
  E: number;        // energy needed at the battery terminals per discharge [Wh]
  Pdis: number;     // discharge power at the terminals [W]
  Pch: number;      // charge power at the terminals [W]
  Vsys: number;     // nominal system voltage wanted [V]
  socMin: number;   // lowest state of charge used 0…1
  socMax: number;   // highest state of charge used 0…1
  cyclesDay: number;
  etaInv: number;   // inverter / charger efficiency each way
  lifeReq: number;  // years the battery must last
};

type Run = { E: number; t: number; soc: number; vEnd: number; cut: boolean; curve: { soc: number; V: number; ocv: number; E: number; I: number }[] };
const STEPS = 300;

/** Constant-power discharge of one cell from socMax down to socMin (or the cut-off voltage). */
export function dischargeCell(c: Cell, P: number, socMax: number, socMin: number): Run {
  let soc = socMax, E = 0, t = 0, cut = false, vEnd = ocv(c, soc);
  const dq = (socMax - socMin) / STEPS, curve: Run['curve'] = [];
  for (let k = 0; k <= STEPS; k++) {
    const u = ocv(c, soc), disc = u * u - 4 * c.R * P;
    if (disc < 0) { cut = true; break; }
    const I = (u - Math.sqrt(disc)) / (2 * c.R), V = u - I * c.R;
    curve.push({ soc, V, ocv: u, E, I });
    vEnd = V;
    if (V < c.Vmin) { cut = true; break; }
    if (k === STEPS || I <= 0) break;
    const dt = (dq * capacityAt(c, I) * 3600) / I; // s
    E += (P * dt) / 3600; t += dt; soc -= dq;
  }
  return { E, t, soc, vEnd, cut, curve };
}

/** Constant-power charge from socMin up to socMax: constant power until the charge voltage, then constant voltage. */
export function chargeCell(c: Cell, P: number, socMin: number, socMax: number) {
  let soc = socMin, E = 0, t = 0, cv = false;
  const dq = (socMax - socMin) / STEPS;
  for (let k = 0; k < STEPS; k++) {
    const u = ocv(c, soc);
    let I = (-u + Math.sqrt(u * u + 4 * c.R * P)) / (2 * c.R), V = u + I * c.R;
    if (V > c.Vmax) { cv = true; V = c.Vmax; I = (c.Vmax - u) / c.R; }
    if (I < 0.02 * c.C) break; // charge current tapered off
    const dt = (dq * c.C * 3600) / (I * c.etaC);
    E += (V * I * dt) / 3600; t += dt; soc += dq;
  }
  return { E, t, soc, cv };
}

export function battery(p: BattIn) {
  const c = CELLS[p.chem];
  const Ns = Math.max(1, Math.round(p.Vsys / c.V));
  const window = Math.max(p.socMax - p.socMin, 0.02);
  const Estring = Ns * c.V * c.C;
  let Np = Math.max(1, Math.floor(p.E / (Estring * window * 1.05))); // a little low, then up until the energy is there
  const pMaxCell = (0.95 * ocv(c, p.socMax) ** 2) / (4 * c.R); // the most power a cell can give (matched load)
  Np = Math.max(Np, Math.ceil(p.Pdis / (Ns * pMaxCell)));
  let dis = dischargeCell(c, p.Pdis / (Ns * Np), p.socMax, p.socMin);
  for (let i = 0; i < 40 && dis.E * Ns * Np < p.E && !dis.cut; i++) { Np++; dis = dischargeCell(c, p.Pdis / (Ns * Np), p.socMax, p.socMin); }
  // a power the cells cannot give even at full charge: add strings until they can (the check still shows the C-rate)
  for (let i = 0; i < 200 && dis.curve.length < 2; i++) { Np++; dis = dischargeCell(c, p.Pdis / (Ns * Np), p.socMax, p.socMin); }
  const N = Ns * Np;
  const socEnd = dis.soc;
  // the charge refills what the discharge took out
  const ch = chargeCell(c, p.Pch / N, socEnd, p.socMax);
  const Eout = dis.E * N, Ein = ch.E * N;
  const etaDC = Ein > 0 ? Eout / Ein : 0, etaAC = etaDC * p.etaInv * p.etaInv;
  const I0 = dis.curve[0]?.I ?? NaN, Ich = p.Pch / N / ocv(c, p.socMin);
  const cDis = I0 / c.C, cCh = Ich / c.C;
  const Vpack = { nom: Ns * c.V, min: Ns * c.Vmin, max: Ns * c.Vmax, end: Ns * dis.vEnd };
  const heat = N * I0 * I0 * c.R; // at the start of the discharge
  const Enom = Ns * Np * c.V * c.C;
  const dod = p.socMax - socEnd;
  const life = cycleLife(c, dod), yearsCycle = life / Math.max(p.cyclesDay * 365, 1e-6), years = Math.min(c.years, yearsCycle);
  const massCells = N * c.m, mass = massCells * c.pack;
  const throughput = life * Eout; // Wh over the cycle life
  const checks: { ok: boolean; label: string; detail: string }[] = [
    { ok: Eout >= 0.999 * p.E, label: 'The battery delivers the energy needed in one discharge', detail: `${(Eout / 1000).toFixed(2)} kWh ≥ ${(p.E / 1000).toFixed(2)} kWh` },
    { ok: !dis.cut, label: 'Voltage stays above the cut-off at full power down to the lowest state of charge', detail: `${Vpack.end.toFixed(1)} V at ${(socEnd * 100).toFixed(0)} % (cut-off ${Vpack.min.toFixed(1)} V)` },
    { ok: cDis <= c.cDis * 1.0001, label: 'Discharge current within the cell rating', detail: `${cDis.toFixed(2)}C ≤ ${c.cDis}C (${I0.toFixed(1)} A per cell)` },
    { ok: cCh <= c.cCh * 1.0001, label: 'Charge current within the cell rating', detail: `${cCh.toFixed(2)}C ≤ ${c.cCh}C` },
    { ok: Vpack.max <= 1500, label: 'Highest pack voltage at most 1500 V DC', detail: `${Vpack.max.toFixed(0)} V` },
    { ok: years >= p.lifeReq, label: 'Lasts the years required at this use', detail: `${years.toFixed(1)} ≥ ${p.lifeReq.toFixed(0)} years (cycling ${yearsCycle.toFixed(1)} y, calendar ${c.years} y)` },
  ];
  if (p.chem === 'lead') checks.push({ ok: dod <= 0.5 + 1e-9, label: 'Lead-acid discharged to at most 50 % depth (deeper cycling shortens its life quickly)', detail: `DoD = ${(dod * 100).toFixed(0)} %` });
  return {
    cell: c, Ns, Np, N, Enom, Eout, Ein, etaDC, etaAC, tDis: dis.t, tCh: ch.t, dis, ch, socEnd, dod,
    I0, Ich, cDis, cCh, Vpack, heat, life, yearsCycle, years, massCells, mass, throughput,
    whkg: Eout / Math.max(mass, 1e-9), checks,
  };
}
export type BattResult = ReturnType<typeof battery>;

export const BATT_DEFAULTS: Record<Chem, BattIn> = {
  lfp: { chem: 'lfp', E: 13.5e3, Pdis: 5e3, Pch: 5e3, Vsys: 51.2, socMin: 0.05, socMax: 1, cyclesDay: 1, etaInv: 0.97, lifeReq: 10 },
  nmc: { chem: 'nmc', E: 13.5e3, Pdis: 5e3, Pch: 5e3, Vsys: 400, socMin: 0.1, socMax: 0.9, cyclesDay: 0.15, etaInv: 0.97, lifeReq: 10 },
  lto: { chem: 'lto', E: 13.5e3, Pdis: 20e3, Pch: 20e3, Vsys: 400, socMin: 0.05, socMax: 0.95, cyclesDay: 3, etaInv: 0.97, lifeReq: 15 },
  lead: { chem: 'lead', E: 5e3, Pdis: 1.5e3, Pch: 1.5e3, Vsys: 48, socMin: 0.5, socMax: 1, cyclesDay: 0.3, etaInv: 0.95, lifeReq: 5 },
};

export const BATT_INTRO = 'A battery pack is many identical cells: cells in series add their voltage, strings in parallel add their capacity. Every cell is a voltage that falls as it empties, behind a small internal resistance; drawing current costs a little voltage and some heat, so the faster you empty or fill it, the less comes back. How deep you cycle it, and how often, decides how many years it lasts.';

export const BATT_NOTES = [
  'Cells: typical datasheet values — LFP prismatic 280 Ah (3.2 V, 5.45 kg, 2.5–3.65 V, 0.5C charge, 1C discharge; the 8000-cycle datasheet figure needs clamping pressure, 6000 cycles at 80 % depth used here), NMC 21700 4.9 Ah (3.6 V, 69 g, 2.5–4.2 V, 4.9 A charge, 9.8 A continuous, 500 cycles to 80 %), LTO 40 Ah cylindrical, lead-acid AGM 12 V 200 Ah deep-cycle block (C20). Open-circuit voltage curves and internal resistances are typical, not of a particular cell; real resistance rises in the cold and with age.',
  'Pack: N_s = round(V_system/V_cell) cells in series, N_p parallel strings until a constant-power discharge from the highest to the lowest state of charge delivers the energy asked for. Each step: I = (U − √(U² − 4RP))/(2R) for a cell giving power P with open-circuit voltage U(SoC) and resistance R; the discharge stops at the lowest state of charge or at the cut-off voltage. Lead-acid capacity at current I: C_20 (I_20/I)^(k−1) with Peukert k = 1.15. Charging: constant power until the charge voltage, then constant voltage until the current falls to 0.02C; coulombic efficiency 0.995 (Li) or 0.9 (lead-acid gassing).',
  'Efficiency: DC round trip = energy out / energy in for the same swing of state of charge; AC round trip adds the inverter twice. Heat = N I² R at the start of the discharge. Pack mass = cell mass × a typical factor for modules, BMS, cabling and rack (1.1 lead-acid … 1.5 cylindrical cells).',
  'Life: cycles to 80 % capacity N = N_ref (DoD_ref/DoD)^b through the datasheet point (b: rough fits of published cycle-life curves), capped by a calendar life at about 25 °C (LFP 15, NMC 10, LTO 20, lead-acid 8 years). Heat, high states of charge and fast charging age cells faster; the tool does not model temperature. Real systems need a BMS with cell balancing, fusing and a thermal design.',
];
