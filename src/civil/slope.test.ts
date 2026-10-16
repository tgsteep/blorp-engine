import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bishop, circular, infinite, infSlope, search, type CircIn, type InfIn } from './slope.ts';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const inf: InfIn = { beta: 25, z: 3, m: 0, c: 0, phi: 32, gamma: 18, gammaSat: 20, FSreq: 1.5 };

test('infinite slope: dry cohesionless FS = tan φ/tan β; full seepage FS = (γ′/γ_sat) tan φ/tan β (Das); cohesion hand check', () => {
  const t = Math.tan((32 * Math.PI) / 180) / Math.tan((25 * Math.PI) / 180);
  near(infSlope(inf).FS, t, 1e-12);
  near(infSlope({ ...inf, m: 1 }).FS, ((20 - 9.81) / 20) * t, 1e-12);
  // c′ = 10, z = 3, β = 25°, dry: (10 + 54 cos²β tan 32°)/(54 sin β cos β)
  const b = (25 * Math.PI) / 180, s = 54 * Math.cos(b) ** 2, tau = 54 * Math.sin(b) * Math.cos(b);
  near(infSlope({ ...inf, c: 10 }).FS, (10 + s * Math.tan((32 * Math.PI) / 180)) / tau, 1e-12);
  const r = infinite({ ...inf, c: 5, phi: 20 });
  near(infSlope({ ...inf, c: 5, phi: 20 }, r.Hcr).FS, 1, 1e-6, 'critical depth');
  assert.ok(infinite(inf).FSd < infinite(inf).FS);
});

test('VALIDATION (Taylor 1937 stability chart, φ = 0, Das): deep circles for β ≤ 53° → c/(γ H F) = 0.181; β = 75° toe circle → 0.219', () => {
  const sn = (beta: number, D: number) => { const p: CircIn = { H: 6, beta, D, c: 30, phi: 0, gamma: 18, gammaSat: 18, hw: 0, q: 0, FSreq: 1.5 }; return p.c / (p.gamma * p.H * search(p)!.FS); };
  near(sn(30, 60), 0.181, 0.003);
  near(sn(45, 60), 0.181, 0.003);
  near(sn(75, 30), 0.219, 0.006);
});

test('circular slip: shallow circles in dry sand approach the infinite-slope value; water and surcharge lower FS; Bishop ≥ Fellenius', () => {
  const p: CircIn = { H: 8, beta: 30, D: 8, c: 0, phi: 35, gamma: 19, gammaSat: 20, hw: 0, q: 0, FSreq: 1.5 };
  const s = search(p)!, t = Math.tan((35 * Math.PI) / 180) / Math.tan((30 * Math.PI) / 180);
  assert.ok(s.FS >= t * 0.98 && s.FS <= t * 1.06, `FS ${s.FS} vs ${t}`);
  const pc = { ...p, c: 10, phi: 25 };
  const r = circular(pc);
  assert.ok(circular({ ...pc, hw: 6 }).FS < r.FS);
  assert.ok(circular({ ...pc, q: 30 }).FS < r.FS);
  const b = bishop(pc, r.s!.C)!;
  near(b.FS, r.FS, 1e-6);
  assert.ok(b.FS >= b.fell - 1e-6);
  assert.ok(r.worst.FS < r.FS && r.worst.name !== 'DA1-1');
});
