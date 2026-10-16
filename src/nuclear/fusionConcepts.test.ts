import { test } from 'node:test';
import assert from 'node:assert/strict';
import { burnParam, E_PER_G, eFermi, eHot, icf, ICF_PRESETS, stellarator, STELLARATORS, tauISS04 } from './fusionConcepts.ts';

const near = (a: number, b: number, rel: number, msg = '') => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg} ${a} vs ${b}`);

test('ISS04 scaling: hand calculation for W7-X-like numbers', () => {
  // 0.134 · 0.53^2.28 · 5.5^0.64 · 8^−0.61 · 8^0.54 · 2.5^0.84 · 1^0.41 = 0.1752 s
  near(tauISS04(0.53, 5.5, 8, 8, 2.5, 1), 0.1752, 0.002);
});

test('Stellarator steady state: stored energy = τ_E × net heating', () => {
  for (const s of Object.values(STELLARATORS)) {
    const r = stellarator(s);
    if (!r.ignited) near(r.W, r.tau * r.P, 1e-6, 'balance');
  }
});

test('Laser fusion constants: 337 GJ per gram burned, degenerate D–T ≈ 3.3·10⁵ ρ^⅔ J/g, H_B ≈ 7 g/cm²', () => {
  near(E_PER_G, 3.37e11, 0.01, 'energy per gram');
  near(eFermi(1), 3.3e5, 0.03, 'Fermi energy');
  near(eFermi(1000) / eFermi(1), 100, 1e-9, 'ρ^⅔');
  near(burnParam(40), 7, 0.1, 'H_B');
  near(eHot(10), 1.15e9, 0.01, 'hot plasma');
});

test('Capsule energy budget and isobaric stagnation', () => {
  for (const p of Object.values(ICF_PRESETS)) {
    const r = icf(p), mg = p.m * 1e-3;
    near(r.mh * r.eh + (mg - r.mh) * r.ec, r.Ek, 1e-9, 'energy');
    near(r.rhoH * r.eh, p.rhoC * r.ec, 1e-9, 'pressure');
    if (r.ignites) near(r.Y, (r.rRt / (r.rRt + r.HBburn)) * mg * E_PER_G, 1e-9, 'yield');
  }
  assert.ok(icf(ICF_PRESETS.nif).ignites && icf({ ...ICF_PRESETS.nif, EL: 1 }).G < 1);
});
