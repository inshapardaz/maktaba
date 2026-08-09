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

- [x] `Maktaba.Metadata`: PDF parser (`PdfPig`) — info dict (title, author, subject-as-description, creation date). The standard PDF info dictionary has no publisher/language/identifier fields (unlike EPUB's OPF metadata), so those stay null for PDFs.
- [x] PDF cover fallback: first page rendered via `PDFtoImage`/PDFium (bundled cross-platform natives for win/linux/macOS) since PDFs have no embedded-cover concept; failures (encrypted/malformed PDFs) are swallowed so import still proceeds without a cover
- [x] API: `PUT /api/books/{id}` (metadata edit — DB only, no on-disk rename; that's M3). Authors/series/tags are find-or-create by case-insensitive name, via a resolver shared with the import path (`EntityResolvers`, `Maktaba.Data/Services`)
- [x] Frontend: metadata editor (title, authors, series+index, tags, rating, description, language, publisher, date)
- [x] Frontend: search bar (title/author/series/tag, debounced) + filter panel (format, min rating) on `GET /api/books`
- [x] Frontend: browse-by-group sidebar (author / series / tag, each with book counts via `GET /api/authors|series|tags`), clicking a group filters the book list

Two real bugs turned up and were fixed during smoke testing (both verified against a real PDF ebook, not just the synthetic EPUB): (1) newly-created `Author`/`Series`/`Tag` entities reached only through a new join row's reference navigation weren't reliably cascade-inserted by EF Core's change tracker, causing a `FOREIGN KEY constraint failed` on edit — fixed by explicitly `db.Add()`-ing them in `EntityResolvers`; (2) the browse-group endpoints filtered on a computed property *after* projecting into the DTO, which EF Core can't translate to SQL — fixed by filtering on the raw navigation `.Count` before `.Select()`.

Verified end-to-end against real files: a real PDF ebook (from Downloads) imported with correct title/author/date and a real rendered cover thumbnail; an EPUB and a PDF coexisting in one library; edits persisting correctly including a tag shared across two separate edit calls (find-or-create correctly reused the existing tag rather than duplicating it); format/rating/search/group filters all verified via curl. Frontend and desktop both type-check and production-build. **Not verified here:** the Electron GUI itself — same `ELECTRON_RUN_AS_NODE=1` sandbox limitation as M0/M1.

## M3 — File Organization & Duplicates

- [x] On metadata edit that changes title/author: rename/move the on-disk book folder and its files, update `Book.FolderPath`/`BookFile.FilePath`. Best-effort rollback (moves the folder back) if the DB save fails after the move. Also cleans up the old author folder if it's left empty.
- [x] Duplicate detection on import: content-hash match (exact file) or title+author match (same book, different file); by default (`Auto`) the API returns `409` with the existing book's info so the caller can decide. Resolution actions: `skip` (leave existing untouched), `keep-both` (import as a separate book), `merge` (add this file as an additional format on the existing book, with automatic ` (2)`/` (3)` filename disambiguation)
- [x] Remove book: `DELETE /api/books/{id}` removes DB records (cascade-deletes join rows) and returns the absolute folder path; Electron's `shell.trashItem` (new `trashPath` bridge) does the actual OS-trash move, keeping file-system-shell concerns in Electron per the existing architecture split
- [x] "Rescan library" operation: `POST /api/libraries/rescan` wipes and rebuilds the index by walking `{Author}/{Title} ({BookId})` folders and re-extracting metadata from each file found. Folders not matching that convention are skipped (documented limitation). Because metadata is re-derived from each file's embedded data, DB-only edits (rating, tags, series, manual title/author corrections not reflected in the file itself) are lost on rescan — this is called out in the UI's confirmation prompt and in `ILibraryRescanService`'s docs

Verified via a single continuous backend smoke-test scenario (not just isolated calls): rename-on-title-change and rename-on-author-change both correctly moved the folder/files and left no orphaned empty author folder; duplicate detection correctly 409'd on an exact re-import and all three resolutions (`skip`, `keep-both`, `merge`) behaved correctly, including the merge path producing two distinct files in one book's folder with automatic disambiguation; `DELETE` removed DB rows and returned the right folder path without touching disk; rescan after manually deleting a book's folder correctly dropped it, and after a full rescan correctly rebuilt both remaining books (preserving their original IDs via the folder-embedded GUID) including the merged book's two files — while confirming title/metadata reverted to what's embedded in the file, as expected. Frontend and desktop both type-check and production-build; dev pipeline sequencing confirmed correct up to the same `ELECTRON_RUN_AS_NODE=1` sandbox wall as prior milestones.

## M4 — Packaging

- [x] `dotnet publish` self-contained per RID (`win-x64`, `osx-x64`, `osx-arm64`, `linux-x64`) — `scripts/publish-backend.mjs` loops `dotnet publish -r <rid> --self-contained true` into `apps/desktop/resources/backend/<rid>/`, matching the layout electron-builder's per-platform `extraResources` expects
- [x] `electron-builder` config bundling the matching backend binary as an extra resource per platform — `apps/desktop/package.json`'s `build` field; `win`/`mac`/`linux` sections each point `extraResources` at their RID's publish folder (mac uses the `${arch}` macro to pick `osx-x64`/`osx-arm64`), flattened to `resources/backend/` in the packaged app. `apps/desktop/src/sidecar.ts` now takes a `SidecarOptions` (`isPackaged`, `resourcesPath`) and spawns the native `Maktaba.Api`/`Maktaba.Api.exe` executable directly instead of `dotnet run` when packaged. An `afterPack.cjs` hook sets the executable bit on the backend binary for mac/linux targets, since it may not survive a cross-OS publish-then-zip round trip.
- [x] App icon + installer config (NSIS for Windows, dmg for macOS, AppImage for Linux) — `apps/desktop/build/icon.png` (placeholder generated by `scripts/generate-icon.mjs`; electron-builder auto-derives `.ico`/`.icns` from it), NSIS/dmg/AppImage targets configured per-platform
- [x] ~~Smoke test: packaged app launches the sidecar correctly on each target OS~~ — partially verified, see note below; full packaged-app launch not verified in this sandbox
- [x] Update `README.md` with build/release instructions — new "Packaging" section

**What was actually verified here:** the self-contained `win-x64` publish output runs standalone and correctly serves `/health` and bearer-token-gated API endpoints when launched directly with `--port`/`--token` argv (the same convention `sidecar.ts` uses), confirming the packaged-mode launch path is wired correctly. Frontend and desktop both build cleanly, and `electron-builder` successfully parses the packaging config and reaches the point of invoking its native helper tool. **Not verified here:** the final `electron-builder` packaging step (producing an actual `.exe`/`.dmg`/`AppImage`) — in this sandbox, `electron-builder`'s unsigned `app-builder.exe` helper (from the `app-builder-bin` npm package) is removed moments after `npm install` extracts it, consistent with antivirus/EDR quarantine of an unsigned downloaded binary, which is outside this environment's control. mac and linux publishing/packaging also weren't exercised at all (no access to those OSes here). Run `npm run package:win`/`:mac`/`:linux` on a normal desktop machine (or CI) to build and smoke-test the real installers — see README's "Known issues".

## Post-M4 — Entity ids switched to Sqids

Not a milestone from the original plan; a cross-cutting change requested afterward.

- [x] Replaced GUID primary keys (Book/Author/Series/Tag/BookFile/Identifier) with plain auto-increment `int`s, never exposed outside the database — `Maktaba.Core/Ids/IdCodec.cs` wraps a shared [Sqids](https://sqids.org) encoder (`MinLength = 8`) to turn them into short opaque strings (e.g. `UkLWZg9D`) everywhere else: API request/response bodies and the id embedded in a book's on-disk folder name
- [x] `ImportService` reworked: a book's id (needed for its folder name) isn't known until the DB assigns it, so the book row is now inserted first (inside a transaction) to obtain the id, then the folder/file are created and a second save records `FolderPath`; the transaction rolls back if folder/file creation fails
- [x] `LibraryRescanService`'s folder-name regex loosened from a GUID-shaped pattern to "any non-empty parenthesized segment," with validity now decided by whether `IdCodec.TryDecode` succeeds rather than by regex shape alone — also means it correctly ignores stray old GUID-named folders left over from before this change (skipped, not crashed on)
- [x] API routes changed from `{id:guid}` to a plain `{id}` string, decoded via `IdCodec.TryDecode` at the top of each handler (404 on failure); `GET /api/books`'s `authorId`/`seriesId`/`tagId` filters likewise decode from strings, with an undecodable filter value yielding an empty result rather than an error or a silently-ignored filter

One shared encoder/alphabet is used for all entity types, so a Book and an Author can encode to the identical string when their underlying integer ids match — documented in `IdCodec`'s doc comment as an accepted tradeoff, since each id is only ever decoded in the context of the one table it's looked up against.

**Breaking change**: this changed both the DB schema and the on-disk folder-naming convention rescan depends on, so a library created before this change needs `metadata.db` deleted and re-imported (or a fresh library folder) — see README's "Known issues".

Verified via a live backend smoke test against a synthetic EPUB (no frontend/Electron involved, same sandbox limitation as every other milestone): import produced a sqid-named folder (`Sqids Test Book (UkLWZg9D)`); editing the book (rename) moved the folder to a new name while keeping the same sqid; browse (`/api/authors`, `/api/series`, `/api/tags`) and filtered `/api/books` queries all round-tripped sqids correctly, including a deliberately-malformed filter value returning an empty list instead of an error; delete removed the DB row and returned the right folder path; rescan correctly recovered both books' original ids from their folder names, and a subsequent fresh import correctly continued the id sequence (no collision with a deleted id). Frontend required no code changes at all — it already treated ids as opaque strings — confirmed by a clean `tsc`/`vite build`.

## Backlog (post-v1, from SPEC.md §7)

- [ ] Format conversion (EPUB⇄MOBI/AZW3/PDF via external/embedded converter)
- [ ] OPDS / local network sharing
- [ ] Full-text search (SQLite FTS5)
- [ ] Built-in reader
- [ ] Multi-library support (`Library` table + switcher)
- [ ] Custom metadata columns
- [ ] MOBI/AZW3/CBZ/CBR format support
