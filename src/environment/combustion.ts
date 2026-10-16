/**
 * Emissions from burning a fuel: combustion stoichiometry from the ultimate analysis (mass fractions as fired),
 * air demand, flue-gas volume and composition at an excess-air ratio λ, CO₂ per kg / GJ / kWh, SO₂ concentration at
 * the reference oxygen content, and a yearly carbon footprint of a heating plant with its electricity use.
 *
 *   O₂,min = c/12.011 + h/4.032 + s/32.06 − o/31.999   [kmol/kg fuel]
 *   flue gas: CO₂ = c/12.011, H₂O = h/2.016 + w/18.015, SO₂ = s/32.06, N₂ = n/28.013 + 3.76·λ·O₂,min, O₂ = (λ − 1)·O₂,min
 *   (air 21 % O₂ / 79 % N₂ by volume, dry; 22.414 Nm³/kmol at 0 °C, 101.325 kPa)
 * Complete combustion (no CO, no soot), all sulphur to SO₂ before removal, fuel nitrogen to N₂ (NOx is not predicted).
 * Units: kg, kmol, Nm³, MJ, kW, t/year.
 */

export type Check = { ok: boolean; label: string; detail: string };
export type FuelId = 'gas' | 'lpg' | 'diesel' | 'hfo' | 'coal' | 'lignite' | 'wood';

export type Fuel = {
  id: FuelId; name: string; short: string;
  c: number; h: number; o: number; n: number; s: number; ash: number; w: number; // mass fractions as fired
  LHV: number;          // net calorific value [MJ/kg]
  lam: [number, number]; // usual excess-air range
  so2Limit?: number;    // EU MCPD new plants 1–50 MW [mg/Nm³ dry at O2ref]
  o2ref: number;        // reference O₂ [vol % dry]
  ipcc?: number;        // IPCC 2006 default CO₂ factor [kg/GJ NCV] for comparison
  biogenic?: boolean;
  density?: number;     // liquid density [kg/L] for per-litre values
};

/** Natural gas as 95 % CH₄, 3 % C₂H₆, 1 % N₂, 1 % CO₂ (mol) → mass fractions. */
function gasMix() {
  const y = { CH4: 0.95, C2H6: 0.03, N2: 0.01, CO2: 0.01 }, M = { CH4: 16.043, C2H6: 30.069, N2: 28.013, CO2: 44.01 };
  const mass = y.CH4 * M.CH4 + y.C2H6 * M.C2H6 + y.N2 * M.N2 + y.CO2 * M.CO2;
  const c = (12.011 * (y.CH4 + 2 * y.C2H6 + y.CO2)) / mass, h = (1.008 * (4 * y.CH4 + 6 * y.C2H6)) / mass;
  const o = (31.999 * y.CO2) / mass, n = (28.013 * y.N2) / mass;
  const LHV = (y.CH4 * M.CH4 * 50.03 + y.C2H6 * M.C2H6 * 47.51) / mass; // MJ/kg of the mixture
  return { c, h, o, n, LHV };
}
const G = gasMix();

/** Typical as-fired analyses (rounded); real fuels vary — use the supplier's analysis for a permit. */
export const FUELS: Fuel[] = [
  { id: 'gas', name: 'Natural gas (95 % methane)', short: 'Natural gas', ...G, s: 0, ash: 0, w: 0, lam: [1.05, 1.2], o2ref: 3, ipcc: 56.1 },
  { id: 'lpg', name: 'LPG (propane)', short: 'LPG', c: 0.817, h: 0.183, o: 0, n: 0, s: 0, ash: 0, w: 0, LHV: 46.35, lam: [1.05, 1.2], o2ref: 3, ipcc: 63.1, density: 0.51 },
  { id: 'diesel', name: 'Gas oil / heating oil EL', short: 'Heating oil', c: 0.865, h: 0.134, o: 0.0008, n: 0.0002, s: 0.00001, ash: 0, w: 0, LHV: 42.8, lam: [1.1, 1.3], o2ref: 3, ipcc: 74.1, density: 0.84 },
  { id: 'hfo', name: 'Heavy fuel oil (1 % sulphur)', short: 'Heavy fuel oil', c: 0.86, h: 0.115, o: 0.005, n: 0.004, s: 0.01, ash: 0.001, w: 0.005, LHV: 40.4, lam: [1.1, 1.3], so2Limit: 350, o2ref: 3, ipcc: 77.4, density: 0.98 },
  { id: 'coal', name: 'Hard coal (bituminous)', short: 'Hard coal', c: 0.66, h: 0.042, o: 0.075, n: 0.013, s: 0.01, ash: 0.1, w: 0.1, LHV: 25.8, lam: [1.2, 1.5], so2Limit: 400, o2ref: 6, ipcc: 94.6 },
  { id: 'lignite', name: 'Lignite (brown coal)', short: 'Lignite', c: 0.33, h: 0.025, o: 0.09, n: 0.005, s: 0.01, ash: 0.1, w: 0.44, LHV: 11.9, lam: [1.2, 1.5], so2Limit: 400, o2ref: 6, ipcc: 101 },
  { id: 'wood', name: 'Wood pellets', short: 'Wood pellets', c: 0.47, h: 0.058, o: 0.4, n: 0.002, s: 0.0002, ash: 0.005, w: 0.0648, LHV: 17.0, lam: [1.4, 2.0], so2Limit: 200, o2ref: 6, biogenic: true },
];

const VM = 22.414; // Nm³/kmol

/** Stoichiometry per kg of fuel at excess-air ratio λ. */
export function burn(f: Fuel, lam: number) {
  const o2min = f.c / 12.011 + f.h / 4.032 + f.s / 32.06 - f.o / 31.999; // kmol/kg
  const airMin = o2min / 0.21, air = lam * airMin;                       // kmol/kg
  const nCO2 = f.c / 12.011, nH2O = f.h / 2.016 + f.w / 18.015, nSO2 = f.s / 32.06;
  const nN2 = f.n / 28.013 + 0.79 * air, nO2 = (lam - 1) * o2min;
  const dry = nCO2 + nSO2 + nN2 + nO2, wet = dry + nH2O;
  const mCO2 = nCO2 * 44.01, mSO2 = nSO2 * 64.06, mAir = air * 28.96;
  return {
    o2min, airMin, air, LminN: airMin * VM, LN: air * VM, mAirMin: airMin * 28.96, mAir,
    n: { CO2: nCO2, H2O: nH2O, SO2: nSO2, N2: nN2, O2: nO2 }, dry, wet,
    Vdry: dry * VM, Vwet: wet * VM,                                            // Nm³/kg
    mFlue: mCO2 + nH2O * 18.015 + mSO2 + nN2 * 28.013 + nO2 * 31.999,         // kg/kg
    mCO2, mSO2,
    O2dry: (100 * nO2) / dry, CO2dry: (100 * nCO2) / dry, CO2max: (100 * nCO2) / (nCO2 + nSO2 + f.n / 28.013 + 0.79 * airMin),
  };
}

export type EmIn = {
  fuel: Fuel; lam: number;
  Q: number;        // useful heat output [kW]
  eta: number;      // boiler efficiency on LHV
  hours: number;    // full-load hours per year
  so2Removal: number; // fraction of SO₂ removed (scrubber, sorbent)
  elec: number;     // electricity used per year [MWh]
  efGrid: number;   // grid factor [kg CO₂/kWh]
};

export function emissions(p: EmIn) {
  const f = p.fuel, b = burn(f, p.lam);
  const fuelPower = p.Q / p.eta;                       // kW fuel (LHV)
  const mFuel = (fuelPower / 1000 / f.LHV) * 3600;     // kg/h
  const co2PerGJ = (b.mCO2 / f.LHV) * 1000;            // kg/GJ
  const co2PerKWhFuel = (b.mCO2 / f.LHV) * 3.6;        // kg/kWh fuel
  const co2PerKWhHeat = co2PerKWhFuel / p.eta;
  const so2 = (b.mSO2 * 1e6 * (1 - p.so2Removal)) / b.Vdry;   // mg/Nm³ dry at actual O₂
  const so2Ref = (so2 * (21 - f.o2ref)) / (21 - b.O2dry);
  const flueN = mFuel * b.Vwet;                        // Nm³/h wet
  const fuelYear = (mFuel * p.hours) / 1000;           // t/year
  const co2Fuel = f.biogenic ? 0 : (b.mCO2 * mFuel * p.hours) / 1000; // t/year (biogenic reported separately)
  const co2Bio = f.biogenic ? (b.mCO2 * mFuel * p.hours) / 1000 : 0;
  const co2Elec = (p.elec * p.efGrid);                 // t/year (MWh × kg/kWh = t)
  const so2Year = (b.mSO2 * (1 - p.so2Removal) * mFuel * p.hours) / 1000; // t/year
  const checks: Check[] = [
    ...(f.so2Limit !== undefined ? [{ ok: so2Ref <= f.so2Limit, label: 'SO₂ below the EU limit for new medium combustion plants', detail: `${so2Ref.toFixed(0)} ≤ ${f.so2Limit} mg/Nm³ at ${f.o2ref} % O₂` }] : []),
    { ok: p.lam >= f.lam[0] && p.lam <= f.lam[1], label: 'Excess air in the usual range for the fuel', detail: `λ = ${p.lam.toFixed(2)}, ${f.lam[0]}…${f.lam[1]}` },
    { ok: fuelPower < 20000, label: 'Rated thermal input below 20 MW (outside the EU emissions trading scheme)', detail: `${(fuelPower / 1000).toFixed(2)} MW` },
  ];
  return {
    ...b, fuelPower, mFuel, co2PerGJ, co2PerKWhFuel, co2PerKWhHeat, so2, so2Ref, flueN, fuelYear,
    co2Fuel, co2Bio, co2Elec, co2Total: co2Fuel + co2Elec, so2Year, checks,
  };
}
export type EmResult = ReturnType<typeof emissions>;

/** CO₂ per kWh of useful heat for every fuel at its typical λ and the given efficiency, and for a heat pump. */
export function heatComparison(eta: number, efGrid: number, cop: number) {
  const rows = FUELS.map((f) => { const b = burn(f, (f.lam[0] + f.lam[1]) / 2); return { id: f.id as string, name: f.short, v: f.biogenic ? 0 : ((b.mCO2 / f.LHV) * 3.6) / eta, bio: f.biogenic ? ((b.mCO2 / f.LHV) * 3.6) / eta : 0 }; });
  rows.push({ id: 'hp', name: 'Heat pump', v: efGrid / cop, bio: 0 }, { id: 'el', name: 'Electric heater', v: efGrid, bio: 0 });
  return rows;
}

export const EM_INTRO = 'Burning a fuel turns its carbon into CO₂, its hydrogen into water and its sulphur into SO₂; the air brings the oxygen and a lot of nitrogen that only passes through. From the fuel analysis follow the air needed, the flue gas, the CO₂ per kWh of heat and the SO₂ concentration that the permit limits. A heating plant\'s yearly footprint adds the electricity it uses at the grid\'s emission factor.';

export const EM_NOTES = [
  'Stoichiometry from the ultimate analysis (mass fractions as fired): O₂,min = c/12 + h/4 + s/32 − o/32 kmol/kg; dry air 21 % O₂; complete combustion, no CO or soot; all sulphur forms SO₂ (minus the removal you set); fuel nitrogen leaves as N₂ — NOx and dust depend on the burner and filters and are not predicted. Normal cubic metres at 0 °C and 101.325 kPa. Fuel analyses and calorific values are typical, rounded figures; natural gas is taken as 95 % methane, 3 % ethane, 1 % N₂, 1 % CO₂ by volume.',
  'SO₂ is converted to the reference oxygen content c_ref = c·(21 − O₂,ref)/(21 − O₂) and compared with the EU Medium Combustion Plant Directive (2015/2193) limits for new boilers of 1…50 MW: solid biomass 200, other solid fuels 400, liquid fuels other than gas oil 350 mg/Nm³ (O₂,ref 6 % for solid, 3 % for liquid and gaseous fuels). Gas oil is limited by its sulphur content instead, natural gas has no SO₂ limit. Larger plants fall under the Industrial Emissions Directive and, above 20 MW rated thermal input, the EU emissions trading scheme.',
  'CO₂ from biomass is biogenic: national inventories report it separately and count it as zero in the energy sector (the land-use sector carries it), so it is shown apart. The comparison chart uses each fuel at the middle of its usual excess-air range; a heat pump\'s CO₂ is the grid factor divided by its seasonal COP. Grid factors change every year and between countries — use the current published value.',
];
