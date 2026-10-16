/**
 * STL meshes: reading binary and ASCII STL, bounds and volume, and a few closed sample parts built in code (so the
 * print lab has something to test before a file is loaded). Triangles are stored flat, 9 floats each, in mm.
 */
export type Mesh = { pos: Float32Array };

/** Largest STL accepted: 5 MB (about 100 000 triangles in binary) — enough for the cube model, and a phone reads it quickly. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Reads a binary or ASCII STL. Throws on an empty or unreadable file. */
export function parseSTL(buf: ArrayBuffer): Mesh {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  // ASCII files start with "solid" and contain "facet"; binary headers may also start with "solid" (some CAD programs)
  const head = String.fromCharCode(...u8.subarray(0, Math.min(512, u8.length))).toLowerCase();
  const ascii = head.trimStart().startsWith('solid') && head.includes('facet');
  if (!ascii && buf.byteLength >= 84) {
    const n = dv.getUint32(80, true);
    // binary: 80-byte header, count, 50 bytes per triangle (some exporters add a few bytes at the end)
    if (n > 0 && 84 + 50 * n <= buf.byteLength) {
      const pos = new Float32Array(9 * n);
      if (new Uint8Array(new Uint16Array([1]).buffer)[0] === 1) { // little-endian (every phone): copy the 36 vertex bytes of each triangle
        const p8 = new Uint8Array(pos.buffer);
        for (let i = 0; i < n; i++) { const o = 84 + 50 * i + 12; p8.set(u8.subarray(o, o + 36), 36 * i); }
      } else for (let i = 0; i < n; i++) { const o = 84 + 50 * i + 12; for (let k = 0; k < 9; k++) pos[9 * i + k] = dv.getFloat32(o + 4 * k, true); }
      let finite = true; for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) { finite = false; break; }
      if (finite) return { pos };
    }
  }
  // ASCII, decoded byte by byte (TextDecoder is missing on some phone JavaScript engines)
  let text = ''; for (let i = 0; i < u8.length; i += 8192) text += String.fromCharCode(...u8.subarray(i, i + 8192));
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g, v: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) v.push(+m[1], +m[2], +m[3]);
  if (v.length < 9 || v.length % 9 || !v.every(Number.isFinite)) throw new Error('Not a readable STL file');
  return { pos: Float32Array.from(v) };
}

/** Whether a mesh is one closed body: edges used by exactly two triangles (vertices welded within 10⁻⁶ of the size)
 *  and the number of separate bodies (groups of triangles joined through shared vertices). */
export function meshCheck(m: Mesh) {
  const n = m.pos.length / 9, b = bounds(m), q = Math.max(...b.size, 1e-9) * 1e-6, ids = new Map<string, number>(), vid = new Int32Array(3 * n);
  for (let i = 0; i < 3 * n; i++) {
    const k = `${Math.round(m.pos[3 * i] / q)},${Math.round(m.pos[3 * i + 1] / q)},${Math.round(m.pos[3 * i + 2] / q)}`;
    let id = ids.get(k); if (id === undefined) { id = ids.size; ids.set(k, id); } vid[i] = id;
  }
  const edges = new Map<number, number>(), nv = ids.size;
  const parent = new Int32Array(nv); for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let t = 0; t < n; t++) for (let e = 0; e < 3; e++) {
    const a = vid[3 * t + e], c = vid[3 * t + ((e + 1) % 3)], lo = Math.min(a, c), hi = Math.max(a, c);
    const key = lo * nv + hi; edges.set(key, (edges.get(key) ?? 0) + 1);
    const ra = find(a), rc = find(c); if (ra !== rc) parent[ra] = rc;
  }
  let open = 0; for (const c of edges.values()) if (c !== 2) open++;
  const roots = new Set<number>(); for (let t = 0; t < n; t++) roots.add(find(vid[3 * t]));
  return { openEdges: open, edges: edges.size, bodies: roots.size };
}

/** Binary STL of a mesh (used by the tests and to keep samples and uploads on one path). */
export function writeSTL(m: Mesh): ArrayBuffer {
  const n = m.pos.length / 9, buf = new ArrayBuffer(84 + 50 * n), dv = new DataView(buf);
  dv.setUint32(80, n, true);
  for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + 50 * i + 12 + 4 * k, m.pos[9 * i + k], true);
  return buf;
}

export const triCount = (m: Mesh) => m.pos.length / 9;
export function bounds(m: Mesh) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.pos.length; i += 3) for (let k = 0; k < 3; k++) { const v = m.pos[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  return { lo, hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
}
/** Enclosed volume (signed tetrahedra from the origin; positive for outward-facing triangles) [mm³]. */
export function volume(m: Mesh) {
  const p = m.pos; let v = 0;
  for (let i = 0; i < p.length; i += 9) v += p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6]) + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6]);
  return Math.abs(v) / 6;
}
export const scaled = (m: Mesh, s: number): Mesh => ({ pos: m.pos.map((x) => x * s) });

/* ---------------- sample parts ---------------- */

type P2 = [number, number];
/** Ear-clipping triangulation of a simple polygon (counter-clockwise). */
function earClip(poly: P2[]): [number, number, number][] {
  const idx = poly.map((_, i) => i), out: [number, number, number][] = [];
  const cross = (a: P2, b: P2, c: P2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p: P2, a: P2, b: P2, c: P2) => cross(a, b, p) > 0 && cross(b, c, p) > 0 && cross(c, a, p) > 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length], a = poly[ia], b = poly[ib], c = poly[ic];
      if (cross(a, b, c) <= 1e-12) continue;
      if (idx.some((j) => j !== ia && j !== ib && j !== ic && inside(poly[j], a, b, c))) continue;
      out.push([ia, ib, ic]); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

/** Closed prism: a counter-clockwise outline in the x–z plane extruded along y from −w/2 to w/2. */
export function extrude(poly: P2[], w: number): Mesh {
  const area = poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
  const pts = area < 0 ? [...poly].reverse() : poly, tris = earClip(pts), v: number[] = [], y0 = -w / 2, y1 = w / 2;
  const V = (p: P2, y: number) => [p[0], y, p[1]];
  // outline is counter-clockwise seen from −y looking along +y… in x–z with z up seen from the front (−y), so the
  // front cap (y0) faces −y with the outline's order, the back cap (y1) faces +y reversed
  for (const [a, b, c] of tris) { v.push(...V(pts[a], y0), ...V(pts[b], y0), ...V(pts[c], y0)); v.push(...V(pts[a], y1), ...V(pts[c], y1), ...V(pts[b], y1)); }
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; v.push(...V(p, y0), ...V(q, y1), ...V(q, y0), ...V(p, y0), ...V(p, y1), ...V(q, y1)); }
  return { pos: Float32Array.from(v) };
}

export type SampleId = 'bracket' | 'hook' | 'bar';
/** Sample parts in the file's axes (z up as they would lie in the slicer when printed standing). */
export function sample(id: SampleId): Mesh {
  if (id === 'bracket') { // shelf bracket: 60 mm leg up the wall (x = 0), 60 mm arm, 8 mm thick, 20 mm wide, 10 mm gusset
    const t = 8, L = 60, g = 12;
    return extrude([[0, 0], [t, 0], [t, L - t - g], [t + g, L - t], [L, L - t], [L, L], [0, L]], 20);
  }
  if (id === 'hook') { // J hook: shank up to 40 mm, bend inner radius 12 mm, 7 mm thick, 15 mm wide
    const ri = 12, h = 7, ro = ri + h, rc = ri + h / 2, N = 20, poly: P2[] = [[-ro, 40], [-ro, 0]];
    for (let k = 1; k < N; k++) { const a = Math.PI + (Math.PI * k) / N; poly.push([ro * Math.cos(a), ro * Math.sin(a)]); }
    poly.push([ro, 0], [ro, 0.8 * rc], [ri, 0.8 * rc], [ri, 0]);
    for (let k = 1; k < N; k++) { const a = 2 * Math.PI - (Math.PI * k) / N; poly.push([ri * Math.cos(a), ri * Math.sin(a)]); }
    poly.push([-ri, 0], [-ri, 40]);
    return extrude(poly.reverse(), 15);
  }
  // flat bar 100 × 6 mm, 12 mm wide (for a beam on two supports or a cantilever)
  return extrude([[0, 0], [100, 0], [100, 6], [0, 6]], 12);
}
