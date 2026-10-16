/**
 * Circuit maker: parts placed between grid points, solved by nodal analysis (every part is a conductance G with an
 * internal source J: I_ab = G (V_a − V_b) − J). SI units.
 * - wire, closed switch, ammeter: 1 mΩ (wire loops and meters in series are no problem)
 * - battery / DC source: ideal V behind an internal resistance (Thevenin), + terminal at end a
 * - resistor: R; lamp: R = V_r²/P_r at the rated 12 V
 * - LED: off below its forward voltage V_f, on above it as V_f + R_d·I (state found by iteration)
 * - capacitor: open in DC; in the transient backward Euler (G = C/Δt, J = G·v_prev), uncharged at t = 0
 * - voltmeter: open; every node has a tiny conductance g_min to the reference so floating parts stay solvable
 */
export type Kind = 'wire' | 'source' | 'resistor' | 'lamp' | 'led' | 'switch' | 'cap' | 'ammeter' | 'voltmeter';
export type Pt = [number, number]; // grid column, row
export type Part = { id: number; kind: Kind; a: Pt; b: Pt; v: number; on?: boolean };
export type PartState = { id: number; V: number; I: number; P: number; lit?: number };
export type Check = { ok: boolean; label: string; detail: string };

export const R_WIRE = 1e-3, R_INT = 0.05, R_LED = 10, LAMP_V = 12, G_MIN = 1e-9;
export const LED_IMAX = 0.02, LED_VREV = 5, RES_PMAX = 0.25;
/** LED colours and their forward voltages [V]. */
export const LED_COLOURS: { id: string; vf: number; col: string }[] = [
  { id: 'red', vf: 1.8, col: '#E53935' }, { id: 'yellow', vf: 2.0, col: '#F9C80E' }, { id: 'green', vf: 2.2, col: '#2E9D4F' },
  { id: 'blue', vf: 3.0, col: '#2F6FE0' }, { id: 'white', vf: 3.1, col: '#C9D6EA' },
];
/** Default value of a new part: V, Ω, W (lamp rating at 12 V), V_f, F. */
export const DEFAULT_V: Record<Kind, number> = { wire: 0, source: 9, resistor: 1000, lamp: 5, led: 2.2, switch: 0, cap: 100e-6, ammeter: 0, voltmeter: 0 };

const key = (p: Pt) => `${p[0]},${p[1]}`;

/** Wires connect to every dot they pass over: split them at other parts' end points lying inside them. */
export function expand(parts: Part[]): Part[] {
  const ends = new Set<string>();
  for (const p of parts) { ends.add(key(p.a)); ends.add(key(p.b)); }
  const out: Part[] = [];
  for (const p of parts) {
    if (p.kind !== 'wire') { out.push(p); continue; }
    const [c0, r0] = p.a, [c1, r1] = p.b;
    const gcd = (x: number, y: number): number => (y ? gcd(y, x % y) : x);
    const n = Math.max(1, gcd(Math.abs(c1 - c0), Math.abs(r1 - r0))); // dots on the line, diagonals included
    let last: Pt = p.a;
    for (let k = 1; k <= n; k++) {
      const q: Pt = [c0 + Math.round(((c1 - c0) * k) / n), r0 + Math.round(((r1 - r0) * k) / n)];
      if (k === n || ends.has(key(q))) { out.push({ ...p, a: last, b: q }); last = q; }
    }
  }
  return out;
}
/** Is dot q on the straight segment a–b (ends included)? Returns its position 0…1 along it, or null. */
function along(a: Pt, b: Pt, q: Pt): number | null {
  const dx = b[0] - a[0], dy = b[1] - a[1], qx = q[0] - a[0], qy = q[1] - a[1];
  if (dx * qy - dy * qx !== 0) return null;
  const L2 = dx * dx + dy * dy, t = (qx * dx + qy * dy) / L2;
  return t >= 0 && t <= 1 ? t : null;
}
/**
 * Place a part: anything already between the same two dots is replaced, and a wire that runs over both dots of a
 * new component is cut there (the component goes into the wire instead of being bypassed by it).
 */
export function insertPart(parts: Part[], np: Part, nextId: () => number): Part[] {
  const same = (u: Pt, v: Pt) => u[0] === v[0] && u[1] === v[1];
  const out: Part[] = [];
  for (const p of parts) {
    if ((same(p.a, np.a) && same(p.b, np.b)) || (same(p.a, np.b) && same(p.b, np.a))) continue;
    if (np.kind !== 'wire' && p.kind === 'wire') {
      const ta = along(p.a, p.b, np.a), tb = along(p.a, p.b, np.b);
      if (ta !== null && tb !== null) {
        const [t1, t2] = ta < tb ? [ta, tb] : [tb, ta], [q1, q2] = ta < tb ? [np.a, np.b] : [np.b, np.a];
        if (t1 > 0) out.push({ ...p, b: q1 });
        if (t2 < 1) out.push({ ...p, id: t1 > 0 ? nextId() : p.id, a: q2 });
        continue;
      }
    }
    out.push(p);
  }
  return [...out, np];
}
export type Seg = { id: number; a: Pt; b: Pt; I: number };
/** Back from the expanded list: one state per part (first piece of a split wire) and every wire piece with its current. */
function collapse(parts: Part[], xp: Part[], st: PartState[]): { states: PartState[]; segs: Seg[] } {
  const states = parts.map((p) => st[xp.findIndex((q) => q.id === p.id)]);
  const segs: Seg[] = [];
  xp.forEach((q, i) => { if (q.kind === 'wire') segs.push({ id: q.id, a: q.a, b: q.b, I: st[i].I }); });
  return { states, segs };
}

type Net = { nodes: Map<string, number>; n: number; ref: number };
function net(parts: Part[]): Net {
  const nodes = new Map<string, number>();
  for (const p of parts) for (const q of [p.a, p.b]) if (!nodes.has(key(q))) nodes.set(key(q), nodes.size);
  const src = parts.find((p) => p.kind === 'source');
  return { nodes, n: nodes.size, ref: src ? nodes.get(key(src.b))! : 0 };
}

/** Branch model of a part: I_ab = G·V_ab − J. */
function branch(p: Part, o: { ledOn: Set<number>; dt?: number; vPrev?: Map<number, number> }): { G: number; J: number } {
  switch (p.kind) {
    case 'wire': case 'ammeter': return { G: 1 / R_WIRE, J: 0 };
    case 'switch': return p.on ? { G: 1 / R_WIRE, J: 0 } : { G: 0, J: 0 };
    case 'source': return { G: 1 / R_INT, J: p.v / R_INT };
    case 'resistor': return { G: 1 / p.v, J: 0 };
    case 'lamp': return { G: p.v / (LAMP_V * LAMP_V), J: 0 };
    case 'led': return o.ledOn.has(p.id) ? { G: 1 / R_LED, J: p.v / R_LED } : { G: 0, J: 0 };
    case 'cap': {
      if (!o.dt) return { G: 0, J: 0 };
      const G = p.v / o.dt;
      return { G, J: G * (o.vPrev?.get(p.id) ?? 0) };
    }
    default: return { G: 0, J: 0 };
  }
}

/** Gaussian elimination with partial pivoting; returns null if singular. */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-300) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}

type Solved = { V: number[]; states: PartState[]; ledOn: Set<number> };

/** One operating point (DC, or one transient step with dt and the previous capacitor voltages). */
function solveOnce(parts: Part[], nt: Net, o: { dt?: number; vPrev?: Map<number, number>; ledOn0?: Set<number> }): Solved {
  let ledOn = new Set(o.ledOn0 ?? []);
  let V: number[] = new Array(nt.n).fill(0);
  for (let it = 0; it < 30; it++) {
    const A = Array.from({ length: nt.n }, () => new Array(nt.n).fill(0)), rhs = new Array(nt.n).fill(0);
    for (let i = 0; i < nt.n; i++) A[i][i] += G_MIN;
    A[nt.ref][nt.ref] += 1; // reference node tied to 0 V
    for (const p of parts) {
      const { G, J } = branch(p, { ledOn, dt: o.dt, vPrev: o.vPrev });
      const a = nt.nodes.get(key(p.a))!, b = nt.nodes.get(key(p.b))!;
      if (a === b) continue;
      A[a][a] += G; A[b][b] += G; A[a][b] -= G; A[b][a] -= G;
      rhs[a] += J; rhs[b] -= J;
    }
    V = solveLinear(A, rhs) ?? new Array(nt.n).fill(0);
    // LED states: on ones must carry forward current, off ones must stay below V_f
    const next = new Set<number>();
    for (const p of parts) if (p.kind === 'led') {
      const vab = V[nt.nodes.get(key(p.a))!] - V[nt.nodes.get(key(p.b))!];
      if (ledOn.has(p.id) ? (vab - p.v) / R_LED > 0 : vab > p.v) next.add(p.id);
    }
    if (next.size === ledOn.size && [...next].every((x) => ledOn.has(x))) break;
    ledOn = next;
  }
  const states = parts.map((p) => {
    const a = nt.nodes.get(key(p.a))!, b = nt.nodes.get(key(p.b))!;
    const vab = V[a] - V[b];
    const { G, J } = branch(p, { ledOn, dt: o.dt, vPrev: o.vPrev });
    let I = G * vab - J; // a → b through the part
    if (Math.abs(I) < 1e-7) I = 0; // leakage through g_min (≈ 10⁻⁹ S per node) is not a real current
    if (p.kind === 'source') I = -I; // reported as the current delivered from + (a) into the circuit
    const P = p.kind === 'source' ? vab * I : vab * I;
    const st: PartState = { id: p.id, V: vab, I, P };
    if (p.kind === 'lamp') st.lit = Math.min(1.5, Math.abs(P) / p.v);
    if (p.kind === 'led') st.lit = ledOn.has(p.id) ? Math.min(1.5, I / LED_IMAX) : 0;
    return st;
  });
  return { V, states, ledOn };
}

export type DCResult = {
  nodeV: Map<string, number>; parts: PartState[]; segs: Seg[]; checks: Check[]; short: boolean; empty: boolean; hasCap: boolean;
};

/** Steady state (capacitors fully charged = open). */
export function solveDC(parts: Part[]): DCResult {
  if (!parts.length) return { nodeV: new Map(), parts: [], segs: [], checks: [{ ok: false, label: 'Circuit has a source', detail: 'place a battery and close the loop' }], short: false, empty: true, hasCap: false };
  const xp = expand(parts);
  const nt = net(xp);
  const s = solveOnce(xp, nt, {});
  const nodeV = new Map<string, number>();
  for (const [k, i] of nt.nodes) nodeV.set(k, s.V[i] - s.V[nt.ref]);
  const { states, segs } = collapse(parts, xp, s.states);
  return { nodeV, parts: states, segs, checks: checksFor(parts, states), short: isShort(parts, states), empty: false, hasCap: parts.some((p) => p.kind === 'cap') };
}

const isShort = (parts: Part[], st: PartState[]) => parts.some((p, i) => p.kind === 'source' && p.v > 0 && st[i].I > (0.5 * p.v) / R_INT);

export const fmtSI = (v: number, unit: string) => {
  const a = Math.abs(v);
  if (!Number.isFinite(v)) return '—';
  if (a === 0) return `0 ${unit}`;
  const pre: [number, string][] = [[1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n']];
  const [m, s] = pre.find(([m]) => a >= m * 0.9995) ?? pre[pre.length - 1];
  const x = v / m;
  return `${Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2)} ${s}${unit}`;
};

export const PART_NAME: Record<Kind, string> = {
  wire: 'Wire', source: 'Battery', resistor: 'Resistor', lamp: 'Lamp', led: 'LED', switch: 'Switch', cap: 'Capacitor', ammeter: 'Ammeter', voltmeter: 'Voltmeter',
};
export const PREFIX: Record<Kind, string> = { wire: 'W', source: 'B', resistor: 'R', lamp: 'L', led: 'D', switch: 'S', cap: 'C', ammeter: 'A', voltmeter: 'V' };
/** Short label like R2 (number = order among parts of the same kind). */
export function tagOf(parts: Part[], p: Part) {
  return `${PREFIX[p.kind]}${parts.filter((q) => q.kind === p.kind).indexOf(p) + 1}`;
}

/** Both ends of p joined by wires, closed switches or ammeters only. */
function wireBypass(parts: Part[], p: Part): boolean {
  const xp = expand(parts), adj = new Map<string, string[]>();
  const link = (u: string, v: string) => { adj.set(u, [...(adj.get(u) ?? []), v]); adj.set(v, [...(adj.get(v) ?? []), u]); };
  for (const q of xp) if (q.kind === 'wire' || q.kind === 'ammeter' || (q.kind === 'switch' && q.on)) link(key(q.a), key(q.b));
  const seen = new Set([key(p.a)]), stack = [key(p.a)];
  while (stack.length) { const u = stack.pop()!; if (u === key(p.b)) return true; for (const v of adj.get(u) ?? []) if (!seen.has(v)) { seen.add(v); stack.push(v); } }
  return false;
}

function checksFor(parts: Part[], st: PartState[]): Check[] {
  const out: Check[] = [];
  const srcs = parts.map((p, i) => [p, st[i]] as const).filter(([p]) => p.kind === 'source');
  out.push({ ok: srcs.length > 0, label: 'Circuit has a source', detail: srcs.length ? `${srcs.length} × battery` : 'place a battery' });
  if (!srcs.length) return out;
  const shorted = srcs.filter(([p, s]) => p.v > 0 && s.I > (0.5 * p.v) / R_INT);
  out.push({ ok: !shorted.length, label: 'No short circuit', detail: shorted.length ? `${tagOf(parts, shorted[0][0])} delivers ${fmtSI(shorted[0][1].I, 'A')}: a wire connects its terminals` : 'every source current is limited by a load' });
  const flowing = srcs.some(([, s]) => Math.abs(s.I) > 1e-6);
  const capOnly = !flowing && parts.some((p) => p.kind === 'cap');
  out.push({ ok: flowing || capOnly, label: 'Closed loop: current flows', detail: flowing ? `${fmtSI(srcs.reduce((a, [, s]) => a + Math.abs(s.I), 0), 'A')} from the source(s)` : capOnly ? 'only while the capacitor charges: a charged capacitor blocks DC' : 'no path from + back to −: close the loop or the switch' });
  parts.forEach((p, i) => {
    const s = st[i], tag = tagOf(parts, p);
    if (p.kind === 'resistor' && Math.abs(s.P) > 1e-4) out.push({ ok: Math.abs(s.P) <= RES_PMAX, label: `${tag} power ≤ 0.25 W`, detail: fmtSI(Math.abs(s.P), 'W') });
    if ((p.kind === 'led' || p.kind === 'lamp' || p.kind === 'resistor') && flowing && Math.abs(s.V) < 1e-4 && wireBypass(parts, p))
      out.push({ ok: false, label: `${tag} is bypassed`, detail: 'a wire connects both of its ends, so no current goes through it' });
    if (p.kind === 'led') {
      if (s.V < -LED_VREV) out.push({ ok: false, label: `${tag} reverse voltage ≤ 5 V`, detail: `${fmtSI(-s.V, 'V')} across a reversed LED` });
      else if (s.I > 1e-6) out.push({ ok: s.I <= LED_IMAX, label: `${tag} current ≤ 20 mA`, detail: s.I > LED_IMAX ? `${fmtSI(s.I, 'A')}: add a series resistor` : fmtSI(s.I, 'A') });
    }
    if (p.kind === 'lamp' && Math.abs(s.P) > 1e-4) out.push({ ok: Math.abs(s.P) <= 1.2 * p.v, label: `${tag} power ≤ 1.2 × rating`, detail: `${fmtSI(Math.abs(s.P), 'W')} of ${fmtSI(p.v, 'W')} rating` });
  });
  return out;
}

export type Transient = { t: number[]; frames: PartState[][]; segs: Seg[][]; vc: number[][]; tau: number; capIds: number[] };

/** Thevenin resistance seen by a capacitor: sources set to zero, 1 A injected at its terminals. */
function rThevenin(parts: Part[], nt: Net, cap: Part, ledOn: Set<number>): number {
  const A = Array.from({ length: nt.n }, () => new Array(nt.n).fill(0)), rhs = new Array(nt.n).fill(0);
  for (let i = 0; i < nt.n; i++) A[i][i] += G_MIN;
  A[nt.ref][nt.ref] += 1;
  for (const p of parts) {
    if (p.id === cap.id) continue;
    const { G } = branch(p, { ledOn });
    const a = nt.nodes.get(key(p.a))!, b = nt.nodes.get(key(p.b))!;
    if (a === b) continue;
    A[a][a] += G; A[b][b] += G; A[a][b] -= G; A[b][a] -= G;
  }
  const a = nt.nodes.get(key(cap.a))!, b = nt.nodes.get(key(cap.b))!;
  rhs[a] += 1; rhs[b] -= 1;
  const V = solveLinear(A, rhs);
  return V ? Math.abs(V[a] - V[b]) : Infinity;
}

/** Transient from t = 0 with all capacitors uncharged, over five of the largest time constants, nSteps steps. */
export function transient(parts: Part[], nSteps = 240): Transient | null {
  const caps = parts.filter((p) => p.kind === 'cap');
  if (!caps.length || !parts.some((p) => p.kind === 'source')) return null;
  const xp = expand(parts);
  const nt = net(xp);
  const dc = solveOnce(xp, nt, {});
  const tau = Math.max(...caps.map((c) => c.v * rThevenin(xp, nt, c, dc.ledOn)));
  const T = 5 * Math.min(Math.max(tau, 1e-6), 1e6);
  const dt = T / nSteps;
  let vPrev = new Map<number, number>(caps.map((c) => [c.id, 0]));
  let ledOn = new Set<number>();
  const t: number[] = [], frames: PartState[][] = [], segs: Seg[][] = [], vc: number[][] = caps.map(() => []);
  for (let k = 0; k <= nSteps; k++) {
    // k = 0: the instant after t = 0, capacitors still at 0 V (a capacitor acts as a 0 V source: very small dt)
    const s = solveOnce(xp, nt, { dt: k === 0 ? dt * 1e-6 : dt, vPrev, ledOn0: ledOn });
    ledOn = s.ledOn;
    const cs = collapse(parts, xp, s.states);
    t.push(k * dt); frames.push(cs.states); segs.push(cs.segs);
    const next = new Map<number, number>();
    caps.forEach((c, j) => { const st = cs.states[parts.indexOf(c)]; next.set(c.id, st.V); vc[j].push(st.V); });
    vPrev = next;
  }
  return { t, frames, segs, vc, tau, capIds: caps.map((c) => c.id) };
}

/** Ready-made circuits on the 8 × 8 grid (columns and rows 0…7). */
export const PRESETS: { id: string; name: string; parts: Omit<Part, 'id'>[] }[] = (() => {
  const w = (a: Pt, b: Pt): Omit<Part, 'id'> => ({ kind: 'wire', a, b, v: 0 });
  const P = (kind: Kind, a: Pt, b: Pt, v = DEFAULT_V[kind], on?: boolean): Omit<Part, 'id'> => ({ kind, a, b, v, ...(on !== undefined ? { on } : {}) });
  return [
    { id: 'divider', name: 'Voltage divider', parts: [P('source', [1, 1], [1, 6], 9), w([1, 1], [4, 1]), P('resistor', [4, 1], [4, 3], 1000), P('resistor', [4, 3], [4, 6], 2000), w([4, 6], [1, 6]), P('voltmeter', [4, 3], [6, 3]), w([6, 3], [6, 6]), w([6, 6], [4, 6])] },
    { id: 'led', name: 'LED with series resistor', parts: [P('source', [1, 1], [1, 6], 5), w([1, 1], [2, 1]), P('switch', [2, 1], [4, 1], 0, true), P('resistor', [4, 1], [6, 1], 180), P('led', [6, 1], [6, 6], 2.2), w([6, 6], [1, 6])] },
    { id: 'series', name: 'Two lamps in series', parts: [P('source', [1, 1], [1, 6], 12), w([1, 1], [3, 1]), P('lamp', [3, 1], [6, 1], 5), P('lamp', [6, 1], [6, 6], 5), P('ammeter', [6, 6], [3, 6]), w([3, 6], [1, 6])] },
    { id: 'parallel', name: 'Two lamps in parallel', parts: [P('source', [1, 1], [1, 6], 12), w([1, 1], [3, 1]), w([3, 1], [6, 1]), P('lamp', [3, 1], [3, 6], 5), P('lamp', [6, 1], [6, 6], 5), w([6, 6], [3, 6]), P('ammeter', [3, 6], [1, 6])] },
    { id: 'rc', name: 'RC charging', parts: [P('source', [1, 1], [1, 6], 9), P('switch', [1, 1], [3, 1], 0, true), P('resistor', [3, 1], [5, 1], 10000), P('cap', [5, 1], [5, 6], 470e-6), w([5, 6], [1, 6]), w([5, 1], [7, 1]), P('voltmeter', [7, 1], [7, 6]), w([7, 6], [5, 6])] },
    { id: 'bridge', name: 'Wheatstone bridge', parts: [P('source', [0, 1], [0, 7], 10), w([0, 1], [6, 1]), P('resistor', [3, 1], [3, 4], 1000), P('resistor', [3, 4], [3, 7], 1000), P('resistor', [6, 1], [6, 4], 2200), P('resistor', [6, 4], [6, 7], 2200), P('ammeter', [3, 4], [6, 4]), w([0, 7], [6, 7])] },
  ];
})();

export const BUILDER_INTRO = 'Build a circuit on the grid: pick a part, then tap two dots. Tap a part to select it, change its value, flip or delete it; tap a switch to toggle it. Probe: tap two dots to read the voltage between them. Orange dots show the current. With a capacitor the circuit starts uncharged at t = 0 and the view plays the charging.';

export const BUILDER_NOTES = [
  'Nodal analysis: every part is a conductance with an internal source, I_ab = G·(V_a − V_b) − J, and Kirchhoff’s current law at every dot gives G·V = J. The reference (0 V) is the − terminal of the first battery. Wires, closed switches and ammeters are 1 mΩ; a battery is an ideal source behind 0.05 Ω; a voltmeter draws no current; every node has 10⁻⁹ S to the reference so loose parts stay solvable (they read 0 V). Wires that only cross do not connect (schematic rule); a wire that ends on another wire connects to it there. A part placed on a wire cuts the wire, so the part is in the path instead of being bypassed.',
  'Lamp: a fixed resistance R = V_r²/P_r for the rating at 12 V (a real filament has a much lower cold resistance). LED: off below the forward voltage V_f (red 1.8, yellow 2.0, green 2.2, blue 3.0, white 3.1 V), on above it as V_f + 10 Ω·I; maximum 20 mA, reverse voltage 5 V. Resistors are checked against a 0.25 W rating.',
  'Capacitors are open in the steady state. The transient starts with every capacitor uncharged at t = 0 and steps the circuit with backward Euler (I = C·(v − v_prev)/Δt) over five of the largest time constants τ = C·R_Th, 240 steps. No inductors, no AC, no component tolerances or temperature effects.',
];
