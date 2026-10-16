import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, RHO_SEA, stability, type StabIn } from './stability.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const extra = { rho: RHO_SEA, tankL: 0, tankB: 0, tankRho: 1, thetaF: 50 };
const box: StabIn = { L: 60, B: 12, D: 6, T: 3, CB: 1, CM: 1, a: 2, KG: 4, ...extra };

test('box barge (closed form): ∇ = LBT, KB = T/2, BM = B²/12T, GM = KB + BM − KG', () => {
  const r = stability(box);
  near(r.vol, 60 * 12 * 3, 1e-6, '∇');
  near(r.disp, 1.025 * 2160, 1e-6, 'Δ');
  near(r.KB, 1.5, 1e-9, 'KB'); near(r.BM, 144 / 36, 1e-9, 'BM'); near(r.GM, 1.5, 1e-9, 'GM');
  near(r.CB, 1, 1e-12); near(r.CWP, 1, 1e-12);
});

test('box barge: GZ follows the wall-sided formula sin φ (GM + ½ BM tan²φ) until the deck edge immerses (26.6°), then falls below it', () => {
  const r = stability(box);
  near(r.deckEdge, (Math.atan(3 / 6) * 180) / Math.PI, 1e-9, 'deck edge');
  for (const d of [5, 10, 15, 20, 25]) near(r.curve[d].gz, r.wallSided(d), 1e-6, `GZ(${d}°)`);
  assert.ok(r.curve[40].gz < r.wallSided(40) - 0.05, 'beyond the deck edge the wall-sided formula over-predicts');
  // displaced volume is kept at every heel
  near(r.curve[0].d, 3, 1e-9, 'upright waterline = draft');
});

test('Wigley hull (closed form): C_B = 4/9, C_M = C_WP = 2/3, KB = 5T/8, BM = (16/35)(B³L/12)/∇ = 0.0857 B²/T', () => {
  const w: StabIn = { L: 100, B: 10, D: 9, T: 6.25, CB: 4 / 9, CM: 2 / 3, a: 2, KG: 4, ...extra };
  const r = stability(w);
  near(r.par, 0, 1e-9, 'no parallel middle body');
  near(r.vol / (100 * 10 * 6.25), 4 / 9, 0.002, 'C_B by integration');
  near(r.CWP, 2 / 3, 1e-9, 'C_WP');
  near(r.KB, (5 / 8) * 6.25, 0.01, 'KB');
  near(r.BM, ((16 / 35) * (1000 * 100) / 12) / r.vol, 1e-4, 'BM from I_T (Simpson on a 6th-degree polynomial)');
  near(r.BM, (0.0857142857 * 100) / 6.25, 0.01, 'BM 0.0857 B²/T');
});

test('small heel: GZ/sin φ → GM for every preset; GZ(0) = 0 and the curve is smooth', () => {
  for (const k of Object.keys(PRESETS) as (keyof typeof PRESETS)[]) {
    const r = stability({ ...PRESETS[k], ...extra });
    near(r.curve[0].gz, 0, 1e-9, `${k} GZ(0)`);
    near(r.curve[2].gz / Math.sin((2 * Math.PI) / 180), r.GM, Math.max(0.01, 0.01 * r.GM), `${k} GZ/sinφ`);
  }
});

test('free surface: FSC = ρ_t l b³/12/Δ lowers GM and the whole GZ curve by FSC·sin φ', () => {
  const dry = stability(box), wet = stability({ ...box, tankL: 10, tankB: 6, tankRho: 1 });
  near(wet.FSM, (1 * 10 * 216) / 12, 1e-9, 'FSM');
  near(wet.FSC, 180 / (1.025 * 2160), 1e-9, 'FSC');
  near(dry.GM - wet.GM, wet.FSC, 1e-9, 'GM loss');
  near(dry.curve[30].gz - wet.curve[30].gz, wet.FSC * 0.5, 1e-6, 'GZ(30°) loss');
});

test('IMO areas integrate the GZ curve: box barge area 0…20° equals the integral of the wall-sided formula', () => {
  const r = stability(box);
  // ∫₀^φ sinθ (GM + ½BM tan²θ) dθ = GM(1 − cos φ) + ½BM (1/cos φ + cos φ − 2)
  const ph = (20 * Math.PI) / 180, exact = r.GM * (1 - Math.cos(ph)) + 0.5 * r.BM * (1 / Math.cos(ph) + Math.cos(ph) - 2);
  let s = 0; for (let i = 0; i < 80; i++) { const a = i * 0.25, b = a + 0.25; s += ((r.gzAt(a) + r.gzAt(b)) / 2) * ((0.25 * Math.PI) / 180); }
  near(s, exact, 2e-4, 'area 0…20°');
});

test('presets pass the IMO general criteria; a high KG fails them', () => {
  for (const k of Object.keys(PRESETS) as (keyof typeof PRESETS)[]) {
    const r = stability({ ...PRESETS[k], ...extra });
    assert.ok(r.checks.every((c) => c.ok), `${k}: ${r.checks.filter((c) => !c.ok).map((c) => `${c.label} (${c.detail})`).join('; ')}`);
  }
  const top = stability({ ...PRESETS.cargo, ...extra, KG: 9.5 });
  assert.ok(top.checks.some((c) => !c.ok));
});

test('coarse resolution (slider scans) agrees with the fine one on GM and the criteria', () => {
  for (const KG of [5, 6, 6.8, 7.2]) {
    const p = { ...PRESETS.cargo, ...extra, KG }, a = stability(p), b = stability(p, true);
    near(b.GM, a.GM, 0.01, 'GM'); near(b.A30, a.A30, 0.003, 'A30'); near(b.A40, a.A40, 0.004, 'A40');
  }
});
