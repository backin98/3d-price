# Graph Report - 3d_Price  (2026-09-21)

## Corpus Check
- 77 files · ~722,647 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1805 nodes · 2980 edges · 77 communities (69 shown, 5 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 201 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Robolink image CDN
- Storefront app UI
- Admin dashboard UI
- Live hunt scrape
- Generic HTML harvest
- Gemma match guide
- Catalog search rank
- Brand model index
- Stock refresh jobs
- Harvest URL guards
- Laya eval builder
- Playwright AI scraper
- Baseline catalog tests
- Online worker loop
- Filament taxonomy
- Magellan identity
- Magellan decidePair
- Admin Netlify API
- Card price parse
- Local LLM client
- Review board tests
- FX price compare
- TRY money parser
- Baseline catalog
- Admin nav tests
- Thumbnail pHash match
- Netlify blob store
- Vision place tests
- Product page extract
- Image hash tests
- Title normalize
- Catalog regroup tests
- Vision Magellan tests
- Laser wattage tests
- Product image resolve
- Admin backup tests
- Admin purge tests
- Admin VAT tests
- Magellan eval script
- Netlify cookie auth
- admin-image-upload.test.cjs
- admin-dedupe.test.cjs
- storefront-stale-search-browser.test.cjs
- worker-supervise.cjs
- patch-run-all.cjs
- patch-run-all-v3.cjs
- catalog-union.cjs
- price-history.cjs
- scrubClonedImages()
- abort.test.cjs
- admin-backup-ui-browser.test.cjs
- mine-listings.cjs
- product-match.test.cjs
- readJSON()
- admin-ai.test.cjs
- admin-details-browser.test.cjs
- worker.mjs
- package.json
- modifier-order.test.cjs
- place-listings.test.cjs
- served-price.test.cjs
- Published catalog vs candidate
- compare-to-baseline.js
- mapStockStatus()
- withoutVat()
- baseline-axes.test.cjs
- check-consistency.cjs
- worker-http.test.cjs
- vercel.json
- local-ai.test.cjs
- place-score.test.cjs
- worker-setup.sh
- Laya encoder sidecar
- Metatech shop sources

## God Nodes (most connected - your core abstractions)
1. `bindAppEvents()` - 48 edges
2. `bind()` - 31 edges
3. `escapeHtml()` - 25 edges
4. `extractProductPage()` - 24 edges
5. `decidePair()` - 23 edges
6. `identity()` - 22 edges
7. `runWebsiteJob()` - 21 edges
8. `esc()` - 20 edges
9. `fold()` - 19 edges
10. `parseCard()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `main()` --indirect_call--> `huntRobolink()`  [INFERRED]
  scripts/import-robolink-images.cjs → api/robolink.js
- `saveJobs()` --calls--> `writeJSON()`  [EXTRACTED]
  netlify/functions/worker.mjs → lib/netlify-store.cjs
- `pair()` --calls--> `decidePair()`  [EXTRACTED]
  scripts/laser-wattage.test.cjs → lib/product-match.cjs
- `pair()` --calls--> `decidePair()`  [EXTRACTED]
  scripts/magnet-merge.test.cjs → lib/product-match.cjs
- `pair()` --calls--> `decidePair()`  [EXTRACTED]
  scripts/modifier-order.test.cjs → lib/product-match.cjs

## Import Cycles
- None detected.

## Communities (77 total, 5 thin omitted)

### Community 0 - "Robolink image CDN"
Cohesion: 0.00
Nodes (500): https://witcdn.robolinkmarket.com/bambu-lab-a1-3d-yazici-robolink-market-11768-95-K.jpg, https://witcdn.robolinkmarket.com/bambu-lab-a1-combo-3d-yazici-robolink-market-11770-94-K.webp, https://witcdn.robolinkmarket.com/bambu-lab-a1-mini-combo-3d-yazici-robolink-market-11776-95-K.webp, https://witcdn.robolinkmarket.com/bambu-lab-h2s-ams-combo-3d-yazici-robolink-market-18164-96-K.jpg, https://witcdn.robolinkmarket.com/bambu-lab-p1s-3d-yazici-robolink-market-11848-95-K.webp, https://witcdn.robolinkmarket.com/bambu-lab-p1s-combo-3d-yazici-robolink-market-11855-94-K.webp, https://witcdn.robolinkmarket.com/bambu-lab-pla-basic-filament-beige-1000gr-robolink-market-21042-11-K.jpg, https://witcdn.robolinkmarket.com/bambu-lab-pla-basic-filament-blue-1000gr-robolink-market-21037-11-K.jpg (+492 more)

### Community 1 - "Storefront app UI"
Cohesion: 0.07
Nodes (98): activeTab(), aisleName(), applyI18n(), applyLang(), bestOffer(), bestPriceLabel(), bind(), goHome() (+90 more)

### Community 2 - "Admin dashboard UI"
Cohesion: 0.07
Nodes (88): action(), activeJob(), adminFold(), adminMatches(), adoptDetectedUrl(), aiHtml(), aiStatusHtml(), allProducts() (+80 more)

### Community 3 - "Live hunt scrape"
Cohesion: 0.05
Nodes (59): applyRecategorize(), brandFromName(), catalogIndex, { classifyFilament }, decodeEntities(), fetchPage(), fetchPageRetry(), fs (+51 more)

### Community 4 - "Generic HTML harvest"
Cohesion: 0.10
Nodes (48): absUrl(), attr(), CARD_SELECTORS, cardBadge(), cardImage(), cardName(), cardPriceDetail(), cardPriceNumber() (+40 more)

### Community 5 - "Gemma match guide"
Cohesion: 0.05
Nodes (38): axisWords(), buildAllowedIdentities(), buildGemmaContext(), catalogHints(), enforceDecision(), gemmaDecide(), hardConflictsBetween(), idx (+30 more)

### Community 6 - "Catalog search rank"
Cohesion: 0.07
Nodes (38): filterSearch(), { fold, index }, isAnchor(), matchesSearch(), nameOf(), near(), rankSearch(), SEARCH_STOP (+30 more)

### Community 7 - "Brand model index"
Cohesion: 0.08
Nodes (32): BARE_WORDS, BRAND_BY_ALIAS, BRANDS, CNC_WORDS, COMBO_WORDS, DEFAULT_FEEDER, feederOf(), FEEDERS (+24 more)

### Community 8 - "Stock refresh jobs"
Cohesion: 0.08
Nodes (17): ageHours(), checkOfferStock(), fetchPage(), { fold }, planStockChecks(), readStockPage(), refreshStock(), rollupProductStock() (+9 more)

### Community 9 - "Harvest URL guards"
Cohesion: 0.10
Nodes (31): classifyProductType(), declaredLabel(), extractIdentity(), fromUrls(), canonicalizeCategoryUrl(), fold(), { IN_STOCK_FILTER_LABEL, foldStock }, isJunkAmount() (+23 more)

### Community 10 - "Laya eval builder"
Cohesion: 0.07
Nodes (28): balanced, baseline, byBrand, byId, clean, foldTurkish(), fs, HARD (+20 more)

### Community 11 - "Playwright AI scraper"
Cohesion: 0.11
Nodes (28): applyInStockFilterOnPage(), { ask, setEndpoint }, detectCurrency(), { discoverInStockFilter }, EXTRACT_SCHEMA, { extractIdentity, readStockFromHtml }, fetchHtml(), fetchListingHtml() (+20 more)

### Community 12 - "Baseline catalog tests"
Cohesion: 0.07
Nodes (29): a, assert, b, bare, bareTr, baseline, clone, coldStarted (+21 more)

### Community 13 - "Online worker loop"
Cohesion: 0.13
Nodes (28): api(), backoffMs, claimAndRun(), compactEvent(), corsHeaders(), detectModel(), fs, http (+20 more)

### Community 14 - "Filament taxonomy"
Cohesion: 0.14
Nodes (24): classifyFilament(), colorFromName(), pickFirst(), POLYMER_ORDER, POLYMERS, specsFromName(), stripSpecs(), tidyName() (+16 more)

### Community 15 - "Magellan identity"
Cohesion: 0.14
Nodes (26): axesFromTitle(), { classifyFilament }, colorKey(), colorOf(), COLORS, diameterOf(), dist(), fold() (+18 more)

### Community 16 - "Magellan decidePair"
Cohesion: 0.16
Nodes (21): conflicts(), decidePair(), rankCandidates(), score(), similar(), titleSubset(), tokens(), catalogImageCounts() (+13 more)

### Community 17 - "Admin Netlify API"
Cohesion: 0.13
Nodes (14): applySelectedListings(), axesOf(), BACKUP_PARTS, cloneCatalog(), collapseDuplicates(), DEFAULT_DESK, duplicateClusters(), findById() (+6 more)

### Community 18 - "Card price parse"
Cohesion: 0.10
Nodes (18): cardPrice(), assert, { cardPrice, cardPriceDetail }, context, detail, fixture, fs, money (+10 more)

### Community 19 - "Local LLM client"
Cohesion: 0.20
Nodes (19): ask(), crypto, deskModelUrl(), discover(), DISCOVER_ORIGINS, discoverOrigins(), extractJson(), fs (+11 more)

### Community 20 - "Review board tests"
Cohesion: 0.11
Nodes (16): adminSrc, apiContext, assert, byUrl, context, data, derived, fs (+8 more)

### Community 21 - "FX price compare"
Cohesion: 0.18
Nodes (15): asListing(), compare_products(), { decidePair, score }, FALLBACK_TRY, groupBestPrices(), loadRates(), rankByPrice(), toUsd() (+7 more)

### Community 22 - "TRY money parser"
Cohesion: 0.22
Nodes (16): normalizeOfferPrice(), CURRENCY_WORDS, currencyOf(), detectCurrency(), flagPriceOutliers(), foldTr(), isSuspectAmount(), MAX_PRICE (+8 more)

### Community 23 - "Baseline catalog"
Cohesion: 0.20
Nodes (15): createCatalogIndex(), bestOf(), lookup(), DEFAULT_FILE, extractAxes(), fs, hardConflicts(), identityId() (+7 more)

### Community 24 - "Admin nav tests"
Cohesion: 0.12
Nodes (15): assert, context, data, fs, idleRuns, ids, links, listeners (+7 more)

### Community 25 - "Thumbnail pHash match"
Cohesion: 0.19
Nodes (15): bitsHex(), browser(), cacheData(), COS, download(), fingerprint(), fingerprintBuffer(), fs (+7 more)

### Community 26 - "Netlify blob store"
Cohesion: 0.20
Nodes (12): blobsContext(), checked(), deleteKey(), encodeKey(), { flagPriceOutliers }, PRICE_CHECKED_KEYS, readBytes(), request() (+4 more)

### Community 27 - "Vision place tests"
Cohesion: 0.13
Nodes (11): assert, bottle, cache, catalogFile, coffee, dir, fs, os (+3 more)

### Community 28 - "Product page extract"
Cohesion: 0.18
Nodes (13): extractProductPage(), foldName(), jsonLdProduct(), looksLikeProductName(), metaContent(), priceFloor(), structuredPrice(), assert (+5 more)

### Community 29 - "Image hash tests"
Cohesion: 0.15
Nodes (12): hamming(), visualScore(), assert, checker, flat, g1, gradient, { hamming, hashesFromGray, visualScore, fingerprintBuffer, shutdown, VISUAL_SAME, VISUAL_WEAK, S } (+4 more)

### Community 30 - "Title normalize"
Cohesion: 0.21
Nodes (12): aliasesOf(), applyTemplates(), byLongestFirst(), cache, EQUIPMENT_TEMPLATES, fold(), foldTables(), idx (+4 more)

### Community 31 - "Catalog regroup tests"
Cohesion: 0.15
Nodes (13): assert, catalog, catalogFile, dir, fs, os, path, post() (+5 more)

### Community 32 - "Vision Magellan tests"
Cohesion: 0.14
Nodes (12): assert, buffer, conflicts, { conflicts: axisConflicts, identity }, { decidePair, rankCandidates }, gray, hard, KE (+4 more)

### Community 33 - "Laser wattage tests"
Cohesion: 0.17
Nodes (11): axesOf(), assert, { axesOf, decidePair }, pair(), w(), assert, { decidePair, axesOf }, metatech (+3 more)

### Community 34 - "Product image resolve"
Cohesion: 0.42
Nodes (12): absolutize(), attr(), fromBackground(), fromImgs(), fromJsonLd(), fromMeta(), fromPicture(), isJunkImage() (+4 more)

### Community 35 - "Admin backup tests"
Cohesion: 0.17
Nodes (10): assert, call(), files, fs, path, req(), sandbox, source (+2 more)

### Community 36 - "Admin purge tests"
Cohesion: 0.18
Nodes (10): assert, context, fs, names(), products(), R(), row(), source (+2 more)

### Community 37 - "Admin VAT tests"
Cohesion: 0.15
Nodes (7): assert, context, fs, sandbox, source, store, vm

### Community 38 - "Magellan eval script"
Cohesion: 0.15
Nodes (11): { decidePair }, diff, FILE, fm, fs, handWritten, kinds, pairs (+3 more)

### Community 39 - "Netlify cookie auth"
Cohesion: 0.21
Nodes (6): authReady(), crypto, ownerFromHeaders(), parseCookies(), verify(), verifyPassword()

### Community 40 - "admin-image-upload.test.cjs"
Cohesion: 0.18
Nodes (9): adminSource, assert, bytes, files, fs, png, sandbox, store (+1 more)

### Community 41 - "admin-dedupe.test.cjs"
Cohesion: 0.20
Nodes (6): assert, context, fs, source, store, vm

### Community 42 - "storefront-stale-search-browser.test.cjs"
Cohesion: 0.20
Nodes (8): after, assert, before, fs, http, path, ROOT, server

### Community 43 - "worker-supervise.cjs"
Cohesion: 0.24
Nodes (9): fs, LOG, path, ROOT, say(), { spawn }, stamp(), start() (+1 more)

### Community 44 - "patch-run-all.cjs"
Cohesion: 0.20
Nodes (9): fs, i1, i2, j1, j2, mk, NEW, newMarkup (+1 more)

### Community 45 - "patch-run-all-v3.cjs"
Cohesion: 0.20
Nodes (8): BS, extraRows, fs, newAdd, newRemove, oldAdd, oldRemove, s

### Community 46 - "catalog-union.cjs"
Cohesion: 0.31
Nodes (7): collapseByMagellan(), collapseShelf(), currencyCode(), pricesToTry(), { toTry, FALLBACK_TRY }, TRY_CURRENCY, toTry()

### Community 47 - "price-history.cjs"
Cohesion: 0.25
Nodes (7): { DatabaseSync }, DEFAULT_FILE, fs, history(), path, record(), recordMany()

### Community 48 - "scrubClonedImages()"
Cohesion: 0.22
Nodes (8): scrubClonedImages(), assert, clone, lazy, ld, og, { resolveProductImage, isJunkImage, scrubClonedImages }, srcset

### Community 49 - "abort.test.cjs"
Cohesion: 0.22
Nodes (5): assert, fs, os, path, vm

### Community 50 - "admin-backup-ui-browser.test.cjs"
Cohesion: 0.25
Nodes (8): assert, backup, data(), fs, http, path, ROOT, server

### Community 51 - "mine-listings.cjs"
Cohesion: 0.28
Nodes (8): collect(), fs, jsonFiles(), main(), OUT, path, ROOT, SKIP_DIRS

### Community 52 - "product-match.test.cjs"
Cohesion: 0.22
Nodes (7): assert, blackEn, blackTr, hard, { score, similar, decidePair, taxonomy, identity, normalizePrinterTitle, conflicts }, slugIdentity, tax

### Community 53 - "readJSON()"
Cohesion: 0.29
Nodes (8): readJSON(), backupKey(), countsOf(), loadAll(), readBackupIndex(), slugifyName(), snapshotNow(), getJobs()

### Community 54 - "admin-ai.test.cjs"
Cohesion: 0.25
Nodes (6): assert, context, desk, fs, source, vm

### Community 55 - "admin-details-browser.test.cjs"
Cohesion: 0.25
Nodes (7): ADMIN, assert, fs, http, path, payload, server

### Community 56 - "worker.mjs"
Cohesion: 0.33
Nodes (3): mergeCards(), nameFromUrl(), saveJobs()

### Community 57 - "package.json"
Cohesion: 0.29
Nodes (6): dependencies, playwright, description, name, private, playwright

### Community 58 - "modifier-order.test.cjs"
Cohesion: 0.29
Nodes (6): assert, { axesOf }, { decidePair }, DIFFERENT, pair(), SAME

### Community 59 - "place-listings.test.cjs"
Cohesion: 0.29
Nodes (6): assert, fs, os, path, { placeListings }, { unionCatalog }

### Community 60 - "served-price.test.cjs"
Cohesion: 0.29
Nodes (6): again, assert, catalog, prices, served, union

### Community 61 - "Published catalog vs candidate"
Cohesion: 0.33
Nodes (6): Published catalog vs candidate, Local harvest worker, Magellan title matcher, Netlify storefront and admin, Robolink job pulls Rhino listings, Rhino shop sources

### Community 62 - "compare-to-baseline.js"
Cohesion: 0.40
Nodes (5): baseline, compareScrapedToBaseline(), normalizeLib, baselineReady(), confirmedVerdict()

### Community 63 - "mapStockStatus()"
Cohesion: 0.40
Nodes (5): mapStockStatus(), foldStock(), STOCK_RULES, stockFromText(), vatFromText()

### Community 64 - "withoutVat()"
Cohesion: 0.53
Nodes (6): withoutVat(), hostOfUrl(), offerFromShop(), purgeShop(), repriceShopVat(), shopKeys()

### Community 65 - "baseline-axes.test.cjs"
Cohesion: 0.33
Nodes (4): assert, bare, baseline, p1s

### Community 66 - "check-consistency.cjs"
Cohesion: 0.33
Nodes (3): fs, path, SITE

### Community 68 - "worker-http.test.cjs"
Cohesion: 0.40
Nodes (4): assert, os, path, { spawn }

### Community 69 - "vercel.json"
Cohesion: 0.40
Nodes (4): buildCommand, cleanUrls, headers, outputDirectory

## Knowledge Gaps
- **1043 isolated node(s):** `{ toTry, FALLBACK_TRY }`, `TRY_CURRENCY`, `again`, `assert`, `catalog` (+1038 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1138 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `baselineReady()` connect `compare-to-baseline.js` to `Magellan decidePair`, `Baseline catalog`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `parseMoney()` connect `TRY money parser` to `Playwright AI scraper`, `Live hunt scrape`, `Generic HTML harvest`, `Product page extract`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `bindAppEvents()` (e.g. with `productCard()` and `runRowProblem()`) actually correct?**
  _`bindAppEvents()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `bind()` (e.g. with `goHome()` and `layoutTabs()`) actually correct?**
  _`bind()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `{ toTry, FALLBACK_TRY }`, `TRY_CURRENCY`, `again` to the rest of the system?**
  _1043 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Robolink image CDN` be split into smaller, more focused modules?**
  _Cohesion score 0.003992015968063872 - nodes in this community are weakly interconnected._
- **Should `Storefront app UI` be split into smaller, more focused modules?**
  _Cohesion score 0.07108910891089108 - nodes in this community are weakly interconnected._