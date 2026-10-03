# Notes for Claude sessions on this repo

## Shop pages: look at the real page, don't guess
The cloud sandbox cannot reach the shop sites (the proxy answers 403). Several fixes here (Filament Marketim
colour photos, sold-out colours, the "Ekle" buy button, "Transparan" hiding the colours) only became clear once
a real saved page was in hand. So:

- When a bug depends on what a shop's page really contains (colours, photos, stock, buy button) and the sandbox
  cannot fetch it, do not guess and do not write a fix against a made-up page. Ask the owner to run, on their PC:
  `npm run probe-colours -- <product url>` and push `work/variant-debug/` to branch `variant-debug`,
  or, better, work on the PC itself (Claude Code on the owner's machine, or a session linked to it).
- If a problem looks impossible to solve from the sandbox, say so in a short note and ask for the real page or
  PC access first, before spending rounds on guesses.
- Every bug fixed becomes a saved-page regression test (scripts/fixtures/pages/variants/live/ + a
  scripts/*-live.test.cjs). Redact third-party widget tokens from saved pages before committing them.

## Hand-off with the PC (the owner's preference)
When something needs the real shop site, give the owner a ready-to-paste prompt for Claude Code on their PC,
not a list of steps. That prompt must: change no code; push only to `variant-debug`; never commit `.env` /
`.dev.vars`; and end by writing a short findings note (what it ran, what the page showed, the URLs used, the
files pushed) as `notes/<topic>.md` on `variant-debug`, so the next session reads the note instead of
re-asking. At the start of work, read the newest notes on `variant-debug` first.

## What the run learns from the owner's edits
Every card the owner fixes by hand is a label. Use them, and measure before claiming anything is better:
- `npm run trust-report` how often the run's output agrees with the owner's hand edits, per field (spool and sub-brand
  numbers are in-sample there; `npm run learn -- --check` prints the honest leave-one-out scores).
- `npm run learn` learns `data/house-rules.json` (spool material by brand / line / variant, sub-brand lines, the shades
  the owner eyedropped) from `work/local-store`. The local server also relearns at start when the labels are newer; the
  worker re-reads the file when it changes. Guesses carry their evidence (`listing.guess`) and never overwrite a value a
  person set. Swatches the photo reader filled in are marked `colorHexSource: "photo"` and never teach the rules.
- `npm run eval-colours` (on the PC; it downloads photos) compares the photo reader with the owner's eyedropper picks.
- `npm run laya-data` rebuilds Laya's training inputs from the baseline and the owner's decisions; retraining itself
  (`scripts/laya-match.py --train`) needs the Python environment on the PC.
- Finishes (silk, satin, matte, translucent, metallic, glow, marble, galaxy) live in `colorEffect`; the list is
  `EFFECTS` in `lib/house-rules.cjs` and the look is `public/css/swatch-finishes.css`.

## Rules of the repo
- Work and push on `deploy-ready` only. No pull requests unless asked. Never commit `.env` or `.dev.vars`.
- Kill local processes by PID only, never `pkill` by name.
- Run `npm test` and `npm run e2e` before pushing; everything green.
- Don't break other shops (rhino lists each colour separately and still groups by model). Keep the
  click-through path `lib/variant-clicker.cjs` working. Grouped colours are linked by default.
