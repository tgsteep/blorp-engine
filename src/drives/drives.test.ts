import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beltDrive, BELTS, chainDrive, chainLinks, CHAINS, eulerTension, MU_V, openDrive, sprocketD } from './drives.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);

test('open drive d₁ 100, d₂ 300, a 500: wrap β₁ = π − 2·asin(0.2) = 156.9°, exact length 1648.4 mm (≈ 2a + π(d₁+d₂)/2 + (d₂−d₁)²/4a = 1648.3)', () => {
  const g = openDrive(100, 300, 500);
  near((g.beta1 * 180) / Math.PI, 156.93, 0.01);
  near(g.L, 1648.4, 0.1);
  near(g.L, 1000 + Math.PI * 200 + 40000 / 2000, 0.2);
  near(openDrive(200, 200, 400).L, 800 + Math.PI * 200, 1e-9);
});

test('Euler–Eytelwein: (F₁ − F_c)/(F₂ − F_c) = e^{μ′β}, F₁ − F₂ = F_t per belt set', () => {
  const r = beltDrive({ P: 5.5, n1: 1450, d1: 125, i: 2.5, a: 450, belt: BELTS[1], cS: 1.25 });
  near((r.F1 - r.Fc) / (r.F2 - r.Fc), Math.exp(MU_V * r.beta1), 1e-9);
  near((r.F1 - r.F2) * r.z, r.Ft, 1e-6);
  near(r.v, (Math.PI * 125 * 1450) / 60000, 1e-12);
  near(eulerTension(r.F2, r.Fc, r.beta1), r.F1, 1e-9);
  assert.ok(r.z >= 1 && r.F1 <= BELTS[1].Fallow + 1e-9);
});

test('shaft load: with 180° wrap the strands are parallel → F_w = z·(F₁ + F₂ − 2F_c)', () => {
  const r = beltDrive({ P: 3, n1: 1000, d1: 150, i: 1, a: 500, belt: BELTS[1], cS: 1 });
  near(r.Fw, r.z * (r.F1 + r.F2 - 2 * r.Fc), 1e-6);
});

test('sprocket pitch diameter p/sin(180°/z): 16B, z = 19 → 154.32 mm (catalogue value); polygon speed ripple 1 − cos(180°/19) = 1.36 %', () => {
  near(sprocketD(25.4, 19), 25.4 / Math.sin(Math.PI / 19), 1e-12);
  near(sprocketD(25.4, 19), 154.32, 0.01);
  const r = chainDrive({ P: 5.5, n1: 300, z1: 19, z2: 38, a: 600, chain: CHAINS[3], cS: 1 });
  near(r.poly, 0.0136, 0.0002);
});

test('chain links: 16B, z 19/38, a ≈ 600 → X = 2·600/25.4 + 28.5 + (19/2π)²·25.4/600 = 76.13 → 78 links; exact centre distance from 78 links satisfies the link formula', () => {
  const { Xr, X, aX } = chainLinks(25.4, 19, 38, 600);
  near(Xr, 1200 / 25.4 + 28.5 + (19 / (2 * Math.PI)) ** 2 * 25.4 / 600, 1e-9);
  assert.equal(X, 78);
  near((2 * aX) / 25.4 + 28.5 + ((19 / (2 * Math.PI)) ** 2 * 25.4) / aX, 78, 1e-9);
});

test('chain: F = P·c_S/v + m′v², static safety F_B/F, joint pressure F/A', () => {
  const r = chainDrive({ P: 5.5, n1: 300, z1: 19, z2: 38, a: 600, chain: CHAINS[3], cS: 1.25 });
  const v = (19 * 25.4 * 300) / 60000;
  near(r.F, (5.5 * 1.25 * 1000) / v + 2.7 * v * v, 1e-9);
  near(r.S, 60000 / r.F, 1e-12);
  near(r.pJ, r.F / 210, 1e-12);
});
