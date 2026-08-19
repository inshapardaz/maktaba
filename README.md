# Maktaba (مکتبہ)

A local-first, cross-platform ebook library manager. See [docs/SPEC.md](docs/SPEC.md) for the full design and [docs/TASKS.md](docs/TASKS.md) for the implementation backlog.

<img width="1608" height="1049" alt="image" src="https://github.com/user-attachments/assets/d6b9853e-b5b1-4c39-962f-e74f35582cf9" />

## Architecture

- `apps/frontend` — React + TypeScript UI (Vite dev server), rendered with [Mantine](https://mantine.dev) (`src/theme.ts` for the theme, `main.tsx` for the provider). Talks to the backend via `fetch`, using the port/token injected by the preload script (`src/api.ts`).
- `apps/desktop` — Electron main/preload process. Spawns the C# backend as a local sidecar on a random loopback port with a per-launch auth token, injects that port/token into the renderer via `contextBridge` (`src/sidecar.ts`, `preload.ts`), and exposes native OS integrations (folder/file pickers, drag-and-drop path resolution, open/reveal-in-folder) via `src/native.ts`.
- `backend/Maktaba.Api` — ASP.NET Core minimal API, the sidecar process; endpoints in `Endpoints/`.
- `backend/Maktaba.Core` — domain entities (`Entities/`) and service interfaces/DTOs (`Services/`), with no infrastructure dependencies. `Ids/IdCodec.cs` wraps [Sqids](https://sqids.org) — every entity's database primary key is a plain auto-increment `int`; that integer is never exposed outside the database. Everywhere else (API request/response bodies, and the id embedded in a book's on-disk folder name) uses the short opaque string `IdCodec` encodes it to, e.g. `UkLWZg9D` instead of a GUID.
- `backend/Maktaba.Data` — EF Core `DbContext` (SQLite), and the `LibraryService`/`ImportService` implementations.
- `backend/Maktaba.Metadata` — per-format metadata/cover extractors (EPUB via `VersOne.Epub`; PDF is M2).

As of M3: you can open/create a library folder; import `.epub`/`.pdf` files via file picker or drag-and-drop with duplicate detection (skip/keep-both/merge); browse them in a virtualized grid or list view with search, filters, and author/series/tag grouping; edit metadata (which renames the on-disk folder/files to match); remove a book (sends its files to the OS trash); and rescan the library folder to rebuild the index from scratch. See [docs/TASKS.md](docs/TASKS.md) for what's done vs. pending per milestone.

The UI supports English and Urdu (with automatic RTL layout switching), and light/dark color scheme — both toggleable from the toolbar. The last-opened library re-opens automatically on the next launch (the backend persists it to `%AppData%/Maktaba/config.json`, see `LibraryService`); language and color scheme are persisted in the renderer's `localStorage`. See `apps/frontend/src/i18n/` for the translation dictionaries.

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

## Packaging

Packaged installers bundle a **self-contained** `dotnet publish` of `Maktaba.Api` (no .NET runtime required on the target machine) as an Electron `extraResource`, so the sidecar is spawned as a native executable instead of via `dotnet run`. This is wired up per-platform in `apps/desktop/package.json`'s `build` field (electron-builder config) and `apps/desktop/src/sidecar.ts` (`packagedExecutablePath`).

One-shot build for your current platform:

```
npm run package:win     # -> apps/desktop/release (NSIS installer)
npm run package:mac     # -> apps/desktop/release (dmg, x64 + arm64)
npm run package:linux   # -> apps/desktop/release (AppImage)
```

Each of these builds the frontend and desktop TypeScript, publishes the matching backend RID(s) via `scripts/publish-backend.mjs` into `apps/desktop/resources/backend/<rid>/` (gitignored — regenerated on demand), then runs `electron-builder` for that platform. To publish the backend for all four shipping RIDs (`win-x64`, `osx-x64`, `osx-arm64`, `linux-x64`) without packaging, use `npm run publish:backend:all`.

**Cross-compiling backend binaries works from any host** (`dotnet publish -r <rid> --self-contained` doesn't need the target OS), but **electron-builder's `dmg`/`AppImage`/`nsis` targets are best built on their own OS** — building a `.dmg` from Windows/Linux, for example, isn't reliably supported. Locally, build each installer on/for its target platform; `.github/workflows/release.yml` (below) does this for all three in CI.

App icon: `apps/desktop/build/icon.png` (the Maktaba logo). electron-builder auto-derives `.ico`/`.icns` from this single PNG.

## Auto-update

Packaged builds check GitHub Releases for a newer version shortly after launch (and on demand via Help → "Check for Updates…"), using [`electron-updater`](https://www.electron.build/auto-update) — see `apps/desktop/src/updater.ts`. On Windows and Linux this can download and silently install the update on restart; on macOS (unsigned — see "Known issues" below) it just opens the release page in your browser instead, since a silent install needs a signed build. The `package:*` scripts build with `--publish never` (nothing is auto-published from a local/CI build), but electron-builder still writes the `latest*.yml` update-metadata files `electron-updater` reads as its feed, and `.github/workflows/release.yml` uploads those alongside each installer.

## CI / releases

- **`.github/workflows/ci.yml`** — runs on every push and pull request: `dotnet build`/`dotnet test` for the backend, and `tsc`/`vite build` for the frontend and desktop TypeScript, as two parallel jobs.
- **`.github/workflows/release.yml`** — builds installers for all three platforms and publishes a GitHub Release with them attached. Triggered either by pushing a tag matching `v*.*.*`, or manually via the Actions tab ("Run workflow") with a `tag` input — the manual path creates that tag (and the release) pointing at the selected branch/commit if it doesn't already exist. Before packaging, it stamps the given version into the root/frontend/desktop `package.json` files via `scripts/set-version.mjs` so installer filenames and the app's version match the release tag. Each platform builds and uploads its installer as a workflow artifact; a final job downloads all three and creates the release (`softprops/action-gh-release`) with them attached for download.

## Known issues

- **In-app reader (`@inshapardaz/qari`) needs internet access for two things**, even though everything else in Maktaba is local-first: its PDF rendering loads the `pdf.js` worker script from a jsDelivr CDN by default (override via the `pdfWorkerSrc` prop on `Reader` if self-hosting is needed), and its Nastaliq/Urdu font options load live from `github.com/inshapardaz/urdu-web-fonts`. Both degrade gracefully (EPUB reading and non-Nastaliq fonts still work offline) rather than breaking the reader entirely, but a fully offline setup would need to self-host both.
- **Apple error message "Maktaba is damaged and can't be opened"**: caused by the dmg being unsigned/unnotarized (Gatekeeper quarantines anything downloaded from outside the App Store that isn't signed with an Apple Developer ID). `apps/desktop/package.json`'s `mac` build config and `.github/workflows/release.yml` are already wired up to sign and notarize automatically ​— electron-builder just needs an Apple Developer ID certificate and notarization credentials, which aren't included in this repo. To make future releases signed (and permanently resolve this warning), add these as GitHub Actions repo secrets:
  - `MAC_CERTIFICATE` — a Developer ID Application certificate exported as a base64-encoded `.p12`
  - `MAC_CERTIFICATE_PASSWORD` — the `.p12`'s export password
  - `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` — for notarization (an [app-specific password](https://support.apple.com/en-us/102654), not your Apple ID password)

  Until those secrets are added, releases stay unsigned and the workaround is to run this in Terminal after installing:
```sh
xattr -cr /Applications/Maktaba.app
```
