import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GEAR_MATERIALS, YNT_THROUGH, ZNT_STEEL, contactRatioFactor, designGears, gearDesignFeasible, dynamicFactor, elasticityFactor,
  faceLoadFactor, formFactor, gearStrength, APPLICATION_FACTORS, lifeFactor, rootFaceLoadFactor, zoneFactor, MAX_RATIO_ERROR, DESIGN_OPTIONS, STEEL_DENSITY,
} from './iso6336.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const a20 = (20 * Math.PI) / 180;
const mat = (id: string) => GEAR_MATERIALS.find((m) => m.id === id)!;

test('Z_H, spur, α = α_w = 20° → 2.495 (textbook value)', () => {
  near(zoneFactor(a20, a20), 2.495, 0.001);
});

test('Z_E steel/steel, E = 206 000 MPa, ν = 0.3 → 189.8 √MPa (ISO 6336-2)', () => {
  near(elasticityFactor(), 189.8, 0.05);
});

test('Z_ε = √((4 − ε_α)/3): ε_α = 1.633 → 0.8883 (hand calculation)', () => {
  near(contactRatioFactor(1.633), 0.8883, 1e-4);
});

test('materials follow ISO 6336-5:2016 Table 1 (MQ) constants', () => {
  near(mat('42crmo4').sHlim, 1.313 * 300 + 373, 1e-9); // 766.9
  near(mat('42crmo4').sFlim, 0.425 * 300 + 187, 1e-9); // 314.5
  near(mat('c45').sHlim, 545, 1e-9);
  near(mat('c45').sFlim, 211, 1e-9);
  assert.equal(mat('18crnimo76').sHlim, 1500);
  assert.equal(mat('42crmo4n').sHlim, 998);
});

test('life factors: table points exact, log-log between (Z_NT at 10⁶ = 1.6·10^(−log1.6/log500) = 1.344)', () => {
  near(lifeFactor(ZNT_STEEL, 1e4), 1.6, 1e-12);
  near(lifeFactor(ZNT_STEEL, 5e7), 1.0, 1e-12);
  near(lifeFactor(ZNT_STEEL, 1e12), 0.85, 1e-12);
  near(lifeFactor(ZNT_STEEL, 1e6), 1.344, 0.001);
  near(lifeFactor(YNT_THROUGH, 3e6), 1.0, 1e-12);
});

test('Y_Fa, Y_Sa with load at the tip match the classic ISO 6336-3:1996 / DIN 3990-3 chart values (x = 0, h_fP = 1.25, ρ_fP = 0.38)', () => {
  // ε_α = 1 puts the load point at the tip circle → Method B formulas reduce to the tip-load form factor.
  const chart: [number, number, number][] = [[17, 2.97, 1.52], [20, 2.80, 1.55], [30, 2.52, 1.625], [40, 2.40, 1.67], [1e4, 2.06, 1.97]];
  for (const [z, YFa, YSa] of chart) {
    const f = formFactor(z, 0, 1);
    near(f.YF, YFa, 0.02, `Y_Fa z=${z}`);
    near(f.YS, YSa, 0.02, `Y_Sa z=${z}`);
  }
});

test('Method B: load at outer point of single contact gives a smaller Y_F than tip load', () => {
  const tip = formFactor(20, 0, 1), single = formFactor(20, 0, 1.6);
  assert.ok(single.YF < tip.YF);
  near(single.sFn, tip.sFn, 1e-12); // critical section does not depend on load point
});

test('K_v Method C: Q7, K_A F_t/b = 200 N/mm, v = 5 m/s, z₁ = 20, u = 3 → 1.1454 (hand calculation)', () => {
  near(dynamicFactor(7, 200, 5, 20, 3).Kv, 1 + (26.8 / 200 + 0.0193) * 1 * Math.sqrt(0.9), 1e-12);
  near(dynamicFactor(7, 200, 5, 20, 3).Kv, 1.1454, 1e-4);
  near(dynamicFactor(7, 50, 5, 20, 3).Kv, dynamicFactor(7, 100, 5, 20, 3).Kv, 1e-12); // floor 100 N/mm
});

test('K_Hβ: F_m/b = 200, b = 40, d₁ = 60, Q7, σ_Hlim 766.9, v 3 m/s → 1.384 (hand calculation)', () => {
  // f_sh = 0.023·200·(40/60)² = 2.044; f_ma = f_Hβ = (0.07√60 + 0.45√40 + 3)·√2² = 12.777
  // F_βx = 1.33·2.044 + 12.777 = 15.496; y_β = 320/766.9·15.496 = 6.466; F_βy = 9.030
  // K_Hβ = 1 + 9.030·17/(2·200) = 1.384
  const r = faceLoadFactor({ Fmb: 200, b: 40, d1: 60, Q: 7, sHlim: 766.9, hardened: false, v: 3 });
  near(r.fsh, 2.044, 0.001);
  near(r.fma, 12.777, 0.001);
  near(r.KHb, 1.384, 0.001);
  // K_Fβ: b/h = 40/6.75 = 5.926, N_F = 35.12/42.05 = 0.835
  const k = rootFaceLoadFactor(r.KHb, 40, 6.75);
  near(k.NF, 0.835, 0.001);
  near(k.KFb, Math.pow(r.KHb, k.NF), 1e-12);
});

test('σ_H and S_F follow their equations; pinion is pitting-critical (more cycles)', () => {
  const base = { m: 3, z1: 20, z2: 60, b: 40, n1: 1450, T1: 100, KA: 1.25, Lh: 20000, mat: mat('42crmo4') };
  const r = gearStrength(base);
  near(r.sH, r.sH0 * Math.sqrt(1.25 * r.Kv * r.KHb), 1e-9);
  near(r.SF1, (314.5 * 2 * r.YNT1) / r.sF1, 1e-9);
  assert.ok(r.SH1 <= r.SH2); // wheel sees fewer cycles
});

test('design mode: every returned option passes, respects limits, ranked by volume', () => {
  const req = { P: 15, n1: 1450, u: 3, Lh: 20000, KA: 1.25, aMax: 250, bMax: 80 };
  const { options } = designGears(req);
  assert.ok(options.length >= 2);
  for (const o of options) {
    assert.ok(o.r.ok, `${o.mat.id} m${o.m} z${o.z1}/${o.z2} b${o.b}`);
    assert.ok(o.a <= req.aMax && o.b <= req.bMax && o.b <= o.m * o.z1);
    assert.ok(o.uErr <= MAX_RATIO_ERROR);
  }
  for (let i = 1; i < options.length; i++) assert.ok(options[i].volume >= options[i - 1].volume);
  assert.ok(options.length <= DESIGN_OPTIONS);
});

test('design mode: mass = 7850 kg/m³ · π/4·(d₁² + d₂²)·b (hand check m 2, z 20/60, b 30 → 2.959 kg)', () => {
  // π/4·(40² + 120²)·30 = 376 991 mm³ → ×7.85e-6 = 2.9594 kg
  near(STEEL_DENSITY * (Math.PI / 4) * (40 ** 2 + 120 ** 2) * 30, 2.9594, 1e-3);
  const { options } = designGears({ P: 15, n1: 1450, u: 3, Lh: 20000, KA: 1.25, aMax: 250, bMax: 80 });
  for (const o of options) near(o.mass, STEEL_DENSITY * o.volume, 1e-12);
});

test('design mode: torque input T₁ gives the same options as the matching power', () => {
  const base = { n1: 1450, u: 3, Lh: 20000, KA: 1.25, aMax: 250, bMax: 80 };
  const byP = designGears({ ...base, P: 15 });
  const byT = designGears({ ...base, T1: byP.T1 });
  near(byT.P, 15, 1e-9);
  assert.deepEqual(byT.options.map((o) => [o.m, o.z1, o.b, o.mat.id]), byP.options.map((o) => [o.m, o.z1, o.b, o.mat.id]));
});

test('design mode: several options per material allowed; one per module and material', () => {
  const { options } = designGears({ P: 15, n1: 1450, u: 3, Lh: 20000, KA: 1.25, aMax: 400, bMax: 120 });
  const keys = options.map((o) => `${o.m}|${o.mat.id}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(options.length > new Set(options.map((o) => o.mat.id)).size);
});

test('design mode: reports the limit when nothing works', () => {
  const base = { P: 15, n1: 1450, u: 3, Lh: 20000, KA: 1.25 };
  assert.equal(designGears({ ...base, aMax: 30, bMax: 80 }).limit, 'centre'); // a ≥ 1·(18+54)/2 = 36 mm
  assert.equal(designGears({ ...base, aMax: 400, bMax: 5 }).limit, 'width'); // b_max < 0.4·18 mm
  assert.equal(designGears({ ...base, P: 5000, aMax: 120, bMax: 80 }).limit, 'strength');
  assert.equal(designGears({ ...base, aMax: 250, bMax: 80 }).limit, null);
});

test('gearStrength: strength checks are the four safety factors + K_v range, separate from geometry checks', () => {
  const r = gearStrength({ m: 3, z1: 20, z2: 60, b: 40, n1: 1450, T1: 100, KA: 1.25, Lh: 20000, mat: mat('42crmo4') });
  assert.equal(r.strengthChecks.length, 5);
  assert.equal(r.checks.length, 5 + r.geo.checks.length);
  assert.equal(r.strengthOk, r.strengthChecks.every((c) => c.ok));
});

test('K_A presets (ISO 6336-6 Annex A, uniform driver): 1.00 / 1.25 / 1.50 / 1.75', () => {
  assert.deepEqual(APPLICATION_FACTORS.map((a) => a.KA), [1, 1.25, 1.5, 1.75]);
});

test('gearDesignFeasible agrees with designGears (pass ranges on the Design sliders)', () => {
  const run = (g: Generator<unknown, boolean, unknown>) => { let r = g.next(); while (!r.done) r = g.next(); return r.value; };
  const base = { n1: 1450, u: 3, Lh: 20000, KA: 1.25, aMax: 250, bMax: 80 };
  for (const q of [{ ...base, P: 15 }, { ...base, P: 200 }, { ...base, P: 60, aMax: 120 }, { ...base, P: 5, u: 6.9 }, { ...base, P: 15, bMax: 6 }, { ...base, P: 1, aMax: 40 }]) {
    assert.equal(run(gearDesignFeasible(q)), designGears(q).options.length > 0, JSON.stringify(q));
  }
});
