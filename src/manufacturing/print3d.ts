/**
 * FDM 3D printing estimate for a simple prism (box, cylinder or tube): the slicer's split into walls (perimeter loops),
 * solid top/bottom layers and rectilinear infill, extruded volume, filament mass and length, print time with
 * trapezoidal acceleration on every line and the hot end's melt capacity (volumetric flow) as a speed limit,
 * energy and cost. Units: mm, mm/s, mm/s², mm³/s, g, s.
 */
export type Check = { ok: boolean; label: string; detail: string };
export type FilamentId = 'pla' | 'petg' | 'abs' | 'asa' | 'tpu' | 'pacf';
/** Typical filament data (datasheet-style values, rounded): density, nozzle/bed temperature, XY tensile strength,
 *  a speed cap for soft filaments (0 = none), whether it warps without an enclosure. */
export const FILAMENTS: Record<FilamentId, { name: string; rho: number; Tn: number; Tb: number; Rm: number; vmax: number; warp: boolean; price: number; color: string }> = {
  pla: { name: 'PLA', rho: 1.24, Tn: 210, Tb: 60, Rm: 50, vmax: 0, warp: false, price: 20, color: '#E07B00' },
  petg: { name: 'PETG', rho: 1.27, Tn: 240, Tb: 80, Rm: 45, vmax: 0, warp: false, price: 22, color: '#2E8BC0' },
  abs: { name: 'ABS', rho: 1.04, Tn: 250, Tb: 100, Rm: 40, vmax: 0, warp: true, price: 20, color: '#D9D9D4' },
  asa: { name: 'ASA', rho: 1.07, Tn: 255, Tb: 100, Rm: 42, vmax: 0, warp: true, price: 25, color: '#3C4048' },
  tpu: { name: 'TPU 95A', rho: 1.21, Tn: 225, Tb: 50, Rm: 30, vmax: 30, warp: false, price: 30, color: '#C0392B' },
  pacf: { name: 'Nylon PA-CF', rho: 1.2, Tn: 270, Tb: 80, Rm: 80, vmax: 0, warp: true, price: 60, color: '#2B2E33' },
};
export type Shape = 'box' | 'cylinder' | 'tube';
export const SHAPES: Shape[] = ['box', 'cylinder', 'tube'];
export const NOZZLES = [0.2, 0.4, 0.6, 0.8];
export const BED = 256; // build volume edge [mm] (a common 256 mm cube)

export type PrintIn = {
  fil: FilamentId; shape: Shape;
  W: number; D: number; Di: number; H: number;   // box W × D; cylinder/tube outer diameter W; tube inner diameter Di [mm]
  nozzle: number; h: number;                      // nozzle diameter, layer height [mm]
  walls: number; tb: number; infill: number;      // wall loops, top and bottom solid layers, infill fraction 0…1
  v: number; acc: number; Qmax: number;           // print speed [mm/s], acceleration [mm/s²], hot-end melt capacity [mm³/s]
  price: number; power: number; elec: number;     // filament price per kg, average printer power [W], electricity per kWh
};

/** Time to print one straight line of length L at top speed v with acceleration a (trapezoidal or triangular). */
export const lineTime = (L: number, v: number, a: number) => (L <= 0 ? 0 : L >= (v * v) / a ? L / v + v / a : 2 * Math.sqrt(L / a));

/** Cross-section at an inward wall offset t: area [mm²], loops' total centreline length and corners for n loops. */
export function section(p: Pick<PrintIn, 'shape' | 'W' | 'D' | 'Di'>, t: number) {
  if (p.shape === 'box') { const a = Math.max(0, p.W - 2 * t), b = Math.max(0, p.D - 2 * t); return { A: a * b, chord: Math.sqrt(a * b) }; }
  if (p.shape === 'cylinder') { const r = Math.max(0, p.W / 2 - t); return { A: Math.PI * r * r, chord: r * Math.sqrt(Math.PI) }; }
  const ro = p.W / 2 - t, ri = p.Di / 2 + t, A = ro > ri ? Math.PI * (ro * ro - ri * ri) : 0;
  return { A, chord: ro > ri ? Math.sqrt(A) : 0 };
}
export const outerArea = (p: Pick<PrintIn, 'shape' | 'W' | 'D' | 'Di'>) => section(p, 0).A;

/** Wall loops of one layer: centreline lengths of every loop and the number of straight segments in each. */
export function loops(p: Pick<PrintIn, 'shape' | 'W' | 'D' | 'Di'>, n: number, w: number) {
  const out: { L: number; seg: number }[] = [];
  for (let k = 0; k < n; k++) {
    const o = (k + 0.5) * w;
    if (p.shape === 'box') { const a = p.W - 2 * o, b = p.D - 2 * o; if (a > 0 && b > 0) out.push({ L: 2 * (a + b), seg: 4 }); }
    else if (p.shape === 'cylinder') { const r = p.W / 2 - o; if (r > 0) out.push({ L: 2 * Math.PI * r, seg: 1 }); }
    else { const ro = p.W / 2 - o, ri = p.Di / 2 + o; if (ro > ri) { out.push({ L: 2 * Math.PI * ro, seg: 1 }); out.push({ L: 2 * Math.PI * ri, seg: 1 }); } }
  }
  return out;
}

export function print3d(p: PrintIn) {
  const F = FILAMENTS[p.fil], w = 1.125 * p.nozzle, h = p.h;
  const N = Math.max(1, Math.round(p.H / h)), nSolid = Math.min(N, 2 * p.tb), nInfill = N - nSolid;
  const A0 = outerArea(p), t = p.walls * w, core = section(p, t), Ai = core.A;
  const Awall = A0 - Ai;                          // area printed as wall loops in every layer
  // speeds: requested, capped by the hot end and the filament
  const cap = F.vmax > 0 ? F.vmax : Infinity, vVol = p.Qmax / (w * h), vi = Math.min(p.v, vVol, cap), vw = Math.min(0.7 * p.v, vVol, cap);
  const limited = p.v > vVol || p.v > cap;
  // volumes [mm³]
  const Vwall = Awall * h * N, Vsolid = Ai * h * nSolid, Vinf = Ai * p.infill * h * nInfill, V = Vwall + Vsolid + Vinf;
  const Vpart = A0 * N * h;
  // time per layer
  const lp = loops(p, p.walls, w), tWallLayer = lp.reduce((s, l) => s + l.seg * lineTime(l.L / l.seg, vw, p.acc), 0);
  const lineLen = core.chord, spacingSolid = w, spacingInf = p.infill > 0 ? w / p.infill : 0;
  const nLinesSolid = lineLen > 0 ? lineLen / spacingSolid : 0, nLinesInf = lineLen > 0 && spacingInf > 0 ? lineLen / spacingInf : 0;
  const tSolidLayer = nLinesSolid * lineTime(lineLen, vi, p.acc), tInfLayer = nLinesInf * lineTime(lineLen, vi, p.acc);
  const tTravelLayer = 1.0 + lineTime(Math.sqrt(A0), 200, p.acc) * 2; // layer change, retract and two travel moves
  const tWall = tWallLayer * N, tSolid = tSolidLayer * nSolid, tInf = tInfLayer * nInfill, tTravel = tTravelLayer * N, heat = 180;
  const time = tWall + tSolid + tInf + tTravel + heat;
  // material and cost
  const mass = (V / 1000) * F.rho, Lfil = V / (Math.PI * 1.75 * 1.75 / 4) / 1000; // g, m of 1.75 mm filament
  const kWh = (p.power * time) / 3.6e6, costFil = (mass / 1000) * p.price, costEl = kWh * p.elec, cost = costFil + costEl;
  const Qreq = p.v * w * h, Qact = vi * w * h;
  const dims = p.shape === 'box' ? [p.W, p.D] : [p.W, p.W], foot = Math.max(...dims);
  const thinTube = p.shape === 'tube' && p.W / 2 - p.Di / 2 < 2 * w;
  const checks: Check[] = [
    { ok: h <= 0.75 * p.nozzle, label: 'Layer height at most 3/4 of the nozzle (layers bond well)', detail: `h = ${h.toFixed(2)} mm ≤ ${(0.75 * p.nozzle).toFixed(2)} mm` },
    { ok: p.walls >= 2, label: 'At least two wall loops (closed, watertight walls)', detail: `${p.walls} loops = ${t.toFixed(2)} mm` },
    { ok: Ai <= 0 || p.tb * h >= 0.6, label: 'Top and bottom skins at least 0.6 mm thick (close over the infill)', detail: `${p.tb} × ${h.toFixed(2)} = ${(p.tb * h).toFixed(2)} mm` },
    { ok: !limited, label: 'Requested speed within the hot end’s melt capacity and the filament’s limit', detail: `Q = v w h = ${Qreq.toFixed(1)} mm³/s, hot end ${p.Qmax.toFixed(0)} mm³/s${F.vmax > 0 ? `, ${F.name} ≤ ${F.vmax} mm/s` : ''}` },
    { ok: foot <= BED && p.H <= BED, label: 'Fits the build volume (256 mm cube)', detail: `${dims.map((d) => d.toFixed(0)).join(' × ')} × ${p.H.toFixed(0)} mm` },
    { ok: !F.warp || foot <= 100, label: 'Warping risk low (ABS, ASA and nylon parts over 100 mm need an enclosed printer)', detail: `${F.name}, largest footprint ${foot.toFixed(0)} mm` },
    { ok: !thinTube, label: 'Tube wall holds at least two lines', detail: `wall ${(p.W / 2 - p.Di / 2).toFixed(2)} mm, two lines ${(2 * w).toFixed(2)} mm` },
  ];
  return { F, w, N, nSolid, nInfill, A0, Ai, Awall, vVol, vi, vw, limited, Vwall, Vsolid, Vinf, V, Vpart, fill: V / Vpart, tWall, tSolid, tInf, tTravel, heat, time, mass, Lfil, kWh, costFil, costEl, cost, Qreq, Qact, spacingInf, lp, checks };
}
export type PrintResult = ReturnType<typeof print3d>;

export const PRINT_INTRO = 'A filament printer melts a plastic wire and lays it down as thin lines, one layer at a time. The slicer turns every layer into closed wall loops around the outline, solid skins at the bottom and top, and a sparse infill inside — so a part is mostly air, and its walls, not its infill, decide most of its strength. Print time depends less on the speed setting than one might think: every short line must speed up and slow down, and the hot end can only melt so many cubic millimetres per second.';

export const PRINT_NOTES = [
  'Slicer model: line width w = 1.125 × nozzle, n wall loops around the outline (tubes: inside and outside), n top and n bottom solid layers at 100 % and rectilinear infill with line spacing w/ρ in between. Extruded volume = printed area × layer height, filament 1.75 mm. Real slicers add first-layer, seam, bridge, ironing and support moves that are not included; the part is a straight prism.',
  'Time: walls at 70 % of the print speed, skins and infill at the print speed; every straight line takes L/v + v/a when it reaches the top speed, otherwise 2√(L/a) (trapezoidal motion, no junction speed); curved loops as one line. Speeds are capped by the hot end: v ≤ Q_max/(w h) (melt capacity, typically 10–15 mm³/s for a standard and 25–40 mm³/s for a high-flow hot end) and 30 mm/s for TPU. Per layer 1 s plus two travel moves at 200 mm/s for the layer change; 3 minutes of heating.',
  'Filament data are typical datasheet values (density, temperatures, XY tensile strength of printed bars); across the layers (Z) printed parts are usually only 50–80 % as strong. Cost = filament mass × price + average power × time × electricity price; printer wear and failed prints are not included.',
];
