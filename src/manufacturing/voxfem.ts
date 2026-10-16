/**
 * Strength of a printed part from its voxels: linear 8-node hexahedra. Every cube is part solid shell (wall loops or
 * top/bottom skins) and part infill (Gibson–Ashby E·ρ²); the printed plastic is modelled line by line — each ply of
 * lines is transversely isotropic about its line direction (stiff and strong along the line, weaker across it), walls
 * run along the outline, skins and infill along the layer's line pattern (crossed or one direction). A handful of
 * element stiffness matrices (12 wall directions + the infill/skin pattern) are combined per cube with its shell and
 * infill shares. Supports clamped, the load spread over the surface nodes of the load region; K u = f by conjugate
 * gradients with a multigrid preconditioner, as a generator so the screen keeps running. Failure, ply by ply from the
 * strain: along the lines |σ_l|/X; between neighbouring lines and between layers by the quadratic criterion
 * (σ_n/Y)² + (τ/S)² = 1 (Brewer & Lagace 1988) with the bond strengths of each plane, on the stress at each cube's
 * centre averaged with its face neighbours (voxel corners would otherwise give false peaks).
 */
import { LAYER_H, LINE_W, PS_FILS, type PsFil } from './printStrength.ts';
import { depthAndNormals, FACE_NB, fillOf, vIdx, type Vox } from './voxel.ts';

export type V3 = [number, number, number];
/** Isotropic solid (general static analysis): E [MPa], ν, density [g/cm³], yield and tensile strength [MPa]. */
export type IsoMat = { E: number; nu: number; rho: number; fy: number; fu: number };
/** Job input. Printed part: filament, build direction (θ, φ), walls, skins, infill. With `iso` the part is a solid
 *  isotropic material instead. Load on the marked cubes: a force F [N] along dir, or a pressure F [MPa] normal to the
 *  marked faces (pushing in); `grav` adds the part's own weight times grav (in g) along gdir. */
export type LabIn = { fil: PsFil; theta: number; phi: number; walls: number; skins: number; infill: number; F: number; dir: V3; iso?: IsoMat; load?: 'force' | 'pressure'; grav?: number; gdir?: V3; lines?: Lines; alpha?: number;
  /** Separate loaded areas, each with its own force F [N] along dir (or pressure F [MPa]); without it all marked cubes share F. */
  groups?: { ids: number[]; F: number; dir: V3 }[] };
/** Lines in each layer: 'cross' = the slicer's usual alternating directions (in the layer plane about equally strong
 *  every way), 'one' = every line of the skins and infill at the angle α on the bed (walls follow the outline). */
export type Lines = 'cross' | 'one';
export const buildVec = (thetaDeg: number, phiDeg: number): V3 => { const t = (thetaDeg * Math.PI) / 180, p = (phiDeg * Math.PI) / 180; return [Math.sin(t) * Math.cos(p), Math.sin(t) * Math.sin(p), Math.cos(t)]; };
/** The printer's X and Y axes on the bed, in file coordinates, when the part is printed with b up: the smallest
 *  rotation that turns the file's z axis into b, applied to x and y (R = I + [k]× + [k]×²/(1 + b_z), k = z × b; for
 *  b = −z half a turn about y). The 3D view lays the part on a level bed with the same rotation. */
export function bedFrame(b: V3): { ex: V3; ey: V3 } {
  const c = b[2];
  if (c < -1 + 1e-9) return { ex: [-1, 0, 0], ey: [0, 1, 0] };
  const kx = -b[1], ky = b[0], f = 1 / (1 + c);
  return { ex: [1 - f * ky * ky, f * kx * ky, -ky], ey: [f * kx * ky, 1 - f * kx * kx, kx] };
}
/** Direction of the printed lines at α degrees from the printer's X axis on the bed (file coordinates). */
export function lineDir(b: V3, alphaDeg: number): V3 {
  const { ex, ey } = bedFrame(b), a = (alphaDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [c * ex[0] + s * ey[0], c * ex[1] + s * ey[1], c * ex[2] + s * ey[2]];
}

/* ---------------- material ---------------- */

function inv6(A: number[][]) {
  const n = 6, M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]]; const d = M[c][c];
    for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map((r) => r.slice(n));
}
const VOIGT = [[0, 5, 4], [5, 1, 3], [4, 3, 2]]; // tensor (i, j) → Voigt index (xx yy zz yz xz xy)
/** Stiffness (Voigt, engineering shear) of a transversely isotropic solid whose axis 3 is the unit vector b, in global axes. */
export function stiffness(E1: number, E3: number, b: V3) {
  const nu12 = 0.35, nu13 = 0.35, G12 = E1 / (2 * (1 + nu12)), G13 = E3 / 2.7;
  const S = [
    [1 / E1, -nu12 / E1, -nu13 / E1, 0, 0, 0], [-nu12 / E1, 1 / E1, -nu13 / E1, 0, 0, 0], [-nu13 / E1, -nu13 / E1, 1 / E3, 0, 0, 0],
    [0, 0, 0, 1 / G13, 0, 0], [0, 0, 0, 0, 1 / G13, 0], [0, 0, 0, 0, 0, 1 / G12],
  ];
  const Cl = inv6(S);
  // local axes: e3 = b, e1 ⟂ b, e2 = e3 × e1; R[i][a] = component i of local axis a
  const e3 = b, tmp: V3 = Math.abs(b[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const d = tmp[0] * e3[0] + tmp[1] * e3[1] + tmp[2] * e3[2], e1u: V3 = [tmp[0] - d * e3[0], tmp[1] - d * e3[1], tmp[2] - d * e3[2]], l = Math.hypot(...e1u);
  const e1: V3 = [e1u[0] / l, e1u[1] / l, e1u[2] / l], e2: V3 = [e3[1] * e1[2] - e3[2] * e1[1], e3[2] * e1[0] - e3[0] * e1[2], e3[0] * e1[1] - e3[1] * e1[0]];
  const R = [[e1[0], e2[0], e3[0]], [e1[1], e2[1], e3[1]], [e1[2], e2[2], e3[2]]];
  const C = Array.from({ length: 6 }, () => new Array(6).fill(0));
  for (let i = 0; i < 3; i++) for (let j = i; j < 3; j++) for (let k = 0; k < 3; k++) for (let m = k; m < 3; m++) {
    let s = 0;
    for (let a = 0; a < 3; a++) for (let bb = 0; bb < 3; bb++) { const rab = R[i][a] * R[j][bb]; if (!rab) continue; for (let c = 0; c < 3; c++) for (let dd = 0; dd < 3; dd++) s += rab * R[k][c] * R[m][dd] * Cl[VOIGT[a][bb]][VOIGT[c][dd]]; }
    C[VOIGT[i][j]][VOIGT[k][m]] = s;
  }
  return C;
}

/** Stiffness (Voigt, engineering shear) of one ply of printed lines along the unit vector l: transversely isotropic
 *  about l — E_L along the line, E_T across it (to the neighbouring line and to the next layer alike), Poisson 0.35
 *  (ν_LT for a pull along the line), every shear modulus E_T/2.7 (shear always crosses a bond between lines). */
export function plyStiffness(EL: number, ET: number, l: V3) {
  const nu = 0.35, G = ET / 2.7;
  const S = [
    [1 / ET, -nu / ET, -nu / EL, 0, 0, 0], [-nu / ET, 1 / ET, -nu / EL, 0, 0, 0], [-nu / EL, -nu / EL, 1 / EL, 0, 0, 0],
    [0, 0, 0, 1 / G, 0, 0], [0, 0, 0, 0, 1 / G, 0], [0, 0, 0, 0, 0, 1 / G],
  ];
  return rotateC(inv6(S), l);
}
/** A local stiffness (axis 3 = a) turned into global axes. */
function rotateC(Cl: number[][], a: V3) {
  const e3 = a, tmp: V3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const d = tmp[0] * e3[0] + tmp[1] * e3[1] + tmp[2] * e3[2], e1u: V3 = [tmp[0] - d * e3[0], tmp[1] - d * e3[1], tmp[2] - d * e3[2]], ln = Math.hypot(...e1u);
  const e1: V3 = [e1u[0] / ln, e1u[1] / ln, e1u[2] / ln], e2: V3 = [e3[1] * e1[2] - e3[2] * e1[1], e3[2] * e1[0] - e3[0] * e1[2], e3[0] * e1[1] - e3[1] * e1[0]];
  const R = [[e1[0], e2[0], e3[0]], [e1[1], e2[1], e3[1]], [e1[2], e2[2], e3[2]]];
  const C = Array.from({ length: 6 }, () => new Array(6).fill(0));
  for (let i = 0; i < 3; i++) for (let j = i; j < 3; j++) for (let k = 0; k < 3; k++) for (let m = k; m < 3; m++) {
    let s = 0;
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) { const rab = R[i][x] * R[j][y]; if (!rab) continue; for (let c = 0; c < 3; c++) for (let dd = 0; dd < 3; dd++) s += rab * R[k][c] * R[m][dd] * Cl[VOIGT[x][y]][VOIGT[c][dd]]; }
    C[VOIGT[i][j]][VOIGT[k][m]] = s;
  }
  return C;
}

/** Ply classes of a printed part for build direction b: 0…11 = wall loops along the outline every 15° on the bed
 *  (the outline tangent of a wall cube is rounded to the nearest), 12 = the skins and infill — one ply at α, or the
 *  slicer's crossed pattern as two plies at 45° and 135° (their stiffness averaged: the layers alternate). */
export const NBIN = 12;
export type PlyClass = { l: V3[]; Cp: Float64Array[]; C: number[][] };
export function plyClasses(EL: number, ET: number, b: V3, lines: Lines, alpha: number): PlyClass[] {
  const make = (ls: V3[]): PlyClass => {
    const Cs = ls.map((l) => plyStiffness(EL, ET, l)), C = Cs[0].map((row, i) => row.map((_, j) => Cs.reduce((a, q) => a + q[i][j], 0) / Cs.length));
    return { l: ls, Cp: Cs.map((q) => Float64Array.from(q.flat())), C };
  };
  const out: PlyClass[] = [];
  for (let k = 0; k < NBIN; k++) out.push(make([lineDir(b, (180 * k) / NBIN)]));
  out.push(make(lines === 'one' ? [lineDir(b, alpha)] : [lineDir(b, 45), lineDir(b, 135)]));
  return out;
}
/** Ply class of the shell of a cube: a wall (outline tangent b × n, rounded to 15° on the bed) or, on a top or bottom
 *  face (n nearly along b) and inside, the skin/infill pattern. */
export function shellClass(nrm: Float32Array | Float64Array | number[], id: number, b: V3, ex: V3, ey: V3) {
  const n0 = nrm[3 * id], n1 = nrm[3 * id + 1], n2 = nrm[3 * id + 2], c = n0 * b[0] + n1 * b[1] + n2 * b[2];
  const t0 = b[1] * n2 - b[2] * n1, t1 = b[2] * n0 - b[0] * n2, t2 = b[0] * n1 - b[1] * n0, m = Math.hypot(t0, t1, t2);
  if (c * c > 0.5 || m < 0.3) return NBIN;
  const ang = Math.atan2(t0 * ey[0] + t1 * ey[1] + t2 * ey[2], t0 * ex[0] + t1 * ex[1] + t2 * ex[2]);
  return ((Math.round(ang / (Math.PI / NBIN)) % NBIN) + NBIN) % NBIN;
}

/** Stiffness (Voigt, engineering shear) of an isotropic solid. */
export function isoStiffness(E: number, nu: number) {
  const l = (E * nu) / ((1 + nu) * (1 - 2 * nu)), G = E / (2 * (1 + nu)), C = Array.from({ length: 6 }, () => new Array(6).fill(0));
  for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) C[i][j] = l; C[i][i] = l + 2 * G; C[i + 3][i + 3] = G; }
  return C;
}

/* ---------------- 8-node brick ---------------- */

const NODE = Array.from({ length: 8 }, (_, n) => [n & 1, (n >> 1) & 1, (n >> 2) & 1]); // corner offsets (a, b, c)
function Bmat(h: number, xi: number, eta: number, zeta: number) {
  const B = Array.from({ length: 6 }, () => new Array(24).fill(0));
  NODE.forEach(([a, b, c], n) => {
    const sx = 2 * a - 1, sy = 2 * b - 1, sz = 2 * c - 1;
    const dx = (sx * (1 + sy * eta) * (1 + sz * zeta)) / 8 * (2 / h), dy = (sy * (1 + sx * xi) * (1 + sz * zeta)) / 8 * (2 / h), dz = (sz * (1 + sx * xi) * (1 + sy * eta)) / 8 * (2 / h);
    const o = 3 * n;
    B[0][o] = dx; B[1][o + 1] = dy; B[2][o + 2] = dz;
    B[3][o + 1] = dz; B[3][o + 2] = dy; B[4][o] = dz; B[4][o + 2] = dx; B[5][o] = dy; B[5][o + 1] = dx;
  });
  return B;
}
function invN(A: number[][]) {
  const n = A.length, M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]]; const d = M[c][c];
    for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map((r) => r.slice(n));
}
/** Strain of the 9 incompatible modes (1 − ξ²), (1 − η²), (1 − ζ²) per displacement component (Wilson–Taylor). */
function Bincomp(h: number, xi: number, eta: number, zeta: number) {
  const B = Array.from({ length: 6 }, () => new Array(9).fill(0)), dd = [-2 * xi * (2 / h), -2 * eta * (2 / h), -2 * zeta * (2 / h)];
  for (let m = 0; m < 3; m++) {
    const dx = m === 0 ? dd[0] : 0, dy = m === 1 ? dd[1] : 0, dz = m === 2 ? dd[2] : 0, o = 3 * m;
    B[0][o] = dx; B[1][o + 1] = dy; B[2][o + 2] = dz;
    B[3][o + 1] = dz; B[3][o + 2] = dy; B[4][o] = dz; B[4][o + 2] = dx; B[5][o] = dy; B[5][o + 1] = dx;
  }
  return B;
}
/** Element stiffness of a cube of side h, flat 24 × 24: 2 × 2 × 2 Gauss points with the incompatible modes condensed
 *  out (no shear locking in bending, so a few cubes through a wall still bend correctly). */
export function brickK(C: number[][], h: number, incompatible = true) {
  const g = 1 / Math.sqrt(3), det = (h / 2) ** 3;
  const Kuu = Array.from({ length: 24 }, () => new Array(24).fill(0)), Kua = Array.from({ length: 24 }, () => new Array(9).fill(0)), Kaa = Array.from({ length: 9 }, () => new Array(9).fill(0));
  const mulT = (A: number[][], Bm: number[][], out: number[][]) => { // out += Aᵀ C Bm · det
    const CB = C.map((row) => Array.from({ length: Bm[0].length }, (_, j) => row.reduce((s, c, k) => s + c * Bm[k][j], 0)));
    for (let i = 0; i < A[0].length; i++) for (let j = 0; j < Bm[0].length; j++) { let s = 0; for (let k = 0; k < 6; k++) s += A[k][i] * CB[k][j]; out[i][j] += s * det; }
  };
  for (const xi of [-g, g]) for (const eta of [-g, g]) for (const ze of [-g, g]) {
    const B = Bmat(h, xi, eta, ze); mulT(B, B, Kuu);
    if (incompatible) { const Ba = Bincomp(h, xi, eta, ze); mulT(B, Ba, Kua); mulT(Ba, Ba, Kaa); }
  }
  const K = new Float64Array(576);
  if (incompatible) {
    const iA = invN(Kaa), KuaIA = Kua.map((row) => Array.from({ length: 9 }, (_, j) => row.reduce((s, x, k) => s + x * iA[k][j], 0)));
    for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) { let s = 0; for (let k = 0; k < 9; k++) s += KuaIA[i][k] * Kua[j][k]; K[24 * i + j] = Kuu[i][j] - s; }
  } else for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) K[24 * i + j] = Kuu[i][j];
  return K;
}

/* ---------------- model ---------------- */

export type Marks = { fixed: Set<number>; load: Set<number> };
/** Failure modes: 0 in a layer (along the lines), 1 between the layers, 2 between neighbouring lines of a layer. */
export type Mode = 0 | 1 | 2;
type Crit = { u: number; mode: Mode };
/** Traction of a stress (Voigt) on the plane with unit normal n: normal stress and shear magnitude. */
function onPlane(sg: Float64Array | number[], n: V3) {
  const sx = sg[0], sy = sg[1], sz = sg[2], tyz = sg[3], txz = sg[4], txy = sg[5];
  const t0 = sx * n[0] + txy * n[1] + txz * n[2], t1 = txy * n[0] + sy * n[1] + tyz * n[2], t2 = txz * n[0] + tyz * n[1] + sz * n[2];
  const sn = t0 * n[0] + t1 * n[1] + t2 * n[2];
  return { sn, tau: Math.hypot(t0 - sn * n[0], t1 - sn * n[1], t2 - sn * n[2]) };
}
/** Bond strengths of a printed plastic: between layers Y, S (measured); between neighbouring lines of one layer the
 *  lines are laid side by side while both are hot and pressed together by the nozzle — stronger than the layer bond
 *  but with voids and less entanglement than inside a line — taken halfway between Y and X, shear in proportion. */
export const lineBond = (X: number, Y: number, S: number) => { const Yl = (X + Y) / 2; return { Yl, Sl: (S * Yl) / Y }; };
/** Utilisation of a ply of lines along l in a layer normal to b, from its stress (Voigt): along the line |σ_l|/X,
 *  between neighbouring lines (plane normal b × l) and between layers (plane normal b) by (σ_n⁺/Y)² + (τ/S)². */
function plyCrit(sg: Float64Array | number[], l: V3, b: V3, X: number, Y: number, S: number, Yl: number, Sl: number): Crit {
  const along = Math.abs(onPlane(sg, l).sn) / X;
  const t: V3 = [b[1] * l[2] - b[2] * l[1], b[2] * l[0] - b[0] * l[2], b[0] * l[1] - b[1] * l[0]];
  const q = onPlane(sg, t), lines = Math.sqrt((Math.max(q.sn, 0) / Yl) ** 2 + (q.tau / Sl) ** 2);
  const r = onPlane(sg, b), layers = Math.sqrt((Math.max(r.sn, 0) / Y) ** 2 + (r.tau / S) ** 2);
  if (layers >= along && layers >= lines) return { u: layers, mode: 1 };
  return lines > along ? { u: lines, mode: 2 } : { u: along, mode: 0 };
}
const vonMises = (sg: Float64Array | number[]) => { const [sx, sy, sz, tyz, txz, txy] = sg; return Math.sqrt(0.5 * ((sx - sy) ** 2 + (sy - sz) ** 2 + (sz - sx) ** 2) + 3 * (tyz * tyz + txz * txz + txy * txy)); };
const mulC = (Cf: Float64Array, e: Float64Array | number[], o: number, k: number, out: Float64Array) => { for (let r = 0; r < 6; r++) { let a = 0; for (let c = 0; c < 6; c++) a += Cf[6 * r + c] * e[o + c]; out[r] = k * a; } return out; };

/** Eigenvalues (ascending) and the unit axis of the smallest one, of a symmetric 3 × 3 matrix (Jacobi rotations). */
function eigSym3(A: number[][]): { vals: number[]; n: V3 } {
  const a = A.map((r) => [...r]), V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 12; sweep++) for (const [pp, qq] of [[0, 1], [0, 2], [1, 2]]) {
    if (Math.abs(a[pp][qq]) < 1e-14 * (Math.abs(a[pp][pp]) + Math.abs(a[qq][qq]) + 1e-30)) continue;
    const th = 0.5 * Math.atan2(2 * a[pp][qq], a[qq][qq] - a[pp][pp]), c = Math.cos(th), sn = Math.sin(th);
    for (let r = 0; r < 3; r++) { const x = a[r][pp], y = a[r][qq]; a[r][pp] = c * x - sn * y; a[r][qq] = sn * x + c * y; }
    for (let r = 0; r < 3; r++) { const x = a[pp][r], y = a[qq][r]; a[pp][r] = c * x - sn * y; a[qq][r] = sn * x + c * y; }
    for (let r = 0; r < 3; r++) { const x = V[r][pp], y = V[r][qq]; V[r][pp] = c * x - sn * y; V[r][qq] = sn * x + c * y; }
  }
  const ev = [a[0][0], a[1][1], a[2][2]], s = ev.indexOf(Math.min(...ev));
  return { vals: [...ev].sort((x, y) => x - y), n: [V[0][s], V[1][s], V[2][s]] };
}
/**
 * Outward surface normal of a loaded area at one of its cubes: the plane fitted through the centres of the area's
 * cubes within 2.5 cubes (the outer cubes of a face lie in one plane, those of a gentle slope or a large hole close to
 * one), turned outward; where the area is too narrow for a plane (a line of cubes), the cubes' own normals averaged.
 */
export function surfaceNormal(v: Vox, nrm: ArrayLike<number>, area: Set<number>, id: number): V3 {
  const i0 = id % v.nx, j0 = Math.floor(id / v.nx) % v.ny, k0 = Math.floor(id / (v.nx * v.ny)), pts: number[][] = [], avg = [0, 0, 0];
  for (let c = -2; c <= 2; c++) for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) {
    if (a * a + b * b + c * c > 6.25) continue;
    const i = i0 + a, j = j0 + b, k = k0 + c; if (i < 0 || j < 0 || k < 0 || i >= v.nx || j >= v.ny || k >= v.nz) continue;
    const q = vIdx(v, i, j, k); if (!area.has(q)) continue;
    pts.push([a, b, c]); for (let d = 0; d < 3; d++) avg[d] += nrm[3 * q + d];
  }
  const al = Math.hypot(avg[0], avg[1], avg[2]) || 1, out: V3 = [avg[0] / al, avg[1] / al, avg[2] / al];
  if (pts.length < 3) return out;
  const m = [0, 0, 0]; for (const q of pts) for (let d = 0; d < 3; d++) m[d] += q[d] / pts.length;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const q of pts) for (let r = 0; r < 3; r++) for (let s2 = 0; s2 < 3; s2++) C[r][s2] += ((q[r] - m[r]) * (q[s2] - m[s2])) / pts.length;
  // a plane needs spread in two directions (the middle eigenvalue, in cubes²)
  const { vals, n } = eigSym3(C);
  if (vals[1] < 0.1) return out;
  const sg = n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0 ? -1 : 1;
  return [sg * n[0], sg * n[1], sg * n[2]];
}

export function buildModel(v: Vox, marks: Marks, p: LabIn) {
  const M = PS_FILS[p.fil], iso = p.iso, b = buildVec(p.theta, p.phi), h = v.h, rho = iso ? 1 : Math.min(1, Math.max(0, p.infill));
  const { depth, nrm } = depthAndNormals(v), tw = Math.max(1, p.walls) * LINE_W, ts = Math.max(1, p.skins) * LAYER_H;
  // shell share of a cube: the shell (walls or skins, thickness t) measured from the true surface — an outer cube holds
  // only fill·h of material under it
  const fsOf = (id: number, bb: V3) => {
    if (iso) return 1;
    const c = nrm[3 * id] * bb[0] + nrm[3 * id + 1] * bb[1] + nrm[3 * id + 2] * bb[2], t = tw + (ts - tw) * c * c;
    return Math.min(1, Math.max(0, depth[id] === 1 ? t / Math.max(1e-9, fillOf(v, id) * h) : (t - (depth[id] - 1) * h) / h));
  };
  // active cubes: solid, stiff enough, joined through faces to a support
  const n = v.solid.length, active = new Uint8Array(n);
  for (let id = 0; id < n; id++) if (v.solid[id] && fsOf(id, b) + (1 - fsOf(id, b)) * rho * rho > 1e-6) active[id] = 1;
  const keep = new Uint8Array(n), q: number[] = [];
  for (const id of marks.fixed) if (active[id]) { keep[id] = 1; q.push(id); }
  for (let qi = 0; qi < q.length; qi++) {
    const id = q[qi], i = id % v.nx, j = Math.floor(id / v.nx) % v.ny, k = Math.floor(id / (v.nx * v.ny));
    for (const [a, bb, c] of FACE_NB) { const ii = i + a, jj = j + bb, kk = k + c; if (ii < 0 || jj < 0 || kk < 0 || ii >= v.nx || jj >= v.ny || kk >= v.nz) continue; const nid = vIdx(v, ii, jj, kk); if (active[nid] && !keep[nid]) { keep[nid] = 1; q.push(nid); } }
  }
  const elems = q; // voxel ids of the elements
  const ne = elems.length, nodeOf = new Map<number, number>(), edof = new Int32Array(24 * ne), scale = new Float64Array(ne), fs = new Float64Array(ne), fill = new Float64Array(ne);
  const elemOf = new Int32Array(n).fill(-1);
  const gNode = (i: number, j: number, k: number) => i + (v.nx + 1) * (j + (v.ny + 1) * k);
  elems.forEach((id, e) => {
    elemOf[id] = e;
    const i = id % v.nx, j = Math.floor(id / v.nx) % v.ny, k = Math.floor(id / (v.nx * v.ny));
    NODE.forEach(([a, bb, c], m) => { const g = gNode(i + a, j + bb, k + c); let nd = nodeOf.get(g); if (nd === undefined) { nd = nodeOf.size; nodeOf.set(g, nd); } for (let d = 0; d < 3; d++) edof[24 * e + 3 * m + d] = 3 * nd + d; });
    fs[e] = fsOf(id, b); fill[e] = fillOf(v, id); scale[e] = fill[e] * (fs[e] + (1 - fs[e]) * rho * rho);
  });
  // element stiffness = shell share × K of its ply class + infill share × K of the skin/infill pattern
  const lines: Lines = iso ? 'cross' : p.lines ?? 'cross', alpha = p.alpha ?? 0, { ex, ey } = bedFrame(b);
  const classes = iso ? [] : plyClasses(M.E1, M.E2, b, lines, alpha);
  const pA = new Uint8Array(ne), wA = new Float64Array(ne), pB = new Uint8Array(ne), wB = new Float64Array(ne);
  for (let e = 0; e < ne; e++) {
    // a part-filled cube is as stiff as its fill (cubes on a sloped or curved face)
    if (iso) { wA[e] = fill[e]; continue; }
    pA[e] = shellClass(nrm, elems[e], b, ex, ey); wA[e] = fill[e] * fs[e]; pB[e] = NBIN; wB[e] = fill[e] * (1 - fs[e]) * rho * rho;
    if (pA[e] === pB[e]) { wA[e] += wB[e]; wB[e] = 0; }
  }
  const Ks: Float64Array[] = iso ? [brickK(isoStiffness(iso.E, iso.nu), h)] : [];
  if (!iso) { const used = new Set<number>([...pA, ...pB]); for (let k = 0; k <= NBIN; k++) Ks.push(used.has(k) ? brickK(classes[k].C, h) : new Float64Array(0)); }
  const ndof = 3 * nodeOf.size, fixed = new Uint8Array(ndof), f = new Float64Array(ndof);
  for (const id of marks.fixed) { const e = elemOf[id]; if (e < 0) continue; for (let m = 0; m < 24; m++) fixed[edof[24 * e + m]] = 1; }
  // load: a force is shared equally by the free nodes on the outside faces of its area (nodes shared with a held
  // cube carry nothing, so the force must go to the others); a pressure acts on every outside face of the area with
  // its area h² projected on the local surface normal n (fitted through the cube centres around it), along −n — the
  // cube steps of a sloped face add up to its true area, and faces of a neighbouring surface (the side faces of a cube
  // on the edge of the area) carry nothing; each face's force goes to its free nodes
  const loadNodes = new Set<number>(), pressure = p.load === 'pressure';
  const groups = p.groups && p.groups.length ? p.groups : [{ ids: [...marks.load], F: p.F, dir: p.dir }];
  for (const gr of groups) {
    const nodes = new Set<number>(), inGroup = new Set(gr.ids), fn: number[] = [];
    for (const id of gr.ids) {
      const e = elemOf[id]; if (e < 0) continue;
      const i = id % v.nx, j = Math.floor(id / v.nx) % v.ny, k = Math.floor(id / (v.nx * v.ny));
      const n = pressure ? surfaceNormal(v, nrm, inGroup, id) : null;
      FACE_NB.forEach(([a, bb, c]) => {
        const ii = i + a, jj = j + bb, kk = k + c, out = ii < 0 || jj < 0 || kk < 0 || ii >= v.nx || jj >= v.ny || kk >= v.nz || !v.solid[vIdx(v, ii, jj, kk)];
        if (!out) return;
        fn.length = 0;
        NODE.forEach(([na, nb, nc], m) => {
          if ((a && na !== (a > 0 ? 1 : 0)) || (bb && nb !== (bb > 0 ? 1 : 0)) || (c && nc !== (c > 0 ? 1 : 0))) return;
          const nd = edof[24 * e + 3 * m] / 3; nodes.add(nd); loadNodes.add(nd);
          if (!fixed[3 * nd]) fn.push(nd);
        });
        if (!n || !fn.length) return;
        const w = Math.max(0, a * n[0] + bb * n[1] + c * n[2]), q = (gr.F * h * h * w) / fn.length;
        for (const nd of fn) for (let d = 0; d < 3; d++) f[3 * nd + d] -= q * n[d];
      });
    }
    if (pressure) continue;
    const dl = Math.hypot(...gr.dir) || 1, fd: V3 = [gr.dir[0] / dl, gr.dir[1] / dl, gr.dir[2] / dl], free = [...nodes].filter((nd) => !fixed[3 * nd]);
    for (const nd of free) for (let d = 0; d < 3; d++) f[3 * nd + d] += (gr.F * fd[d]) / free.length;
  }
  // own weight: ρ g V of every cube (shell and infill share of a printed one), an eighth to each corner [N]
  let weight = 0;
  if (p.grav && p.grav > 0) {
    const gd = p.gdir ?? [0, 0, -1], gl = Math.hypot(...gd) || 1, dens = iso ? iso.rho : M.rho;
    for (let e = 0; e < ne; e++) {
      const w = dens * 1e-6 * h ** 3 * fill[e] * (fs[e] + (1 - fs[e]) * rho) * 9.81 * p.grav; weight += w;
      for (let m = 0; m < 8; m++) for (let d = 0; d < 3; d++) f[edof[24 * e + 3 * m] + d] += (w / 8) * (gd[d] / gl);
    }
  }
  for (let d = 0; d < ndof; d++) if (fixed[d]) f[d] = 0;
  const fres: V3 = [0, 0, 0]; for (let d = 0; d < ndof; d++) fres[d % 3] += f[d];
  const nFixedEl = [...marks.fixed].filter((id) => elemOf[id] >= 0).length, nLoadEl = [...marks.load].filter((id) => elemOf[id] >= 0).length;
  const gnodes = new Int32Array(nodeOf.size); nodeOf.forEach((c, g) => { gnodes[c] = g; });
  // cubes left out of the search for the critical point: those within max(2 mm, 1.6 cubes) of a held cube (a perfectly
  // rigid clamp gives false peaks at its edge that grow as the cubes get smaller) and the loaded cubes (a load on a few
  // nodes does the same)
  const skip = new Uint8Array(ne), D = Math.max(2, 1.6 * h), rc = Math.ceil(D / h), D2 = (D / h) ** 2;
  for (const id of marks.fixed) {
    if (elemOf[id] < 0) continue;
    const i = id % v.nx, j = Math.floor(id / v.nx) % v.ny, k = Math.floor(id / (v.nx * v.ny));
    for (let c = -rc; c <= rc; c++) for (let bb = -rc; bb <= rc; bb++) for (let a = -rc; a <= rc; a++) {
      if (a * a + bb * bb + c * c > D2) continue;
      const ii = i + a, jj = j + bb, kk = k + c; if (ii < 0 || jj < 0 || kk < 0 || ii >= v.nx || jj >= v.ny || kk >= v.nz) continue;
      const e2 = elemOf[vIdx(v, ii, jj, kk)]; if (e2 >= 0) skip[e2] = 1;
    }
  }
  for (const id of marks.load) if (elemOf[id] >= 0) skip[elemOf[id]] = 1;
  if (skip.every((x) => x)) skip.fill(0);
  return { v, M, b, rho, h, elems, elemOf, ne, ndof, edof, scale, fs, fill, fixed, f, Ks, pA, wA, pB, wB, depth, nrm, tw, ts, fsOf, gnodes, skip, nFixedEl, nLoadEl, nLoadNodes: loadNodes.size, iso, weight, fres, dropped: [...marks.load].filter((id) => v.solid[id] && elemOf[id] < 0).length,
    lines, alpha };
}
export type Model = ReturnType<typeof buildModel>;

function matvec(md: Model, x: Float64Array, y: Float64Array) {
  y.fill(0);
  const { Ks, pA, wA, pB, wB, edof, ne } = md, ue = new Float64Array(24);
  const add = (K: Float64Array, s: number, o: number) => { for (let i = 0; i < 24; i++) { let acc = 0; const r = 24 * i; for (let j = 0; j < 24; j++) acc += K[r + j] * ue[j]; y[edof[o + i]] += s * acc; } };
  for (let e = 0; e < ne; e++) {
    const o = 24 * e;
    for (let i = 0; i < 24; i++) ue[i] = x[edof[o + i]];
    if (wA[e]) add(Ks[pA[e]], wA[e], o);
    if (wB[e]) add(Ks[pB[e]], wB[e], o);
  }
  for (let d = 0; d < y.length; d++) if (md.fixed[d]) y[d] = x[d];
}

export type Progress = { it: number; res: number };
/** Preconditioned conjugate gradients; yields after every iteration, returns the displacements. */
export function* solveCG(md: Model, tol = 1e-5, maxIt = 4000): Generator<Progress, { u: Float64Array; it: number; res: number; converged: boolean }, unknown> {
  const n = md.ndof, u = new Float64Array(n), r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), q = new Float64Array(n), dg = new Float64Array(n);
  for (let e = 0; e < md.ne; e++) for (let i = 0; i < 24; i++) dg[md.edof[24 * e + i]] += md.wA[e] * md.Ks[md.pA[e]][25 * i] + (md.wB[e] ? md.wB[e] * md.Ks[md.pB[e]][25 * i] : 0);
  for (let d = 0; d < n; d++) { if (md.fixed[d]) dg[d] = 1; r[d] = md.fixed[d] ? 0 : md.f[d]; }
  const f0 = Math.sqrt(r.reduce((s, x) => s + x * x, 0)) || 1;
  for (let d = 0; d < n; d++) { z[d] = r[d] / dg[d]; p[d] = z[d]; }
  let rz = 0; for (let d = 0; d < n; d++) rz += r[d] * z[d];
  let it = 0, res = 1;
  for (; it < maxIt; it++) {
    matvec(md, p, q);
    let pq = 0; for (let d = 0; d < n; d++) pq += p[d] * q[d];
    if (!(pq > 0)) break;
    const a = rz / pq; let rr = 0;
    for (let d = 0; d < n; d++) { u[d] += a * p[d]; r[d] -= a * q[d]; rr += r[d] * r[d]; }
    res = Math.sqrt(rr) / f0;
    if (res < tol) { it++; break; }
    let rz2 = 0; for (let d = 0; d < n; d++) { z[d] = r[d] / dg[d]; rz2 += r[d] * z[d]; }
    const be = rz2 / rz; rz = rz2;
    for (let d = 0; d < n; d++) p[d] = z[d] + be * p[d];
    yield { it, res };
  }
  return { u, it, res, converged: res < tol };
}

/** Strain at every cube's centre (Voigt, engineering shear). */
export function strains(md: Model, u: Float64Array) {
  const B0 = Bmat(md.h, 0, 0, 0), eps = new Float64Array(6 * md.ne);
  for (let e = 0; e < md.ne; e++) for (let r = 0; r < 6; r++) { let s = 0; for (let j = 0; j < 24; j++) if (B0[r][j]) s += B0[r][j] * u[md.edof[24 * e + j]]; eps[6 * e + r] = s; }
  return eps;
}

/**
 * Strains averaged with the neighbouring cubes (face neighbours weight 0.6, edge neighbours 0.35) of the same kind
 * (surface with surface, inside with inside): the steps of a cube model of a sloped or curved face give false strain
 * peaks one cube wide; averaging over about 1.5 cubes removes them while a bending gradient across the part stays
 * (the stress over a small distance, as in the critical-distance method for notches). Cached per strain field.
 */
const smoothCache = new WeakMap<Float64Array, Float64Array>();
export function smoothStrains(md: Model, eps: Float64Array) {
  const hit = smoothCache.get(eps); if (hit) return hit;
  const { v, ne } = md, out = new Float64Array(6 * ne), surf = new Uint8Array(ne);
  const elAt = (i: number, j: number, k: number) => (i < 0 || j < 0 || k < 0 || i >= v.nx || j >= v.ny || k >= v.nz ? -1 : md.elemOf[vIdx(v, i, j, k)]);
  for (let e = 0; e < ne; e++) { const id = md.elems[e], i = id % v.nx, j = Math.floor(id / v.nx) % v.ny, k = Math.floor(id / (v.nx * v.ny)); for (const [a, b, c] of FACE_NB) if (elAt(i + a, j + b, k + c) < 0) { surf[e] = 1; break; } }
  for (let e = 0; e < ne; e++) {
    const id = md.elems[e], i = id % v.nx, j = Math.floor(id / v.nx) % v.ny, k = Math.floor(id / (v.nx * v.ny));
    let W = 1; for (let r = 0; r < 6; r++) out[6 * e + r] = eps[6 * e + r];
    for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const m = Math.abs(di) + Math.abs(dj) + Math.abs(dk); if (m === 0 || m === 3) continue;
      const e2 = elAt(i + di, j + dj, k + dk); if (e2 < 0 || surf[e2] !== surf[e]) continue;
      const w = m === 1 ? 0.6 : 0.35; W += w;
      for (let r = 0; r < 6; r++) out[6 * e + r] += w * eps[6 * e2 + r];
    }
    for (let r = 0; r < 6; r++) out[6 * e + r] /= W;
  }
  smoothCache.set(eps, out);
  return out;
}

/**
 * Utilisation of every cube for a build direction b (and line angle α): ply classes of that direction, strains as
 * solved. Shell and infill are checked ply by ply with the stress C_ply ε (infill: ρ² C_ply ε, strength × ρ^1.5).
 * A cube on the surface is also checked with the strain extrapolated linearly from its centre and the next cube
 * inward to the outer face (the centre of a surface cube lies half a cube under the surface); then surface values are
 * averaged with the surface neighbours to damp the false peaks of voxel steps. Returns the field, the critical cube,
 * its mode and the smeared stress of every cube (Voigt).
 */
export function evaluate(md: Model, eps: Float64Array, b: V3, alpha = md.alpha) {
  const { M, ne, rho, v } = md, E = smoothStrains(md, eps), raw = new Float64Array(ne), inter = new Uint8Array(ne), surf = new Uint8Array(ne), sg = new Float64Array(6 * ne);
  const nbE = (id: number, a: number, bb: number, c: number) => { const i = id % v.nx + a, j = (Math.floor(id / v.nx) % v.ny) + bb, k = Math.floor(id / (v.nx * v.ny)) + c; return i < 0 || j < 0 || k < 0 || i >= v.nx || j >= v.ny || k >= v.nz ? -1 : md.elemOf[vIdx(v, i, j, k)]; };
  const iso = md.iso, Ciso = iso ? Float64Array.from(isoStiffness(iso.E, iso.nu).flat()) : null;
  const cls = iso ? [] : plyClasses(M.E1, M.E2, b, md.lines, alpha), { ex, ey } = bedFrame(b), { Yl, Sl } = lineBond(M.X, M.Y, M.S);
  const st = new Float64Array(6), ext = new Float64Array(6), CF = cls.map((c) => Float64Array.from(c.C.flat()));
  const crit = (e8: Float64Array | number[], o: number, fs: number, ca: number): Crit => {
    if (Ciso) return { u: vonMises(mulC(Ciso, e8, o, 1, st)) / iso!.fy, mode: 0 };
    let best: Crit = { u: 0, mode: 0 };
    if (fs > 0) { const c = cls[ca]; for (let k = 0; k < c.l.length; k++) { const q = plyCrit(mulC(c.Cp[k], e8, o, 1, st), c.l[k], b, M.X, M.Y, M.S, Yl, Sl); if (q.u > best.u) best = q; } }
    if (fs < 1 && rho > 0) { const c = cls[NBIN]; for (let k = 0; k < c.l.length; k++) { const q = plyCrit(mulC(c.Cp[k], e8, o, rho * rho, st), c.l[k], b, M.X, M.Y, M.S, Yl, Sl); q.u /= rho ** 1.5; if (q.u > best.u) best = q; } }
    return best;
  };
  for (let e = 0; e < ne; e++) {
    const id = md.elems[e], fs = iso ? 1 : md.fsOf(id, b), ca = iso ? 0 : shellClass(md.nrm, id, b, ex, ey);
    // smeared stress of the cube (shell + infill)
    if (Ciso) mulC(Ciso, E, 6 * e, 1, st); else {
      const A = CF[ca], B = CF[NBIN];
      for (let r = 0; r < 6; r++) { let a = 0; for (let c = 0; c < 6; c++) a += (fs * A[6 * r + c] + (1 - fs) * rho * rho * B[6 * r + c]) * E[6 * e + c]; st[r] = a; }
    }
    for (let r = 0; r < 6; r++) sg[6 * e + r] = st[r];
    let best = crit(E, 6 * e, fs, ca);
    for (const [a, bb, c] of FACE_NB) {
      if (nbE(id, a, bb, c) >= 0) continue; // not an outer face
      surf[e] = 1;
      const inn = nbE(id, -a, -bb, -c); if (inn < 0) continue;
      for (let r = 0; r < 6; r++) ext[r] = 1.5 * E[6 * e + r] - 0.5 * E[6 * inn + r];
      const x = crit(ext, 0, fs, ca); if (x.u > best.u) best = x;
    }
    raw[e] = best.u; inter[e] = best.mode;
  }
  const sm = new Float64Array(ne);
  let critE = 0;
  for (let e = 0; e < ne; e++) {
    const id = md.elems[e]; let s = raw[e], c = 1;
    for (const [a, bb, cc] of FACE_NB) { const n2 = nbE(id, a, bb, cc); if (n2 >= 0 && surf[n2] === surf[e]) { s += raw[n2]; c++; } }
    sm[e] = s / c;
  }
  while (critE < ne - 1 && md.skip[critE]) critE++;
  for (let e = 0; e < ne; e++) if (!md.skip[e] && sm[e] > sm[critE]) critE = e;
  return { u: sm, raw, inter, crit: critE, umax: sm[critE] || 1e-30, interlayer: inter[critE] === 1, mode: inter[critE] as Mode, sg };
}

/** Build directions to compare: arcs from the file's z axis towards x and towards y, and a coarse hemisphere. */
export function sweepDirs() {
  const arcs: { theta: number; phi: number }[] = [];
  for (let t = 0; t <= 90; t += 7.5) arcs.push({ theta: t, phi: 0 });
  for (let t = 7.5; t <= 90; t += 7.5) arcs.push({ theta: t, phi: 90 });
  const extra: { theta: number; phi: number }[] = [];
  for (const t of [22.5, 45, 67.5, 90]) for (let ph = 0; ph < 360; ph += 45) if (!(t === 90 && ph >= 180) && ph !== 0 && ph !== 90) extra.push({ theta: t, phi: ph });
  return { arcs, extra };
}

/** Failure load for every sweep direction (strains of the solved direction reused — the stiffness change between
 *  directions is ignored). Yields after each direction. */
export function* orientationSweep(md: Model, eps: Float64Array, F: number) {
  const { arcs, extra } = sweepDirs(), out: { theta: number; phi: number; Ff: number }[] = [];
  for (const d of [...arcs, ...extra]) { const r = evaluate(md, eps, buildVec(d.theta, d.phi)); out.push({ ...d, Ff: F / r.umax }); yield; }
  return out;
}

/** Failure load against the line angle on the bed (lines in one direction; strains reused), every 15°. */
export function* lineSweep(md: Model, eps: Float64Array, F: number) {
  const out: { alpha: number; Ff: number }[] = [];
  for (let a = 0; a < 180; a += 15) { out.push({ alpha: a, Ff: F / evaluate(md, eps, md.b, a).umax }); yield; }
  return out;
}

/** Mass of the printed part: solid shell plus infill core [g]. */
export function partMass(md: Model) { let v = 0; for (let e = 0; e < md.ne; e++) v += md.fill[e] * (md.fs[e] + (1 - md.fs[e]) * md.rho); return (v * md.h ** 3 * (md.iso ? md.iso.rho : md.M.rho)) / 1000; }

/* ---------------- multigrid preconditioner ---------------- */

/**
 * Levels of a geometric multigrid on the node grid: the fine operator assembled as a 27-point block stencil (3 × 3
 * block per neighbour), coarse operators by the Galerkin product Pᵀ A P with trilinear P (robust for the stiffness jump
 * between walls and infill), block symmetric Gauss–Seidel smoothing and a dense Cholesky solve on the coarsest grid.
 */
type MGLevel = {
  nn: number; gx: number; gy: number; gz: number; gnodes: Int32Array; nodeOf: Map<number, number>;
  A: Float64Array; nbr: Int32Array; Dinv: Float64Array; fixed: Uint8Array; P?: { idx: Int32Array; w: Float64Array }; chol?: Float64Array;
};

function finishLevel(L: MGLevel) {
  const { nn, A, fixed } = L;
  // held dofs: their rows and columns become identity
  for (let n = 0; n < nn; n++) for (let sl = 0; sl < 27; sl++) {
    const m = L.nbr[27 * n + sl]; if (m < 0) continue;
    const o = 243 * n + 9 * sl;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (fixed[3 * n + r] || fixed[3 * m + c]) A[o + 3 * r + c] = m === n && r === c ? 1 : 0;
  }
  L.Dinv = new Float64Array(9 * nn);
  for (let n = 0; n < nn; n++) {
    const o = 243 * n + 9 * 13, a = A.subarray(o, o + 9); // slot 13 = the node itself
    const d = a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6]);
    if (!(Math.abs(d) > 1e-300)) { for (let k = 0; k < 3; k++) L.Dinv[9 * n + 4 * k] = 1; continue; }
    const iv = [a[4] * a[8] - a[5] * a[7], a[2] * a[7] - a[1] * a[8], a[1] * a[5] - a[2] * a[4], a[5] * a[6] - a[3] * a[8], a[0] * a[8] - a[2] * a[6], a[2] * a[3] - a[0] * a[5], a[3] * a[7] - a[4] * a[6], a[1] * a[6] - a[0] * a[7], a[0] * a[4] - a[1] * a[3]];
    for (let k = 0; k < 9; k++) L.Dinv[9 * n + k] = iv[k] / d;
  }
}

function fineLevel(md: Model): MGLevel {
  const v = md.v, gx = v.nx + 1, gy = v.ny + 1, gz = v.nz + 1, nn = md.gnodes.length, nodeOf = new Map<number, number>();
  md.gnodes.forEach((g, c) => nodeOf.set(g, c));
  const nbr = new Int32Array(27 * nn).fill(-1), A = new Float64Array(243 * nn), fixed = new Uint8Array(3 * nn);
  for (let d = 0; d < md.ndof; d++) fixed[d] = md.fixed[d];
  for (let e = 0; e < md.ne; e++) {
    const sA = md.wA[e], KA = md.Ks[md.pA[e]], sB = md.wB[e], KB = sB ? md.Ks[md.pB[e]] : KA;
    for (let a = 0; a < 8; a++) {
      const na = md.edof[24 * e + 3 * a] / 3, [ai, aj, ak] = NODE[a];
      for (let b2 = 0; b2 < 8; b2++) {
        const nb2 = md.edof[24 * e + 3 * b2] / 3, [bi, bj, bk] = NODE[b2], sl = (bi - ai + 1) + 3 * (bj - aj + 1) + 9 * (bk - ak + 1);
        nbr[27 * na + sl] = nb2;
        const o = 243 * na + 9 * sl;
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { const q = 24 * (3 * a + r) + 3 * b2 + c; A[o + 3 * r + c] += sA * KA[q] + (sB ? sB * KB[q] : 0); }
      }
    }
  }
  const L: MGLevel = { nn, gx, gy, gz, gnodes: md.gnodes, nodeOf, A, nbr, Dinv: new Float64Array(0), fixed };
  finishLevel(L);
  return L;
}

/** Coarse level: coarse nodes at the even fine nodes, trilinear prolongation, Galerkin Pᵀ A P. */
function coarseLevel(F: MGLevel): MGLevel {
  const gx = Math.floor((F.gx - 1) / 2) + 2, gy = Math.floor((F.gy - 1) / 2) + 2, gz = Math.floor((F.gz - 1) / 2) + 2, nodeOf = new Map<number, number>();
  const idx = new Int32Array(8 * F.nn).fill(-1), w = new Float64Array(8 * F.nn), gl: number[] = [];
  for (let n = 0; n < F.nn; n++) {
    const g = F.gnodes[n], i = g % F.gx, j = Math.floor(g / F.gx) % F.gy, k = Math.floor(g / (F.gx * F.gy));
    const is = i & 1 ? [i >> 1, (i >> 1) + 1] : [i >> 1], js = j & 1 ? [j >> 1, (j >> 1) + 1] : [j >> 1], ks = k & 1 ? [k >> 1, (k >> 1) + 1] : [k >> 1];
    const wt = 1 / (is.length * js.length * ks.length); let c = 0;
    for (const I of is) for (const J of js) for (const K of ks) { const cg = I + gx * (J + gy * K); let cn = nodeOf.get(cg); if (cn === undefined) { cn = nodeOf.size; nodeOf.set(cg, cn); gl.push(cg); } idx[8 * n + c] = cn; w[8 * n + c] = wt; c++; }
  }
  F.P = { idx, w };
  const nn = nodeOf.size, nbr = new Int32Array(27 * nn).fill(-1), A = new Float64Array(243 * nn), fixed = new Uint8Array(3 * nn);
  const gnodes = Int32Array.from(gl), cxyz = (cn: number) => { const g = gnodes[cn]; return [g % gx, Math.floor(g / gx) % gy, Math.floor(g / (gx * gy))]; };
  for (let n = 0; n < F.nn; n++) for (let sl = 0; sl < 27; sl++) {
    const m = F.nbr[27 * n + sl]; if (m < 0) continue;
    const fo = 243 * n + 9 * sl;
    for (let p = 0; p < 8; p++) {
      const c1 = idx[8 * n + p]; if (c1 < 0) break;
      const w1 = w[8 * n + p], [x1, y1, z1] = cxyz(c1);
      for (let q = 0; q < 8; q++) {
        const c2 = idx[8 * m + q]; if (c2 < 0) break;
        const ww = w1 * w[8 * m + q], [x2, y2, z2] = cxyz(c2), csl = (x2 - x1 + 1) + 3 * (y2 - y1 + 1) + 9 * (z2 - z1 + 1);
        nbr[27 * c1 + csl] = c2;
        const co = 243 * c1 + 9 * csl;
        for (let r = 0; r < 3; r++) { if (F.fixed[3 * n + r]) continue; for (let c = 0; c < 3; c++) { if (F.fixed[3 * m + c]) continue; A[co + 3 * r + c] += ww * F.A[fo + 3 * r + c]; } }
      }
    }
  }
  // a coarse dof with nothing on its diagonal (all its fine dofs held) is held too
  for (let cn = 0; cn < nn; cn++) for (let r = 0; r < 3; r++) if (!(A[243 * cn + 9 * 13 + 4 * r] > 0)) fixed[3 * cn + r] = 1;
  const L: MGLevel = { nn, gx, gy, gz, gnodes, nodeOf, A, nbr, Dinv: new Float64Array(0), fixed };
  finishLevel(L);
  return L;
}

/** Dense Cholesky factor of the coarsest operator (lower triangle, row-major). */
function cholesky(L: MGLevel) {
  const n = 3 * L.nn, M = new Float64Array(n * n);
  for (let a = 0; a < L.nn; a++) for (let sl = 0; sl < 27; sl++) { const b = L.nbr[27 * a + sl]; if (b < 0) continue; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) M[(3 * a + r) * n + 3 * b + c] = L.A[243 * a + 9 * sl + 3 * r + c]; }
  for (let j = 0; j < n; j++) {
    let d = M[j * n + j]; for (let k = 0; k < j; k++) d -= M[j * n + k] ** 2;
    d = Math.sqrt(Math.max(d, 1e-30)); M[j * n + j] = d;
    for (let i = j + 1; i < n; i++) { let s = M[i * n + j]; for (let k = 0; k < j; k++) s -= M[i * n + k] * M[j * n + k]; M[i * n + j] = s / d; }
  }
  L.chol = M;
}
function cholSolve(L: MGLevel, b: Float64Array, x: Float64Array) {
  const n = 3 * L.nn, M = L.chol!;
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= M[i * n + k] * x[k]; x[i] = s / M[i * n + i]; }
  for (let i = n - 1; i >= 0; i--) { let s = x[i]; for (let k = i + 1; k < n; k++) s -= M[k * n + i] * x[k]; x[i] = s / M[i * n + i]; }
}

export function buildLevels(md: Model) {
  const levels = [fineLevel(md)];
  while (levels[levels.length - 1].nn > 220 && levels.length < 8) { const c = coarseLevel(levels[levels.length - 1]); if (c.nn >= levels[levels.length - 1].nn * 0.7) break; levels.push(c); }
  const last = levels[levels.length - 1];
  if (last.nn <= 600) cholesky(last);
  return levels;
}

function mul(L: MGLevel, x: Float64Array, y: Float64Array) {
  const { A, nbr, nn } = L;
  for (let n = 0; n < nn; n++) {
    let y0 = 0, y1 = 0, y2 = 0; const ob = 27 * n, oa = 243 * n;
    for (let sl = 0; sl < 27; sl++) {
      const m = nbr[ob + sl]; if (m < 0) continue;
      const o = oa + 9 * sl, x0 = x[3 * m], x1 = x[3 * m + 1], x2 = x[3 * m + 2];
      y0 += A[o] * x0 + A[o + 1] * x1 + A[o + 2] * x2; y1 += A[o + 3] * x0 + A[o + 4] * x1 + A[o + 5] * x2; y2 += A[o + 6] * x0 + A[o + 7] * x1 + A[o + 8] * x2;
    }
    y[3 * n] = y0; y[3 * n + 1] = y1; y[3 * n + 2] = y2;
  }
}
/** One block Gauss–Seidel sweep (forward or backward) on A x = b. */
function gs(L: MGLevel, b: Float64Array, x: Float64Array, forward: boolean) {
  const { A, nbr, nn, Dinv } = L;
  for (let t = 0; t < nn; t++) {
    const n = forward ? t : nn - 1 - t, ob = 27 * n, oa = 243 * n;
    let r0 = b[3 * n], r1 = b[3 * n + 1], r2 = b[3 * n + 2];
    for (let sl = 0; sl < 27; sl++) {
      if (sl === 13) continue;
      const m = nbr[ob + sl]; if (m < 0) continue;
      const o = oa + 9 * sl, x0 = x[3 * m], x1 = x[3 * m + 1], x2 = x[3 * m + 2];
      r0 -= A[o] * x0 + A[o + 1] * x1 + A[o + 2] * x2; r1 -= A[o + 3] * x0 + A[o + 4] * x1 + A[o + 5] * x2; r2 -= A[o + 6] * x0 + A[o + 7] * x1 + A[o + 8] * x2;
    }
    const d = 9 * n;
    x[3 * n] = Dinv[d] * r0 + Dinv[d + 1] * r1 + Dinv[d + 2] * r2; x[3 * n + 1] = Dinv[d + 3] * r0 + Dinv[d + 4] * r1 + Dinv[d + 5] * r2; x[3 * n + 2] = Dinv[d + 6] * r0 + Dinv[d + 7] * r1 + Dinv[d + 8] * r2;
  }
}

const work = new WeakMap<MGLevel, { tmp: Float64Array; rc?: Float64Array; zc?: Float64Array }>();
/** Symmetric V-cycle: forward Gauss–Seidel down, backward up (so the preconditioner stays symmetric for CG). */
function vcycle(levels: MGLevel[], l: number, r: Float64Array, z: Float64Array) {
  const L = levels[l], n = 3 * L.nn;
  z.fill(0);
  if (l === levels.length - 1) { if (L.chol) cholSolve(L, r, z); else for (let s = 0; s < 20; s++) { gs(L, r, z, true); gs(L, r, z, false); } return; }
  let W = work.get(L); if (!W) { const c = 3 * levels[l + 1].nn; W = { tmp: new Float64Array(n), rc: new Float64Array(c), zc: new Float64Array(c) }; work.set(L, W); }
  const C = levels[l + 1], { idx, w } = L.P!, tmp = W.tmp, rc = W.rc!, zc = W.zc!;
  gs(L, r, z, true);
  mul(L, z, tmp); for (let d = 0; d < n; d++) tmp[d] = L.fixed[d] ? 0 : r[d] - tmp[d];
  rc.fill(0);
  for (let i = 0; i < L.nn; i++) for (let p = 0; p < 8; p++) { const c = idx[8 * i + p]; if (c < 0) break; const wt = w[8 * i + p]; for (let k = 0; k < 3; k++) if (!L.fixed[3 * i + k]) rc[3 * c + k] += wt * tmp[3 * i + k]; }
  for (let d = 0; d < 3 * C.nn; d++) if (C.fixed[d]) rc[d] = 0;
  vcycle(levels, l + 1, rc, zc);
  for (let i = 0; i < L.nn; i++) for (let p = 0; p < 8; p++) { const c = idx[8 * i + p]; if (c < 0) break; const wt = w[8 * i + p]; for (let k = 0; k < 3; k++) if (!L.fixed[3 * i + k]) z[3 * i + k] += wt * zc[3 * c + k]; }
  gs(L, r, z, false);
}

/** Conjugate gradients preconditioned by the multigrid V-cycle; yields after the set-up and every iteration. */
export function* solveMG(md: Model, tol = 1e-5, maxIt = 300): Generator<Progress, { u: Float64Array; it: number; res: number; converged: boolean }, unknown> {
  const levels = buildLevels(md), L = levels[0], n = 3 * L.nn;
  yield { it: 0, res: 1 };
  const u = new Float64Array(n), r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), q = new Float64Array(n);
  for (let d = 0; d < n; d++) r[d] = L.fixed[d] ? 0 : md.f[d];
  const f0 = Math.sqrt(r.reduce((s, x) => s + x * x, 0)) || 1;
  vcycle(levels, 0, r, z); p.set(z);
  let rz = 0; for (let d = 0; d < n; d++) rz += r[d] * z[d];
  let it = 0, res = 1;
  for (; it < maxIt; it++) {
    mul(L, p, q);
    let pq = 0; for (let d = 0; d < n; d++) pq += p[d] * q[d];
    if (!(pq > 0)) break;
    const a = rz / pq; let rr = 0;
    for (let d = 0; d < n; d++) { u[d] += a * p[d]; r[d] -= a * q[d]; rr += r[d] * r[d]; }
    res = Math.sqrt(rr) / f0;
    yield { it: it + 1, res };
    if (res < tol) { it++; break; }
    vcycle(levels, 0, r, z);
    let rz2 = 0; for (let d = 0; d < n; d++) rz2 += r[d] * z[d];
    const be = rz2 / rz; rz = rz2;
    for (let d = 0; d < n; d++) p[d] = z[d] + be * p[d];
  }
  return { u, it, res, converged: res < tol };
}
