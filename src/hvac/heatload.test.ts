import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heatLoad, IRRAD, PERSON, SOLAIR, THERMAL_BRIDGE, type LoadIn } from './heatload.ts';
import { humidityRatio, pwsMoist } from './psychro.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const base: LoadIn = {
  L: 5, B: 4, H: 2.7, ext: ['S', 'W'], winOr: 'S', Awin: 3, Uwall: 0.35, Uwin: 1.4, Uroof: 0.25, Ufloor: 0.4, roof: false, ground: false,
  tiW: 20, teW: -5, tiS: 26, teS: 34, phiS: 0.4, phiIn: 0.5, ach: 0.5, people: 2, lights: 8, equip: 200, shgc: 0.6, shade: 1, altitude: 0,
};

test('heating, hand calculation: two exterior walls, one window, 0.5 air changes', () => {
  const r = heatLoad(base);
  const U = 0.35 + THERMAL_BRIDGE, south = (5 * 2.7 - 3) * 25 * U, west = 4 * 2.7 * 25 * U, win = 1.4 * 3 * 25, vent = 0.34 * 0.5 * 54 * 25;
  near(r.PhiT, south + west + win, 1e-9); near(r.PhiV, vent, 1e-9); near(r.Phi, south + west + win + vent, 1e-9);
  near(vent, 229.5, 1e-9, '0.34 n V ΔT');
});

test('roof and ground floor add Uroof A ΔT and 0.5 Ufloor A ΔT', () => {
  const r0 = heatLoad(base), r = heatLoad({ ...base, roof: true, ground: true });
  near(r.Phi - r0.Phi, 0.25 * 20 * 25 + 0.5 * 0.4 * 20 * 25, 1e-9);
});

test('cooling, hand calculation: sol-air walls, window conduction and sun, people, lights, equipment, outdoor air', () => {
  const r = heatLoad(base);
  const U = 0.35 + THERMAL_BRIDGE;
  const walls = U * (5 * 2.7 - 3) * (8 + SOLAIR.S) + U * 4 * 2.7 * (8 + SOLAIR.W);
  const glass = 1.4 * 3 * 8 + 0.6 * 3 * IRRAD.S;
  const internal = 2 * PERSON.sensible + 8 * 20 + 200, ventS = 0.34 * 0.5 * 54 * 8;
  near(r.Qs, walls + glass + internal + ventS, 1e-9);
  const Wo = humidityRatio(0.4 * pwsMoist(34, 101.325), 101.325), Wi = humidityRatio(0.5 * pwsMoist(26, 101.325), 101.325);
  near(r.Wo, Wo, 1e-15); near(r.Wi, Wi, 1e-15);
  near(r.Ql, 2 * PERSON.latent + Math.max(r.ma * (Wo - Wi) * 2501e3, 0), 1e-9);
  near(r.unit, 1.1 * (r.Qs + r.Ql), 1e-9);
});

test('a window on an inner wall counts nothing and fails its check', () => {
  const r = heatLoad({ ...base, winOr: 'N' });
  assert.equal(r.heat.some((x) => x.key === 'win'), false);
  assert.equal(r.checks.find((c) => c.label === 'Window on an exterior wall')!.ok, false);
});
