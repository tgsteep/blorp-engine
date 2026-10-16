import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offAxisStrength, orientSweep, printStrength, printStrengthFull, PS_FILS, section, tsaiHill, winklerKi, type PsIn } from './printStrength.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);
const DEF: PsIn = { part: 'beam', fil: 'pla', orient: 'tilt', theta: 0, walls: 3, skins: 5, infill: 0.2, F: 200, L: 100, b: 20, h: 10, ri: 15 };

test('Tsai–Hill: along the lines X, across the layers Y, symmetric in θ', () => {
  const { X, Y, S } = PS_FILS.pla;
  near(offAxisStrength(0, X, Y, S), X, 1e-9);
  near(offAxisStrength(Math.PI / 2, X, Y, S), Y, 1e-9);
  near(offAxisStrength(0.4, X, Y, S), offAxisStrength(-0.4, X, Y, S), 1e-9);
  // hand value at 45°: 1/σ² = (¼ − ¼)/X² + ¼/Y² + ¼/S²
  near(offAxisStrength(Math.PI / 4, X, Y, S), 1 / Math.sqrt(0.25 / Y ** 2 + 0.25 / S ** 2), 1e-9);
  near(tsaiHill(X, 0, 0, X, Y, S), 1, 1e-12);
});

test('Solid tensile bar: failure load = strength × area; upright = across the layers', () => {
  const bar: PsIn = { ...DEF, part: 'bar', infill: 1 };
  const { X, Y } = PS_FILS.pla;
  near(printStrength({ ...bar, orient: 'tilt', theta: 0 }).Ff, X * 10 * 4, 1e-6, 'flat');
  near(printStrength({ ...bar, orient: 'side' }).Ff, X * 10 * 4, 1e-6, 'on edge');
  near(printStrength({ ...bar, orient: 'tilt', theta: 90 }).Ff, Y * 10 * 4, 1e-6, 'upright');
});

test('Composite section: solid when the shell fills it, infill core adds n = ρ²', () => {
  const s = section(20, 10, 1, 1, 0.5);
  near(s.I, (20 * 1000) / 12 - (18 * 8 ** 3) / 12 + (0.25 * 18 * 8 ** 3) / 12, 1e-9);
  near(s.Aeff, 200 - 144 + 0.25 * 144, 1e-9);
  assert.ok(section(4, 4, 3, 3, 0.2).solid);
  near(section(20, 10, 1, 1, 1).I, (20 * 1000) / 12, 1e-9, 'full infill = solid');
});

test('Solid beam on two supports: σ = 6M/(b h²) with M = F L/4 at the failure load (side orientation)', () => {
  const r = printStrength({ ...DEF, orient: 'side', infill: 1 });
  // failure when the outer fibre reaches X (shear is small here): F = 4 X b h²/(6 L)
  near(r.Ff, (4 * PS_FILS.pla.X * 20 * 100) / (6 * 100), 1, 'side solid');
});

test('Load scaling: failure load and safety factor do not depend on the load', () => {
  const a = printStrength(DEF), b = printStrength({ ...DEF, F: 1000 });
  near(a.Ff, b.Ff, 1e-9); near(a.SF * 200, b.SF * 1000, 1e-6);
});

test('Winkler factor of a curved rectangle (Shigley eq. 3-65): above 1, → 1 for a gentle curve', () => {
  // ri = h: hand value with rn = h/ln 2, e = 1.5h − rn
  const h = 10, ri = 10, rn = h / Math.log(2), e = 15 - rn, ki = ((rn - ri) / (h * e * ri)) / (6 / (h * h));
  near(winklerKi(ri, h), ki, 1e-12);
  near(winklerKi(10, 10), 1.3, 0.02, 'Shigley Table 3-4, rectangle R/c = 3.0: K_i = 1.30');
  near(winklerKi(1000, 10), 1, 0.01);
});

test('Orientation: the bracket is weakest printed standing as mounted (leg across the layers), strongest lying', () => {
  const br: PsIn = { ...DEF, part: 'bracket', L: 60, b: 20, h: 8 };
  const side = printStrength({ ...br, orient: 'side' }).Ff, stand = printStrength({ ...br, orient: 'tilt', theta: 0 }), tilt45 = printStrength({ ...br, orient: 'tilt', theta: 45 }).Ff;
  assert.ok(side > tilt45 && tilt45 > stand.Ff, `${side} ${tilt45} ${stand.Ff}`);
  assert.equal(stand.crit.m.key, 'leg'); assert.ok(stand.interlayer);
  const full = printStrengthFull({ ...br, orient: 'tilt', theta: 0 });
  assert.equal(full.best.orient, 'side'); assert.ok(!full.checks[1].ok);
});

test('Sweep is finite at every angle for every part', () => {
  for (const part of ['bar', 'beam', 'bracket', 'hook'] as const) for (const infill of [0, 0.15, 1]) {
    const sw = orientSweep({ ...DEF, part, infill }, 10);
    for (const x of [...sw.tilt.map((q) => q.Ff), sw.side]) assert.ok(Number.isFinite(x) && x > 0, `${part} ${infill}`);
  }
});
