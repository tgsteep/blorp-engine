/**
 * Voxels from a closed triangle mesh: the part is cut into equal cubes of side h (chosen for a target count). Every cube
 * knows how much of it lies inside the mesh (its fill, from S × S rays along z per column: the inside stretches between
 * pairs of crossings, cut exactly at the cube boundaries; 16 × 16 rays in columns a wall runs through); a cube is solid when its fill reaches FILL_MIN, and the
 * solver scales its stiffness, weight and mass by the fill — so a sloped or curved face is not rounded up to whole
 * cubes (a part made of whole cubes is too thick and too stiff). For the print model every solid cube also knows how
 * deep it lies under the surface (in cubes, by a breadth-first walk from the outside) and the outward normal of the
 * nearest surface, so walls, skins and infill can be told apart.
 */
import { bounds, volume, type Mesh } from './stl.ts';

/** fill: share of each cube inside the mesh, 0…255 (missing = every solid cube full). */
export type Vox = { nx: number; ny: number; nz: number; h: number; org: [number, number, number]; solid: Uint8Array; fill?: Uint8Array };
export const vIdx = (v: Vox, i: number, j: number, k: number) => i + v.nx * (j + v.ny * k);
/** Smallest fill of a cube that takes part in the model. */
export const FILL_MIN = 0.25;
/** Rays per column side (S × S rays measure the fill); SUB_EDGE where a wall or edge runs through the column. */
const SUB = 4, SUB_EDGE = 16;
/** Fill of a cube, 0…1 (1 for a solid cube without fill data). */
export const fillOf = (v: Vox, id: number) => (v.fill ? v.fill[id] / 255 : v.solid[id] ? 1 : 0);

/** Voxelises a closed mesh with about `target` cubes' worth of volume (h from the enclosed volume). */
export function voxelize(m: Mesh, target: number, hFix?: number): Vox {
  const B = bounds(m), V = volume(m) || B.size[0] * B.size[1] * B.size[2];
  const h = hFix ?? Math.cbrt(V / Math.max(1, target));
  const nx = Math.max(1, Math.ceil(B.size[0] / h)), ny = Math.max(1, Math.ceil(B.size[1] / h)), nz = Math.max(1, Math.ceil(B.size[2] / h));
  const org: [number, number, number] = [B.lo[0] - (nx * h - B.size[0]) / 2, B.lo[1] - (ny * h - B.size[1]) / 2, B.lo[2] - (nz * h - B.size[2]) / 2];
  const solid = new Uint8Array(nx * ny * nz), p = m.pos, nt = p.length / 9;
  // bin the triangles by the columns their x–y bounding box covers
  const bins: number[][] = Array.from({ length: nx * ny }, () => []);
  for (let t = 0; t < nt; t++) {
    const o = 9 * t, x0 = Math.min(p[o], p[o + 3], p[o + 6]), x1 = Math.max(p[o], p[o + 3], p[o + 6]), y0 = Math.min(p[o + 1], p[o + 4], p[o + 7]), y1 = Math.max(p[o + 1], p[o + 4], p[o + 7]);
    const i0 = Math.max(0, Math.floor((x0 - org[0]) / h - 0.5)), i1 = Math.min(nx - 1, Math.ceil((x1 - org[0]) / h - 0.5)), j0 = Math.max(0, Math.floor((y0 - org[1]) / h - 0.5)), j1 = Math.min(ny - 1, Math.ceil((y1 - org[1]) / h - 0.5));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) bins[i + nx * j].push(t);
  }
  const zs: number[] = [], acc = new Float64Array(nz), fill = new Uint8Array(nx * ny * nz);
  /** Casts S × S rays through column (i, j), adds the inside length per cube (in cubes) to acc; returns whether every
   *  ray crossed the surface the same number of times (no vertical wall or edge inside the column). */
  const cast = (i: number, j: number, S: number, bin: number[]) => {
    let n0 = -1, same = true;
    for (let sb = 0; sb < S; sb++) for (let sa = 0; sa < S; sa++) {
      const x = org[0] + (i + (sa + 0.5) / S) * h + 1.37e-5 * h, y = org[1] + (j + (sb + 0.5) / S) * h + 2.11e-5 * h; // tiny offset keeps the ray off shared edges
      zs.length = 0;
      for (const t of bin) {
        const o = 9 * t, ax = p[o], ay = p[o + 1], bx = p[o + 3], by = p[o + 4], cx = p[o + 6], cy = p[o + 7];
        const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(d) < 1e-18) continue;
        const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d, l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d, l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        zs.push(l1 * p[o + 2] + l2 * p[o + 5] + l3 * p[o + 8]);
      }
      if (n0 < 0) n0 = zs.length; else if (zs.length !== n0) same = false;
      if (zs.length < 2) continue;
      zs.sort((a, b) => a - b);
      // inside between crossings 1–2, 3–4, …: add each stretch to the cubes it passes, cut at their faces
      for (let c = 0; c + 1 < zs.length; c += 2) {
        const z0 = (zs[c] - org[2]) / h, z1 = (zs[c + 1] - org[2]) / h;
        for (let k = Math.max(0, Math.floor(z0)); k < nz && k < z1; k++) acc[k] += Math.min(z1, k + 1) - Math.max(z0, k);
      }
    }
    return same;
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const bin = bins[i + nx * j]; if (!bin.length) continue;
    // along z the inside length is exact; across the column it is sampled — finer where a wall runs through it
    acc.fill(0);
    let S = SUB;
    if (!cast(i, j, S, bin)) { acc.fill(0); S = SUB_EDGE; cast(i, j, S, bin); }
    for (let k = 0; k < nz; k++) {
      const f = Math.min(1, acc[k] / (S * S)), id = i + nx * (j + ny * k);
      fill[id] = Math.round(255 * f);
      if (f >= FILL_MIN) solid[id] = 1;
    }
  }
  return { nx, ny, nz, h, org, solid, fill };
}

const NB: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export { NB as FACE_NB };

/** Depth under the surface (1 = touches the outside through a face) and outward normal of the nearest surface. */
export function depthAndNormals(v: Vox) {
  const n = v.nx * v.ny * v.nz, depth = new Int32Array(n), nrm = new Float32Array(3 * n), queue: number[] = [];
  const at = (i: number, j: number, k: number) => (i < 0 || j < 0 || k < 0 || i >= v.nx || j >= v.ny || k >= v.nz ? 0 : v.solid[vIdx(v, i, j, k)]);
  for (let k = 0; k < v.nz; k++) for (let j = 0; j < v.ny; j++) for (let i = 0; i < v.nx; i++) {
    const id = vIdx(v, i, j, k); if (!v.solid[id]) continue;
    let sx = 0, sy = 0, sz = 0;
    for (const [a, b, c] of NB) if (!at(i + a, j + b, k + c)) { sx += a; sy += b; sz += c; }
    if (sx || sy || sz || NB.some(([a, b, c]) => !at(i + a, j + b, k + c))) {
      const l = Math.hypot(sx, sy, sz) || 1; depth[id] = 1; nrm[3 * id] = sx / l; nrm[3 * id + 1] = sy / l; nrm[3 * id + 2] = sz / l; queue.push(id);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const id = queue[q], i = id % v.nx, j = Math.floor(id / v.nx) % v.ny, k = Math.floor(id / (v.nx * v.ny));
    for (const [a, b, c] of NB) {
      const ii = i + a, jj = j + b, kk = k + c; if (!at(ii, jj, kk)) continue;
      const nid = vIdx(v, ii, jj, kk); if (depth[nid]) continue;
      depth[nid] = depth[id] + 1; nrm[3 * nid] = nrm[3 * id]; nrm[3 * nid + 1] = nrm[3 * id + 1]; nrm[3 * nid + 2] = nrm[3 * id + 2]; queue.push(nid);
    }
  }
  return { depth, nrm };
}

/** Solid cubes that touch the outside through at least one face (where supports and loads can be put). */
export function surfaceVoxels(v: Vox) {
  const out: number[] = [];
  for (let k = 0; k < v.nz; k++) for (let j = 0; j < v.ny; j++) for (let i = 0; i < v.nx; i++) {
    const id = vIdx(v, i, j, k); if (!v.solid[id]) continue;
    if (NB.some(([a, b, c]) => { const ii = i + a, jj = j + b, kk = k + c; return ii < 0 || jj < 0 || kk < 0 || ii >= v.nx || jj >= v.ny || kk >= v.nz || !v.solid[vIdx(v, ii, jj, kk)]; })) out.push(id);
  }
  return out;
}
export const voxCenter = (v: Vox, id: number): [number, number, number] => { const i = id % v.nx, j = Math.floor(id / v.nx) % v.ny, k = Math.floor(id / (v.nx * v.ny)); return [v.org[0] + (i + 0.5) * v.h, v.org[1] + (j + 0.5) * v.h, v.org[2] + (k + 0.5) * v.h]; };
/** The solid cube at a point, or the nearest solid cube within two cubes (for colouring the surface triangles). */
export function voxAt(v: Vox, x: number, y: number, z: number) {
  const i0 = Math.floor((x - v.org[0]) / v.h), j0 = Math.floor((y - v.org[1]) / v.h), k0 = Math.floor((z - v.org[2]) / v.h);
  let best = -1, bd = Infinity;
  for (let r = 0; r <= 2 && best < 0; r++) for (let dk = -r; dk <= r; dk++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    const i = i0 + di, j = j0 + dj, k = k0 + dk; if (i < 0 || j < 0 || k < 0 || i >= v.nx || j >= v.ny || k >= v.nz) continue;
    const id = i + v.nx * (j + v.ny * k); if (!v.solid[id]) continue;
    const d = (v.org[0] + (i + 0.5) * v.h - x) ** 2 + (v.org[1] + (j + 0.5) * v.h - y) ** 2 + (v.org[2] + (k + 0.5) * v.h - z) ** 2; if (d < bd) { bd = d; best = id; }
  }
  return best;
}
