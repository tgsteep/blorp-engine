/**
 * Print lab glue (no React): where the part is held and loaded (strokes painted on the surface, kept in mm so they
 * survive a change of resolution), the sample parts with their supports and loads, the solver's result decoded into
 * arrays, displacement at a point for drawing, and the checks.
 */
import { fromB64, toB64 } from './b64.ts';
import type { LabJob, LabResult } from './labWorker.ts';
import { PS_FILS, type PsFil } from './printStrength.ts';
import { bounds, sample, type Mesh, type SampleId } from './stl.ts';
import { depthAndNormals, surfaceVoxels, voxAt, voxCenter, vIdx, type Vox } from './voxel.ts';
import type { Lines, V3 } from './voxfem.ts';
export { refine, thinShare } from './labPrep.ts';

export type Kind = 'fix' | 'load' | 'erase';
/** A painted area: a ball (tap with the brush) or a box, limited to surface cubes facing roughly along n. */
export type Stroke = { kind: Kind; c?: V3; r?: number; lo?: V3; hi?: V3; n: V3; minDot: number };

/** Surface cubes marked held and loaded after applying the strokes in order (erase removes both marks); `loadBy`
 *  gives, for each loaded cube, the stroke (its index) that marked it; `mark` per cube 0 / 1 held / 2 loaded (for
 *  colouring). Each stroke only visits the cubes inside its ball or box. */
export function applyStrokes(v: Vox, strokes: Stroke[], surf: ArrayLike<number> = surfaceVoxels(v), nrm: ArrayLike<number> = depthAndNormals(v).nrm) {
  const fixed = new Set<number>(), load = new Set<number>(), loadBy = new Map<number, number>(), mark = new Uint8Array(v.nx * v.ny * v.nz);
  if (!strokes.length) return { fixed, load, loadBy, mark };
  const isSurf = new Uint8Array(v.nx * v.ny * v.nz); for (let i = 0; i < surf.length; i++) isSurf[surf[i]] = 1;
  const { nx, ny, nz, h, org } = v, cell = (x: number, a: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor((x - org[a]) / h)));
  for (let si = 0; si < strokes.length; si++) {
    const s = strokes[si], ball = !!(s.c && s.r !== undefined);
    const lo = ball ? [s.c![0] - s.r!, s.c![1] - s.r!, s.c![2] - s.r!] : s.lo, hi = ball ? [s.c![0] + s.r!, s.c![1] + s.r!, s.c![2] + s.r!] : s.hi;
    if (!lo || !hi) continue;
    const r2 = ball ? s.r! * s.r! : 0;
    for (let k = cell(lo[2], 2, nz); k <= cell(hi[2], 2, nz); k++) for (let j = cell(lo[1], 1, ny); j <= cell(hi[1], 1, ny); j++) for (let i = cell(lo[0], 0, nx); i <= cell(hi[0], 0, nx); i++) {
      const id = i + nx * (j + ny * k); if (!isSurf[id]) continue;
      const cx = org[0] + (i + 0.5) * h, cy = org[1] + (j + 0.5) * h, cz = org[2] + (k + 0.5) * h;
      if (ball) { if ((cx - s.c![0]) ** 2 + (cy - s.c![1]) ** 2 + (cz - s.c![2]) ** 2 > r2) continue; }
      else if (cx < lo[0] || cy < lo[1] || cz < lo[2] || cx > hi[0] || cy > hi[1] || cz > hi[2]) continue;
      if (nrm[3 * id] * s.n[0] + nrm[3 * id + 1] * s.n[1] + nrm[3 * id + 2] * s.n[2] < s.minDot) continue;
      if (s.kind === 'fix') { fixed.add(id); load.delete(id); loadBy.delete(id); mark[id] = 1; }
      else if (s.kind === 'load') { load.add(id); fixed.delete(id); loadBy.set(id, si); mark[id] = 2; }
      else { fixed.delete(id); load.delete(id); loadBy.delete(id); mark[id] = 0; }
    }
  }
  return { fixed, load, loadBy, mark };
}

/** A separate loaded area: cubes that touch each other (by a face, an edge or a corner). It carries its own force,
 *  and is named after the earliest stroke that marked one of its cubes (`key`), so its force stays with it when it
 *  grows or another area is erased. c = centre, n = mean outward normal. */
export type LoadGroup = { key: number; ids: number[]; c: V3; n: V3 };
export function loadGroups(v: Vox, load: Set<number>, loadBy: Map<number, number>, nrm: ArrayLike<number>): LoadGroup[] {
  const seen = new Set<number>(), out: LoadGroup[] = [];
  for (const start of load) {
    if (seen.has(start)) continue;
    const ids: number[] = [start]; seen.add(start);
    for (let q = 0; q < ids.length; q++) {
      const id = ids[q], i = id % v.nx, j = Math.floor(id / v.nx) % v.ny, k = Math.floor(id / (v.nx * v.ny));
      for (let c = -1; c <= 1; c++) for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
        const ii = i + a, jj = j + b, kk = k + c; if (ii < 0 || jj < 0 || kk < 0 || ii >= v.nx || jj >= v.ny || kk >= v.nz) continue;
        const n = vIdx(v, ii, jj, kk); if (load.has(n) && !seen.has(n)) { seen.add(n); ids.push(n); }
      }
    }
    let key = Infinity; const c = [0, 0, 0], nn = [0, 0, 0];
    for (const id of ids) { key = Math.min(key, loadBy.get(id) ?? Infinity); const p = voxCenter(v, id); for (let m = 0; m < 3; m++) { c[m] += p[m] / ids.length; nn[m] += nrm[3 * id + m]; } }
    const l = Math.hypot(nn[0], nn[1], nn[2]) || 1;
    out.push({ key: Number.isFinite(key) ? key : -1, ids, c: c as V3, n: [nn[0] / l, nn[1] / l, nn[2] / l] });
  }
  return out.sort((a, b) => a.key - b.key);
}
/** Load of one area for the solver: force F [N] along dir, or (static analysis, pressure) p [MPa] in F. */
export type LoadSpec = { ids: number[]; F: number; dir: V3 };

export const DIRS = ['-Z', '+Z', '-X', '+X', '-Y', '+Y'] as const;
export type DirId = (typeof DIRS)[number];
export const dirVec = (d: DirId): V3 => { const s = d[0] === '-' ? -1 : 1; return d[1] === 'X' ? [s, 0, 0] : d[1] === 'Y' ? [0, s, 0] : [0, 0, s]; };

const BIG = 1e6;
/** Sample parts: how they are held and loaded, and a load that makes them interesting in PLA. */
export const SAMPLE_SETUP: Record<SampleId, { strokes: Stroke[]; F: number; dir: DirId; theta: number; phi: number }> = {
  // shelf bracket: screwed to the wall (x = 0) at the top of the leg, its foot pressing on the wall; the shelf presses down on the end of the arm
  bracket: { F: 60, dir: '-Z', theta: 0, phi: 0, strokes: [
    { kind: 'fix', lo: [-BIG, -BIG, 40], hi: [3, BIG, BIG], n: [-1, 0, 0], minDot: 0.5 },
    { kind: 'fix', lo: [-BIG, -BIG, -BIG], hi: [3, BIG, 8], n: [-1, 0, 0], minDot: 0.5 },
    { kind: 'load', lo: [48, -BIG, 55], hi: [BIG, BIG, BIG], n: [0, 0, 1], minDot: 0.5 },
  ] },
  // J hook: back of the shank screwed to the wall (−y face, upper part), the load hangs in the bottom of the bend
  hook: { F: 60, dir: '-Z', theta: 0, phi: 0, strokes: [
    { kind: 'fix', lo: [-BIG, -BIG, 26], hi: [BIG, BIG, BIG], n: [0, -1, 0], minDot: 0.5 },
    { kind: 'load', lo: [-5, -BIG, -BIG], hi: [5, BIG, -9], n: [0, 0, 1], minDot: 0.5 },
  ] },
  // flat bar as a beam: both ends resting on (held to) supports from below, a load pressing on the middle
  bar: { F: 100, dir: '-Z', theta: 0, phi: 0, strokes: [
    { kind: 'fix', lo: [-BIG, -BIG, -BIG], hi: [8, BIG, 2], n: [0, 0, -1], minDot: 0.5 },
    { kind: 'fix', lo: [92, -BIG, -BIG], hi: [BIG, BIG, 2], n: [0, 0, -1], minDot: 0.5 },
    { kind: 'load', lo: [45, -BIG, 4], hi: [55, BIG, BIG], n: [0, 0, 1], minDot: 0.5 },
  ] },
};
export { sample };

export const RES = { coarse: 4000, medium: 10000, fine: 20000 } as const;
export type ResId = keyof typeof RES;

export type LabParams = { fil: PsFil; theta: number; phi: number; walls: number; skins: number; infill: number; F: number; dir: DirId; lines: Lines; alpha: number };
/** Solver job of the print lab; with `groups`, every loaded area has its own force and F is their sum (the
 *  orientation chart's failure load is then all the forces together at failure). */
export function makeJob(v: Vox, fixed: Set<number>, load: Set<number>, p: LabParams, groups?: LoadSpec[]): LabJob {
  const F = groups && groups.length ? groups.reduce((a, g) => a + g.F, 0) : p.F;
  return { nx: v.nx, ny: v.ny, nz: v.nz, h: v.h, org: v.org, solid: toB64(v.solid), fill: v.fill ? toB64(v.fill) : undefined, fixed: [...fixed], load: [...load], sweep: true,
    p: { fil: p.fil, theta: p.theta, phi: p.phi, walls: p.walls, skins: p.skins, infill: p.infill, F, dir: dirVec(p.dir), lines: p.lines, alpha: p.alpha, groups } };
}

/** The result with its arrays decoded, plus lookups from a cube to its element and from a grid node to its node. */
export function decode(r: LabResult, v: Vox) {
  const i32 = (s: string) => { const b = fromB64(s); return new Int32Array(b.buffer, 0, b.length >> 2); };
  const f32 = (s: string) => { const b = fromB64(s); return new Float32Array(b.buffer, 0, b.length >> 2); };
  const elems = i32(r.elems), u = f32(r.u), inter = fromB64(r.inter), disp = f32(r.disp), gnodes = i32(r.gnodes);
  const elemOf = new Int32Array(v.solid.length).fill(-1); elems.forEach((id, e) => { elemOf[id] = e; });
  const nodeOfG = new Int32Array((v.nx + 1) * (v.ny + 1) * (v.nz + 1)).fill(-1); gnodes.forEach((g, n) => { nodeOfG[g] = n; });
  return { ...r, elems, u, inter, disp, gnodes, elemOf, nodeOfG };
}
export type Decoded = ReturnType<typeof decode>;

/** Displacement at a point (trilinear in the cube under it) [mm]; zero off the model. */
export function dispAt(v: Vox, d: Decoded, x: number, y: number, z: number, out: number[]) {
  return dispIn(v, d, voxAt(v, x, y, z), x, y, z, out);
}
/** The same when the cube under the point is already known (the drawn vertices keep theirs). */
export function dispIn(v: Vox, d: Decoded, id: number, x: number, y: number, z: number, out: number[]) {
  out[0] = out[1] = out[2] = 0;
  if (id < 0 || d.elemOf[id] < 0) return out;
  const i = id % v.nx, j = Math.floor(id / v.nx) % v.ny, k = Math.floor(id / (v.nx * v.ny));
  const cl = (q: number) => Math.min(1, Math.max(0, q));
  const lx = cl((x - v.org[0]) / v.h - i), ly = cl((y - v.org[1]) / v.h - j), lz = cl((z - v.org[2]) / v.h - k);
  for (let c = 0; c < 8; c++) {
    const a = c & 1, b = (c >> 1) & 1, e = c >> 2, nd = d.nodeOfG[i + a + (v.nx + 1) * (j + b + (v.ny + 1) * (k + e))]; if (nd < 0) continue;
    const w = (a ? lx : 1 - lx) * (b ? ly : 1 - ly) * (e ? lz : 1 - lz);
    out[0] += w * d.disp[3 * nd]; out[1] += w * d.disp[3 * nd + 1]; out[2] += w * d.disp[3 * nd + 2];
  }
  return out;
}

/** Utilisation of the element under a point (−1 off the model). */
export function utilAt(v: Vox, d: Decoded, x: number, y: number, z: number) { const id = voxAt(v, x, y, z); const e = id < 0 ? -1 : d.elemOf[id]; return e < 0 ? -1 : d.u[e]; }

export type Check = { ok: boolean; label: string; detail: string };
/** Checks of a lab run (`d` null while nothing has been solved for these settings). */
/** Checks of an uploaded file: plausible size (unit), one closed body. */
export type MeshInfo = { openEdges: number; edges: number; bodies: number };
export function fileChecks(size: number, mi: MeshInfo | null): Check[] {
  const c: Check[] = [{ ok: size >= 5 && size <= 500, label: 'Part size plausible', detail: `largest size ${size.toFixed(0)} mm (5…500 mm) — check the file unit` }];
  if (mi) {
    c.push({ ok: mi.openEdges === 0, label: 'Closed surface (watertight)', detail: mi.openEdges ? `${mi.openEdges} of ${mi.edges} edges are not shared by exactly two triangles — repair the mesh or export it again as a solid` : 'every edge is shared by two triangles' });
    c.push({ ok: mi.bodies === 1, label: 'One body', detail: mi.bodies === 1 ? 'the file holds one solid' : `${mi.bodies} separate bodies — export one part; parts not joined to a held area are left out` });
  }
  return c;
}
export function labChecks(o: { F: number; nFixed: number; nLoad: number; d: Decoded | null; error: string | null; size: number; thin: number; file: boolean; mesh?: MeshInfo | null }) {
  const { d } = o, c: Check[] = [];
  c.push({ ok: o.nFixed > 0 && o.nLoad > 0, label: 'Supports and load marked', detail: `${o.nFixed} held and ${o.nLoad} loaded surface cubes` });
  c.push({ ok: !o.error && (!d || d.dropped === 0), label: 'Load reaches a support', detail: o.error === 'load not connected' || (d && d.dropped) ? 'part of the loaded area is not joined to a held area' : o.error === 'no supported part' ? 'no part of the model is held' : 'the loaded area is joined to a held area' });
  if (d) {
    const SF = 1 / d.umax, Ff = o.F / d.umax, best = d.sweep.reduce((m, q) => Math.max(m, q.Ff), Ff);
    c.push({ ok: d.converged, label: 'Solution converged', detail: `${d.it} multigrid iterations, residual ${d.res.toExponential(1)}` });
    c.push({ ok: SF >= 2, label: 'Safety factor SF ≥ 2', detail: `SF = ${SF.toFixed(2)}` });
    c.push({ ok: Ff >= 0.9 * best, label: 'Orientation within 10 % of the best', detail: `F_f ${Ff.toFixed(0)} N here, ${best.toFixed(0)} N at the best build direction` });
    c.push({ ok: d.maxDisp <= o.size / 50, label: 'Deflection ≤ 1/50 of the part size', detail: `${d.maxDisp.toFixed(2)} mm ≤ ${(o.size / 50).toFixed(2)} mm` });
  }
  c.push({ ok: o.thin <= 0.05, label: 'Thin walls resolved', detail: `${(100 * o.thin).toFixed(0)} % of the cubes are one cube thick (≤ 5 %)` });
  if (o.file) c.push(...fileChecks(o.size, o.mesh ?? null));
  return c;
}

export const partSize = (m: Mesh) => Math.max(...bounds(m).size);
export { PS_FILS };

export const LAB_INTRO = 'Will it hold if I print it this way? Load your own part as an STL file (or try a sample), tap the part to mark where it is held and where the load acts, and choose how it lies on the print bed. The part is cut into small cubes and calculated in 3D with the finite element method — walls, top and bottom layers, infill and the weaker bond between the layers included — and every build direction is compared, so you see where it breaks and how to print it stronger.';
export const LAB_WARNING = 'A learning estimate, not a certificate: real prints vary with the printer, settings and filament. Print and test anything that carries people, hangs over people or must not fail.';
export const LAB_NOTES = [
  'Every calculation uses the Fine mesh: the part is filled with about 20 000 equal cubes (their number and side h are given under Results) and each cube is an 8-node brick element with incompatible modes (no shear locking in bending), solved by conjugate gradients with a geometric multigrid preconditioner. A cube on a sloped or curved face is only partly inside the part: it counts with its filled share of stiffness, weight and mass, so the model is not thicker or stiffer than the part. Checked against solutions with 150 000 cubes, the sample parts\' safety factors agree within 10 % for the static analysis and within 20 % for printed parts. Walls only one or two cubes thick are not resolved: the thin-wall check says when.',
  'Material: printed plastic modelled line by line — every ply of lines is transversely isotropic about its line, stiff and strong along it (E1, X) and weaker across it (E2), Poisson ratio 0.35, shear moduli E2/2.7 (typical rounded values). Wall loops (0.45 mm each) run along the outline; top/bottom layers (0.2 mm each) and the infill follow the layer\'s line pattern; a cube near the surface is part shell and part infill with E·ρ² and strength·ρ^1.5. The crossed pattern is the average of two plies at 45° and 135° (the layers alternate); wall directions are rounded to 15° on the bed.',
  'Failure, ply by ply from the strain of each cube: along the lines |σ_l| against X; between the layers (σ_n/Y)² + (τ/S)² with the normal and shear stress on the layer plane (compression does not open a bond); between neighbouring lines of one layer the same with Y_l = (X + Y)/2 and S_l = S·Y_l/Y — the lines are laid side by side while both are hot and pressed together by the nozzle, so they bond better than the layers, but with small voids and less entanglement than inside a line. Surface stresses are extrapolated from the cubes under the surface and averaged over about 1.5 cubes (the stress over a small distance, as for notches), which removes the false peaks of the cube steps on sloped and curved faces.',
  'Blue cubes are held rigidly (screwed, clamped or glued), each separate orange area (cubes that touch each other) carries its own force, shared equally by its outer faces. Real screws and clamps give a little, so stresses within 2 mm of a held area are not used for the critical point; the force is applied as a static load (no impact, creep or fatigue — PLA creeps under a lasting load, plan a larger safety factor for that).',
  'The orientation chart reuses the deformation of the current build direction for all the others (the stiffness of the printed plastic changes little with direction); the best direction is calculated exactly once you choose it. Overhangs, supports, warping and the strength of the first layer are not considered.',
  'Filament direction: “Crossed” is the slicer’s usual pattern (the lines of the skins and infill turn by 90° from layer to layer). “One direction” lays every skin and infill line at the angle α on the bed (measured from the printer’s X axis; the part lies on the bed with its build direction up); walls always follow the outline. The line direction changes both the stiffness and the strength of every cube. The line-angle chart reuses the deformation of the current angle, as the orientation chart does.',
];
