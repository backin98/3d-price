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

## Part B — Laya (install + smoke test DONE; zero-shot is NOT trustworthy)

Toolchain: `laya 0.3.4`, `torch 2.14.0+cpu`, `transformers 5.17.0`, Python 3.14.5, `USE_TF=0`, in
`.venv-laya`. Weights: `multilingual/model.safetensors` (644 MB) cached under
`~/.cache/huggingface/hub/models--convaiinnovations--laya`. Full repo is 2.4 GB (three checkpoints).

### CORRECTION: `preload=True` DOES exist

I earlier wrote that it did not, because I read a truncated signature. The real one:
```
Router.__init__(self, models: Dict[str,str]|None=None, device=None, token=None, max_loaded=1,
                default='english', auto_task_detection=False, standalone_repos=False,
                preload: bool = False)
Router.predict(self, state: str|dict|list, questions: Dict, model=None, task=None, lang=None) -> Dict
```
`Router()` builds in 0.0s (lazy); the model loads on the first `predict`.

### Smoke test — `scripts/laya-smoke.py` -> `docs/laya-smoke.txt`

Latency: **first call 18.0s** (includes load), **every later call 0.10-0.11s**. Fast enough to be a
sidecar once warm.

Response shape (verified): `res["answers"][qid]` holds `{"type","noul"|"choice","probabilities",
"confidence","action"}`; `res["routing"]` reports which checkpoint answered. `usage.output_tokens:0`
- it is an encoder, it never generates.

Routing: Turkish text is auto-routed to the multilingual checkpoint, but the detector labels it
`language: "fr"` ("Latin script but language looks like 'fr', not English"). Right destination,
wrong label; passing `lang="tr"` explicitly is worth trying.

### Results on real Turkish titles (multilingual checkpoint)

| listing | question | Laya | truth | verdict |
|---|---|---|---|---|
| Bambu Lab H2C 10 Watt Combo 3D Yazici | same as "H2C Combo Laser 10 Watt"? | **different** (0.339/0.661, conf 0.076) | same | **WRONG - false split** |
| Bambu Lab H2C Combo Laser 10 Watt 3D Yazici | same as "H2C Combo Laser 10 Watt"? | same (0.9462, conf 0.698) | same | ok (trivially identical strings) |
| Bambu Lab A1 tarzi nozzle uyumlu yedek parca | is an actual printer? | **yes** (0.857) | no, spare part | **WRONG** |
| Bambu Lab A1 tarzi nozzle uyumlu yedek parca | same as "H2C Combo Laser 10 Watt"? | **same** (0.877) | no | **BADLY WRONG** |

It failed the single case the whole task was about (the word-order H2C pair) and called an A1 nozzle
accessory "same" as an H2C. Confidences are low (0.08-0.70), which matches the model card's
near-chance zero-shot number.

**Consequence for thresholds:** with auto-accept at 0.90 a set threshold, NO observed answer reaches
it - every decision would fall to admin review, so Laya as an auto-decider does nothing useful today.

### Next
Fine-tune (freeze the encoder, train the decision head) on labeled pairs, or train a small
classifier on Laya embeddings. Do not wire Laya into the gray band until it beats Magellan alone on
false-merge rate.

## Known issues

- Laya weights not downloaded yet; smoke test not run, so no latency or accuracy numbers exist.
- No `laya_server/`, no `lib/laya-client.cjs`, no gray-band wiring, no eval set, no fine-tune.
- `guide-gemma.cjs` is still wired into the gray band (Laya not wired in).
- CPU-only: local fine-tuning may need a Colab notebook.
- `scripts/worker-setup.sh` is dead on this machine (calls the crashing pm2). Kept for other Nodes.

## Conventions

- Small steps; commit after each. Never report as done without running it.
