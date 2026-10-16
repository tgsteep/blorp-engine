import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brinell, convert, hardness, hbFromD, rockwellDepth, scaleRange, TABLE, vickers } from './hardness.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);

test('table rows come back exactly from every column (ISO 18265 Table A.1)', () => {
  for (const r of TABLE) {
    for (const s of ['HV', 'HB', 'HRC', 'HRB', 'Rm'] as const) {
      if (!Number.isFinite(r[s])) continue;
      const c = convert(s, r[s]);
      near(c.HV, r.HV, 1e-9, `${s} ${r[s]} → HV`);
      if (Number.isFinite(r.HB)) near(c.HB, r.HB, 1e-9, `HB at ${r.HV}`);
      if (Number.isFinite(r.HRC)) near(c.HRC, r.HRC, 1e-9, `HRC at ${r.HV}`);
      if (Number.isFinite(r.Rm)) near(c.Rm, r.Rm, 1e-9, `Rm at ${r.HV}`);
    }
  }
  // the table is monotonic in every column
  for (const s of ['HV', 'HB', 'HRC', 'HRB', 'Rm'] as const) {
    const v = TABLE.map((r) => r[s]).filter(Number.isFinite);
    for (let i = 1; i < v.length; i++) assert.ok(v[i] > v[i - 1], `${s} increasing at ${v[i]}`);
  }
  assert.deepEqual(scaleRange('HRC'), [20.3, 68]);
});

test('interpolation is linear between rows; outside the table gives no value', () => {
  near(convert('HV', 395).HRC, (39.8 + 40.8) / 2, 1e-9);
  near(convert('HV', 202.5).Rm, 650, 1e-9);
  assert.ok(Number.isNaN(convert('HV', 200).HRC), 'no HRC below 240 HV');
  assert.ok(Number.isNaN(convert('HV', 80).HRB), 'no HRB at 80 HV');
  assert.ok(Number.isNaN(convert('HV', 700).Rm), 'no R_m above 650 HV');
  const c = convert('HRC', 45); near(convert('HV', c.HV).HRC, 45, 1e-9, 'round trip');
});

test('cross-check with ASTM E140 Table 1 (non-austenitic steels): HRC → HV and HB within 1.5 %', () => {
  // [HRC, HV, HB] from ASTM E140 Table 1
  for (const [hrc, hv, hb] of [[20, 238, 226], [30, 302, 286], [40, 392, 371], [50, 513, 481], [60, 697, NaN]]) {
    const c = convert('HRC', Math.max(hrc, 20.3));
    if (hrc >= 21) near(c.HV / hv, 1, 0.015, `HV at ${hrc} HRC`);
    if (Number.isFinite(hb) && hrc >= 21 && hrc <= 47) near(c.HB / hb, 1, 0.015, `HB at ${hrc} HRC`);
  }
});

test('indentation sizes from the test definitions (hand calculation)', () => {
  near(hbFromD(4, 10), 228.8, 0.1, 'HBW 10/3000 with d = 4.00 mm');
  const b = brinell(hbFromD(4, 10), 10); near(b.d, 4, 1e-9, 'd back'); near(b.F, 29420, 0.1, 'F = 3000 kgf');
  near(b.h, (10 - Math.sqrt(84)) / 2, 1e-9, 'depth');
  const v = vickers(200, 30 * 9.80665); near(v.d, Math.sqrt(0.1891 * 294.2 / 200), 1e-4, 'HV30 diagonal'); near(v.d / v.h, 7.0006, 1e-3, 'd/h');
  near(rockwellDepth('HRC', 60), 0.08, 1e-12); near(rockwellDepth('HRB', 80), 0.1, 1e-12);
});

test('checks: valid Brinell window, Rockwell scale and specimen thickness', () => {
  const ok = hardness({ scale: 'HV', value: 200, D: 10, hvLoad: 30, t: 10 });
  assert.ok(ok.checks.every((c) => c.ok), ok.checks.filter((c) => !c.ok).map((c) => c.label).join('; '));
  assert.equal(ok.rock, 'HRB');
  const hard = hardness({ scale: 'HRC', value: 60, D: 10, hvLoad: 30, t: 10 });
  assert.ok(!hard.checks[0].ok && !hard.checks[1].ok, 'Brinell out of range for 60 HRC');
  assert.equal(hard.rock, 'HRC');
  const thin = hardness({ scale: 'HV', value: 200, D: 10, hvLoad: 30, t: 1 });
  assert.ok(!thin.checks[3].ok && thin.checks[4].ok, 'thin sheet: Brinell too deep, Vickers fine');
});
