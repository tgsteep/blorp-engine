/**
 * Unit converter: each unit is a factor to the SI unit of its quantity (temperature also an offset).
 * Exact definitions where they exist (inch 0.0254 m, pound 0.45359237 kg, standard gravity 9.80665 m/s²,
 * IT calorie 4.1868 J, IT Btu 1055.05585262 J, US gallon 231 in³, imperial gallon 4.54609 L, atm 101325 Pa).
 */

/** w: the label contains words to translate (others are unit symbols shown as they are). */
export type Unit = { id: string; label: string; f: number; off?: number; w?: 1 };
export type Quantity = { id: string; label: string; si: string; units: Unit[] };

const IN = 0.0254, FT = 0.3048, LB = 0.45359237, G0 = 9.80665, LBF = LB * G0;
const GAL = 231 * IN ** 3, IGAL = 4.54609e-3, BTU = 1055.05585262, CAL = 4.1868;
const PSI = LBF / IN ** 2;

export const QUANTITIES: Quantity[] = [
  { id: 'length', label: 'Length', si: 'm', units: [
    { id: 'mm', label: 'mm', f: 1e-3 }, { id: 'cm', label: 'cm', f: 1e-2 }, { id: 'm', label: 'm', f: 1 }, { id: 'km', label: 'km', f: 1e3 },
    { id: 'um', label: 'µm', f: 1e-6 }, { id: 'in', label: 'in', f: IN }, { id: 'ft', label: 'ft', f: FT }, { id: 'yd', label: 'yd', f: 0.9144 },
    { id: 'mi', label: 'mile', w: 1, f: 1609.344 }, { id: 'nmi', label: 'nautical mile', w: 1, f: 1852 }, { id: 'mil', label: 'mil (thou)', w: 1, f: IN / 1000 },
  ] },
  { id: 'area', label: 'Area', si: 'm²', units: [
    { id: 'mm2', label: 'mm²', f: 1e-6 }, { id: 'cm2', label: 'cm²', f: 1e-4 }, { id: 'm2', label: 'm²', f: 1 }, { id: 'ha', label: 'ha', f: 1e4 },
    { id: 'km2', label: 'km²', f: 1e6 }, { id: 'in2', label: 'in²', f: IN ** 2 }, { id: 'ft2', label: 'ft²', f: FT ** 2 }, { id: 'yd2', label: 'yd²', f: 0.9144 ** 2 },
    { id: 'acre', label: 'acre', w: 1, f: 4046.8564224 }, { id: 'donum', label: 'decare (dönüm)', w: 1, f: 1000 },
  ] },
  { id: 'volume', label: 'Volume', si: 'm³', units: [
    { id: 'mL', label: 'mL (cm³)', f: 1e-6 }, { id: 'L', label: 'L', f: 1e-3 }, { id: 'm3', label: 'm³', f: 1 }, { id: 'in3', label: 'in³', f: IN ** 3 },
    { id: 'ft3', label: 'ft³', f: FT ** 3 }, { id: 'gal', label: 'US gal', f: GAL }, { id: 'igal', label: 'imp gal', f: IGAL },
    { id: 'floz', label: 'US fl oz', f: GAL / 128 }, { id: 'bbl', label: 'oil barrel', w: 1, f: 42 * GAL },
  ] },
  { id: 'mass', label: 'Mass', si: 'kg', units: [
    { id: 'g', label: 'g', f: 1e-3 }, { id: 'kg', label: 'kg', f: 1 }, { id: 't', label: 't', f: 1e3 }, { id: 'lb', label: 'lb', f: LB },
    { id: 'oz', label: 'oz', f: LB / 16 }, { id: 'ston', label: 'US ton', w: 1, f: 2000 * LB }, { id: 'lton', label: 'long ton', w: 1, f: 2240 * LB },
  ] },
  { id: 'force', label: 'Force', si: 'N', units: [
    { id: 'N', label: 'N', f: 1 }, { id: 'kN', label: 'kN', f: 1e3 }, { id: 'MN', label: 'MN', f: 1e6 }, { id: 'kgf', label: 'kgf', f: G0 },
    { id: 'tf', label: 'tf (metric)', w: 1, f: 1000 * G0 }, { id: 'lbf', label: 'lbf', f: LBF }, { id: 'kip', label: 'kip', f: 1000 * LBF }, { id: 'dyn', label: 'dyn', f: 1e-5 },
  ] },
  { id: 'pressure', label: 'Pressure and stress', si: 'Pa', units: [
    { id: 'Pa', label: 'Pa', f: 1 }, { id: 'kPa', label: 'kPa', f: 1e3 }, { id: 'MPa', label: 'MPa (N/mm²)', f: 1e6 }, { id: 'GPa', label: 'GPa', f: 1e9 },
    { id: 'bar', label: 'bar', f: 1e5 }, { id: 'mbar', label: 'mbar', f: 100 }, { id: 'atm', label: 'atm', f: 101325 }, { id: 'psi', label: 'psi', f: PSI },
    { id: 'ksi', label: 'ksi', f: 1000 * PSI }, { id: 'kgfcm2', label: 'kgf/cm²', f: G0 * 1e4 }, { id: 'mmHg', label: 'mmHg (torr)', f: 133.322387415 },
    { id: 'mmH2O', label: 'mmH₂O', f: G0 }, { id: 'inH2O', label: 'inH₂O', f: 249.08891 }, { id: 'inHg', label: 'inHg', f: 3386.389 },
  ] },
  { id: 'energy', label: 'Energy and work', si: 'J', units: [
    { id: 'J', label: 'J', f: 1 }, { id: 'kJ', label: 'kJ', f: 1e3 }, { id: 'MJ', label: 'MJ', f: 1e6 }, { id: 'Wh', label: 'Wh', f: 3600 },
    { id: 'kWh', label: 'kWh', f: 3.6e6 }, { id: 'cal', label: 'cal', f: CAL }, { id: 'kcal', label: 'kcal', f: 1e3 * CAL }, { id: 'Btu', label: 'Btu', f: BTU },
    { id: 'therm', label: 'therm', f: 1e5 * BTU }, { id: 'ftlbf', label: 'ft·lbf', f: FT * LBF }, { id: 'toe', label: 'toe (tonne of oil eq.)', w: 1, f: 41.868e9 },
    { id: 'eV', label: 'eV', f: 1.602176634e-19 },
  ] },
  { id: 'power', label: 'Power', si: 'W', units: [
    { id: 'W', label: 'W', f: 1 }, { id: 'kW', label: 'kW', f: 1e3 }, { id: 'MW', label: 'MW', f: 1e6 }, { id: 'hp', label: 'hp', f: 550 * FT * LBF },
    { id: 'PS', label: 'PS (metric hp)', w: 1, f: 75 * G0 }, { id: 'Btuh', label: 'Btu/h', f: BTU / 3600 }, { id: 'kcalh', label: 'kcal/h', f: 1e3 * CAL / 3600 },
    { id: 'TR', label: 'ton of refrigeration', w: 1, f: 12000 * BTU / 3600 }, { id: 'ftlbfs', label: 'ft·lbf/s', f: FT * LBF },
  ] },
  { id: 'temperature', label: 'Temperature', si: 'K', units: [
    { id: 'C', label: '°C', f: 1, off: 273.15 }, { id: 'K', label: 'K', f: 1 }, { id: 'F', label: '°F', f: 5 / 9, off: 273.15 - 32 * 5 / 9 },
    { id: 'R', label: '°R', f: 5 / 9 },
  ] },
  { id: 'speed', label: 'Speed', si: 'm/s', units: [
    { id: 'ms', label: 'm/s', f: 1 }, { id: 'kmh', label: 'km/h', f: 1 / 3.6 }, { id: 'mmin', label: 'm/min', f: 1 / 60 }, { id: 'mph', label: 'mph', f: 1609.344 / 3600 },
    { id: 'kn', label: 'knot', w: 1, f: 1852 / 3600 }, { id: 'fts', label: 'ft/s', f: FT }, { id: 'ftmin', label: 'ft/min', f: FT / 60 },
  ] },
  { id: 'flow', label: 'Volume flow', si: 'm³/s', units: [
    { id: 'm3s', label: 'm³/s', f: 1 }, { id: 'm3h', label: 'm³/h', f: 1 / 3600 }, { id: 'Ls', label: 'L/s', f: 1e-3 }, { id: 'Lmin', label: 'L/min', f: 1e-3 / 60 },
    { id: 'Lh', label: 'L/h', f: 1e-3 / 3600 }, { id: 'gpm', label: 'US gpm', f: GAL / 60 }, { id: 'igpm', label: 'imp gpm', w: 1, f: IGAL / 60 },
    { id: 'cfm', label: 'cfm (ft³/min)', f: FT ** 3 / 60 }, { id: 'bpd', label: 'barrel/day', w: 1, f: 42 * GAL / 86400 },
  ] },
  { id: 'massflow', label: 'Mass flow', si: 'kg/s', units: [
    { id: 'kgs', label: 'kg/s', f: 1 }, { id: 'kgh', label: 'kg/h', f: 1 / 3600 }, { id: 'th', label: 't/h', f: 1 / 3.6 }, { id: 'lbs', label: 'lb/s', f: LB },
    { id: 'lbh', label: 'lb/h', f: LB / 3600 },
  ] },
  { id: 'torque', label: 'Torque', si: 'N·m', units: [
    { id: 'Nm', label: 'N·m', f: 1 }, { id: 'kNm', label: 'kN·m', f: 1e3 }, { id: 'Ncm', label: 'N·cm', f: 1e-2 }, { id: 'kgfm', label: 'kgf·m', f: G0 },
    { id: 'lbfft', label: 'lbf·ft', f: LBF * FT }, { id: 'lbfin', label: 'lbf·in', f: LBF * IN }, { id: 'ozfin', label: 'ozf·in', f: LBF / 16 * IN },
  ] },
  { id: 'density', label: 'Density', si: 'kg/m³', units: [
    { id: 'kgm3', label: 'kg/m³', f: 1 }, { id: 'gcm3', label: 'g/cm³ (kg/L)', f: 1000 }, { id: 'lbft3', label: 'lb/ft³', f: LB / FT ** 3 },
    { id: 'lbin3', label: 'lb/in³', f: LB / IN ** 3 }, { id: 'lbgal', label: 'lb/US gal', f: LB / GAL },
  ] },
  { id: 'dynvisc', label: 'Dynamic viscosity', si: 'Pa·s', units: [
    { id: 'Pas', label: 'Pa·s', f: 1 }, { id: 'mPas', label: 'mPa·s (cP)', f: 1e-3 }, { id: 'P', label: 'P (poise)', w: 1, f: 0.1 }, { id: 'lbfts', label: 'lb/(ft·s)', f: LB / FT },
  ] },
  { id: 'kinvisc', label: 'Kinematic viscosity', si: 'm²/s', units: [
    { id: 'm2s', label: 'm²/s', f: 1 }, { id: 'cSt', label: 'mm²/s (cSt)', f: 1e-6 }, { id: 'St', label: 'St (stokes)', w: 1, f: 1e-4 }, { id: 'ft2s', label: 'ft²/s', f: FT ** 2 },
  ] },
  { id: 'angle', label: 'Angle', si: 'rad', units: [
    { id: 'deg', label: '°', f: Math.PI / 180 }, { id: 'rad', label: 'rad', f: 1 }, { id: 'gon', label: 'gon', f: Math.PI / 200 },
    { id: 'arcmin', label: 'arcmin', f: Math.PI / 10800 }, { id: 'arcsec', label: 'arcsec', f: Math.PI / 648000 }, { id: 'rev', label: 'revolution', w: 1, f: 2 * Math.PI },
    { id: 'mmm', label: 'mm/m (slope)', w: 1, f: NaN }, { id: 'pct', label: '% (slope)', w: 1, f: NaN },
  ] },
  { id: 'rotation', label: 'Rotational speed', si: 'rad/s', units: [
    { id: 'rpm', label: 'rpm', f: 2 * Math.PI / 60 }, { id: 'rads', label: 'rad/s', f: 1 }, { id: 'Hz', label: 'rev/s (Hz)', w: 1, f: 2 * Math.PI }, { id: 'degs', label: '°/s', f: Math.PI / 180 },
  ] },
  { id: 'inertia', label: 'Second moment of area', si: 'm⁴', units: [
    { id: 'mm4', label: 'mm⁴', f: 1e-12 }, { id: 'cm4', label: 'cm⁴', f: 1e-8 }, { id: 'm4', label: 'm⁴', f: 1 }, { id: 'in4', label: 'in⁴', f: IN ** 4 },
  ] },
  { id: 'htc', label: 'Heat transfer coefficient', si: 'W/(m²·K)', units: [
    { id: 'Wm2K', label: 'W/(m²·K)', f: 1 }, { id: 'kcal', label: 'kcal/(h·m²·°C)', f: CAL * 1000 / 3600 }, { id: 'Btu', label: 'Btu/(h·ft²·°F)', f: BTU / 3600 / FT ** 2 * 1.8 },
  ] },
  { id: 'conductivity', label: 'Thermal conductivity', si: 'W/(m·K)', units: [
    { id: 'WmK', label: 'W/(m·K)', f: 1 }, { id: 'kcal', label: 'kcal/(h·m·°C)', f: CAL * 1000 / 3600 }, { id: 'Btu', label: 'Btu/(h·ft·°F)', f: BTU / 3600 / FT * 1.8 },
  ] },
];

export const quantityById = (id: string) => QUANTITIES.find((q) => q.id === id) ?? QUANTITIES[0];

/** Value in SI from a value in unit u (slopes in the angle list are converted through the tangent). */
export function toSI(u: Unit, v: number) {
  if (u.id === 'mmm') return Math.atan(v / 1000);
  if (u.id === 'pct') return Math.atan(v / 100);
  return v * u.f + (u.off ?? 0);
}
export function fromSI(u: Unit, si: number) {
  if (u.id === 'mmm') return Math.tan(si) * 1000;
  if (u.id === 'pct') return Math.tan(si) * 100;
  return (si - (u.off ?? 0)) / u.f;
}
export const convert = (q: Quantity, from: string, to: string, v: number) => {
  const a = q.units.find((u) => u.id === from)!, b = q.units.find((u) => u.id === to)!;
  return fromSI(b, toSI(a, v));
};

/** Readable number: 6 significant digits, plain notation from 10⁻⁴ to 10⁹, otherwise a power of ten. */
export function fmtNum(v: number) {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e-4 && a < 1e9) {
    const s = Number(v.toPrecision(6)).toString();
    return s.includes('e') ? v.toFixed(Math.max(0, 6 - Math.floor(Math.log10(a)) - 1)) : s;
  }
  const e = Math.floor(Math.log10(a)), m = Number((v / 10 ** e).toPrecision(5));
  return `${m} × 10${String(e).replace('-', '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d])}`;
}
