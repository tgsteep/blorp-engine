/**
 * Galvanic corrosion of two metals in contact: anodic index table (MIL-STD-889 style), allowed difference for the
 * environment, which metal is the anode, and a rough rate of the extra attack on the anode from the cathodic
 * (oxygen-reduction) current collected by the cathode area: i_a = i_c (A_c/A_a), Faraday's law for the metal loss.
 */
export type MetalId = 'gold' | 'silver' | 'titanium' | 'nickel' | 'copper' | 'brass' | 'ss316' | 'ss304' | 'chrome' | 'tin' | 'lead' | 'al2024' | 'steel' | 'castiron' | 'al6061' | 'zinc' | 'magnesium';
/** Anodic index [V] (higher = more anodic) with the data Faraday's law needs: molar mass, valence, density, colour. */
export const METALS: Record<MetalId, { name: string; ai: number; M: number; n: number; rho: number; color: string }> = {
  gold: { name: 'Gold', ai: 0.0, M: 196.97, n: 3, rho: 19300, color: '#D4AF37' },
  silver: { name: 'Silver', ai: 0.15, M: 107.87, n: 1, rho: 10490, color: '#C9CDD2' },
  titanium: { name: 'Titanium', ai: 0.15, M: 47.87, n: 4, rho: 4500, color: '#8E9AA6' },
  nickel: { name: 'Nickel, Monel', ai: 0.3, M: 58.69, n: 2, rho: 8900, color: '#B8B9AE' },
  copper: { name: 'Copper', ai: 0.35, M: 63.55, n: 2, rho: 8960, color: '#B87333' },
  brass: { name: 'Brass, bronze', ai: 0.4, M: 64.5, n: 2, rho: 8500, color: '#C9A43A' },
  ss316: { name: 'Stainless 316 (passive)', ai: 0.45, M: 55.85, n: 2, rho: 8000, color: '#C3C8CE' },
  ss304: { name: 'Stainless 304 (passive)', ai: 0.5, M: 55.85, n: 2, rho: 7900, color: '#BCC2C9' },
  chrome: { name: 'Chromium plating', ai: 0.6, M: 52.0, n: 3, rho: 7190, color: '#DDE3EA' },
  tin: { name: 'Tin, tin-lead solder', ai: 0.65, M: 118.71, n: 2, rho: 7290, color: '#A9ACB0' },
  lead: { name: 'Lead', ai: 0.7, M: 207.2, n: 2, rho: 11340, color: '#6E747C' },
  al2024: { name: 'Aluminium 2024 (with copper)', ai: 0.75, M: 26.98, n: 3, rho: 2780, color: '#C0C6CC' },
  steel: { name: 'Carbon steel', ai: 0.85, M: 55.85, n: 2, rho: 7870, color: '#6B7280' },
  castiron: { name: 'Cast iron', ai: 0.85, M: 55.85, n: 2, rho: 7200, color: '#4B5056' },
  al6061: { name: 'Aluminium 6061, 5xxx', ai: 0.9, M: 26.98, n: 3, rho: 2700, color: '#D0D5DA' },
  zinc: { name: 'Zinc, galvanising', ai: 1.2, M: 65.38, n: 2, rho: 7140, color: '#9FA8B2' },
  magnesium: { name: 'Magnesium', ai: 1.75, M: 24.31, n: 2, rho: 1740, color: '#E3E4DD' },
};
export type Env = 'harsh' | 'normal' | 'controlled';
/** Allowed anodic index difference and a rough cathodic (oxygen-limited) current density on the cathode [A/m²]. */
export const ENVS: Record<Env, { name: string; dE: number; ic: number }> = {
  harsh: { name: 'Marine, salt spray, outdoors wet', dE: 0.15, ic: 0.1 },
  normal: { name: 'Outdoors sheltered, humid indoors', dE: 0.25, ic: 0.02 },
  controlled: { name: 'Indoors dry, climate controlled', dE: 0.5, ic: 0.002 },
};
export const FARADAY = 96485, YEAR = 3.156e7;

/** Metal loss rate [mm/year] for a current density i [A/m²] (Faraday). */
export const rateMm = (m: MetalId, i: number) => { const x = METALS[m]; return ((i * x.M / 1000) / (x.n * FARADAY * x.rho)) * YEAR * 1000; };

export type GalvIn = {
  a: MetalId; b: MetalId;
  env: Env;
  ratio: number;      // area of the cathode / area of the anode (wetted, near the joint)
  years: number;
  t: number;          // anode thickness [mm]
  isolated: boolean;  // insulating washers and sleeves break the electrical contact
};

export function galvanic(p: GalvIn) {
  const A = METALS[p.a], B = METALS[p.b], e = ENVS[p.env];
  const anode: MetalId = A.ai >= B.ai ? p.a : p.b, cathode: MetalId = anode === p.a ? p.b : p.a;
  const dE = Math.abs(A.ai - B.ai);
  // coupling current: the oxygen-limited cathodic current collected over the cathode, scaled down for small potential differences
  const drive = Math.min(1, dE / 0.2), ia = p.isolated || dE === 0 ? 0 : e.ic * p.ratio * drive;
  const cr = rateMm(anode, ia), loss = cr * p.years, life = cr > 0 ? p.t / cr : Infinity;
  const checks = [
    { ok: p.isolated || dE <= e.dE, label: 'Anodic index difference within the limit for the environment', detail: `ΔE = ${dE.toFixed(2)} V ≤ ${e.dE.toFixed(2)} V${p.isolated ? ' (joint isolated)' : ''}` },
    { ok: p.isolated || dE <= 0.05 || p.ratio <= 1, label: 'Anode not smaller than the cathode (a small anode on a big cathode corrodes fast)', detail: `A_cathode/A_anode = ${p.ratio.toFixed(2)}` },
    { ok: loss <= 0.5 * p.t, label: 'Anode keeps at least half its thickness over the service life', detail: `loss ${loss.toFixed(3)} mm in ${p.years} years of ${p.t.toFixed(1)} mm` },
  ];
  return { anode, cathode, dE, drive, ia, cr, loss, life, env: e, checks };
}
export type GalvResult = ReturnType<typeof galvanic>;

export const GALV_INTRO = 'Two different metals touching in water or a damp film form a battery: the less noble one (the anode) dissolves faster than it would alone, the nobler one (the cathode) is protected. The bigger the difference in their position on the galvanic series and the wetter or saltier the environment, the worse it gets — and a small anode next to a large cathode suffers most, because the whole cathode area feeds current into it. Galvanising works the other way round: zinc sacrifices itself to protect steel.';

export const GALV_NOTES = [
  'Anodic index in the style of the MIL-STD-889 / MIL-F-14072 tables (volts, gold = 0, higher = more anodic) with the usual allowed differences: 0.15 V in harsh (marine, salt spray, wet outdoor), 0.25 V in normal (sheltered, humid indoor) and 0.50 V in controlled (dry, air-conditioned) environments. Stainless steels only in their passive state; in crevices they can become active and much more anodic.',
  'Rate (rough, for comparison only): the cathode collects an oxygen-limited current density i_c (about 0.1 A/m² in seawater, less in thin damp films), which flows into the anode: i_a = i_c (A_c/A_a), reduced for differences below 0.2 V; metal loss from Faraday’s law, rate = i M/(n F ρ). The anode’s own corrosion without the couple, local pitting, deposits, flow, temperature and polarisation details are not included.',
  'Remedies: choose metals close in the series, keep the anode the larger part, coat the cathode (not only the anode), isolate the joint with insulating washers and sleeves, keep water out, or add a sacrificial anode (zinc, aluminium, magnesium).',
];
