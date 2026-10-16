import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bounds, extrude, meshCheck, parseSTL, sample, volume, writeSTL } from './stl.ts';
import { surfaceVoxels, voxCenter, voxelize, vIdx, type Vox } from './voxel.ts';
import { bedFrame, brickK, buildModel, buildVec, evaluate, isoStiffness, lineBond, lineDir, plyStiffness, solveCG, solveMG, stiffness, strains, type LabIn } from './voxfem.ts';
import { PS_FILS } from './printStrength.ts';
import * as nodeModule from 'node:module';
import { readFileSync } from 'node:fs';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);
const run = <T>(g: Generator<unknown, T, unknown>) => { let r = g.next(); while (!r.done) r = g.next(); return r.value; };

test('STL: binary round trip, volume and bounds of an extruded rectangle', () => {
  const m = extrude([[0, 0], [30, 0], [30, 10], [0, 10]], 8);
  const back = parseSTL(writeSTL(m));
  assert.equal(back.pos.length, m.pos.length);
  near(volume(back), 30 * 10 * 8, 1e-6);
  assert.deepEqual(bounds(back).size.map((x) => +x.toFixed(6)), [30, 8, 10]);
  const ascii = `solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n`;
  assert.equal(parseSTL(new TextEncoder().encode(ascii).buffer as ArrayBuffer).pos.length, 9);
});

test('Samples are closed: the filled volume of the cubes matches the mesh volume', () => {
  for (const id of ['bracket', 'hook', 'bar'] as const) for (const target of [4000, 20000]) {
    const m = sample(id), v = voxelize(m, target);
    let all = 0, used = 0; for (let i = 0; i < v.solid.length; i++) { all += v.fill![i] / 255; if (v.solid[i]) used += v.fill![i] / 255; }
    near((all * v.h ** 3) / volume(m), 1, 0.02, `${id} all cubes`); near((used * v.h ** 3) / volume(m), 1, 0.03, `${id} cubes in the model`);
  }
});

test('Voxels of a box: every centre inside is solid', () => {
  const v = voxelize(extrude([[0, 0], [20, 0], [20, 10], [0, 10]], 10), 0, 1);
  assert.equal(v.solid.reduce((s, x) => s + x, 0), 2000);
  assert.ok(v.fill!.every((f, i) => (v.solid[i] ? f === 255 : f === 0)), 'cubes of a grid-aligned box are full or empty');
  assert.equal(surfaceVoxels(v).length, 2000 - 18 * 8 * 8);
});

test('Material: equal moduli give the isotropic stiffness whatever the build direction', () => {
  const E = 3000, nu = 0.35, lam = (E * nu) / ((1 + nu) * (1 - 2 * nu)), G = E / (2 * (1 + nu));
  for (const b of [buildVec(0, 0), buildVec(37, 120), buildVec(90, 45)]) {
    const C = stiffness(E, E, b);
    near(C[0][0], lam + 2 * G, 1e-6); near(C[0][1], lam, 1e-6); near(C[5][5], G, 1e-6); near(C[3][4], 0, 1e-6);
  }
});

test('Ply stiffness: E_L along the line, E_T across it, whatever the line direction', () => {
  for (const l of [[1, 0, 0], [0, 0, 1], [0.6, 0.8, 0]] as [number, number, number][]) {
    const C = plyStiffness(3200, 2900, l), S = (() => { // compliance along l and across: invert C for a pull along a unit vector
      const pull = (d: number[]) => { // strain along d for unit stress along d: solve C ε = σ by Gauss elimination
        const s = [d[0] * d[0], d[1] * d[1], d[2] * d[2], d[1] * d[2], d[0] * d[2], d[0] * d[1]], A = C.map((r, i) => [...r, s[i]]);
        for (let c = 0; c < 6; c++) { let pv = c; for (let r = c + 1; r < 6; r++) if (Math.abs(A[r][c]) > Math.abs(A[pv][c])) pv = r; [A[c], A[pv]] = [A[pv], A[c]]; for (let r = 0; r < 6; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let j = c; j < 7; j++) A[r][j] -= f * A[c][j]; } }
        const e = A.map((r, i) => r[6] / r[i]); return e[0] * d[0] * d[0] + e[1] * d[1] * d[1] + e[2] * d[2] * d[2] + e[3] * d[1] * d[2] + e[4] * d[0] * d[2] + e[5] * d[0] * d[1];
      };
      const t = Math.abs(l[2]) < 0.9 ? [-l[1], l[0], 0] : [1, 0, 0], tn = Math.hypot(...t);
      return { L: 1 / pull(l), T: 1 / pull(t.map((x) => x / tn)) };
    })();
    near(S.L, 3200, 1, 'E along the line'); near(S.T, 2900, 1, 'E across the line');
  }
});

test('Brick: rigid-body motion gives no force (incompatible modes condensed)', () => {
  const K = brickK(stiffness(3000, 2500, buildVec(30, 20)), 2), u = new Float64Array(24);
  for (let n = 0; n < 8; n++) { u[3 * n] = 1; u[3 * n + 1] = -2; u[3 * n + 2] = 0.5; }
  for (let i = 0; i < 24; i++) { let s = 0; for (let j = 0; j < 24; j++) s += K[24 * i + j] * u[j]; near(s, 0, 1e-8); }
});

/** A voxel bar along x: 40 × 4 × 6 cubes of 1 mm, clamped at the first slice, loaded at the last. Printed with the
 *  layers normal to y and every line along x (α = 0 on the bed, walls along the outline), so it is E1 along its length. */
function barModel(dirZ: boolean) {
  const nx = 40, ny = 4, nz = 6, v: Vox = { nx, ny, nz, h: 1, org: [0, 0, 0], solid: new Uint8Array(nx * ny * nz).fill(1) };
  const fixed = new Set<number>(), load = new Set<number>();
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) { fixed.add(vIdx(v, 0, j, k)); load.add(vIdx(v, nx - 1, j, k)); }
  const p: LabIn = { fil: 'pla', theta: 90, phi: 90, walls: 3, skins: 5, infill: 1, F: 100, dir: dirZ ? [0, 0, -1] : [1, 0, 0], lines: 'one', alpha: 0 };
  return { v, md: buildModel(v, { fixed, load }, p) };
}

test('Voxel bar in tension: σ = F/A in the middle', () => {
  const { md } = barModel(false), sol = run(solveCG(md, 1e-8)), eps = strains(md, sol.u), r = evaluate(md, eps, md.b);
  for (const e of [md.elemOf[vIdx(md.v, 20, 1, 2)], md.elemOf[vIdx(md.v, 20, 0, 5)]]) near(r.sg[6 * e], 100 / 24, 0.01 * 100 / 24, 'σxx');
});

test('VALIDATION-style check against beam theory: cantilever bending stress and tip deflection', () => {
  const { md, v } = barModel(true), sol = run(solveCG(md, 1e-9)), eps = strains(md, sol.u), r = evaluate(md, eps, md.b);
  assert.ok(sol.converged);
  // load centroid: the load nodes lie on the end face and the outer faces of the last slice (x 39…40); clamp at x = 1
  const xs = [] as number[]; for (let d = 0; d < md.ndof; d += 3) if (md.f[d + 2]) xs.push(d);
  // bending stress at x = 20.5 (column i = 20): extrapolated to the top surface
  const top = md.elemOf[vIdx(v, 20, 1, 5)], below = md.elemOf[vIdx(v, 20, 1, 4)], sTop = 1.5 * r.sg[6 * top] - 0.5 * r.sg[6 * below];
  const I = (4 * 6 ** 3) / 12, xLoad = 39.75, M = 100 * (xLoad - 20.5);
  near(Math.abs(sTop), (M * 3) / I, 0.05 * (M * 3) / I, 'σ at the surface');
  // tip deflection: Euler–Bernoulli + Timoshenko shear, length from the clamp face (x = 1) to the load centroid
  const E = PS_FILS.pla.E1, G = E / 2.7, L = xLoad - 1, A = 24, w = (100 * L ** 3) / (3 * E * I) + (100 * L) / ((5 / 6) * G * A);
  let tip = 0, c = 0; md.elems.forEach((id, e) => { if (id % v.nx === v.nx - 1) { for (let m = 0; m < 8; m++) if (m & 1) { tip += sol.u[md.edof[24 * e + 3 * m + 2]]; c++; } } });
  near(-tip / c, w, 0.06 * w, 'tip deflection');
});

test('Inclined steel cantilever (cubes cut by its faces): tip deflection and root stress within 11 % of beam theory', () => {
  // 60 × 6 mm profile at 30° in the x–z plane, 6 mm wide; clamped at one end, 100 N across it at the other
  const ST = { E: 210000, nu: 0.3, rho: 7.85, fy: 235, fu: 360 }, L = 60, H = 6, a = Math.PI / 6, e = [Math.cos(a), Math.sin(a)], nn = [-Math.sin(a), Math.cos(a)];
  const P = (s: number, t: number): [number, number] => [s * e[0] + t * nn[0], s * e[1] + t * nn[1]];
  const m = extrude([P(0, 0), P(L, 0), P(L, H), P(0, H)], 6), along = (c: number[]) => c[0] * e[0] + c[2] * e[1];
  for (const target of [4000, 10000]) {
    const v = voxelize(m, target), fixed = new Set<number>(), load = new Set<number>();
    for (const id of surfaceVoxels(v)) { const c = voxCenter(v, id), s = along(c); if (s < 0.75 * v.h) fixed.add(id); if (s > L - 0.75 * v.h) load.add(id); }
    // the load acts across the bar: −n in the x–z plane
    const md = buildModel(v, { fixed, load }, { fil: 'pla', theta: 0, phi: 0, walls: 1, skins: 1, infill: 1, F: 100, dir: [-nn[0], 0, -nn[1]], iso: ST });
    const sol = run(solveMG(md)), r = evaluate(md, strains(md, sol.u), md.b);
    assert.ok(sol.converged);
    const I = (6 * H ** 3) / 12, Le = L - 0.5 * v.h, w = (100 * Le ** 3) / (3 * ST.E * I) + (100 * Le) / ((5 / 6) * (ST.E / 2.6) * 6 * H);
    let tip = 0; md.elems.forEach((id, el) => { if (along(voxCenter(v, id)) > L - v.h) for (let k = 0; k < 8; k++) { const d = md.edof[24 * el + 3 * k]; tip = Math.max(tip, -(sol.u[d] * nn[0] + sol.u[d + 2] * nn[1])); } });
    near(tip / w, 1, 0.11, `tip deflection, ${target} cubes`);
    const sc = along(voxCenter(v, md.elems[r.crit])), sTh = (100 * (L - sc) * (H / 2)) / I;
    near((r.umax * ST.fy) / sTh, 1, 0.11, `bending stress at the critical point, ${target} cubes`);
  }
});

test('Print direction: the same cantilever is weaker when the layers stack along its length', () => {
  const { md } = barModel(true), sol = run(solveCG(md, 1e-8)), eps = strains(md, sol.u);
  const along = evaluate(md, eps, buildVec(90, 90)), across = evaluate(md, eps, buildVec(90, 0));
  assert.ok(across.umax > along.umax * 1.3, `${across.umax} ${along.umax}`);
  assert.ok(across.interlayer && !along.interlayer);
});

test('Bed frame: printer X, Y and the build direction are orthonormal and right-handed; z up keeps the file axes', () => {
  for (const b of [buildVec(0, 0), buildVec(37, 120), buildVec(90, 0), buildVec(90, 90), buildVec(180, 0), buildVec(150, 300)]) {
    const { ex, ey } = bedFrame(b), dot = (a: number[], c: number[]) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
    near(dot(ex, ex), 1, 1e-12); near(dot(ey, ey), 1, 1e-12); near(dot(ex, ey), 0, 1e-12); near(dot(ex, b), 0, 1e-12); near(dot(ey, b), 0, 1e-12);
    const z = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
    for (let k = 0; k < 3; k++) near(z[k], b[k], 1e-12, 'X × Y = b');
  }
  const f0 = bedFrame([0, 0, 1]); [1, 0, 0, 0, 1, 0].forEach((x, i) => near(i < 3 ? f0.ex[i] : f0.ey[i - 3], x, 1e-12, 'z up'));
  const l = lineDir([0, 0, 1], 90); near(l[0], 0, 1e-12); near(l[1], 1, 1e-12);
});

test('Lines in one direction: pulled along the lines a bar fails at X, across them at the bond between lines', () => {
  // b = y: the printer's X axis is the file's x (α = 0 → lines along the bar), α = 90 → lines along −z
  const nx = 40, ny = 4, nz = 6, v: Vox = { nx, ny, nz, h: 1, org: [0, 0, 0], solid: new Uint8Array(nx * ny * nz).fill(1) };
  const fixed = new Set<number>(), load = new Set<number>();
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) { fixed.add(vIdx(v, 0, j, k)); load.add(vIdx(v, nx - 1, j, k)); }
  const p: LabIn = { fil: 'pla', theta: 90, phi: 90, walls: 1, skins: 1, infill: 1, F: 100, dir: [1, 0, 0], lines: 'one', alpha: 0 }, M = PS_FILS.pla, { Yl } = lineBond(M.X, M.Y, M.S);
  const a = buildModel(v, { fixed, load }, p), ra = evaluate(a, strains(a, run(solveCG(a, 1e-9)).u), a.b), e = a.elemOf[vIdx(v, 20, 1, 2)];
  near(ra.sg[6 * e], 100 / 24, 0.01 * 100 / 24, 'uniform E1: σ = F/A'); near(ra.raw[e], 100 / 24 / M.X, 0.02 * 100 / 24 / M.X, 'along the lines: σ/X'); assert.equal(ra.inter[e], 0);
  // lines across the bar (inside); the walls on the ±z faces still run along it, so they carry more of the load
  const c = buildModel(v, { fixed, load }, { ...p, alpha: 90 }), rc = evaluate(c, strains(c, run(solveCG(c, 1e-9)).u), c.b), ec = c.elemOf[vIdx(v, 20, 1, 2)];
  assert.ok(rc.sg[6 * ec] < 0.995 * ra.sg[6 * e], 'the inside, softer across its lines (E2 < E1), carries a little less than the walls');
  near(rc.raw[ec], rc.sg[6 * ec] / Yl, 0.03 * rc.sg[6 * ec] / Yl, 'across the lines: σ/Y_l'); assert.equal(rc.inter[ec], 2);
  assert.ok(Yl > M.Y && Yl < M.X, 'the bond between lines lies between the layer bond and the line strength');
});

test('Multigrid solver gives the same displacements as conjugate gradients (hook sample, walls and infill)', () => {
  const v = voxelize(sample('hook'), 3000), fixed = new Set<number>(), load = new Set<number>();
  for (const id of surfaceVoxels(v)) { const k = Math.floor(id / (v.nx * v.ny)), i = id % v.nx; if (k >= v.nz - 2) fixed.add(id); if (k <= 1 && i > v.nx / 2) load.add(id); }
  const md = buildModel(v, { fixed, load }, { fil: 'petg', theta: 0, phi: 0, walls: 2, skins: 4, infill: 0.2, F: 50, dir: [0, 0, -1] });
  const a = run(solveCG(md, 1e-10, 20000)), b = run(solveMG(md, 1e-8));
  assert.ok(b.converged && b.it < 60, `MG ${b.it} iterations`);
  let mx = 0, d = 0; for (let i = 0; i < md.ndof; i++) { mx = Math.max(mx, Math.abs(a.u[i])); d = Math.max(d, Math.abs(a.u[i] - b.u[i])); }
  assert.ok(d < 1e-5 * mx, `${d} vs ${mx}`);
});


test('Display refinement keeps the surface: same volume, no edge above the limit', async () => {
  const { refine } = await import('./labPrep.ts');
  const m = sample('bracket'), r = refine(m.pos, 2);
  near(volume({ pos: r }), volume(m), 1e-3 * volume(m));
  for (let t = 0; t < r.length; t += 9) for (let k = 0; k < 3; k++) { const a = t + 3 * k, b = t + 3 * ((k + 1) % 3); assert.ok(Math.hypot(r[a] - r[b], r[a + 1] - r[b + 1], r[a + 2] - r[b + 2]) <= 2 + 1e-5); }
});

test('Part preparation in the worker: same cubes and surface as on the app, drawing simplified for dense meshes', async () => {
  const { prepPart, unprep, decimate, refine, DRAW_TRIS } = await import('./labPrep.ts');
  const { toB64 } = await import('./b64.ts');
  const { depthAndNormals } = await import('./voxel.ts');
  const m = sample('hook'), job = (pos: Float32Array, scale = 1) => ({ mesh: toB64(new Uint8Array(pos.buffer, pos.byteOffset, pos.byteLength)), scale, target: 4000, check: true });
  const P = unprep(JSON.parse(JSON.stringify(prepPart(job(m.pos)))));
  const v = voxelize(m, 4000), surf = surfaceVoxels(v), { nrm } = depthAndNormals(v);
  assert.deepEqual([P.vox.nx, P.vox.ny, P.vox.nz], [v.nx, v.ny, v.nz]);
  assert.deepEqual(Array.from(P.vox.solid), Array.from(v.solid));
  assert.deepEqual(Array.from(P.vox.fill!), Array.from(v.fill!));
  assert.deepEqual(Array.from(P.surf), surf);
  for (const id of surf) for (let k = 0; k < 3; k++) near(P.nrm[3 * id + k], nrm[3 * id + k], 0.02, 'normal');
  assert.deepEqual(P.info, meshCheck(m));
  assert.ok(P.draw.pos.length / 9 <= DRAW_TRIS && P.draw.vid.every((id) => id >= 0 && P.vox.solid[id] === 1), 'every drawn vertex has a cube');
  near(volume({ pos: P.draw.pos }), volume(m), 2e-3 * volume(m), 'drawn volume (uint16 positions)');
  // a file in cm opens at 10 × its size
  const Pc = unprep(prepPart(job(m.pos.map((x) => x / 10), 10)));
  near(Pc.vox.h, P.vox.h, 1e-4 * P.vox.h);
  // a dense mesh is drawn with at most DRAW_TRIS triangles, its outline kept within about a cube
  const dense = refine(m.pos, 0.35, 400000), D = unprep(prepPart(job(dense)));
  assert.ok(dense.length / 9 > DRAW_TRIS && D.draw.simplified && D.draw.pos.length / 9 <= DRAW_TRIS);
  const b0 = bounds(m), b1 = bounds({ pos: D.draw.pos });
  for (let k = 0; k < 3; k++) { near(b1.lo[k], b0.lo[k], D.vox.h); near(b1.hi[k], b0.hi[k], D.vox.h); }
  near(volume({ pos: decimate(dense, 0.5) }), volume(m), 0.03 * volume(m), 'decimated volume');
});

/* ---------------- isotropic solid (general static analysis) ---------------- */

const STEEL = { E: 210000, nu: 0.3, rho: 7.85, fy: 235, fu: 360 };
/** The same 40 × 4 × 6 bar in steel: clamped at x = 0, the last slice loaded (force or pressure) or hanging. */
function isoBar(p: Partial<LabIn>) {
  const nx = 40, ny = 4, nz = 6, v: Vox = { nx, ny, nz, h: 1, org: [0, 0, 0], solid: new Uint8Array(nx * ny * nz).fill(1) };
  const fixed = new Set<number>(), load = new Set<number>();
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) { fixed.add(vIdx(v, 0, j, k)); if (p.load) load.add(vIdx(v, nx - 1, j, k)); }
  const q: LabIn = { fil: 'pla', theta: 0, phi: 0, walls: 1, skins: 1, infill: 1, F: 1000, dir: [1, 0, 0], iso: STEEL, ...p };
  return { v, md: buildModel(v, { fixed, load }, q) };
}

test('Isotropic stiffness: λ + 2G on the diagonal, G for shear', () => {
  const C = isoStiffness(210000, 0.3), lam = (210000 * 0.3) / (1.3 * 0.4), G = 210000 / 2.6;
  near(C[0][0], lam + 2 * G, 1e-6); near(C[1][2], lam, 1e-6); near(C[4][4], G, 1e-6); near(C[0][3], 0, 1e-9);
});

test('Steel bar in tension: σ = F/A, SF = f_y/σ, δ = F L/(E A)', () => {
  const { md, v } = isoBar({ load: 'force' }), sol = run(solveCG(md, 1e-9)), r = evaluate(md, strains(md, sol.u), md.b);
  const e = md.elemOf[vIdx(v, 20, 1, 2)], s = 1000 / 24;
  near(r.sg[6 * e], s, 0.01 * s, 'σxx'); near(r.u[e], s / 235, 0.02 * s / 235, 'utilisation');
  // stretch between the slices x = 10 and x = 30 (away from the clamp and the load)
  const ux = (i: number) => sol.u[md.edof[24 * md.elemOf[vIdx(v, i, 1, 2)]]];
  near(ux(30) - ux(10), (1000 * 20) / (210000 * 24), 0.02 * (1000 * 20) / (210000 * 24), 'stretch');
});

test('Pressure on the end face: resultant p·A along minus the face normal, σ = p', () => {
  const { md, v } = isoBar({ load: 'pressure', F: 5 }), sol = run(solveCG(md, 1e-9)), r = evaluate(md, strains(md, sol.u), md.b);
  // loaded cubes: the end face (4 × 6 mm²) and the outer side faces of the last slice; the side pressures cancel
  near(md.fres[0], -5 * 24, 1e-9, 'resultant x'); near(md.fres[1], 0, 1e-9); near(md.fres[2], 0, 1e-9);
  near(r.sg[6 * md.elemOf[vIdx(v, 20, 1, 2)]], -5, 0.05, 'σxx = −p');
});

test('Own weight of a hanging bar: W = ρ g V, top stress ρ g L, tip drop ρ g L²/(2E)', () => {
  const { md, v } = isoBar({ grav: 1, gdir: [1, 0, 0] }), sol = run(solveCG(md, 1e-10)), r = evaluate(md, strains(md, sol.u), md.b);
  const g = 7.85e-6 * 9.81; // N/mm³
  near(md.weight, g * 40 * 24, 1e-9, 'weight');
  // stress at x = 20.5 carries the 19.5 mm hanging below it
  near(r.sg[6 * md.elemOf[vIdx(v, 20, 1, 2)]], g * 19.5, 0.03 * g * 19.5, 'σ(x)');
  const L = 39, tip = sol.u[md.edof[24 * md.elemOf[vIdx(v, 39, 1, 2)] + 3]]; // node (1, 0, 0) of the last cube, x = 40, measured from the clamp face x = 1
  near(tip - sol.u[md.edof[24 * md.elemOf[vIdx(v, 1, 1, 2)]]], (g * L ** 2) / (2 * 210000), 0.05 * (g * L ** 2) / (2 * 210000), 'tip drop');
});

test('STL reading: binary with extra bytes or a "solid" header, ASCII; closed-body check', () => {
  const m = extrude([[0, 0], [30, 0], [30, 10], [0, 10]], 8), bin = writeSTL(m);
  const padded = new Uint8Array(bin.byteLength + 3); padded.set(new Uint8Array(bin));
  assert.equal(parseSTL(padded.buffer).pos.length, m.pos.length);
  const named = new Uint8Array(bin.slice(0)); named.set([...'solid part'].map((c) => c.charCodeAt(0)));
  assert.equal(parseSTL(named.buffer).pos.length, m.pos.length);
  assert.deepEqual(meshCheck(m), { openEdges: 0, edges: meshCheck(m).edges, bodies: 1 });
  const two = { pos: Float32Array.from([...m.pos, ...m.pos.map((x, i) => (i % 3 === 0 ? x + 100 : x))]) };
  assert.equal(meshCheck(two).bodies, 2);
  const holed = { pos: m.pos.slice(9) };
  assert.equal(meshCheck(holed).openEdges, 3);
});

test('Separate loaded areas carry their own forces: groups by touching cubes, resultant = sum of the forces', async () => {
  const { applyStrokes, loadGroups } = await import('./printLab.ts');
  const nx = 40, ny = 4, nz = 6, v: Vox = { nx, ny, nz, h: 1, org: [0, 0, 0], solid: new Uint8Array(nx * ny * nz).fill(1) };
  const BIG = 1e6, up: [number, number, number] = [0, 0, 1];
  const strokes = [
    { kind: 'fix' as const, lo: [-BIG, -BIG, -BIG] as [number, number, number], hi: [1, BIG, BIG] as [number, number, number], n: [-1, 0, 0] as [number, number, number], minDot: 0.5 },
    { kind: 'load' as const, lo: [10, -BIG, 5] as [number, number, number], hi: [14, BIG, BIG] as [number, number, number], n: up, minDot: 0.5 },
    { kind: 'load' as const, lo: [30, -BIG, 5] as [number, number, number], hi: [34, BIG, BIG] as [number, number, number], n: up, minDot: 0.5 },
    { kind: 'load' as const, lo: [14, -BIG, 5] as [number, number, number], hi: [16, BIG, BIG] as [number, number, number], n: up, minDot: 0.5 }, // touches the first area
  ];
  const marks = applyStrokes(v, strokes), { nrm } = (await import('./voxel.ts')).depthAndNormals(v), gs = loadGroups(v, marks.load, marks.loadBy, nrm);
  assert.equal(gs.length, 2, 'two separate areas');
  assert.deepEqual(gs.map((g) => g.key), [1, 2], 'named after their earliest stroke');
  near(gs[0].c[0], 12.5, 0.6, 'centre of the merged first area'); near(gs[0].n[2], 1, 1e-9, 'top face');
  const md = buildModel(v, marks, { fil: 'pla', theta: 0, phi: 0, walls: 1, skins: 1, infill: 1, F: 0, dir: [0, 0, -1], iso: STEEL,
    groups: [{ ids: gs[0].ids, F: 300, dir: [0, 0, -1] }, { ids: gs[1].ids, F: 120, dir: [1, 0, 0] }] });
  near(md.fres[0], 120, 1e-9, 'x'); near(md.fres[1], 0, 1e-9, 'y'); near(md.fres[2], -300, 1e-9, 'z');
  const sol = run(solveCG(md, 1e-9)); assert.ok(sol.converged);
});

test('Loads: a force next to a held area is not lost; a pressure on an area up to an edge pushes only on its own face', async () => {
  const { applyStrokes } = await import('./printLab.ts');
  const box: Vox = { nx: 20, ny: 20, nz: 10, h: 1, org: [0, 0, 0], solid: new Uint8Array(4000).fill(1) }, BIG = 1e6;
  const base = { fil: 'pla' as const, theta: 0, phi: 0, walls: 1, skins: 1, infill: 1, iso: STEEL };
  // 100 N on a strip whose cubes share nodes with the held face: all 100 N reach the part
  let m = applyStrokes(box, [{ kind: 'fix', lo: [-BIG, -BIG, -BIG], hi: [1, BIG, BIG], n: [-1, 0, 0], minDot: 0.5 }, { kind: 'load', lo: [1, -BIG, 9], hi: [3, BIG, BIG], n: [0, 0, 1], minDot: 0.5 }]);
  let r = buildModel(box, m, { ...base, F: 100, dir: [0, 0, -1] }).fres;
  near(r[0], 0, 1e-9); near(r[1], 0, 1e-9); near(r[2], -100, 1e-9, 'force');
  // 1 MPa on half the top face, painted up to the part's edges (the edge cubes also have side faces): p·A straight down
  m = applyStrokes(box, [{ kind: 'fix', lo: [-BIG, -BIG, -BIG], hi: [BIG, BIG, 1], n: [0, 0, -1], minDot: 0.5 }, { kind: 'load', lo: [-BIG, -BIG, 9], hi: [10, BIG, BIG], n: [0, 0, 1], minDot: 0.2 }]);
  r = buildModel(box, m, { ...base, F: 1, dir: [0, 0, -1], load: 'pressure' }).fres;
  near(r[0], 0, 1e-9, 'no sideways push'); near(r[1], 0, 1e-9); near(r[2], -200, 1e-9, 'p·A');
});

test('Pressure on a sloped face acts normal to it (cube steps projected on the fitted surface normal)', () => {
  for (const ang of [10, 30, 60]) {
    const a = (ang * Math.PI) / 180, e = [Math.cos(a), Math.sin(a)], nn = [-Math.sin(a), Math.cos(a)], L = 60, H = 8;
    const P = (s: number, t: number): [number, number] => [s * e[0] + t * nn[0], s * e[1] + t * nn[1]];
    const v = voxelize(extrude([P(0, 0), P(L, 0), P(L, H), P(0, H)], 20), 20000), fixed = new Set<number>(), load = new Set<number>();
    for (const id of surfaceVoxels(v)) { const c = voxCenter(v, id), s = c[0] * e[0] + c[2] * e[1], t = -c[0] * e[1] + c[2] * e[0]; if (s < 1) fixed.add(id); else if (t > H - 1.2 * v.h && s > 10 && s < 50) load.add(id); }
    const r = buildModel(v, { fixed, load }, { fil: 'pla', theta: 0, phi: 0, walls: 1, skins: 1, infill: 1, F: 1, dir: [0, 0, -1], iso: STEEL, load: 'pressure' }).fres;
    near((Math.atan2(r[0], -r[2]) * 180) / Math.PI, ang, 1.5, `direction at ${ang}°`); near(r[1], 0, 1e-6);
    near(Math.hypot(r[0], r[2]) / 800, 1, 0.07, `p·A at ${ang}° (40 × 20 mm, edges of the painted band ±1 cube)`);
  }
});
