/**
 * The print lab's solver as a message-driven worker: it runs inside a hidden WebView on phones (whose JavaScript
 * engine compiles numeric loops, many times faster than the app's interpreter) or a Web Worker on the web. Bundled
 * into `labWorkerBundle.ts` by `scripts/build-lab-worker.mjs`. Messages in: {type: 'solve', id, job} / {type:
 * 'cancel', id} / {type: 'prep', id, prep}; out: {type: 'progress' | 'result' | 'error' | 'prepped' | 'prepError', id, …}. Arrays travel as base64.
 */
import { buildModel, evaluate, lineSweep, orientationSweep, partMass, solveMG, strains, type LabIn } from './voxfem.ts';
import type { Vox } from './voxel.ts';
import { fromB64, toB64 } from './b64.ts';
import { prepPart, type PrepJob } from './labPrep.ts';

export type LabJob = { nx: number; ny: number; nz: number; h: number; org: [number, number, number]; solid: string; fill?: string; fixed: number[]; load: number[]; p: LabIn; sweep: boolean };
export type LabResult = {
  ne: number; ndof: number; it: number; res: number; converged: boolean; elems: string; u: string; inter: string; crit: number; umax: number; interlayer: boolean; mode: number;
  mass: number; weight: number; fres: [number, number, number]; maxDisp: number; disp: string; gnodes: string; nFixedEl: number; nLoadEl: number; dropped: number; sweep: { theta: number; phi: number; Ff: number }[]; lineSweep: { alpha: number; Ff: number }[]; ms: number;
};

/** The whole job as one generator (yields progress); used by the worker and, as a fallback, on the app's own thread. */
export function* runJob(job: LabJob): Generator<{ it: number; res: number; stage: 'solve' | 'sweep' | 'lines' }, LabResult, unknown> {
  const t0 = Date.now();
  const v: Vox = { nx: job.nx, ny: job.ny, nz: job.nz, h: job.h, org: job.org, solid: fromB64(job.solid), fill: job.fill ? fromB64(job.fill) : undefined };
  const md = buildModel(v, { fixed: new Set(job.fixed), load: new Set(job.load) }, job.p);
  if (md.ne === 0 || (md.nLoadNodes === 0 && !(md.weight > 0))) throw new Error(md.ne === 0 ? 'no supported part' : 'load not connected');
  const g = solveMG(md);
  let r = g.next();
  while (!r.done) { yield { ...r.value, stage: 'solve' }; r = g.next(); }
  const sol = r.value, eps = strains(md, sol.u), ev = evaluate(md, eps, md.b);
  let maxDisp = 0; for (let d = 0; d < sol.u.length; d += 3) maxDisp = Math.max(maxDisp, Math.hypot(sol.u[d], sol.u[d + 1], sol.u[d + 2]));
  let sweep: { theta: number; phi: number; Ff: number }[] = [];
  if (job.sweep) { const sg = orientationSweep(md, eps, job.p.F); let q = sg.next(); let k = 0; while (!q.done) { yield { it: ++k, res: 0, stage: 'sweep' }; q = sg.next(); } sweep = q.value; }
  let lines: { alpha: number; Ff: number }[] = [];
  if (job.sweep && md.lines === 'one') { const sg = lineSweep(md, eps, job.p.F); let q = sg.next(); let k = 0; while (!q.done) { yield { it: ++k, res: 0, stage: 'lines' }; q = sg.next(); } lines = q.value; }
  const u32 = new Float32Array(ev.u), el = Int32Array.from(md.elems), d32 = new Float32Array(sol.u);
  return {
    ne: md.ne, ndof: md.ndof, it: sol.it, res: sol.res, converged: sol.converged, elems: toB64(new Uint8Array(el.buffer)), u: toB64(new Uint8Array(u32.buffer)), inter: toB64(ev.inter),
    crit: md.elems[ev.crit], umax: ev.umax, interlayer: ev.interlayer, mode: ev.mode, mass: partMass(md), weight: md.weight, fres: md.fres, maxDisp, disp: toB64(new Uint8Array(d32.buffer)), gnodes: toB64(new Uint8Array(md.gnodes.buffer)), nFixedEl: md.nFixedEl, nLoadEl: md.nLoadEl, dropped: md.dropped, sweep, lineSweep: lines, ms: Date.now() - t0,
  };
}

/** Worker glue: runs jobs in 25 ms slices so a newer job or a cancel can get in between. */
export function startWorker(post: (m: unknown) => void, listen: (f: (m: { type: string; id: number; job?: LabJob; prep?: PrepJob }) => void) => void) {
  let current = -1, last = -1, lastPrep = -1;
  listen((m) => {
    if (m.type === 'cancel') { if (m.id === current) current = -1; return; }
    // preparing a part (cubes, surface, drawing) is one quick step
    if (m.type === 'prep') {
      if (!m.prep || m.id === lastPrep) return;
      lastPrep = m.id;
      try { post({ type: 'prepped', id: m.id, prep: prepPart(m.prep) }); } catch (e) { post({ type: 'prepError', id: m.id, message: String((e as Error).message ?? e) }); }
      return;
    }
    if (m.type !== 'solve' || !m.job || m.id === last) return; // a WebView may deliver one message twice (window and document)
    const id = m.id; current = id; last = id;
    let gen: Generator<{ it: number; res: number; stage: string }, LabResult, unknown>;
    try { gen = runJob(m.job); } catch (e) { post({ type: 'error', id, message: String((e as Error).message ?? e) }); return; }
    const step = () => {
      if (current !== id) return;
      const t = Date.now();
      try {
        while (Date.now() - t < 25) {
          const r = gen.next();
          if (r.done) { post({ type: 'result', id, result: r.value }); current = -1; return; }
          if (r.value.stage !== 'solve' || r.value.it % 2 === 0) post({ type: 'progress', id, ...r.value });
        }
      } catch (e) { post({ type: 'error', id, message: String((e as Error).message ?? e) }); current = -1; return; }
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  });
}
