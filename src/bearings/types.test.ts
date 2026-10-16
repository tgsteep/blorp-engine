import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, magneticPressure } from './types.ts';

test('magnetic pressure B²/(2μ₀): 1 T → 0.398 MPa (hand calculation)', () => {
  assert.ok(Math.abs(magneticPressure(1) - 0.3979) < 1e-4);
  assert.ok(Math.abs(magneticPressure(1.2) - 0.573) < 1e-3);
});

test('bearing kinds: unique ids, friction ranges ordered', () => {
  assert.equal(new Set(KINDS.map((k) => k.id)).size, KINDS.length);
  for (const k of KINDS) assert.ok(k.mu[0] > 0 && k.mu[0] <= k.mu[1], k.id);
});
