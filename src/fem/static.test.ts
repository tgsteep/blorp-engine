import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEM_MATS, femMat, isoOf, makeStaticJob, staticChecks, utilBands } from './static.ts';
import type { Decoded } from '../manufacturing/printLab.ts';
import type { Vox } from '../manufacturing/voxel.ts';

test('FEM materials: no brittle cast iron, S235 as the solver sees it', () => {
  assert.ok(FEM_MATS.every((m) => m.kind !== 'brittle'));
  assert.deepEqual(isoOf(femMat('s235')), { E: 210000, nu: 0.3, rho: 7.85, fy: 235, fu: 400 });
});

test('Static job: a pressure travels as F with the pressure flag, no orientation sweep', () => {
  const v: Vox = { nx: 2, ny: 1, nz: 1, h: 1, org: [0, 0, 0], solid: new Uint8Array([1, 1]) };
  const j = makeStaticJob(v, new Set([0]), new Set([1]), { mat: 'al6082', load: 'pressure', F: 500, p: 2.5, dir: '-Z', grav: 1, gdir: '-Y' });
  assert.equal(j.p.F, 2.5); assert.equal(j.p.load, 'pressure'); assert.equal(j.sweep, false);
  assert.deepEqual(j.p.gdir, [0, -1, 0]); assert.equal(j.p.iso?.fy, 260);
});

test('Utilisation bands sum to one; SF check against yield', () => {
  const d = { u: new Float32Array([0.05, 0.35, 0.95, 1.2]), umax: 0.5, converged: true, it: 20, res: 1e-6, maxDisp: 0.01, dropped: 0 } as unknown as Decoded;
  const b = utilBands(d);
  assert.equal(b.reduce((s, x) => s + x, 0), 1); assert.equal(b[10], 0.25); assert.equal(b[9], 0.25);
  const c = staticChecks({ nFixed: 3, nLoad: 0, grav: 1, d, error: null, size: 60, thin: 0, file: false, mat: femMat('s235') });
  assert.ok(c.find((x) => x.label.startsWith('Safety factor'))!.ok); // SF = 2
  assert.ok(c[0].ok); // own weight alone is a load
});
