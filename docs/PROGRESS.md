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

### Step 1 DONE: compatibility guard ported into decidePair

`isNotTheProduct()` at `lib/product-match.cjs:324-331`, checked as the first statement of `decidePair`.
Strong words (`tarzi benzer muadil alternatif replacement for for use with`) and part nouns (nozzle,
nozul, hotend, extruder, plenum, yedek parca, plaka, plate, kabin, enclosure, tabla, termistor,
kayis, filtre, icin) disqualify a merge. `uyumlu/uygun/compatible` deliberately do NOT.

Re-measured on the same 375 pairs:
```
accuracy    85.3% -> 86.7%
false-merge  5/192 -> 0/192      (was every error of this class)
knockoff     0/2  -> 2/2
accessory    1/4  -> 4/4
```
Suite still 33/33.

**The backspace bug recurred.** My own new regexes contained 4 more literal 0x08 bytes instead of
``, so the guard silently did nothing and the first measurement after adding it was unchanged to
the digit (320/375 both times). Found only by dumping char codes again. Any regex written into this
repo by a tool must be byte-checked - this is now the second time.

### Step 2 analysis: the 49 false splits are mostly MY GENERATOR's fault

The `token order shuffled` variant did `words.slice(2).reverse()`, which reverses the model core:
```
A: Anycubic kobra 2 max Combo ace pro 3D Yazici
B: Anycubic kobra Yazici 3D pro ace Combo max 2     <- word salad, no shop writes this
```
Magellan splitting that is not a matcher weakness. Of the 50 false splits, ~49 are this variant and
1 is genuine (the hand-written H2C pair). So the 27.3% false-split figure is inflated by unfair
pairs and the true rate is far lower. Fixing the generator to reorder only trailing modifiers
realistically is step 2's work.

### Corrections I got wrong earlier (for the record)

- I said the pip package had nothing to fine-tune. True of the package, FALSE overall: the GitHub
  repo has `notebooks/laya_finetune_typed_decisions_2xT4_kaggle.ipynb` with `build_model` and
  `proper_reward` from `laya.common`. I inspected one surface and asserted about the whole system.
- I said the guard fixes 85% of errors. Wrong arithmetic: 5 false merges vs 49 false splits means it
  fixed 5 of 54, about 9%. Splits are the dominant problem, not merges.

### Step 1 FINAL: guard narrowed, suite green, false-merge 0

The first version of the guard was too aggressive and broke three tests. The failure named the reason:
`"Bambu Lab P1S AMS 2 Pro Combo 3D Yazici Cift Nozul"` - **Cift Nozul (dual nozzle) is a FEATURE of
the printer**, and matching a bare `nozul` blocked a genuine merge and turned gray-band reviews into
hard creates (gemma-guide, vision-match, vision-place all failed).

Narrowed rule now in `lib/product-match.cjs`:
```
STRONG words (tarzi|benzer|muadil|alternatif|replacement for|for use with)  -> disqualify
PART_NOUN (nozzle|nozul|hotend|extruder|plaka|plate|enclosure|tabla|...)
  AND SPARE_MARKER (yedek|spare|icin|for)                                   -> disqualify
otherwise                                                                   -> no opinion
```
Verified: `Cift Nozul` no longer blocks, `A1 nozzle uyumlu yedek parca` still does.

```
accuracy    85.3% -> 86.7%
false-merge  5/192 -> 0/192
knockoff 2/2, accessory 4/4, combo-vs-bare 2/2, laser-watt 2/2, cross-identity 180/180
suite: 33 pass / 0 fail
```

### ROOT CAUSE of the recurring backspace bug (found at last)

Three separate times, regexes written into this repo contained literal 0x08 bytes where `` was
meant. The mechanism: the tool call's JSON `\b` arrives at the shell as ``, and **Python then
interprets `` as an escape and writes a backspace character**. It is not an editor or a copy-paste
problem - it is the escaping chain.

Rule from now on: never write a word-boundary regex through a Python heredoc. Write it in JS, or fix
it at byte level, and ALWAYS verify:
```
node -e 'const s=require("fs").readFileSync(F,"utf8"); console.log((s.match(//g)||[]).length)'
```
must print 0. Both instances in `lib/product-match.cjs` are currently 0.

### Generator fixed -> the honest baseline, and it changes the conclusion

Replaced the full-reversal shuffle with `modifierSwap`: it moves an equipment marker past a laser
group, which is the change real shops make ("H2C Combo Lazer 10W" vs "H2C Lazer 10W Combo"), and
returns null when a title has no such pair so the row simply gets no shuffled variant.

```
BEFORE (unfair)   accuracy 86.7%   false-merge 0/192   false-split 50/183 (27.3%)
AFTER  (fair)     accuracy 99.7%   false-merge 0/192   false-split  1/183 ( 0.5%)
```
`surface` is 180/180. **The single remaining failure is the hand-written H2C word-order pair** - the
one case the whole Laya exercise was about.

### What this means for Laya (the uncomfortable part)

- There is nothing left for a model to fix on this set: false-merge is already 0.
- The one miss, H2C `10 Watt Combo` vs `Combo Laser 10 Watt`, is a case **Laya zero-shot also got
  wrong** (it answered "different", 0.339/0.661, confidence 0.076). So Laya does not fix it either.
- Honest caveat about my own set: after removing the unfair pairs, the generated "same" pairs are
  mostly trivial - casing, Turkish folding, added noise. `modifierSwap` only applies where a laser
  group and a Combo marker coexist, so the number of pairs that genuinely test word order is small
  (counted below). 99.7% therefore flatters Magellan; the real signal is the 15 hand-written edges,
  where Magellan scores 14/15.

That single miss is a normalisation problem, not a similarity problem: the same tokens are present
and only their order differs, so the axes should be computed from a canonical modifier order rather
than from the token sequence. That is a deterministic fix and it should be tried before any model.

### CORRECTION to the line above: the 99.7% measures almost nothing

`grep -c "equipment marker moved" docs/laya-eval.jsonl` returns **0**. `modifierSwap` only fires when a
title contains both ` Lazer NW` and ` Combo`, and `laserWatts` is set on almost no baseline row, so the
transformation never applied and **no generated pair tests word order at all**.

What the 180 generated "same" pairs actually are: canonical, UPPER-cased, Turkish-folded, and
noise-added. Three of those four are trivially matched by any normaliser, and added marketing noise
was always easy. So:

- **99.7% is not a matcher accuracy figure.** It is the score on a set with no hard positives.
- The only meaningful signal is the **15 hand-written edges, where Magellan scores 14/15.**
- false-merge 0/192 IS meaningful: the 192 "different" pairs include combo-vs-bare, laser-watt, model,
  variant, knockoff, accessory and 180 cross-identity pairs, and none merged.

So the honest baseline is: **Magellan never merges two different products on the realistic set (0/192),
and misses one word-order case out of 15 hard positives.** The earlier 27.3% false-split was my
generator; this 0.5% is my generator too, in the other direction.

To make the "same" half worth anything it needs harder positives that shops actually write: TR/EN
mixtures ("Bambu Lab H2S Combo 3D Yazici" vs "BambuLab H2S AMS'li"), model tokens split around
modifiers ("H2C 10W Combo" vs "H2C Combo Lazer 10W"), and abbreviated model names. Until then, treat
the hand-written 15 as the test and the generated pairs as regression cover only.

### Step 1 of the Laya decision — order sensitivity FIXED

Two separate causes, found by printing the axes rather than guessing:

1. `identity()` derived `technology` from the literal word "Laser", so `"H2C 10 Watt Combo"` (no such
   word) was `fdm` while `"H2C Combo Laser 10 Watt"` was `laser` - a hard conflict, two rows for one
   printer. Fixed: a wattage figure implies a laser (`isLaserWattage`).
2. `laserW` required the **English** word `laser` via `/(...)/ && /laser/`, so every Turkish title
   ("Lazer 10W", "10 Watt") extracted **no wattage at all**, and 10W vs 40W fell into the gray band
   instead of hard-splitting. Fixed: `laserWattsFromName()` reads the number before `w`/`watt`
   whatever the language and whatever the word order.

```
eval: 375/375 (100%)   false-merge 0/192   false-split 0/183
suite: 34 pass / 0 fail   (33 before + scripts/modifier-order.test.cjs)
```
New regression test covers three reorderings that must merge, two real differences that must still
split, and the technology of both spellings.

KNOWN RISK from fix 2: any `NN W`/`NN watt` in a title now counts as a laser wattage, so a listing
that quotes a power-supply figure would be treated as a laser machine. Not observed in the eval set;
worth watching in real scrapes.

CAVEAT repeated so it is not forgotten: the 100% is on a set whose generated "same" pairs are mostly
trivial (casing, folding, noise). The meaningful number is still the hand-written edges, now 15/15.

### Step 0 (wattage context) ATTEMPTED, NOT DONE - and I broke a file doing it

Goal: a wattage counts as a laser wattage only near laser context (lazer/laser/modul/engraver/kazima),
never near power-supply words (adaptor, guc kaynagi, PSU, power, isitici, heater, bed, tabla).

Three attempts, all failed:
1. **I corrupted `lib/product-match.cjs`.** I replaced the helper by slicing between index positions and
   the end-marker found the wrong closing brace, truncating a `const` - 21 of 34 test files failed.
   Recovered with `git checkout`. Lesson: never slice a JS file by brace search; replace a single known
   line, or use the editor.
2. The targeted replacement then missed because the working copy has **CRLF** endings and my search
   string used `
`. Same class of mistake as the backslash one: assuming the bytes instead of checking.
3. With the CRLF issue fixed the replacement applied, but verification failed and auto-rolled back. I ran
   out of room to establish whether it was the syntax check or the assertion, so I stopped rather than
   guess again.

State left behind: `lib/product-match.cjs` and `scripts/modifier-order.test.cjs` are at the committed
green versions. **Suite 34/34, eval 375/375, false-merge 0, false-split 0.** The veto is NOT implemented.

IMPORTANT for whoever continues: the spec asks for laser context to be REQUIRED, but that re-splits the
H2C pair, because `"Bambu Lab H2C 10 Watt Combo 3D Yazici"` contains no laser word while
`"Bambu Lab H2C Combo Laser 10 Watt 3D Yazici"` does. Those two are the must-pass case. So the rule has
to be: power/heater words VETO, and absence of context still counts as the laser module. The veto list
is the load-bearing part; requiring positive context contradicts step 1's own requirement.

### Step 0 DONE: laser wattage context (branch fix/laser-wattage-context)

Rule as resolved (my earlier contradiction finding was accepted, the original step 0 was wrong):
(a) a `NN W` / `NN Watt` token is the laser module BY DEFAULT, no laser word required, so the H2C pair
still merges; (b) VETOED when a power/heater word is within 2 tokens; (c) IGNORED outside a plausible
range.

**The range came from data, not a guess.** Mine of every title available (live catalogue + `work/*.json`
+ `data/qwen-employee/*.json`, 393 titles):
```
wattages present: {10: 8, 40: 4}      <- all Bambu laser modules
baseline rows carrying laserWatts: 0   <- the baseline has no laser rows at all
```
So 1-80W is the range: it covers 10 and 40 with headroom for other laser modules, and excludes 350W.
The user's guessed 1-80W was right, and now it is grounded.

`laserWattsFromName` now folds Turkish, takes the number before `watt`/`w`, range-checks it, then vetoes
if a power/heater word sits within 2 TOKENS (a token window, not characters, so a laser figure elsewhere
in a long title survives).

```
scripts/laser-wattage.test.cjs  written FIRST, then the implementation
suite: 35 pass / 0 fail        eval: 375/375, false-merge 0, false-split 0 (unchanged)
backspace bytes in the edited file: 0
```
Tests cover both directions: bare wattage, real 10W/40W rows from the live catalogue, the H2C must-pass
pair, `350W güç kaynağı`, `adaptör`, `ısıtıcı`, `PSU`, `power supply`, `tabla`, `heated bed`, an
out-of-range `350W` with no power word at all, and `0W`.

### Editing discipline that worked (after breaking files three times)

1. `git status` clean, then a branch.
2. Line endings checked FIRST - both files were CRLF, so they were normalised to LF in their own commit
   (`2709333`) before any edit. Every earlier exact-string edit had silently missed because of this.
3. One edit, via the editor's exact-string replacement, never a slice by index or brace search (that is
   what corrupted the file and took out 21 test files).
4. `node --check` then the full suite after the edit, with `git checkout` on failure.
5. Diff reviewed, byte count checked, committed only green, then merged to main.

### Next
Step 1 of the Laya decision: mine REAL hard positives - every catalogue product with 2+ shop listings,
plus raw listings from recent scrape/hunt runs - tag them `source=real`, and report the count.
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
