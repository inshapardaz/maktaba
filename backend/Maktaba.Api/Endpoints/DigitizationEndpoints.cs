using Maktaba.Core.Entities;
using Maktaba.Core.Ids;
using Maktaba.Core.Naming;
using Maktaba.Core.Services;

namespace Maktaba.Api.Endpoints;

// Null IsRightToLeft auto-derives from the book's own Language (RtlLanguages.IsRtl) - the
// frontend's own confirm dialog already computes this and always sends an explicit value (see
// isRtlLanguage.ts), but a caller hitting this endpoint directly gets the same default.
public record StartDigitizationRequest(bool? IsRightToLeft);

// Phase 0 (epic #162) - just the "Digitize" entry point: start a book's digitization.json and read
// its current state back. Every other digitization action (page management, OCR, chapters,
// publishing, ...) is a later phase's own endpoint set, added to this same file as it lands.
public static class DigitizationEndpoints
{
    public static void MapDigitizationEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/books/{id}/digitize");

        group.MapGet("", async (
            string id, ILibraryQueryServiceFactory queryServices, IDigitizationService digitization, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId) || await queryServices.Books.GetByIdAsync(bookId, ct) is null)
            {
                return Results.NotFound();
            }

            var state = await digitization.GetStateAsync(bookId, ct);
            return state is null ? Results.NotFound() : Results.Ok(state);
        });

        group.MapPost("/start", async (
            string id, StartDigitizationRequest request, ILibraryService libraryService,
            ILibraryQueryServiceFactory queryServices, IDigitizationService digitization, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            // v1 is local-library-only (epic #162's non-goals) - the frontend already hides/disables
            // the "Digitize" action for a non-local library, this is the server-side backstop.
            var activeProvider = libraryService.Libraries.FirstOrDefault(l => l.Id == libraryService.CurrentLibraryId)?.ProviderType;
            if (activeProvider != "local")
            {
                return Results.BadRequest("Digitization is only supported for local libraries.");
            }

            var book = await queryServices.Books.GetByIdAsync(bookId, ct);
            if (book is null)
            {
                return Results.NotFound();
            }

            if (!book.Files.Any(f => f.Format == BookFormat.Pdf))
            {
                return Results.BadRequest("This book has no PDF file to digitize.");
            }

            var isRightToLeft = request.IsRightToLeft ?? RtlLanguages.IsRtl(book.Language);
            var state = await digitization.StartAsync(bookId, isRightToLeft, ct);
            return Results.Ok(state);
        });

        // Phase 1 - rasterizes the source PDF into pages/ (see PdfToImageConversionService). Runs
        // as a detached background task; the response returns as soon as it's queued, progress is
        // polled separately below (same "kick off, poll separately" shape as a library rescan).
        group.MapPost("/convert", async (string id, IDigitizationService digitization, IPdfToImageConversionService conversion, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            if (await digitization.GetStateAsync(bookId, ct) is null)
            {
                return Results.BadRequest("Call /digitize/start first.");
            }

            try
            {
                conversion.Start(bookId);
                return Results.NoContent();
            }
            catch (InvalidOperationException ex)
            {
                return Results.Conflict(new { error = ex.Message });
            }
        });

        // Not book-scoped (this process only ever runs one conversion at a time - see
        // PdfToImageConversionService.Start), so deliberately outside the /{id}/digitize group,
        // same reasoning as GET /api/libraries/rescan/progress living under the library-wide group
        // rather than needing a specific library id in its own path.
        app.MapGet("/api/digitize/convert/progress", (IConversionProgressTracker tracker) =>
        {
            var snapshot = tracker.Snapshot;
            return Results.Ok(new ConversionProgressDto(snapshot.IsRunning, snapshot.Processed, snapshot.Total, snapshot.BookId, snapshot.Error));
        });
    }
}

public record ConversionProgressDto(bool IsRunning, int Processed, int Total, string? BookId, string? Error);
