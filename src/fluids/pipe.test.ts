import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  G, colebrook, energyLine, fluidProps, frictionFactor, pipeParallel, pipeSection, pipeSeries, regimeOf, suddenChange, sumK,
  waterDensity, waterViscosity, branchFlow, pipeParallelGen,
} from './pipe.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const rel = (a: number, b: number, tol: number, msg = '') => near(a / b, 1, tol, msg);
const water20 = { rho: 998, mu: 1.002e-3 };

test('Colebrook reproduces Moody-chart values (Re 1e5, ε/D 0.001 → 0.0222; smooth 1e5 → 0.0180; 1e6, 1e-4 → 0.0134)', () => {
  near(colebrook(1e5, 0.001), 0.0222, 0.0002);
  near(colebrook(1e5, 0), 0.0180, 0.0002);
  near(colebrook(1e6, 1e-4), 0.0134, 0.0002);
});

test('Colebrook fully rough limit: f = (−2 log₁₀(ε/3.7D))⁻² at Re → ∞ (ε/D 0.05 → 0.0716)', () => {
  const f = 1 / (2 * Math.log10(0.05 / 3.7)) ** 2;
  near(f, 0.0716, 0.0001);
  rel(colebrook(1e10, 0.05), f, 0.002);
});

test('Colebrook within 2 % of Haaland over the chart range', () => {
  for (const Re of [5e3, 3e4, 2e5, 2e6, 2e7]) for (const e of [0, 1e-5, 1e-4, 1e-3, 1e-2, 5e-2]) {
    const haaland = 1 / (-1.8 * Math.log10(Math.pow(e / 3.7, 1.11) + 6.9 / Re)) ** 2;
    rel(colebrook(Re, e), haaland, 0.02, `Re ${Re} e/D ${e}`);
  }
});

test('laminar: f = 64/Re and Hagen–Poiseuille Δp = 128 μ L Q/(π D⁴) (hand calc 25 465 Pa)', () => {
  near(frictionFactor(1000, 0.001), 0.064, 1e-12);
  const r = pipeSection({ rho: 900, mu: 0.1 }, 1e-4, { D: 0.02, L: 10, eps: 0, K: 0 });
  assert.equal(r.regime, 'laminar');
  near(r.Re, 57.3, 0.1);
  rel(r.dp, (128 * 0.1 * 10 * 1e-4) / (Math.PI * 0.02 ** 4), 1e-9);
  near(r.dp, 25465, 5);
});

test('regimes: laminar < 2300 ≤ transition < 4000 ≤ turbulent; friction factor is continuous across both limits', () => {
  assert.equal(regimeOf(2299), 'laminar'); assert.equal(regimeOf(3000), 'transition'); assert.equal(regimeOf(4000), 'turbulent');
  near(frictionFactor(2300 - 1e-6, 0.001), frictionFactor(2300 + 1e-6, 0.001), 1e-6);
  near(frictionFactor(4000 - 1e-6, 0.001), frictionFactor(4000 + 1e-6, 0.001), 1e-6);
});

test('hand calculation: water 20 °C, D 100 mm, L 100 m, Q 10 L/s, ε 0.046 mm → v 1.273 m/s, Re ≈ 126 800, Δp ≈ 15.9 kPa', () => {
  const r = pipeSection(water20, 0.01, { D: 0.1, L: 100, eps: 0.046e-3, K: 0 });
  near(r.v, 1.2732, 1e-4);
  rel(r.Re, 126815, 1e-3);
  near(r.f, 0.0196, 0.0003); // Swamee–Jain by hand: 0.01963
  rel(r.dp, 15880, 0.01); // by hand with the Swamee–Jain factor
  near(r.hF, r.dp / (998 * G), 1e-9);
});

test('minor losses: Δp = ΣK ρv²/2; ΣK from fitting counts', () => {
  near(sumK({ elbow90: 4, gate: 1, entrance: 1, exit: 1 }), 4 * 0.3 + 0.2 + 0.5 + 1.0, 1e-12);
  const r = pipeSection(water20, 0.01, { D: 0.1, L: 0, eps: 0, K: 2.9 });
  near(r.dpM, 2.9 * 0.5 * 998 * 1.2732 ** 2, 0.5);
  assert.equal(r.dpF, 0);
});

test('fluid properties: water 20 °C (998.2 kg/m³, 1.002 mPa·s), 100 °C; air 20 °C (1.204 kg/m³, 18.1 µPa·s, 343 m/s); VG46 at 40 °C has ν = 46 mm²/s', () => {
  near(waterDensity(20), 998.2, 0.1); near(waterDensity(4), 1000, 0.05); near(waterDensity(100), 958.4, 0.5);
  rel(waterViscosity(20), 1.002e-3, 0.005); rel(waterViscosity(100), 0.282e-3, 0.015);
  const a = fluidProps({ kind: 'air', T: 20 });
  near(a.rho, 1.204, 0.002); rel(a.mu, 1.81e-5, 0.01); near(a.c!, 343.2, 0.3);
  const o = fluidProps({ kind: 'oil', T: 40, oil: 'VG46' });
  near(o.mu / o.rho, 46e-6, 0.1e-6);
});

test('sudden change: expansion 100 → 200 mm K = (1 − ¼)² = 0.5625 on v₁; contraction 200 → 100 mm K = 0.5(1 − ¼) = 0.375 on v₂', () => {
  const e = suddenChange(0.1, 0.2), c = suddenChange(0.2, 0.1);
  near(e.K, 0.5625, 1e-12); assert.equal(e.at, 'up');
  near(c.K, 0.375, 1e-12); assert.equal(c.at, 'down');
  near(suddenChange(0.1, 0.1).K, 0, 1e-12);
});

const base = { fluid: { ...fluidProps({ kind: 'water', T: 20 }) }, dpMax: 1e9 };
const sec = { D: 0.1, L: 50, eps: 0.045e-3, K: 0 };

test('series: two equal sections = one section of double length; no joint loss for equal diameters', () => {
  const two = pipeSeries({ ...base, Q: 0.01, sections: [sec, sec], dz: 0 });
  const one = pipeSeries({ ...base, Q: 0.01, sections: [{ ...sec, L: 100 }], dz: 0 });
  assert.equal(two.joints[0].dp, 0);
  rel(two.dpTotal, one.dpTotal, 1e-9);
});

test('series: elevation adds ρ g Δz; pump head = losses + Δz; hydraulic power = Q Δp', () => {
  const r = pipeSeries({ ...base, Q: 0.01, sections: [sec], dz: 12 });
  near(r.dpZ, base.fluid.rho * G * 12, 1e-6);
  near(r.head, r.hLoss + 12, 1e-9);
  near(r.hydraulicPower, 0.01 * r.dpTotal, 1e-9);
  const down = pipeSeries({ ...base, Q: 0.01, sections: [sec], dz: -1000 });
  assert.ok(down.dpTotal < 0 && down.hydraulicPower === 0); // gravity drives the flow
});

test('series: a diameter change adds the sudden-change loss on the right velocity', () => {
  const big = { ...sec, D: 0.2 };
  const r = pipeSeries({ ...base, Q: 0.01, sections: [sec, big], dz: 0 });
  near(r.joints[0].K, 0.5625, 1e-12);
  rel(r.joints[0].dp, 0.5625 * r.secs[0].q, 1e-12);
  const c = pipeSeries({ ...base, Q: 0.01, sections: [big, sec], dz: 0 });
  rel(c.joints[0].dp, 0.375 * c.secs[1].q, 1e-12);
});

test('energy line: starts at the total loss head (pressure + elevation), ends at 0 at the outlet, never rises', () => {
  const inp = { ...base, Q: 0.01, sections: [{ ...sec, K: 1.5 }, { ...sec, D: 0.15, K: 0.6 }], dz: 7 };
  const r = pipeSeries(inp);
  const pts = energyLine(inp, r);
  near(pts[0].H, r.hLoss, 1e-9);
  near(pts[pts.length - 1].H, 0, 1e-9);
  near(pts[pts.length - 1].z, 0, 1e-12); near(pts[0].z, -7, 1e-12);
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i].H <= pts[i - 1].H + 1e-12);
});

test('parallel: identical branches split equally and Δp equals one branch at Q/2', () => {
  const r = pipeParallel({ ...base, Q: 0.02, branches: [sec, sec] });
  near(r.shares[0], 0.5, 1e-6);
  const one = pipeSection(base.fluid, 0.01, sec);
  rel(r.dp, one.dp, 1e-6);
});

test('parallel, laminar: Q ∝ D⁴ (Hagen–Poiseuille), so D = 2×D₁ takes 16× the flow of a branch with the same length', () => {
  const oil = { kind: 'custom' as const, name: 'custom', rho: 900, mu: 0.2, c: null, gas: false };
  const b1 = { D: 0.01, L: 5, eps: 0, K: 0 }, b2 = { D: 0.02, L: 5, eps: 0, K: 0 };
  const r = pipeParallel({ fluid: oil, Q: 1e-4, branches: [b1, b2], dpMax: 1e9 });
  assert.ok(r.secs.every((s) => s.regime === 'laminar'));
  rel(r.flows[1] / r.flows[0], 16, 1e-3);
  near(r.flows[0] + r.flows[1], 1e-4, 1e-12);
});

test('parallel: a branch with a closed-ish valve (large K) takes less flow; branchFlow inverts pipeSection', () => {
  const open = sec, throttled = { ...sec, K: 50 };
  const r = pipeParallel({ ...base, Q: 0.02, branches: [open, throttled] });
  assert.ok(r.flows[0] > r.flows[1]);
  const q = branchFlow(base.fluid, throttled, r.dp);
  rel(pipeSection(base.fluid, q, throttled).dp, r.dp, 1e-9);
});

test('checks: velocity range, transition zone, pressure limit, and for air the Mach / 10 % rules', () => {
  const fast = pipeSeries({ ...base, Q: 0.1, sections: [{ ...sec, D: 0.05 }], dz: 0, dpMax: 1e9 });
  assert.ok(fast.checks.some((c) => !c.ok && /velocity/.test(c.label))); // 51 m/s water
  const ok = pipeSeries({ ...base, Q: 0.01, sections: [sec], dz: 0, dpMax: 1e9 });
  assert.ok(ok.checks.every((c) => c.ok));
  const tight = pipeSeries({ ...base, Q: 0.01, sections: [sec], dz: 0, dpMax: 100 });
  assert.ok(tight.checks.some((c) => !c.ok && /Pressure drop/.test(c.label)));
  const air = fluidProps({ kind: 'air', T: 20, pAbs: 101325 });
  const jet = pipeSeries({ fluid: air, Q: 1.0, sections: [{ D: 0.1, L: 5, eps: 0.045e-3, K: 0 }], dz: 0, dpMax: 1e9, pAbs: 101325 });
  assert.ok(jet.checks.some((c) => !c.ok && /Mach/.test(c.label))); // 127 m/s
});

test('pipeParallelGen yields during the bisection and ends with the pipeParallel result', () => {
  const fl = fluidProps({ kind: 'water', T: 20 });
  const sec = { D: 0.1, L: 100, eps: 4.5e-5, K: 2 };
  const inp = { fluid: fl, Q: 0.02, branches: [sec, { ...sec, D: 0.08 }, { ...sec, D: 0.05, K: 10 }], dpMax: 1e6 };
  const g = pipeParallelGen(inp);
  let n = 0, r = g.next();
  while (!r.done) { n++; r = g.next(); }
  assert.ok(n >= 60, `${n} yields`);
  assert.deepEqual(r.value, pipeParallel(inp));
});
