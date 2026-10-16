"""Builds src/core/nuclear/shieldTables.ts: photon interaction data and point-isotropic dose buildup factors for
gamma shielding (lead, steel, ordinary concrete, water) and mass energy-absorption coefficients of water and air.

Cross sections: Elam et al. tables via xraydb up to 800 keV (photoelectric, incoherent, coherent). Above 800 keV
the incoherent part is Klein-Nishina scaled to match the tables at 800 keV, the photoelectric part is extrapolated
as a power law whose exponent relaxes from the 600-800 keV slope toward 1/E, coherent as E^-2; pair production is ignored (below 1.5 MeV it is < 1 % of
the total in lead, less in lighter materials). Energy absorption (water, air): Klein-Nishina energy-transfer + photoelectric; bremsstrahlung and
fluorescence escape are neglected.

Buildup factors: our own Monte Carlo, point isotropic source in an infinite medium, Klein-Nishina scattering with
survival biasing, coherent scattering, fluorescence and bremsstrahlung ignored; response = absorbed dose in water.
Scores the collided dose with a track-length estimator in spherical shells, geometric splitting every mean free
path outward; B = 1 + collided/uncollided, tabulated to 10 mfp (reproduces the classic point-isotropic values for
water, iron and lead at 1 MeV within about 5 %).

Needs: pip install xraydb numpy. Run: python3 scripts/build-shield-tables.py  (a few minutes)
"""
import json, numpy as np, xraydb, warnings
warnings.filterwarnings('ignore')
rng = np.random.default_rng(20261004)

NA, RE = 6.02214076e23, 2.8179403262e-13  # 1/mol, classical electron radius [cm]
MC2 = 510.99895  # keV
EGRID = np.geomspace(20, 3000, 64)  # keV, for the attenuation tables in the app

MATERIALS = {  # mass fractions; density g/cm³ (NIST compositions; steel taken as iron)
    'lead': ({'Pb': 1.0}, 11.35),
    'steel': ({'Fe': 1.0}, 7.874),
    'concrete': ({'H': 0.0221, 'C': 0.002484, 'O': 0.57493, 'Na': 0.015208, 'Mg': 0.001266, 'Al': 0.019953, 'Si': 0.304627,
                  'K': 0.010045, 'Ca': 0.042951, 'Fe': 0.006435}, 2.30),
    'water': ({'H': 0.111894, 'O': 0.888106}, 1.0),
    'air': ({'C': 0.000124, 'N': 0.755268, 'O': 0.231781, 'Ar': 0.012827}, 0.001205),
}

def kn_sigma(E):
    """Klein-Nishina total and energy-transfer cross sections per electron [cm²]."""
    k = np.asarray(E, float) / MC2
    a = (1 + k) / k**2 * (2 * (1 + k) / (1 + 2 * k) - np.log(1 + 2 * k) / k)
    b = np.log(1 + 2 * k) / (2 * k) - (1 + 3 * k) / (1 + 2 * k) ** 2
    s = 2 * np.pi * RE**2 * (a + b)
    # energy-transfer part (Evans): σ_tr = σ - σ_s
    ss = np.pi * RE**2 * (np.log(1 + 2 * k) / k**3 + 2 * (1 + k) * (2 * k**2 - 2 * k - 1) / (k**2 * (1 + 2 * k) ** 2) + 8 * k**2 / (3 * (1 + 2 * k) ** 3))
    return s, s - ss

def element(el, E):
    """photo, incoherent, coherent mass coefficients [cm²/g] at E [keV], extended above 800 keV."""
    E = np.asarray(E, float); lo = np.minimum(E, 800)
    ph = xraydb.mu_elam(el, lo * 1e3, kind='photo'); inc = xraydb.mu_elam(el, lo * 1e3, kind='incoh'); coh = xraydb.mu_elam(el, lo * 1e3, kind='coh')
    Z = xraydb.atomic_number(el); A = xraydb.atomic_mass(el)
    kn = lambda e: Z / A * NA * kn_sigma(e)[0]
    hi = E > 800
    if hi.any():
        # photoelectric: local log-log slope n₈ at 800 keV relaxing toward the high-energy 1/E law,
        # n(E) = 1 + (n₈ − 1)(800/E)^0.8, integrated from 800 keV
        p6, p8 = xraydb.mu_elam(el, 6e5, kind='photo'), xraydb.mu_elam(el, 8e5, kind='photo')
        n8 = -np.log(p8 / p6) / np.log(8 / 6)
        lnE = np.log(np.maximum(E, 800) / 800)
        # ∫ n(E)/E dE = ln(E/800) + (n₈ − 1)/0.8·(1 − (800/E)^0.8)
        ph = np.where(hi, p8 * np.exp(-(lnE + (n8 - 1) / 0.8 * (1 - (800 / np.maximum(E, 800)) ** 0.8))), ph)
        inc = np.where(hi, kn(E) * xraydb.mu_elam(el, 8e5, kind='incoh') / kn(800.0), inc)
        coh = np.where(hi, xraydb.mu_elam(el, 8e5, kind='coh') * (800 / E) ** 2, coh)
    # energy-transfer: Compton part with the same binding correction as incoherent
    ktr = Z / A * NA * kn_sigma(E)[1] * inc / kn(E)
    return ph, inc, coh, ktr

def material(name, E):
    comp, rho = MATERIALS[name]
    ph = inc = coh = ktr = 0
    for el, w in comp.items():
        p, i, c, t = element(el, E); ph = ph + w * p; inc = inc + w * i; coh = coh + w * c; ktr = ktr + w * t
    return dict(photo=ph, incoh=inc, coh=coh, tot=ph + inc + coh, mu=ph + inc, men=ph + ktr, rho=rho)

# ---------------- Monte Carlo buildup ----------------
MFP = np.array([0, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], float)  # beyond 10 mfp the app extrapolates (Berger form)
E0S = np.array([60, 100, 150, 200, 300, 400, 500, 662, 800, 1000, 1250, 1500], float)

def sample_kn(E):
    """Klein-Nishina sampling (Geant4 method). Returns scattered energy and cos θ."""
    k = E / MC2; e0 = 1 / (1 + 2 * k); a1 = -np.log(e0); a2 = (1 - e0**2) / 2
    eps = np.empty_like(E); todo = np.ones(len(E), bool)
    while todo.any():
        idx = np.nonzero(todo)[0]; r1, r2, r3 = rng.random((3, len(idx)))
        first = r1 < a1[idx] / (a1[idx] + a2[idx])
        ep = np.where(first, np.exp(-a1[idx] * r2), np.sqrt(e0[idx] ** 2 + (1 - e0[idx] ** 2) * r2))
        oc = (1 - ep) / (ep * k[idx]); s2 = oc * (2 - oc); g = 1 - ep * s2 / (1 + ep**2)
        ok = g >= r3; eps[idx[ok]] = ep[ok]; todo[idx[ok]] = False
    oc = (1 - eps) / (eps * k)
    return eps * E, 1 - oc

def rotate(d, cost):
    phi = 2 * np.pi * rng.random(len(d)); sint = np.sqrt(np.maximum(0, 1 - cost**2))
    # orthonormal basis around d
    a = np.where(np.abs(d[:, 2:3]) < 0.9, np.array([[0, 0, 1.0]]), np.array([[1.0, 0, 0]]))
    u = np.cross(d, a); u /= np.linalg.norm(u, axis=1)[:, None]; v = np.cross(d, u)
    nd = cost[:, None] * d + sint[:, None] * (np.cos(phi)[:, None] * u + np.sin(phi)[:, None] * v)
    return nd / np.linalg.norm(nd, axis=1)[:, None]

def in_sphere(p, d, L, R):
    """Length of segments p + t d, 0 ≤ t ≤ L, inside spheres of radii R (broadcast: segments × radii)."""
    b = np.einsum('ij,ij->i', p, d)[:, None]; c = np.einsum('ij,ij->i', p, p)[:, None]
    disc = b * b - c + R[None, :] ** 2
    sq = np.sqrt(np.maximum(disc, 0)); t0 = np.maximum(-b - sq, 0); t1 = np.minimum(-b + sq, L[:, None])
    return np.where(disc > 0, np.maximum(t1 - t0, 0), 0)

def buildup(name, E0, n=100000, batch=50000):
    egrid = np.geomspace(5, 3000, 400); m = material(name, egrid); w_ = material('water', egrid)
    mu = lambda e: np.interp(np.log(e), np.log(egrid), m['mu']) * m['rho']           # 1/cm, no coherent
    pinc = lambda e: np.interp(np.log(e), np.log(egrid), m['incoh'] / m['mu'])          # scatter probability
    men = lambda e: np.interp(np.log(e), np.log(egrid), w_['men'])                       # water response
    mu0 = mu(np.array([E0]))[0]; R = np.arange(0.25, 12.0001, 0.25) / mu0; R0 = np.concatenate([[0], R])
    score = np.zeros(len(R))
    imp = lambda q: np.floor(np.linalg.norm(q, axis=1) * mu0).clip(0, 12)   # importance 2^k, k = r in mfp of the source energy
    for _ in range(n // batch):
        N = batch; p = np.zeros((N, 3)); d = rotate(np.tile([[0, 0, 1.0]], (N, 1)), 2 * rng.random(N) - 1)
        E = np.full(N, E0); w = np.ones(N); collided = np.zeros(N, bool); k = np.zeros(N)
        while len(E):
            s = -np.log(rng.random(len(E))) / mu(E)
            # score the flight of photons that have already scattered (uncollided part is analytic)
            if collided.any():
                j = collided; inside = in_sphere(p[j], d[j], s[j], R0)
                score += (np.diff(inside, axis=1) * (w[j] * E[j] * men(E[j]))[:, None]).sum(0)
            p = p + s[:, None] * d
            # collision: survive as a scatter with weight × σ_incoh/σ
            w = w * pinc(E); E, cost = sample_kn(E); d = rotate(d, cost); collided[:] = True
            # geometric splitting outward / roulette inward (importance doubles every 2 mfp of the source energy)
            k2 = imp(p); ratio = 2.0 ** (k2 - k)
            keep = (ratio >= 1) | (rng.random(len(E)) < ratio)
            w = np.where(ratio < 1, w / ratio, w)
            ncopy = np.where(ratio > 1, ratio, 1).astype(int) * keep
            w = w / np.maximum(np.where(ratio > 1, ratio, 1), 1)
            rep = lambda a: np.repeat(a, ncopy, axis=0)
            p, d, E, w, collided, k = rep(p), rep(d), rep(E), rep(w), rep(collided), rep(k2)
            # population control: above 400 000 tracks play roulette with survival ½ (weight × 2)
            if len(E) > 400000:
                sv = rng.random(len(E)) < 0.5; w = np.where(sv, w * 2, w)
                p, d, E, w, collided, k = p[sv], d[sv], E[sv], w[sv], collided[sv], k[sv]
            # cut-offs: energy, distance, weight roulette
            far = np.linalg.norm(p, axis=1) > R[-1] * 1.4
            rr = w < 1e-4 * 2.0 ** (-k); surv = rng.random(len(E)) < 0.1
            w = np.where(rr & surv, w * 10, w)
            ok = ~((E < 10) | far | (rr & ~surv))
            p, d, E, w, collided, k = p[ok], d[ok], E[ok], w[ok], collided[ok], k[ok]
    V = 4 / 3 * np.pi * (R0[1:] ** 3 - R0[:-1] ** 3)
    coll = score / n / V  # fluence = track length / volume, per source photon
    # shell average of the uncollided dose per source photon: ∫ e^(−μr)/(4πr²)·4πr² dr / V; the collided score is also per photon,
    # with fluence = track length / V (the 4π of the point source is in both)
    unc = E0 * men(np.array([E0]))[0] * (np.exp(-mu0 * R0[:-1]) - np.exp(-mu0 * R0[1:])) / (mu0 * V)
    B = 1 + coll / unc
    mid = (R0[1:] + R0[:-1]) / 2 * mu0
    return np.concatenate([[1.0], np.interp(MFP[1:], mid, B)])

SLAB_X = np.array([0, 0.5, 1, 2, 3, 5, 7, 10], float)

def slab_buildup(name, E0, n=40000, batch=40000):
    """Dose buildup behind a slab of x mfp for a broad parallel beam at normal incidence (detector at the back face,
    nothing behind the slab): a pencil beam scored by the energy flux leaving the back face (w·E·μen/cos θ)."""
    egrid = np.geomspace(5, 3000, 400); m = material(name, egrid); w_ = material('water', egrid)
    mu = lambda e: np.interp(np.log(e), np.log(egrid), m['mu']) * m['rho']
    pinc = lambda e: np.interp(np.log(e), np.log(egrid), m['incoh'] / m['mu'])
    men = lambda e: np.interp(np.log(e), np.log(egrid), w_['men'])
    mu0 = mu(np.array([E0]))[0]; out = [1.0]
    for X in SLAB_X[1:]:
        L = X / mu0; score = 0.0
        for _ in range(n // batch):
            N = batch; z = np.zeros(N); cz = np.ones(N); E = np.full(N, E0); w = np.ones(N); k = np.zeros(N); first = np.ones(N, bool)
            while len(E):
                s = -np.log(rng.random(len(E))) / mu(E); z2 = z + s * cz
                ex = z2 >= L; back = z2 <= 0
                # scattered photons leaving through the back face are scored (the uncollided beam is analytic)
                sc = ex & ~first
                if sc.any(): score += (w[sc] * E[sc] * men(E[sc]) / np.maximum(cz[sc], 0.05)).sum()
                keep = ~(ex | back)
                z, cz, E, w, k, first = z2[keep], cz[keep], E[keep], w[keep], k[keep], first[keep]
                if not len(E): break
                # scatter: survival biasing, Klein-Nishina angle, new direction cosine to the slab normal
                w = w * pinc(E); E2, cost = sample_kn(E); phi = 2 * np.pi * rng.random(len(E))
                st, sp = np.sqrt(np.maximum(0, 1 - cost**2)), np.sqrt(np.maximum(0, 1 - cz**2))
                cz = np.clip(cz * cost + sp * st * np.cos(phi), -1, 1); E = E2; first[:] = False
                # splitting toward the back face (importance doubles every mfp of depth), population cap
                k2 = np.floor(z * mu0).clip(0, 12); ratio = 2.0 ** (k2 - k)
                kp = (ratio >= 1) | (rng.random(len(E)) < ratio); w = np.where(ratio < 1, w / ratio, w)
                nc = np.where(ratio > 1, ratio, 1).astype(int) * kp; w = w / np.maximum(np.where(ratio > 1, ratio, 1), 1)
                rep = lambda a: np.repeat(a, nc)
                z, cz, E, w, first, k = rep(z), rep(cz), rep(E), rep(w), rep(first), rep(k2)
                if len(E) > 400000:
                    sv = rng.random(len(E)) < 0.5; w = np.where(sv, w * 2, w); z, cz, E, w, first, k = z[sv], cz[sv], E[sv], w[sv], first[sv], k[sv]
                rr = w < 1e-4 * 2.0 ** (-k); su = rng.random(len(E)) < 0.1; w = np.where(rr & su, w * 10, w)
                ok = ~((E < 10) | (rr & ~su)); z, cz, E, w, first, k = z[ok], cz[ok], E[ok], w[ok], first[ok], k[ok]
        unc = np.exp(-mu0 * L) * E0 * men(np.array([E0]))[0]
        out.append(1 + score / n / unc)
    return out

def berger_fit(mfp, B):
    """Least-squares (relative) fit of B = 1 + a·x·e^(b·x) to the Monte Carlo points; returns (a, b)."""
    from scipy.optimize import least_squares
    x = np.asarray(mfp[1:], float); y = np.asarray(B[1:], float)
    res = least_squares(lambda q: np.log((1 + q[0] * x * np.exp(q[1] * x)) / y), x0=[max(y[2] - 1, 0.01), 0.0], bounds=([0, -1], [100, 1]))
    return [round(float(res.x[0]), 5), round(float(res.x[1]), 5)]

def add_fits(out):
    for m in out['materials'].values():
        if 'B' in m: m['fit'] = [berger_fit(out['mfp'], B) for B in m['B']]
        if 'Bs' in m: m['fitSlab'] = [berger_fit(out['slabX'], B) for B in m['Bs']]

def write_ts(out):
    ts = '/** GENERATED by scripts/build-shield-tables.py — do not edit by hand. Photon data (Elam/xraydb, Klein-Nishina above 800 keV) and our Monte Carlo point-isotropic dose buildup factors with Berger fits. */\n'
    ts += 'export const SHIELD_DATA = ' + json.dumps(out, separators=(',', ':')) + ' as const;\n'
    open('src/core/nuclear/shieldTables.ts', 'w').write(ts)

if __name__ == '__main__':
    import sys
    if '--fit-only' in sys.argv:   # refit the Berger form on an existing table
        src = open('src/core/nuclear/shieldTables.ts').read()
        out = json.loads(src[src.index('= ') + 2:src.rindex(' as const')]); add_fits(out); write_ts(out); sys.exit()
    out = {'E': [round(e, 3) for e in EGRID], 'mfp': MFP.tolist(), 'slabX': SLAB_X.tolist(), 'E0': E0S.tolist(), 'materials': {}}
    import os
    cache_path = os.environ.get('SHIELD_CACHE', 'shield-cache.json')
    cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {}
    for name in MATERIALS:
        m = material(name, EGRID)
        entry = {'rho': m['rho'], 'mu': [float(f'{x:.5g}') for x in m['mu']], 'muCoh': [float(f'{x:.5g}') for x in m['coh']], 'men': [float(f'{x:.5g}') for x in m['men']]}
        if name != 'air':
            entry['B'] = []
            for E0 in E0S:
                key = f'{name}:{E0:g}'
                if key not in cache:   # results are cached so an interrupted run can resume
                    cache[key] = [round(float(b), 3) for b in buildup(name, E0, n=400000 if name == 'lead' else 100000)]  # lead is cheap: more histories
                    json.dump(cache, open(cache_path, 'w'))
                entry['B'].append(cache[key]); print(name, E0, cache[key][2::3], flush=True)
            entry['Bs'] = []
            for E0 in E0S:
                key = f'slab:{name}:{E0:g}'
                if key not in cache:
                    cache[key] = [round(float(b), 3) for b in slab_buildup(name, E0)]
                    json.dump(cache, open(cache_path, 'w'))
                entry['Bs'].append(cache[key]); print('slab', name, E0, cache[key][2::2], flush=True)
        out['materials'][name] = entry
    add_fits(out); write_ts(out)
