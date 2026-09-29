using Maktaba.Core.Entities;
using Maktaba.Core.Ids;
using Maktaba.Core.Naming;
using Maktaba.Core.Services;

namespace Maktaba.Api.Endpoints;

// Null IsRightToLeft auto-derives from the book's own Language (RtlLanguages.IsRtl) - the
// frontend's own confirm dialog already computes this and always sends an explicit value (see
// isRtlLanguage.ts), but a caller hitting this endpoint directly gets the same default.
public record StartDigitizationRequest(bool? IsRightToLeft);

// Phase 2 request bodies - all take the digitization.json page id ("p1", "p2", ...), never the
// internal DigitizationPage.Id, matching every other API boundary's "never expose the raw int"
// convention (see IdCodec's own doc comment) - a page's json id already is an opaque string, no
// sqid encoding needed for it.
public record ReorderPagesRequest(IReadOnlyList<string> PageIds);
public record BulkSetStatusRequest(IReadOnlyList<string> PageIds, string Status);
public record BulkSetChapterRequest(IReadOnlyList<string> PageIds, string? ChapterId);
public record DeletePagesRequest(IReadOnlyList<string> PageIds);

// Phase 3 request bodies.
public record RotatePageRequest(double Degrees);
public record CropPageRequest(double X, double Y, double Width, double Height);
public record SplitPageRequest(double SplitRatio);

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

        // Phase 2 (Page Management UI) - all four take/return the same DigitizationState shape as
        // GET ""/POST "/start" so the frontend can just replace its cached state with the response
        // rather than re-fetching. Every "not found"/validation failure below maps a thrown
        // exception to 400/404 rather than letting a 500 through, following this project's own
        // 404-vs-throw convention at the API boundary (see CLAUDE.md's "Backend conventions").
        group.MapPut("/pages/reorder", async (string id, ReorderPagesRequest request, IDigitizationService digitization, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            try
            {
                await digitization.ReorderPagesAsync(bookId, request.PageIds, ct);
                return Results.Ok(await digitization.GetStateAsync(bookId, ct));
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        group.MapPut("/pages/status", async (string id, BulkSetStatusRequest request, IDigitizationService digitization, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            if (!Enum.TryParse<PageEditStatus>(request.Status, out var status))
            {
                return Results.BadRequest(new { error = $"Unknown status '{request.Status}'." });
            }

            try
            {
                await digitization.BulkSetStatusAsync(bookId, request.PageIds, status, ct);
                return Results.Ok(await digitization.GetStateAsync(bookId, ct));
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        group.MapPut("/pages/chapter", async (string id, BulkSetChapterRequest request, IDigitizationService digitization, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            try
            {
                await digitization.BulkSetChapterAsync(bookId, request.PageIds, request.ChapterId, ct);
                return Results.Ok(await digitization.GetStateAsync(bookId, ct));
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        group.MapPost("/pages/delete", async (string id, DeletePagesRequest request, IDigitizationService digitization, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            try
            {
                await digitization.DeletePagesAsync(bookId, request.PageIds, ct);
                return Results.Ok(await digitization.GetStateAsync(bookId, ct));
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        // Phase 3 (Page Image Editing) - all three bake the transform into the page's own jpg and
        // return the (mostly unchanged, for rotate/crop) DigitizationState - see
        // DigitizationService's own doc comment on why these are destructive rather than
        // persisting a re-appliable transform. No cache-busting header/version is added here; the
        // frontend appends its own cache-busting query param after a successful edit (see
        // digitizationPageImageUrl's callers) since <img> tags cache aggressively by URL.
        group.MapPost("/pages/{pageId}/rotate", async (string id, string pageId, RotatePageRequest request, IDigitizationService digitization, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            try
            {
                await digitization.RotatePageAsync(bookId, pageId, request.Degrees, ct);
                return Results.Ok(await digitization.GetStateAsync(bookId, ct));
            }
            catch (KeyNotFoundException ex)
            {
                return Results.NotFound(new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        group.MapPost("/pages/{pageId}/crop", async (string id, string pageId, CropPageRequest request, IDigitizationService digitization, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            try
            {
                await digitization.CropPageAsync(bookId, pageId, request.X, request.Y, request.Width, request.Height, ct);
                return Results.Ok(await digitization.GetStateAsync(bookId, ct));
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (KeyNotFoundException ex)
            {
                return Results.NotFound(new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        group.MapPost("/pages/{pageId}/split", async (string id, string pageId, SplitPageRequest request, IDigitizationService digitization, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            try
            {
                var state = await digitization.SplitPageAsync(bookId, pageId, request.SplitRatio, ct);
                return Results.Ok(state);
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (KeyNotFoundException ex)
            {
                return Results.NotFound(new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        // Serves a page's own image bytes for the page grid/list thumbnails and the typing editor -
        // plain disk read; see the comment above the Phase 3 endpoints for why there's no
        // server-side cache-busting version here.
        group.MapGet("/pages/{pageId}/image", async (
            string id, string pageId, ILibraryService libraryService, ILibraryQueryServiceFactory queryServices,
            IDigitizationService digitization, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId) || libraryService.LibraryRootPath is not { } root)
            {
                return Results.NotFound();
            }

            var book = await queryServices.Books.GetByIdAsync(bookId, ct);
            var state = await digitization.GetStateAsync(bookId, ct);
            var page = state?.Pages.FirstOrDefault(p => p.Id == pageId);
            if (book is null || page is null)
            {
                return Results.NotFound();
            }

            var imagePath = Path.Combine(root, book.FolderPath, page.Image);
            return File.Exists(imagePath) ? Results.File(imagePath, "image/jpeg") : Results.NotFound();
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
