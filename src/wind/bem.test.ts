import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BETZ } from './turbine.ts';
import { cpAt, gamma, operate, optimum, REF, rotor, rotorCoeffs, weibullC, weibullPdf, type RotorIn } from './bem.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const ref: RotorIn = { D: 126, P: 5e6, H: 90, vMean: 8.5, k: 2, loss: 0.12, vOp: 10 };

test('VALIDATION (Jonkman et al. 2009, NREL/TP-500-38060): NREL 5-MW peak C_P and pitch schedule', () => {
  // § 7: peak power coefficient 0.482 at a tip-speed ratio of 7.55 and blade pitch 0°
  near(rotorCoeffs(7.55, 0).cp, 0.482, 0.008, 'C_P at λ = 7.55');
  near(optimum(0).cp, 0.482, 0.008, 'peak C_P');
  // Table 7-1: rated wind speed 11.4 m/s at 12.1 rpm; blade pitch above rated
  const r = rotor(ref);
  near(r.vRated, 11.4, 0.2, 'rated wind speed'); near(r.rated.rpm, 12.1, 1e-9, 'rated rotor speed');
  for (const [V, beta] of [[13, 6.60], [16, 12.06], [20, 17.47], [25, 23.47]]) near(operate(ref, V, r.opt.lam).beta, beta, 0.5, `pitch at ${V} m/s`);
});

test('physics: below Betz, geometric similarity, power ∝ D² and pitch limits power', () => {
  for (const l of [4, 6, 8, 10, 12]) assert.ok(cpAt(l, 0) < BETZ, `C_P(${l}) < 16/27`);
  const small = { ...ref, D: 80, P: 5e6 * (80 / 126) ** 2 };
  const a = operate(ref, 7, optimum(0).lam), b = operate(small, 7, optimum(0).lam);
  near(b.Pm / a.Pm, (80 / 126) ** 2, 1e-9, 'power ∝ D² below rated'); near(b.cp, a.cp, 1e-12, 'same C_P');
  const r = rotor(ref);
  for (const o of r.curve) if (o.V > r.vRated + 0.3 && o.V <= 25) near(o.P, 5e6, 5e3, `rated power held at ${o.V} m/s`);
  assert.equal(operate(ref, 2, 7.6).P, 0); assert.equal(operate(ref, 26, 7.6).P, 0);
  assert.ok(r.peakT.T > 6e5 && r.peakT.T < 9e5, `peak thrust ${r.peakT.T}`);
});

test('Weibull and annual energy (hand calculation)', () => {
  near(gamma(1.5), Math.sqrt(Math.PI) / 2, 1e-12); near(gamma(5), 24, 1e-9); near(gamma(0.5), Math.sqrt(Math.PI), 1e-12);
  const c = weibullC(7, 2); near(c, 7 / gamma(1.5), 1e-12);
  let s = 0, m = 0; for (let v = 0.005; v < 60; v += 0.01) { const f = weibullPdf(v, 2, c) * 0.01; s += f; m += v * f; }
  near(s, 1, 1e-4, 'pdf integrates to 1'); near(m, 7, 1e-3, 'mean');
  const r = rotor(ref);
  near(r.aep, r.aepGross * 0.88, 1e-6, 'losses'); near(r.cf, r.aep / (5 * 8760), 1e-12);
  assert.ok(r.cf > 0.3 && r.cf < 0.5, `capacity factor ${r.cf}`);
  assert.ok(r.checks.every((x) => x.ok), r.checks.filter((x) => !x.ok).map((x) => x.label).join('; '));
  near(r.mBlade, 0.4948 * 63 ** 2.53, 1e-6); near(r.mRotor, REF.mRotor, 1e-6);
});
