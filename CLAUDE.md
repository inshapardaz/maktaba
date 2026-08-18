# Maktaba (مکتبہ) — project context for Claude

Local-first ebook library manager (Calibre-alternative). Electron + React/TypeScript frontend,
Rust backend (axum) running as a local HTTP sidecar. All data lives on the user's disk under a
library folder the user picks; no accounts, no cloud.

**Backend history**: the backend was originally C#/.NET 9 (ASP.NET Core Minimal API + EF Core);
it was rewritten to Rust (see `backend-rust/`) to eliminate .NET-related runtime issues. The old
C# projects still exist at `backend/` for reference/rollback but are no longer built, packaged, or
spawned by the desktop app — `backend-rust/` is the live backend. See `backend-rust/README.md` for
Rust-specific setup, the pdfium vendoring story, and what has/hasn't been verified end-to-end.

Background docs: `docs/SPEC.md` (original v1 spec) and `docs/TASKS.md` (milestone log, M0–M4 +
Sqids migration). **Both are now stale in places** — SPEC.md still describes a single-library
model and lists "built-in reader"/"multi-library" as out-of-scope; both have since been built.
Trust this file and the actual code over those two for current state; they're useful for *why*
early decisions were made, not *what exists now*.

## Architecture

```
Electron main (apps/desktop/src/main.ts)
  spawns maktaba-api as a child process (apps/desktop/src/sidecar.ts)
    - dev: runs backend-rust/target/debug/maktaba-api(.exe) directly (`cargo build` it first)
    - packaged: runs the release exe from resources/backend/<rid>/ (see "Desktop packaging")
    - picks a free loopback port + random bearer token, passes both via argv, waits for /health
  creates BrowserWindow(s), injects {port, token} into the renderer via preload/contextBridge
    (apps/desktop/src/preload.ts → window.maktaba.*; never via URL/query string)

Renderer (apps/frontend, React 19 + Vite + Mantine 9 + TanStack Query)
  talks to http://127.0.0.1:{port}/api/... with Authorization: Bearer {token}
  apps/frontend/src/api.ts's `request()` is the one fetch wrapper everything goes through

Backend (Rust workspace, backend-rust/ — see backend-rust/README.md for full detail)
  maktaba-api       — axum HTTP server: routes/*.rs (endpoints), dtos.rs, auth.rs (bearer-token
                       middleware), db_task.rs ("library must be open" + schema-check wrapper), main.rs
  maktaba-core      — domain entities (entities.rs), ids.rs (Sqids), naming.rs (title-sort,
                       file-sanitizing helpers), shared request/result types (services.rs)
  maktaba-data      — SQLite schema + connection handling (db.rs, no ORM), service functions
                       (services/*.rs), read-query repo (repo/*.rs), CoverLocator, file helpers
  maktaba-metadata  — EPUB (manual zip+OPF XML parsing) / PDF (lopdf + pdfium-render) metadata+cover
                       extraction
  maktaba-tests     — integration tests that spawn the real maktaba-api binary and hit it over
                       HTTP (tests/api_smoke.rs), plus unit tests inline in each crate
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
(`maktaba_data::services::rescan::rescan`, `backend-rust/maktaba-data/src/services/rescan.rs`)
wipes and rebuilds it by walking these folders, **snapshotting and restoring DB-only fields** per
book id before rebuilding — rating, reading status, date added, tags, series, collection
membership, bookmarks, notes, and reading progress all survive a rescan; only file-derived fields
(title/authors/description/etc.) are actually re-read from disk. Book ids are stable across
rescans because they're decoded straight from the folder name (`maktaba_core::ids::try_decode`),
not reassigned. This same mechanism is what transparently rebuilds a `metadata.db` left behind by
the old .NET backend the first time a library is opened with the Rust one (its schema doesn't
match, so it's treated as stale — see `backend-rust/README.md`'s "Database" section).

## Multi-library

`LibraryService` (`backend-rust/maktaba-data/src/library_service.rs`, one instance shared via
`Arc` in `AppState`) owns a registry of every library ever opened — `{id, name, path}` —
persisted to `<OS config dir>/Maktaba/config.json` (`%AppData%` on Windows; overridable via the
`MAKTABA_CONFIG_DIR` env var, used by the integration tests to avoid touching a real user's
config). Exactly one is "active" at a time; every request re-resolves the current DB path fresh
(`db_task::with_conn`, `backend-rust/maktaba-api/src/db_task.rs`), so switching libraries at
runtime (no process restart) works cleanly. Frontend surface: Settings → Libraries tab
(`LibrariesSettings.tsx`) — switch/rename/relocate/resync/remove any registered library, only one
active at a time.

## IDs

Every entity (Book, Author, Series, Tag, BookFile, Identifier, Collection) uses a plain
auto-increment `i64` primary key internally, **never exposed outside the DB**.
`backend-rust/maktaba-core/src/ids.rs` wraps a shared Sqids encoder to turn it into an opaque
string (`UkLWZg9D`-style) for API bodies and the on-disk folder name. One shared alphabet is used
for all entity types, so a Book and an Author *can* encode to the same string when their
underlying ints match — that's fine, each id is only ever decoded against the one table it's
looked up in. API routes take a plain `{id}` string and `ids::try_decode` it, returning 404 on
failure rather than erroring.

## Backend conventions

- **Find-or-create by name**: `backend-rust/maktaba-data/src/resolvers.rs`
  (`resolve_authors`/`resolve_series`/`resolve_tags`) is the one place Authors/Series/Tags get
  created, case-insensitively matched (`LOWER(name) = LOWER(?)`) against existing rows first. Both
  `services::import` and `services::book_edit` go through it — don't hand-roll a second lookup path.
- **Collections are different**: user-created only (via the Collections tab, not find-or-create
  from free text), never auto-derived from file metadata, and — unlike Tags/Series — the
  `collections` table itself is *not* wiped by a rescan (only per-book membership is).
- **No ORM, no migrations** — plain `rusqlite` with hand-written SQL; schema is
  `CREATE TABLE IF NOT EXISTS` in `backend-rust/maktaba-data/src/db.rs`, gated behind a
  `schema_meta` version check (`db::ensure_current_schema`) that wipes and recreates the whole
  file when the version (or a foreign/absent schema, e.g. one left by the old .NET backend) doesn't
  match, since the DB is a disposable cache — see above. A genuinely breaking schema change means
  existing users lose DB-only data (ratings/tags/etc.) on their next open, same tradeoff as before.
- **`db_task::with_conn`** (`backend-rust/maktaba-api/src/db_task.rs`) is the one path every
  DB-touching route handler goes through: it verifies a library is open (`ApiError::LibraryNotOpen`
  → 400 if not), rebuilds+rescans a stale `metadata.db` if needed, then runs the handler's closure
  against a fresh `rusqlite::Connection` inside `spawn_blocking` (rusqlite is synchronous). Don't
  open a `Connection` directly in a route handler — go through this so the schema-check/rescan
  behavior stays centralized.
- Axum's `Json<T>` extractor/response defaults to **camelCase** via `#[serde(rename_all =
  "camelCase")]` on every DTO in `dtos.rs` (Rust structs are `snake_case`, matching the C#
  backend's own camelCase wire format), so `apps/frontend/src/api.ts` types didn't need to change.
  `chrono_utc.rs` formats/parses `NaiveDateTime` with an explicit trailing "Z" to match the old
  System.Text.Json output — the frontend's `new Date(...)` calls rely on that to avoid
  misinterpreting a timestamp as local time.
- 404-vs-error convention: service functions in `maktaba-data` return `Option`/`bool` for "not
  found" (mirroring the old `null`/`false` C# convention); route handlers in `maktaba-api` map
  that to `ApiError::NotFound` (`error.rs`), which serializes as a plain 404. No panic/exception-
  based not-found flow anywhere in `routes/*.rs`.

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

The Rust backend has a real test suite (`backend-rust/maktaba-tests`, plus unit tests inline in
each crate) — unlike the old C# `Maktaba.Tests` placeholder, this is worth actually running:

```
cd backend-rust && cargo build --workspace   # whole Rust workspace compiles
cd backend-rust && cargo test --workspace    # unit tests + tests/api_smoke.rs (spawns the real
                                              # binary, exercises it over HTTP end-to-end)
npm run build:frontend                       # tsc -b && vite build — run from repo root
npm run build:desktop                        # Electron main/preload tsc
```

`npm run build:frontend` / `build:desktop` must be run from the **repo root** — they're
composite workspace scripts (`npm run build --workspace maktaba-frontend`, etc.). If a prior
`cd apps/frontend` happened earlier in the same shell session, these will fail with "Missing
script" since the Bash tool's cwd persists across calls — `cd` back to repo root, or run
`npm run build` directly from inside that workspace directory instead.

**Windows toolchain note**: this environment has no admin rights, so the usual MSVC linker
(`link.exe`, from Visual Studio Build Tools, which requires elevation) isn't available. The Rust
toolchain here is set up against the **GNU** target instead (`rustup default
stable-x86_64-pc-windows-gnu`), linked via a portable MinGW-w64 GCC that needs no install
(extracted to `%USERPROFILE%\mingw64-portable\`, added to `PATH`). If a `cargo build` fails with
"linker `link.exe` not found" or similar, that toolchain/PATH setup is missing in the current
shell — re-add `mingw64-portable\mingw64\bin` to `PATH` rather than trying to install MSVC Build
Tools (it'll silently hang waiting on a UAC prompt nobody can answer). Also: run cargo from
**PowerShell**, not the Bash tool — Git Bash's own `/usr/bin/link` shadows the real linker on
`PATH` there and produces a confusing unrelated error.

**This sandbox cannot launch a real Electron GUI** (`ELECTRON_RUN_AS_NODE=1` is forced) — backend
changes are verified via `cargo build`/`cargo test` (which includes live HTTP smoke tests against
the real binary) and frontend/desktop changes via `tsc`/`vite build` passing. Actual GUI/rendering
verification needs the user to run `npm run dev` themselves (after `cargo build` in
`backend-rust/` — see its README) — say explicitly what was and wasn't visually confirmed rather
than implying the UI was seen working.

**Gotcha**: if a live `npm run dev` Electron session is already running (check `Get-Process -Name
"maktaba-api","electron"` — several `electron.exe` + one `maktaba-api.exe` together means it's a
real dev session, not a stray leftover), its running `maktaba-api.exe` locks
`backend-rust/target/debug/maktaba-api.exe`, so a plain `cargo build` there can fail with a
file-in-use error. **Don't kill that process** — it's the user's active session; either wait for
them to stop it, or build to an isolated target dir (`cargo build --target-dir <temp-dir>`).

## Desktop packaging

`scripts/publish-backend.mjs` builds the Rust backend in release mode (`cargo build --release`)
for the **host** RID only — Rust needs a matching linker/SDK per *target OS*, unlike
`dotnet publish -r <rid>`, so cross-OS packaging isn't automated (build each platform's release on
that platform; see `backend-rust/README.md`'s "Cross-platform packaging" section for the mac
x64/arm64 nuance). It also stages the vendored pdfium shared library
(`backend-rust/vendor/pdfium/<rid>/`) alongside the binary — required for PDF cover thumbnails,
missing it just means those are silently skipped, not a hard failure. `electron-builder` (config
in `apps/desktop/package.json`) bundles `resources/backend/<rid>/` as `extraResources` per
platform. `npm run package:win/mac/linux` at the repo root chains build → publish-backend →
electron-builder. Known past issue: pin `electron-builder` ≥ 26 (25.x pulled a broken
`app-builder-bin` prerelease) and keep the root `package.json` `overrides.@noble/hashes: ^1.8.0`
(electron-builder's blockmap step needs the dual-CJS/ESM major; 2.x is ESM-only and breaks under
`require()`).
