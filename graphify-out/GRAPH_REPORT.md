# Graph Report - 3d_Price  (2026-09-21)

## Corpus Check
- 72 files · ~87,765 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1074 nodes · 2216 edges · 57 communities
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 181 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Storefront Interface
- Admin Interface
- Local AI Worker
- Search Ranking
- Stock Refresh
- Gemma Matching Guidance
- Product Identity Matching
- Website Harvest Jobs
- Merchant Hunting
- Catalog Classification
- Product Page Extraction
- Catalog Offer Merging
- AI Listing Placement
- Card Price Tests
- Money Parsing
- Price History
- Admin Catalog Operations
- Harvest Validation
- Review Board Tests
- Product Price Comparison
- Robolink Integration
- AI Product Scraping
- Product Link Discovery
- Admin Navigation Tests
- Rematching Tests
- HTML Card Parsing
- Image Fingerprints
- Image Similarity Tests
- Visual Placement Tests
- Catalog Regrouping Tests
- Visual Matching Tests
- Backup API Tests
- Merchant Purge Tests
- VAT Adjustment Tests
- Product Image Resolution
- Metatech Integration
- Catalog Backup Storage
- Filament Classification
- Owner Authentication
- Deduplication Tests
- Stale Search Tests
- Product Merge Keys
- Manufacturer Images
- Netlify Blob Storage
- Backup Interface Tests
- Search Bar Tests
- Admin AI Tests
- Admin Detail Tests
- Image Resolution Tests
- Teknomarket Harvesting
- Worker Job API
- Project Dependencies
- Merchant Price Operations
- Worker HTTP Tests
- Vercel Configuration

## God Nodes (most connected - your core abstractions)
1. `bindAppEvents()` - 41 edges
2. `bind()` - 31 edges
3. `escapeHtml()` - 25 edges
4. `extractProductPage()` - 24 edges
5. `runWebsiteJob()` - 23 edges
6. `esc()` - 20 edges
7. `identity()` - 19 edges
8. `parseCard()` - 18 edges
9. `parseMoney()` - 17 edges
10. `fold()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `main()` --indirect_call--> `huntRobolink()`  [INFERRED]
  scripts/import-robolink-images.cjs → api/robolink.js
- `saveJobs()` --calls--> `writeJSON()`  [EXTRACTED]
  netlify/functions/worker.mjs → lib/netlify-store.cjs
- `repriceShopVat()` --calls--> `withoutVat()`  [EXTRACTED]
  netlify/functions/admin.mjs → lib/parse-money.cjs
- `identity()` --calls--> `classifyFilament()`  [EXTRACTED]
  lib/product-match.cjs → api/filament-classify.js
- `taxonomy()` --calls--> `classifyFilament()`  [EXTRACTED]
  lib/product-match.cjs → api/filament-classify.js

## Import Cycles
- None detected.

## Communities (57 total, 0 thin omitted)

### Community 0 - "Storefront Interface"
Cohesion: 0.07
Nodes (95): activeTab(), aisleName(), applyI18n(), applyLang(), bestOffer(), bestPriceLabel(), bind(), goHome() (+87 more)

### Community 1 - "Admin Interface"
Cohesion: 0.08
Nodes (84): action(), activeJob(), adminFold(), adminMatches(), adoptDetectedUrl(), aiHtml(), aiStatusHtml(), allProducts() (+76 more)

### Community 2 - "Local AI Worker"
Cohesion: 0.06
Nodes (54): gemmaGrayMatch(), assert, fs, os, path, vm, ai, assert (+46 more)

### Community 3 - "Search Ranking"
Cohesion: 0.08
Nodes (35): fold(), filterSearch(), { fold }, isAnchor(), matchesSearch(), nameOf(), near(), rankSearch() (+27 more)

### Community 4 - "Stock Refresh"
Cohesion: 0.09
Nodes (16): ageHours(), checkOfferStock(), fetchPage(), { fold }, planStockChecks(), readStockPage(), refreshStock(), rollupProductStock() (+8 more)

### Community 5 - "Gemma Matching Guidance"
Cohesion: 0.09
Nodes (25): axisWords(), buildAllowedIdentities(), buildGemmaContext(), catalogHints(), enforceDecision(), gemmaDecide(), hardConflictsBetween(), idx (+17 more)

### Community 6 - "Product Identity Matching"
Cohesion: 0.12
Nodes (27): axesFromTitle(), axesOf(), { classifyFilament }, colorKey(), colorOf(), COLORS, conflicts(), decidePair() (+19 more)

### Community 7 - "Website Harvest Jobs"
Cohesion: 0.12
Nodes (28): classifyProductType(), extractIdentity(), fromUrls(), isTemplateUrl(), isLikelyProductUrl(), lastSegment(), needsLlm(), pathOf() (+20 more)

### Community 8 - "Merchant Hunting"
Cohesion: 0.12
Nodes (25): applyRecategorize(), brandFromName(), { classifyFilament }, decodeEntities(), fetchPage(), fetchPageRetry(), fs, { huntMetatech } (+17 more)

### Community 9 - "Catalog Classification"
Cohesion: 0.11
Nodes (24): BARE_WORDS, BRAND_BY_ALIAS, brandOf(), BRANDS, CNC_WORDS, COMBO_WORDS, DEFAULT_FEEDER, feederOf() (+16 more)

### Community 10 - "Product Page Extraction"
Cohesion: 0.13
Nodes (23): absUrl(), CARD_SELECTORS, cardImage(), cardPrice(), CONTAINER_TAGS, declaredLabel(), extractProductPage(), { fold, tokens, identity } (+15 more)

### Community 11 - "Catalog Offer Merging"
Cohesion: 0.11
Nodes (20): collapseByMagellan(), collapseShelf(), currencyCode(), pricesToTry(), { toTry, FALLBACK_TRY }, TRY_CURRENCY, unionCatalog(), FALLBACK_TRY (+12 more)

### Community 12 - "AI Listing Placement"
Cohesion: 0.13
Nodes (21): dist(), rankCandidates(), score(), similar(), catalogImageCounts(), crypto, { fold, score, similar, rankCandidates, taxonomy, axesOf, conflicts }, fs (+13 more)

### Community 13 - "Card Price Tests"
Cohesion: 0.09
Nodes (21): assert, { cardPrice, cardPriceDetail }, context, crowdedRow, detail, fixture, fs, millionsRow (+13 more)

### Community 14 - "Money Parsing"
Cohesion: 0.17
Nodes (20): normalizeOfferPrice(), checked(), CURRENCY_WORDS, currencyOf(), detectCurrency(), flagPriceOutliers(), foldTr(), isSuspectAmount() (+12 more)

### Community 15 - "Price History"
Cohesion: 0.11
Nodes (18): { DatabaseSync }, DEFAULT_FILE, fs, history(), path, record(), recordMany(), assert (+10 more)

### Community 16 - "Admin Catalog Operations"
Cohesion: 0.14
Nodes (14): applySelectedListings(), axesOf(), BACKUP_PARTS, cloneCatalog(), collapseDuplicates(), DEFAULT_DESK, duplicateClusters(), findById() (+6 more)

### Community 17 - "Harvest Validation"
Cohesion: 0.13
Nodes (17): canonicalizeCategoryUrl(), discoverInStockFilter(), fold(), { IN_STOCK_FILTER_LABEL, foldStock }, isJunkAmount(), isListingUrl(), mapStockStatus(), foldStock() (+9 more)

### Community 18 - "Review Board Tests"
Cohesion: 0.10
Nodes (17): adminSrc, apiContext, assert, byUrl, context, data, derived, fs (+9 more)

### Community 19 - "Product Price Comparison"
Cohesion: 0.20
Nodes (15): asListing(), compare_products(), { decidePair, score }, groupBestPrices(), loadRates(), rankByPrice(), toTry(), toUsd() (+7 more)

### Community 20 - "Robolink Integration"
Cohesion: 0.17
Nodes (15): decode(), huntRobolink(), imageManifest, page(), { parseMoney }, parseRobolink(), pick(), priceTL() (+7 more)

### Community 21 - "AI Product Scraping"
Cohesion: 0.21
Nodes (16): applyInStockFilterOnPage(), { ask, setEndpoint }, detectCurrency(), { discoverInStockFilter }, EXTRACT_SCHEMA, { extractIdentity, readStockFromHtml }, fetchHtml(), fetchListingHtml() (+8 more)

### Community 22 - "Product Link Discovery"
Cohesion: 0.16
Nodes (16): attr(), closeElement(), discoverCards(), discoverProductLinks(), extractCards(), harvestCategory(), hasPriceText(), outermost() (+8 more)

### Community 23 - "Admin Navigation Tests"
Cohesion: 0.12
Nodes (15): assert, context, data, fs, idleRuns, ids, links, listeners (+7 more)

### Community 24 - "Rematching Tests"
Cohesion: 0.12
Nodes (12): answer, askDir, assert, catalog, fs, { gemmaPick }, listing, Module (+4 more)

### Community 25 - "HTML Card Parsing"
Cohesion: 0.32
Nodes (15): cardBadge(), cardName(), cardPriceDetail(), cardPriceNumber(), classContains(), classList(), extractElements(), fallbackProductish() (+7 more)

### Community 26 - "Image Fingerprints"
Cohesion: 0.21
Nodes (14): bitsHex(), browser(), cacheData(), COS, download(), fingerprint(), fingerprintBuffer(), fs (+6 more)

### Community 27 - "Image Similarity Tests"
Cohesion: 0.14
Nodes (13): hamming(), shutdown(), visualScore(), assert, checker, flat, g1, gradient (+5 more)

### Community 28 - "Visual Placement Tests"
Cohesion: 0.13
Nodes (11): assert, bottle, cache, catalogFile, coffee, dir, fs, os (+3 more)

### Community 29 - "Catalog Regrouping Tests"
Cohesion: 0.15
Nodes (13): assert, catalog, catalogFile, dir, fs, os, path, post() (+5 more)

### Community 30 - "Visual Matching Tests"
Cohesion: 0.14
Nodes (12): assert, buffer, conflicts, { conflicts: axisConflicts, identity }, { decidePair, rankCandidates }, gray, hard, KE (+4 more)

### Community 31 - "Backup API Tests"
Cohesion: 0.17
Nodes (10): assert, call(), files, fs, path, req(), sandbox, source (+2 more)

### Community 32 - "Merchant Purge Tests"
Cohesion: 0.18
Nodes (10): assert, context, fs, names(), products(), R(), row(), source (+2 more)

### Community 33 - "VAT Adjustment Tests"
Cohesion: 0.15
Nodes (7): assert, context, fs, sandbox, source, store, vm

### Community 34 - "Product Image Resolution"
Cohesion: 0.45
Nodes (11): absolutize(), attr(), fromBackground(), fromImgs(), fromJsonLd(), fromMeta(), fromPicture(), isJunkImage() (+3 more)

### Community 35 - "Metatech Integration"
Cohesion: 0.33
Nodes (10): aisleFromName(), decodeEntities(), fetchPage(), fetchPageRetry(), huntMetatech(), parseMetatechCards(), { parseMoney }, parseTL() (+2 more)

### Community 36 - "Catalog Backup Storage"
Cohesion: 0.22
Nodes (11): readJSON(), writeJSON(), backupKey(), countsOf(), loadAll(), readBackupIndex(), saveJobList(), slugifyName() (+3 more)

### Community 37 - "Filament Classification"
Cohesion: 0.31
Nodes (9): classifyFilament(), colorFromName(), pickFirst(), POLYMER_ORDER, POLYMERS, specsFromName(), stripSpecs(), tidyName() (+1 more)

### Community 38 - "Owner Authentication"
Cohesion: 0.27
Nodes (6): authReady(), crypto, ownerFromHeaders(), parseCookies(), verify(), verifyPassword()

### Community 39 - "Deduplication Tests"
Cohesion: 0.20
Nodes (6): assert, context, fs, source, store, vm

### Community 40 - "Stale Search Tests"
Cohesion: 0.20
Nodes (8): after, assert, before, fs, http, path, ROOT, server

### Community 41 - "Product Merge Keys"
Cohesion: 0.56
Nodes (7): brandKey(), filamentMatchKey(), fold(), listingTokens(), mergeGroup(), mergeSimilar(), printerMatchKey()

### Community 42 - "Manufacturer Images"
Cohesion: 0.33
Nodes (8): allowed(), { classifyFilament }, fold(), imageKey(), loadManufacturerImages(), manufacturerImages(), { printerMatchKey }, resolveImages()

### Community 43 - "Netlify Blob Storage"
Cohesion: 0.31
Nodes (6): blobsContext(), deleteKey(), encodeKey(), { flagPriceOutliers }, PRICE_CHECKED_KEYS, request()

### Community 44 - "Backup Interface Tests"
Cohesion: 0.25
Nodes (8): assert, backup, data(), fs, http, path, ROOT, server

### Community 45 - "Search Bar Tests"
Cohesion: 0.22
Nodes (7): assert, catalog, fs, http, path, ROOT, server

### Community 46 - "Admin AI Tests"
Cohesion: 0.25
Nodes (6): assert, context, desk, fs, source, vm

### Community 47 - "Admin Detail Tests"
Cohesion: 0.25
Nodes (7): ADMIN, assert, fs, http, path, payload, server

### Community 48 - "Image Resolution Tests"
Cohesion: 0.25
Nodes (7): assert, clone, lazy, ld, og, { resolveProductImage, isJunkImage, scrubClonedImages }, srcset

### Community 49 - "Teknomarket Harvesting"
Cohesion: 0.38
Nodes (6): handler(), loadCatalog(), readSources(), collection(), huntTeknomarket(), parseProducts()

### Community 50 - "Worker Job API"
Cohesion: 0.33
Nodes (3): mergeCards(), nameFromUrl(), saveJobs()

### Community 51 - "Project Dependencies"
Cohesion: 0.29
Nodes (6): dependencies, playwright, description, name, private, playwright

### Community 52 - "Merchant Price Operations"
Cohesion: 0.70
Nodes (5): hostOfUrl(), offerFromShop(), purgeShop(), repriceShopVat(), shopKeys()

### Community 54 - "Worker HTTP Tests"
Cohesion: 0.40
Nodes (4): assert, os, path, { spawn }

### Community 55 - "Vercel Configuration"
Cohesion: 0.40
Nodes (4): buildCommand, cleanUrls, headers, outputDirectory

## Knowledge Gaps
- **401 isolated node(s):** `POLYMERS`, `VARIANTS`, `POLYMER_ORDER`, `{ resolveImages, loadManufacturerImages }`, `fs` (+396 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 481 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `fold()` connect `Search Ranking` to `Stock Refresh`, `Product Identity Matching`, `Website Harvest Jobs`, `Product Page Extraction`, `AI Listing Placement`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `parseMoney()` connect `Money Parsing` to `Metatech Integration`, `Merchant Hunting`, `Product Page Extraction`, `Robolink Integration`, `AI Product Scraping`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `classifyFilament()` connect `Filament Classification` to `Merchant Hunting`, `Teknomarket Harvesting`, `Manufacturer Images`, `Product Identity Matching`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `bind()` (e.g. with `goHome()` and `layoutTabs()`) actually correct?**
  _`bind()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `POLYMERS`, `VARIANTS`, `POLYMER_ORDER` to the rest of the system?**
  _401 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Storefront Interface` be split into smaller, more focused modules?**
  _Cohesion score 0.07300652219650747 - nodes in this community are weakly interconnected._
- **Should `Admin Interface` be split into smaller, more focused modules?**
  _Cohesion score 0.0772520716385993 - nodes in this community are weakly interconnected._
## Graph Health Warning

135 edges have dangling endpoints; 176 same-endpoint edges collapse in the undirected graph. Relationships may be incomplete.
