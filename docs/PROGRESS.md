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

### Eval set — `docs/laya-eval.jsonl` (built, verified)

375 pairs, **183 same / 192 different**, produced by `node scripts/build-laya-eval.cjs`
(deterministic, offline, no model). Labels are DERIVED FROM IDENTITY, not from my opinion: "same"
only when both titles come from one baseline row (aliases + surface variants of that row), "different"
only when the two rows carry different identityIds. 15 hand-written hard edges are kept in full:
word-order H2C pair, combo-vs-bare, 10W-vs-40W, tarzi/muadil knockoffs, nozzle/plate/laser-module
accessories, variant, model, fold.

Two broken versions came before this one and are worth remembering:
- 437 same / 12 different - a model that always answered "same" scored 97%.
- 643 same / 4133 different - one that always answered "different" scored 86%.
Both were caught by printing the label split, not by trusting the generator. The script now refuses to
write a set that is under 200 pairs or under 100 per label.

### Baseline measured — `node scripts/eval-magellan.cjs`

Magellan alone, no AI, on the 375 balanced pairs:

```
accuracy      : 320/375  (85.3%)
false-merge   :   5/192  ( 2.6%)   <- the expensive error
false-split   :  50/183  (27.3%)

knockoff         0/2      both merged the clone into the genuine printer
accessory        1/4      nozzle and plate spare parts merged into the printer
word-order       1/2      the H2C pair split: "create: different technology"
surface         131/180   49 same-identity variants split
cross-identity  180/180   combo-vs-bare, laser-watt, model, variant, fold all correct
```

**Every false merge is a knockoff or a spare part.** Combo/AMS/watts/model never merged wrongly
- the deterministic axes do their job. The two fixable gaps are both "this listing is not that
product" cases, and neither is a similarity problem:

1. `decidePair` in `lib/product-match.cjs` has no compatibility/accessory guard. The guard exists
   (`COMPATIBILITY_STRONG/WEAK` in `lib/compare-to-baseline.js`) but only the baseline layer calls it,
   so the matcher still merges `A1 tarzi` and `A1 muadil` into the real A1. Porting that guard into
   `decidePair` should take false-merge from 5 to ~0.
2. The 49 surface splits are the real accuracy work: they are all same-identity pairs, so each one is
   a duplicate card for the user. Needs looking at actual examples before changing anything.

### Bugs found in my own tooling (both caught by printing numbers, not by trusting it)

- The eval generator defined a balanced sample but its write line still wrote the unbalanced list:
  it printed "pairs: 375" while the file held 4776. The first measurement (96.4% accuracy) was taken
  on that unbalanced file and was meaningless. Fixed by line number; the file and the print now agree
  at 375 (asserted with `wc -l`).
- An earlier patch's search string had the wrong escaping and silently no-opped, which is how the
  above got through. Patches now assert on the replacement count.

### Fine-tuning: blocked by the package's API, not by effort

Inspected the installed package rather than assuming:
```
.venv-laya/Lib/site-packages/laya/  ->  __init__ agent common email lang presets router
Router public API                   ->  attach load loaded predict preload route system_one unload
agent.py functions                  ->  _fix_tokenizer_config _verify_compatibility __init__
                                        _to_internal system_one load
```
There is **no trainer**, no `fit`, no loss/backward/optimizer, and **no embedding method** - so there is
nothing to freeze, nothing to attach a head to, and no way to pull a representation out of the model
through its public surface. The package is inference-only.

Fine-tuning therefore means reimplementing the RL agent from the HF repo source
(`rl_agent_api.py`, `rl_common.py`, `rl_agent_config.json`), which is research-scale work, not a
session step. The alternative - a small classifier on Laya embeddings - needs the encoder's hidden
states, reachable only by monkey-patching `laya.agent` internals, and would then be trained on a few
hundred pairs on CPU.

### But first: fine-tuning is the wrong lever right now

The measurement says so. Of Magellan's 5 false merges, **every one is a knockoff or a spare part**
(`A1 tarzi`, `A1 muadil`, a nozzle, a plate). Those are not similarity errors - they are "this listing
is not that product" cases, and a wordlist rule already gets them right everywhere else in the
codebase. Porting `COMPATIBILITY_STRONG/WEAK` into `decidePair` fixes all 5 deterministically, with
no model, no latency, and no GPU.

Laya zero-shot got those same cases wrong (called an A1 nozzle "same" as an H2C Combo at 0.877 with
confidence 0.463). Training it on 375 CPU pairs to maybe match a guard that already exists would be
effort spent in the wrong place.

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
