/**
 * Weight of metal stock: cross-section area × length × density, per piece, per metre and for a quantity, plus the
 * outside surface to paint or coat. Hollow sections after EN 10219 with an outer corner radius of 2 t (t ≤ 6 mm)
 * or 2.5 t; angles with sharp corners; standard sections from the tables.
 */
import { SECTIONS_TABLE, type SectionFamily } from './tables.ts';

export type Shape = 'plate' | 'round' | 'square' | 'flat' | 'hex' | 'tube' | 'rhs' | 'angle' | 'section';
export const SHAPES: Shape[] = ['plate', 'round', 'square', 'flat', 'hex', 'tube', 'rhs', 'angle', 'section'];

/** Densities for the weight list, kg/m³ (typical; alloys vary by a few per cent). */
export const WEIGHT_MATS: { id: string; name: string; rho: number }[] = [
  { id: 'steel', name: 'Steel', rho: 7850 }, { id: 'ss304', name: 'Stainless 304', rho: 7900 }, { id: 'ss316', name: 'Stainless 316', rho: 8000 },
  { id: 'castiron', name: 'Cast iron', rho: 7200 }, { id: 'al', name: 'Aluminium', rho: 2700 }, { id: 'cu', name: 'Copper', rho: 8930 },
  { id: 'brass', name: 'Brass', rho: 8500 }, { id: 'bronze', name: 'Bronze', rho: 8800 }, { id: 'ti', name: 'Titanium', rho: 4510 },
  { id: 'zn', name: 'Zinc', rho: 7140 }, { id: 'pb', name: 'Lead', rho: 11340 }, { id: 'pe', name: 'Polyethylene', rho: 955 },
  { id: 'pvc', name: 'PVC', rho: 1400 }, { id: 'pa', name: 'Polyamide', rho: 1140 }, { id: 'pom', name: 'Acetal (POM)', rho: 1410 },
];

/** Dimensions in mm: a = thickness / diameter / side / height, b = width, t = wall; L = length in mm. */
export type WeightIn = { shape: Shape; a: number; b: number; t: number; L: number; n: number; rho: number; family: SectionFamily; size: number };

export type WeightOut = {
  A: number;        // cross-section mm² (plate: t × width)
  perimeter: number; // outside perimeter mm (plate: both faces + edges per unit length)
  kgm: number;      // kg per metre of length (plate: per m²)
  kgPiece: number; kgTotal: number;
  m2Piece: number;  // outside surface of one piece, m² (ends included)
  volume: number;   // one piece, m³
  valid: boolean;
};

/** Outer corner radius of a hollow section (EN 10219 typical). */
export const rhsRadius = (t: number) => (t <= 6 ? 2 : 2.5) * t;

export function weight(p: WeightIn): WeightOut {
  const { a, b, t, L, n, rho } = p;
  let A = 0, per = 0, valid = true;
  switch (p.shape) {
    case 'plate': A = a * b; per = 2 * b + 2 * a; break; // a = thickness, b = width
    case 'round': A = (Math.PI / 4) * a * a; per = Math.PI * a; break;
    case 'square': A = a * a; per = 4 * a; break;
    case 'flat': A = a * b; per = 2 * (a + b); break;
    case 'hex': A = (Math.sqrt(3) / 2) * a * a; per = 2 * Math.sqrt(3) * a; break; // a = across flats
    case 'tube': valid = 2 * t < a; A = Math.PI * (a - t) * t; per = Math.PI * a; break;
    case 'rhs': {
      valid = 2 * t < Math.min(a, b);
      const ro = Math.min(rhsRadius(t), Math.min(a, b) / 2), ri = Math.max(ro - t, 0);
      A = 2 * t * (a + b - 2 * t) - (4 - Math.PI) * (ro * ro - ri * ri);
      per = 2 * (a + b) - (8 - 2 * Math.PI) * ro;
      break;
    }
    case 'angle': valid = t < Math.min(a, b); A = t * (a + b - t); per = 2 * (a + b); break;
    case 'section': {
      const row = SECTIONS_TABLE[p.family][p.size] ?? SECTIONS_TABLE[p.family][0];
      A = row.A * 100;
      per = p.family === 'L' ? 4 * row.h : p.family === 'UPN' ? 2 * row.h + 4 * row.b - 2 * row.tw : 2 * row.h + 4 * row.b - 2 * row.tw;
      break;
    }
  }
  if (!(A > 0)) valid = false;
  const kgm = A * 1e-6 * rho;
  const volume = A * 1e-6 * (L / 1000);
  const kgPiece = volume * rho;
  // outside surface: perimeter × length + the two ends (cross-section), plate: two faces + edges
  const m2Piece = p.shape === 'plate' ? 2 * (b * L) * 1e-6 + 2 * (a * L + a * b) * 1e-6 : per * L * 1e-6 + 2 * A * 1e-6;
  return { A, perimeter: per, kgm: p.shape === 'plate' ? (a / 1000) * rho : kgm, kgPiece, kgTotal: kgPiece * n, m2Piece, volume, valid };
}
