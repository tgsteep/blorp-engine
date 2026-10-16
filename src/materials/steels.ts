/**
 * Steel grades and their near equivalents in other standards, typical composition and properties, weldability:
 * IIW carbon equivalent CEV, Seferian preheat, PREN for stainless steels; hardening data (Andrews critical
 * temperatures, Grossmann ideal critical diameter) are used by the heat-treatment tool.
 * Equivalents are the usual cross-references — close, not identical; always check the standards.
 */
export type Family = 'structural' | 'carbon' | 'case' | 'qt' | 'tool' | 'stainless';
export const FAMILIES: Record<Family, string> = {
  structural: 'Structural', carbon: 'Carbon', case: 'Case-hardening', qt: 'Quench and temper', tool: 'Tool and bearing', stainless: 'Stainless',
};
export type Comp = { C: number; Si: number; Mn: number; Cr: number; Mo: number; Ni: number; V: number; W?: number; N?: number; S?: number; Pb?: number };
export type Grade = {
  en: string; wnr: string; aisi: string; jis: string; gb: string; family: Family;
  comp: Comp;            // typical (mid-range) mass %
  Rm: number; Re: number; A: number; cond: string;  // typical properties in the stated condition [MPa, MPa, %]
  use: string;
};

const c = (C: number, Mn: number, o: Partial<Comp> = {}): Comp => ({ C, Si: 0.25, Mn, Cr: 0, Mo: 0, Ni: 0, V: 0, ...o });
export const GRADES: Grade[] = [
  { en: 'S235JR', wnr: '1.0038', aisi: 'A36 (ASTM)', jis: 'SS400', gb: 'Q235B', family: 'structural', comp: c(0.15, 0.8, { Si: 0.2 }), Rm: 430, Re: 235, A: 26, cond: 'hot rolled', use: 'General steelwork, frames, brackets' },
  { en: 'S355J2', wnr: '1.0577', aisi: 'A572 Gr. 50 (ASTM)', jis: 'SM490A', gb: 'Q355B', family: 'structural', comp: c(0.18, 1.4, { Si: 0.3 }), Rm: 510, Re: 355, A: 22, cond: 'hot rolled', use: 'Bridges, cranes, heavier structures' },
  { en: 'C22E', wnr: '1.1151', aisi: '1020', jis: 'S20C', gb: '20', family: 'carbon', comp: c(0.22, 0.55), Rm: 430, Re: 240, A: 24, cond: 'normalised', use: 'Lightly loaded machine parts, case-hardened pins' },
  { en: 'C45E', wnr: '1.1191', aisi: '1045', jis: 'S45C', gb: '45', family: 'carbon', comp: c(0.45, 0.65), Rm: 650, Re: 370, A: 16, cond: 'normalised', use: 'Shafts, gears, bolts, flame-hardened parts' },
  { en: 'C60E', wnr: '1.1221', aisi: '1060', jis: 'S58C', gb: '60', family: 'carbon', comp: c(0.6, 0.75), Rm: 710, Re: 380, A: 13, cond: 'normalised', use: 'Springs, wear parts, rails' },
  { en: '11SMnPb30', wnr: '1.0718', aisi: '12L14', jis: 'SUM24L', gb: 'Y15Pb', family: 'carbon', comp: c(0.11, 1.1, { Si: 0.03, S: 0.3, Pb: 0.25 }), Rm: 460, Re: 300, A: 12, cond: 'cold drawn', use: 'Free-machining turned parts (not for welding)' },
  { en: '16MnCr5', wnr: '1.7131', aisi: '5115', jis: 'SCr415', gb: '15CrMn', family: 'case', comp: c(0.16, 1.15, { Cr: 0.95 }), Rm: 900, Re: 600, A: 10, cond: 'case-hardened core', use: 'Gears, shafts, cams with a hard case' },
  { en: '20MnCr5', wnr: '1.7147', aisi: '5120', jis: 'SMnC420', gb: '20CrMn', family: 'case', comp: c(0.2, 1.25, { Cr: 1.15 }), Rm: 1100, Re: 750, A: 9, cond: 'case-hardened core', use: 'Gears and pinions of medium size' },
  { en: '18CrNiMo7-6', wnr: '1.6587', aisi: '4820 (approx.)', jis: 'SNCM815 (approx.)', gb: '17Cr2Ni2Mo', family: 'case', comp: c(0.18, 0.7, { Cr: 1.65, Mo: 0.3, Ni: 1.55 }), Rm: 1200, Re: 850, A: 8, cond: 'case-hardened core', use: 'Heavily loaded large gears' },
  { en: '41Cr4', wnr: '1.7035', aisi: '5140', jis: 'SCr440', gb: '40Cr', family: 'qt', comp: c(0.41, 0.75, { Cr: 1.05 }), Rm: 900, Re: 660, A: 12, cond: 'quenched and tempered', use: 'Axles, shafts, connecting rods' },
  { en: '25CrMo4', wnr: '1.7218', aisi: '4130', jis: 'SCM430', gb: '30CrMo', family: 'qt', comp: c(0.25, 0.75, { Cr: 1.05, Mo: 0.22 }), Rm: 800, Re: 600, A: 14, cond: 'quenched and tempered', use: 'Weldable tubes, pressure parts, frames' },
  { en: '42CrMo4', wnr: '1.7225', aisi: '4140', jis: 'SCM440', gb: '42CrMo', family: 'qt', comp: c(0.42, 0.75, { Cr: 1.05, Mo: 0.22 }), Rm: 1000, Re: 750, A: 11, cond: 'quenched and tempered', use: 'Highly loaded shafts, bolts, gears' },
  { en: '34CrNiMo6', wnr: '1.6582', aisi: '4340', jis: 'SNCM447', gb: '40CrNiMoA', family: 'qt', comp: c(0.34, 0.65, { Cr: 1.5, Mo: 0.22, Ni: 1.5 }), Rm: 1100, Re: 900, A: 10, cond: 'quenched and tempered', use: 'Large shafts and forgings that must harden through' },
  { en: '51CrV4', wnr: '1.8159', aisi: '6150', jis: 'SUP10', gb: '50CrVA', family: 'qt', comp: c(0.51, 0.9, { Cr: 1.05, V: 0.15 }), Rm: 1300, Re: 1150, A: 7, cond: 'quenched and tempered', use: 'Springs, torsion bars' },
  { en: '100Cr6', wnr: '1.3505', aisi: '52100', jis: 'SUJ2', gb: 'GCr15', family: 'tool', comp: c(1.0, 0.35, { Cr: 1.45 }), Rm: 650, Re: 410, A: 20, cond: 'soft annealed (hardened 60–64 HRC)', use: 'Rolling bearings, gauges' },
  { en: '90MnCrV8', wnr: '1.2842', aisi: 'O2', jis: '—', gb: '9Mn2V', family: 'tool', comp: c(0.9, 2.0, { Cr: 0.35, V: 0.1 }), Rm: 750, Re: 450, A: 15, cond: 'soft annealed (hardened 60–64 HRC)', use: 'Cutting and gauge tools, oil hardening' },
  { en: 'X153CrMoV12', wnr: '1.2379', aisi: 'D2', jis: 'SKD11', gb: 'Cr12Mo1V1', family: 'tool', comp: c(1.53, 0.35, { Si: 0.3, Cr: 12, Mo: 0.8, V: 0.85 }), Rm: 850, Re: 500, A: 10, cond: 'soft annealed (hardened 58–62 HRC)', use: 'Cold-work dies, punches, shear blades' },
  { en: 'X40CrMoV5-1', wnr: '1.2344', aisi: 'H13', jis: 'SKD61', gb: '4Cr5MoSiV1', family: 'tool', comp: c(0.4, 0.4, { Si: 1.0, Cr: 5.2, Mo: 1.3, V: 1.0 }), Rm: 780, Re: 450, A: 15, cond: 'soft annealed (hardened 48–54 HRC)', use: 'Hot-work dies, die-casting moulds' },
  { en: 'HS6-5-2', wnr: '1.3343', aisi: 'M2', jis: 'SKH51', gb: 'W6Mo5Cr4V2', family: 'tool', comp: c(0.9, 0.3, { Cr: 4.1, Mo: 5.0, V: 1.9, W: 6.4 }), Rm: 900, Re: 600, A: 8, cond: 'soft annealed (hardened 63–65 HRC)', use: 'Drills, taps, milling cutters' },
  { en: 'X5CrNi18-10', wnr: '1.4301', aisi: '304', jis: 'SUS304', gb: '06Cr19Ni10', family: 'stainless', comp: c(0.04, 1.5, { Si: 0.5, Cr: 18.2, Ni: 8.5, N: 0.05 }), Rm: 600, Re: 230, A: 45, cond: 'solution annealed', use: 'Food, kitchen, architecture, tanks' },
  { en: 'X2CrNiMo17-12-2', wnr: '1.4404', aisi: '316L', jis: 'SUS316L', gb: '022Cr17Ni12Mo2', family: 'stainless', comp: c(0.02, 1.5, { Si: 0.5, Cr: 17.2, Ni: 11, Mo: 2.1, N: 0.05 }), Rm: 580, Re: 240, A: 40, cond: 'solution annealed', use: 'Chemical, marine, pharmaceutical' },
  { en: 'X6Cr17', wnr: '1.4016', aisi: '430', jis: 'SUS430', gb: '10Cr17', family: 'stainless', comp: c(0.05, 0.6, { Si: 0.5, Cr: 16.5 }), Rm: 480, Re: 280, A: 20, cond: 'annealed (ferritic)', use: 'Appliances, trim, indoor parts' },
  { en: 'X20Cr13', wnr: '1.4021', aisi: '420', jis: 'SUS420J1', gb: '20Cr13', family: 'stainless', comp: c(0.2, 0.6, { Si: 0.5, Cr: 13 }), Rm: 750, Re: 550, A: 13, cond: 'quenched and tempered (martensitic)', use: 'Pump shafts, valves, cutlery' },
  { en: 'X2CrNiMoN22-5-3', wnr: '1.4462', aisi: '2205 (S32205)', jis: 'SUS329J3L', gb: '022Cr23Ni5Mo3N', family: 'stainless', comp: c(0.02, 1.5, { Si: 0.5, Cr: 22.5, Ni: 5.5, Mo: 3.1, N: 0.17 }), Rm: 700, Re: 460, A: 25, cond: 'solution annealed (duplex)', use: 'Seawater, chemical tanks, offshore' },
];
export const gradeOf = (en: string) => GRADES.find((g) => g.en === en) ?? GRADES[0];

/** IIW carbon equivalent (EN 1011-2): CEV = C + Mn/6 + (Cr + Mo + V)/5 + (Ni + Cu)/15. */
export const cev = (x: Comp) => x.C + x.Mn / 6 + (x.Cr + x.Mo + x.V) / 5 + x.Ni / 15;
/** Seferian: chemical carbon equivalent and preheat T_p = 350 √([C]_t − 0.25) with [C]_t = [C](1 + 0.005 t). */
export const seferianC = (x: Comp) => x.C + (x.Mn + x.Cr) / 9 + x.Ni / 18 + (7 * x.Mo) / 90;
export const preheat = (x: Comp, tMm: number) => { const ct = seferianC(x) * (1 + 0.005 * tMm); return ct <= 0.25 ? 0 : 350 * Math.sqrt(ct - 0.25); };
/** Pitting resistance equivalent number PREN = Cr + 3.3 Mo + 16 N. */
export const pren = (x: Comp) => x.Cr + 3.3 * x.Mo + 16 * (x.N ?? 0);

export type SteelIn = { grade: string; t: number /* plate thickness [mm] */ };
export function steel(p: SteelIn) {
  const g = gradeOf(p.grade), x = g.comp, stainless = g.family === 'stainless';
  const CEV = cev(x), Cs = seferianC(x), Tp = preheat(x, p.t), PREN = pren(x);
  const free = (x.S ?? 0) > 0.1 || (x.Pb ?? 0) > 0;
  const checks = stainless
    ? [
      { ok: g.comp.C <= 0.08 || g.en === 'X6Cr17', label: 'Low carbon: welds without chromium-carbide sensitisation', detail: `C = ${x.C.toFixed(2)} %` },
      { ok: PREN >= 24, label: 'PREN ≥ 24 (resists pitting in chloride splash, e.g. coastal air)', detail: `PREN = ${PREN.toFixed(1)}; seawater needs about 40` },
    ]
    : [
      { ok: CEV <= 0.45, label: 'Weldable without special measures (CEV ≤ 0.45)', detail: `CEV = ${CEV.toFixed(3)}` },
      { ok: Tp <= 150, label: 'Preheat for this thickness at most 150 °C (practical in the workshop)', detail: `T_p = ${Tp.toFixed(0)} °C at t = ${p.t.toFixed(0)} mm (Seferian)` },
      { ok: !free, label: 'Not a free-machining grade (sulphur and lead make welds crack)', detail: free ? `S ${(x.S ?? 0).toFixed(2)} %, Pb ${(x.Pb ?? 0).toFixed(2)} %` : 'S and Pb low' },
    ];
  return { g, CEV, Cs, Tp, PREN, stainless, free, checks };
}
export type SteelResult = ReturnType<typeof steel>;

export const STEEL_INTRO = 'The same steel has different names in Europe, the USA, Japan and China: C45 is AISI 1045, S45C and grade 45. The names tell you roughly what is inside — C45 has 0.45 % carbon, 42CrMo4 about 0.42 % carbon with chromium and molybdenum. More carbon and alloy make a steel harder and stronger but harder to weld: the carbon equivalent sums them up and says when the plates must be preheated.';

export const STEEL_NOTES = [
  'Equivalents are the usual cross-references between EN 10025, EN 10083/10084/10085, EN ISO 683, EN ISO 4957, EN 10088 and the AISI/SAE (ASTM), JIS and GB designations. They are close, not identical: composition limits, delivery conditions and guaranteed properties differ — check the standards before substituting. Compositions are typical mid-range values and properties typical values in the stated condition.',
  'Weldability: IIW carbon equivalent CEV = C + Mn/6 + (Cr + Mo + V)/5 + (Ni + Cu)/15 (EN 1011-2); up to about 0.45 most steels weld without preheat at moderate thickness. Preheat after Seferian: [C] = C + (Mn + Cr)/9 + Ni/18 + 7Mo/90, [C]_t = [C](1 + 0.005 t), T_p = 350 √([C]_t − 0.25) °C. EN 1011-2 also counts hydrogen, heat input and restraint, which are not included.',
  'Stainless steels: pitting resistance PREN = Cr + 3.3 Mo + 16 N; austenitic grades weld without preheat, low carbon (≤ 0.03 %, "L" grades) avoids sensitisation in the heat-affected zone.',
];
