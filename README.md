# 3D Price

A price-comparison catalogue for 3D printers and filament sold by Turkish retailers. Everything runs on
your PC: the local host serves the storefront and the admin, and the local worker scrapes the shops
into it. Netlify and Cloudflare are later options; neither is needed to run the site.

## Run it on your PC (the default)

One-time setup (Node 20 or newer):

```
npm install
npx playwright install chromium     # the browser the worker scrapes with, if it is not there yet
npm run owner-password              # your admin password; also makes SESSION_SECRET and INGEST_TOKEN
```

The secrets land in `.dev.vars` in the repo folder. It is gitignored, like `.env`: never commit either.
The local host and the worker both read `.env` and then `.dev.vars`.

Then, in two terminals:

```
npm run local        # storefront http://127.0.0.1:8890/    admin http://127.0.0.1:8890/admin/
npm run worker       # the scraper: it takes shop runs from the local host
```

The worker talks to `http://127.0.0.1:8890` unless `ONLINE_URL` says otherwise (PowerShell:
`$env:ONLINE_URL="http://127.0.0.1:8890"; npm run worker`). `node scripts/worker-supervise.cjs` restarts
it whenever it exits and tees its output to `work/worker.log` (pm2 crashes on Node 26, so not pm2).

A shop run, start to finish: admin → **Shops** (a shop and its category URLs, one per printer or filament
page) → queue a run → **Shop runs**, the review board → **Select all** → **Save & publish selected**
publishes what matches your baseline → **Uncertain** for the rest (new products, spools of a family the
baseline does not know): check, then publish → the storefront. Listings a run holds out as another
category (a colour module or hotend on a printer page) are marked ⚠ on the board: Discard them or add
the category; bulk publishing leaves them alone.

**Where the data lives.** `work/local-store/` holds the catalog, baseline, desk (shops, banners, pins),
jobs and product images. It is tracked in git, all of it, so a commit carries your catalog to another
machine and a pull brings one in (restart `npm run local` after a pull that touches it).
`npm run backup` snapshots it into `work/backups/`, which is not in git.

### Checks

```
npm test               # every scripts/*.test.cjs (plain Node scripts, no framework)
npm run e2e            # offline end to end on saved pages: shop run → board → publish → storefront
npm run shop-report    # the live shops: every enabled shop and category, twice → report.md
```

`npm run e2e` needs no network. It replays the shop pages in `scripts/fixtures/pages` through the real
worker, works the admin page in Chromium the way you would (discard held-out listings, Select all, Save &
publish, Uncertain), checks what the storefront serves, then runs the shops again to prove nothing moves.

`npm run shop-report` reaches the real shops. Per category it compares the listings found with what the
category page shows, checks prices (the full VAT-inclusive price, never an installment), stock and images
against a random sample of live product pages, reads filament polymer / type / colour / weight /
diameter, and diffs the two passes. It never publishes and only copies your store. Options:
`--shop rhino,robolink`, `--once`, `--sample 8`, and `--replay <pages folder>` to run it again offline
from the pages it saved. It writes `work/shop-report/<time>/report.md`: paste that back for review.

## Hosting later

None of this is needed to run the site.

- **Netlify** — paused: the free usage ran out. `netlify/functions/*.mjs` are the same handlers the local
  host serves; on Netlify they read and write Netlify Blobs through `lib/netlify-store.cjs`. Nothing
  scrapes inside a function (the limit is 30 seconds, the work is minutes): the worker always runs on a
  PC. To go back: deploy, set `OWNER_PASSWORD_HASH`, `SESSION_SECRET` and `INGEST_TOKEN` in the site's
  environment, and start the worker with `ONLINE_URL=https://<your-site>.netlify.app`.
  `npm run pull-blobs` copies what is still in Netlify Blobs into the local store.
- **Cloudflare** — see [docs/CLOUDFLARE_PAGES.md](docs/CLOUDFLARE_PAGES.md). The static site can live on
  Pages. The API cannot as it is: Workers Free allows 10 ms of CPU per request and `/api/hunt` needs far
  more (that is why the local host exists).

Whatever the host, the worker's `ONLINE_URL` points at it and `INGEST_TOKEN` matches on both sides.

## Layout

| Path | What it is |
|---|---|
| `lib/product-match.cjs` | Magellan: Turkish-folded token matching, identity axes, hard conflicts, `decidePair` |
| `lib/catalog-index.cjs` | the brand/model/feeder reference as data (25 brands, 217 model aliases) |
| `lib/baseline-catalog.js`, `lib/compare-to-baseline.js`, `lib/title-normalize.js` | the confirmed catalogue: one row per identity, locale-aware comparison |
| `lib/qwen-place.cjs` | placement: merge / hold / create, and the confirmed-identity gate |
| `lib/product-type.cjs` | what a listing is: printer, filament, resin, part/accessory, laser, scanner |
| `lib/page-archive.cjs` | record (`SCRAPE_RECORD_DIR`) and replay (`SCRAPE_REPLAY_DIR`) shop pages |
| `scripts/local-stack.cjs` | the local host + worker on a throwaway store, for the two scripts below |
| `scripts/e2e-local-run.cjs` | `npm run e2e`: offline end to end through the real admin page |
| `scripts/shop-report.cjs` | `npm run shop-report`: every live shop and category, checked twice |
| `lib/parse-money.cjs` | price reading, per-kind floor, outlier flagging |
| `worker/online-worker.cjs` | harvest, job polling, progress |
| `public/admin/admin.js` | the admin UI (one large file; markup is template literals) |
| `scripts/mine-listings.cjs` | collects real listings from disk into `docs/real-listings.jsonl` |
| `docs/PROGRESS.md` | chronological record of what was built, verified, and left undone |

## Invariants that must not be broken

These are hard rules, not preferences, and no model is allowed to override them:

- same shop + same URL = one offer
- combo ≠ bare, different feeder generation ≠ same, 10W ≠ 40W laser, kit ≠ assembled, and a bundle that
  adds hardware (enclosure, dryer, filament) ≠ the machine alone
- a listing that says it is *like* or *for* another product (`tarzı`, `muadil`, `uyumlu`, nozzle/plate
  spares) is not that product; parts, modules and lasers on a printer page are held out as another
  category and never published in bulk
- the matcher never invents URLs, colours or weights
- a run's review board holds that run's own listings only
- a URL you published is refreshed on its row by the next run, never held again or moved silently
- nothing reaches the storefront until an admin publishes the candidate

## Fixed bugs, and the tests that pin them

### A Robolink run showed Rhino listings

**Cause.** The worker matches a run against the live catalog *plus the unpublished candidate*
(`worker.mjs` `unionCatalog`), so the candidate a run uploads carries every other shop's pending
offers. On `complete`, the server turned every candidate offer that was not yet live into a card of
the finishing run. After a Rhino run that was not published, the next Robolink run's review board
was full of Rhino listings. The job records were never wrong: their `url` was always Robolink's.

**Fix.** A run's cards come only from its own shop's host (`sameShop` in `worker.mjs`, for both
`complete` and `progress`). Pinned by `scripts/worker-shop-cards.test.cjs`, which fails on the old
code. The review board also says so when, with no run picked, it falls back to an older run with
cards (the newest one found none) — that fallback used to look like the same bug.

### Found by the end-to-end run (`npm run e2e`)

- **A filament board showed the same shop's printers.** The `complete` fix above kept other shops out,
  but an unpublished listing from another run of the *same* shop still became a card. A listing the run
  did not report is now taken only when its offer was checked during the run, and for the run's own
  cards the candidate row only fills blanks (it had replaced the shop title, colour and weight with the
  catalog row's). `scripts/worker-shop-cards.test.cjs`.
- **The category page was a card** ("3d yazicilar"): the worker's closing `done` event carries the
  category URL. Dropped at the worker, the server and the board (old runs too). Same test.
- **Held-out modules looked like printers on the board.** The worker stripped the mismatch mark from
  event items, so the ⚠ banner and Discard / Create category never showed. Same test.
- **Every spool was held against the baseline.** `taxonomy()` wrote `1000` and `1.75` back onto each
  listing without units; the next match read that as no diameter, and the admin publish dropped the
  weight from the offer. `scripts/filament-run-fields.test.cjs`, with the missing colours (Desert Tan,
  Violet, Lacivert = Navy Blue, Ivory, …) and the e-commerce registry badge (`etbis.ticaret.gov.tr`) in
  Rhino's footer that was harvested as a spool.
- **Badges replaced product photos.** Rhino nests its "STOKTAN TESLİM" / "Dropshipping" badge in the
  card; a lazy `<div>…</div>` match kept it, and the clone scrub then blanked every card that shared it.
  `scripts/resolve-product-image.test.cjs` (every listing on the saved pages has its own photo).
- **A second run held what the first published** (a gray match elsewhere, the new-product gate, a
  confirmed identity that is the row itself) and stamped each spool's colour on its family row.
  `scripts/rerun-place.test.cjs`.
- **"PLA+" read as a printer bundled with filament.** The bundle rule added on this branch counted the
  "+" of a polymer name as a bundle joiner; against your catalog it would have split 116 published
  spools from their family rows. Bundles are printer-only now and "+" must stand alone. Also "AMS2 Pro"
  is now read as the AMS 2 Pro. `scripts/match-rules.test.cjs`.

### Colours sold as options, and filament packs

- **A shop with one card per filament model gave colourless listings** (Filament Marketim lists the
  model; the colours are options on the product page). A filament listing whose title names no colour
  now has its product page read (`lib/product-variants.cjs`: Shopify, WooCommerce, ikas, Ticimax-style
  page data, schema.org groups, a plain colour dropdown, or colour links to their own pages), and each
  in-stock colour becomes its own listing with its own URL, price, stock and picture; the family card
  leaves the board. A sold-out option no longer makes the whole page "out of stock", and colour pages
  added while a batch was being read are no longer skipped. `scripts/filament-variants.test.cjs`, on
  pages in each platform's markup (`scripts/fixtures/pages/variants`).
- **Packs** ("4'lü set", "10 adet", "4x1kg", "4 renk set", "10 al 9 öde", "bundle") are read from the
  title, or set on the card (**Pack** and **Spools in pack**, next to Weight). A pack never merges with a
  single spool or a pack of another size, never auto-matches a single-spool baseline model, is published
  as its own product, and shows on the storefront as "4'lü paket" with a price per spool.
  `scripts/filament-bundles.test.cjs`.

## Gotchas that have already cost time here

- **Regexes must be byte-checked.** Three separate regexes in this repo contained literal `0x08`
  backspace bytes where `\b` was intended, so they never matched and the guards were silently dead.
  Verify with `node -e 'console.log((require("fs").readFileSync(F,"utf8").match(/\u0008/g)||[]).length)'`
  — it must be 0.
- **Line endings.** The repo stores LF and checks out CRLF. Exact-string edits against a CRLF working
  copy silently miss; normalise to LF before editing.
- **`data/online-catalog.json` is a runtime snapshot**, rewritten by the worker. It is tracked but it is
  not a stable input.
- Never slice a source file by brace or index search — use exact-string replacement.
