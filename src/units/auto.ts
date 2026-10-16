/**
 * Automatic SI → US customary conversion of displayed text: every "<number> <SI unit>" in a label, value or check
 * is rewritten in US units (number · f + off, about 4 significant digits). Calculations stay in SI; equations are
 * not converted (the UI switches this off for them and for the cheatsheets).
 */
type Rule = { si: string; us: string; f: number; off?: number };

/** SI unit → US unit. Power (kW, MW: electrical and thermal use them in the US too), electrical units, seconds, rpm, degrees, % and K (temperature differences) stay as they are. */
export const AUTO_UNITS: Rule[] = [
  { si: 'MPa·m/s', us: 'psi·ft/min', f: (1000 / 6.894757293168) * (60 / 0.3048) }, // pv value of plain bearings
  { si: 'mm²/s', us: 'cSt', f: 1 }, // kinematic viscosity: US oil data use centistokes (same number)
  { si: 'mm/s', us: 'in/s', f: 1 / 25.4 },
  { si: 'kJ/(kg·K)', us: 'Btu/(lb·°F)', f: 0.2388458966 },
  { si: 'kJ/kg', us: 'Btu/lb', f: 0.4299226139 },
  { si: 'kg·m²', us: 'lb·ft²', f: 23.73036040 },
  { si: 'kg/m³', us: 'lb/ft³', f: 1 / 16.018463374 },
  { si: 'kN·m', us: 'kip·ft', f: 1 / 1.3558179483314 },
  { si: 'kN/m', us: 'kip/ft', f: 1 / 14.593902937 },
  { si: 'N·mm', us: 'lbf·in', f: 1 / 112.98482933 },
  { si: 'N·m', us: 'lbf·ft', f: 1 / 1.3558179483314 },
  { si: 'N/mm²', us: 'ksi', f: 1 / 6.894757293168 },
  { si: 'N/mm', us: 'lbf/in', f: 1 / 0.17512683465 },
  { si: 'N/m', us: 'lbf/ft', f: 1 / 14.593902937 },
  { si: 'm³/h', us: 'gpm', f: 4.402867539 },
  { si: 'm³/s', us: 'ft³/s', f: 1 / 0.028316846592 },
  { si: 'L/min', us: 'gpm', f: 1 / 3.785411784 },
  { si: 'L/s', us: 'gpm', f: 15.85032314 },
  { si: 'kg/h', us: 'lb/h', f: 1 / 0.45359237 },
  { si: 'kg/s', us: 'lb/s', f: 1 / 0.45359237 },
  { si: 'm/s²', us: 'ft/s²', f: 1 / 0.3048 },
  { si: 'km/h', us: 'mph', f: 1 / 1.609344 },
  { si: 'm/s', us: 'ft/s', f: 1 / 0.3048 },
  { si: 'mm⁴', us: 'in⁴', f: 1 / 416231.4256 },
  { si: 'cm⁴', us: 'in⁴', f: 1 / 41.62314256 },
  { si: 'mm³', us: 'in³', f: 1 / 16387.064 },
  { si: 'cm³', us: 'in³', f: 1 / 16.387064 },
  { si: 'mm²', us: 'in²', f: 1 / 645.16 },
  { si: 'cm²', us: 'in²', f: 1 / 6.4516 },
  { si: 'm²', us: 'ft²', f: 1 / 0.09290304 },
  { si: 'm³', us: 'ft³', f: 1 / 0.028316846592 },
  { si: 'GPa', us: 'Msi', f: 1 / 6.894757293168 },
  { si: 'MPa', us: 'ksi', f: 1 / 6.894757293168 },
  { si: 'kPa', us: 'psi', f: 1 / 6.894757293168 },
  { si: 'Pa', us: 'psi', f: 1 / 6894.757293168 },
  { si: 'bar', us: 'psi', f: 100 / 6.894757293168 },
  { si: 'kN', us: 'kip', f: 1 / 4.4482216152605 },
  { si: 'N', us: 'lbf', f: 1 / 4.4482216152605 },
  { si: '°C', us: '°F', f: 1.8, off: 32 },
  { si: 'kg', us: 'lb', f: 1 / 0.45359237 },
  { si: 'km', us: 'mi', f: 1 / 1.609344 },
  { si: 'µm', us: 'mil', f: 1 / 25.4 },
  { si: 'mm', us: 'in', f: 1 / 25.4 },
  { si: 'cm', us: 'in', f: 1 / 2.54 },
  { si: 'm', us: 'ft', f: 1 / 0.3048 },
  { si: 'L', us: 'gal', f: 1 / 3.785411784 },
  { si: 't', us: 'lb', f: 1000 / 0.45359237 },
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
// number, optional space, unit, and no letter / digit / exponent / slash or dot-operator right after the unit
const RE = new RegExp(
  `(^|[^\\w.,])([-−]?\\d+(?:\\.\\d+)?)(\\s?)(${AUTO_UNITS.map((r) => esc(r.si)).join('|')})(?![\\p{L}\\d²³⁴/·_])`,
  'gu',
);
const BY_SI = new Map(AUTO_UNITS.map((r) => [r.si, r]));

/** About 4 significant digits, no exponent. */
export function fmtUS(x: number) {
  if (!Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  return a >= 1e4 ? x.toFixed(0) : a > 0 && a < 1e-4 ? x.toExponential(2) : x.toPrecision(4);
}

const UNIT_ALT = AUTO_UNITS.map((r) => esc(r.si)).join('|');
// "a ≥ b unit": the bare number on the left of a comparison has the same unit
const CMP = new RegExp(`(^|[^\\w.,])([-−]?\\d+(?:\\.\\d+)?)(\\s?[≥≤<>=]\\s?)([-−]?\\d+(?:\\.\\d+)?)(\\s?)(${UNIT_ALT})(?![\\p{L}\\d²³⁴/·_])`, 'gu');

const PSI_MPA: Rule = { si: 'MPa', us: 'psi', f: 1000 / 6.894757293168 };
/** MPa: pressures (below 50 MPa) read better in psi, stresses in ksi. */
const ruleFor = (unit: string, size: number): Rule => (unit === 'MPa' && size < 50 ? PSI_MPA : BY_SI.get(unit)!);
const num = (s: string) => parseFloat(s.replace('−', '-'));
const out = (src: string, v: number) => (src.startsWith('−') ? fmtUS(v).replace('-', '−') : fmtUS(v));

/** Rewrites every "<number> <SI unit>" in the text in US units (also the bare left side of "a ≥ b unit"). */
export function toUSText(text: string): string {
  const step1 = text.replace(CMP, (_m, p0: string, a: string, op: string, b: string, sp: string, unit: string) => {
    const r = ruleFor(unit, Math.max(Math.abs(num(a)), Math.abs(num(b))));
    return `${p0}${out(a, num(a) * r.f + (r.off ?? 0))}${op}${out(b, num(b) * r.f + (r.off ?? 0))}${sp || ' '}${r.us}`;
  });
  return step1.replace(RE, (_m, p0: string, n: string, sp: string, unit: string) => {
    const r = ruleFor(unit, Math.abs(num(n)));
    return `${p0}${out(n, num(n) * r.f + (r.off ?? 0))}${sp || ' '}${r.us}`;
  });
}

/** "12.5 mm" → the rule for mm and the number 12.5 (for typed input of a slider that shows such a text). */
export function unitOfText(text: string): { rule: Rule; num: number } | null {
  const m = new RegExp(`^\\s*([-−]?\\d+(?:\\.\\d+)?)\\s?(${AUTO_UNITS.map((r) => esc(r.si)).join('|')})\\s*$`, 'u').exec(text);
  if (!m) return null;
  return { rule: BY_SI.get(m[2])!, num: parseFloat(m[1].replace('−', '-')) };
}

/** "3 mm" that must stay metric in US mode (e.g. a gear module): a word joiner before the unit stops the conversion. */
export const keepSIText = (num: string | number, unit: string) => `${num} \u2060${unit}`;
/** Gear module display: metric module always; in US units also the diametral pitch P_d = 25.4/m [1/in] US catalogues use. */
export const moduleText = (m: number, sys: 'SI' | 'US') => (sys === 'US' ? `${keepSIText(m, 'mm')} · DP ${Number((25.4 / m).toFixed(3))}` : keepSIText(m, 'mm'));
