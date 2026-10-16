import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toUSText, unitOfText } from './auto.ts';

test('SI quantities in text become US units: lengths, forces, stresses, pressure, temperature, flow', () => {
  assert.equal(toUSText('d = 25.4 mm'), 'd = 1.000 in');
  assert.equal(toUSText('F = 10 kN, σ = 235 MPa'), 'F = 2.248 kip, σ = 34.08 ksi');
  assert.equal(toUSText('1.013 bar abs'), '14.69 psi abs');
  assert.equal(toUSText('100 °C'), '212.0 °F');
  assert.equal(toUSText('Q = 100 m³/h'), 'Q = 440.3 gpm');
  assert.equal(toUSText('M = 50 N·m'), 'M = 36.88 lbf·ft');
  assert.equal(toUSText('k = 10 N/mm'), 'k = 57.10 lbf/in');
  assert.equal(toUSText('P = 7.5 kW'), 'P = 7.5 kW'); // power stays in kW
  assert.equal(toUSText('p = 10 MPa'), 'p = 1450 psi'); // pressure
  assert.equal(toUSText('a = 4 ≥ 3 mm'), 'a = 0.1575 ≥ 0.1181 in');
  assert.equal(toUSText('82 ≤ 360 MPa'), '11.89 ≤ 52.21 ksi');
  assert.equal(toUSText('−3.0 mm'), '−0.1181 in');
  assert.equal(toUSText('w = 8.0 kN/m'), 'w = 0.5482 kip/ft');
  assert.equal(toUSText('m₀ = 410 t'), 'm₀ = 903895 lb');
  assert.equal(toUSText('3 t_b'), '3 t_b');
  assert.equal(toUSText('pv = 1.0 MPa·m/s'), 'pv = 28551 psi·ft/min');
  assert.equal(toUSText('ν = 46 mm²/s'), 'ν = 46.00 cSt');
  assert.equal(toUSText('v = 254 mm/s'), 'v = 10.00 in/s');
});

test('leaves electrical units, time, rpm, letters that merely start like a unit, and numbers without units', () => {
  for (const s of ['12 V', '3.0 mA', '10 ms', '5 min', '1500 rpm', 'M12 bolt', '45°', 'R1 180 Ω', '8 × 8', 'n = 3', '20 K', 'PM 62.5°']) assert.equal(toUSText(s), s);
  assert.equal(toUSText('a 10 mm wire and 5 min'), 'a 0.3937 in wire and 5 min');
});

test('the slider display parser finds the unit of a value text', () => {
  const u = unitOfText('120.0 mm')!;
  assert.equal(u.rule.us, 'in'); assert.equal(u.num, 120);
  assert.equal(unitOfText('1.20 kΩ'), null);
});

test('keepSIText stays metric', async () => {
  const { keepSIText } = await import('./auto.ts');
  assert.equal(toUSText(`m = ${keepSIText(3, 'mm')}`), `m = ${keepSIText(3, 'mm')}`);
});

test('gear module in US units also shows the diametral pitch (DP = 25.4/m)', async () => {
  const { moduleText, keepSIText } = await import('./auto.ts');
  assert.equal(moduleText(3, 'SI'), keepSIText(3, 'mm'));
  assert.equal(moduleText(2.54, 'US'), `${keepSIText(2.54, 'mm')} · DP 10`);
  assert.equal(toUSText(moduleText(3, 'US')), moduleText(3, 'US')); // the module stays metric
});
