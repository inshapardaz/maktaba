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
            return Results.Ok(new LibraryDto(active.Path, active.Id, active.Name, active.PeriodicalsEnabled));
        });

        group.MapPost("/open", async (OpenLibraryRequest request, ILibraryService libraryService, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.Path))
            {
                return Results.BadRequest(new { error = "Path is required." });
            }

            await libraryService.OpenAsync(request.Path, ct);
            var active = libraryService.Libraries.First(l => l.Id == libraryService.CurrentLibraryId);
            return Results.Ok(new LibraryDto(active.Path, active.Id, active.Name, active.PeriodicalsEnabled));
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
                return Results.BadRequest(new { error = $"Could not connect to this library: {ex.Message}" });
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
                if (!string.IsNullOrWhiteSpace(request.ServiceUrl))
                {
                    config[Maktaba.Cloud.S3ProviderOptions.ServiceUrlKey] = request.ServiceUrl;
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
                return Results.BadRequest(new { error = ex.Message });
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
            var info = await libraryService.OpenLibraryByIdAsync(id, request?.Credential, ct);
            if (info is null)
            {
                return Results.NotFound();
            }

            var active = libraryService.Libraries.First(l => l.Id == libraryService.CurrentLibraryId);
            return Results.Ok(new LibraryDto(active.Path, active.Id, active.Name, active.PeriodicalsEnabled));
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
        // without orchestrating open-then-rescan itself.
        group.MapPost("/{id}/resync", async (string id, ILibraryService libraryService, ILibraryRescanService rescanService, CancellationToken ct) =>
        {
            if (libraryService.CurrentLibraryId != id)
            {
                var opened = await libraryService.OpenLibraryByIdAsync(id, credential: null, ct);
                if (opened is null)
                {
                    return Results.NotFound();
                }
            }

            var bookCount = await rescanService.RescanAsync(ct);
            return Results.Ok(new { bookCount });
        });
    }
}
