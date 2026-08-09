# Maktaba (مکتبہ)

A local-first, cross-platform ebook library manager. See [docs/SPEC.md](docs/SPEC.md) for the full design and [docs/TASKS.md](docs/TASKS.md) for the implementation backlog.

## Architecture

- `apps/frontend` — React + TypeScript UI (Vite dev server). Talks to the backend via `fetch`, using the port/token injected by the preload script (`src/api.ts`).
- `apps/desktop` — Electron main/preload process. Spawns the C# backend as a local sidecar on a random loopback port with a per-launch auth token, injects that port/token into the renderer via `contextBridge` (`src/sidecar.ts`, `preload.ts`), and exposes native OS integrations (folder/file pickers, drag-and-drop path resolution, open/reveal-in-folder) via `src/native.ts`.
- `backend/Maktaba.Api` — ASP.NET Core minimal API, the sidecar process; endpoints in `Endpoints/`.
- `backend/Maktaba.Core` — domain entities (`Entities/`) and service interfaces/DTOs (`Services/`), with no infrastructure dependencies.
- `backend/Maktaba.Data` — EF Core `DbContext` (SQLite), and the `LibraryService`/`ImportService` implementations.
- `backend/Maktaba.Metadata` — per-format metadata/cover extractors (EPUB via `VersOne.Epub`; PDF is M2).

As of M1: you can open/create a library folder, import `.epub` files (via file picker or drag-and-drop), and browse them in a virtualized grid or list view with a metadata detail panel. See [docs/TASKS.md](docs/TASKS.md) for what's done vs. pending per milestone.

## Prerequisites

- .NET SDK 9
- Node.js 20.17+ (tested on 20.17 and 20.19+)
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
