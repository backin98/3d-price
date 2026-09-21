# PROGRESS

## Part A — worker/site integrity (DONE, verified)

- **404 does not exist.** `worker/online-worker.cjs:53` polls
  `/.netlify/functions/worker?action=poll`. Live: 401 without token, 200 with. The 404s were
  deploy windows (six deploys that day, function swapped while the worker polled).
- **32-vs-0 explained.** `catalog.json` = published (what `/api/hunt` serves);
  `catalog.json + candidate.json` = what the worker matches against (`worker.mjs:113-115`).
  The worker was counting unpublished candidates. Source of truth for the storefront: `catalog.json`.
  Now consistent, verified live: `count: 32`.
- **Polling backoff.** `claimAndRun()` swallowed poll errors and returned false, so the loop never
  saw a failure and the backoff was unreachable. It now rethrows; the loop owns logging + backoff.
  Verified against a dead site: attempts 1-5 waited 2, 4, 8, 16, 32s. Scheduled-scrape caller guarded.
- **Consistency check.** `node scripts/check-consistency.cjs` — prints published vs working, exits
  non-zero on disagreement. Run after every deploy.
- **Supervision.** pm2 7.0.4 is unusable here: `TypeError: Cannot read properties of undefined
  (reading 'deploy')` inside its own `API._startJson` on Node 26. Ignore `scripts/worker-setup.sh`.
  Use `scripts/worker-supervise.cjs`: restart on exit, backoff to 60s, output teed to `work/worker.log`.
  Verified by killing the child (restarted, health 200).
- **Boot persistence (no admin).** `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\3d-price-worker.cmd`.
  Verified by killing everything and running the .cmd itself: health 200, log written.
- **Clone guard bug.** Both compatibility regexes held literal backspace bytes (0x08) where `\b` was
  intended, so the guard was dead code and "A1 tarzı" matched the real Bambu A1 row. Fixed by byte
  replacement. Confirmed: `A1 tarzı` / `muadil` -> unknown; `AMS uyumlu` on a real H2S -> match.
- Tags: `2stable-5 -> c77190f`, `2stable-6 -> 0272ddb`. Suite: 33/33.

## Part B — Laya (STARTED, install only)

- `laya 0.3.4` installed and imports on Python 3.14.5 with `torch 2.14.0+cpu`, `transformers 5.17.0`,
  into `.venv-laya`. `USE_TF=0`. No GPU.
- **The documented API is wrong.** There is no `preload=True`. Real signatures:
  `Router.__init__(self, models: Dict[str,str]|None=None, device=None, token=None, max_loaded=1, default='english', ...)`
  `Router.predict(self, state: str|dict|list, questions: Dict, model=None, task=None, lang=None)`
  Warming means passing `models={...}` with `max_loaded`. Anyone building from the old notes fails at
  line one.
- **Next:** smoke test — `Router()` warm-up, 3 real Turkish listings, print raw output + latency per
  checkpoint (default / multilingual / typed-decisions) to `docs/laya-smoke.txt`.

## Known issues

- Laya weights not downloaded yet; smoke test not run, so no latency or accuracy numbers exist.
- No `laya_server/`, no `lib/laya-client.cjs`, no gray-band wiring, no eval set, no fine-tune.
- `guide-gemma.cjs` is still wired into the gray band (Laya not wired in).
- CPU-only: local fine-tuning may need a Colab notebook.
- `scripts/worker-setup.sh` is dead on this machine (calls the crashing pm2). Kept for other Nodes.

## Conventions

- Small steps; commit after each. Never report as done without running it.
