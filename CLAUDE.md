# Maktaba (مکتبہ) — project context for Claude

Local-first ebook library manager (Calibre-alternative). Electron + React/TypeScript frontend,
C#/.NET 9 backend running as a local HTTP sidecar. By default all data lives on the user's disk
under a library folder the user picks, no accounts needed — a library can *optionally* live in an
S3-compatible cloud storage bucket instead (see "Cloud storage" below), but local-first remains the
default and every local workflow is unaffected by that being available.

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
  Maktaba.Cloud     — cloud storage provider SDKs, isolated from Maktaba.Data the same way
                       Maktaba.Metadata isolates format-parsing SDKs (S3StorageProvider,
                       GoogleDriveStorageProvider, OneDriveStorageProvider today; Nawishta would
                       land the same way) - see "Cloud storage" below
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

## Cloud storage

A library's `ProviderType` (on its `LibraryRegistryEntry`, `Maktaba.Core/Services/ILibraryService.cs`)
is `"local"` (default, unchanged behavior) or a cloud provider — `"s3"` (real Amazon S3 or any
S3-compatible provider: MinIO/Backblaze B2/DigitalOcean Spaces/Cloudflare R2/IDrive e2/self-hosted,
via an optional `Endpoint` in `ProviderConfig`, `Maktaba.Cloud/S3ProviderOptions.cs`), `"googledrive"`
(`Maktaba.Cloud/GoogleDriveProviderOptions.cs`), or `"onedrive"` (`Maktaba.Cloud/OneDriveProviderOptions.cs`)
today. `IStorageProvider` (`Maktaba.Core/Services/IStorageProvider.cs`) is the abstraction every
file-touching service goes through instead of raw `System.IO` - `LocalFileSystemProvider` is a
pass-through for local libraries; `S3StorageProvider`/`GoogleDriveStorageProvider`/
`OneDriveStorageProvider` each keep a local cache mirror (`ICloudCacheManager`, under
`{userData}/CloudCache/{libraryId}/`) in sync with the remote store, so reads/writes above the
provider layer still just work with plain local paths (offline reading of already-cached books
included). `StorageProviderFactory` resolves the right one per the active library, keyed by
`(libraryId, providerType, credentialHash)` so a library migrated from one provider to another (or
reconnected with a changed credential) never accidentally reuses a cached instance built for the old
one.

**Google Drive specifics** (`GoogleDriveStorageProvider.cs`) - unlike S3's flat keyspace or a
path-addressable filesystem, Drive links every file/folder to its parent purely by id (and even
tolerates duplicate names under one parent). `ResolveFolderIdAsync`/`FindChildAsync`/
`FindItemIdAsync` are this provider's own substitute for path addressing: walk a `/`-separated path
one segment at a time, matching (and, for folders, creating) by name under each resolved parent id,
with an in-memory path→id cache scoped to the provider instance's lifetime. Talks to Drive v3
directly over `HttpClient` rather than pulling in Google's own client SDK (Drive v3's REST surface
is small enough that this avoided a third generated-client dependency in `Maktaba.Cloud`, after
`AWSSDK.S3` and `Microsoft.Graph`). Sign-in is OAuth2 with PKCE via a loopback listener in Electron's
main process (`apps/desktop/src/googleDriveAuth.ts` + the provider-agnostic
`apps/desktop/src/oauthLoopback.ts`, opened with `shell.openExternal` rather than an embedded
webview) - unlike a fully public OAuth client, Google's "Desktop app" client type still requires a
`client_secret` in the token exchange even with PKCE, which Google's own docs say isn't meant to
stay confidential for this client type (it ships inside the app regardless), so it's hardcoded in
both `googleDriveAuth.ts` and `GoogleDriveStorageProvider.cs`'s `GoogleDriveTokenManager` rather than
sourced from the environment - the latter only protects a secret a build pipeline injects, and this
project packages locally with no such pipeline (see "Desktop packaging" below).

**Setting up the Google Cloud project** (one-time, done once for the whole app - end users never
do any of this themselves). Needed whenever `CLIENT_ID`/`CLIENT_SECRET` have to be created or
rotated:

1. [console.cloud.google.com](https://console.cloud.google.com) → sign in with a personal Google
   account (not one tied to a former employer/organization's Workspace tenant - that tenant's own
   policies can block creating an app registration there; use a private-browsing window if a
   work-account session is already cached and getting in the way). No billing account/credit card
   is needed for any of this.
2. Create a new project (any name, e.g. "Maktaba").
3. **APIs & Services → Library** → search "Google Drive API" → **Enable**. Easy to miss - creating
   OAuth credentials doesn't enable the underlying API on its own.
4. **APIs & Services → OAuth consent screen**:
   - User type: **External** (Maktaba isn't a Google Workspace organization, so "Internal" isn't
     an option).
   - Branding: **App name** (e.g. "Maktaba"), **User support email**, **Developer contact
     information** are required. **Privacy policy link**/**Terms of service link** can point at
     `https://inshapardaz.github.io/maktaba/privacy-policy`/`.../terms-and-conditions` (see "Help &
     onboarding" below - GitHub Pages, deployed from `docs/`). **Authorized domains** should stay
     **blank** - it would need Google Search Console domain-ownership verification that doesn't
     apply here (the redirect target is a loopback address, not `github.io`), so leaving it empty
     works fine at this scope even with the two links above filled in.
   - **Data access / Scopes** → Add or Remove Scopes → add all three: `.../auth/drive.file`,
     `.../auth/userinfo.email`, `.../auth/userinfo.profile` (must match `SCOPES` in
     `googleDriveAuth.ts` exactly, or the authorize request fails).
   - Starts in **Testing** status: only Google accounts explicitly added under **Test users** can
     sign in. Publishing (below) removes that restriction.
5. **APIs & Services → Credentials → Create Credentials → OAuth client ID** → Application type
   **Desktop app**. No redirect URI to register - Google's Desktop app client type accepts the
   loopback IP `127.0.0.1` on any port without pre-registration (see `oauthLoopback.ts`'s doc
   comment on why `127.0.0.1` specifically, not `localhost`, for this provider).
6. Copy the **Client ID** and **Client secret** it generates into both `CLIENT_ID`/`CLIENT_SECRET`
   constants (`googleDriveAuth.ts` and `GoogleDriveStorageProvider.cs`'s `GoogleDriveTokenManager` -
   both need updating together, they must match).
7. To test as yourself before publishing: **OAuth consent screen → Test users → Add users** → the
   exact Google account you'll sign in with in Maktaba.
8. To let *any* Google user sign in (not just listed test users): **OAuth consent screen → Publish
   App**. Since every scope above is classified non-sensitive, this shouldn't trigger Google's full
   verification review - just a status flip to **In production**.

Troubleshooting notes from actually setting this up once already:
- A generic Google error page at `accounts.google.com/info/unknownerror` (not redirected back to
  Maktaba's own loopback listener with an `error=` code) usually means the Client ID doesn't match
  what's in Credentials, or the consent screen never finished saving - re-check both character for
  character.
- A 500 from Google's own `.../signin/oauth/warning/continue` internal endpoint (the "Google
  hasn't verified this app" interstitial) was resolved by retrying in an incognito/private window -
  suspected stale session cookie or new-client propagation delay, not anything wrong on Maktaba's
  side.
- "Maktaba has not completed the Google verification process... can only be accessed by
  developer-approved testers" means the signing-in account isn't on the Test users list yet (or the
  consent screen hasn't been published) - see steps 4/7/8 above.

**OneDrive specifics** (`OneDriveStorageProvider.cs`) - unlike Drive's id-based addressing, Graph's
path-based item addressing (`/drive/root:/{itemPath}:/...`, via `ItemWithPath`) lets this provider
address items by path the same way `S3StorageProvider` addresses objects by key, so there's no
path→id cache to maintain the way Google Drive needs one. Talks to the signed-in account's OneDrive
via the Microsoft Graph SDK (`Microsoft.Graph`) rather than raw HTTP, since Graph's own SDK is
already a dependency-worthy, well-typed client (unlike Drive v3, where a raw `HttpClient` avoided
pulling in a whole extra generated-client dependency). Sign-in is OAuth2 with PKCE via the same
provider-agnostic loopback listener Google Drive uses (`apps/desktop/src/oneDriveAuth.ts` +
`apps/desktop/src/oauthLoopback.ts`) - unlike Google's Desktop app client type, an Azure AD "Mobile
and desktop applications" public client needs no `client_secret` at all (PKCE alone is sufficient),
so `CLIENT_ID` is a plain hardcoded constant in both `oneDriveAuth.ts` and
`OneDriveStorageProvider.cs`'s `OneDriveTokenManager` (not a secret, so no build-time generation
step like Google's `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` is needed - see
`scripts/generate-google-oauth-config.mjs` for that one's reasoning) - **both need updating together
once a real Azure AD app registration exists; they still hold a `00000000-0000-0000-0000-000000000000`
placeholder as of this phase, so OneDrive sign-in will fail until that's done** (see the walkthrough
below). `oauthLoopback.ts`'s `loopbackHost` parameter is `"localhost"` for this provider (Microsoft's
identity platform requires the registered redirect URI to be the literal hostname `"localhost"`,
any port ignored when matching) rather than Google's `"127.0.0.1"` - see that function's own doc
comment for why the two providers need different loopback hostnames at all.

**Setting up the Azure AD app registration** (one-time, done once for the whole app - end users
never do any of this themselves). Needed whenever `CLIENT_ID` has to be created or rotated:

1. [portal.azure.com](https://portal.azure.com) → sign in with a personal Microsoft account (a
   plain outlook.com/hotmail.com/live.com account, or any Microsoft account - this does **not**
   need an Azure subscription or any paid tier; Entra ID's free tier covers app registrations).
2. **Microsoft Entra ID → App registrations → New registration**:
   - **Name**: any name (e.g. "Maktaba").
   - **Supported account types**: **Personal Microsoft accounts only** - Maktaba targets OneDrive
     Personal, not OneDrive for Business/SharePoint, so this is what makes the `/consumers/`
     endpoint (rather than `/common/`) the correct one in both `oneDriveAuth.ts` and
     `OneDriveTokenManager` - registering under a broader option here and leaving those endpoints
     as `/consumers/` is a common source of "application not found in directory" errors.
   - **Redirect URI**: platform **"Mobile and desktop applications"**, then check the box for the
     pre-listed `http://localhost` option (no port - Microsoft's identity platform ignores the port
     when matching a `localhost` redirect URI for this platform type, letting `oauthLoopback.ts`
     pick a fresh free port every sign-in without needing one fixed port reserved for Maktaba).
3. Copy the **Application (client) ID** from the registration's Overview page into the `CLIENT_ID`
   constant in both `oneDriveAuth.ts` and `OneDriveStorageProvider.cs`'s `OneDriveTokenManager` -
   both need updating together, they must match. No client secret to create - a "Mobile and desktop
   applications" redirect URI platform is a public client by definition, and **Certificates &
   secrets** should stay empty.
4. **API permissions** - `Files.ReadWrite`, `offline_access`, and `User.Read` (matching `SCOPES` in
   `oneDriveAuth.ts`) should already be present as delegated Microsoft Graph permissions by default
   for a new registration; if not, **Add a permission → Microsoft Graph → Delegated permissions**
   and add them there. No admin consent is needed for any of these (none are marked "requires admin
   consent") since they're all standard user-delegated permissions - each signing-in user consents
   for themselves on first sign-in.
5. No publisher verification/consent-screen review step exists for a personal-account-only
   registration the way Google's OAuth consent screen has a Testing/Production split - once the
   Application (client) ID is in place, any Microsoft personal account can sign in immediately.

**metadata.db stays local even for a cloud library** — only pulled/pushed as a whole file
(`IStorageProvider.PullDatabaseAsync`/`PushDatabaseAsync`), pulled on library open, pushed on a
timer (`CloudSyncLifecycleService`, every 5 min), via the manual "sync to cloud now" button
(`LibrarySyncContext.tsx`, confirms then blocks the whole app behind a plain page for the duration
— see below for why), on switching *away* from a cloud library (`LibraryService.ActivateAsync`
pushes the outgoing library before activating the new one - otherwise the heartbeat above would
start targeting the new library immediately and never come back to push the old one's last edits),
and best-effort on app shutdown (`POST /shutdown` → `IHostApplicationLifetime.StopApplication()` →
`CloudSyncLifecycleService.StopAsync`, requested by `apps/desktop/src/sidecar.ts`'s
`stopSidecarGracefully` before falling back to a hard kill - a plain `process.kill()` alone doesn't
work for this on Windows, see that function's doc comment). Concurrency model is single-writer,
last-write-wins — no reconciliation logic, the file is just replaced wholesale.

**Cloud library locking** guards against the "same library open on two devices at once" case the
above would otherwise silently lose data on. `IStorageProvider.ReadLockAsync`/`WriteLockAsync`/
`DeleteLockAsync` (implemented per-provider - S3/Google Drive/OneDrive each just read/write/delete a
plain `.maktaba-lock` text object directly against the remote store, always bypassing the local
cache mirror since the whole point is seeing what a *different* device just wrote) read/write
`LibraryLockInfo` (`Maktaba.Core/Sync/LibraryLockInfo.cs` - device name, a per-install machine id,
and an acquired-at timestamp; `IsStale` treats one older than 2 minutes as abandoned rather than
blocking forever on a crashed/killed holder). `LibraryService.ActivateAsync` is what actually
enforces this: before pulling/pushing a cloud library's database, it calls `ReadLockAsync` and
throws (surfaced to the frontend as a plain error message, same path as any other failed open) if a
non-stale lock belongs to a different device, otherwise writes its own. `CloudSyncLifecycleService`
runs a second, much shorter-interval (`60s`, comfortably under the 2-minute staleness window) timer
loop refreshing the lock for as long as this process has the library open, and releases it (best-
effort, alongside the existing DB push) both on switching/removing the active library
(`LibraryService.PushCurrentLibraryIfCloudAsync`) and on `StopAsync` (app shutdown) - so a clean
close/switch lets another device in immediately rather than making it wait out the full staleness
window. `LibraryMigrationService.ExcludedFileNames` already excluded `.maktaba-lock` from being
migrated as ordinary book content (predates this feature - see that field's own comment), since a
lock marker means something different in the *target* location's context than a copied file would.
This narrows, but doesn't eliminate, the risk: it's still not a real merge, and there's a small
unavoidable window (between two devices' own lock checks) any advisory lock has - treat it as a
strong deterrent against the common case (opening a library on a second device while forgetting it's
open on the first), not a hard guarantee.

**`ActivateAsync` doesn't pull unconditionally.** `IStorageProvider.GetRemoteDatabaseLastModifiedAsync`
(implemented per-provider - S3's object `LastModified`, Google Drive's `modifiedTime` field, null
for `LocalFileSystemProvider`) is compared against the local cache mirror's own
`File.GetLastWriteTimeUtc` before deciding to pull: if the local copy is already at least as fresh
(it has unpushed edits, or was already caught up), `ActivateAsync` pushes instead of pulling -
still last-write-wins, not a real merge, but it stops a plain re-open/switch of a library that was
already open here from silently discarding local edits just because *some* remote copy exists,
which unconditionally pulling on every activation used to do. `ActivateAsync` also holds
`_schemaCheckLock` (shared with `EnsureCurrentSchemaAsync`) for its whole pull-or-push+create
sequence now, closing a race where a concurrent request (a stray background poll, an in-flight
image load that started before a switch) could call `EnsureCreatedAsync` against the same library's
not-yet-fully-pulled database path, surfacing as "access is denied".

**Credentials never reach this backend's disk.** The Electron main process encrypts them via
`safeStorage` (`apps/desktop/src/native.ts`'s `maktaba:*-cloud-credential` IPC, keyed by an opaque
`CredentialRef` — currently always just the library's own id) - this .NET process can't decrypt
that blob itself, so the renderer decrypts it and passes the plaintext over the loopback HTTP
sidecar each time it's needed (connecting a library, reopening one after every backend restart -
`ICloudCredentialCache` is in-memory-only, cleared every restart). `App.tsx`'s `cloudReconnectQuery`
does this automatically on startup for whichever library was last active; if that fails (dead
network, revoked credential, ...) the error screen embeds the same library list Settings →
Libraries shows, so switching to a different library never requires fighting through Settings
first - a real gap found and fixed during Phase 2 development, see git history on the
`inshapardaz/maktaba` "S3 Library Support" PR for the full trail of what broke and why.

**Known sharp edge**: Microsoft.Data.Sqlite defaults to WAL mode, which keeps a memory-mapped
`{db}-shm` file (plus a `{db}-wal` journal) open via the connection pool for a while after every
`MaktabaDbContext` using them is disposed - overwriting `metadata.db` (on pull) or reading it raw
(on push) without first calling `SqliteConnection.ClearAllPools()` and clearing stale `-wal`/`-shm`
sidecars fails on Windows with a *persistent* (not transient) `IOException`/`UnauthorizedAccessException`
that no retry count fixes. Both `LibraryService.ActivateAsync` (pull) and the `/sync-now` endpoint
(push) do this already for any non-local provider - if a new code path ever touches
`metadata.db`'s bytes directly for a cloud library, it needs the same treatment.

**Deleting a book/periodical from a cloud library actually deletes it remotely.** `BookRemovalService.RemoveAsync`/
`PeriodicalService.DeleteAsync` return `RequiresLocalTrash` (true only for `"local"`) alongside the
folder path - for a local library, nothing changed: the frontend still moves that folder to the OS
trash itself (`window.maktaba.trashPath`), same as always. For a cloud library, the *backend* now
calls `IStorageProvider.DeleteAsync(folderPath, recursive: true, ct)` itself (best-effort - a failed
remote delete logs a warning but doesn't block removing the DB rows) before returning, and the
frontend skips `trashPath` entirely when `RequiresLocalTrash` is false. Before this, only the DB row
was ever removed for a cloud library - the actual files (and every issue's, for a periodical) stayed
orphaned in the remote store forever, since `window.maktaba.trashPath` is a pure local-disk
operation with zero cloud awareness. Every call site that deletes a book/periodical
(`BookDetailPanel.tsx`, `DeleteBooksConfirmDialog.tsx`, `MergeConfirmDialog.tsx`'s source-book
cleanup, `PeriodicalDetailView.tsx` (both issue and periodical delete), `PeriodicalsView.tsx`) now
checks this flag the same way. Per-file deletion (`BookEditService`'s `RemoveFileAsync`/replace-file
paths) was never affected - those already called `Storage.DeleteAsync` directly rather than routing
through the frontend's OS-trash flow at all.

Deleting a plain book (not a periodical issue) also cleans up its now-possibly-empty author folder
("{Author Sort Name}/{Book Title} (sqid)", see `LibraryPathBuilder`) - purely a derived grouping
with no identity of its own once nothing files under it, unlike a periodical issue's parent (its
periodical's own folder, which has an independent identity - a `Periodical` DB row that still
exists), which is never pruned this way. `BookRemovalResult.ParentFolderPath` carries the path to
check, only ever set for a local library and never for an issue. For a cloud library, `RemoveAsync`
already handles this itself (an `EnumerateAsync` check before deleting the parent, both best-effort,
same as the book folder's own delete). For a local library, the caller does the actual check -
`window.maktaba.trashPathIfEmpty` (native.ts), called only *after* the book's own folder has
actually been trashed, so it's checking real, current state rather than the backend guessing ahead
of time - a no-op if the folder is missing or still has something in it (a file the user placed
there Maktaba doesn't know about, say).

**"View in Google Drive"** (issue #102) - `IStorageProvider.GetWebViewUrlAsync` returns a web URL to
view a file directly in the provider's own UI, purely a convenience link (never used for any actual
file I/O). Only Google Drive implements it for real (`https://drive.google.com/file/d/{id}/view`,
built directly from the already-resolved item id - no extra API call needed); S3 returns null (no
single console URL works across every S3-compatible provider this app supports, from AWS itself to
a self-hosted MinIO with no web console at all) and so does OneDrive for now (parked alongside the
rest of OneDrive support - see above). `BookFileDto.WebViewUrl`/`BookFileInfo.webViewUrl` are only
ever populated by `GET /api/books/{id}`'s own file list (the one place it's actually rendered, as a
button in `BookDetailPanel.tsx`) - every other endpoint returning a `BookFileDto` (add/rename/
convert a file) leaves it null rather than making a remote call for a value nothing they return
renders; the frontend's own book-detail query is always refetched after those anyway, which picks up
the real value. Opening it goes through a plain `<a target="_blank">` - see `main.ts`'s
`web-contents-created`/`setWindowOpenHandler` below for why that's not a no-op.

**External links always route through `shell.openExternal`, never a bare Electron popup window** -
`main.ts` registers one `app.on("web-contents-created", ...)` `setWindowOpenHandler` covering every
window (main, every reader window, Help), denying Electron's own default action (spawning a
chromeless `BrowserWindow` that navigates in-app) and opening the user's actual default browser
instead. Applies uniformly to every `<a target="_blank">` this app renders - `AboutSettings.tsx`'s
GitHub/Privacy Policy/Terms & Conditions links, the "View in Google Drive" button above, and any
future one - without needing to repeat the handler at each window's own construction site.

Frontend surface: `LibrariesSettings.tsx`'s "Connect S3-compatible library…" form (bucket/region/
subfolder/endpoint/access key/secret, with a "Test connection" step) and its "Connect Google
Drive…"/"Connect OneDrive…" forms (name/optional folder, plus a "Sign in with Google"/"Sign in with
Microsoft" button instead of typed credentials - a successful sign-in already proves the credential
works, so there's no separate test step), a provider badge, and a sync-to-cloud button - all only
ever rendered for a non-local library, so a local-only user sees nothing new. The key-icon
"Reconnect…" action (re-supplying a stale/missing credential without disconnecting the whole
library) branches the same way: typed access key/secret for S3, a "Sign in again" button for either
OAuth-based provider. `connectCloudLibrary`/
`reopenCloudLibrary` (`api.ts`) are generic over the credential shape - neither they nor the backend
endpoints care about a specific provider's credential JSON, only that it round-trips as an opaque
string. `components/providerIcons.tsx` is the one shared per-provider icon map (a bold "G" glyph
for Google Drive, `IconCloud` for S3/OneDrive/Nawishta - no icon library ships actual brand logos),
consumed by both `LibrariesSettings.tsx` and `LibrarySwitcher.tsx` (the sidebar-bottom dropdown) so
a library's provider reads the same everywhere rather than each spot picking its own. Switching
libraries (from either of those two places) goes through `LibrarySwitchContext.tsx` - mirrors
`LibrarySyncContext.tsx`'s shape (one shared `isSwitching`/`error`, `App.tsx` renders a blocking
"Switching library…" page while it's true) so both callers share one loading/error UX instead of
running independent mutations. That blocking page (and the pre-existing syncing one) intentionally
does *not* unmount the sidebar itself - `App.tsx`'s `showShellChrome` (just "is a library loaded",
checked separately from the stricter `hasLibrary` used for gating actual interactive content) is
what `AppShell.Navbar`'s own mount/width react to, so a few seconds of loading in the main content
area doesn't also make the whole window's layout jump around. See `docs/en/libraries.md`'s "Cloud
libraries" section for the end-user-facing explanation of all of this.

**Migration wizard** (`MigrationWizard.tsx`, Stepper: Target → Review → Migrate → Finish) moves the
*active* library to a new provider - the Target step's own `SegmentedControl` picks which one (S3 or
Google Drive today; OneDrive isn't offered here yet, same reasoning as its own Connect form -
blocked on a real Azure AD app registration, see "Cloud storage" above), then shows that provider's
own fields/sign-in flow, reusing `S3CredentialFields`/`window.maktaba.connectGoogleDrive()` rather
than inventing per-provider migration forms. `startMigration`'s backend endpoint
(`POST /migrate/start`) and `ILibraryMigrationService`/`LibraryMigrationService`
(`Maktaba.Data/Services/LibraryMigrationService.cs`) runs the copy as a background `Task.Run`,
tracked via an in-memory `MigrationProgressSnapshot` polled the same way rescan progress is
(`GET /api/libraries/migrate/status`). Walks every file via `IStorageProvider.EnumerateAsync`
(recursing manually - it only ever returns one level), copies each via
`GetLocalPathAsync`(source)+`NotifyWrittenAsync`(target) - deliberately built on `IStorageProvider`'s
existing methods rather than adding a new "copy bytes" one. Resumable via
`IStorageProvider.ExistsRemoteAsync` - a file already confirmed present at the target is skipped.
Deliberately *not* the general-purpose `ExistsAsync` (which checks a provider's local cache mirror
first): a target's cache can hold a file copied into it locally on a previous interrupted/failed
migration attempt but never actually confirmed pushed remotely, which `ExistsAsync`'s cache-first
shortcut would mistake for "already migrated" and silently skip re-uploading forever - a real bug
hit and fixed during Phase 3 development (see git history for the full trail).
`metadata.db` is migrated separately via each provider's own `Pull`/`PushDatabaseAsync`, never as a
plain file copy. Never touches the library registry until a verified migration's `CompleteAsync`
runs (the wizard's Finish step) - `ILibraryService.SwitchProviderAsync` re-points the *same*
library id at the new provider (so DB-only data survives untouched), and optionally deletes the
old *local* folder (never a previous cloud source's remote objects - out of scope for a checkbox).
`IStorageProviderFactory.CreateForProvider` is what makes an ad-hoc target provider possible before
the library is actually registered under that provider type.

## IDs

Every entity (`Book`, `Author`, `Series`, `Tag`, `BookFile`, `Identifier`, `Collection`) uses a
plain auto-increment `int` primary key internally, **never exposed outside the DB**.
`Maktaba.Core/Ids/IdCodec.cs` wraps a shared Sqids encoder to turn it into an opaque string
(`UkLWZg9D`-style) for API bodies and the on-disk folder name. One shared alphabet is used for all
entity types, so a Book and an Author *can* encode to the same string when their underlying ints
match — that's fine, each id is only ever decoded against the one table it's looked up in. API
routes take a plain `{id}` string and `IdCodec.TryDecode` it, returning 404 on failure rather than
throwing.

## Query services (Nawishta epic, read-path abstraction)

`ILibraryQueryServiceFactory` (`Maktaba.Core/Services/ILibraryQueryServiceFactory.cs`) resolves four
read-path services for the active library - `Books` (`IBookQueryService`), `Browse`
(`IBrowseQueryService` - authors/series/tags/publishers/languages/reading-status groups),
`Collections` (`ICollectionQueryService`), `Periodicals` (`IPeriodicalQueryService`) - mirroring
`IStorageProviderFactory`'s own "one factory, resolved per active library's ProviderType" shape.
`Maktaba.Data/Services/LibraryQueryServiceFactory.cs` (registered scoped, not singleton - needs a
fresh `MaktabaDbContext` per request) is the only implementation today, wrapping
`EfBookQueryService`/`EfBrowseQueryService`/`EfCollectionQueryService`/`EfPeriodicalQueryService` -
a **literal, behavior-preserving move** of logic that used to live inline in
`BookEndpoints.cs`/`BrowseEndpoints.cs`/`CollectionEndpoints.cs`/`PeriodicalEndpoints.cs`'s GET
lambdas as raw `MaktabaDbContext` LINQ, not a rewrite. Cover lookups, storage-path resolution, and
DTO construction all stay in the endpoint layer (they depend on `IStorageProviderFactory`/
`CoverLocator`, which live above/outside `Maktaba.Core`) - these interfaces only ever answer "which
books/authors/series/etc., in what order, how many", returning the same `Book`/`Periodical`/etc.
domain entities (or small new read-model records like `EntityGroupCount`) a REST-backed
implementation would map remote API responses into.

This exists because of a Nawishta epic finding (issue #106's spike): the epic's own design doc
assumed read-side service interfaces (`IBookService`, etc.) already existed as a seam for a second,
REST-backed implementation to plug into - they didn't. Every read for Books/Authors/Series/Tags/
Collections/Periodicals was raw inline EF directly in endpoint lambdas; only *writes*
(`IBookEditService`, `IBookRemovalService`, `IImportService`, `IPeriodicalService`) had interfaces.
This is Phase A of that epic - the prerequisite seam, EF-backed only. A future
`ProviderType == "nawishta"` branch in `LibraryQueryServiceFactory` (not yet written) is the only
case that would ever return a different implementation; every provider today (including S3/Google
Drive/OneDrive, whose *files* live remotely but whose metadata stays local) still resolves to the
same EF-backed services, since only a library's file storage differs today, not where its metadata
lives.

## Nawishta typed client (Nawishta epic #107)

`Maktaba.Nawishta` (new project, not yet referenced by anything - `Maktaba.Api`/`Maktaba.Data`
don't depend on it until #110 actually implements the query-service interfaces against it) holds a
generated C# client for the user's own Nawishta REST API (`C:\code\inshapardaz\api`), the eventual
second `ProviderType` mentioned above. No OpenAPI spec is checked into the Nawishta repo itself -
Swashbuckle only serves it live at `https://api.nawishta.co.uk/swagger/v1/swagger.json` (or
whatever instance URL) - so `Maktaba.Nawishta/nswag.json` (an NSwag document, pinned via
`backend/.config/dotnet-tools.json`'s `nswag.consolecore` local tool) generates
`NawishtaClient.Generated.cs` from that live URL and the **generated output is checked into git**,
not built on every compile - there's no live Nawishta instance in CI/most dev environments to
generate against, and regenerating on every build would make the build non-reproducible offline.
Regenerate after any Nawishta API change with:

```
cd backend
dotnet tool restore
dotnet tool run nswag run Maktaba.Nawishta/nswag.json
```

`operationGenerationMode: MultipleClientsFromFirstTagAndOperationId` was picked over NSwag's default
`MultipleClientsFromOperationId` because Nawishta's own operationIds aren't `Controller_Method`-
prefixed (most are just a bare method name, several are missing entirely) - grouping by each
operation's Swagger tag instead is what actually produces one client class per controller
(`AccountsClient`, `BookClient`, `LibraryClient`, `SeriesClient`, `PeriodicalClient`, etc., 18 in
total) rather than dumping every operation into one giant `Client` class (what the default mode
fell back to against this particular spec). `jsonLibrary: SystemTextJson` matches
`Maktaba.Api`'s own (implicit, unconfigured) JSON stack rather than pulling in Newtonsoft. Each
generated `*Client` takes a `baseUrl` string and a shared `HttpClient` via constructor injection
(`injectHttpClient: true`) - deliberately left unwired to any DI/auth here, since attaching the
JWT bearer token (from the same `safeStorage`-backed credential store cloud providers already use,
per the design addendum on issue #69) and building an actual `INawishtaApiClient` facade over these
18 generated classes is #108/#110's job, not this one. Nawishta's swagger document declares no
`securitySchemes` at all (auth is bearer-token-via-header but undocumented in the spec itself), so
there was nothing for NSwag to generate an auth-handling constructor overload from either way.

`Maktaba.Nawishta/NawishtaProviderOptions.cs` (issue #109) rounds out the registry schema side:
`NawishtaProviderOptions`/`NawishtaCredential` mirror `S3ProviderOptions`/`GoogleDriveProviderOptions`/
`OneDriveProviderOptions`'s own "non-secret `ProviderConfig` dict + secret credential JSON" split
(`Maktaba.Cloud`) - kept in `Maktaba.Nawishta` instead since a Nawishta library isn't an
`IStorageProvider` (it replaces both metadata and file storage, not just where files sit - see the
design addendum on issue #69). `ProviderConfig`'s `serverUrl`/`remoteLibraryId` keys and the
credential JSON's `accessToken`/`refreshToken`/`expiresAt` shape are defined now so #108 (actual
login) has somewhere concrete to write into - `LibraryRegistryEntry`'s own `ProviderType`/
`ProviderConfig`/`CredentialRef` fields already supported an opaque `"nawishta"` entry generically
from Phase 1 (Cloud storage) onward, so no registry/config.json schema change was needed, only this
typed wrapper around it.

**Nawishta auth (#108)** - `Maktaba.Nawishta/NawishtaAuthService.cs`'s `INawishtaAuthService`
(`AddHttpClient<INawishtaAuthService, NawishtaAuthService>()`-registered, like
`IMetadataLookupService` - one pooled `HttpClient` reused across logins against whatever server URL
the user types in, since the generated `*Client` classes each take `baseUrl` explicitly rather than
relying on the `HttpClient`'s own fixed `BaseAddress`) has two methods: `LoginAsync` (calls
`/Accounts/authenticate`, then - already bearer-authenticated with the token it just got back -
`GET /libraries` for the account's library list in the same round trip, so the frontend's connect
form can go straight from "email/password" to a picker) and `RefreshAsync` (`/Accounts/refresh-token`,
unauthenticated by design). `Maktaba.Api/Endpoints/NawishtaEndpoints.cs` exposes these as
`POST /api/nawishta/login`/`/refresh` - deliberately **not** under `/api/libraries` and deliberately
not touching `ICloudCredentialCache`/the registry at all, unlike `LibraryEndpoints.cs`'s `POST
/cloud` (the S3/Google Drive/OneDrive "connect" endpoint) - registering and actually opening a
Nawishta-backed library needs a working `IBookQueryService`/etc. implementation against it (#110),
which doesn't exist yet, so these two endpoints only get the frontend as far as "authenticated,
here's your library list."

**Read/write/shadow-table/cache-reuse implementation (#110-#113)** - `Maktaba.Nawishta`'s
`Nawishta{Book,Browse,Collection,Periodical}QueryService` implement Phase A's four interfaces
against Nawishta, and `NawishtaBookMutationService` (metadata edit/reading-status/rating/
collections/delete, called directly from `BookEndpoints.cs`'s PUT/PATCH/DELETE handlers rather than
registered as `IBookEditService`/`IBookRemovalService` - see that class's own doc comment for why)
covers the write side except file/content management. `NawishtaShadowDbContext`
(`%AppData%/Maktaba/NawishtaShadow/{libraryId}.db`) holds ReadingStatus/Rating/reading-progress/
Collections - the one thing Nawishta has no equivalent concept for. `NawishtaStorageProvider` is a
real `IStorageProvider` backed by `ICloudCacheManager` (not a second cache mechanism) - this is what
lets the *existing* cover/file-serving endpoints work for a Nawishta library without being
individually rewritten, since they already go through `IStorageProviderFactory.Current`.

**A key finding: Nawishta's live swagger response schemas and its own "download" link are both
unreliable** - `NawishtaRawApiClient` (see its own doc comment) works around the missing response
schemas by deserializing into the request-side model classes NSwag *did* generate. Separately,
confirmed live against a real account: `GET .../books/{bookId}/contents/{contentId}` returns a
`BookContentView`-shaped JSON description (not file bytes) whose own `download` link is what should
serve them - `DownloadContentAsync` follows that link, but the link itself currently 404s for
*every* content tested (4 different books' content, across two separate live sessions - traced to
`FileController.GetLibraryFile`/`GetFileQuery`/`FileRepository.GetFileById` returning null/empty
`FilePath`; suspected but unconfirmed root cause is the per-request tenant-connection resolution
issue #42 already flags on that repo). Filed upstream rather than silently worked around:
[inshapardaz/api#50](https://github.com/inshapardaz/api/issues/50) (the download link) and
[inshapardaz/api#51](https://github.com/inshapardaz/api/issues/51) (the missing response schemas -
traced to most controller actions returning plain `Task<IActionResult>` with no
`[ProducesResponseType]`, unlike `AccountsController.Authenticate`'s own `ActionResult<T>` pattern,
which Swashbuckle *can* infer a schema from). `BookEndpoints.cs`'s `GET /{id}` degrades gracefully
(empty `AbsolutePath` for that one file, not a 500) rather than assuming download always works.

**Write-path field semantics confirmed against Nawishta's own reference editor**
(`C:\code\inshapardaz\library-editor`, the real React app real Nawishta users edit libraries with) -
`NawishtaBookMutationService.ResolveAuthorsAsync`/`ResolveSeriesAsync` do a find-or-create by name
(same pattern `Maktaba.Data/Services/EntityResolvers.cs` already uses locally), since a book's
`Authors`/`SeriesId` must reference *existing* ids - confirmed via `authorsSelect.jsx`/
`seriesSelect.jsx`, which pick from an existing list or explicitly `POST /authors`/`/series` first,
never resolve a bare name server-side on the book `PUT` itself. `Book.Tags` is left untouched on
edit (the reference client never edits it at all - absent from `bookForm.jsx` entirely).
`UploadContentAsync` sends `language` as a query parameter, not a multipart form field, matching
`books.api.js`'s `addBookContent`. The author/series resolution fix (not the upload fix - Nawishta's
own download bug above made a full round-trip not worth attempting) was live-verified: a no-op edit
correctly matched the existing author rather than creating a duplicate.

**Making a Nawishta library the *active* one needed real `LibraryService`/`CloudSyncLifecycleService`
changes** - the whole app treats `LibraryRootPath != null` as "a library is open" (this middleware,
the frontend's `hasLibrary` gate), but a Nawishta library has no filesystem path. Fixed by giving it
the same synthetic display path `BuildCloudDisplayPath` already produces for any non-s3 provider
(`"nawishta://{name}"`) and adding an early-return branch in **both** `ActivateAsync` (the normal
connect/switch path) **and** `LoadConfig`'s startup auto-open of the last-active library (a separate
code path that bypasses `ActivateAsync` entirely and was missed on the first pass - confirmed live:
"SQLite Error 14: unable to open database file" on the very first request after restart) - both skip
the pull/push/`EnsureCreatedAsync` sequence entirely (no metadata.db for Nawishta) while still
setting `_schemaVerified = true`, so every existing "is a library open" check keeps working
unmodified. `PushCurrentLibraryIfCloudAsync` and `CloudSyncLifecycleService`'s push/lock-refresh
loop both exclude `"nawishta"` too (`IStorageProviderFactory.Current` throws
`NotSupportedException` for any provider type `BuildProvider`'s switch doesn't recognize, by
design) - without these, switching away from or just idly having an active Nawishta library open
would have crashed on the next heartbeat tick. No new endpoint was needed for "connect a Nawishta
library" - `ILibraryService.OpenCloudLibraryAsync`'s own doc comment already named Nawishta as a
target provider from Phase 1 onward, and `POST /api/libraries/cloud` is already provider-agnostic.

**Frontend (#114/#115)**: `LibrariesSettings.tsx`'s `NawishtaConnectModal` follows the same
"Connect {Provider} library…" button pattern as S3/Google Drive/OneDrive, but is two steps instead
of one - login (server URL/email/password) replaces itself with a `Radio.Group` library picker built
from the login response's own list, since one Nawishta account can access several libraries; "Name"
defaults to the picked library's own name (still editable) once one is picked, rather than being
asked for up front. `ReconnectModal` gained a matching email/password branch (re-authenticating
rather than a silent token refresh - #116's job) for a Nawishta entry whose cached credential has
gone stale. Two things are deliberately guarded rather than built: the per-library "Resync" button
is hidden for a Nawishta entry (`LibraryRescanService.RescanAsync` assumes a local folder/
metadata.db, never adapted for Nawishta - clicking it risked an unhandled crash, not just "does
nothing"), and `POST /api/books/import` rejects up front with a clear message for a Nawishta-active
library (file/content management isn't implemented - see `NawishtaBookMutationService`'s own doc
comment) rather than letting `ImportService` fail confusingly partway through. A real "Sync now"
(re-pull book/author/series list) and content-management support are still open work, not built in
this pass.

**Book covers are eagerly cached, not lazy like content** - every "does this book have a cover"
check (`BookEndpoints.cs`'s `GET ""`/`{id}`/`recently-added`/`continue-reading`) goes through
`CoverLocator.Find`, a synchronous, disk-only check with no way to trigger a download itself.
Content files can stay lazy (`NawishtaStorageProvider.GetLocalPathAsync` downloads on first real
read, via the async `GET /{id}/cover`/`GET /{id}/file` endpoints) because nothing needs to know
*in advance* whether a file exists - but a cover's presence has to be known before that async path
is ever reached, or the frontend never even requests the image. `NawishtaBookQueryService.
EnsureCoverCachedAsync` (called after mapping every book in `ListAsync`/`GetByIdAsync`/
`ListRecentlyAddedAsync`/`ListContinueReadingAsync`) downloads and caches a book's cover
(`{bookId}/cover.jpg`, via a new `NawishtaRawApiClient.DownloadBookCoverAsync` that follows the
book's own `image` link the same way content follows its `download` link) up front, bounded by
whatever page size/limit was already requested - best-effort, a failed fetch just leaves that one
book without a cover rather than failing the whole list. **Confirmed live that book cover images
hit the exact same upstream bug as content downloads** ([inshapardaz/api#50](https://github.com/inshapardaz/api/issues/50)
- both go through `FileController.GetLibraryFile`), so this is currently correctly-implemented but
not yet visibly working until that's fixed server-side - `NawishtaStorageProvider.ExistsAsync`
also had to gain a real (not just disk-cache-based) check for the same reason, used by the async
`CoverLocator.FindAsync` path `GET /{id}/cover` itself goes through.

**The Nawishta server URL is never shown as a field** in `NawishtaConnectModal`/`ReconnectModal` -
fixed to `NAWISHTA_DEFAULT_SERVER_URL` (`https://api.nawishta.co.uk`) internally. Unlike S3/Google
Drive/OneDrive (third-party services with real self-hosted/alternate-endpoint use cases), Nawishta
is the one server Maktaba's own developer runs, so a URL field would only invite typos into a value
that's never meant to vary. Both forms show a short privacy note (`librariesSettings.
nawishtaPrivacyNote`) next to the email/password fields - true today: `nawishtaLogin` sends the
password straight through to Nawishta's own `/Accounts/authenticate` and only the resulting
`NawishtaCredential` (access/refresh tokens) is ever passed to `window.maktaba.saveCloudCredential`
for encrypted, on-device persistence - the raw email/password are never written anywhere.

**Access-token auto-refresh is proactive (expiry-tracked), not just reactive-on-401.** The first
pass here (live testing surfaced "authors/series aren't loading" - every read worked fine against a
*fresh* token, but Nawishta's 10-minute access token had nothing renewing it) only refreshed on a
401. That turned out to be insufficient: further live testing found **Nawishta silently returns
*partial*, not-erroring data for some endpoints once the token's gone stale, instead of a 401** -
so a session running past the 10-minute mark could keep "working" while quietly missing data, with
nothing to signal that's what happened. Fixed by tracking the token's own expiry and renewing ahead
of it, not waiting to be told it's stale:

- `NawishtaRawApiClient.SetAccessToken(accessToken, expiresAt?)` now records the expiry alongside
  the token itself (`_accessTokenExpiresAt`), fed from `NawishtaProviderOptions.
  AccessTokenExpiresAtUnixMs` at construction and from each renewal's own `NawishtaCredential.
  ExpiresAt` afterward.
- `EnsureFreshTokenAsync` (called at the start of *every* request-issuing method - `GetWithRefreshAsync`
  plus `PostJsonAsync`/`PutJsonAsync`/`DeleteBookAsync`/`UploadContentAsync`, not just GETs) renews
  30 seconds ahead of the tracked expiry (absorbs request latency/clock skew), guarded by a
  `SemaphoreSlim` so a burst of concurrent requests right at the expiry instant doesn't each redeem
  the same soon-to-be-stale refresh token. `GetWithRefreshAsync`'s old reactive 401-retry is kept as
  a fallback for whatever this doesn't predict (an early-revoked token, skew beyond 30s), but is
  expected to be the rare path now, not the common one.
- `RefreshAccessTokenAsync`'s delegate type changed from `Func<CancellationToken, Task<string>>` to
  `Func<CancellationToken, Task<NawishtaCredential>>` (via `NawishtaCredentialRefresher.Create`,
  shared by `NawishtaSessionResolver` and `StorageProviderFactory.BuildNawishtaProvider`) so the
  renewed *expiry* comes back too, not just the access token string - needed to keep
  `_accessTokenExpiresAt` itself accurate after each renewal, not only the very first one.
- This also closes the previously-documented POST/PUT gap ("a write made with a stale token still
  needs a manual reconnect") for the common case: since renewal now happens *before* a write's body
  is built and sent (not after a 401 the body can't be resent past), a write made once the token's
  passed its tracked expiry renews first rather than failing. A write attempted in the ~30s skew
  window right at expiry, or hitting an early/unexpected 401, can still fail without a resend -a
  narrower edge case than "every stale-token write," not a complete guarantee.

Live-verified via a temporary debug trace (removed before commit): connected with a credential whose
tracked `expiresAt` was already in the past but whose real access/refresh tokens were still valid,
confirmed `EnsureFreshTokenAsync`'s renew branch fired exactly once *before* `GET /api/authors` was
ever sent to Nawishta - proving the proactive path itself, not just that the refresh mechanism
works at all (already covered by the earlier 401-triggered test).

**Nawishta's "Sync now" button is hidden**, not just "Resync" (see above) - `LibrariesSettings.tsx`
originally only excluded `"local"` from `entry.isActive && entry.providerType !== "local"`, so every
cloud provider including Nawishta got a sync-now button that meant nothing for it (no metadata.db to
push - `NawishtaStorageProvider.PushDatabaseAsync` is a no-op). Now excludes `"nawishta"` explicitly.

**Provider icon**: `providerIcons.tsx`'s `PROVIDER_ICONS.nawishta` is `IconWorldSearch` (a globe),
not the generic `IconCloud` every other provider badge uses - Nawishta is a remote, server-hosted
library catalog reached over the web, not raw cloud file storage the way S3/OneDrive/Google Drive
are, so it reads better with a visually distinct icon.

**Connecting a second library from the same Nawishta account skips the login form.** One Nawishta
account can own several libraries (design addendum on issue #69), and re-typing the password for
each one would be pointless - `NawishtaConnectModal` now takes an `existingLibraryId` prop
(`LibrariesSettings.tsx` passes the id of any already-registered `"nawishta"` entry, or `null`) and,
on open, tries reusing that library's already-cached credential before ever showing the email/
password fields: `window.maktaba.getCloudCredential(existingLibraryId)` (the same decrypt-on-demand
IPC path `App.tsx`'s startup reconnect and `ReconnectModal` already use) → a new
`POST /api/nawishta/libraries` endpoint (`INawishtaAuthService.ListLibrariesAsync`, factored out of
`LoginAsync`'s own library-listing call) lists the account's libraries with that access token → if
the access token has gone stale (10-minute TTL - the common case, since this is by definition a
second connect happening sometime *after* the first), falls back to `POST /api/nawishta/refresh`
(the existing renew endpoint, now also exposed to the frontend as `nawishtaRefresh` in `api.ts`)
before retrying the list call once. Any failure in this chain (revoked account, offline, a refresh
token that's also expired) silently falls back to the normal email/password form rather than
surfacing an error for something the user never directly asked for - `reusingCredential` state just
shows a brief "Reusing your existing Nawishta sign-in…" message while this runs. The picked
library's `remoteLibraryId` still goes through the exact same `connectCloudLibrary`/
`saveCloudCredential` flow as a fresh login once "Connect" is clicked - only how `credential`/
`libraries` state gets populated differs.

**The library picker searches/paginates instead of dumping everything unfiltered.** The connect
form's picker step (both a fresh login and the credential-reuse flow above) used to fetch up to 200
libraries in one shot with no query/paging at all. `INawishtaAuthService.ListLibrariesAsync` now
takes `query`/`pageNumber`/`pageSize` and returns a `NawishtaLibraryPage` (mirrors Nawishta's own
`LibraryViewPageView` - `PageCount`/`CurrentPageIndex`/`TotalCount`), `POST /api/nawishta/libraries`
carries those through, and `NawishtaConnectModal` gained a search `TextInput` (debounced 300ms,
always resets to page 1) plus prev/next buttons once `pageCount > 1`. **Nawishta's own
`GET /libraries` silently ignores its `query` parameter server-side** (confirmed live: an account
with 7 libraries, `?query=پبلک` still returns all 7 - `LibraryController.GetLibraries` accepts
`query` but never threads it into `GetLibrariesQuery`, only into the pagination links' own echoed
`RouteArguments`) - filed as
[inshapardaz/api#52](https://github.com/inshapardaz/api/issues/52). The `query` param is still sent
(so this starts working for free once that's fixed upstream), but `NawishtaConnectModal` also
applies a client-side substring filter over whatever page the server actually returned - exact for
the common case (an account whose libraries fit on one page, like the one this was tested against),
but won't reach across pages for a very large account until the server-side fix lands.

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

The same `docs/` tree is also **published to GitHub Pages** (`.github/workflows/pages.yml`, runs
`npm run docs:build` then `actions/deploy-pages` on every `main` push touching `docs/**`) at
`https://inshapardaz.github.io/maktaba/` - `docs/.vitepress/config.ts`'s `base: "/maktaba/"` matches
that project-site path (needed for every generated asset/link to resolve correctly once actually
deployed there; doesn't affect the in-app Help window at all, which reads the same source `.md`
files directly rather than going through this build - see below). This is also where
`docs/privacy-policy.md`/`docs/terms-and-conditions.md` live - English-only (no `docs/ur/`
counterpart, and not part of `topics.cjs`'s help-topic list, just each locale's `themeConfig.nav`)
pages for `AboutSettings.tsx`'s Privacy Policy/Terms & Conditions links and cloud provider OAuth
consent screens (see the Google Cloud project walkthrough above) that need a stable public URL -
edit them directly (not the old repo-root copies, which were moved into `docs/` once this existed).

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