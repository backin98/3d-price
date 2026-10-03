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

## Rules of the repo
- Work and push on `deploy-ready` only. No pull requests unless asked. Never commit `.env` or `.dev.vars`.
- Kill local processes by PID only, never `pkill` by name.
- Run `npm test` and `npm run e2e` before pushing; everything green.
- Don't break other shops (rhino lists each colour separately and still groups by model). Keep the
  click-through path `lib/variant-clicker.cjs` working. Grouped colours are linked by default.
