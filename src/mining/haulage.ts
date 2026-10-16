/**
 * Open-pit truck haulage: a loader fills trucks at the pit floor, the trucks climb a ramp to the dump and come back.
 * Truck speed on every segment from the power limit v = η P/(m g (RR + G)) (uphill or flat), the retarder limit
 * downhill and the speed limit; bucket passes per truck; cycle time; match factor and production of a fleet;
 * fuel from the propulsion energy plus idling. SI units, speeds shown in km/h, times in min.
 */
export type Check = { ok: boolean; label: string; detail: string };
export type TruckId = 'adt40' | 'rigid90' | 'rigid220';
/** Generic truck classes (typical published figures, rounded): payload and empty mass [t], gross power [kW], top
 *  speed [km/h], continuous retarding power [kW], length [m] for the drawing. */
export const TRUCKS: Record<TruckId, { name: string; payload: number; empty: number; P: number; vmax: number; Pret: number; len: number }> = {
  adt40: { name: 'Articulated 40 t', payload: 40, empty: 32, P: 350, vmax: 55, Pret: 500, len: 11.2 },
  rigid90: { name: 'Rigid 90 t', payload: 90, empty: 68, P: 750, vmax: 60, Pret: 1300, len: 10.5 },
  rigid220: { name: 'Rigid 220 t', payload: 220, empty: 160, P: 1900, vmax: 60, Pret: 3500, len: 14.5 },
};
export const ETA_DRIVE = 0.8, SFC = 0.22, DIESEL_RHO = 0.84; // drivetrain efficiency to the wheels, kg fuel/kWh, kg/L

export type HaulIn = {
  truck: TruckId; N: number;              // trucks in the fleet
  bucket: number; fill: number; rhoL: number; loaderCycle: number; // bucket [m³], fill factor, loose density [t/m³], loader pass time [s]
  L1: number; L2: number; G: number; L3: number; // pit floor [m], ramp length [m], ramp grade [%], surface to dump [m]
  RR: number; vlim: number;               // rolling resistance [%], speed limit on the ramp [km/h]
  spot: number; dump: number;             // spotting at the loader, dumping [min]
  eff: number;                            // job efficiency (working minutes per hour / 60)
  target: number;                         // required production [t/h]
  fuelPrice: number;                      // per litre
};

const g = 9.81;
/** Steady speed [m/s] of a truck of mass m [t] on total resistance TR (fraction, negative = downhill). */
export function segSpeed(m: number, TR: number, P: number, Pret: number, vmax: number, vlim: number) {
  const W = m * 1000 * g, cap = Math.min(vmax, vlim) / 3.6;
  if (TR > 1e-6) return Math.min(cap, (ETA_DRIVE * P * 1000) / (W * TR));
  if (TR < -1e-6) return Math.min(cap, (Pret * 1000) / (W * -TR));
  return cap;
}

export function haulage(p: HaulIn) {
  const T = TRUCKS[p.truck], bucketLoad = p.bucket * p.fill * p.rhoL;
  const passes = Math.max(1, Math.round(T.payload / bucketLoad)), load = Math.min(passes * bucketLoad, 1.1 * T.payload);
  const mL = T.empty + load, mE = T.empty, rr = p.RR / 100, G = p.G / 100;
  const segs = [{ id: 'pit floor', L: p.L1, G: 0 }, { id: 'ramp', L: p.L2, G }, { id: 'to the dump', L: p.L3, G: 0 }];
  const legs = (m: number, dir: 1 | -1) => (dir === 1 ? segs : [...segs].reverse()).map((s) => {
    const TR = rr + dir * s.G, vlim = s.id === 'ramp' ? p.vlim : T.vmax, v = segSpeed(m, TR, T.P, T.Pret, T.vmax, vlim), t = (s.L / v) * 1.1; // +10 % accelerating and curves
    const F = m * 1000 * g * TR, Pw = Math.max(0, F * v) / ETA_DRIVE / 1000; // engine power [kW]
    return { ...s, TR, v, t, Pw, limit: TR > 1e-6 && v < Math.min(T.vmax, vlim) / 3.6 - 1e-6 ? 'power' : TR < -1e-6 && v < Math.min(T.vmax, vlim) / 3.6 - 1e-6 ? 'retarder' : 'speed' };
  });
  const haul = legs(mL, 1), ret = legs(mE, -1);
  const tLoad = (passes * p.loaderCycle) / 60, tHaul = haul.reduce((s, l) => s + l.t, 0) / 60, tRet = ret.reduce((s, l) => s + l.t, 0) / 60;
  const cycle = p.spot + tLoad + tHaul + p.dump + tRet;           // min, without waiting
  const tLoader = p.spot + tLoad;                                  // loader busy per truck
  const MF = (p.N * tLoader) / cycle;                              // match factor
  const cycleEff = Math.max(cycle, p.N * tLoader), queue = cycleEff - cycle;
  const prod = (p.N * load * 60 / cycleEff) * p.eff;               // t/h
  const perTruck = (load * 60 / cycle) * p.eff, loaderMax = (load * 60 / tLoader) * p.eff;
  const Nreq = Math.ceil(p.target / perTruck - 1e-9);
  // fuel per cycle: propulsion energy plus idling at 10 % power over the rest of the time
  const Eprop = [...haul, ...ret].reduce((s, l) => s + (l.Pw * l.t) / 3600, 0), tMove = (tHaul + tRet) / 60;
  const Eidle = 0.1 * T.P * (cycleEff / 60 - tMove), fuelCycle = ((Eprop + Eidle) * SFC) / DIESEL_RHO; // L
  const fuelH = (fuelCycle * 60) / cycleEff, fuelT = fuelCycle / load, costT = fuelT * p.fuelPrice;
  const H = p.L2 * G;
  const checks: Check[] = [
    { ok: passes >= 3 && passes <= 6, label: 'Loader and truck matched: 3…6 bucket passes per truck', detail: `${passes} passes of ${bucketLoad.toFixed(1)} t` },
    { ok: load >= 0.9 * T.payload, label: 'Truck filled to at least 90 % of its payload', detail: `${load.toFixed(1)} t of ${T.payload} t` },
    { ok: p.G <= 10, label: 'Ramp grade at most 10 %', detail: `${p.G.toFixed(1)} %` },
    { ok: haul[1].v * 3.6 >= 8, label: 'Loaded truck climbs the ramp at 8 km/h or more', detail: `${(haul[1].v * 3.6).toFixed(1)} km/h` },
    { ok: MF >= 0.85 && MF <= 1.15, label: 'Fleet balanced: match factor 0.85…1.15 (trucks rarely wait, loader rarely idle)', detail: `MF = ${MF.toFixed(2)}` },
    { ok: prod >= p.target, label: 'Production reaches the target', detail: `${prod.toFixed(0)} t/h ≥ ${p.target.toFixed(0)} t/h (needs ${Nreq} trucks${Nreq * perTruck > loaderMax ? ', more than one loader can fill' : ''})` },
  ];
  return { T, bucketLoad, passes, load, mL, mE, haul, ret, tLoad, tHaul, tRet, cycle, tLoader, MF, cycleEff, queue, prod, perTruck, loaderMax, Nreq, Eprop, fuelCycle, fuelH, fuelT, costT, H, checks };
}
export type HaulResult = ReturnType<typeof haulage>;

export const HAUL_INTRO = 'In an open pit, broken rock leaves in trucks: a loader fills each truck in a few bucket passes, the truck climbs the ramp out of the pit, tips its load and comes back empty. The climb is what takes the time — on a steep ramp a loaded truck is limited by its engine power, on the way down by its brakes. The art is to match the fleet to the loader: too few trucks and the loader waits, too many and the trucks queue.';

export const HAUL_NOTES = [
  'Speed on each segment from the power limit v = η P/(m g (RR + G)) with drivetrain efficiency 0.8 (to the wheels), uphill or on the flat; downhill from the continuous retarding power P_ret = m g |RR + G| v; capped by the top speed and the speed limit on the ramp; travel times +10 % for accelerating, braking and bends. A real rimpull/retarder chart with gear steps gives somewhat different speeds; truck figures are generic for the class.',
  'Loading: passes = round(payload/(bucket × fill factor × loose density)), at most 110 % payload. Cycle = spot + load + haul + dump + return. Match factor MF = N (spot + load)/cycle; when MF > 1 the trucks queue and the loader sets the production. Production × job efficiency (working minutes per hour). One loader, one ramp, one dump; road maintenance, traffic, shift changes and blasting delays are not modelled.',
  'Fuel: wheel energy uphill and on the flat ÷ 0.8, plus idling at 10 % of rated power for the rest of the cycle, at 0.22 kg/kWh and 0.84 kg/L. Only fuel cost per tonne is shown; tyres, maintenance, operators and the trucks themselves usually cost more.',
];
