import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gearEta, loadSide, MOTORS, screwCritical, servo, torques, trapezoid, type ServoIn } from './servo.ts';
import { cornerW, NR, phaseCurrent, pullOut, STEPPERS, stepper, type StepIn } from './stepper.ts';

const near = (a: number, b: number, tol: number, w = '') => assert.ok(Math.abs(a - b) <= tol, `${w}: ${a} vs ${b}`);
export const SERVO_DEF: ServoIn = { kind: 'screw', m: 50, lead: 10, d: 20, L: 800, mu: 0.05, Fext: 0, vertical: false, s: 500, tm: 1, fa: 0.25, dwell: 0.5, i: 1, motor: 'auto', sf: 1.2 };
export const STEP_DEF: StepIn = { frame: 'n23', V: 36, cur: 1, micro: 16, JL: 600e-7, Tf: 0.1, rpm: 600, ta: 0.2, sf: 1.5 };

test('servo sizing by hand: trapezoid, ball-screw inertia and torque, RMS torque, critical speed', () => {
  const tr = trapezoid(500, 1, 0.25); near(tr.v, 500 / 0.75, 1e-9, 'v'); near(tr.a, tr.v / 0.25, 1e-9, 'a');
  const ld = loadSide(SERVO_DEF), r = 0.01 / (2 * Math.PI);
  near(ld.J, 50 * r * r + Math.PI * 7850 * 0.8 * 0.02 ** 4 / 32, 1e-12, 'J'); near(ld.T, 0.05 * 50 * 9.81 * r / 0.9, 1e-12, 'T friction');
  const m = MOTORS[2], t = torques(SERVO_DEF, m);
  near(t.nM, (500 / 0.75) / 10 * 60, 1e-6, 'motor rpm = v/lead'); // 4000 rpm
  near(t.Trms, Math.sqrt((t.Ta ** 2 * 0.25 + t.Tc ** 2 * 0.5 + t.Td ** 2 * 0.25) / 1.5), 1e-12, 'RMS');
  near(screwCritical(16, 1000), 60 * (Math.PI * 0.016 / 8) * Math.sqrt(2.1e11 / 7850), 1e-9, 'n_c');
  assert.equal(gearEta(1), 1); assert.equal(gearEta(5), 0.97); assert.equal(gearEta(30), 0.94);
  // 4000 rpm is above the rated speed and near whirling: a 20 mm lead halves the screw speed and a motor passes
  assert.equal(servo(SERVO_DEF).checks[2].ok, false);
  const g = servo({ ...SERVO_DEF, lead: 20 }); assert.ok(g.checks.every((c) => c.ok), JSON.stringify(g.checks.filter((c) => !c.ok)));
  assert.ok(MOTORS.indexOf(g.mot) <= MOTORS.indexOf(servo({ ...SERVO_DEF, lead: 20, m: 200 }).mot), 'heavier load, same or larger motor');
  const tb = servo({ ...SERVO_DEF, kind: 'rotary', m: 30, d: 400, s: 90, tm: 0.5, Fext: 1, i: 20 });
  near(tb.ld.J, 0.5 * 30 * 0.2 ** 2, 1e-12, 'disc'); near(tb.JL, tb.ld.J / 400, 1e-12, 'reflected J_L/i²');
});

test('stepper by hand: phase current with inductance and back-EMF, pull-out falls with speed, resonance', () => {
  // corner: (V − I R)/(N_r L I); at the corner the current is I/√2, far above it about I ω_c/ω
  near(cornerW(36, 2.8, 0.9, 2.5e-3), (36 - 2.52) / (NR * 2.5e-3 * 2.8), 1e-9, 'ω_c');
  near(phaseCurrent(2, 100, 100), 2 / Math.SQRT2, 1e-12, 'at the corner'); near(phaseCurrent(2, 100, 1e4), 2 * 100 / 1e4, 1e-4, 'high speed');
  const f = STEPPERS.n23; near(pullOut(f, 36, 1, 0), f.Th * 0.97, 1e-12, 'holding less detent');
  assert.ok(pullOut(f, 36, 1, 1500) < pullOut(f, 36, 1, 300), 'falls with speed'); assert.ok(pullOut(f, 72, 1, 1500) > pullOut(f, 36, 1, 1500), 'higher voltage helps');
  const r = stepper(STEP_DEF); near(r.fPulse, 600 / 60 * 200 * 16, 1e-9, 'pulse rate');
  near(r.f0, Math.sqrt(50 * f.Th / (f.J + 600e-7)) / (2 * Math.PI), 1e-9, 'f0');
  assert.ok(r.checks.every((c) => c.ok), JSON.stringify(r.checks.filter((c) => !c.ok)));
});
