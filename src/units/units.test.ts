import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtQ, fromSys, QUANT, toSys, type QId } from './units.ts';

const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `expected ${b} ± ${tol}, got ${a}`);

test('reference conversions (NIST SP 811 factors)', () => {
  near(toSys('bar', 1, 'US'), 14.5038, 1e-4);
  near(toSys('degC', 100, 'US'), 212, 1e-9);
  near(toSys('degC', -40, 'US'), -40, 1e-9);
  near(toSys('mm', 25.4, 'US'), 1, 1e-12);
  near(toSys('kW', 0.745699872, 'US'), 1, 1e-12);
  near(toSys('Nm', 1.3558179483314, 'US'), 1, 1e-12);
  near(toSys('Lmin', 3.785411784, 'US'), 1, 1e-12);
  near(toSys('mm2', 645.16, 'US'), 1, 1e-12);
  assert.equal(toSys('bar', 7, 'SI'), 7);
});

test('every quantity converts back to the same SI value', () => {
  for (const q of Object.keys(QUANT) as QId[]) for (const v of [-12.5, 0, 1, 987.6]) near(fromSys(q, toSys(q, v, 'US'), 'US'), v, 1e-9 * Math.max(1, Math.abs(v)));
});

test('formatting keeps the SI decimals and about 4 significant digits in US units', () => {
  assert.equal(fmtQ('bar', 10, 'SI', 1), '10.0 bar');
  assert.equal(fmtQ('bar', 10, 'US', 1), '145.0 psi');
  assert.equal(fmtQ('mm2', 1005, 'US'), '1.558 in²');
  assert.equal(fmtQ('degC', 20, 'US'), '68.00 °F');
});
