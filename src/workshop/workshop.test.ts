import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUANTITIES, convert, fmtNum, quantityById } from './convert.ts';
import { ASME_PIPES, EN10255_PIPES, MATS, SECTIONS_TABLE, angleArea, channelArea, pipeProps } from './tables.ts';
import { tightening, threadGeom, THREADS, type BoltClass } from './torque.ts';
import { weight, type WeightIn } from './weight.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const rel = (a: number, b: number, r: number, msg = '') => near(a, b, Math.abs(b) * r, msg);

/* ---------------- converter ---------------- */

test('converter: exact definitions', () => {
  const q = (id: string) => quantityById(id);
  near(convert(q('length'), 'in', 'mm', 1), 25.4, 1e-12);
  near(convert(q('mass'), 'lb', 'kg', 1), 0.45359237, 1e-15);
  rel(convert(q('force'), 'lbf', 'N', 1), 4.4482216152605, 1e-12);
  rel(convert(q('pressure'), 'psi', 'Pa', 1), 6894.757293168, 1e-11);
  rel(convert(q('pressure'), 'bar', 'psi', 1), 14.5037738, 1e-8);
  rel(convert(q('pressure'), 'atm', 'mmHg', 1), 760, 1e-6); // torr = atm/760, mmHg 133.322387 Pa
  rel(convert(q('energy'), 'kWh', 'Btu', 1), 3412.14163, 1e-8);
  rel(convert(q('power'), 'hp', 'W', 1), 745.69987158, 1e-9);
  rel(convert(q('power'), 'PS', 'W', 1), 735.49875, 1e-12);
  rel(convert(q('power'), 'TR', 'kW', 1), 3.5168528, 1e-7);
  rel(convert(q('volume'), 'gal', 'L', 1), 3.785411784, 1e-12);
  rel(convert(q('flow'), 'gpm', 'm3h', 1), 0.22712470704, 1e-10);
  rel(convert(q('torque'), 'lbfft', 'Nm', 1), 1.3558179483, 1e-10);
  rel(convert(q('density'), 'gcm3', 'lbft3', 1), 62.427960576, 1e-9);
  rel(convert(q('htc'), 'Btu', 'Wm2K', 1), 5.678263, 1e-6);
  rel(convert(q('conductivity'), 'Btu', 'WmK', 1), 1.7307347, 1e-6);
});

test('converter: temperatures and slopes', () => {
  const T = quantityById('temperature'), a = quantityById('angle');
  near(convert(T, 'C', 'F', 100), 212, 1e-9);
  near(convert(T, 'F', 'C', -40), -40, 1e-9);
  near(convert(T, 'C', 'K', 0), 273.15, 1e-12);
  near(convert(T, 'R', 'F', 491.67), 32, 1e-9);
  near(convert(a, 'pct', 'deg', 100), 45, 1e-9);
  near(convert(a, 'deg', 'mmm', 45), 1000, 1e-9);
});

test('converter: every unit round-trips and ids are unique', () => {
  for (const q of QUANTITIES) {
    assert.equal(new Set(q.units.map((u) => u.id)).size, q.units.length, q.id);
    for (const u of q.units) for (const w of q.units) {
      if (q.id === 'angle' && (u.id === 'mmm' || u.id === 'pct' || w.id === 'mmm' || w.id === 'pct') && convert(q, u.id, 'rad', 0.37) >= Math.PI / 2) continue; // a slope only reaches 90°
      const back = convert(q, w.id, u.id, convert(q, u.id, w.id, 0.37));
      near(back, 0.37, 1e-9, `${q.id} ${u.id}→${w.id}`);
    }
  }
  assert.equal(fmtNum(25.4), '25.4');
  assert.equal(fmtNum(1 / 3), '0.333333');
  assert.equal(fmtNum(1.5e-7), '1.5 × 10⁻⁷');
});

/* ---------------- tables ---------------- */

test('VALIDATION (EN 10365 catalogue values): IPE / HEA / HEB computed from the dimensions', () => {
  const row = (f: 'IPE' | 'HEA' | 'HEB', n: string) => SECTIONS_TABLE[f].find((r) => r.name === `${f} ${n}`)!;
  // name: A cm², G kg/m, Iy cm⁴, Wy cm³, Iz cm⁴
  const cat: [ 'IPE' | 'HEA' | 'HEB', string, number, number, number, number, number][] = [
    ['IPE', '200', 28.5, 22.4, 1943, 194, 142],
    ['IPE', '300', 53.8, 42.2, 8356, 557, 604],
    ['IPE', '400', 84.5, 66.3, 23130, 1156, 1318],
    ['HEA', '200', 53.8, 42.3, 3692, 389, 1336],
    ['HEA', '300', 112.5, 88.3, 18260, 1260, 6310],
    ['HEB', '200', 78.1, 61.3, 5696, 570, 2003],
    ['HEB', '300', 149.1, 117, 25170, 1678, 8563],
  ];
  for (const [f, n, A, G, Iy, Wy, Iz] of cat) {
    const r = row(f, n);
    rel(r.A, A, 0.006, `${f} ${n} A`); rel(r.G, G, 0.008, `${f} ${n} G`);
    rel(r.Iy, Iy, 0.006, `${f} ${n} Iy`); rel(r.Wy, Wy, 0.006, `${f} ${n} Wy`); rel(r.Iz, Iz, 0.01, `${f} ${n} Iz`);
  }
});

test('channel and angle catalogue rows agree with their dimensions (typo check)', () => {
  for (const r of SECTIONS_TABLE.UPN) rel(r.A * 100, channelArea(r.h, r.b, r.tw, r.tf), 0.04, r.name);
  for (const r of SECTIONS_TABLE.L) rel(r.A * 100, angleArea(r.h, r.tw, r.r), 0.03, r.name);
  // second moment of an angle about its centroidal axis from rectangles: within 6 %
  for (const r of SECTIONS_TABLE.L) {
    const a = r.h, t = r.tw, A1 = a * t, A2 = (a - t) * t, e = (A1 * t / 2 + A2 * (t + (a - t) / 2)) / (A1 + A2);
    const I = a * t ** 3 / 12 + A1 * (e - t / 2) ** 2 + t * (a - t) ** 3 / 12 + A2 * (t + (a - t) / 2 - e) ** 2;
    rel(r.Iy * 1e4, I, 0.06, r.name + ' I'); rel((r.e ?? 0) * 10, e, 0.05, r.name + ' e');
  }
});

test('pipes: EN 10255 inside diameters, ASME steel mass', () => {
  const dn = (rows: typeof ASME_PIPES, n: number) => rows.find((r) => r.dn === n)!;
  near(pipeProps(dn(EN10255_PIPES, 25).od, dn(EN10255_PIPES, 25).walls[0]).di, 27.3, 1e-9);
  // ASME B36.10M: 2 in Sch 40 5.44 kg/m, 4 in Sch 40 16.07 kg/m, 6 in Sch 80 42.56 kg/m (ASME uses 7850 kg/m³ approx.)
  rel(pipeProps(60.3, 3.91).kgm, 5.44, 0.01);
  rel(pipeProps(114.3, 6.02).kgm, 16.07, 0.01);
  rel(pipeProps(168.3, 10.97).kgm, 42.56, 0.01);
  for (const r of [...ASME_PIPES, ...EN10255_PIPES]) for (const w of r.walls) assert.ok(w > 0 && 2 * w < r.od, r.nps);
});

test('material table is complete and plausible', () => {
  assert.equal(new Set(MATS.map((m) => m.id)).size, MATS.length);
  for (const m of MATS) {
    assert.ok(m.rho > 300 && m.rho < 12000 && m.E > 0 && m.nu > 0 && m.nu < 0.5 && m.Rm > 0, m.id);
    if (m.Re) assert.ok(m.Re <= m.Rm, m.id);
  }
});

/* ---------------- weight ---------------- */

const W = (o: Partial<WeightIn>): WeightIn => ({ shape: 'round', a: 20, b: 100, t: 2, L: 1000, n: 1, rho: 7850, family: 'IPE', size: 0, ...o });

test('weight: hand values', () => {
  rel(weight(W({ shape: 'round', a: 20 })).kgm, 2.466, 0.001);            // Ø20 steel 2.47 kg/m
  rel(weight(W({ shape: 'plate', a: 10, b: 1000, L: 2000 })).kgPiece, 157, 1e-9); // 10 mm plate 1 × 2 m = 157 kg
  rel(weight(W({ shape: 'plate', a: 10 })).kgm, 78.5, 1e-9);               // 78.5 kg/m²
  rel(weight(W({ shape: 'hex', a: 24 })).kgm, 3.916, 0.002);               // SW 24 hex bar 3.92 kg/m
  rel(weight(W({ shape: 'tube', a: 60.3, t: 3.91 })).kgm, 5.44, 0.01);     // 2 in Sch 40
  rel(weight(W({ shape: 'square', a: 30, n: 5, L: 3000 })).kgTotal, 5 * 3 * 7.065, 1e-6);
  // EN 10219 RHS 100 × 50 × 4: A 10.9 cm², 8.59 kg/m (catalogue, r_o 2 t)
  rel(weight(W({ shape: 'rhs', a: 100, b: 50, t: 4 })).kgm, 8.59, 0.01);
  // SHS 100 × 100 × 5: 14.4 kg/m
  rel(weight(W({ shape: 'rhs', a: 100, b: 100, t: 5 })).kgm, 14.4, 0.01);
  const ipe = SECTIONS_TABLE.IPE.findIndex((r) => r.name === 'IPE 200');
  rel(weight(W({ shape: 'section', family: 'IPE', size: ipe, L: 6000 })).kgPiece, 6 * 22.4, 0.01);
  assert.equal(weight(W({ shape: 'tube', a: 20, t: 10 })).valid, false);
});

/* ---------------- tightening torque ---------------- */

test('thread geometry ISO 724: M12 A_s 84.3 mm², M20 245 mm², M10×1.25 61.2 mm²', () => {
  rel(threadGeom(12, 1.75).As, 84.3, 0.002);
  rel(threadGeom(20, 2.5).As, 245, 0.002);
  rel(threadGeom(10, 1.25).As, 61.2, 0.003);
});

test('VALIDATION (VDI 2230-1:2015 Table A1, coarse threads, ν = 0.9): F_M and M_A', () => {
  // d, class, μ, F_M kN, M_A N·m (as published, e.g. Bossard F.053)
  const rows: [number, BoltClass, number, number, number][] = [
    [6, '8.8', 0.12, 10.2, 10.1], [8, '8.8', 0.12, 18.6, 24.6], [10, '8.8', 0.12, 29.6, 48], [12, '8.8', 0.12, 43.0, 84],
    [16, '8.8', 0.12, 80.9, 206], [20, '8.8', 0.12, 130, 415], [24, '8.8', 0.12, 188, 714], [30, '8.8', 0.12, 300, 1428], [36, '8.8', 0.12, 438, 2482],
    [12, '10.9', 0.10, 64.8, 108], [12, '12.9', 0.14, 72.0, 160], [8, '10.9', 0.14, 26.6, 40.1], [20, '12.9', 0.10, 223, 605], [4, '8.8', 0.10, 4.5, 2.6],
  ];
  for (const [d, cls, mu, F, M] of rows) {
    const r = tightening({ d, fine: false, cls, muG: mu, muK: mu, nu: 0.9 });
    rel(r.FM / 1000, F, 0.015, `M${d} ${cls} μ${mu} F_M`);
    rel(r.MA, M, 0.025, `M${d} ${cls} μ${mu} M_A`);
  }
});

test('torque grows with friction, preload falls; fine thread carries more', () => {
  const a = tightening({ d: 16, fine: false, cls: '8.8', muG: 0.1, muK: 0.1, nu: 0.9 });
  const b = tightening({ d: 16, fine: false, cls: '8.8', muG: 0.16, muK: 0.16, nu: 0.9 });
  assert.ok(b.MA > a.MA && b.FM < a.FM);
  const f = tightening({ d: 16, fine: true, cls: '8.8', muG: 0.12, muK: 0.12, nu: 0.9 });
  const c = tightening({ d: 16, fine: false, cls: '8.8', muG: 0.12, muK: 0.12, nu: 0.9 });
  assert.ok(f.FM > c.FM && f.P === 1.5);
  near(a.sharePitch + a.shareThread + a.shareHead, 1, 1e-12);
  for (const t of THREADS) assert.ok(t.dw < t.s && t.dh > t.d, `M${t.d}`);
});
