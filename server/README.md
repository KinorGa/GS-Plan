# GS-Plan C# service

This is the ASP.NET Core replacement for the small Node server in `serve.mjs`.
It serves the existing `dist/` build and exposes the same `/api/data`,
`/api/optimize` and `/api/vision` routes. The C++ optimiser is unchanged: the
service starts `native/optimize/optimize.exe` exactly as the Node server does.
The pure damage and stat-derivation modules now live in `server/GsPlan.Core`.

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
- `GET /api/vision`, `POST /api/vision`
- `GET /api/core/meta`
- `POST /api/core/damage`
- `POST /api/core/damage-batch`
- `POST /api/core/derive-panel`
- `POST /api/core/derive-panel-batch`
- `POST /api/core/axis`
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
- `localStorage.gsplan.core = 'js'` forces the JS path; `'core'` makes the intent
  explicit; removing the key restores automatic detection.

`tests/check-csharp-core.mjs` compares every single and batch result field with
the JS implementation. `tests/check-csharp-axis.mjs` compares complete axes,
entry parts, buff formulas and custom zones against the JS implementation, while
`tests/check-core-client.mjs` verifies the real browser switch and the no-Core
fallback.
