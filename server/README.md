# GS-Plan C# service

This is the ASP.NET Core replacement for the small Node server in `serve.mjs`.
It serves the existing `dist/` build and exposes the same `/api/data`,
`/api/optimize` and `/api/vision` routes. The C++ optimiser is unchanged: the
service starts `native/optimize/optimize.exe` exactly as the Node server does.
The pure damage and stat-derivation modules, the artifact optimiser protocol and
the configuration file boundary now live in `server/GsPlan.Core`.

## Run

Build the front end first, then start the C# service from the repository root:

```powershell
npm run build
dotnet run --project server/GsPlan.Api
```

Or use the shortcut from the repository root:

```powershell
npm run dev:csharp
```

Build and parity-check the service with `npm run build:csharp` and
`npm run test:csharp`.

The service listens on `http://127.0.0.1:5199` by default.

## Configuration

Settings live under `GsPlan` in `server/GsPlan.Api/appsettings.json`. They can
also be overridden with environment variables such as:

```powershell
$env:GsPlan__Port = "5200"
$env:GsPlan__StatsFile = "D:\CPT\GS-Plan\public\data\stats-compact.json"
$env:GsPlan__OptimizerPath = "D:\CPT\GS-Plan\native\optimize\optimize.exe"
dotnet run --project server/GsPlan.Api
```

The service finds the repository root automatically from the API project. When
published, put `dist/` beside the executable or set `GsPlan:RepoRoot`.

## Current scope

- `GET /api/health`
- `GET /api/data`, `PUT /api/data`, `POST /api/data`
- `POST /api/optimize`
- `POST /api/optimize/artifact`
- `POST /api/optimize/artifact/problem`
- `POST /api/optimize/artifact/parse`
- `GET /api/vision`, `POST /api/vision`
- `POST /api/config/export`
- `POST /api/config/import`
- `GET /api/core/meta`
- `POST /api/core/damage`
- `POST /api/core/damage-batch`
- `POST /api/core/derive-panel`
- `POST /api/core/derive-panel-batch`
- `POST /api/core/axis`
- `POST /api/core/merged-expression`
- `POST /api/core/formula`
- `POST /api/artifact/scan`
- Static `dist/` files with SPA fallback

`GsPlan.Core` is the C# port of `src/lib/damage.js`, `stat-derive.js`,
`stat-tables.js`, the artifact main-stat curves and the artifact stat keys. It
also owns the whole-axis calculation: the browser sends the axis, each unit's
build, artifact stats and buff cards, while character details, the weapon
catalogue and the curated talent-damage table stay on the server. The UI reaches
it through `src/lib/core-client.js`:

- The page renders the JS result immediately, so a missing service never blocks
  the first paint.
- The adapter probes `GET /api/core/meta`. When the C# service answers, it
  coalesces every damage/panel request made in one commit into one batch call
  and upgrades the rendered numbers when the response arrives.
- Identical requests are cached and shared. A failed request silently leaves the
  JS result in place.
- The whole axis is recalculated in one `POST /api/core/axis` request. The JS
  result is still the synchronous first paint; the C# result replaces it when
  the response arrives.
- The artifact optimiser's per-character polynomial is calculated by
  `POST /api/core/merged-expression`. It reads the same damage rows and buffs
  as the axis, so a coefficient cannot come from a second interpretation of the
  formula.
- `POST /api/core/formula` exposes the same tokenizer, symbol scope and error
  positions the axis uses, so a formula can be validated without computing a
  whole axis. `POST /api/artifact/scan` maps a vision model's text reply to the
  same artifact review rows as the browser parser.
- `localStorage.gsplan.core = 'js'` forces the JS path; `'core'` makes the intent
  explicit; removing the key restores automatic detection.

`tests/check-csharp-core.mjs` compares every single and batch result field with
the JS implementation. `tests/check-csharp-axis.mjs` compares complete axes,
entry parts, buff formulas and custom zones against the JS implementation.
`tests/check-csharp-formula.mjs` compares the formula parser's analysis and
resolution, and `tests/check-csharp-artifact-scan.mjs` compares the screenshot
parser, including malformed replies and method handling.
`tests/check-csharp-merged.mjs` compares the merged artifact polynomial,
including amplifying and transformative terms, alternative scaling stats and
rotation segments. `tests/check-core-client.mjs` verifies the real browser
switch and the no-Core fallback.
`tests/check-csharp-optimize.mjs` compares the structured artifact optimizer's
problem text and CSV parser with the JS implementation, including a real merged
expression and an end-to-end run when `optimize.exe` is built.
`tests/check-csharp-config.mjs` compares both directions of the configuration
file boundary, including the legacy bare-team document, old artifact builds,
pool identity, `enemyRes` migration, the real 1.8 MB imported rotation and a
byte-for-byte pretty-printed export.

The artifact optimiser text protocol now lives in
`GsPlan.Core.Artifacts.ArtifactOptimizeCalculator`. The browser sends the
expression coefficients, baseline panel, comparison row and piece shapes to
`POST /api/optimize/artifact`; C# writes the problem, runs the unchanged C++
binary, and parses its CSV into named rows. The older `POST /api/optimize`
text route remains as the Node-server fallback, and `/problem` plus `/parse`
expose the two halves for parity tests and diagnostics.

The configuration file boundary is now owned by
`GsPlan.Core.Config.ConfigDocument`. `POST /api/config/export` applies team,
artifact-container and axis normalisation, pools repeated descriptors and
returns the same pretty-printed text as `buildConfigFile`; `/import` expands
pools, applies the legacy migrations and returns the same `{ team, axes,
activeId, teamOnly }` object as `parseConfigFile`. The import dialog uses this
route when `/api/core/meta` advertises `configTransfer`, and falls back to the
in-browser implementation on the Node development server.
