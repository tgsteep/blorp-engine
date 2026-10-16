# Blorp Engine

**The open calculation engine behind [Blorp](https://blorp.space), the free engineering toolbox.**

*[Türkçe açıklama aşağıda](#türkçe)*

Blorp is a free engineering app and website: gears, bearings, bolts, shafts, wind turbines, hydropower, pipe flow, heat exchangers, beams, footings, ship resistance, rocket engines, finite elements and much more — about a hundred tools in fifteen fields. Every result shows its equation with the user's own numbers and the standard it follows, with pass/fail checks.

This repository is the part that does the engineering: every calculation, every solver and every test that checks them. We publish it because we believe an engineering tool should not be a black box. If you use a number from Blorp in your work, you should be able to see exactly how it was computed — and prove us wrong if it is wrong.

## Our mission

**To make engineering open, understandable and verifiable for everyone.**

- **Always free** — no calculation tool will ever be paid. No ads, no account required.
- **No black boxes** — every result shows its equation with your numbers and the standard it follows; the code behind it is here.
- **Honest limits** — each tool says what it simplifies. Tools checked against published worked examples are marked *Validated*; the rest are *Concept*.
- **Always improving** — every reported mistake is read and fixed.

## What is inside

Pure TypeScript, **no dependencies**: no numerical libraries, no frameworks. Every model is written from the textbook or the standard and tested.

| Folder | Contents |
|---|---|
| `gears` | Spur gear geometry (ISO 21771, profile shift), helical, internal, rack, bevel, worm, planetary; simplified ISO 6336 pitting and root bending; design search |
| `bearings` | Rolling bearing life (ISO 281, a_ISO, 7 types), plain bushings, hydrodynamic journal bearings (Raimondi–Boyd) |
| `bolts` · `welds` · `shafts` · `springs` · `drives` | VDI 2230 (simplified) joints, EN 1993-1-8 fillet welds, shafts (DE-Goodman, critical speed), springs (EN 13906-1), belt and chain drives |
| `wind` | Blade-element momentum rotor (Ning 2014) on the NREL 5-MW reference blade, Weibull AEP; drivetrain, tower and foundation chain |
| `hydro` · `storage` · `solar` · `thermo` | Hydropower (ESHA guide), pumped storage, battery packs, PV yield (Duffie & Beckman), Otto/Diesel/Brayton/Rankine/refrigeration cycles, combined cycle and CHP |
| `fluids` · `hvac` | Pipe flow (Colebrook), pumps, heat exchangers (ε-NTU, LMTD), insulation; psychrometrics (ASHRAE), heating/cooling loads, U-values, ducts, heating pipes |
| `civil` · `mining` | Beams, columns, steel connections, reinforced concrete (EC2), footings and walls (Eurocode 7), settlement, slope stability (Bishop); blasting, mine ventilation, haulage |
| `fem` | **Tetrahedral finite elements**: own isosurface-stuffing mesher, quadratic T10 elements, smoothed-aggregation AMG solver |
| `manufacturing` | ISO 286 fits, cutting data, sheet bending, surface roughness (ISO 4287), FDM printing; voxel FEM of 3D-printed parts ply by ply |
| `marine` · `aero` | Ship stability (IMO 2008), resistance (Holtrop–Mennen), Wageningen B-series propellers; rocket equation, liquid rocket engines, orbits, wings, propellers |
| `electrical` · `control` | Circuits and a nodal-analysis circuit solver, motors, cables (IEC 60364-5-52), transformers, PCB traces; PID loops, servo sizing, steppers |
| `chemical` · `environment` · `nuclear` · `materials` | Tanks, control and relief valves, distillation, reactors, gas mixtures; stack dispersion, combustion, water and wastewater treatment; decay, shielding, reactor kinetics, fusion; tensile tests, hardness, steels, heat treatment, corrosion |
| `units` · `workshop` | SI ↔ US units, unit converter, metal weights, bolt torques, reference tables |
| `tools/` | Scripts that generate the built-in data tables from their public sources |

Around **500 tests**, including about **50 `VALIDATION` tests** that reproduce published worked examples — from Gere & Goodno, Das, Shigley, Çengel, Incropera, Holtrop & Mennen, Vallado, the ESHA guide, ISO 286, ISO 18265, VDI 2230, NREL and others. A test named `VALIDATION (source)` reproduces that source's numbers; every other test is a hand calculation or a consistency check.

## Use it

Needs Node.js 22.18 or newer (it runs TypeScript directly).

```bash
git clone https://github.com/tgsteep/blorp-engine
cd blorp-engine
npm test
```

```ts
import { computeSpur } from './src/gears/spur.ts';

const r = computeSpur({ m: 3, z1: 18, z2: 45, alphaDeg: 20, x1: 0, x2: 0, n1: 1450, T1: 50 });
console.log(r.aw, r.epsAlpha, r.Ft); // 94.5 mm centre distance, contact ratio 1.633, 1852 N tangential force
```

All quantities are SI (lengths in the unit stated next to each input, usually mm or m). Each model states its simplifications in its comments; read them before trusting a number.

## Please check our work

These are simplified models for learning and estimates. **Check every result against the governing standard before using it in a design.** We would rather hear about a mistake than hide one:

- Found a wrong formula, sign or unit? [Open an issue](https://github.com/tgsteep/blorp-engine/issues) with the source that shows the correct form.
- Know a published worked example for a tool that is still *Concept*? That is the most valuable contribution of all — it becomes a `VALIDATION` test.
- Want to improve a model or add one? See [CONTRIBUTING.md](CONTRIBUTING.md). **Our door is open.**

## Licence

Copyright © 2026 TOLYA. Released under the **GNU Affero General Public License v3.0** ([LICENSE](LICENSE)): you may use, study, change and share this code, and if you distribute it or run a changed version as a service, you must publish your source under the same licence. For other licensing, write to info@tolya.com.tr.

The engine is open; the Blorp app and website — their 3D views, drawings, interface, design, texts and the Blorp name and logo — are not part of this licence. Third-party data used by the engine is listed in [NOTICE](NOTICE).

---

## Türkçe

**Blorp Engine, ücretsiz mühendislik çantası [Blorp](https://blorp.space)'un açık hesap motorudur.**

Blorp ücretsiz bir mühendislik uygulaması ve web sitesidir. On beş alanda yaklaşık yüz araç içerir: dişliler, rulmanlar, cıvatalar, rüzgâr türbinleri, hidroelektrik, boru akışı, kirişler, temeller, gemi direnci, roket motorları, sonlu elemanlar ve daha fazlası. Her sonuç, kullanıcının kendi sayılarıyla denklemini ve izlediği standardı, geçti/kaldı kontrolleriyle birlikte gösterir.

Bu repo işin mühendislik kısmıdır: bütün hesaplar, çözücüler ve onları sınayan testler. Bir mühendislik aracının kara kutu olmaması gerektiğine inandığımız için yayınlıyoruz. Blorp'tan aldığınız bir sayıyı işinizde kullanıyorsanız, nasıl hesaplandığını tam olarak görebilmeli ve yanlışsa bunu kanıtlayabilmelisiniz.

**Misyonumuz:** Mühendisliği herkes için açık, anlaşılır ve doğrulanabilir kılmak.
- **Her zaman ücretsiz:** Hiçbir hesap aracı ücretli olmayacak. Reklam yok, hesap açmak zorunlu değil.
- **Kara kutu yok:** Her sonuç, sizin sayılarınızla denklemini ve izlediği standardı gösterir; arkasındaki kod da burada.
- **Dürüst sınırlar:** Her araç neyi basitleştirdiğini yazar. Yayımlanmış örneklerle doğrulananlar *Doğrulandı*, diğerleri *Kavram* olarak işaretlenir.
- **Sürekli gelişir:** Bildirilen her hata okunur ve düzeltilir.

Bağımlılık yok: saf TypeScript, sayısal kütüphane kullanılmıyor. Yaklaşık 500 test var; bunların 50 kadarı yayımlanmış çözümlü örnekleri birebir tekrarlayan `VALIDATION` testleri.

**Kapımız açık.** Yanlış bir formül, işaret ya da birim bulursanız doğru hâlini gösteren kaynakla birlikte bir [issue](https://github.com/tgsteep/blorp-engine/issues) açın. Henüz *Kavram* olan bir araç için yayımlanmış bir örnek biliyorsanız, bu en değerli katkıdır. Bir modeli geliştirmek ya da yenisini eklemek isterseniz [CONTRIBUTING.md](CONTRIBUTING.md) dosyasına bakın.

**Lisans:** Telif © 2026 TOLYA. **GNU AGPL v3.0** ile yayınlanır. Kodu kullanabilir, inceleyebilir, değiştirebilir ve paylaşabilirsiniz. Dağıtırsanız ya da değiştirilmiş bir sürümü hizmet olarak çalıştırırsanız, kaynak kodunuzu aynı lisansla yayınlamanız gerekir. Blorp uygulaması ve web sitesi (3D görünümler, çizimler, arayüz, tasarım, metinler, Blorp adı ve logosu) bu lisansın kapsamında değildir. İletişim: info@tolya.com.tr
