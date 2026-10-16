/**
 * Unit systems for display and input. Calculations always run in SI; this only converts what the user sees and types.
 * US customary value = SI value · f + off.
 */
export type UnitSys = 'SI' | 'US';
type Def = { si: string; us: string; f: number; off?: number };

export const QUANT = {
  mm: { si: 'mm', us: 'in', f: 1 / 25.4 },
  m: { si: 'm', us: 'ft', f: 1 / 0.3048 },
  km: { si: 'km', us: 'mi', f: 1 / 1.609344 },
  mm2: { si: 'mm²', us: 'in²', f: 1 / 645.16 },
  m2: { si: 'm²', us: 'ft²', f: 1 / 0.09290304 },
  N: { si: 'N', us: 'lbf', f: 1 / 4.4482216152605 },
  kN: { si: 'kN', us: 'lbf', f: 1000 / 4.4482216152605 },
  Nm: { si: 'N·m', us: 'lbf·ft', f: 1 / 1.3558179483314 },
  bar: { si: 'bar', us: 'psi', f: 100 / 6.894757293168 },
  kPa: { si: 'kPa', us: 'psi', f: 1 / 6.894757293168 },
  MPa: { si: 'MPa', us: 'ksi', f: 1 / 6.894757293168 },
  degC: { si: '°C', us: '°F', f: 1.8, off: 32 },
  dK: { si: 'K', us: '°F', f: 1.8 }, // temperature difference
  kg: { si: 'kg', us: 'lb', f: 1 / 0.45359237 },
  kgh: { si: 'kg/h', us: 'lb/h', f: 1 / 0.45359237 },
  kgs: { si: 'kg/s', us: 'lb/s', f: 1 / 0.45359237 },
  m3h: { si: 'm³/h', us: 'gpm', f: 4.402867539 },
  Lmin: { si: 'L/min', us: 'gpm', f: 1 / 3.785411784 },
  m3s: { si: 'm³/s', us: 'ft³/s', f: 1 / 0.028316846592 },
  kW: { si: 'kW', us: 'hp', f: 1 / 0.745699872 },
  ms: { si: 'm/s', us: 'mph', f: 1 / 0.44704 },
  kgm3: { si: 'kg/m³', us: 'lb/ft³', f: 1 / 16.018463374 },
  m3: { si: 'm³', us: 'gal', f: 264.172052358 },
  t: { si: 't', us: 'lb', f: 2204.62262185 },
  // HVAC: air flow, heating/cooling capacity and humidity ratio in the units US practice uses
  m3hAir: { si: 'm³/h', us: 'cfm', f: 1 / 1.69901082 },
  kWth: { si: 'kW', us: 'Btu/h', f: 3412.14163 },
  gkg: { si: 'g/kg', us: 'gr/lb', f: 7 },
  kgm: { si: 'kg/m', us: 'lb/ft', f: 0.3048 / 0.45359237 },
  kgm2: { si: 'kg/m²', us: 'lb/ft²', f: 0.09290304 / 0.45359237 },
} satisfies Record<string, Def>;
export type QId = keyof typeof QUANT;

const def = (q: QId): Def => QUANT[q];
/** SI value → value in the chosen system. */
export const toSys = (q: QId, v: number, sys: UnitSys) => (sys === 'SI' ? v : v * def(q).f + (def(q).off ?? 0));
/** Value in the chosen system → SI value. */
export const fromSys = (q: QId, v: number, sys: UnitSys) => (sys === 'SI' ? v : (v - (def(q).off ?? 0)) / def(q).f);
export const unitOf = (q: QId, sys: UnitSys) => (sys === 'SI' ? def(q).si : def(q).us);

/** Decimals that keep about 4 significant digits (0…4). */
export const autoDigits = (x: number) => (x === 0 || !Number.isFinite(x) ? 0 : Math.min(4, Math.max(0, 3 - Math.floor(Math.log10(Math.abs(x))))));

/** "145.0 psi": SI keeps the module's own decimals, US uses about 4 significant digits. */
export function fmtQ(q: QId, v: number, sys: UnitSys, siDigits?: number) {
  if (!Number.isFinite(v)) return '—';
  const x = toSys(q, v, sys);
  const n = sys === 'SI' && siDigits !== undefined ? siDigits : autoDigits(x);
  return `${x.toFixed(n)} ${unitOf(q, sys)}`;
}
