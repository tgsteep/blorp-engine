/**
 * Held and loaded areas on the tetrahedral model's surface: the page's painted strokes (balls from a tap, or boxes for
 * the samples, in mm, filtered by the surface direction — the print lab's `Stroke`) applied to the boundary faces, and
 * the separate loaded areas (faces that share a corner) each named after its earliest stroke so a force stays with it.
 */
import type { Stroke } from '../../manufacturing/printLab.ts';

export type V3 = [number, number, number];
/** The prepared surface on the app's side: surface nodes (x, y, z each) and faces (6 surface-node numbers each:
 *  corners counter-clockwise from outside, then the edge nodes c0c1, c1c2, c2c0). */
export type Surf = { pos: Float32Array; faces: Int32Array; nf: number };

/** Centre and outward unit normal of every face (flat triangle through its corners). */
export function faceFrames(s: Surf) {
  const c = new Float32Array(3 * s.nf), n = new Float32Array(3 * s.nf), area = new Float32Array(s.nf), P = s.pos, F = s.faces;
  for (let f = 0; f < s.nf; f++) {
    const a = 3 * F[6 * f], b = 3 * F[6 * f + 1], d = 3 * F[6 * f + 2];
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    n[3 * f] = nx / l; n[3 * f + 1] = ny / l; n[3 * f + 2] = nz / l; area[f] = l / 2;
    for (let k = 0; k < 3; k++) c[3 * f + k] = (P[a + k] + P[b + k] + P[d + k]) / 3;
  }
  return { c, n, area };
}

/** Squared distance from point q to triangle (a, b, c) of the surface (corners by surface-node number). */
function triDist2(P: Float32Array, a: number, b: number, c: number, q: V3) {
  const A = [P[3 * a], P[3 * a + 1], P[3 * a + 2]], B = [P[3 * b], P[3 * b + 1], P[3 * b + 2]], Cc = [P[3 * c], P[3 * c + 1], P[3 * c + 2]];
  const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], ac = [Cc[0] - A[0], Cc[1] - A[1], Cc[2] - A[2]], ap = [q[0] - A[0], q[1] - A[1], q[2] - A[2]];
  const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  const at = (x: number[]) => (q[0] - x[0]) ** 2 + (q[1] - x[1]) ** 2 + (q[2] - x[2]) ** 2;
  if (d1 <= 0 && d2 <= 0) return at(A);
  const bp = [q[0] - B[0], q[1] - B[1], q[2] - B[2]], d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return at(B);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return at([A[0] + v * ab[0], A[1] + v * ab[1], A[2] + v * ab[2]]); }
  const cp = [q[0] - Cc[0], q[1] - Cc[1], q[2] - Cc[2]], d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return at(Cc);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return at([A[0] + w * ac[0], A[1] + w * ac[1], A[2] + w * ac[2]]); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return at([B[0] + w * (Cc[0] - B[0]), B[1] + w * (Cc[1] - B[1]), B[2] + w * (Cc[2] - B[2])]); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return at([A[0] + ab[0] * v + ac[0] * w, A[1] + ab[1] * v + ac[1] * w, A[2] + ab[2] * v + ac[2] * w]);
}

/** Face marks after the strokes in order: 0 none, 1 held, 2 loaded; `loadBy` = stroke that marked a loaded face. A ball
 *  takes every face it touches, a box the faces whose centre lies in it; both only faces facing within the stroke's
 *  minDot of its direction. */
export function applyFaceStrokes(s: Surf, fr: ReturnType<typeof faceFrames>, strokes: Stroke[]) {
  const mark = new Uint8Array(s.nf), loadBy = new Int32Array(s.nf).fill(-1);
  for (let si = 0; si < strokes.length; si++) {
    const st = strokes[si], ball = !!(st.c && st.r !== undefined);
    for (let f = 0; f < s.nf; f++) {
      const o = 3 * f;
      if (fr.n[o] * st.n[0] + fr.n[o + 1] * st.n[1] + fr.n[o + 2] * st.n[2] < st.minDot) continue;
      if (ball) {
        const c = st.c!, r = st.r!;
        // quick reject by the centre, then the true distance to the triangle
        if (Math.abs(fr.c[o] - c[0]) > r + 2 * Math.sqrt(fr.area[f] + 1e-12) + r || Math.abs(fr.c[o + 1] - c[1]) > 2 * r + 2 * Math.sqrt(fr.area[f] + 1e-12) || Math.abs(fr.c[o + 2] - c[2]) > 2 * r + 2 * Math.sqrt(fr.area[f] + 1e-12)) continue;
        if (triDist2(s.pos, s.faces[6 * f], s.faces[6 * f + 1], s.faces[6 * f + 2], c) > r * r) continue;
      } else {
        const lo = st.lo, hi = st.hi; if (!lo || !hi) continue;
        if (fr.c[o] < lo[0] || fr.c[o + 1] < lo[1] || fr.c[o + 2] < lo[2] || fr.c[o] > hi[0] || fr.c[o + 1] > hi[1] || fr.c[o + 2] > hi[2]) continue;
      }
      if (st.kind === 'fix') { mark[f] = 1; loadBy[f] = -1; } else if (st.kind === 'load') { mark[f] = 2; loadBy[f] = si; } else { mark[f] = 0; loadBy[f] = -1; }
    }
  }
  let nFix = 0, nLoad = 0; for (let f = 0; f < s.nf; f++) { if (mark[f] === 1) nFix++; else if (mark[f] === 2) nLoad++; }
  return { mark, loadBy, nFix, nLoad };
}

/** A separate loaded area: faces joined through shared corners; key = earliest stroke, c = centre, n = mean outward
 *  normal (area-weighted), A = area [mm²]. */
export type FaceGroup = { key: number; faces: number[]; c: V3; n: V3; A: number };
export function faceGroups(s: Surf, fr: ReturnType<typeof faceFrames>, mark: Uint8Array, loadBy: Int32Array): FaceGroup[] {
  // faces at each corner node
  const nn = s.pos.length / 3, at: number[][] = Array.from({ length: nn }, () => []);
  for (let f = 0; f < s.nf; f++) if (mark[f] === 2) for (let k = 0; k < 3; k++) at[s.faces[6 * f + k]].push(f);
  const seen = new Uint8Array(s.nf), out: FaceGroup[] = [];
  for (let f0 = 0; f0 < s.nf; f0++) {
    if (mark[f0] !== 2 || seen[f0]) continue;
    const faces = [f0]; seen[f0] = 1;
    for (let q = 0; q < faces.length; q++) for (let k = 0; k < 3; k++) for (const g of at[s.faces[6 * faces[q] + k]]) if (!seen[g]) { seen[g] = 1; faces.push(g); }
    let key = Infinity, A = 0; const c = [0, 0, 0], n = [0, 0, 0];
    for (const f of faces) { if (loadBy[f] >= 0) key = Math.min(key, loadBy[f]); const a = fr.area[f]; A += a; for (let m = 0; m < 3; m++) { c[m] += a * fr.c[3 * f + m]; n[m] += a * fr.n[3 * f + m]; } }
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    out.push({ key: Number.isFinite(key) ? key : -1, faces, c: [c[0] / A, c[1] / A, c[2] / A], n: [n[0] / l, n[1] / l, n[2] / l], A });
  }
  return out.sort((a, b) => a.key - b.key);
}
