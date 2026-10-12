# tests/

The checks that back the numbers, as a runnable suite.

They used to live in `scratch/` -- which is gitignored -- so the most valuable
asset in the repo was invisible to anyone who cloned it and could not run in CI.
They are committed now, with the smallest set of fixtures they need.

```bash
npm test                 # the pure checks: no browser, no server
npm test -- --browser    # also drive real Chrome (run `npm run dev` first)
npm test -- --all        # everything
npm test -- --list       # show what would run, without running it
```

Each check is a standalone script that prints what it verified and exits 1 on
failure -- written that way so one could be run by hand while chasing a bug. The
runner just executes them and aggregates exit codes; there is no framework to
learn.

## Layout

- `check-*.mjs` -- the checks. `check-x.mjs` is run as
  `node --import ./tests/register-jsx-run.mjs tests/check-x.mjs`.
- `resolve-js.mjs` -- a resolver hook: the app imports `./artifact-model` and
  `../DamageCard` without extensions, which the bundler resolves and Node does
  not. `register.mjs` installs it; `register-jsx-run.mjs` also installs
  `jsx-loader.mjs` so a check can import a graph that reaches a `.jsx` component
  (e.g. `lib/axis-compute.js` imports `DamageCard`).
- `_profiles.mjs` -- Chrome profiles for the browser checks, created in `tmp/`
  and swept on the next run. See its header for why they are not in `%TEMP%`.
- `_*.json` -- fixtures: raw stat tables the formula checks validate against.
  They are FACTUAL numeric tables (weapon curves, ascension, substat affixes),
  ~2.9 MB in total, and they are the only raw game tables in the repo. The
  larger Excel set stays out (see `stats-src/` in `.gitignore`); art and the
  scraped character text are out too (see `public/`).

## Checks that skip

A check that needs something not in the repo skips, loudly, with the command
that would provide it -- it never silently passes:

- `check-derive-precise.mjs` needs `public/data/char/**`, i.e. `npm run fetch`.
- The `data/*.json` configs several checks read are personal exports; on a fresh
  clone those checks skip.

The mapping of check -> required file is in `run.mjs` (`FIXTURES`). If a check
grows a new fixture, add it there so the skip message stays honest.
