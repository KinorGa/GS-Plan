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
- `POST /api/core/damage`
- `POST /api/core/derive-panel`
- Static `dist/` files with SPA fallback

`GsPlan.Core` is the C# port of `src/lib/damage.js`, `stat-derive.js`,
`stat-tables.js`, the artifact main-stat curves and the artifact stat keys. The
two `/api/core` routes are test-facing in this phase: the UI still calls the JS
modules, while `tests/check-csharp-core.mjs` compares every result field against
the JS implementation. Migrating UI callers is a later phase.
