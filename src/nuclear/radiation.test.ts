import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildup, chain, CI, decay, doseRate, gammaConstant, muCoh, muEn, muLin, nuclide, shield } from './radiation.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const rel = (a: number, b: number, r: number, msg = '') => assert.ok(Math.abs(a / b - 1) <= r, `${msg} expected ${b} ± ${(r * 100).toFixed(0)} %, got ${a}`);

test('VALIDATION (specific activity, Ra-226 0.988 Ci/g — origin of the curie; Co-60 about 1130 Ci/g, Cember)', () => {
  rel(decay('Ra-226', 1, 0).SA / CI, 0.988, 0.003, 'Ra-226');
  rel(decay('Co-60', 1, 0).SA / CI, 1130, 0.005, 'Co-60');
});

test('decay law, hand calculation: I-131 halves in 8.0252 d, an eighth after three half-lives; N₀ = A₀/λ', () => {
  const T = nuclide('I-131').T;
  near(decay('I-131', 1e9, T).f, 0.5, 1e-12);
  near(decay('I-131', 1e9, 3 * T).f, 0.125, 1e-12);
  const r = decay('I-131', 1e9, 0);
  near(r.N0, 1e9 * T / Math.LN2, 1);
  // 1 GBq of I-131 weighs N₀·M/N_A = 1e9·693 377/0.693147·130.906/6.022e23 ≈ 0.217 µg
  rel(r.m0, 2.175e-7, 0.005);
  assert.equal(decay('I-131', 1e9, 10 * T).checks[1].ok, true);
});

test('Mo-99 → Tc-99m (Bateman): daughter peaks after about 23 h; transient equilibrium ratio 0.876·T_p/(T_p − T_d) = 0.964', () => {
  const c = chain('mo', 1, 0);
  rel(c.tMax / 3600, 22.9, 0.01);
  near(c.ratioEq, 0.876 / (1 - 6.0067 / 65.976), 1e-9);
  near(chain('mo', 1, 0).Ad, 0, 1e-12);
  // long after: A_d/A_p → ratio
  const late = chain('mo', 1, 200 * 3600); rel(late.Ad / late.Ap, c.ratioEq, 0.001);
  // secular: Sr-90/Y-90 reaches A_d = A_p
  const sr = chain('sr', 1, 40 * 86400); rel(sr.Ad / sr.Ap, 1, 0.001);
});

test('photon data: water and lead attenuation and water energy absorption match NIST within 2 %', () => {
  rel(muLin('water', 1000) + muCoh('water', 1000), 0.07072, 0.01, 'water μ 1 MeV');
  rel(muEn('water', 1000), 0.03103, 0.01, 'water μen 1 MeV');
  rel(muEn('water', 661.7), 0.0326, 0.01, 'water μen 662 keV');
  rel(muLin('lead', 1000) / 11.35 + muCoh('lead', 1000), 0.07102, 0.02, 'lead μ/ρ 1 MeV');
  rel(muLin('steel', 1250) / 7.874 + muCoh('steel', 1250), 0.05350, 0.01, 'iron μ/ρ 1.25 MeV');
});

test('VALIDATION (exposure-rate constants, Chilton, Shultis & Faw Table 6.2): Co-60 1.30, Cs-137 0.32 R·m²/(Ci·h)', () => {
  rel(gammaConstant('Co-60'), 1.3, 0.03, 'Co-60');
  rel(gammaConstant('Cs-137'), 0.32, 0.05, 'Cs-137');
});

test('buildup: our Monte Carlo reproduces the classic 1 MeV point-isotropic values (Goldstein & Wilkins) within 8 % up to 7 mfp', () => {
  const ref: Record<string, [number, number][]> = {
    water: [[1, 2.13], [2, 3.71], [4, 7.68], [7, 16.2]],
    steel: [[1, 1.87], [2, 2.89], [4, 5.39], [7, 10.2]],
    lead: [[1, 1.37], [2, 1.69], [4, 2.26], [7, 3.02]],
  };
  for (const [m, pts] of Object.entries(ref)) for (const [x, B] of pts) rel(buildup(m as 'water', 1000, x, 'infinite'), B, 0.08, `${m} ${x} mfp`);
  // a wall (nothing behind it) scatters less back than the infinite medium
  assert.ok(buildup('concrete', 1250, 5) < buildup('concrete', 1250, 5, 'infinite'));
  near(buildup('lead', 662, 0), 1, 1e-12);
});

test('VALIDATION (equilibrium broad-beam tenth-value layers, NCRP 49 as in Chilton, Shultis & Faw Table 7.1) within 20 %', () => {
  const tvl = (nuc: string, mat: 'lead' | 'steel' | 'concrete') => shield({ nuc, A: 1e10, r: 3, mat, x: 0, hours: 2000, limit: 0.02 }).tvlEq * 1000;
  rel(tvl('Co-60', 'lead'), 40, 0.2, 'Co-60 lead');
  rel(tvl('Co-60', 'concrete'), 206, 0.2, 'Co-60 concrete');
  rel(tvl('Co-60', 'steel'), 69, 0.2, 'Co-60 iron');
  rel(tvl('Cs-137', 'lead'), 21.6, 0.2, 'Cs-137 lead');
  rel(tvl('Cs-137', 'concrete'), 157, 0.2, 'Cs-137 concrete');
  rel(tvl('Cs-137', 'steel'), 53, 0.2, 'Cs-137 iron');
});

test('inverse square law and shielding consistency', () => {
  const a = doseRate('Cs-137', 1e10, 1, 'lead', 0).total, b = doseRate('Cs-137', 1e10, 2, 'lead', 0).total;
  near(a / b, 4, 1e-9);
  // 1 Ci Cs-137 at 1 m ≈ 85 µGy/h in tissue without shield (air kerma 0.32 R/h ≈ 2.8 mGy/h per Ci → tissue ≈ 1.1 × air)
  const s = shield({ nuc: 'Cs-137', A: CI, r: 1, mat: 'lead', x: 0.05, hours: 2000, limit: 0.02 });
  assert.ok(s.D < s.D0 && s.narrow < s.D);
  const need = shield({ nuc: 'Cs-137', A: CI, r: 1, mat: 'lead', x: 0, hours: 2000, limit: 0.02 }).xNeed;
  rel(doseRate('Cs-137', CI, 1, 'lead', need).total * 2000, 0.02, 1e-3, 'thickness for the limit');
});
