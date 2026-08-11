# Maktaba (مکتبہ) — project context for Claude

Local-first ebook library manager (Calibre-alternative). Electron + React/TypeScript frontend,
C#/.NET 9 backend running as a local HTTP sidecar. All data lives on the user's disk under a
library folder the user picks; no accounts, no cloud.

Background docs: `docs/SPEC.md` (original v1 spec) and `docs/TASKS.md` (milestone log, M0–M4 +
Sqids migration). **Both are now stale in places** — SPEC.md still describes a single-library
model and lists "built-in reader"/"multi-library" as out-of-scope; both have since been built.
Trust this file and the actual code over those two for current state; they're useful for *why*
early decisions were made, not *what exists now*.

## Architecture

```
Electron main (apps/desktop/src/main.ts)
  spawns Maktaba.Api as a child process (apps/desktop/src/sidecar.ts)
    - dev: `dotnet run --project backend/Maktaba.Api`
    - packaged: runs the self-contained published exe from resources/backend/<rid>/
    - picks a free loopback port + random bearer token, passes both via argv, waits for /health
  creates BrowserWindow(s), injects {port, token} into the renderer via preload/contextBridge
    (apps/desktop/src/preload.ts → window.maktaba.*; never via URL/query string)

Renderer (apps/frontend, React 19 + Vite + Mantine 9 + TanStack Query)
  talks to http://127.0.0.1:{port}/api/... with Authorization: Bearer {token}
  apps/frontend/src/api.ts's `request()` is the one fetch wrapper everything goes through

Backend (ASP.NET Core Minimal API, backend/Maktaba.sln)
  Maktaba.Api       — HTTP endpoints (Endpoints/*.cs), DTOs (Dtos/*.cs), Program.cs wires
                       CORS + bearer-token middleware + "library must be open" middleware
  Maktaba.Core      — domain entities (Entities/*.cs), service interfaces (Services/I*.cs),
                       Ids/IdCodec.cs (Sqids), Naming/ (title-sort, file-sanitizing helpers)
  Maktaba.Data      — MaktabaDbContext (EF Core + SQLite), service implementations
                       (Services/*.cs), CoverLocator, EbookFileHelpers
  Maktaba.Metadata  — EPUB (VersOne.Epub) / PDF (PdfPig + PDFtoImage) metadata+cover extraction
  Maktaba.Tests     — nearly empty (one placeholder test); this project has no real test suite,
                       verification is build + live HTTP/UI smoke testing (see below)
```

Multiple **Electron windows** can be open at once: the main library window, and one reader
window per open book (`apps/desktop/src/main.ts`'s `openReaderWindow`, loading the same Vite
bundle with `?view=reader&bookId=...&format=...` — `main.tsx` branches on that query string to
render just the reader instead of the full app). All windows share the one sidecar/port/token.

## On-disk layout (per library)

```
{Library Root}/
  metadata.db                          # SQLite — rebuildable index, not the source of truth
  {Author Sort Name}/
    {Book Title} ({sqid})/
      cover.jpg
      {Book Title}.epub / .pdf
```

`metadata.db` is a **rebuildable cache**, not canonical data — file layout + embedded metadata
(OPF/PDF info dict) are the durable source. A "resync"/rescan operation
(`LibraryRescanService.RescanAsync`) wipes and rebuilds it by walking these folders. Since Sept
2026 (see `LibraryRescanService.cs`) rescan **snapshots and restores DB-only fields** per book id
before rebuilding — `Rating`, `ReadingStatus`, `DateAdded`, tags, series, and collection
membership all survive a rescan now; only file-derived fields (title/authors/description/etc.)
are actually re-read from disk. Book ids are stable across rescans because they're decoded
straight from the folder name (`IdCodec.TryDecode`), not reassigned.

## Multi-library

`LibraryService` (`Maktaba.Data/Services/LibraryService.cs`, singleton) owns a registry of every
library ever opened — `{id, name, path}` — persisted to `%AppData%/Maktaba/config.json`. Exactly
one is "active" at a time (`CurrentLibraryId`/`LibraryRootPath`); `MaktabaDbContextFactory`
resolves the DB path from whichever is currently active, re-evaluated fresh per request scope, so
switching libraries at runtime (no process restart) already works cleanly. Frontend surface:
Settings → Libraries tab (`LibrariesSettings.tsx`) — switch/rename/relocate/resync/remove any
registered library, only one active at a time.

## IDs

Every entity (`Book`, `Author`, `Series`, `Tag`, `BookFile`, `Identifier`, `Collection`) uses a
plain auto-increment `int` primary key internally, **never exposed outside the DB**.
`Maktaba.Core/Ids/IdCodec.cs` wraps a shared Sqids encoder to turn it into an opaque string
(`UkLWZg9D`-style) for API bodies and the on-disk folder name. One shared alphabet is used for all
entity types, so a Book and an Author *can* encode to the same string when their underlying ints
match — that's fine, each id is only ever decoded against the one table it's looked up in. API
routes take a plain `{id}` string and `IdCodec.TryDecode` it, returning 404 on failure rather than
throwing.

## Backend conventions

- **Find-or-create by name**: `Maktaba.Data/Services/EntityResolvers.cs` (`ResolveAuthorsAsync`/
  `ResolveSeriesAsync`/`ResolveTagsAsync`) is the one place Authors/Series/Tags get created,
  case-insensitively matched against existing rows first. Both `ImportService` and
  `BookEditService` go through it — don't hand-roll a second lookup path.
- **Collections are different**: user-created only (via the Collections tab, not find-or-create
  from free text), never auto-derived from file metadata, and — unlike Tags/Series — the
  `Collections` table itself is *not* wiped by a rescan (only per-book membership is).
- **EF change-tracker gotcha**: when doing a bulk delete-then-rebuild in one DbContext (rescan),
  `SaveChangesAsync` must run *before* the next `EntityResolvers` lookup that needs to see what
  was just created — those lookups are plain DB queries and are blind to unflushed inserts. This
  bit us once already (duplicate Author rows on every rescan); rescan now flushes per book inside
  one open transaction rather than once at the very end.
- **No EF Core migrations** — schema changes use `EnsureCreatedAsync`/`EnsureDeletedAsync`
  (`LibraryService.EnsureCurrentSchemaAsync` auto-rebuilds `metadata.db` if it detects a stale
  schema, since the DB is a disposable cache — see above). A genuinely breaking schema change still
  means existing users lose DB-only data (ratings/tags/etc., though now less than before given the
  rescan preservation fix) unless they'd already been rescanned onto the new schema.
- Minimal-API JSON defaults to **camelCase** (no explicit `JsonSerializerOptions` — that's
  ASP.NET Core's own minimal-API default), so C# `PascalCase` record properties become
  `camelCase` on the wire; `apps/frontend/src/api.ts` types match that directly.
- 404-vs-throw convention: service methods return `null`/`false` for "not found", endpoints map
  that to `Results.NotFound()`. No exception-based not-found flow anywhere in `Endpoints/*.cs`.

## Frontend conventions

- **i18n**: `apps/frontend/src/i18n/translations.ts` exports flat `en`/`ur` dictionaries keyed by
  `"namespace.key"` (e.g. `"settings.libraries"`); `useLanguage()`'s `t(key, vars?)` does
  `{varName}` substring interpolation. **Every key must exist in both blocks** — `TranslationKey`
  is typed off the `en` object, so a missing English key is a compile error, but a missing Urdu
  key silently falls back to English at runtime (`t()` does `translations[language][key] ??
  translations.en[key]`) — always add both when adding a key, and remove both when a key becomes
  dead (grep before deleting; several keys have been orphaned and cleaned up this way already).
  RTL/Urdu-specific: `document.body` gets a `lang-ur` class, `--urdu-font-family` CSS var is set
  from `urduFont.ts`'s user-selectable options.
- **Theme**: `theme.ts` is now intentionally *thin* — `createAppTheme(primaryColor)` is just
  `createTheme({ primaryColor })`, nothing else customized (no custom radius/shadows/fonts/
  component overrides). This was a deliberate revert ("remove all extra Mantine styling, keep
  library defaults") — don't reintroduce global theme customization without being asked; prefer
  per-component `style`/props. The 5 selectable accent colors (Settings → Appearance) are
  Mantine's own built-in palette names (`blue`/`grape`/`green`/`orange`/`red`), not hand-rolled
  hex ramps.
- **React Query key conventions**: `["books", filters]`, `["authors"]`, `["series"]`, `["tags"]`,
  `["collections"]`, `["readingStatusCounts"]`, `["library"]`, `["libraries"]`. Authors/Tags/
  Collections are fetched with the same query key in multiple places (Sidebar, full-list views,
  LibrarySpotlight) specifically so they share one cache entry instead of duplicating requests —
  keep reusing the same key rather than inventing a new one per component.
  `apps/frontend/src/queries.ts`'s `invalidateLibraryQueries(queryClient)` is the one helper that
  invalidates everything a book mutation could affect; call it after import/edit/remove/rescan
  rather than listing invalidations by hand.
- **`window.maktaba`** (typed in `maktaba.d.ts`) is the only bridge to Electron — file pickers,
  drag-and-drop path resolution, trash/open/reveal, and `openReaderWindow`. Never reach for
  Node/Electron APIs directly from renderer code.
- Sidebar (`Sidebar.tsx`) shows only the top 5 (by book count) Authors/Collections/Tags, each with
  a chevron "see all" icon button opening the corresponding full-list view
  (`AuthorsView`/`CollectionsView`/`TagsView`) — this cap exists so a library with hundreds of
  authors doesn't turn the navbar into an unusable scroll. Series has no full-list view (never
  built, no cap applied). Settings is a `Modal` (not a routed view) — see `SettingsScreen.tsx` /
  `App.tsx`'s `settingsOpen` state.
- Search is global via `@mantine/spotlight` (`LibrarySpotlight.tsx`, `Ctrl/Cmd+K` from anywhere,
  triggerable from the sidebar's search-box-styled button) — sectioned instant results (Books via
  a live API call, Authors/Tags/Collections filtered client-side from already-cached queries), plus
  a "Search for '…'" action that hands off to the full filterable grid (`FilterBar` + `search`
  state in `App.tsx`). There's no live-as-you-type search box in the header/toolbar — that's
  intentional, not a regression.
- No app header/toolbar anymore — it was removed; the "current view" indicator is now a
  `Breadcrumbs` trail inside `FilterBar.tsx`, not a separate bar.
- Reader: `@inshapardaz/qari` npm package (the user's own), rendered via `ReaderOverlay.tsx`,
  opened in its own Electron window (see above), never inline in the main window.

## Build & verification

No CI, no test suite worth running (`Maktaba.Tests` is a placeholder). Verification is:

```
dotnet build backend/Maktaba.sln     # backend compiles
dotnet test backend/Maktaba.sln      # runs the ~1 placeholder test, not real coverage
npm run build:frontend               # tsc -b && vite build — run from repo root
npm run build:desktop                # Electron main/preload tsc
```

`npm run build:frontend` / `build:desktop` must be run from the **repo root** — they're
composite workspace scripts (`npm run build --workspace maktaba-frontend`, etc.). If a prior
`cd apps/frontend` happened earlier in the same shell session, these will fail with "Missing
script" since the Bash tool's cwd persists across calls — `cd` back to repo root, or run
`npm run build` directly from inside that workspace directory instead.

**This sandbox cannot launch a real Electron GUI** (`ELECTRON_RUN_AS_NODE=1` is forced) — every
milestone in this project's history was verified via `dotnet build`/`tsc`/`vite build` passing,
plus live HTTP smoke tests (`dotnet run` the API standalone, `curl` it) for backend behavior, and
a Vite dev-server module-transform check for frontend changes. Actual GUI/rendering verification
needs the user to run `npm run dev` themselves — say explicitly what was and wasn't visually
confirmed rather than implying the UI was seen working.

**Gotcha**: if a live `npm run dev` Electron session is already running (check `Get-Process -Name
"Maktaba.Api","electron"` — several `electron.exe` + one `Maktaba.Api.exe` together means it's a
real dev session, not a stray leftover), its running `Maktaba.Api.exe` locks
`backend/*/bin/Debug/net9.0/*.dll`, so a plain `dotnet build` fails with `MSB3027`/file-in-use
errors. **Don't kill that process** — it's the user's active session. Build to an isolated output
dir instead: `dotnet build backend/Maktaba.Api/Maktaba.Api.csproj -o <temp-dir>`. Only kill a
`Maktaba.Api.exe` if it's a lone orphan with no accompanying `electron.exe` processes (a leftover
from a previous standalone smoke test).

## Desktop packaging

`scripts/publish-backend.mjs` publishes the self-contained backend per RID into
`apps/desktop/resources/backend/<rid>/`; `electron-builder` (config in `apps/desktop/package.json`)
bundles the matching RID folder as `extraResources` per platform. `npm run package:win/mac/linux`
at the repo root chains build → publish-backend → electron-builder. Known past issue: pin
`electron-builder` ≥ 26 (25.x pulled a broken `app-builder-bin` prerelease) and keep the root
`package.json` `overrides.@noble/hashes: ^1.8.0` (electron-builder's blockmap step needs the
dual-CJS/ESM major; 2.x is ESM-only and breaks under `require()`).
