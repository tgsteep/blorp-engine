import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversion, cstrC, kAt, pfrC, reactor, tauFor, type ReactIn } from './reactor.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);

test('closed forms (Fogler): first and second order in CSTR, PFR and tanks in series; zero order', () => {
  const k = 0.5, C0 = 2;
  for (const tau of [0.5, 2, 8]) {
    near(conversion('cstr', C0, k, 1, tau), (k * tau) / (1 + k * tau), 1e-9, 'CSTR 1st: kτ/(1 + kτ)');
    near(conversion('pfr', C0, k, 1, tau), 1 - Math.exp(-k * tau), 1e-12, 'PFR 1st: 1 − e^(−kτ)');
    near(conversion('series', C0, k, 1, tau, 3), 1 - 1 / (1 + (k * tau) / 3) ** 3, 1e-9, 'N tanks: 1 − 1/(1 + kτ/N)^N');
    const Da = k * tau * C0;
    near(conversion('pfr', C0, k, 2, tau), Da / (1 + Da), 1e-12, 'PFR 2nd: Da/(1 + Da)');
    near(conversion('cstr', C0, k, 2, tau), (1 + 2 * Da - Math.sqrt(1 + 4 * Da)) / (2 * Da), 1e-9, 'CSTR 2nd: (1 + 2Da − √(1 + 4Da))/(2Da)');
    near(pfrC(C0, 0.3, 0, tau), Math.max(C0 - 0.3 * tau, 0), 1e-12, 'zero order');
  }
  // many tanks in series approach the plug-flow reactor
  near(conversion('series', C0, k, 1, 2, 200), conversion('pfr', C0, k, 1, 2), 2e-3);
  // CSTR mole balance holds
  const c = cstrC(C0, k, 1.5, 3); near(C0 - c, 3 * k * c ** 1.5, 1e-9);
});

test('Arrhenius, volume for a target, heat and the tool result', () => {
  near(kAt(1, 50, 25), 1, 1e-12); near(kAt(1, 50, 35) / kAt(1, 50, 25), Math.exp((50 / 8.314462618e-3) * (1 / 298.15 - 1 / 308.15)), 1e-9, 'k doubles roughly every 10 K for E_a ≈ 50 kJ/mol');
  near(tauFor('cstr', 1, 0.5, 1, 0.8), 0.8 / (0.5 * 0.2), 1e-6, 'CSTR τ = X/(k(1 − X))'); near(tauFor('pfr', 1, 0.5, 1, 0.8), -Math.log(0.2) / 0.5, 1e-6, 'PFR τ = −ln(1 − X)/k');
  const p: ReactIn = { kind: 'cstr', n: 1, k25: 0.5, Ea: 0, T: 25, C0: 2, v0: 1, V: 8, t: 1, N: 3, Xt: 0.8, dH: -50, rhoCp: 4180 };
  const r = reactor(p);
  near(r.X, 0.8, 1e-9); near(r.Vt, 8, 1e-5, 'volume for the target'); near(r.prod, 2 * 0.8, 1e-9);
  near(r.Q, (50e3 * 1.6) / 3600, 1e-9, 'heat released kW'); near(r.dTad, (50e3 * 2 * 0.8) / 4180, 1e-9, 'ΔT_ad');
  assert.ok(reactor({ ...p, kind: 'pfr' }).Vt < r.Vt, 'plug flow needs less volume');
  assert.ok(r.checks[0].ok && r.checks[1].ok);
});
