/**
 * Bearing families at overview level: how each works, where it is used, typical friction and limits.
 * Values are typical orders of magnitude from textbooks and manufacturer literature, rounded.
 */

export type Family = 'rolling' | 'plain' | 'special';
export type BearingKind = {
  id: string; family: Family; name: string; how: string; uses: string;
  mu: [number, number]; // typical friction coefficient range
  speed: string; load: string; pros: string; cons: string; href?: string; cost: string;
};

export const FAMILIES: { id: Family; label: string; blurb: string }[] = [
  { id: 'rolling', label: 'Rolling bearings', blurb: 'Balls or rollers between two rings. Standard, cheap, low friction from standstill; finite fatigue life.' },
  { id: 'plain', label: 'Plain (sliding) bearings', blurb: 'A shaft slides in a sleeve. Dry or greased bushings for slow pivots; a full oil film for big, fast, quiet machines.' },
  { id: 'special', label: 'Contact-free: magnetic and air', blurb: 'The shaft floats on a magnetic field or a thin air film. Almost no friction and no wear, but low load and a support system that must never stop.' },
];

export const KINDS: BearingKind[] = [
  // rolling — all in the Rolling bearings tool
  { id: 'ball', family: 'rolling', name: 'Deep groove ball (60xx, 62xx, 63xx)', how: 'One row of balls in deep raceways. Takes radial load and moderate axial load both ways.', uses: 'electric motors, fans, pumps, gearboxes, skateboard wheels', mu: [0.001, 0.0015], speed: 'very high', load: 'medium', pros: 'cheapest, quiet, sealed for life', cons: 'little shock and misalignment tolerance', href: '/bearings', cost: '€' },
  { id: 'angular', family: 'rolling', name: 'Angular contact ball (72xx B)', how: 'Raceways offset so the balls touch at 40°: high axial load in one direction. Mounted in pairs.', uses: 'machine-tool spindles, pumps, worm gear shafts', mu: [0.0012, 0.002], speed: 'very high', load: 'medium, axial', pros: 'stiff, precise, fast', cons: 'needs a pair and correct preload', href: '/bearings', cost: '€€' },
  { id: 'selfalign', family: 'rolling', name: 'Self-aligning ball (12xx)', how: 'Two rows of balls in a spherical outer raceway: the inner ring with the shaft may tilt by 2…3°.', uses: 'long agricultural and textile shafts, conveyors, fans on frames', mu: [0.001, 0.0012], speed: 'high', load: 'light–medium', pros: 'tolerates shaft bending and poor alignment, low friction', cons: 'lower capacity than spherical rollers', href: '/bearings', cost: '€€' },
  { id: 'thrust', family: 'rolling', name: 'Thrust ball (511xx)', how: 'Balls between two flat washers: axial load only, in one direction.', uses: 'swivel chairs, crane hooks, vertical shafts, tailstocks', mu: [0.0013, 0.002], speed: 'medium (balls are thrown outward)', load: 'axial only', pros: 'simple, compact for pure axial load', cons: 'no radial load at all — needs a radial bearing beside it', href: '/bearings', cost: '€' },
  { id: 'roller', family: 'rolling', name: 'Cylindrical roller (NU)', how: 'Rollers touch along a line instead of a point: much higher radial capacity. NU rings separate for mounting.', uses: 'large motors, gearboxes, rolling mills, rail axle boxes', mu: [0.0011, 0.0015], speed: 'high', load: 'high radial', pros: 'high radial load, allows thermal shaft growth', cons: 'no axial load (NU type)', href: '/bearings', cost: '€€' },
  { id: 'tapered', family: 'rolling', name: 'Tapered roller (302xx)', how: 'Conical rollers between a cone and a cup; all cone lines meet at one point on the axis. Combined radial + axial.', uses: 'car wheel hubs, differentials, gearbox shafts', mu: [0.0018, 0.0025], speed: 'medium', load: 'high, combined', pros: 'high combined load, adjustable play', cons: 'mounted in pairs, needs adjustment', href: '/bearings', cost: '€€' },
  { id: 'spherical', family: 'rolling', name: 'Spherical roller (222xx)', how: 'Two rows of barrel rollers in a spherical outer raceway: heavy load and self-aligning.', uses: 'crushers, vibrating screens, paper machines, wind turbine main shafts', mu: [0.0018, 0.0025], speed: 'medium', load: 'very high', pros: 'heaviest load, shocks, misalignment', cons: 'higher friction, expensive', href: '/bearings', cost: '€€€' },
  // plain
  { id: 'bushing', family: 'plain', name: 'Bushing (dry, greased, oil-impregnated)', how: 'A sleeve of plastic, sintered bronze, PTFE composite or bronze. The surfaces touch; the limit is heat and wear, measured by p·v.', uses: 'hinges, linkages, pivots, small appliance motors, car seats and pedals, construction machinery pins', mu: [0.05, 0.3], speed: 'low', load: 'high at low speed', pros: 'cheapest, thin, shock-proof, quiet, no fatigue', cons: 'friction and wear; limited speed', href: '/bearing/plain', cost: '€' },
  { id: 'journal', family: 'plain', name: 'Hydrodynamic journal bearing', how: 'The turning shaft drags oil into a narrowing gap and builds pressure that lifts it — no contact while running. Contact only at start and stop.', uses: 'car engine crankshafts, steam and gas turbines, large compressors, ship propeller shafts', mu: [0.001, 0.01], speed: 'high', load: 'very high', pros: 'unlimited life when the film holds, quiet, damping', cons: 'needs continuous oil supply; wear at start-up', href: '/bearing/journal', cost: '€€' },
  { id: 'hydrostatic', family: 'plain', name: 'Hydrostatic bearing', how: 'A pump forces oil into pockets; the pressure lifts the load even at zero speed. Film thickness set by restrictors.', uses: 'precision machine tools, large telescopes and radio antennas, test rigs', mu: [0.000001, 0.001], speed: 'any, including zero', load: 'very high', pros: 'no wear ever, very stiff and precise', cons: 'pump, filters and power always on', cost: '€€€€' },
  // special
  { id: 'amb', family: 'special', name: 'Active magnetic bearing', how: 'Electromagnets pull on the rotor; position sensors and a controller adjust the currents thousands of times per second so the rotor floats in a 0.3…1 mm gap. Load capacity is set by the magnetic pressure B²/(2μ₀).', uses: 'turbo compressors and blowers, flywheel energy storage, turbomolecular pumps, high-speed spindles', mu: [0.00001, 0.0001], speed: 'very high (rotor-strength limit)', load: 'low–medium (≈ 0.3…0.6 MPa on the pole area)', pros: 'no oil, no wear, controllable stiffness and damping, condition monitoring built in', cons: 'expensive; needs power, sensors, controller and back-up (touchdown) rolling bearings for power loss', cost: '€€€€' },
  { id: 'aerostatic', family: 'special', name: 'Aerostatic air bearing', how: 'Compressed air (4…6 bar) flows through a porous carbon face or small orifices and forms a 3…10 µm film.', uses: 'coordinate measuring machines, wafer steppers, precision stages, optical tables', mu: [0.000001, 0.00001], speed: 'any, including zero', load: 'low (≈ 0.1…0.3 MPa on the pad)', pros: 'zero friction and wear, nanometre-smooth motion, clean', cons: 'needs clean, dry compressed air all the time; low damping', cost: '€€€' },
  { id: 'foil', family: 'special', name: 'Aerodynamic foil air bearing', how: 'Thin compliant foils around the shaft; at speed the shaft drags air into a wedge (like an oil journal bearing, but with air). Touches at start/stop.', uses: 'aircraft air-cycle machines, micro gas turbines, oil-free turbo blowers, fuel-cell air compressors', mu: [0.0001, 0.001], speed: 'very high (> 50 000 rpm)', load: 'low', pros: 'no oil, no supply system, high temperature', cons: 'wear at start/stop, low load, special coatings', cost: '€€€' },
];

/** Magnetic pressure on a pole face [MPa] for flux density B [T]: p = B²/(2μ₀). */
export const MU0 = 4e-7 * Math.PI;
export const magneticPressure = (B: number) => (B * B) / (2 * MU0) / 1e6;

export const TYPES_NOTES =
  'Friction coefficients are typical running ranges (rolling: SKF-style constant μ values; plain: dry/boundary to full film; contact-free: equivalent drag). They depend strongly on load, speed and lubrication — use them to compare families, not to size a design. ' +
  'Magnetic load capacity from the magnetic pressure B²/(2μ₀) with 1.0…1.2 T in the iron (saturation limit), before control margins.';
