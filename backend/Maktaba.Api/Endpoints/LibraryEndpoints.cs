using Maktaba.Api.Dtos;
using Maktaba.Core.Services;

namespace Maktaba.Api.Endpoints;

public static class LibraryEndpoints
{
    public static void MapLibraryEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/libraries");

        group.MapGet("/current", (ILibraryService libraryService) =>
            libraryService.LibraryRootPath is { } path
                ? Results.Ok(new LibraryDto(path))
                : Results.NoContent());

        group.MapPost("/open", async (OpenLibraryRequest request, ILibraryService libraryService, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.Path))
            {
                return Results.BadRequest(new { error = "Path is required." });
            }

            var info = await libraryService.OpenAsync(request.Path, ct);
            return Results.Ok(new LibraryDto(info.Path));
        });

        // Polled by the frontend while a POST /{id}/resync below is still in flight (a separate HTTP
        // request, served concurrently by Kestrel on another thread) to render a progress bar.
        group.MapGet("/rescan/progress", (IRescanProgressTracker tracker) =>
        {
            var snapshot = tracker.Snapshot;
            return Results.Ok(new RescanProgressDto(snapshot.IsRunning, snapshot.Processed, snapshot.Total, snapshot.CurrentBook));
        });

        // Every library the user has ever opened - only one (IsActive) is the one every other
        // endpoint actually reads/writes through at a time; see docs/SPEC.md and LibraryService.
        group.MapGet("", (ILibraryService libraryService) =>
        {
            var entries = libraryService.Libraries
                .Select(l => new LibraryEntryDto(l.Id, l.Name, l.Path, l.Id == libraryService.CurrentLibraryId));
            return Results.Ok(entries);
        });

        group.MapPost("/{id}/open", async (string id, ILibraryService libraryService, CancellationToken ct) =>
        {
            var info = await libraryService.OpenLibraryByIdAsync(id, ct);
            return info is null ? Results.NotFound() : Results.Ok(new LibraryDto(info.Path));
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
                : Results.Ok(new LibraryEntryDto(entry.Id, entry.Name, entry.Path, entry.Id == libraryService.CurrentLibraryId));
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
                : Results.Ok(new LibraryEntryDto(entry.Id, entry.Name, entry.Path, entry.Id == libraryService.CurrentLibraryId));
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
                var opened = await libraryService.OpenLibraryByIdAsync(id, ct);
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
