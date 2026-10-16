import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineTime, loops, print3d, section, type PrintIn } from './print3d.ts';
import { cutoff, gaussianMean, nGrade, params, RaTheo, roughness, RzTheo, type RoughIn } from './roughness.ts';

const near = (a: number, b: number, tol: number, w = '') => assert.ok(Math.abs(a - b) <= tol, `${w}: ${a} vs ${b}`);
export const PRINT_DEF: PrintIn = { fil: 'pla', shape: 'box', W: 40, D: 40, Di: 20, H: 20, nozzle: 0.4, h: 0.2, walls: 2, tb: 4, infill: 0.15, v: 100, acc: 3000, Qmax: 15, price: 20, power: 120, elec: 0.15 };
export const ROUGH_DEF: RoughIn = { proc: 'turning', f: 0.2, r: 0.8, scatter: 0.3, runout: 5, z: 5, Rq: 0.4, beta: 0.01, wav: 1, spec: 3.2 };

test('3D printing by hand: trapezoidal line time, slicer volumes, filament mass', () => {
  // 100 mm at 100 mm/s, a = 1000: accelerate 0.1 s over 5 mm each end → 0.9 s cruise + 0.2 s = 1.1 s = L/v + v/a
  near(lineTime(100, 100, 1000), 1.1, 1e-12, 'trapezoid'); near(lineTime(5, 100, 1000), 2 * Math.sqrt(5 / 1000), 1e-12, 'triangle');
  const p = PRINT_DEF, r = print3d(p), w = 0.45;
  near(r.w, w, 1e-12, 'line width'); assert.equal(r.N, 100);
  near(section(p, 2 * w).A, (40 - 1.8) ** 2, 1e-9, 'core');
  const Awall = 1600 - 38.2 ** 2;
  near(r.Vwall, Awall * 0.2 * 100, 1e-6, 'walls'); near(r.Vsolid, 38.2 ** 2 * 0.2 * 8, 1e-6, 'skins'); near(r.Vinf, 38.2 ** 2 * 0.15 * 0.2 * 92, 1e-6, 'infill');
  near(r.mass, (r.V / 1000) * 1.24, 1e-9, 'mass'); near(r.Lfil, r.V / (Math.PI * 1.75 ** 2 / 4) / 1000, 1e-9, 'filament length');
  // loops: centrelines at w/2 and 3w/2 inside the outline
  const l = loops(p, 2, w); near(l[0].L, 4 * (40 - w), 1e-9, 'loop 1'); near(l[1].L, 4 * (40 - 3 * w), 1e-9, 'loop 2');
  assert.ok(r.checks.every((c) => c.ok), JSON.stringify(r.checks.filter((c) => !c.ok)));
  // hot end limit: 0.6 mm nozzle, 0.4 mm layers, 300 mm/s needs 81 mm³/s → capped at 15/(0.675·0.4)
  const q = print3d({ ...p, nozzle: 0.6, h: 0.4, v: 300 }); near(q.vi, 15 / (0.675 * 0.4), 1e-9, 'flow cap'); assert.equal(q.checks[3].ok, false);
  // faster setting gives diminishing returns, thinner layers take longer
  assert.ok(print3d({ ...p, v: 300 }).time > 0.5 * r.time, 'acceleration and flow limit the gain');
  assert.ok(print3d({ ...p, h: 0.1 }).time > 1.6 * r.time, 'thin layers');
  const t = print3d({ ...p, shape: 'tube', W: 40, Di: 30 }); assert.ok(t.Ai < t.A0 && t.lp.length === 4, 'tube: walls inside and outside');
});

test('roughness: ISO 4287 parameters of a sine and of turning cusps, Gaussian filter, cut-off and grades', () => {
  // sine of amplitude A: Ra = 2A/π, Rq = A/√2, Rz = 2A
  const n = 5000, dx = 4 / n, A = 2, s = Array.from({ length: n }, (_, i) => A * Math.sin((2 * Math.PI * i * dx) / 0.1));
  const ps = params(s, dx); near(ps.Ra, (2 * A) / Math.PI, 1e-3, 'Ra sine'); near(ps.Rq, A / Math.SQRT2, 1e-3, 'Rq sine'); near(ps.Rz, 2 * A, 1e-3, 'Rz sine'); near(ps.RSm, 0.1, 1e-3, 'RSm');
  near(ps.Rsk, 0, 1e-6, 'symmetric');
  // Gaussian filter: a wave at λc keeps 50 % in the mean line
  const lc = 0.8, m = Array.from({ length: 4000 }, (_, i) => Math.sin((2 * Math.PI * i * 0.002) / lc)), mean = gaussianMean(m, 0.002, lc);
  near(Math.max(...mean.slice(1000, 3000)), 0.5, 0.01, '50 % at the cut-off');
  // turning cusps without scatter: theoretical values
  const r = roughness({ ...ROUGH_DEF, scatter: 0, wav: 0 });
  near(r.Rz, RzTheo(0.2, 0.8), 0.02 * RzTheo(0.2, 0.8), 'Rz = f²/8r'); near(r.Ra, RaTheo(0.2, 0.8), 0.03 * RaTheo(0.2, 0.8), 'Ra = f²/(18√3 r)');
  near(RzTheo(0.2, 0.8), 6.25, 1e-9, 'Rz hand'); near(RaTheo(0.2, 0.8), 1.604, 0.001, 'Ra hand');
  assert.equal(r.lc, 0.8, 'RSm 0.2 mm → λc 0.8 mm'); near(r.RSm, 0.2, 0.005, 'RSm = feed');
  // waviness is removed by the filter
  const wv = roughness({ ...ROUGH_DEF, scatter: 0, wav: 20 }); near(wv.Ra, r.Ra, 0.05 * r.Ra, 'waviness filtered');
  assert.equal(cutoff(false, 0, 0.05), 0.25); assert.equal(cutoff(false, 0, 5), 2.5); assert.equal(nGrade(1.6), 'N7'); assert.equal(nGrade(0.7), 'N6');
  const g = roughness({ ...ROUGH_DEF, proc: 'grinding' }); near(g.Rq, 0.4, 0.15, 'grinding Rq'); assert.ok(g.Ra < g.Rq);
  const ml = roughness({ ...ROUGH_DEF, proc: 'milling', runout: 10 }); assert.ok(ml.Rz > r.Rz + 5, 'runout deepens one cusp per revolution');
});
