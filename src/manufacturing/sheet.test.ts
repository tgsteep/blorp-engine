import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bend, bendGeometry, kDin6935, SHEET_MATERIALS, springback } from './sheet.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const s235 = SHEET_MATERIALS.find((m) => m.id === 's235')!;

test('DIN 6935 correction factor: R/t = 1 → k 0.65 (K 0.325); R/t = 5 and above → k 1 (K 0.5)', () => {
  near(kDin6935(2, 2), 0.325, 1e-12);
  near(kDin6935(10, 2), 0.5, 1e-12);
  near(kDin6935(4, 2), (0.65 + 0.5 * Math.log10(2)) / 2, 1e-12);
});

test('bend geometry, hand calculation: t 2, R 2, 90°, K 0.325 → BA 4.163, OSSB 4, BD 3.837', () => {
  const g = bendGeometry(2, 2, 0.325, 90);
  near(g.BA, (Math.PI / 2) * 2.65, 1e-12); near(g.BA, 4.1626, 1e-4);
  near(g.OSSB, 4, 1e-12);
  near(g.BD, 8 - 4.16261, 1e-4);
  // DIN 6935 compensation value for 90°: v = π/2 (r + k s/2) − 2 (r + s) = −BD
  near(Math.PI / 2 * (2 + 0.65 * 2 / 2) - 2 * (2 + 2), -g.BD, 1e-12);
});

test('springback, hand calculation (Kalpakjian): R 4, t 2, R_e 235, E 210 GPa', () => {
  const x = (4 * 235) / (210000 * 2);
  const s = springback(4, 2, 235, 210000);
  near(s.x, x, 1e-15);
  near(s.Rf, 4 / (4 * x ** 3 - 3 * x + 1), 1e-12);
  near(s.Ks, (4 + 1) / (s.Rf + 1), 1e-12);
  assert.ok(s.Ks < 1 && s.Ks > 0.98, 'a few tenths of a degree per 10° for mild steel at R/t 2');
  assert.equal(springback(500, 1, 500, 70000).plastic, false, 'R R_e/(E t) ≥ 0.5: elastic only');
});

test('bend: flat length a + b − BD, press force 1.33 R_m L t²/V', () => {
  const r = bend({ mat: s235, t: 2, R: 2.5, theta: 90, a: 40, b: 30, V: 16, Lb: 1000, kMode: 'din', K: 0.33, Fmax: 1000 });
  const g = bendGeometry(2.5, 2, kDin6935(2.5, 2), 90);
  near(r.flat, 70 - g.BD, 1e-12);
  near(r.F, (1.33 * 400 * 1000 * 4) / 16 / 1000, 1e-12); // 133 kN
  near(r.rAir, 0.156 * 16, 1e-12);
  assert.ok(r.checks.every((c) => c.ok), JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.equal(bend({ mat: s235, t: 2, R: 1, theta: 90, a: 40, b: 30, V: 16, Lb: 1000, kMode: 'din', K: 0.33, Fmax: 1000 }).checks[0].ok, false, 'R 1 < t');
});

test('a press that is too small stops the bend part way; below 75 % of the force it only flexes', () => {
  const base = { mat: s235, t: 2, R: 2.5, theta: 90, a: 40, b: 30, V: 16, Lb: 1000, kMode: 'din' as const, K: 0.33 };
  const full = bend({ ...base, Fmax: 1000 }), F = full.F; // 133 kN
  assert.equal(full.reach, 1);
  const half = bend({ ...base, Fmax: 0.875 * F }); // half way between 75 % and 100 %
  near(half.reach, 0.5, 1e-9); near(half.thetaStall, 0.5 * full.thetaI, 1e-9); near(half.thetaReached, half.thetaStall * full.Ks, 1e-9);
  assert.ok(half.thetaReached < 90 && half.thetaReached > 30);
  assert.equal(bend({ ...base, Fmax: 0.7 * F }).thetaReached, 0);
  // 20 mm plate in a 160 mm die: 1.33·400·1000·400/160 = 1330 kN per metre
  near(bend({ ...base, t: 20, R: 25, V: 160, Fmax: 3000 }).F, 1330, 1e-9);
});
