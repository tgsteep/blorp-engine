/**
 * Pressure relief valve sizing after API 520 Part I (SI form): gas/vapour (critical and subcritical flow),
 * saturated steam, and liquid (certified valves, with viscosity correction). Standard orifices from API 526.
 * Units: flow kg/h (gas, steam) or L/min (liquid), pressure kPa, temperature °C, area mm².
 */

export const P_ATM = 101.325; // kPa

/** API 526 standard effective orifice areas and typical inlet × outlet flange sizes. */
export const ORIFICES: { letter: string; area: number; inch: number; size: string }[] = [
  { letter: 'D', area: 71.0, inch: 0.110, size: '1 × 2"' },
  { letter: 'E', area: 126.5, inch: 0.196, size: '1 × 2"' },
  { letter: 'F', area: 198.1, inch: 0.307, size: '1½ × 2"' },
  { letter: 'G', area: 324.5, inch: 0.503, size: '1½ × 2½"' },
  { letter: 'H', area: 506.5, inch: 0.785, size: '1½ × 3"' },
  { letter: 'J', area: 830.3, inch: 1.287, size: '2 × 3"' },
  { letter: 'K', area: 1186, inch: 1.838, size: '3 × 4"' },
  { letter: 'L', area: 1841, inch: 2.853, size: '3 × 4"' },
  { letter: 'M', area: 2323, inch: 3.6, size: '4 × 6"' },
  { letter: 'N', area: 2800, inch: 4.34, size: '4 × 6"' },
  { letter: 'P', area: 4116, inch: 6.38, size: '4 × 6"' },
  { letter: 'Q', area: 7129, inch: 11.05, size: '6 × 8"' },
  { letter: 'R', area: 10323, inch: 16.0, size: '6 × 8"' },
  { letter: 'T', area: 16774, inch: 26.0, size: '8 × 10"' },
];

/** Smallest standard orifice with at least the required area (null if even T is too small). */
export const pickOrifice = (A: number) => ORIFICES.find((o) => o.area >= A) ?? null;

/** Gas coefficient C (SI) from the ratio of specific heats k: C = 0.03948·√(k·(2/(k+1))^((k+1)/(k−1))). */
export const gasC = (k: number) => 0.03948 * Math.sqrt(k * Math.pow(2 / (k + 1), (k + 1) / (k - 1)));
/** Critical pressure ratio P_cf/P1 = (2/(k+1))^(k/(k−1)). */
export const criticalRatio = (k: number) => Math.pow(2 / (k + 1), k / (k - 1));

export type Service = 'gas' | 'steam' | 'liquid';
export type ReliefIn = {
  service: Service;
  flow: number; // kg/h (gas, steam) or L/min (liquid)
  pSet: number; // set pressure, kPa gauge
  over: number; // allowable overpressure, fraction of set (0.10, 0.16, 0.21)
  pBack: number; // total back pressure, kPa gauge
  T: number; M: number; k: number; Z: number; // gas: relieving temperature °C, molar mass, cp/cv, compressibility
  G: number; mu: number; // liquid: specific gravity (water = 1), viscosity cP
  disk: boolean; // rupture disk upstream → K_c = 0.9
};

type Check = { ok: boolean; label: string; detail: string };

export function relief(c: ReliefIn) {
  const Kc = c.disk ? 0.9 : 1;
  const P1g = c.pSet * (1 + c.over); // relieving pressure, gauge
  const P1 = P1g + P_ATM, P2 = c.pBack + P_ATM; // absolute
  const backFrac = c.pSet > 0 ? c.pBack / c.pSet : 0;
  let A = 0, Kd = 0, regime = '', extra: Record<string, number> = {};
  const checks: Check[] = [];
  // the valve can only discharge while the back pressure is below the relieving pressure
  const noFlow = c.service !== 'steam' && c.pBack >= P1g;

  if (noFlow) {
    A = NaN; Kd = c.service === 'gas' ? 0.975 : 0.65;
    regime = 'no flow: back pressure ≥ relieving pressure';
  } else if (c.service === 'gas') {
    Kd = 0.975;
    const T = c.T + 273.15, r = P2 / P1, rc = criticalRatio(c.k);
    if (r <= rc) {
      const C = gasC(c.k);
      A = (c.flow / (C * Kd * P1 * 1 * Kc)) * Math.sqrt((T * c.Z) / c.M);
      regime = 'critical (choked) flow';
      extra = { C, rc, r };
    } else {
      const F2 = Math.sqrt((c.k / (c.k - 1)) * Math.pow(r, 2 / c.k) * ((1 - Math.pow(r, (c.k - 1) / c.k)) / (1 - r)));
      A = ((17.9 * c.flow) / (F2 * Kd * Kc)) * Math.sqrt((T * c.Z) / (c.M * P1 * (P1 - P2)));
      regime = 'subcritical flow';
      extra = { F2, rc, r };
    }
    checks.push({ ok: c.k > 1 && c.k < 1.7, label: 'Ratio of specific heats 1 < k < 1.7', detail: `k = ${c.k}` });
  } else if (c.service === 'steam') {
    Kd = 0.975;
    const KN = P1 <= 10339 ? 1 : (0.02764 * P1 - 1000) / (0.03324 * P1 - 1061);
    A = (190.5 * c.flow) / (P1 * Kd * 1 * Kc * KN * 1);
    regime = 'saturated steam (Napier)';
    extra = { KN };
    checks.push({ ok: P1 <= 22064, label: 'Below the critical pressure of water (22.06 MPa)', detail: `P₁ = ${(P1 / 1000).toFixed(2)} MPa abs` });
  } else {
    Kd = 0.65;
    const dp = P1g - c.pBack;
    const Ar = (11.78 * c.flow) / (Kd * 1 * Kc) * Math.sqrt(c.G / dp); // without viscosity correction
    // viscosity correction K_v from the Reynolds number in the selected orifice (API 520, one iteration on the next orifice)
    const o = pickOrifice(Ar) ?? ORIFICES[ORIFICES.length - 1];
    const Re = (c.flow * 18800 * c.G) / (c.mu * Math.sqrt(o.area));
    const Kv = Math.min(1, 1 / (0.9935 + 2.878 / Math.sqrt(Re) + 342.75 / Math.pow(Re, 1.5)));
    A = Ar / Kv;
    regime = 'liquid, certified valve';
    extra = { Ar, Re, Kv, dp };
    checks.push({ ok: Kv >= 0.6, label: 'Viscosity correction K_v ≥ 0.6 (viscous liquids need a larger valve)', detail: `Re = ${Re.toFixed(0)}, K_v = ${Kv.toFixed(3)}` });
  }

  const orifice = noFlow ? undefined : pickOrifice(A);
  const nValves = noFlow ? 0 : orifice ? 1 : Math.ceil(A / ORIFICES[ORIFICES.length - 1].area);
  if (noFlow) checks.unshift({ ok: false, label: 'Back pressure below the relieving pressure (otherwise the valve cannot discharge)', detail: `p_b = ${(c.pBack / 100).toFixed(2)} bar g ≥ P_1 = ${(P1g / 100).toFixed(2)} bar g` });
  else checks.unshift({ ok: !!orifice, label: 'Fits one standard orifice (largest: T = 16 774 mm²)', detail: orifice ? `${orifice.letter}: ${orifice.area} mm² ≥ ${A.toFixed(0)} mm² (${((A / orifice.area) * 100).toFixed(0)} % used)` : `need ${nValves} valves or a larger non-standard valve` });
  // fraction of the selected orifice's capacity that the required flow uses (flow ∝ area at the same conditions)
  const used = noFlow ? 0 : orifice ? A / orifice.area : 1;
  if (!noFlow) checks.push({ ok: used >= CHATTER_LIMIT, label: 'Required flow ≥ 25 % of valve capacity (rule of thumb: a much oversized valve chatters)', detail: `${(used * 100).toFixed(0)} % of capacity used` });
  checks.push({ ok: backFrac <= 0.1, label: 'Back pressure ≤ 10 % of set pressure (conventional valve; above that use a balanced bellows valve)', detail: `${(backFrac * 100).toFixed(1)} % of set` });
  checks.push({ ok: c.over <= 0.21 + 1e-9, label: 'Overpressure within API 521 limits (10 % single valve, 16 % multiple, 21 % fire)', detail: `${(c.over * 100).toFixed(0)} %` });

  return { A, Kd, Kc, P1, P1g, P2, regime, orifice, nValves, backFrac, used, noFlow, checks, ...extra };
}

/** Below this share of rated capacity a spring-loaded valve tends to open and slam shut repeatedly (chatter). */
export const CHATTER_LIMIT = 0.25;
/** Typical blowdown: the valve reseats at about 93 % of the set pressure. */
export const RESEAT = 0.93;
export type ReliefResult = ReturnType<typeof relief>;

export const RELIEF_INTRO =
  'A pressure relief valve is the last line of defence of a vessel or pipe. A spring holds the disc on the nozzle; when the pressure under the disc beats the spring at the set pressure, the valve pops open and relieves until the pressure drops, then reseats. Sizing finds the smallest standard orifice that passes the required flow at the allowed overpressure. The valve size steps with the API 526 letter; the dashed lines show how much of the bore the required flow needs. A valve far too big for the flow chatters — it slams open and shut.';

export const RELIEF_NOTES =
  'API 520 Part I sizing equations in SI units for spring-loaded relief valves: gas and vapour (critical flow when the back pressure is below the critical flow pressure, otherwise the subcritical equation with F₂), saturated steam (Napier equation with the high-pressure correction K_N; superheat correction K_SH not included — use the gas equation for superheated steam), liquid in certified valves (K_d = 0.65, viscosity correction K_v from the Reynolds number in the chosen orifice). ' +
  'Back-pressure correction K_b = 1 and K_w = 1 (conventional valve with back pressure ≤ 10 % of set); K_c = 0.9 with an upstream rupture disk. Relieving pressure = set pressure + overpressure; inlet pressure losses, two-phase flow and fire-case heat input are not calculated. Standard orifice areas from API 526. The chatter check (required flow ≥ 25 % of rated capacity) and the 7 % blowdown in the animation are common rules of thumb, not API 520 equations. This is a preliminary sizing aid — final selection uses the manufacturer’s certified data.';
