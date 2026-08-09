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

- [ ] `Maktaba.Data`: EF Core `DbContext` + SQLite provider
- [ ] Initial EF Core migration: `Book`, `Author`, `BookAuthor`, `Series`, `BookSeries`, `Tag`, `BookTag`, `BookFile`, `Identifier`
- [ ] "Open/create library" flow: folder picker (Electron), persist chosen path in app config (e.g. `electron-store`), create `metadata.db` on first open
- [ ] `Maktaba.Metadata`: EPUB parser (`VersOne.Epub`) — title, author(s), language, publisher, date, description, identifiers, cover image
- [ ] Import service: SHA-256 hash file, copy/move into library folder layout (§4), write DB records in a transaction
- [ ] API: `POST /libraries/open`, `POST /books/import`, `GET /books`, `GET /books/{id}`, `GET /books/{id}/cover`
- [ ] Electron: native file/folder picker and drag-and-drop onto the window, both feeding `POST /books/import`
- [ ] Frontend: virtualized grid view (covers) and list/table view; sort by title/author/date-added/rating
- [ ] Frontend: book detail panel (cover, metadata, available formats)

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
