# Maktaba (مکتبہ) — Local-First Ebook Library Manager

**Maktaba** (مکتبہ, Urdu/Arabic/Persian for "library") is the product name used throughout this spec and the codebase (solution `Maktaba.sln`, C# namespaces `Maktaba.*`, npm packages `maktaba-desktop`/`maktaba-frontend`).

## 1. Goal

A local-first, cross-platform (Windows/macOS/Linux) desktop application for organizing and browsing a personal ebook collection — a Calibre-alternative. All data lives on the user's disk; no account or cloud dependency required to use the app.

**v1 scope (this spec):** core library management — import, metadata/cover extraction, browse/search/filter, edit metadata, on-disk file organization. Explicitly **out of scope for v1**: format conversion, network/OPDS sharing, full-text search, built-in reader, multi-library, custom columns, device sync. These are noted as future phases in §7 so the architecture doesn't block them later.

**v1 formats:** EPUB and PDF only.

## 2. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Desktop shell | Electron | Chosen explicitly over Avalonia/MAUI for React UI reuse and ecosystem. |
| Frontend | React + TypeScript, Vite, TanStack Query, TanStack Virtual (or react-window) for large list virtualization | Standard, fast dev loop, virtualization needed once a library has thousands of books. |
| Backend | C# / ASP.NET Core Minimal API, running as a **local sidecar process** launched by Electron's main process | Keeps all domain logic, metadata parsing, and DB access in C#, per the user's requirement. |
| Data access | EF Core + SQLite | Single-file DB, zero server install, fits "local-first". |
| IPC (Electron ↔ backend) | HTTP over `127.0.0.1` on a dynamically chosen free port, with a per-launch random bearer token passed to the renderer via Electron's secure IPC (not exposed to the page/network) | Avoids conflicts with other local services and avoids hardcoding a port; token prevents other local processes/pages from hitting the API. |
| Packaging | electron-builder, bundling a self-contained `dotnet publish` output per OS/arch as an extra resource | One installer per platform; no separate .NET runtime install required by the user. |

## 3. Process Architecture

```
Electron main process
  ├─ spawns backend sidecar (Maktaba.Api, self-contained exe) on app start
  │     - picks a free loopback port, passes --port and --token via argv
  │     - waits for a health-check response before creating the window
  ├─ creates BrowserWindow, injects port+token into renderer via preload/contextBridge
  │     (never via URL query string or global window var — avoid leaking to any 3rd-party script)
  └─ on quit: sends shutdown signal to sidecar, then kills it if it doesn't exit in time

Renderer (React app)
  └─ talks to http://127.0.0.1:{port}/api/... with Authorization: Bearer {token}
       for all data operations (CRUD, search, cover images, file import)

Backend sidecar (ASP.NET Core Minimal API)
  ├─ Maktaba.Api        — HTTP endpoints, request/response DTOs, auth token middleware
  ├─ Maktaba.Core        — domain model, services (import, organize, search)
  ├─ Maktaba.Data        — EF Core DbContext, SQLite, migrations
  ├─ Maktaba.Metadata    — EPUB (VersOne.Epub) and PDF (PdfPig) metadata/cover extraction
  └─ Maktaba.Tests
```

File system access (native "Open File" dialogs, drag-and-drop of files onto the window) is handled by **Electron**, which then hands the resulting file paths to the backend API to import — the backend never needs its own file picker.

## 4. On-Disk Layout

Mirrors Calibre's approach so the library folder stays portable/inspectable outside the app:

```
{Library Root}/
  metadata.db                          # SQLite — the source of truth for indexing
  {Author Sort Name}/
    {Book Title} ({Book Id})/
      cover.jpg
      {Book Title}.epub
      {Book Title}.pdf
```

- The DB is a rebuildable index: file layout + embedded metadata (OPF, PDF info dict) are the durable source; a "rescan library" operation can reconstruct `metadata.db` from disk if it's ever lost or out of sync.
- Renaming/moving files to match this layout happens on import and whenever title/author metadata is edited (configurable path template, à la Calibre, is a fast-follow — v1 ships with the one fixed template above).

## 5. Data Model

```
Book
  Id (guid), Title, SortTitle, Description, Language, Publisher,
  DatePublished, DateAdded, Rating (0-5), FolderPath

Author
  Id, Name, SortName
BookAuthor (Book Id, Author Id, Order)

Series
  Id, Name
BookSeries (Book Id, Series Id, SeriesIndex)   -- one series per book in v1

Tag
  Id, Name
BookTag (Book Id, Tag Id)

BookFile
  Id, Book Id, Format (Epub|Pdf), FilePath, FileSizeBytes, ContentHash

Identifier                                      -- optional, populated when present in source metadata
  Id, Book Id, Scheme (isbn|asin|doi|...), Value
```

Notes:
- `ContentHash` (SHA-256) on `BookFile` enables duplicate-file detection on import.
- Schema is intentionally close to Calibre's so a future "import existing Calibre library" tool is feasible.
- No `Library` table in v1 (single library, path stored in app config, not the DB) — kept out to avoid speculative multi-library plumbing; §7 covers the migration path.

## 6. Core v1 Features

1. **Create/open a library** — pick or create a root folder; app remembers last-opened library.
2. **Import books** — drag-and-drop or file-picker, single files or whole folders (recursive scan for `.epub`/`.pdf`).
   - Extract metadata: EPUB via OPF (title, author(s), language, publisher, date, description, identifiers); PDF via document info dictionary / XMP where present.
   - Extract or generate cover: EPUB manifest cover image; PDF first-page render (via PDFium-based renderer) as fallback when no embedded cover exists.
   - Detect duplicates by content hash and by (title, author) match; prompt to skip/merge/keep-both.
   - Move/copy file into the library folder structure (§4) and record it in the DB.
3. **Browse** — grid (cover-focused) and list (table) views, virtualized for large libraries; sort by title/author/date added/rating; group by author/series/tag.
4. **Search & filter** — free-text across title/author/series/tag; filter panel by author, series, tag, format, rating.
5. **Edit metadata** — per-book editor for title, authors, series+index, tags, rating, description, language, publisher, date; changes rename/move the on-disk folder to match.
6. **Remove a book** — delete from library (moves files to OS trash, not permanent delete) with DB cleanup.
7. **Book detail view** — cover, metadata, list of available formats, open-in-default-app / reveal-in-folder actions (v1 has no built-in reader).

## 7. Explicitly Deferred (design shouldn't block these, but not built in v1)

- Format conversion (EPUB⇄PDF/MOBI/AZW3) — would call an external tool (or embed a converter) similarly to Calibre's `ebook-convert`.
- OPDS / local network sharing — an additional ASP.NET endpoint set, exposed beyond loopback, would need real auth.
- Full-text search — would add a search index (e.g., SQLite FTS5) over extracted book text.
- Built-in reader.
- Multi-library support — would promote the implicit single library into a `Library` table + a library switcher.
- Custom metadata columns.
- MOBI/AZW3/CBZ/CBR format support — same `ELibrary.Metadata` extension point as EPUB/PDF.

## 8. Repository Layout

```
e-library/                # working directory name (unchanged unless you want it renamed too)
  apps/
    desktop/            # Electron main + preload (TypeScript) — package "maktaba-desktop"
    frontend/           # React app (TypeScript, Vite) — package "maktaba-frontend"
  backend/
    Maktaba.Api/
    Maktaba.Core/
    Maktaba.Data/
    Maktaba.Metadata/
    Maktaba.Tests/
    Maktaba.sln
  docs/
    SPEC.md
  package.json           # npm/pnpm workspace root (desktop + frontend)
```

## 9. Milestones

- **M0 — Scaffolding:** repo/workspace setup, Electron shell spawns a "hello world" C# sidecar and renders its response in React. Build scripts for dev mode (hot reload on both sides).
- **M1 — Import & browse (EPUB only):** library creation, EPUB import with metadata/cover extraction, grid/list browsing, SQLite persistence.
- **M2 — PDF support + editing:** PDF metadata/cover extraction, metadata editor, search/filter/sort, tag/series/author browsing.
- **M3 — File organization & duplicates:** on-disk rename/move on metadata edit, duplicate detection, remove-to-trash.
- **M4 — Packaging:** electron-builder installers for Windows/macOS/Linux with the self-contained backend bundled.

## 10. Open Questions (revisit before/at M1)

- Path template configurability (fixed in v1 per §4 — confirm that's acceptable long-term).
- Windows/macOS/Linux minimum OS versions to support (affects .NET RID matrix and Electron version).
- License for the project (affects choice of any GPL-licensed metadata/conversion libraries down the line).
