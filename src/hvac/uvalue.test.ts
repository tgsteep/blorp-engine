import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLayers, uvalue, WALLS, type UIn } from './uvalue.ts';
import { pws } from './psychro.ts';

const near = (a: number, b: number, tol: number, w = '') => assert.ok(Math.abs(a - b) <= tol, `${w}: ${a} vs ${b}`);
export const U_DEF: UIn = { wall: 'etics', main: 0.19, ins: 0.08, insMat: 'eps', vb: true, ti: 20, rhi: 0.5, te: -5, rhe: 0.8, Utarget: 0.4, A: 100, hdd: 2500 };

test('U-value by hand: brick + 80 mm EPS', () => {
  const r = uvalue(U_DEF);
  const Rt = 0.13 + 0.015 / 0.4 + 0.19 / 0.45 + 0.08 / 0.035 + 0.008 / 0.87 + 0.04;
  near(r.U, 1 / Rt, 1e-12, 'U'); near(r.U, 0.342, 0.001, 'U ≈ 0.34');
  // surface temperatures from the resistance ratio
  near(r.tsi, 20 - 25 * 0.13 / Rt, 1e-9, 'θ_si'); near(r.th[r.th.length - 1], -5 + 25 * 0.04 / Rt, 1e-9, 'θ_se');
  near(r.Q, r.U * 100 * 25, 1e-9, 'Q'); near(r.Eyear, (r.U * 100 * 2500 * 24) / 1000, 1e-9, 'kWh/year');
  assert.ok(r.checks.every((c) => c.ok), JSON.stringify(r.checks.filter((c) => !c.ok)));
  // the insulation needed for the target gives exactly the target
  const t = uvalue({ ...U_DEF, Utarget: 0.25 }); near(uvalue({ ...U_DEF, ins: t.dNeed }).U, 0.25, 1e-9, 'd for U');
});

test('moisture: timber frame needs its vapour barrier; mould criterion; uninsulated block', () => {
  const tf = { ...U_DEF, wall: 'timber' as const, main: 0.015, ins: 0.16, insMat: 'mw' as const };
  assert.ok(uvalue({ ...tf, vb: true }).gc <= 0, 'with barrier: no condensation');
  assert.ok(uvalue({ ...tf, vb: false }).gc > 0, 'without barrier: condensation on the OSB');
  assert.equal(buildLayers({ ...tf, vb: false }).some((l) => l.mat === 'vb'), false);
  // surface RH 80 % at θ_si,min: p_sat(θ_si,min) = p_i / 0.8
  const r = uvalue(U_DEF); near(pws(r.tsMin) * 1000, r.pi / 0.8, 1, 'θ_si,min');
  // a bare concrete wall gets cold enough inside for mould at −10 °C and 60 % RH
  const bare = uvalue({ ...U_DEF, wall: 'concrete', main: 0.2, ins: 0, insMat: 'xps', te: -10, rhi: 0.6 });
  assert.equal(bare.checks[1].ok, false);
});

test('every wall type with its defaults computes; air layer resistance', () => {
  for (const [id, w] of Object.entries(WALLS)) {
    const r = uvalue({ ...U_DEF, wall: id as UIn['wall'], main: w.main[2], ins: w.ins, insMat: w.insMat });
    assert.ok(r.U > 0.1 && r.U < 1.5, `${id} U ${r.U}`);
  }
  const c = uvalue({ ...U_DEF, wall: 'cavity', main: 0.115, ins: 0.1, insMat: 'mw' });
  near(c.Rt, 0.13 + 0.015 / 0.4 + 0.115 / 0.77 + 0.1 / 0.035 + 0.18 + 0.115 / 0.77 + 0.04, 1e-12, 'cavity R_T');
});

test('slider ends give numbers', () => {
  for (const e of [{ ins: 0 }, { ins: 0.4 }, { te: -30 }, { te: 15 }, { rhi: 0.9 }, { rhi: 0.2 }, { ti: 10 }, { Utarget: 0.1 }] as Partial<UIn>[]) {
    const r = uvalue({ ...U_DEF, ...e }); for (const v of [r.U, r.tsi, r.gc, r.fRsi, r.dNeed, r.Eyear]) assert.ok(Number.isFinite(v), JSON.stringify(e));
  }
});
