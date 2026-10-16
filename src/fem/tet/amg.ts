/**
 * Sparse linear algebra for the tetrahedral solver: CSR matrices, sparse products, and a smoothed-aggregation algebraic
 * multigrid preconditioner for linear elasticity (Vaněk, Mandel & Brezina 1996): nodes grouped into aggregates, the
 * six rigid-body modes as near-null space (orthonormalised per aggregate → tentative prolongator), one damped-Jacobi
 * smoothing of the prolongator, Galerkin coarse matrices Pᵀ A P, symmetric Gauss–Seidel smoothing, dense Cholesky on the
 * coarsest level. Used as the preconditioner of conjugate gradients.
 */

export type Csr = { n: number; m: number; ptr: Int32Array; col: Int32Array; val: Float64Array };

export function spmv(A: Csr, x: Float64Array, y: Float64Array) {
  const { ptr, col, val } = A;
  for (let i = 0; i < A.n; i++) { let s = 0; for (let k = ptr[i]; k < ptr[i + 1]; k++) s += val[k] * x[col[k]]; y[i] = s; }
}

export function transpose(A: Csr): Csr {
  const cnt = new Int32Array(A.m + 1);
  for (let k = 0; k < A.ptr[A.n]; k++) cnt[A.col[k] + 1]++;
  for (let i = 0; i < A.m; i++) cnt[i + 1] += cnt[i];
  const ptr = cnt.slice(), col = new Int32Array(A.ptr[A.n]), val = new Float64Array(A.ptr[A.n]), pos = cnt.slice(0, A.m);
  for (let i = 0; i < A.n; i++) for (let k = A.ptr[i]; k < A.ptr[i + 1]; k++) { const j = A.col[k], q = pos[j]++; col[q] = i; val[q] = A.val[k]; }
  return { n: A.m, m: A.n, ptr, col, val };
}

/** C = A B (Gustavson, two passes). */
export function spgemm(A: Csr, B: Csr): Csr {
  const mark = new Int32Array(B.m).fill(-1), ptr = new Int32Array(A.n + 1);
  for (let i = 0; i < A.n; i++) {
    let c = 0;
    for (let k = A.ptr[i]; k < A.ptr[i + 1]; k++) { const a = A.col[k]; for (let q = B.ptr[a]; q < B.ptr[a + 1]; q++) { const j = B.col[q]; if (mark[j] !== i) { mark[j] = i; c++; } } }
    ptr[i + 1] = ptr[i] + c;
  }
  const col = new Int32Array(ptr[A.n]), val = new Float64Array(ptr[A.n]), acc = new Float64Array(B.m), where = new Int32Array(B.m).fill(-1);
  for (let i = 0; i < A.n; i++) {
    let c = ptr[i];
    for (let k = A.ptr[i]; k < A.ptr[i + 1]; k++) {
      const a = A.col[k], av = A.val[k];
      for (let q = B.ptr[a]; q < B.ptr[a + 1]; q++) { const j = B.col[q]; if (where[j] < 0) { where[j] = c; col[c++] = j; acc[j] = 0; } acc[j] += av * B.val[q]; }
    }
    for (let q = ptr[i]; q < c; q++) { const j = col[q]; val[q] = acc[j]; where[j] = -1; }
  }
  return { n: A.n, m: B.m, ptr, col, val };
}

const diagOf = (A: Csr) => { const d = new Float64Array(A.n); for (let i = 0; i < A.n; i++) for (let k = A.ptr[i]; k < A.ptr[i + 1]; k++) if (A.col[k] === i) d[i] = A.val[k]; return d; };

/** Largest eigenvalue of D⁻¹A by power iteration. */
function rhoDinvA(A: Csr, d: Float64Array, its = 15) {
  let x = new Float64Array(A.n).map((_, i) => 1 + ((i * 7919) % 13) / 13), y = new Float64Array(A.n), r = 1;
  for (let t = 0; t < its; t++) {
    spmv(A, x, y); let s = 0; for (let i = 0; i < A.n; i++) { y[i] /= d[i]; s += y[i] * y[i]; }
    r = Math.sqrt(s); const inv = 1 / (r || 1); for (let i = 0; i < A.n; i++) x[i] = y[i] * inv;
  }
  return r;
}

type Level = { A: Csr; d: Float64Array; P?: Csr; R?: Csr; L?: Float64Array /* dense Cholesky of the coarsest */ };

/**
 * Builds the hierarchy. `blk` gives the dofs of each node (fine level: 3 per node); B is the near-null space,
 * n × nb row-major (fine level: the six rigid-body modes).
 */
export function amgSetup(A0: Csr, nodeStart: Int32Array, B0: Float64Array, nb: number, coarse = 600, theta = 0.08): Level[] {
  const levels: Level[] = [];
  let A = A0, ns = nodeStart, B = B0, k = nb;
  for (;;) {
    const d = diagOf(A);
    if (A.n <= coarse || levels.length > 8) { levels.push({ A, d, L: cholesky(A) }); break; }
    const nNode = ns.length - 1;
    // node graph from the block pattern (any non-zero coupling counts)
    const nodeOf = new Int32Array(A.n);
    for (let v = 0; v < nNode; v++) for (let q = ns[v]; q < ns[v + 1]; q++) nodeOf[q] = v;
    // strong couplings: block Frobenius norm ‖A_vw‖ ≥ θ √(‖A_vv‖ ‖A_ww‖)
    const blk = new Float64Array(nNode), nbrs: number[][] = Array.from({ length: nNode }, () => []);
    const accN = new Float64Array(nNode), touched: number[] = [];
    const norms: Map<number, number>[] = [];
    for (let v = 0; v < nNode; v++) {
      touched.length = 0;
      for (let q = ns[v]; q < ns[v + 1]; q++) for (let t = A.ptr[q]; t < A.ptr[q + 1]; t++) { const w = nodeOf[A.col[t]]; if (accN[w] === 0) touched.push(w); accN[w] += A.val[t] * A.val[t] + 1e-300; }
      const mp = new Map<number, number>();
      for (const w of touched) { mp.set(w, Math.sqrt(accN[w])); accN[w] = 0; }
      blk[v] = mp.get(v) ?? 0; norms.push(mp);
    }
    for (let v = 0; v < nNode; v++) for (const [w, a] of norms[v]) if (w !== v && a >= theta * Math.sqrt(blk[v] * blk[w])) nbrs[v].push(w);
    // aggregation: (1) a node and all its neighbours when none is taken; (2) leftovers join a neighbouring aggregate
    const agg = new Int32Array(nNode).fill(-1); let na = 0;
    for (let v = 0; v < nNode; v++) { if (agg[v] >= 0 || nbrs[v].some((w) => agg[w] >= 0)) continue; agg[v] = na; for (const w of nbrs[v]) agg[w] = na; na++; }
    for (let v = 0; v < nNode; v++) if (agg[v] < 0) { for (const w of nbrs[v]) if (agg[w] >= 0) { agg[v] = agg[w]; break; } }
    for (let v = 0; v < nNode; v++) if (agg[v] < 0) agg[v] = na++;
    if (na >= nNode) { levels.push({ A, d, L: cholesky(A) }); break; } // no coarsening possible
    // tentative prolongator: per aggregate, Gram–Schmidt on its rows of B (columns with nothing left are dropped)
    const members: number[][] = Array.from({ length: na }, () => []);
    for (let v = 0; v < nNode; v++) for (let q = ns[v]; q < ns[v + 1]; q++) members[agg[v]].push(q);
    const tRow: number[][] = Array.from({ length: A.n }, () => []), tVal: number[][] = Array.from({ length: A.n }, () => []);
    const Bc: number[] = [], nsC = [0];
    let nc = 0;
    for (let a = 0; a < na; a++) {
      const rows = members[a], r = rows.length;
      const Q: Float64Array[] = []; const Rm: number[][] = [];
      for (let c = 0; c < k; c++) {
        const v = new Float64Array(r); for (let i = 0; i < r; i++) v[i] = B[rows[i] * k + c];
        const rc = new Array(k).fill(0);
        for (let s = 0; s < Q.length; s++) { let dot = 0; for (let i = 0; i < r; i++) dot += Q[s][i] * v[i]; rc[s] = dot; for (let i = 0; i < r; i++) v[i] -= dot * Q[s][i]; }
        let nrm = 0; for (let i = 0; i < r; i++) nrm += v[i] * v[i]; nrm = Math.sqrt(nrm);
        let orig = 0; for (let i = 0; i < r; i++) orig += B[rows[i] * k + c] ** 2;
        if (nrm > 1e-8 * Math.sqrt(orig) && nrm > 1e-14) { for (let i = 0; i < r; i++) v[i] /= nrm; rc[Q.length] = nrm; Q.push(v); }
        Rm.push(rc);
      }
      const nq = Q.length;
      for (let s = 0; s < nq; s++) { for (let i = 0; i < r; i++) { tRow[rows[i]].push(nc + s); tVal[rows[i]].push(Q[s][i]); } }
      // coarse near-null space: R (nq × k), row s, column c
      for (let s = 0; s < nq; s++) for (let c = 0; c < k; c++) Bc.push(Rm[c][s] ?? 0);
      nc += nq; nsC.push(nc);
    }
    const tp = new Int32Array(A.n + 1); for (let i = 0; i < A.n; i++) tp[i + 1] = tp[i] + tRow[i].length;
    const T: Csr = { n: A.n, m: nc, ptr: tp, col: Int32Array.from(tRow.flat()), val: Float64Array.from(tVal.flat()) };
    // smoothed prolongator P = (I − ω D⁻¹ A) T
    const w = 4 / 3 / rhoDinvA(A, d);
    const AT = spgemm(A, T);
    const P = addScaled(T, AT, d, w);
    const R = transpose(P);
    const Ac = spgemm(R, spgemm(A, P));
    levels.push({ A, d, P, R });
    A = Ac; ns = Int32Array.from(nsC); B = Float64Array.from(Bc);
  }
  return levels;
}

/** T − ω D⁻¹ (A T), both with sorted-or-not patterns merged. */
function addScaled(T: Csr, AT: Csr, d: Float64Array, w: number): Csr {
  const ptr = new Int32Array(T.n + 1), cols: number[] = [], vals: number[] = [], acc = new Map<number, number>();
  for (let i = 0; i < T.n; i++) {
    acc.clear();
    for (let k = AT.ptr[i]; k < AT.ptr[i + 1]; k++) acc.set(AT.col[k], -w * AT.val[k] / d[i]);
    for (let k = T.ptr[i]; k < T.ptr[i + 1]; k++) acc.set(T.col[k], (acc.get(T.col[k]) ?? 0) + T.val[k]);
    for (const [j, v] of acc) if (v !== 0) { cols.push(j); vals.push(v); }
    ptr[i + 1] = cols.length;
  }
  return { n: T.n, m: T.m, ptr, col: Int32Array.from(cols), val: Float64Array.from(vals) };
}

function cholesky(A: Csr): Float64Array {
  const n = A.n, L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let k = A.ptr[i]; k < A.ptr[i + 1]; k++) L[i * n + A.col[k]] = A.val[k];
  for (let j = 0; j < n; j++) {
    let s = L[j * n + j]; for (let k = 0; k < j; k++) s -= L[j * n + k] ** 2;
    const djj = Math.sqrt(Math.max(s, 1e-30 * Math.abs(L[j * n + j]) + 1e-300)); L[j * n + j] = djj;
    for (let i = j + 1; i < n; i++) { let t = L[i * n + j]; for (let k = 0; k < j; k++) t -= L[i * n + k] * L[j * n + k]; L[i * n + j] = t / djj; }
  }
  return L;
}
function cholSolve(L: Float64Array, n: number, b: Float64Array, x: Float64Array) {
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i * n + k] * x[k]; x[i] = s / L[i * n + i]; }
  for (let i = n - 1; i >= 0; i--) { let s = x[i]; for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k]; x[i] = s / L[i * n + i]; }
}

function gs(A: Csr, d: Float64Array, b: Float64Array, x: Float64Array, forward: boolean) {
  const { ptr, col, val } = A, n = A.n;
  for (let t = 0; t < n; t++) {
    const i = forward ? t : n - 1 - t;
    let s = b[i]; for (let k = ptr[i]; k < ptr[i + 1]; k++) { const j = col[k]; if (j !== i) s -= val[k] * x[j]; }
    x[i] = s / d[i];
  }
}

/** One V-cycle: x ≈ A⁻¹ b on level l (x starts at zero). */
export function vcycle(L: Level[], l: number, b: Float64Array, x: Float64Array) {
  const lv = L[l];
  if (lv.L) { cholSolve(lv.L, lv.A.n, b, x); return; }
  x.fill(0);
  gs(lv.A, lv.d, b, x, true);
  const r = new Float64Array(lv.A.n); spmv(lv.A, x, r); for (let i = 0; i < r.length; i++) r[i] = b[i] - r[i];
  const rc = new Float64Array(lv.R!.n); spmv(lv.R!, r, rc);
  const xc = new Float64Array(rc.length); vcycle(L, l + 1, rc, xc);
  const e = new Float64Array(lv.A.n); spmv(lv.P!, xc, e); for (let i = 0; i < e.length; i++) x[i] += e[i];
  gs(lv.A, lv.d, b, x, false);
}

/** Preconditioned conjugate gradients; yields the relative residual after each iteration. */
export function* pcg(A: Csr, b: Float64Array, L: Level[], tol = 1e-8, maxIt = 400): Generator<{ it: number; res: number }, { x: Float64Array; it: number; res: number }, unknown> {
  const n = A.n, x = new Float64Array(n), r = b.slice(), z = new Float64Array(n), q = new Float64Array(n);
  let bn = 0; for (let i = 0; i < n; i++) bn += b[i] * b[i]; bn = Math.sqrt(bn) || 1;
  vcycle(L, 0, r, z);
  const p = z.slice(); let rz = 0; for (let i = 0; i < n; i++) rz += r[i] * z[i];
  let it = 0, res = 1;
  for (; it < maxIt; it++) {
    spmv(A, p, q); let pq = 0; for (let i = 0; i < n; i++) pq += p[i] * q[i];
    const a = rz / pq; let rr = 0;
    for (let i = 0; i < n; i++) { x[i] += a * p[i]; r[i] -= a * q[i]; rr += r[i] * r[i]; }
    res = Math.sqrt(rr) / bn;
    yield { it: it + 1, res };
    if (res < tol) { it++; break; }
    vcycle(L, 0, r, z);
    let rz2 = 0; for (let i = 0; i < n; i++) rz2 += r[i] * z[i];
    const beta = rz2 / rz; rz = rz2;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
  }
  return { x, it, res };
}
