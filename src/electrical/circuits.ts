/**
 * DC resistor circuits: Ohm's law (U = R·I) and Kirchhoff's laws (KCL: currents into a node sum to zero;
 * KVL: voltages around a loop sum to zero). Ideal source E with internal resistance r. SI units.
 */
export type Topology = 'series' | 'parallel' | 'mixed';
export type CircuitIn = { E: number; r: number; R1: number; R2: number; R3: number; topo: Topology; Prated: number };

const par = (...R: number[]) => 1 / R.reduce((a, x) => a + 1 / x, 0);

export function solveCircuit(c: CircuitIn) {
  const { E, r, R1, R2, R3 } = c;
  let Rext: number, I: number, V: number[], Ib: number[];
  if (c.topo === 'series') {
    Rext = R1 + R2 + R3;
    I = E / (r + Rext);
    Ib = [I, I, I];
    V = [I * R1, I * R2, I * R3];
  } else if (c.topo === 'parallel') {
    Rext = par(R1, R2, R3);
    I = E / (r + Rext);
    const U = I * Rext;
    V = [U, U, U];
    Ib = [U / R1, U / R2, U / R3];
  } else { // R1 in series with (R2 ∥ R3)
    const R23 = par(R2, R3);
    Rext = R1 + R23;
    I = E / (r + Rext);
    const U23 = I * R23;
    V = [I * R1, U23, U23];
    Ib = [I, U23 / R2, U23 / R3];
  }
  const Uterm = E - I * r; // terminal voltage
  const P = Ib.map((i, k) => i * V[k]);
  const Pint = I * I * r;
  // Kirchhoff residuals (should be ~0): KVL around the outer loop, KCL at the branching node
  const kvl = c.topo === 'series' ? E - I * r - V[0] - V[1] - V[2] : c.topo === 'parallel' ? E - I * r - V[0] : E - I * r - V[0] - V[1];
  const kcl = c.topo === 'series' ? 0 : c.topo === 'parallel' ? I - Ib[0] - Ib[1] - Ib[2] : I - Ib[1] - Ib[2];
  const checks = [
    ...P.map((p, k) => ({ ok: p <= c.Prated, label: `Resistor R${k + 1} power ≤ rating ${c.Prated} W`, detail: `P${k + 1} = U·I = ${p.toFixed(3)} W` })),
    { ok: Math.abs(kvl) < 1e-9 && Math.abs(kcl) < 1e-9, label: 'Kirchhoff: ΣU around the loop = 0 and ΣI at the node = 0', detail: `KVL ${kvl.toExponential(1)} V, KCL ${kcl.toExponential(1)} A` },
    { ok: r === 0 || Pint / (E * I) < 0.2, label: 'Source losses < 20 % (internal resistance)', detail: `I²·r = ${Pint.toFixed(3)} W` },
  ];
  return { Rext, Rtot: r + Rext, I, Uterm, V, Ib, P, Pint, Ptot: E * I, kvl, kcl, checks };
}
export type CircuitResult = ReturnType<typeof solveCircuit>;

export const CIRCUIT_ASSUMPTIONS =
  'Ideal DC source E with internal resistance r, ideal wires (no resistance), resistors obey Ohm’s law at constant temperature (real resistors drift with heat). ' +
  'Moving dots show conventional current (from + to −); electrons actually drift the other way, only millimetres per second — the dots are slowed and scaled to compare branches, not real drift speed.';
