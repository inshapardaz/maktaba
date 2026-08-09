# Maktaba (مکتبہ)

A local-first, cross-platform ebook library manager. See [docs/SPEC.md](docs/SPEC.md) for the full design and [docs/TASKS.md](docs/TASKS.md) for the implementation backlog.

## Architecture (M0)

- `apps/frontend` — React + TypeScript UI (Vite dev server).
- `apps/desktop` — Electron main/preload process. Spawns the C# backend as a local sidecar on a random loopback port with a per-launch auth token, and injects that port/token into the renderer via `contextBridge` (see `apps/desktop/src/sidecar.ts` and `preload.ts`).
- `backend/Maktaba.Api` — ASP.NET Core minimal API, the sidecar process. `backend/Maktaba.Core`, `Maktaba.Data`, `Maktaba.Metadata` hold domain logic, persistence, and file metadata extraction respectively (empty scaffolding until M1+).

## Prerequisites

- .NET SDK 9
- Node.js 20.19+ or 22.12+ recommended (developed against 20.17 — works, but some tooling prints an engine warning)
- `dotnet` and `node`/`npm` on `PATH`

## Dev setup

```
npm install
npm run dev
```

This runs three processes together (via `concurrently`):
1. Vite dev server for the frontend (`http://localhost:5173`)
2. `tsc --watch` compiling the Electron main/preload TypeScript
3. Electron itself, once both of the above are ready — its main process then spawns `dotnet run` on `backend/Maktaba.Api` as the sidecar and waits for `/health` before creating the window.

Backend sidecar console output is inherited into the same terminal.

## Building

```
npm run build:frontend   # vite build -> apps/frontend/dist
npm run build:desktop    # tsc -> apps/desktop/dist
```

Packaging into platform installers (bundling a self-contained `dotnet publish` of `Maktaba.Api`) is tracked as M4 in [docs/TASKS.md](docs/TASKS.md) and not yet implemented.

## Known issues

- `npm audit` reports one high-severity advisory in the pinned Electron version (41.7.1). Upgrading further is currently blocked by a bug in `@electron/get`'s installer requiring Node ≥22; revisit once the dev/build machine is on a newer Node, and definitely before shipping a packaged build.
