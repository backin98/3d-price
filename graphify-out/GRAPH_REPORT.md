# Graph Report - 3d_Price  (2026-09-28)

## Corpus Check
- 150 files · ~950,632 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2232 nodes · 3763 edges · 110 communities (103 shown, 5 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 261 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e42f1293`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Robolink image CDN
- app.js
- admin.js
- hunt.js
- parseCard
- Gemma match guide
- Catalog search rank
- Brand model index
- Stock refresh jobs
- qwen-website-job.cjs
- Laya eval builder
- ai-scraper.test.cjs
- Baseline catalog tests
- online-worker.cjs
- match-products.js
- product-match.cjs
- qwen-place.cjs
- admin.mjs
- price-parse.test.cjs
- Local LLM client
- review-board.test.cjs
- compare-products.cjs
- parse-money.cjs
- Baseline catalog
- admin-navigation.test.cjs
- image-match.cjs
- netlify-store.cjs
- Vision place tests
- harvest.js
- image-match.test.cjs
- Title normalize
- Catalog regroup tests
- Vision Magellan tests
- decidePair
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
- filament-baseline.test.cjs
- admin-baseline.test.cjs
- catalog-union.cjs
- ai-scraper.cjs
- scrubClonedImages()
- abort.test.cjs
- admin-backup-ui-browser.test.cjs
- mine-listings.cjs
- product-match.test.cjs
- filament-baseline-gathered.test.cjs
- admin-ai.test.cjs
- admin-details-browser.test.cjs
- worker.mjs
- package.json
- robolink.js
- stock-refresh.cjs
- served-price.test.cjs
- Published catalog vs candidate
- compare-to-baseline.js
- harvest-guards.cjs
- purgeShop
- baseline-axes.test.cjs
- check-consistency.cjs
- baseline-board.cjs
- worker-http.test.cjs
- vercel.json
- local-ai.test.cjs
- Filament storefront research baseline
- worker-setup.sh
- Laya encoder sidecar
- Metatech shop sources
- harvestCategory
- local-server.mjs
- sanitizeBoard
- worker-progress-order.test.cjs
- metatech.js
- pull-netlify-blobs.mjs
- tmp-upload.cjs
- harvest.test.cjs
- index.js
- admin-uncertain.test.cjs
- backup-data.mjs
- product-images.js
- admin-run-category.test.cjs
- admin-uncertain-actions.test.cjs
- search-bar-browser.test.cjs
- stock-preview.test.cjs
- hunt-baseline.test.cjs
- laya-match.py
- tmp-audit-check.cjs
- tmp-trace.cjs
- tmp-trace2.cjs
- tmp-trace3.cjs
- tmp-trace4.cjs
- runClaimedJob
- laya-match.cjs
- admin-filament-picker.test.cjs
- admin-shop-publish.test.cjs
- ensureCategories
- laya-place.test.cjs
- set-owner-password.mjs
- tmp-junk.cjs
- teknomarket.js
- Cloudflare Pages deployment

## God Nodes (most connected - your core abstractions)
1. `bindAppEvents()` - 63 edges
2. `extractProductPage()` - 33 edges
3. `runWebsiteJob()` - 32 edges
4. `bind()` - 31 edges
5. `identity()` - 29 edges
6. `decidePair()` - 29 edges
7. `escapeHtml()` - 26 edges
8. `esc()` - 24 edges
9. `placeListings()` - 23 edges
10. `classifyFilament()` - 20 edges

## Surprising Connections (you probably didn't know these)
- `main()` --indirect_call--> `huntRobolink()`  [INFERRED]
  scripts/import-robolink-images.cjs → api/robolink.js
- `saveJobList()` --calls--> `writeJSON()`  [EXTRACTED]
  netlify/functions/admin.mjs → lib/netlify-store.cjs
- `colorKey()` --calls--> `canonicalColour()`  [EXTRACTED]
  lib/product-match.cjs → api/filament-classify.js
- `colorOf()` --calls--> `canonicalColour()`  [EXTRACTED]
  lib/product-match.cjs → api/filament-classify.js
- `normalizeFilamentListing()` --calls--> `colourAgnosticTitle()`  [EXTRACTED]
  lib/qwen-website-job.cjs → api/filament-classify.js

## Import Cycles
- None detected.

## Communities (110 total, 5 thin omitted)

### Community 0 - "Robolink image CDN"
Cohesion: 0.00
Nodes (500): https://witcdn.robolinkmarket.com/bambu-lab-a1-3d-yazici-robolink-market-11768-95-K.jpg, https://witcdn.robolinkmarket.com/bambu-lab-a1-combo-3d-yazici-robolink-market-11770-94-K.webp, https://witcdn.robolinkmarket.com/bambu-lab-a1-mini-combo-3d-yazici-robolink-market-11776-95-K.webp, https://witcdn.robolinkmarket.com/bambu-lab-h2s-ams-combo-3d-yazici-robolink-market-18164-96-K.jpg, https://witcdn.robolinkmarket.com/bambu-lab-p1s-3d-yazici-robolink-market-11848-95-K.webp, https://witcdn.robolinkmarket.com/bambu-lab-p1s-combo-3d-yazici-robolink-market-11855-94-K.webp, https://witcdn.robolinkmarket.com/bambu-lab-pla-basic-filament-beige-1000gr-robolink-market-21042-11-K.jpg, https://witcdn.robolinkmarket.com/bambu-lab-pla-basic-filament-blue-1000gr-robolink-market-21037-11-K.jpg (+492 more)

### Community 1 - "app.js"
Cohesion: 0.07
Nodes (98): activeTab(), aisleName(), applyI18n(), applyLang(), bestOffer(), bestPriceLabel(), bind(), goHome() (+90 more)

### Community 2 - "admin.js"
Cohesion: 0.06
Nodes (114): action(), activeJob(), adminFold(), adminMatches(), adoptDetectedUrl(), aiHtml(), aiStatusHtml(), allProducts() (+106 more)

### Community 3 - "hunt.js"
Cohesion: 0.10
Nodes (31): applyRecategorize(), brandFromName(), catalogIndex, { classifyFilament }, decodeEntities(), fetchPage(), fetchPageRetry(), fs (+23 more)

### Community 4 - "parseCard"
Cohesion: 0.20
Nodes (23): absUrl(), cardBadge(), cardImage(), cardName(), cardPriceDetail(), cardPriceNumber(), classContains(), classList() (+15 more)

### Community 5 - "Gemma match guide"
Cohesion: 0.22
Nodes (8): assert, context, fs, html, job, path, src, vm

### Community 6 - "Catalog search rank"
Cohesion: 0.07
Nodes (38): filterSearch(), { fold, index }, isAnchor(), matchesSearch(), nameOf(), near(), rankSearch(), SEARCH_STOP (+30 more)

### Community 7 - "Brand model index"
Cohesion: 0.06
Nodes (43): BARE_WORDS, BRAND_BY_ALIAS, BRANDS, CNC_WORDS, COMBO_WORDS, DEFAULT_FEEDER, feederOf(), FEEDERS (+35 more)

### Community 8 - "Stock refresh jobs"
Cohesion: 0.09
Nodes (6): assert, fs, path, { planStockChecks, checkOfferStock, refreshStock, rollupProductStock }, stock, vm

### Community 9 - "qwen-website-job.cjs"
Cohesion: 0.12
Nodes (25): isLikelyProductUrl(), withVat(), { canonicalizeCategoryUrl, isTemplateUrl }, { classifyFilament, canonicalColour, colourAgnosticTitle }, clean(), EXTRACT_AT_ONCE, { fetchHtml, listingPageUrls, inferPagePattern, nextPageUrl }, fs (+17 more)

### Community 10 - "Laya eval builder"
Cohesion: 0.10
Nodes (20): balanced, baseline, byBrand, byId, clean, foldTurkish(), fs, HARD (+12 more)

### Community 11 - "ai-scraper.test.cjs"
Cohesion: 0.09
Nodes (25): detectCurrency(), listingFromExtract(), priceOnPage(), stripDom(), { DatabaseSync }, DEFAULT_FILE, fs, history() (+17 more)

### Community 12 - "Baseline catalog tests"
Cohesion: 0.07
Nodes (29): a, assert, b, bare, bareTr, baseline, clone, coldStarted (+21 more)

### Community 13 - "online-worker.cjs"
Cohesion: 0.12
Nodes (25): backoffMs, claimAndRun(), corsHeaders(), detectModel(), { fetchHtml }, finishedIds, fs, http (+17 more)

### Community 14 - "match-products.js"
Cohesion: 0.56
Nodes (7): brandKey(), filamentMatchKey(), fold(), listingTokens(), mergeGroup(), mergeSimilar(), printerMatchKey()

### Community 15 - "product-match.cjs"
Cohesion: 0.13
Nodes (27): coloursFromName(), axesFromTitle(), { classifyFilament, canonicalColour, coloursFromName }, colorKey(), colorOf(), COLORS, colorSetOf(), diameterOf() (+19 more)

### Community 16 - "qwen-place.cjs"
Cohesion: 0.10
Nodes (25): matchListingToBoard(), rankCandidates(), baselineReady(), catalogImageCounts(), confirmedVerdict(), crypto, { fold, score, similar, rankCandidates, taxonomy, axesOf, conflicts, decidePair }, fs (+17 more)

### Community 17 - "admin.mjs"
Cohesion: 0.09
Nodes (28): applySelectedListings(), axesOf(), BACKUP_PARTS, backupKey(), cloneCatalog(), coercePrice(), collapseDuplicates(), countsOf() (+20 more)

### Community 18 - "price-parse.test.cjs"
Cohesion: 0.10
Nodes (18): cardPrice(), assert, { cardPrice, cardPriceDetail }, context, detail, fixture, fs, money (+10 more)

### Community 19 - "Local LLM client"
Cohesion: 0.20
Nodes (18): ask(), crypto, deskModelUrl(), discover(), DISCOVER_ORIGINS, discoverOrigins(), extractJson(), fs (+10 more)

### Community 20 - "review-board.test.cjs"
Cohesion: 0.09
Nodes (20): adminSrc, apiContext, assert, byUrl, context, data, derived, exactDuplicates (+12 more)

### Community 21 - "compare-products.cjs"
Cohesion: 0.18
Nodes (17): scrapeProduct(), asListing(), compare_products(), { decidePair, score }, groupBestPrices(), loadRates(), rankByPrice(), toTry() (+9 more)

### Community 22 - "parse-money.cjs"
Cohesion: 0.24
Nodes (15): normalizeOfferPrice(), CURRENCY_WORDS, currencyOf(), detectCurrency(), foldTr(), isSuspectAmount(), MAX_PRICE, moneyTokens() (+7 more)

### Community 23 - "Baseline catalog"
Cohesion: 0.20
Nodes (15): createCatalogIndex(), bestOf(), lookup(), DEFAULT_FILE, extractAxes(), fs, hardConflicts(), identityId() (+7 more)

### Community 24 - "admin-navigation.test.cjs"
Cohesion: 0.08
Nodes (22): added, assert, bl, context, data, deferredRun, filamentBl, filled (+14 more)

### Community 25 - "image-match.cjs"
Cohesion: 0.18
Nodes (19): bitsHex(), browser(), cacheData(), cacheFile(), COLOUR_RGB, colourFromPixels(), COS, detectFilamentColour() (+11 more)

### Community 26 - "netlify-store.cjs"
Cohesion: 0.22
Nodes (16): blobsContext(), checked(), deleteKey(), encodeKey(), { flagPriceOutliers }, kv(), localFile(), nodeFs (+8 more)

### Community 27 - "Vision place tests"
Cohesion: 0.13
Nodes (11): assert, bottle, cache, catalogFile, coffee, dir, fs, os (+3 more)

### Community 28 - "harvest.js"
Cohesion: 0.09
Nodes (38): CARD_SELECTORS, classifyProductType(), CONTAINER_TAGS, declaredLabel(), extractIdentity(), extractProductPage(), { fold, tokens, identity }, foldName() (+30 more)

### Community 29 - "image-match.test.cjs"
Cohesion: 0.14
Nodes (13): hamming(), shutdown(), visualScore(), assert, checker, flat, g1, gradient (+5 more)

### Community 30 - "Title normalize"
Cohesion: 0.21
Nodes (12): aliasesOf(), applyTemplates(), byLongestFirst(), cache, EQUIPMENT_TEMPLATES, fold(), foldTables(), idx (+4 more)

### Community 31 - "Catalog regroup tests"
Cohesion: 0.15
Nodes (13): assert, catalog, catalogFile, dir, fs, os, path, post() (+5 more)

### Community 32 - "Vision Magellan tests"
Cohesion: 0.14
Nodes (12): assert, buffer, conflicts, { conflicts: axisConflicts, identity }, { decidePair, rankCandidates }, gray, hard, KE (+4 more)

### Community 33 - "decidePair"
Cohesion: 0.10
Nodes (22): axesOf(), decidePair(), gaps(), isNotTheProduct(), assert, { axesOf, decidePair }, pair(), w() (+14 more)

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
Cohesion: 0.16
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

### Community 44 - "filament-baseline.test.cjs"
Cohesion: 0.05
Nodes (60): canonicalColour(), classifyFilament(), COLOR_ALIASES, colourAgnosticTitle(), entries(), fold(), hasPhrase(), PACKAGING_ALIASES (+52 more)

### Community 45 - "admin-baseline.test.cjs"
Cohesion: 0.07
Nodes (25): absorbed, assert, board, bytes, { emptyBoard, fromProduct, fromRunCard, upsertItems, loadBackupPrinters, sanitizeItem, addCategory, renameCategory, patchItem, addItem, itemForProduct, applyBaselineImages, renameLinkedItem, addRecommendations, absorbWorkerCreates, catalogProductForItem }, filament, files, fs (+17 more)

### Community 46 - "catalog-union.cjs"
Cohesion: 0.17
Nodes (14): collapseByMagellan(), collapseShelf(), currencyCode(), pricesToTry(), { toTry, FALLBACK_TRY }, TRY_CURRENCY, unionCatalog(), FALLBACK_TRY (+6 more)

### Community 47 - "ai-scraper.cjs"
Cohesion: 0.12
Nodes (24): { ask, setEndpoint }, browserFor(), EXTRACT_SCHEMA, { extractIdentity, readStockFromHtml }, fetchHtml(), fetchListingHtml(), handleInfiniteScroll(), inferPagePattern() (+16 more)

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
Cohesion: 0.15
Nodes (13): conflicts(), dist(), score(), similar(), titleSubset(), tokens(), assert, blackEn (+5 more)

### Community 53 - "filament-baseline-gathered.test.cjs"
Cohesion: 0.11
Nodes (17): assert, baseline, board, byBase, { classifyFilament, coloursFromName }, colourAliases, colours, { execFileSync } (+9 more)

### Community 54 - "admin-ai.test.cjs"
Cohesion: 0.25
Nodes (6): assert, context, desk, fs, source, vm

### Community 55 - "admin-details-browser.test.cjs"
Cohesion: 0.25
Nodes (7): ADMIN, assert, fs, http, path, payload, server

### Community 56 - "worker.mjs"
Cohesion: 0.31
Nodes (5): getJobs(), mergeCards(), nameFromUrl(), saveJobs(), updateJob()

### Community 57 - "package.json"
Cohesion: 0.12
Nodes (16): dependencies, playwright, description, devDependencies, wrangler, name, private, scripts (+8 more)

### Community 58 - "robolink.js"
Cohesion: 0.17
Nodes (15): decode(), huntRobolink(), imageManifest, page(), { parseMoney }, parseRobolink(), pick(), priceTL() (+7 more)

### Community 59 - "stock-refresh.cjs"
Cohesion: 0.22
Nodes (15): ageHours(), checkOfferStock(), { extractProductPage }, fetchPage(), { fold }, isResolvedStatus(), planStockChecks(), readPricePage() (+7 more)

### Community 60 - "served-price.test.cjs"
Cohesion: 0.29
Nodes (6): again, assert, catalog, prices, served, union

### Community 61 - "Published catalog vs candidate"
Cohesion: 0.33
Nodes (6): Published catalog vs candidate, Local harvest worker, Magellan title matcher, Netlify storefront and admin, Robolink job pulls Rhino listings, Rhino shop sources

### Community 62 - "compare-to-baseline.js"
Cohesion: 0.50
Nodes (3): baseline, compareScrapedToBaseline(), normalizeLib

### Community 63 - "harvest-guards.cjs"
Cohesion: 0.19
Nodes (12): canonicalizeCategoryUrl(), discoverInStockFilter(), fold(), { IN_STOCK_FILTER_LABEL, foldStock }, isJunkAmount(), isListingUrl(), isTemplateUrl(), mapStockStatus() (+4 more)

### Community 64 - "purgeShop"
Cohesion: 0.53
Nodes (6): withoutVat(), hostOfUrl(), offerFromShop(), purgeShop(), repriceShopVat(), shopKeys()

### Community 65 - "baseline-axes.test.cjs"
Cohesion: 0.33
Nodes (4): assert, bare, baseline, p1s

### Community 66 - "check-consistency.cjs"
Cohesion: 0.33
Nodes (3): fs, path, SITE

### Community 67 - "baseline-board.cjs"
Cohesion: 0.24
Nodes (12): absorbWorkerCreates(), addRecommendations(), applyBaselineImages(), asMatchProducts(), catalogProductForItem(), DEFAULT_CATEGORIES, foldKey(), fs (+4 more)

### Community 68 - "worker-http.test.cjs"
Cohesion: 0.40
Nodes (4): assert, os, path, { spawn }

### Community 69 - "vercel.json"
Cohesion: 0.40
Nodes (4): buildCommand, cleanUrls, headers, outputDirectory

### Community 71 - "Filament storefront research baseline"
Cohesion: 0.14
Nodes (13): Canonical taxonomy tree, Child sellable-SKU identity, Deterministic extraction pipeline, Filament storefront research baseline, Gathered baseline artifact, Isolated overrides, Laya corpus and safety, Normalization tables (+5 more)

### Community 77 - "harvestCategory"
Cohesion: 0.23
Nodes (12): attr(), closeElement(), discoverCards(), discoverProductLinks(), harvestCategory(), hasPriceText(), shapeKey(), assert (+4 more)

### Community 78 - "local-server.mjs"
Cohesion: 0.19
Nodes (11): MIME, PORT, PUBLIC, resolveStatic(), ROOT, ROUTES, SEED, sendResponse() (+3 more)

### Community 79 - "sanitizeBoard"
Cohesion: 0.24
Nodes (12): addItem(), emptyBoard(), fromProduct(), fromRunCard(), loadBackupPrinters(), sanitizeBoard(), sanitizeItem(), upsertItems() (+4 more)

### Community 80 - "worker-progress-order.test.cjs"
Cohesion: 0.17
Nodes (5): assert, fs, os, path, vm

### Community 81 - "metatech.js"
Cohesion: 0.33
Nodes (10): aisleFromName(), decodeEntities(), fetchPage(), fetchPageRetry(), huntMetatech(), parseMetatechCards(), { parseMoney }, parseTL() (+2 more)

### Community 82 - "pull-netlify-blobs.mjs"
Cohesion: 0.18
Nodes (5): auth, DEST, failed, keys, ROOT

### Community 83 - "tmp-upload.cjs"
Cohesion: 0.18
Nodes (9): candidate, env, fs, path, root, RUN, SITE, summary (+1 more)

### Community 84 - "harvest.test.cjs"
Cohesion: 0.20
Nodes (9): preferredPriceSource(), transactionPrice(), assert, { discoverInStockFilter }, { harvestCategory, isLikelyProductUrl, slugToTitle, readStockFromHtml, extractProductPage, transactionPrice, vatIncludedPrice, preferredPriceSource, isJunkAmount }, KEEP, { listingFromHarvest, shouldAddVat, shouldScrollPage }, REJECT (+1 more)

### Community 85 - "index.js"
Cohesion: 0.22
Nodes (4): cache, fetch(), notFound(), ROUTES

### Community 86 - "admin-uncertain.test.cjs"
Cohesion: 0.20
Nodes (8): assert, files, fs, path, sandbox, source, store, vm

### Community 87 - "backup-data.mjs"
Cohesion: 0.20
Nodes (9): absOut, args, EXCLUDE, INCLUDE, included, IMPORTANT: pass a RELATIVE archive path to tar. GNU tar parses "C:\..." in a, relOut, ROOT (+1 more)

### Community 88 - "product-images.js"
Cohesion: 0.33
Nodes (8): allowed(), { classifyFilament }, fold(), imageKey(), loadManufacturerImages(), manufacturerImages(), { printerMatchKey }, resolveImages()

### Community 89 - "admin-run-category.test.cjs"
Cohesion: 0.22
Nodes (8): assert, cards, context, data, fs, job, source, vm

### Community 90 - "admin-uncertain-actions.test.cjs"
Cohesion: 0.22
Nodes (7): assert, context, fs, listeners, notices, source, vm

### Community 91 - "search-bar-browser.test.cjs"
Cohesion: 0.22
Nodes (7): assert, catalog, fs, http, path, ROOT, server

### Community 92 - "stock-preview.test.cjs"
Cohesion: 0.22
Nodes (8): assert, checked, context, fs, mergedOffer, offers, source, vm

### Community 93 - "hunt-baseline.test.cjs"
Cohesion: 0.25
Nodes (7): assert, files, fs, path, sandbox, source, vm

### Community 94 - "laya-match.py"
Cohesion: 0.50
Nodes (7): encode(), feature(), load_agent(), Train and serve the catalog matcher backed by Laya's multilingual encoder., serve(), train(), variants()

### Community 95 - "tmp-audit-check.cjs"
Cohesion: 0.29
Nodes (7): acts, bad, COLORS, esc(), fs, merges, p

### Community 96 - "tmp-trace.cjs"
Cohesion: 0.25
Nodes (7): all, { decidePair, identity, score, taxonomy }, fs, taxA, taxB, xA, xB

### Community 97 - "tmp-trace2.cjs"
Cohesion: 0.25
Nodes (6): all, fs, path, { placeListings }, root, RUN

### Community 98 - "tmp-trace3.cjs"
Cohesion: 0.25
Nodes (7): cand, { decidePair, identity, taxonomy }, fs, milky, path, root, rows

### Community 99 - "tmp-trace4.cjs"
Cohesion: 0.25
Nodes (7): all, cand, fs, p, path, root, RUN

### Community 100 - "runClaimedJob"
Cohesion: 0.36
Nodes (8): api(), compactEvent(), nameFromUrl(), poll(), postComplete(), postHeartbeat(), postProgress(), runClaimedJob()

### Community 101 - "laya-match.cjs"
Cohesion: 0.33
Nodes (6): crypto, path, pending, score(), { spawn }, start()

### Community 102 - "admin-filament-picker.test.cjs"
Cohesion: 0.29
Nodes (6): assert, context, fs, options, source, vm

### Community 103 - "admin-shop-publish.test.cjs"
Cohesion: 0.29
Nodes (6): assert, context, fs, listeners, source, vm

### Community 104 - "ensureCategories"
Cohesion: 0.40
Nodes (6): addCategory(), categoryId(), ensureCategories(), patchItem(), renameCategory(), setItemCategory()

### Community 105 - "laya-place.test.cjs"
Cohesion: 0.33
Nodes (4): assert, catalog, { layaPick }, listing

### Community 107 - "tmp-junk.cjs"
Cohesion: 0.33
Nodes (5): c, dupes, fs, junk, seen

### Community 108 - "teknomarket.js"
Cohesion: 0.83
Nodes (3): collection(), huntTeknomarket(), parseProducts()

### Community 109 - "Cloudflare Pages deployment"
Cohesion: 0.50
Nodes (3): Cloudflare Pages deployment, Connect GitHub in Cloudflare, Current API boundary

## Knowledge Gaps
- **1284 isolated node(s):** `TAXONOMY`, `POLYMER_ALIASES`, `VARIANT_ALIASES`, `PACKAGING_ALIASES`, `COLOR_ALIASES` (+1279 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1403 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `placeListings()` connect `qwen-place.cjs` to `decidePair`, `tmp-trace2.cjs`, `baseline-board.cjs`, `qwen-website-job.cjs`, `catalog-union.cjs`, `product-match.cjs`, `product-match.test.cjs`, `compare-products.cjs`, `Vision place tests`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `itemForProduct()` connect `baseline-board.cjs` to `decidePair`, `admin-baseline.test.cjs`, `product-match.cjs`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `baselineReady()` connect `qwen-place.cjs` to `Baseline catalog`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `bindAppEvents()` (e.g. with `productCard()` and `runRowProblem()`) actually correct?**
  _`bindAppEvents()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `bind()` (e.g. with `goHome()` and `layoutTabs()`) actually correct?**
  _`bind()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `TAXONOMY`, `POLYMER_ALIASES`, `VARIANT_ALIASES` to the rest of the system?**
  _1284 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Robolink image CDN` be split into smaller, more focused modules?**
  _Cohesion score 0.003992015968063872 - nodes in this community are weakly interconnected._