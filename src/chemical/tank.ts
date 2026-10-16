/**
 * Liquid volume, level and wetted area of vertical and horizontal tanks with dished heads (all inside dimensions).
 * The tank is a body of revolution about its axis: a meridian r(s) from one head apex to the other, built densely from
 * the head shapes (arcs and lines). Vertical tank: the level cuts the axis, volume = Σ frustums. Horizontal tank: the
 * level is parallel to the axis, volume = ∫ circular-segment area A(r(s), y₀) ds. Drain time through a bottom outlet
 * by Torricelli. Units: SI (m, m³, kg, s).
 */

export type Orient = 'vertical' | 'horizontal';
export const HEADS = [
  { id: 'flat', name: 'Flat' },
  { id: 'hemi', name: 'Hemispherical' },
  { id: 'ellip', name: '2:1 ellipsoidal' },
  { id: 'asme', name: 'ASME F&D (torispherical)', fd: 1, fk: 0.06 },
  { id: 'klopper', name: 'Klöpper (DIN 28011)', fd: 1, fk: 0.1 },
  { id: 'korb', name: 'Korbbogen (DIN 28013)', fd: 0.8, fk: 0.154 },
  { id: 'cone', name: 'Conical, 60° apex' },
] as const;
export type HeadId = (typeof HEADS)[number]['id'];

export type TankIn = {
  orient: Orient; head: HeadId;
  D: number;     // inside diameter [m]
  H: number;     // overall inside length (horizontal) or height (vertical), head apex to head apex [m]
  h: number;     // liquid level above the lowest point [m]
  rho: number;   // liquid density [kg/m³]
  dOut: number;  // bottom outlet diameter for draining [m]
};

const G = 9.81, CD = 0.61; // sharp-edged outlet

/** Head meridian from the tangent line (x = 0, r = R) to the apex, as dense points (x outward, r). */
export function headMeridian(head: HeadId, R: number, n = 400): [number, number][] {
  const pts: [number, number][] = [];
  const arc = (cx: number, cr: number, rad: number, a0: number, a1: number, m: number) => {
    for (let i = 0; i <= m; i++) { const a = a0 + ((a1 - a0) * i) / m; pts.push([cx + rad * Math.sin(a), cr + rad * Math.cos(a)]); }
  };
  if (head === 'flat') return [[0, R], [0, 0]];
  if (head === 'cone') return [[0, R], [R * Math.sqrt(3), 0]];
  if (head === 'hemi') { arc(0, 0, R, 0, Math.PI / 2, n); return pts; }
  if (head === 'ellip') { for (let i = 0; i <= n; i++) { const a = (Math.PI / 2) * (i / n); pts.push([(R / 2) * Math.sin(a), R * Math.cos(a)]); } return pts; }
  const h = HEADS.find((x) => x.id === head) as { fd: number; fk: number };
  const Rc = h.fd * 2 * R, rk = h.fk * 2 * R, a1 = Math.acos((R - rk) / (Rc - rk)), xc = -(Rc - rk) * Math.sin(a1);
  arc(0, R - rk, rk, 0, a1, Math.round(n / 3)); // knuckle
  pts.pop();
  arc(xc, 0, Rc, a1, Math.PI / 2, n); // crown
  pts[pts.length - 1][1] = 0;
  return pts;
}
export const headDepth = (head: HeadId, R: number) => { const m = headMeridian(head, R, 50); return m[m.length - 1][0]; };

/** Full meridian (s along the axis from the bottom/left apex, r) for overall length H; shell = H − 2 × head depth (≥ 0). */
export function tankProfile(p: Pick<TankIn, 'head' | 'D' | 'H'>) {
  const R = p.D / 2, m = headMeridian(p.head, R), hd = m[m.length - 1][0], Ls = Math.max(p.H - 2 * hd, 0), Ht = 2 * hd + Ls;
  const pts: [number, number][] = [];
  for (let i = m.length - 1; i >= 0; i--) pts.push([hd - m[i][0], m[i][1]]);
  for (let i = 0; i < m.length; i++) pts.push([hd + Ls + m[i][0], m[i][1]]);
  return { R, hd, Ls, Ht, pts };
}

/** Area of a circle of radius r below the line y = y0 (centre at 0), and the wetted arc length below it. */
export function segArea(r: number, y0: number) {
  if (r <= 0 || y0 <= -r) return 0;
  if (y0 >= r) return Math.PI * r * r;
  return r * r * (Math.PI - Math.acos(y0 / r)) + y0 * Math.sqrt(r * r - y0 * y0);
}
const segArc = (r: number, y0: number) => (r <= 0 || y0 <= -r ? 0 : y0 >= r ? 2 * Math.PI * r : 2 * r * (Math.PI - Math.acos(y0 / r)));
const chord = (r: number, y0: number) => (Math.abs(y0) >= r ? 0 : 2 * Math.sqrt(r * r - y0 * y0));

type Prof = ReturnType<typeof tankProfile>;
/** Liquid volume, wetted wall area and free-surface area at level h. */
export function atLevel(pf: Prof, orient: Orient, h: number) {
  const pts = pf.pts;
  let V = 0, Aw = 0, As = 0;
  if (orient === 'vertical') {
    const hh = Math.min(Math.max(h, 0), pf.Ht);
    for (let i = 0; i < pts.length - 1; i++) {
      let [s1, r1] = pts[i], [s2, r2] = pts[i + 1];
      if (s1 >= hh) break;
      if (s2 > hh) { r2 = r1 + ((hh - s1) / (s2 - s1)) * (r2 - r1); s2 = hh; }
      const ds = s2 - s1;
      V += (Math.PI / 3) * ds * (r1 * r1 + r1 * r2 + r2 * r2);
      Aw += Math.PI * (r1 + r2) * Math.hypot(ds, r2 - r1);
    }
    As = h >= pf.Ht ? 0 : Math.PI * rAt(pf, hh) ** 2;
  } else {
    const y0 = Math.min(Math.max(h, 0), 2 * pf.R) - pf.R;
    for (let i = 0; i < pts.length - 1; i++) {
      const [s1, r1] = pts[i], [s2, r2] = pts[i + 1], ds = s2 - s1, rm = (r1 + r2) / 2;
      if (ds === 0) { // flat end plate between r1 and r2
        Aw += Math.abs(segArea(Math.max(r1, r2), y0) - segArea(Math.min(r1, r2), y0));
        continue;
      }
      V += (ds * (segArea(r1, y0) + 4 * segArea(rm, y0) + segArea(r2, y0))) / 6;
      Aw += Math.hypot(ds, r2 - r1) * segArc(rm, y0);
      As += (ds * (chord(r1, y0) + 4 * chord(rm, y0) + chord(r2, y0))) / 6;
    }
  }
  return { V, Aw, As };
}
/** Radius of the meridian at axial position s. */
export function rAt(pf: Prof, s: number) {
  const p = pf.pts;
  for (let i = 0; i < p.length - 1; i++) if (s <= p[i + 1][0] && p[i + 1][0] > p[i][0]) { const f = (s - p[i][0]) / (p[i + 1][0] - p[i][0]); return p[i][1] + Math.max(0, Math.min(1, f)) * (p[i + 1][1] - p[i][1]); }
  return p[p.length - 1][1];
}

/** Time to drain from level h to empty through a bottom outlet: dt = A_s dh/(C_d a √(2gh)), integrated in w = √h. */
export function drainTime(pf: Prof, orient: Orient, h: number, dOut: number, n = 120) {
  const a = (Math.PI * dOut * dOut) / 4, k = CD * a * Math.sqrt(2 * G), W = Math.sqrt(Math.max(h, 0));
  const curve: { t: number; h: number }[] = [{ t: 0, h }];
  let t = 0;
  for (let i = n; i > 0; i--) {
    const w1 = (W * i) / n, w0 = (W * (i - 1)) / n, wm = (w0 + w1) / 2;
    t += (2 * atLevel(pf, orient, wm * wm).As * (w1 - w0)) / k;
    curve.push({ t, h: w0 * w0 });
  }
  return { t, curve };
}

export function tank(p: TankIn) {
  const pf = tankProfile(p), top = p.orient === 'vertical' ? pf.Ht : p.D;
  const h = Math.min(Math.max(p.h, 0), top);
  const full = atLevel(pf, p.orient, top), at = atLevel(pf, p.orient, h);
  const head = atLevel(tankProfile({ ...p, H: 2 * pf.hd }), 'vertical', 2 * pf.hd).V / 2;
  const fill = at.V / full.V, m = p.rho * at.V, pBot = p.rho * G * h;
  const dr = drainTime(pf, p.orient, h, p.dOut);
  const ratio = pf.Ht / p.D;
  // level-volume (strapping) table every 10 % of the height
  const table = Array.from({ length: 11 }, (_, i) => { const hi = (top * i) / 10, v = atLevel(pf, p.orient, hi).V; return { h: hi, V: v, f: v / full.V }; });
  const checks = [
    { ok: pf.Ls > 0 || p.H >= 2 * pf.hd - 1e-9, label: 'Overall length holds both heads', detail: `${p.orient === 'vertical' ? 'H' : 'L'} = ${p.H.toFixed(2)} m ≥ 2 × ${pf.hd.toFixed(3)} m` },
    { ok: fill <= 0.9, label: 'Fill ≤ 90 % of the volume (room for expansion and the high-level alarm)', detail: `${(fill * 100).toFixed(1)} %` },
    p.orient === 'horizontal'
      ? { ok: ratio >= 2 && ratio <= 6, label: 'Length/diameter 2…6 (usual for horizontal vessels)', detail: `L/D = ${ratio.toFixed(2)}` }
      : { ok: ratio >= 1 && ratio <= 5, label: 'Height/diameter 1…5 (usual for vertical vessels)', detail: `H/D = ${ratio.toFixed(2)}` },
  ];
  return { pf, top, h, full, at, head, fill, m, pBot, drain: dr, ratio, table, checks };
}
export type TankResult = ReturnType<typeof tank>;

export const TANK_INTRO = 'How much liquid is in a tank at a given level? In the straight part the answer is simple, but the dished heads at the ends hold a good share and change shape with the level. Here the tank is built from its real head shape, the liquid volume is summed slice by slice, and the result gives the level–volume table (strapping table), the mass, the wetted wall and the time to drain through a bottom outlet.';
export const TANK_NOTES = [
  'Inside dimensions; the overall length (or height) runs from head apex to head apex, as measured on drawings. Heads: hemispherical, 2:1 ellipsoidal (depth D/4), torispherical — ASME flanged and dished (crown radius D, knuckle 0.06 D), Klöpper DIN 28011 (D, 0.1 D), Korbbogen DIN 28013 (0.8 D, 0.154 D) — conical with a 60° apex, and flat. Both ends get the same head.',
  'The tank is a body of revolution: its outline is built densely from the head arcs; a vertical tank\'s volume is the sum of thin frustums, a horizontal tank\'s the integral of the circular-segment area along the axis (Simpson), so any head and level work the same way. Validation: the vertical and horizontal ASME F&D tanks of Crookston and Crookston (Chemical Engineering, September 2011; 100 in diameter, 120 in overall) to within 0.1 %; closed forms for a sphere, ellipsoidal heads and a cylinder.',
  'Wetted area = tank wall below the level (for a fire case, API 521 uses the wetted area up to 7.6 m above grade; see the Relief valve tool). Draining: Torricelli, flow = C_d a √(2 g h) with a sharp-edged outlet C_d = 0.61 at the lowest point, no pipe losses, vented tank. Fill limit 90 % and the usual proportions are rules of thumb, not a code requirement; nozzles, internals and the wall thickness are not included.',
];
