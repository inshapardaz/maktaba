# Maktaba (مکتبہ) — project context for Claude

Local-first ebook library manager (Calibre-alternative). Electron + React/TypeScript frontend,
C#/.NET 9 backend running as a local HTTP sidecar. All data lives on the user's disk under a
library folder the user picks; no accounts, no cloud.

`docs/` is the bilingual (English + Urdu) end-user help site (VitePress; see "Help & onboarding"
below) — it is **not** background/spec material for Claude. (Earlier revisions of this file
pointed at `docs/SPEC.md`/`docs/TASKS.md` for that purpose; both were deleted from the repo well
before `docs/` was repurposed this way — there is no separate background-docs folder anymore.
Trust this file and the actual code for current state and *why* decisions were made.)

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

`metadata.db` is a **rebuildable cache**, not canonical data — file layout is the durable source
for *which* books exist, but not for their metadata once a book has been indexed at least once. A
"resync"/rescan operation (`LibraryRescanService.RescanAsync`) walks these folders and only ever
adds a book for a folder with no matching existing id, or removes one whose folder is gone; for a
book id that already exists, its row — DB-only fields (`Rating`, `ReadingStatus`, `DateAdded`,
tags, series, collection membership) *and* file-derived fields (title/authors/description/
publisher/language/etc.) alike — is left completely untouched rather than re-read from the file's
embedded (OPF/PDF info dict) metadata. This was a deliberate fix (issue #15): re-extracting
file-derived fields on every rescan used to silently overwrite any in-app title/author/etc.
correction the moment someone rescanned. Only a genuinely new book has its metadata read from the
file at all; per-file `BookFiles` rows (format/size/hash) are still refreshed for every book on
every rescan, since that legitimately tracks whatever's on disk right now. Book ids are stable
across rescans because they're decoded straight from the folder name (`IdCodec.TryDecode`), not
reassigned.

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
- Sidebar (`Sidebar.tsx`) shows every Authors/Collections/Series/Tags group, sorted by book count,
  scrolling within its own `ScrollArea` rather than truncating — each section also has a chevron
  "see all" icon button opening the corresponding full-list view (`AuthorsView`/`CollectionsView`/
  `SeriesView`/`TagsView`) for search/rename/management UI the sidebar itself doesn't have.
  Settings is a `Modal` (not a routed view) — see `SettingsScreen.tsx` /
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

## Word-lookup dictionaries

Settings → Dictionaries lets the user configure an offline StarDict/GoldenDict dictionary per
language for real word definitions in the reader (qari's `stardictDictionaries` `<Reader>` prop,
added in `@inshapardaz/qari` 0.2.16 — see that package's `StarDictProvider`). This is an app-wide
asset like the Hunspell-based spell-check feature it replaced (former issue #30; Hunspell support
was removed entirely, not kept alongside StarDict), so it lives under
`{userData}/StarDictDictionaries/{language}/` rather than inside a library folder, and never goes
through the Maktaba.Api sidecar.

A StarDict dictionary is a same-basename trio of files (`.ifo`/`.idx`/`.dict[.dz]`); rather than
asking the user to locate three separate files, `native.ts`'s `maktaba:save-stardict-dictionary`
handler takes a single `.zip` (the form most GoldenDict-distributed dictionaries are shared in),
unpacks it with `jszip`, and normalizes the result on disk — a gzip-compressed `.idx.gz` is
decompressed once at save time (qari's `StarDictProvider` only auto-decompresses a gzip `.dict.dz`
on its own, not `.idx`), while `.dict`/`.dict.dz` is left as-is since the provider handles that one
itself.

The dictionary's own bytes never cross Electron's IPC boundary — a `.dict` file can be tens of MB
or more, too large to comfortably pass through `ipcRenderer.invoke`'s structured-clone (this app's
established convention for anything that size, e.g. book/cover bytes, is to serve it over the local
HTTP sidecar instead of IPC; this feature has no sidecar involvement at all, so it uses Electron's
own equivalent instead). `native.ts` registers a privileged `stardict://` custom protocol
(`registerStarDictProtocol`, called from `main.ts` inside `app.whenReady()`) that serves a
dictionary's files straight off disk via `net.fetch(pathToFileURL(...))`; the
`maktaba:get-stardict-dictionary-urls` IPC call only returns three short `stardict://` URL strings,
and `ReaderOverlay.tsx` feeds those into `stardictDictionaries`' `ifoUrl`/`idxUrl`/`dictUrl` fields,
letting qari's `StarDictProvider` `fetch()` them itself. No parsing happens on the Maktaba side at
all, and no dictionary bytes are ever serialized across a process boundary by Maktaba's own code.

The word-lookup interaction itself is qari's own built-in behavior, not something Maktaba wires up:
select a word in the reader and right-click it (or long-press on touch) to see its definition.

As with the Help & onboarding Urdu content below, the Urdu strings added for this feature
(`starDictSettings.*` in `translations.ts`, and `docs/ur/settings.md`/`docs/ur/reading.md`) are
Claude-authored and unreviewed by a native speaker.

## Desktop packaging

`scripts/publish-backend.mjs` publishes the self-contained backend per RID into
`apps/desktop/resources/backend/<rid>/`; `electron-builder` (config in `apps/desktop/package.json`)
bundles the matching RID folder as `extraResources` per platform. `npm run package:win/mac/linux`
at the repo root chains build → publish-backend → electron-builder. Known past issue: pin
`electron-builder` ≥ 26 (25.x pulled a broken `app-builder-bin` prerelease) and keep the root
`package.json` `overrides.@noble/hashes: ^1.8.0` (electron-builder's blockmap step needs the
dual-CJS/ESM major; 2.x is ESM-only and breaks under `require()`).

## Help & onboarding

`docs/` is a VitePress site (`docs/en/`, `docs/ur/`, `npm run docs:dev`/`docs:build` from the repo
root) — bilingual help articles, one topic per markdown file. `docs/topics.cjs` (deliberately
**CommonJS**, not `.mjs`/`.ts`) is the single source of truth for the topic list/order/titles; it's
loaded identically by three different module contexts that otherwise couldn't share one file
without a build step: `docs/.vitepress/config.ts` (sidebar), `scripts/build-help-content.mjs`
(packaging), and `apps/desktop/src/help.ts` (dev-mode `require()` — a real `.mjs` can't be
`require()`d synchronously from the CommonJS-compiled Electron main process). Screenshots
referenced from markdown (`docs/screenshots/*.svg`) are currently all placeholder graphics (copies
of `_placeholder-source.svg`) — see `docs/SCREENSHOTS.md` for the capture checklist of what each
one should eventually show.

The same `docs/` markdown is also the **offline in-app Help**, shown in its own top-level window
(`HelpWindow.tsx`) rather than a Settings tab — help content is multi-page and screenshot-heavy
and is meant to stay open alongside the rest of the app, which doesn't fit the small Settings
modal. Opened via `window.maktaba.openHelpWindow()` (`main.ts`'s `openHelpWindow`, a singleton
`BrowserWindow` with native OS chrome, following the same pattern as `openReaderWindow`) from
either the main window's title bar Help button (`TitleBar.tsx`'s `HelpButton`) or the native app
menu's "Maktaba Help" item (`menu.ts`). `scripts/build-help-content.mjs` copies `docs/{en,ur}/*.md`
+ screenshots into `apps/desktop/resources/help/` before packaging (chained into
`npm run package:win/mac/linux`, mirroring `publish-backend.mjs`'s role); `help.ts`'s IPC handlers
(`maktaba:list-help-topics`/`read-help-topic`/`read-help-asset`) read that packaged copy when
`app.isPackaged`, or straight from `docs/` in dev — same dev/prod split as the sidecar. The
renderer never touches these files directly (reads via `window.maktaba`, consistent with every
other filesystem access — see `native.ts`), and renders the markdown with `react-markdown`; RTL/
Urdu font come for free from the existing `useLanguage()`/`--urdu-font-family` machinery, no
separate logic needed.

First-run onboarding (`OnboardingTour.tsx`, a Mantine `Stepper` in a `Modal`, mounted in `App.tsx`
**outside** the `hasLibrary` gate so it can show before a library exists) is gated by a
`"maktaba-onboarding-complete"` localStorage flag (`onboarding.ts`) — not real first-run detection,
just "has this tour been dismissed once." Replayable anytime from the Help window's "Replay
Getting Started Tour" button — since that window is a separate renderer process from the main
window (where the tour's React tree actually lives), the button round-trips through the main
process instead of calling into it directly: it invokes `maktaba:replay-onboarding-tour`, which
focuses the main window and sends it a `"maktaba:replay-onboarding-tour"` event that `App.tsx`
subscribes to via `window.maktaba.onReplayOnboardingTour` — the same "invoke here, event there"
shape as the sidecar/update-status broadcasts.

All Urdu content added for this feature (docs, onboarding copy, new `translations.ts` keys) is
Claude-authored and has **not** been reviewed by a native speaker — treat it as a first draft that
needs review before relying on it for real users.


## Development notes

Use `test_library` for any testing while development. Do not touch other libraries as they are registered on the machine and may contain real user data.