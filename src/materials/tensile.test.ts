import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curveParams, engCurve, MATERIALS, stressAt, stretchAt, strainAt, tensile, trueCurve } from './tensile.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const byId = (id: string) => MATERIALS.find((m) => m.id === id)!;
const metals = MATERIALS.filter((m) => m.kind === 'round' || m.kind === 'plateau');

test('curve passes through the catalogue values: R_p0.2 at 0.2 % offset, R_m at A_g, fracture at A', () => {
  for (const m of metals) {
    if (m.kind === 'round') near(stressAt(m, m.Re / m.E + 0.002), m.Re, 0.01, `${m.id} R_p0.2`);
    else near(stressAt(m, (m.eL! + m.ReH! / m.E) / 2 + 0.003), m.Re, 1e-9, `${m.id} plateau at R_eL`);
    near(stressAt(m, m.Ag!), m.Rm, 0.01, `${m.id} R_m at A_g`);
    const eng = engCurve(m), top = eng.reduce((a, b) => (b.s > a.s ? b : a));
    near(top.s, m.Rm, 0.05, `${m.id} highest stress = R_m`);
    near(top.e, m.Ag!, 0.01, `${m.id} highest stress at A_g`);
    assert.ok(stressAt(m, m.A) > 0 && stressAt(m, m.A + 1e-6) === 0, `${m.id} breaks at A`);
    // the curve rises monotonically up to A_g
    for (let i = 1; i < eng.length && eng[i].e <= m.Ag!; i++) if (eng[i].e > (m.ReH ?? 0) / m.E + 0.002) assert.ok(eng[i].s >= eng[i - 1].s - 1e-6, `${m.id} rising at ${eng[i].e}`);
  }
});

test('elastic part: σ = E e, slope continuous at the 0.2 % proof stress (Ramberg–Osgood exponent from the hardening slope)', () => {
  for (const m of metals) near(stressAt(m, 0.3 * m.Re / m.E), 0.3 * m.Re, (m.kind === 'round' ? 0.002 : 1e-9) * m.Re, `${m.id} Hooke`);
  for (const m of MATERIALS.filter((x) => x.kind === 'round')) {
    const e0 = m.Re / m.E + 0.002, h = 1e-6, sL = (stressAt(m, e0) - stressAt(m, e0 - h)) / h, sR = (stressAt(m, e0 + h) - stressAt(m, e0)) / h;
    near(sR / sL, 1, 0.03, `${m.id} slope ratio at R_p0.2`);
  }
});

test('Considère: at the start of necking the true curve slope dσ_t/dε equals the true stress σ_t = R_m (1 + A_g)', () => {
  for (const m of metals) {
    const eu = m.Ag!, h = 1e-7;
    const st = (e: number) => stressAt(m, e) * (1 + e), et = (e: number) => Math.log(1 + e);
    const slope = (st(eu) - st(eu - h)) / (et(eu) - et(eu - h));
    near(slope / st(eu), 1, 0.03, `${m.id} Considère`);
  }
  const s355 = byId('s355'), t = trueCurve(s355, engCurve(s355)), last = t.uniform[t.uniform.length - 1];
  near(last.s, 510 * 1.16, 0.5, 'true stress at necking'); near(last.e, Math.log(1.16), 1e-9, 'true strain at necking');
  near(t.neck![1].e, Math.log(1 / 0.45), 1e-12, 'true fracture strain ln(1/(1 − Z))');
});

test('mild steel: upper yield point, drop to R_eL and the Lüders plateau before hardening', () => {
  const m = byId('s235');
  near(stressAt(m, m.ReH! / m.E), 250, 1e-9, 'R_eH');
  near(stressAt(m, 0.01), 235, 1e-9, 'plateau');
  assert.ok(stressAt(m, m.eL! + 0.01) > 240, 'hardening after the plateau');
});

test('grey cast iron: non-linear from the start, R_p0.1 at 0.1 % offset, breaks at R_m without necking', () => {
  const m = byId('gjl250');
  near(stressAt(m, 170 / m.E + 0.001), 170, 0.05, 'R_p0.1');
  near(stressAt(m, m.A), 250, 0.05, 'R_m at fracture');
  assert.ok(stressAt(m, 0.0005) < m.E * 0.0005, 'below the Hooke line already');
  assert.equal(curveParams(m).epu, m.A - 250 / m.E);
});

test('polymer: yield peak at e_y, drawing stress plateau, hardening to break', () => {
  const m = byId('pc');
  near(stressAt(m, m.ey!), 62, 1e-9, 'σ_y'); near(stressAt(m, 0.5), 52, 1e-9, 'drawing');
  near(stressAt(m, m.A), 66, 1e-9, 'break'); near((stressAt(m, 1e-7) / 1e-7), m.E, 1, 'initial modulus');
  // cold drawing keeps the gauge elongation: ∫λ dZ = Lc (1 + e)
  const Lc = 60, d0 = 10;
  for (const e of [0.04, 0.3, 0.7, 1.0]) {
    let L = 0; const n = 4000; for (let i = 0; i < n; i++) L += stretchAt(m, e, -Lc / 2 + ((i + 0.5) / n) * Lc, d0, Lc).lz * (Lc / n);
    near(L / Lc, 1 + e, e < 0.06 || e > 0.9 ? 1e-9 : 0.01, `length at e = ${e}`);
  }
});

test('necking keeps the elongation and reaches the reduction of area at fracture', () => {
  const m = byId('s235'), Lc = 60, d0 = 10, n = 6000;
  for (const e of [0.22, 0.26]) {
    let L = 0; for (let i = 0; i < n; i++) L += stretchAt(m, e, -Lc / 2 + ((i + 0.5) / n) * Lc, d0, Lc).lz * (Lc / n);
    near(L / Lc, 1 + e, 0.002, `length at e = ${e}`);
  }
  near(d0 / Math.sqrt(stretchAt(m, m.A, 0, d0, Lc).lr), d0 * Math.sqrt(1 - m.Z!), 1e-9, 'd_f = d₀ √(1 − Z)');
});

test('specimen and energies (hand calculation): S235, d₀ = 10 mm', () => {
  const r = tensile({ mat: byId('s235'), d0: 10, Fw: 10, Fmax: 100 });
  near(r.S0, 78.5398, 1e-4, 'S₀'); near(r.L0, 50.07, 0.01, 'L₀ = 5.65 √S₀ ≈ 5 d₀');
  near(r.Fm, 31.416, 0.001, 'F_m'); near(r.Ur, (235 * 235) / 420000, 1e-12, 'U_r');
  near(r.sw, 127.32, 0.01, 'σ = F/S₀'); near(r.ew, 127.32 / 210000, 1e-7, 'elastic strain');
  near(r.ddw, -10 * 0.3 * 127.32 / 210000, 1e-6, 'Δd = −ν ε d₀');
  // toughness: about the plateau + hardening area, between R_eL·A and R_m·A
  assert.ok(r.UT > 235 * 0.26 && r.UT < 400 * 0.26, `U_T ${r.UT}`);
  assert.ok(r.checks.every((c) => c.ok));
  assert.ok(tensile({ mat: byId('s235'), d0: 10, Fw: 15, Fmax: 100 }).checks.some((c) => !c.ok), 'S_y < 1.5');
  assert.ok(tensile({ mat: byId('gjl250'), d0: 10, Fw: 1, Fmax: 100 }).checks.some((c) => !c.ok), 'cast iron is not ductile');
  assert.ok(Number.isNaN(strainAt(byId('s235'), 500, engCurve(byId('s235')))), 'never reached');
});
