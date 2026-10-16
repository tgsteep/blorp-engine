/**
 * General static analysis of the user's own part (FEM hub): the print lab's voxel solver with a solid isotropic
 * material instead of printed plastic, von Mises against the yield strength, a force or a pressure on the marked area
 * and optionally the part's own weight. Materials are the tensile-test tool's (brittle cast iron left out: von Mises
 * does not apply to it).
 */
import { MATERIALS, type TensileMat } from '../materials/tensile.ts';
import { toB64 } from '../manufacturing/b64.ts';
import type { LabJob } from '../manufacturing/labWorker.ts';
import { dirVec, fileChecks, LAB_NOTES, type Check, type Decoded, type DirId, type LoadSpec, type MeshInfo } from '../manufacturing/printLab.ts';
import type { SampleId } from '../manufacturing/stl.ts';
import type { Vox } from '../manufacturing/voxel.ts';
import type { IsoMat } from '../manufacturing/voxfem.ts';

export const FEM_MATS: TensileMat[] = MATERIALS.filter((m) => m.kind !== 'brittle');
export type FemMatId = string;
export const femMat = (id: FemMatId) => FEM_MATS.find((m) => m.id === id) ?? FEM_MATS[0];
/** The solver's material: E, ν, density in g/cm³, yield (R_eL, R_p0.2 or σ_y) and tensile strength. */
export const isoOf = (m: TensileMat): IsoMat => ({ E: m.E, nu: m.nu, rho: m.rho / 1000, fy: m.Re, fu: m.Rm });

export type LoadKind = 'force' | 'pressure';
export type StaticParams = { mat: FemMatId; load: LoadKind; F: number; p: number; dir: DirId; grav: number; gdir: DirId };
/** Loads that give the samples a safety factor of about 2.5 in S235 (same supports and load areas as the print lab). */
export const STATIC_F: Record<SampleId, number> = { bracket: 600, hook: 450, bar: 750 };

/** Solver job of the static analysis; with `groups`, every loaded area has its own force [N] or pressure [MPa]. */
export function makeStaticJob(v: Vox, fixed: Set<number>, load: Set<number>, s: StaticParams, groups?: LoadSpec[]): LabJob {
  return { nx: v.nx, ny: v.ny, nz: v.nz, h: v.h, org: v.org, solid: toB64(v.solid), fill: v.fill ? toB64(v.fill) : undefined, fixed: [...fixed], load: [...load], sweep: false,
    p: { fil: 'pla', theta: 0, phi: 0, walls: 1, skins: 1, infill: 1, F: s.load === 'pressure' ? s.p : s.F, dir: dirVec(s.dir), iso: isoOf(femMat(s.mat)), load: s.load, grav: s.grav, gdir: dirVec(s.gdir), groups } };
}

/** Checks of a static run (`d` null while nothing has been solved for these settings). */
export function staticChecks(o: { nFixed: number; nLoad: number; grav: number; d: Decoded | null; error: string | null; size: number; thin: number; file: boolean; mat: TensileMat; mesh?: MeshInfo | null }) {
  const { d } = o, c: Check[] = [];
  c.push({ ok: o.nFixed > 0 && (o.nLoad > 0 || o.grav > 0), label: 'Supports and load marked', detail: `${o.nFixed} held and ${o.nLoad} loaded surface cubes${o.grav > 0 ? ', own weight on' : ''}` });
  c.push({ ok: !o.error && (!d || d.dropped === 0), label: 'Load reaches a support', detail: o.error === 'load not connected' || (d && d.dropped) ? 'part of the loaded area is not joined to a held area' : o.error === 'no supported part' ? 'no part of the model is held' : 'the loaded area is joined to a held area' });
  if (d) {
    const SF = 1 / d.umax, sMax = d.umax * o.mat.Re;
    c.push({ ok: d.converged, label: 'Solution converged', detail: `${d.it} multigrid iterations, residual ${d.res.toExponential(1)}` });
    c.push({ ok: SF >= 1.5, label: 'Safety factor against yield SF ≥ 1.5', detail: `SF = f_y/σ_vM,max = ${o.mat.Re}/${sMax.toFixed(sMax < 10 ? 2 : 0)} = ${SF.toFixed(2)}` });
    c.push({ ok: d.maxDisp <= o.size / 300, label: 'Deflection ≤ 1/300 of the part size', detail: `${d.maxDisp.toFixed(3)} mm ≤ ${(o.size / 300).toFixed(3)} mm` });
  }
  c.push({ ok: o.thin <= 0.05, label: 'Thin walls resolved', detail: `${(100 * o.thin).toFixed(0)} % of the cubes are one cube thick (≤ 5 %)` });
  if (o.file) c.push(...fileChecks(o.size, o.mesh ?? null));
  return c;
}

/** Share of the part's volume in bands of σ_vM/f_y: 0–0.1, …, 0.9–1, above 1. */
export function utilBands(d: Decoded) {
  const n = new Array(11).fill(0);
  for (let e = 0; e < d.u.length; e++) n[Math.min(10, Math.floor(d.u[e] * 10))]++;
  return n.map((x) => x / Math.max(1, d.u.length));
}

export const STATIC_INTRO = 'Is my part strong enough? Load your own part as an STL file (or try a sample), tap it to mark where it is held and where the load acts, and choose the material. The part is cut into small cubes and calculated in 3D with the finite element method: the colours show the von Mises stress against the yield strength, the deflection is drawn exaggerated and the most stressed point is marked.';
export const STATIC_WARNING = 'A learning estimate, not a certificate: a cube model rounds edges, holes and fillets, and the stress at sharp corners depends on the cube size. Have a part that carries people or must not fail checked by an engineer.';
export const STATIC_NOTES = [
  LAB_NOTES[0], // the cube model and solver are the print lab's
  'Linear elastic, isotropic material with the typical values of the tensile-test tool (E, ν, density, yield and tensile strength); small displacements. Yielding is checked by von Mises against R_eL, R_p0.2 or the plastic yield stress; nothing is said about fatigue, buckling, creep or contact.',
  'Surface stresses are extrapolated from the cubes under the surface and averaged over about 1.5 cubes (the stress over a small distance, as for notches), which removes the false peaks of the cube steps on sloped and curved faces. Sharp inner corners still raise the stress as the cubes get smaller — a real part needs a fillet there.',
  'Blue cubes are held rigidly in all directions (bolted, clamped or welded); real joints give a little, so stresses within 2 mm of a held area are not used for the critical point. Each separate orange area (cubes that touch each other) carries its own force, shared equally by its outer faces, or its own pressure on each outer face, pushing in. Own weight is the density × g (or a multiple, for accelerations) on every cube.',
];

/* ---------------- static analysis on the tetrahedral solver (fem/tet) ---------------- */

/** Mesh sizes: lattice cells in the part (Normal ≈ 25–35k unknowns, Fine about three times as many, to check that the
 *  result no longer changes with the mesh). */
export const TET_CELLS = { normal: 400, fine: 1200 } as const;
export type TetMeshId = keyof typeof TET_CELLS;

/** What the page knows of a solved load case for the checks. */
export type TetCheckIn = {
  nFixed: number; nLoad: number; grav: number; error: string | null; size: number; file: boolean; mat: TensileMat; mesh?: MeshInfo | null;
  volRatio: number | null; r: { sMax: number; maxDisp: number; it: number; res: number; converged: boolean; nearSupport: boolean; sharp: boolean; sAll: number } | null;
};
export function tetChecks(o: TetCheckIn) {
  const c: Check[] = [], r = o.r;
  c.push({ ok: o.nFixed > 0 && (o.nLoad > 0 || o.grav > 0), label: 'Supports and load marked', detail: `${o.nFixed} held and ${o.nLoad} loaded surface faces${o.grav > 0 ? ', own weight on' : ''}` });
  c.push({ ok: !o.error, label: 'Load reaches a support', detail: o.error === 'load not connected' ? 'a loaded piece of the part is not joined to a held area' : o.error === 'no supported part' ? 'no part of the model is held' : 'every loaded piece is joined to a held area' });
  if (o.volRatio !== null) c.push({ ok: o.volRatio > 0.98 && o.volRatio < 1.02, label: 'Mesh follows the part', detail: `the tetrahedra fill ${(100 * o.volRatio).toFixed(1)} % of the part's volume (98…102 %)` });
  if (r) {
    const SF = o.mat.Re / r.sMax;
    c.push({ ok: r.converged, label: 'Solution converged', detail: `${r.it} multigrid iterations, residual ${r.res.toExponential(1)}` });
    c.push({ ok: SF >= 1.5, label: 'Safety factor against yield SF ≥ 1.5', detail: `SF = f_y/σ_vM,max = ${o.mat.Re}/${r.sMax.toFixed(r.sMax < 10 ? 2 : 0)} = ${SF.toFixed(2)}` });
    c.push({ ok: r.maxDisp <= o.size / 300, label: 'Deflection ≤ 1/300 of the part size', detail: `${r.maxDisp.toFixed(3)} mm ≤ ${(o.size / 300).toFixed(3)} mm` });
    c.push({ ok: !r.sharp, label: 'Most stressed point not in a sharp inner corner', detail: r.sharp ? 'it lies in a sharp inner corner, where the stress grows without limit as the mesh gets finer — the value depends on the mesh; give the corner a fillet (radius) in the model' : 'the most stressed point is on a smooth surface or a rounded corner' });
    c.push({ ok: !r.nearSupport, label: 'No higher stress next to a support', detail: r.nearSupport ? `next to a held area the stress reaches ${r.sAll.toFixed(r.sAll < 10 ? 2 : 0)} MPa; a rigid support makes it depend on the mesh, so it is not used — a real bolt or clamp gives a little, check the joint itself` : 'the stress next to the supports stays below the reported maximum' });
  }
  if (o.file) c.push(...fileChecks(o.size, o.mesh ?? null));
  return c;
}

export const TET_INTRO = 'Is my part strong enough? Load your own part as an STL file (or try a sample), tap it to mark where it is held and where the load acts, and choose the material. The part is filled with small curved tetrahedra (quadratic finite elements) that follow its true surface, sharp edges included, and calculated in 3D: the colours show the von Mises stress against the yield strength, the deflection is drawn exaggerated and the most stressed point is marked.';
export const TET_WARNING = 'A learning estimate, not a certificate: the stress in a sharp inner corner and right next to a rigid support depends on the mesh (the checks say when), and real joints, welds and materials vary. Have a part that carries people or must not fail checked by an engineer.';
export const TET_NOTES = [
  'Mesh: the part is filled with tetrahedra by isosurface stuffing (Labelle & Shewchuk 2007) on a body-centred cubic lattice; the lattice points next to the surface move onto it, and points near sharp edges and corners (faces meeting at more than 40°) move onto those, so edges stay sharp. Each tetrahedron is a quadratic 10-node element; the edge nodes on the surface lie on the true surface, so holes and fillets are curved. Normal uses about 400 lattice cells, Fine about 1200 (finer by a factor of about 1.4) — if Fine changes the result noticeably, the finer value is the better one.',
  'Checked against exact solutions (tests named VALIDATION): bending stress of a cantilever (beam theory), the stress at a hole in a plate under tension (Heywood’s K_t), a thick ring under inner pressure (Lamé) and a C-ring pulled apart (Winkler’s curved beam) all within 3–5 % with the Normal mesh; a plain bar in tension gives F/A at every surface node.',
  'Linear elastic, isotropic material with the typical values of the tensile-test tool (E, ν, density, yield and tensile strength); small displacements. Yielding is checked by von Mises against R_eL, R_p0.2 or the plastic yield stress; nothing is said about fatigue, buckling, creep or contact. Stresses are evaluated at the element nodes and averaged where elements meet; only nodes on the true surface are used for the largest stress.',
  'Blue faces are held rigidly in all directions (bolted, clamped or welded). Real joints give a little, so stresses within about 1.5 elements (at least a few mm on larger parts) of a held area are not used for the most stressed point — the checks report when they are higher. Each separate orange area carries its own force, spread over its faces in proportion to their area, or its own pressure, pushing in. Own weight is the density × g (or a multiple, for accelerations) on every element. A piece of the part that is joined to nothing held carries no load and is ignored.',
];
