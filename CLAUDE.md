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
     information** are required; **Authorized domains** and the App home page/Privacy
     policy/Terms of service links should all be left **blank** - Maktaba has no public web
     presence, and Authorized domains would need Google Search Console domain-ownership
     verification that doesn't apply here anyway. Leaving these blank works fine at this scope.
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
*active* library to a new provider - `ILibraryMigrationService`/`LibraryMigrationService`
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