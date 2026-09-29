# Filament storefront research baseline

Research date: 2026-09-25. The machine-readable evidence matrix is [`data/filament-storefront-evidence.json`](../data/filament-storefront-evidence.json); the canonical dictionaries are [`data/filament-taxonomy.json`](../data/filament-taxonomy.json).

## Production decision path

1. HTML, structured data, browser DOM and captured network responses provide evidence.
2. Deterministic code extracts product form, title, price, stock and identity axes.
3. Magellan rejects every populated-axis conflict and holds every one-sided filament axis gap.
4. Laya sees only pairs that passed Magellan. Its score can propose a merge, never override a conflict.
5. New families, new SKUs and uncertain pairs require human confirmation.

Price, stock and title never come from Laya. A category card is discovery evidence, while the selected product/variation detail is sellable-SKU evidence.

## Storefront evidence matrix

The JSON matrix contains every requested column and sample evidence. This is the compact comparison:

| Shop | Platform | Category | Count evidence | Pagination | Price/stock authority | Primary trap |
|---|---|---|---|---|---|---|
| MakerPazar | Custom SPA / Bixcod | [Filament](https://makerpazar.com/filament) | 746 filter total; 100 rendered | JS numeric pager; observe grid/network | selected detail option + cart state | category pollution and URL-stable pagination |
| Rhino | Ticimax | [Filament çeşitleri](https://www.rhino3dprinter.com/filament-cesitleri) | 144 URLs in saved run | `?sayfa=N` | rendered TRY detail + cart state | client currency and overlay images |
| Urhan Shop | T-Soft | [Filamentler](https://www.urhanshop.com/Kategoriler.aspx?menuUrl=filamentler-k113) | enumerate service pages | `sayfa` + product-list service | VAT-inclusive detail amount + cart state | grid KDV Hariç and installment amounts |
| Robitshop | IdeaSoft | [Filament](https://www.robitshop.com/kategori/filament-1) | enumerate category pages | `?tp=N` | payable detail sale price + cart state | USD+KDV, TRY and installments coexist |
| Smith3D | WooCommerce | [PLA filament](https://www.smith3d.com/materials/pla-filament/) | dynamic | page links + variations | selected variation price/availability | parent ranges and parent stock are not SKU evidence |
| Maxxeshop3D | OpenCart | [Filaments](https://maxxeshop3d.com/index.php?path=71&route=product%2Fcategory) | enumerate `product_id` | route/query pages | gross customer amount + option stock | Ex Tax value beside customer price |
| Porima | Shopify | [PLA collection](https://porima3d.com/collections/pla-filament-cesitleri) | dynamic | collection pages/cursors | selected variant price/availability | campaign, installment and FAST prices coexist |
| Bambu Lab US | Shopify | [Filament collection](https://us.store.bambulab.com/collections/bambu-lab-3d-printer-filament) | dynamic | collection pages/cursors | selected variant price/availability | refill/spool and colour share one parent page |

An unknown endpoint is `null` in the evidence file. It must be captured from browser network traffic before it becomes a shop override; names have not been guessed.

## Canonical taxonomy tree

```text
Filament
├─ PLA
│  ├─ Standard / Basic
│  ├─ Plus
│  ├─ High-Speed
│  ├─ Plus + High-Speed
│  ├─ Matte / Silk / Sparkle / Glow
│  ├─ Wood / Marble / Metal / Translucent
│  └─ CF / GF / Tough / Recycled
├─ PETG / PET
│  └─ Standard / Plus / High-Speed / CF / GF / Translucent
├─ ABS / ASA / PLA-ABS
│  └─ Standard / Plus / CF / GF
├─ Flexible
│  └─ TPU / TPE / PEBA (hardness remains a future explicit axis, never title noise)
├─ Engineering
│  ├─ PA (PA6, PA12) / PPA
│  ├─ PC / PP
│  └─ PPS / PEEK / PEKK
└─ Support
   └─ PVA / HIPS / named support material
```

`Resin`, dryers, nozzles, storage bags and other accessories are product forms, not filament polymers. They are filtered before identity extraction.

### Parent family identity

`brand + polymer + material variant + diameter`

Example: `Porima | PLA | Plus + High-Speed | 1.75 mm`.

### Child sellable-SKU identity

`parentId + colour + net weight + packaging`

Example: `parent | Black | 1000 g | Spool`. Price, currency, stock, URL, shop labels and promotions belong only to offers under this child in the catalog projection.

The baseline file stores family and child reference rows but no offers. Family rows are excluded from Magellan candidates. Catalog, shop-run and uncertainty deletion therefore cannot remove reference identities.

## Deterministic extraction pipeline

1. **Product form:** reject known resin, dryer and accessory terms before classification.
2. **Brand and polymer:** prefer structured `brand`; normalize the title with longest-alias-first matching.
3. **Metrics:** extract weight with `(\d+(?:[.,]\d+)?)\s*(kg|kilogram|g|gr|gram)` and diameter with `(1[.,]75|2[.,]85|3[.,]00)\s*mm`. Convert weight to integer grams. If absent, leave empty.
4. **Material variant:** match longest multilingual phrase first. `PLA+` becomes polymer `pla`, variant `plus`; `PET-G` becomes `petg`; CF/GF/high-speed/glow terms are variants.
5. **Packaging:** only explicit refill/spool aliases populate the axis. A normal product photo or retailer convention proves nothing.
6. **Theme noise:** ignore collection words and RAL codes for identity. Preserve a recognized colour phrase such as `Pastel Pembe`; `Army Khaki Green` canonicalizes to `khaki-green`.
7. **Colour:** accept only a phrase in the multilingual colour lexicon. Unknown residual text stays empty and routes to review.
8. **Conflict check:** two different populated values on any identity axis create a hard conflict. A value on only one side creates a gap and review.

`Standard` is a real populated variant only when explicitly present in structured data or title. An absent material variant remains unknown.

## Normalization tables

The full tables and display hex values live in the taxonomy JSON. Required mappings include:

| Input aliases | Canonical axis/value |
|---|---|
| `PLA+`, `PLA Plus`, `PLA-Plus`, `Pro PLA` | polymer `pla`, variant `plus` |
| `PET-G`, `PET_G` | polymer `petg` |
| `ipek`, `ipeksi`, `silk` | variant `silk` |
| `yüksek hızlı`, `high speed`, `rapid`, `hyper`, `speed`, `HF`, `HS` | variant `high-speed` |
| `karbon fiber`, `karbon elyaf`, `karbon takviyeli`, `CF` | variant `cf` |
| `cam elyaf`, `cam elyaflı`, `glass fiber`, `GF` | variant `gf` |
| `TPU flex`, `esnek TPU` | polymer `tpu`; flex is descriptor noise |
| `gece parlayan`, `karanlıkta parlayan`, `glow in dark` | variant `glow` |
| `makarasız`, `refill`, `spoolless`, `yedek paket` | packaging `refill` |
| `makaralı`, `spool`, `with spool` | packaging `spool` |
| `1 kg`, `1,0kg`, `1000 gr`, `1000gram` | weight `1000 g` |
| `0,75 kg`, `750g`, `750 gr` | weight `750 g` |
| `1,75 mm`, `1.75mm` | diameter `1.75 mm` |

Sparkle/glitter is not glow. Transparent/translucent can be a material variant when explicitly marketed as such; an exact colour such as `Transparent Blue` remains a colour. Longest phrase wins.

## Platform generalization rules

- **Structured product first:** JSON-LD `Product`, platform product JSON or a selected variation object is preferred over category text.
- **Variant expansion:** a parent page with option IDs must emit one child record for every sellable combination that changes SKU, stock, price, colour, weight or packaging.
- **Pagination completion:** stop after a proven terminal page/empty response or a full DOM/network cycle with no new canonical product URLs. A static address bar does not mean infinite scroll.
- **Price:** select the current customer-payable total for the chosen SKU and currency. Reject crossed-out list prices, installments, points, EFT discounts and tax-exclusive alternatives.
- **Stock:** use the chosen variation’s availability and enabled purchase control. `Ön Sipariş` plus an enabled buy control is preorder; price without a buy control is not in stock.
- **Images:** selected variation image first, then structured product image. Logos, corner overlays and gallery thumbnails are excluded.

## Isolated overrides

Overrides are allowed only where captured evidence proves a platform rule insufficient:

- T-Soft stores: use `priceIncludingVAT`/customer checkout price when grid cards are explicitly KDV Hariç.
- Ticimax stores: pin browser currency to TRY and verify the rendered currency before accepting a number.
- MakerPazar: click its numeric pager and wait for a new product-grid/network result even when history does not change.
- Porima: select the Shopify variant ID before reading campaign price, availability and image.

These overrides select evidence. They do not change taxonomy or matching rules and contain no brand/model conditions.

## Gathered baseline artifact

[`data/filament-baseline.json`](../data/filament-baseline.json) is the reference set mined from the listings already scraped on this machine — family cards plus their colour children, with the listing behind every claim. It is produced deterministically, with no network and no model:

```bash
node scripts/build-filament-baseline.cjs          # rewrite when the mined content changed
node scripts/build-filament-baseline.cjs --check   # fail when the file is stale
```

A card is `brand + polymer + material variant + diameter`; colours hang under it as gathered features, and each colour's child SKU carries the axes its own listing proved (colour, net weight, packaging). Nothing is invented: a colour with no listing behind it is not in the file, and an absent axis stays absent. Re-running after any new shop run (including the paginated `?sayfa=N` category pages) picks up the new listings and leaves the untouched cards identical.

## Laya corpus and safety

[`data/laya-filament-pairs.json`](../data/laya-filament-pairs.json) adds bilingual positives and hard negatives. Every hard negative differs on exactly one named axis: polymer, variant, colour, weight, diameter, packaging or product form. `scripts/laya-match.py --train` loads this corpus beside the existing evaluation rows.

Runtime order remains fixed: Magellan conflict → Magellan gap → Laya score. A score at or above the trained threshold is only meaningful for candidates that reached Laya. Medium scores stay uncertain; hard conflicts never reach or yield to Laya.

## Regression fixtures

[`data/filament-parent-child.fixtures.json`](../data/filament-parent-child.fixtures.json) demonstrates family rows, child rows and an offer-bearing catalog projection. `scripts/filament-baseline.test.cjs` checks:

- unknown axes remain empty;
- TR/EN aliases normalize identically;
- weights and diameters normalize deterministically;
- accessories/resin are rejected before filament identity;
- family keys include diameter and child keys include colour/weight/packaging;
- every populated-axis difference is a Magellan hard conflict;
- family rows are not match candidates and child rows retain their axes;
- the Laya filament corpus contains at least 50 pairs and covers every hard-negative axis;
- every evidence row contains all required research fields and all requested platform types are represented.
