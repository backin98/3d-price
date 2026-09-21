# 3D Price

A price-comparison catalogue for 3D printers and filament sold by Turkish retailers. A local worker
scrapes the shops; a Netlify site serves the storefront and the admin.

## How it runs

Two halves, and the split matters:

- **Netlify** (`netlify/functions/`) — storefront and admin only. Reads and writes the catalogue in the
  Netlify Blob store through `lib/netlify-store.cjs`. It does not scrape.
- **The local worker** (`worker/online-worker.cjs`) — runs on a PC, owns harvest, matching and the
  "Magellan" placement engine. It polls the site for jobs and reports progress back.

Nothing scrapes inside a Netlify function: the timeout there is 30 seconds, and the work is minutes.

### Running the worker

```
node worker/online-worker.cjs          # or: node scripts/worker-supervise.cjs to auto-restart it
```

It needs `INGEST_TOKEN` in a local `.env` (gitignored — never commit it). `ONLINE_URL` defaults to the
production site. `scripts/worker-setup.sh` exists for pm2, but **pm2 crashes on Node 26**
(`TypeError ... reading 'deploy'` inside pm2's own API), so `scripts/worker-supervise.cjs` is the
working supervisor: it restarts the worker on exit with backoff and tees output to `work/worker.log`.

### Tests

```
for t in scripts/*.test.cjs; do node "$t" || echo "FAIL $t"; done
```

35 files, all green on `stable-4`. They are plain Node scripts with no framework — a failing file exits
non-zero.

## Layout

| Path | What it is |
|---|---|
| `lib/product-match.cjs` | Magellan: Turkish-folded token matching, identity axes, hard conflicts, `decidePair` |
| `lib/catalog-index.cjs` | the brand/model/feeder reference as data (25 brands, 217 model aliases) |
| `lib/baseline-catalog.js`, `lib/compare-to-baseline.js`, `lib/title-normalize.js` | the confirmed catalogue: one row per identity, locale-aware comparison |
| `lib/qwen-place.cjs` | placement: merge / hold / create, and the confirmed-identity gate |
| `lib/parse-money.cjs` | price reading, per-kind floor, outlier flagging |
| `worker/online-worker.cjs` | harvest, job polling, progress |
| `public/admin/admin.js` | the admin UI (one large file; markup is template literals) |
| `scripts/mine-listings.cjs` | collects real listings from disk into `docs/real-listings.jsonl` |
| `docs/PROGRESS.md` | chronological record of what was built, verified, and left undone |

## Invariants that must not be broken

These are hard rules, not preferences, and no model is allowed to override them:

- same shop + same URL = one offer
- combo ≠ bare, different feeder generation ≠ same, 10W ≠ 40W laser, kit ≠ assembled
- a listing that says it is *like* or *for* another product (`tarzı`, `muadil`, `uyumlu`, nozzle/plate
  spares) is not that product
- the matcher never invents URLs, colours or weights
- nothing reaches the storefront until an admin publishes the candidate

## KNOWN BUG (open)

**Running a Robolink job pulls Rhino listings.**

Evidence gathered so far, so nobody repeats it:

- The shop→category mapping is **correct**: `robolink` → `3d Printers` →
  `https://www.robolinkmarket.com/3d-yazicilar`, and `rhino` → its own rhino3dprinter.com URLs. Fetched
  live from the worker's `?action=poll` payload.
- The admin validates `urlHostOf(url) === shopHostOf(pickedShop)` before queueing a run, so a
  cross-shop URL should be refused at the form.
- The bug is reproducible on `stable-4`, so it was not introduced by the reverted multi-shop form
  (`feat/multi-shop-run`).

Not yet established: which entry point produced the job (a form submit that bypassed the host check, a
queued job whose stored `url` is a Rhino URL, or the worker ignoring the shop and using another
source). The next step is to read the offending job record's stored `url` and `site` fields — that
alone should identify it.

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
