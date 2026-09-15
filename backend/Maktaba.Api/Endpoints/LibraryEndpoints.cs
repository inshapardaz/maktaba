using Maktaba.Api.Dtos;
using Maktaba.Core.Services;

namespace Maktaba.Api.Endpoints;

public static class LibraryEndpoints
{
    public static void MapLibraryEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/libraries");

        group.MapGet("/current", (ILibraryService libraryService) =>
        {
            if (libraryService.LibraryRootPath is null)
            {
                return Results.NoContent();
            }

            var active = libraryService.Libraries.First(l => l.Id == libraryService.CurrentLibraryId);
            return Results.Ok(new LibraryDto(active.Path, active.Id, active.Name, active.PeriodicalsEnabled, active.ProviderType));
        });

        group.MapPost("/open", async (OpenLibraryRequest request, ILibraryService libraryService, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.Path))
            {
                return Results.BadRequest(new { error = "Path is required." });
            }

            await libraryService.OpenAsync(request.Path, ct);
            var active = libraryService.Libraries.First(l => l.Id == libraryService.CurrentLibraryId);
            return Results.Ok(new LibraryDto(active.Path, active.Id, active.Name, active.PeriodicalsEnabled, active.ProviderType));
        });

        // Registers and activates a brand-new cloud-backed library (S3 today; OneDrive/Google Drive/
        // Nawishta land the same way in later phases) - the counterpart to POST /open's "pick a local
        // folder" flow. The frontend decrypts the credential via window.maktaba.getCloudCredential
        // (or collects it fresh from the connect form) and sends it here once; this backend caches it
        // in memory only (see ICloudCredentialCache) and never writes it to config.json itself.
        group.MapPost("/cloud", async (ConnectCloudLibraryRequestDto request, ILibraryService libraryService, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.Name))
            {
                return Results.BadRequest(new { error = "Name is required." });
            }

            try
            {
                await libraryService.OpenCloudLibraryAsync(
                    request.Name.Trim(), request.ProviderType, request.ProviderConfig, request.Credential, ct);
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { error = $"Could not connect to this library: {DescribeS3Error(ex)}" });
            }

            var active = libraryService.Libraries.First(l => l.Id == libraryService.CurrentLibraryId);
            return Results.Ok(new LibraryEntryDto(active.Id, active.Name, active.Path, true, active.PeriodicalsEnabled, active.ProviderType));
        });

        // "Test connection" for the S3 connect form - verifies the bucket/region/credentials work
        // before the user commits to registering a library against them. Doesn't touch the library
        // registry or ICloudCredentialCache at all.
        group.MapPost("/test-s3-connection", async (TestS3ConnectionRequestDto request, CancellationToken ct) =>
        {
            try
            {
                var config = new Dictionary<string, string>
                {
                    [Maktaba.Cloud.S3ProviderOptions.BucketKey] = request.Bucket,
                    [Maktaba.Cloud.S3ProviderOptions.RegionKey] = request.Region,
                    [Maktaba.Cloud.S3ProviderOptions.PrefixKey] = request.Prefix,
                };
                if (!string.IsNullOrWhiteSpace(request.Endpoint))
                {
                    config[Maktaba.Cloud.S3ProviderOptions.EndpointKey] = request.Endpoint;
                }

                var options = Maktaba.Cloud.S3ProviderOptions.FromConfig(config, request.Credential);

                using var client = new Amazon.S3.AmazonS3Client(
                    options.AccessKeyId, options.SecretAccessKey, options.BuildClientConfig());
                await client.ListObjectsV2Async(new Amazon.S3.Model.ListObjectsV2Request
                {
                    BucketName = options.Bucket,
                    Prefix = options.Prefix,
                    MaxKeys = 1,
                }, ct);

                return Results.NoContent();
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { error = DescribeS3Error(ex) });
            }
        });

        // Polled by the frontend while a POST /{id}/resync below is still in flight (a separate HTTP
        // request, served concurrently by Kestrel on another thread) to render a progress bar.
        group.MapGet("/rescan/progress", (IRescanProgressTracker tracker) =>
        {
            var snapshot = tracker.Snapshot;
            return Results.Ok(new RescanProgressDto(snapshot.IsRunning, snapshot.Processed, snapshot.Total, snapshot.CurrentBook));
        });

        // Cloud Sync Core: polled by the frontend to show a "synced/syncing/error" indicator for a
        // cloud-backed library (see CloudSyncLifecycleService's periodic heartbeat) - always Idle
        // for a local library, since nothing ever reports sync activity for one.
        group.MapGet("/sync-status", (ISyncStatusTracker tracker) =>
        {
            var snapshot = tracker.Snapshot;
            return Results.Ok(new SyncStatusDto(snapshot.State.ToString(), snapshot.LastSyncedAtUtc, snapshot.ErrorMessage));
        });

        // Manual "Sync now" - pushes the local metadata.db to the current library's cloud provider
        // immediately rather than waiting for the next heartbeat. Harmless no-op for a local library
        // (PushDatabaseAsync does nothing); the frontend only needs to surface this action for a
        // cloud-backed one.
        group.MapPost("/sync-now", async (
            IStorageProviderFactory storageFactory, ISyncStatusTracker tracker, CancellationToken ct) =>
        {
            var storage = storageFactory.Current;
            try
            {
                tracker.Syncing();

                // Microsoft.Data.Sqlite pools native sqlite3 handles for reuse even after every
                // MaktabaDbContext/SqliteConnection using them has been disposed (each request gets
                // its own short-lived DbContext, but the pool keeps the underlying file handle open
                // behind the scenes) - on Windows that pooled handle's sharing mode can conflict
                // with the plain FileStream PushDatabaseAsync opens to read metadata.db, failing
                // with "the process cannot access the file because it is being used by another
                // process". Clearing every pool releases those handles first. Safe for a desktop
                // app that only ever has one library's connections open at a time - the next
                // request against this (or any other) library just repools a fresh connection.
                Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();

                await storage.PushDatabaseAsync(ct);
                tracker.Synced();
                return Results.NoContent();
            }
            catch (Exception ex)
            {
                tracker.Failed(ex.Message);
                return Results.Json(new { error = ex.Message }, statusCode: StatusCodes.Status502BadGateway);
            }
        });

        // Migration wizard (Cloud: Phase 3) - copies the active library to a new provider in the
        // background; the frontend polls /migrate/status the same way it polls /rescan/progress.
        // /migrate/preview backs the wizard's "Review" step - a plain listing, no downloads.
        group.MapGet("/migrate/preview", async (ILibraryMigrationService migrationService, CancellationToken ct) =>
        {
            var fileCount = await migrationService.CountSourceFilesAsync(ct);
            return Results.Ok(new { fileCount });
        });

        group.MapPost("/migrate/start", (StartMigrationRequestDto request, ILibraryMigrationService migrationService) =>
        {
            try
            {
                migrationService.Start(new MigrationTarget(request.ProviderType, request.ProviderConfig, request.Credential));
                return Results.NoContent();
            }
            catch (InvalidOperationException ex)
            {
                return Results.Conflict(new { error = ex.Message });
            }
        });

        group.MapGet("/migrate/status", (ILibraryMigrationService migrationService) =>
        {
            var snapshot = migrationService.Snapshot;
            return Results.Ok(new MigrationStatusDto(
                snapshot.State.ToString(), snapshot.Processed, snapshot.Total, snapshot.CurrentFile, snapshot.ErrorMessage));
        });

        group.MapPost("/migrate/cancel", (ILibraryMigrationService migrationService) =>
        {
            migrationService.Cancel();
            return Results.NoContent();
        });

        // The wizard's "Finish" step - only succeeds once /migrate/status reports "Verified".
        group.MapPost("/migrate/complete", async (
            CompleteMigrationRequestDto request, ILibraryMigrationService migrationService, CancellationToken ct) =>
        {
            var completed = await migrationService.CompleteAsync(request.DeleteSource, ct);
            return completed ? Results.NoContent() : Results.Conflict(new { error = "No verified migration is ready to complete." });
        });

        // Every library the user has ever opened - only one (IsActive) is the one every other
        // endpoint actually reads/writes through at a time; see docs/SPEC.md and LibraryService.
        group.MapGet("", (ILibraryService libraryService) =>
        {
            var entries = libraryService.Libraries
                .Select(l => new LibraryEntryDto(l.Id, l.Name, l.Path, l.Id == libraryService.CurrentLibraryId, l.PeriodicalsEnabled, l.ProviderType));
            return Results.Ok(entries);
        });

        group.MapPost("/{id}/open", async (
            string id, OpenLibraryCredentialRequestDto? request, ILibraryService libraryService, CancellationToken ct) =>
        {
            // Opening a cloud-backed library touches the network and the local filesystem cache
            // (see LibraryService.ActivateAsync/PullDatabaseAsync) - either can fail in ways this
            // endpoint has to turn into a clean, parseable error response rather than letting an
            // unhandled exception reach Kestrel's default handling, which the frontend's fetch()
            // call sees as a bare connection failure ("Failed to fetch") with no message to show -
            // exactly the case App.tsx's cloudReconnectQuery/recovery screen needs a real message
            // for. (This isn't needed for most endpoints, which don't do their own I/O beyond a
            // request-scoped EF query - opening a library is the unusual case that does.)
            try
            {
                var info = await libraryService.OpenLibraryByIdAsync(id, request?.Credential, ct);
                if (info is null)
                {
                    return Results.NotFound();
                }

                var active = libraryService.Libraries.First(l => l.Id == libraryService.CurrentLibraryId);
                return Results.Ok(new LibraryDto(active.Path, active.Id, active.Name, active.PeriodicalsEnabled, active.ProviderType));
            }
            catch (Exception ex)
            {
                return Results.Json(new { error = DescribeS3Error(ex) }, statusCode: StatusCodes.Status502BadGateway);
            }
        });

        group.MapPut("/{id}/name", async (string id, RenameLibraryRequestDto request, ILibraryService libraryService, CancellationToken ct) =>
        {
            var name = request.Name?.Trim();
            if (string.IsNullOrEmpty(name))
            {
                return Results.BadRequest(new { error = "Name is required." });
            }

            var entry = await libraryService.RenameAsync(id, name, ct);
            return entry is null
                ? Results.NotFound()
                : Results.Ok(new LibraryEntryDto(entry.Id, entry.Name, entry.Path, entry.Id == libraryService.CurrentLibraryId, entry.PeriodicalsEnabled, entry.ProviderType));
        });

        group.MapPut("/{id}/path", async (string id, RelocateLibraryRequestDto request, ILibraryService libraryService, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.Path))
            {
                return Results.BadRequest(new { error = "Path is required." });
            }

            var entry = await libraryService.RelocateAsync(id, request.Path, ct);
            return entry is null
                ? Results.NotFound()
                : Results.Ok(new LibraryEntryDto(entry.Id, entry.Name, entry.Path, entry.Id == libraryService.CurrentLibraryId, entry.PeriodicalsEnabled, entry.ProviderType));
        });

        group.MapPut("/{id}/periodicals-enabled", async (
            string id, SetPeriodicalsEnabledRequestDto request, ILibraryService libraryService, CancellationToken ct) =>
        {
            var entry = await libraryService.SetPeriodicalsEnabledAsync(id, request.Enabled, ct);
            return entry is null
                ? Results.NotFound()
                : Results.Ok(new LibraryEntryDto(entry.Id, entry.Name, entry.Path, entry.Id == libraryService.CurrentLibraryId, entry.PeriodicalsEnabled, entry.ProviderType));
        });

        group.MapDelete("/{id}", async (string id, ILibraryService libraryService, CancellationToken ct) =>
        {
            var removed = await libraryService.RemoveAsync(id, ct);
            return removed ? Results.NoContent() : Results.NotFound();
        });

        // Switches to the given library (if it isn't already active) and rescans it in one call, so
        // the frontend can trigger a resync on any registered library - not just the active one -
        // without orchestrating open-then-rescan itself. request/Credential is optional and only
        // matters for a not-yet-active cloud library whose credential hasn't been supplied this
        // session yet (see /{id}/open's identical optional Credential) - the frontend fetches its
        // saved one (window.maktaba.getCloudCredential) before calling this, same as it does before
        // a plain switch.
        group.MapPost("/{id}/resync", async (
            string id, OpenLibraryCredentialRequestDto? request, ILibraryService libraryService,
            ILibraryRescanService rescanService, CancellationToken ct) =>
        {
            if (libraryService.CurrentLibraryId != id)
            {
                var opened = await libraryService.OpenLibraryByIdAsync(id, request?.Credential, ct);
                if (opened is null)
                {
                    return Results.NotFound();
                }
            }

            var bookCount = await rescanService.RescanAsync(ct);
            return Results.Ok(new { bookCount });
        });
    }

    // AmazonS3Exception.Message alone is often just a bare "Access Denied"/"Forbidden" with no
    // indication of *why* - the ErrorCode/RequestId the AWS SDK actually gets back from the server
    // are separate properties it doesn't fold into Message. Surfacing them is the difference between
    // a user being able to tell "wrong region for this provider" apart from "wrong credentials"
    // apart from "bucket policy denies this" apart from "IAM policy is missing ListBucket on the
    // bucket ARN itself (only granted it on .../* for objects)" - all of which show up as the same
    // unhelpful "Access Denied" otherwise.
    private static string DescribeS3Error(Exception ex) => ex switch
    {
        Amazon.S3.AmazonS3Exception s3Ex => $"{s3Ex.Message} (S3 error code: {s3Ex.ErrorCode}, HTTP {(int)s3Ex.StatusCode}, request id: {s3Ex.RequestId})",
        Amazon.Runtime.AmazonServiceException svcEx => $"{svcEx.Message} (HTTP {(int)svcEx.StatusCode}, request id: {svcEx.RequestId})",
        // NawishtaApiException's own Message already embeds "Status: ...\nResponse: ..." (see its
        // generated definition) - just the HTTP status is a cleaner one-liner for this generic
        // "connect a cloud library" endpoint's error surface (same shape NawishtaEndpoints.cs's own
        // DescribeNawishtaError uses for the login-specific 401/403/404 cases).
        Maktaba.Nawishta.Generated.NawishtaApiException nawishtaEx => $"Nawishta server returned an error (HTTP {nawishtaEx.StatusCode}).",
        _ => ex.Message,
    };
}
