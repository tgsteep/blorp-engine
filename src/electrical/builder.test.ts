import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, R_INT, R_LED, R_WIRE, expand, insertPart, solveDC, transient, type Kind, type Part, type Pt } from './builder.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const preset = (id: string): Part[] => PRESETS.find((p) => p.id === id)!.parts.map((p, i) => ({ ...p, id: i + 1 }));
const byKind = (parts: Part[], kind: Part['kind']) => parts.map((p, i) => [p, i] as const).filter(([p]) => p.kind === kind).map(([, i]) => i);

test('voltage divider 9 V, 1 kΩ / 2 kΩ: middle node 6 V, current 3 mA (internal 0.05 Ω and wires change it by < 0.01 %)', () => {
  const parts = preset('divider');
  const r = solveDC(parts);
  near(r.nodeV.get('4,3')!, 9 * 2000 / (3000 + R_INT + 3 * R_WIRE), 1e-6);
  near(r.nodeV.get('4,3')!, 6, 1e-3);
  const [r1] = byKind(parts, 'resistor');
  near(r.parts[r1].I, 3e-3, 1e-6);
  const [vm] = byKind(parts, 'voltmeter');
  near(r.parts[vm].V, 6, 1e-3, 'voltmeter reads the node voltage');
  assert.ok(r.checks.every((c) => c.ok));
});

test('green LED with 180 Ω on 5 V: I = (5 − 2.2)/(180 + 10) = 14.7 mA; reversed LED blocks; without resistor it exceeds 20 mA', () => {
  const parts = preset('led');
  const [d] = byKind(parts, 'led');
  near(solveDC(parts).parts[d].I, (5 - 2.2) / (180 + R_LED + R_INT + 3 * R_WIRE), 1e-6);
  const rev = parts.map((p) => (p.kind === 'led' ? { ...p, a: p.b, b: p.a } : p));
  near(solveDC(rev).parts[d].I, 0, 1e-6);
  const noR = parts.map((p) => (p.kind === 'resistor' ? { ...p, v: 1 } : p));
  assert.equal(solveDC(noR).checks.find((c) => c.label.startsWith('D1 current'))!.ok, false);
});

test('two 12 V / 5 W lamps: in series each gets 6 V (1/4 power), in parallel each gets the full 12 V (minus 0.05 Ω × 0.83 A) and its rated 5 W', () => {
  const s = solveDC(preset('series')), p = solveDC(preset('parallel'));
  const ls = byKind(preset('series'), 'lamp'), lp = byKind(preset('parallel'), 'lamp');
  near(s.parts[ls[0]].V, 6, 0.01); near(s.parts[ls[0]].lit!, 0.25, 0.01);
  near(p.parts[lp[0]].V, 12 - R_INT * 10 / 12, 0.01); near(p.parts[lp[1]].lit!, 1, 0.01);
  const [am] = byKind(preset('parallel'), 'ammeter');
  near(p.parts[am].I, 2 * 5 / 12, 0.01, 'ammeter carries both lamp currents');
});

test('balanced Wheatstone bridge (1k/1k = 2.2k/2.2k): no current through the meter; unbalanced: current flows', () => {
  const parts = preset('bridge');
  const [am] = byKind(parts, 'ammeter');
  near(solveDC(parts).parts[am].I, 0, 1e-7); // only the 1 mΩ wires unbalance it
  const un = parts.map((p, i) => (i === byKind(parts, 'resistor')[0] ? { ...p, v: 1500 } : p));
  assert.ok(Math.abs(solveDC(un).parts[am].I) > 1e-4);
});

test('short circuit: a wire across the battery is detected; an open switch stops the current', () => {
  const parts = preset('led');
  const sh = [...parts, { id: 99, kind: 'wire' as const, a: [1, 1] as [number, number], b: [1, 6] as [number, number], v: 0 }];
  const r = solveDC(sh);
  assert.equal(r.short, true);
  assert.equal(r.checks.find((c) => c.label === 'No short circuit')!.ok, false);
  const open = parts.map((p) => (p.kind === 'switch' ? { ...p, on: false } : p));
  assert.equal(solveDC(open).checks.find((c) => c.label === 'Closed loop: current flows')!.ok, false);
});

test('a wire passing over a part end connects to it (split at the dot)', () => {
  const parts: Part[] = [
    { id: 1, kind: 'source', a: [0, 0], b: [0, 4], v: 10 },
    { id: 2, kind: 'wire', a: [0, 0], b: [4, 0], v: 0 },
    { id: 3, kind: 'resistor', a: [2, 0], b: [2, 4], v: 100 }, // starts in the middle of wire 2
    { id: 4, kind: 'wire', a: [0, 4], b: [2, 4], v: 0 },
  ];
  assert.equal(expand(parts).length, 5);
  near(solveDC(parts).parts[2].I, 10 / (100 + R_INT + 2 * R_WIRE), 1e-6);
});

test('RC charging 9 V, 10 kΩ, 470 µF: τ = 4.7 s, v_C(τ) = 63.2 % of 9 V (backward Euler within 1.5 %), v_C(5τ) ≈ 9 V', () => {
  const tr = transient(preset('rc'))!;
  near(tr.tau, 4.7, 0.01);
  const k = tr.t.findIndex((t) => t >= tr.tau);
  near(tr.vc[0][k] / 9, 1 - Math.exp(-tr.t[k] / 4.7), 0.015);
  near(tr.vc[0][tr.vc[0].length - 1], 9 * (1 - Math.exp(-5)), 0.15);
  near(tr.vc[0][0], 0, 1e-3, 'uncharged at t = 0');
});

test('a diagonal wire connects only at the dots it passes through', () => {
  const parts: Part[] = [
    { id: 1, kind: 'source', a: [0, 0], b: [0, 4], v: 10 },
    { id: 2, kind: 'wire', a: [0, 0], b: [4, 4], v: 0 }, // passes over (2, 2)
    { id: 3, kind: 'resistor', a: [2, 2], b: [2, 4], v: 100 },
    { id: 4, kind: 'wire', a: [0, 4], b: [2, 4], v: 0 },
  ];
  assert.equal(expand(parts).length, 5);
  near(solveDC(parts).parts[2].I, 10 / (100 + R_INT + 2 * R_WIRE), 1e-6);
});

// ---------------- connection cases ----------------
let uid = 100;
const mk = (kind: Kind, a: Pt, b: Pt, v = 0, on?: boolean): Part => ({ id: uid++, kind, a, b, v, ...(on !== undefined ? { on } : {}) });
const W = (a: Pt, b: Pt) => mk('wire', a, b);
/** Loop: battery (+ at top-left) → part from (3,0) to (5,0) → back along the bottom. */
const loop = (part: Part, E = 5, extra: Part[] = []) => [mk('source', [0, 0], [0, 4], E), W([0, 0], [3, 0]), part, W([5, 0], [5, 4]), W([5, 4], [0, 4]), ...extra];
const I = (parts: Part[], p: Part) => solveDC(parts).parts[parts.indexOf(p)].I;
const failing = (parts: Part[]) => solveDC(parts).checks.filter((c) => !c.ok).map((c) => c.label);

test('LED orientation: forward conducts and lights, reversed blocks (at 5 V and at 30 V with the reverse-voltage check)', () => {
  const r = mk('resistor', [3, 0], [4, 0], 220), fwd = mk('led', [4, 0], [5, 0], 2.2), rev = mk('led', [5, 0], [4, 0], 2.2);
  const base = [mk('source', [0, 0], [0, 4], 5), W([0, 0], [3, 0]), r, W([5, 0], [5, 4]), W([5, 4], [0, 4])];
  const pf = [...base, fwd], pr = [...base, rev];
  near(I(pf, fwd), (5 - 2.2) / (220 + R_LED + R_INT + 3 * R_WIRE), 1e-6);
  assert.ok(solveDC(pf).parts[pf.indexOf(fwd)].lit! > 0.5);
  near(I(pr, rev), 0, 1e-9);
  assert.equal(solveDC(pr).parts[pr.indexOf(rev)].lit, 0);
  assert.ok(failing(pr).includes('Closed loop: current flows'));
  const hv = pr.map((p) => (p.kind === 'source' ? { ...p, v: 30 } : p));
  assert.ok(failing(hv).some((l) => l.includes('reverse voltage')));
  // battery turned round: the forward LED now blocks
  const flipB = pf.map((p) => (p.kind === 'source' ? { ...p, a: p.b, b: p.a } : p));
  near(I(flipB, fwd), 0, 1e-9);
});

test('anti-parallel LEDs: only the forward one conducts; LED below its forward voltage stays off', () => {
  const r = mk('resistor', [3, 0], [4, 0], 220), d1 = mk('led', [4, 0], [5, 0], 2.2), d2 = mk('led', [5, 0], [4, 0], 2.2);
  const parts = [mk('source', [0, 0], [0, 4], 5), W([0, 0], [3, 0]), r, d1, d2, W([5, 0], [5, 4]), W([5, 4], [0, 4])];
  const s = solveDC(parts);
  assert.ok(s.parts[parts.indexOf(d1)].I > 0.01); near(s.parts[parts.indexOf(d2)].I, 0, 1e-9);
  const low = parts.map((p) => (p.kind === 'source' ? { ...p, v: 2 } : p));
  near(solveDC(low).parts[low.indexOf(d1)].I, 0, 1e-9);
});

test('placing a part on a wire cuts the wire (no bypass); a part left bypassed by a wire is reported', () => {
  const base = [mk('source', [0, 0], [0, 4], 5), mk('resistor', [0, 0], [3, 0], 220), W([3, 0], [6, 0]), W([6, 0], [6, 4]), W([6, 4], [0, 4])];
  let id = 500;
  const led = mk('led', [4, 0], [5, 0], 2.2), placed = insertPart(base, led, () => id++);
  assert.equal(placed.filter((p) => p.kind === 'wire').length, 4, 'the top wire is split in two around the LED');
  assert.ok(I(placed, led) > 0.01, 'current goes through the LED');
  const placedRev = insertPart(base, mk('led', [5, 0], [4, 0], 2.2), () => id++);
  assert.ok(failing(placedRev).includes('Closed loop: current flows'), 'reversed LED in the wire blocks the loop');
  const bypassed = [...base, led]; // put on top of the wire without cutting
  near(I(bypassed, led), 0, 1e-6);
  assert.ok(failing(bypassed).some((l) => l.includes('is bypassed')));
  // same two dots: the new part replaces the old one
  const rep = insertPart(placed, mk('resistor', [4, 0], [5, 0], 100), () => id++);
  assert.equal(rep.filter((p) => p.kind === 'led').length, 0);
});

test('batteries: in series aiding the voltages add, opposing they cancel; meters: ammeter in series reads the loop current, voltmeter in series blocks it', () => {
  const R = mk('resistor', [3, 0], [5, 0], 1000);
  const aid = [mk('source', [0, 0], [0, 2], 4.5), mk('source', [0, 2], [0, 4], 4.5), W([0, 0], [3, 0]), R, W([5, 0], [5, 4]), W([5, 4], [0, 4])];
  near(I(aid, R), 9 / (1000 + 2 * R_INT + 3 * R_WIRE), 1e-6);
  const opp = aid.map((p, i) => (i === 1 ? { ...p, a: p.b, b: p.a } : p));
  near(I(opp, R), 0, 1e-9);
  const am = mk('ammeter', [3, 0], [4, 0]), R2 = mk('resistor', [4, 0], [5, 0], 1000);
  const withA = [mk('source', [0, 0], [0, 4], 9), W([0, 0], [3, 0]), am, R2, W([5, 0], [5, 4]), W([5, 4], [0, 4])];
  near(I(withA, am), 9 / (1000 + R_INT + 4 * R_WIRE), 1e-6);
  const vmSeries = withA.map((p) => (p.kind === 'ammeter' ? { ...p, kind: 'voltmeter' as const } : p));
  near(I(vmSeries, R2), 0, 1e-6);
  near(solveDC(vmSeries).parts[1 + 1].V, 9, 1e-3, 'the voltmeter in series reads the full battery voltage');
  // ammeter straight across the battery is a short circuit
  assert.ok(failing([mk('source', [0, 0], [0, 4], 9), mk('ammeter', [0, 0], [0, 4])]).includes('No short circuit'));
});

test('lamp, open switch, capacitor in series (DC blocked, transient charges), crossing and tee wires', () => {
  const lamp = mk('lamp', [3, 0], [5, 0], 5);
  near(solveDC(loop(lamp, 12)).parts[2].P, 5 * (12 * 12 / 144) * Math.pow(144 / 5 / (144 / 5 + R_INT + 3 * R_WIRE), 2), 1e-3);
  const sw = mk('switch', [3, 0], [5, 0], 0, false);
  assert.ok(failing(loop(sw)).includes('Closed loop: current flows'));
  const cap = mk('cap', [3, 0], [4, 0], 100e-6), r = mk('resistor', [4, 0], [5, 0], 1000);
  const rc = [mk('source', [0, 0], [0, 4], 9), W([0, 0], [3, 0]), cap, r, W([5, 0], [5, 4]), W([5, 4], [0, 4])];
  near(I(rc, r), 0, 1e-6);
  const tr = transient(rc)!;
  assert.ok(tr && tr.frames[1][rc.indexOf(r)].I > 1e-3, 'current flows while the capacitor charges');
  // schematic rule: wires that only cross do not connect; a wire ending on another wire's dot does (it is split there)
  const crossing = [W([0, 2], [4, 2]), W([2, 0], [2, 4])];
  assert.equal(expand(crossing).length, 2);
  const tee = [W([0, 2], [4, 2]), W([2, 0], [2, 2])];
  assert.equal(expand(tee).length, 3);
  const between = [W([0, 0], [1, 1]), W([0, 1], [1, 0])];
  assert.equal(expand(between).length, 2);
});
