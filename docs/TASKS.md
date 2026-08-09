# Maktaba — Implementation Task List

Derived from [SPEC.md](SPEC.md) §9. Grouped by milestone; check off as completed.

## M0 — Scaffolding

- [x] `git init`, `.gitignore` (node, dotnet, build output, `.env`)
- [x] npm workspace root `package.json` (`apps/desktop`, `apps/frontend`)
- [x] Scaffold `apps/frontend`: React + TypeScript + Vite
- [x] Scaffold `apps/desktop`: Electron main + preload (TypeScript)
- [x] Scaffold `backend/Maktaba.sln` with projects: `Maktaba.Api`, `Maktaba.Core`, `Maktaba.Data`, `Maktaba.Metadata`, `Maktaba.Tests`
- [x] `Maktaba.Api`: minimal API host with a `/health` endpoint
- [x] Electron main: spawn `Maktaba.Api` as child process on a free loopback port with a random bearer token (argv), wait for `/health` before creating the window
- [x] Electron preload: expose `port`/`token` to renderer via `contextBridge` only (no globals, no query string)
- [x] Electron main: graceful sidecar shutdown on app quit (signal, then kill after timeout)
- [x] Frontend: call a "hello" endpoint through the injected port/token and render the response, proving the round trip works
- [x] Dev script wiring one command to run: TypeScript watch (Electron) + Vite dev server + Electron; Electron's main process spawns `dotnet run` for the Api itself, so no separate `dotnet watch` process is needed
- [x] `README.md` with dev setup/run instructions

Verified in this environment: backend builds and its `/health` (no auth) and `/api/hello` (bearer-token-gated, 401 without it) endpoints behave correctly when run standalone; frontend and desktop TypeScript both type-check and build; the combined `npm run dev` pipeline starts Vite and the TS watcher and correctly sequences Electron behind them. **Not verified here:** an actual Electron window/renderer, because this sandbox forces `ELECTRON_RUN_AS_NODE=1` which prevents Electron from launching a real GUI — run `npm run dev` on a normal desktop machine to confirm the window opens and shows the "Backend says: Hello from Maktaba.Api" message end-to-end.

## M1 — Import & Browse (EPUB only)

- [x] `Maktaba.Data`: EF Core `DbContext` + SQLite provider
- [x] ~~Initial EF Core migration~~ — used `Database.EnsureCreatedAsync()` instead of migrations tooling: the on-disk library is already documented (§4) as a rebuildable index, so versioned migrations add tooling overhead (`dotnet-ef`, a design-time factory) without a matching benefit yet. Revisit if/when schema changes need to preserve existing users' data rather than a rescan.
- [x] "Open/create library" flow: folder picker (Electron `dialog.showOpenDialog`), last-opened path persisted by the backend itself to `%AppData%/Maktaba/config.json` (cross-platform via `Environment.SpecialFolder.ApplicationData`) rather than via Electron, so the backend stays usable independent of any particular frontend
- [x] `Maktaba.Metadata`: EPUB parser (`VersOne.Epub`) — title, author(s), language, publisher, date, description, identifiers, cover image
- [x] Import service: SHA-256 hash file, copy into library folder layout (§4) (copy, not move — the original source file is never touched/deleted), write DB records in a transaction, with best-effort cleanup of partially-written files on failure
- [x] API: `POST /api/libraries/open`, `GET /api/libraries/current`, `POST /api/books/import`, `GET /api/books`, `GET /api/books/{id}`, `GET /api/books/{id}/cover`. A `LibraryNotOpenException` + middleware maps "no library open" to a clean 400 instead of a 500. Cover endpoint additionally accepts `?access_token=` since `<img>` tags can't set an Authorization header.
- [x] Electron: native file/folder picker (`dialog`), drag-and-drop via `webUtils.getPathForFile`, plus `shell.openPath`/`shell.showItemInFolder` for the detail panel's Open/Show-in-folder actions — all feeding `POST /api/books/import`
- [x] Frontend: virtualized grid view (covers, via `@tanstack/react-virtual`) and list/table view; sort by title/author/date-added/rating
- [x] Frontend: book detail panel (cover, metadata, available formats, Open/Show-in-folder actions)

Verified in this environment via `dotnet build` (whole solution) and a full HTTP smoke test against a synthetic EPUB: open library → import → list → detail → cover, plus the no-library-open 400 path. Frontend and desktop both type-check and production-build. **Not verified here:** the actual Electron GUI (drag-and-drop, native dialogs, grid rendering) — same `ELECTRON_RUN_AS_NODE=1` sandbox limitation as M0; run `npm run dev` on a normal desktop machine to confirm the UI end-to-end.

## M2 — PDF Support + Editing

- [ ] `Maktaba.Metadata`: PDF parser (`PdfPig`) — info dict / XMP metadata
- [ ] PDF cover fallback: render first page to an image (e.g. `PDFtoImage`) when no embedded cover exists
- [ ] API: `PUT /books/{id}` (metadata edit); CRUD for tags/series/authors as needed by the editor
- [ ] Frontend: metadata editor (title, authors, series+index, tags, rating, description, language, publisher, date)
- [ ] Frontend: search bar (title/author/series/tag) + filter panel (author, series, tag, format, rating)
- [ ] Frontend: browse-by-group views (author / series / tag)

## M3 — File Organization & Duplicates

- [ ] On metadata edit that changes title/author: rename/move the on-disk book folder, update `BookFile.FilePath`
- [ ] Duplicate detection on import: content-hash match and (title, author) match; resolution UI (skip / merge / keep both)
- [ ] Remove book: send files to OS trash (`shell.trashItem` in Electron), clean up DB records
- [ ] "Rescan library" operation: rebuild `metadata.db` from on-disk files + embedded metadata

## M4 — Packaging

- [ ] `dotnet publish` self-contained per RID (`win-x64`, `osx-x64`, `osx-arm64`, `linux-x64`)
- [ ] `electron-builder` config bundling the matching backend binary as an extra resource per platform
- [ ] App icon + installer config (NSIS for Windows, dmg for macOS, AppImage for Linux)
- [ ] Smoke test: packaged app launches the sidecar correctly on each target OS
- [ ] Update `README.md` with build/release instructions

## Backlog (post-v1, from SPEC.md §7)

- [ ] Format conversion (EPUB⇄MOBI/AZW3/PDF via external/embedded converter)
- [ ] OPDS / local network sharing
- [ ] Full-text search (SQLite FTS5)
- [ ] Built-in reader
- [ ] Multi-library support (`Library` table + switcher)
- [ ] Custom metadata columns
- [ ] MOBI/AZW3/CBZ/CBR format support
