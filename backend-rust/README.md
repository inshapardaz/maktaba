# Maktaba backend (Rust)

Replaces the `backend/` .NET/C# backend (`Maktaba.Api`/`Core`/`Data`/`Metadata`) with a Rust
workspace of the same shape, talking the same HTTP API to the existing Electron/React frontend
unchanged. The old `backend/` C# projects are left in place in git history until this is verified
working end-to-end - nothing here deletes them.

## Layout

Mirrors the C# project split so the two are easy to cross-reference:

```
maktaba-core/      domain entities, sqids id codec, naming helpers, shared request/result types
maktaba-metadata/  EPUB (manual zip+OPF parsing) / PDF (lopdf + pdfium-render) metadata+cover extraction
maktaba-data/      SQLite schema + connection handling, all business-logic services, read-query repo
maktaba-api/       axum HTTP server: DTOs, routes, auth/CORS, main.rs
maktaba-tests/     integration tests (spins up the real binary, hits it over HTTP)
vendor/pdfium/     vendored pdfium shared library per platform (see "PDF covers" below)
```

## Setup

1. Install Rust: `winget install Rustlang.Rustup` (or https://rustup.rs), then `rustup default stable`.
2. **Windows only**: install the MSVC linker - `winget install Microsoft.VisualStudio.2022.BuildTools`
   with the "Desktop development with C++" workload (`--add Microsoft.VisualStudio.Workload.VCTools`).
   Rust on Windows needs `link.exe` from this even though the code itself has no C++ in it.
3. `cd backend-rust && cargo build` - the workspace, in debug mode.

## Running standalone (no Electron)

```
cargo run -p maktaba-api -- --port=51000
```

No `--token` skips auth, same as the old backend - convenient for `curl`ing it directly. Health
check: `curl http://127.0.0.1:51000/health`.

`apps/desktop/src/sidecar.ts` spawns `backend-rust/target/debug/maktaba-api(.exe)` directly in dev
mode (`npm run dev` from the repo root), so a plain `cargo build` in this directory before that is
enough - no separate wiring needed.

## Database

No ORM, no migrations (matching the C# side's own "no EF Core migrations" convention) - plain
`rusqlite` with hand-written SQL, schema created via `CREATE TABLE IF NOT EXISTS` in `maktaba-data/src/db.rs`.
A `schema_meta` table records a schema version; `LibraryService` wipes and rebuilds `metadata.db`
(then triggers a rescan) whenever that version doesn't match - the exact same "database is a
rebuildable cache" mechanism the C# backend used for its own past schema changes. This also means
opening a library whose `metadata.db` was last written by the *old .NET backend* triggers exactly
one automatic rebuild+rescan on first open with the Rust backend: DB-only fields (ratings, tags,
series, collections, bookmarks, notes, reading progress) for that library are reset once, same as
any other schema-breaking change historically has been - not a bug, but worth knowing about before
opening a library you've been using with the old backend.

## PDF covers (pdfium)

The C# backend's `PDFtoImage` package wraps Google's `pdfium` to rasterize a PDF's first page as
the cover thumbnail. There's no equivalent pure-Rust PDF renderer, so this uses `pdfium-render`,
which binds to a `pdfium` *shared library* at runtime rather than linking it statically - the same
underlying renderer as before, different binding mechanism.

- `vendor/pdfium/<rid>/` holds the vendored library per platform (`pdfium.dll` for `win-x64` is
  already fetched, from https://github.com/bblanchon/pdfium-binaries - `osx-x64`/`osx-arm64`/
  `linux-x64` are **not yet fetched**, since this sandbox couldn't build/test those platforms;
  fetch the matching release asset from that repo into `vendor/pdfium/<rid>/` before packaging for
  Mac/Linux).
- `maktaba-api/build.rs` copies whatever's in `vendor/pdfium/<host-rid>/` next to the compiled
  binary on every `cargo build`, so local dev picks it up automatically.
- `scripts/publish-backend.mjs` does the same for packaged builds.
- If the library is missing at runtime, PDF cover rendering fails **silently** (matching the old
  extractor's own try/catch-and-skip behavior) - metadata/import still succeeds, just without a
  cover image for that book.

## Cross-platform packaging

Rust needs a matching linker/SDK per *target OS* (unlike `dotnet publish -r <rid>`, which can
cross-publish from one machine). `scripts/publish-backend.mjs` only builds the RID matching the
host it's run on - build each platform's release **on that platform** (e.g. a CI matrix: a
Windows runner for `win-x64`, a Mac runner for `osx-x64`/`osx-arm64`, a Linux runner for
`linux-x64`). `npm run package:mac` on an Apple Silicon Mac will only produce `osx-arm64`; an
`osx-x64` build needs `rustup target add x86_64-apple-darwin` and a separate
`node scripts/publish-backend.mjs osx-x64` run (macOS's own linker *can* target either Mac
architecture from either host, unlike the Windows/Linux case) before a universal package is put
together - this repo doesn't yet automate that last step.

## What's verified vs not (as of this migration)

Verified in this environment: `cargo build`/`cargo test` for the workspace, plus live HTTP smoke
tests against a running `maktaba-api` (`curl` against every route, exercised with a scratch
library). **Not verified**: the actual Electron app end-to-end (this sandbox can't launch a real
Electron GUI - see the root `CLAUDE.md`), nor macOS/Linux builds (no such machine available here).
Run `npm run dev` yourself to confirm the full app - import a book, browse, edit, read, rescan -
before treating this as a drop-in replacement for the C# backend.
