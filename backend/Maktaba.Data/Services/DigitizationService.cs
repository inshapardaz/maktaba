using Maktaba.Core.Entities;
using Maktaba.Core.Naming;
using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;
using SkiaSharp;

namespace Maktaba.Data.Services;

public class DigitizationService(
    MaktabaDbContext db,
    ILibraryService libraryService,
    IDigitizationJsonStore jsonStore) : IDigitizationService
{
    private async Task<(Book Book, string AbsoluteFolder)> LoadBookAsync(int bookId, CancellationToken ct)
    {
        var root = libraryService.LibraryRootPath ?? throw new LibraryNotOpenException();
        var book = await db.Books.Include(b => b.Files).FirstOrDefaultAsync(b => b.Id == bookId, ct)
            ?? throw new KeyNotFoundException($"Book {bookId} not found.");
        return (book, Path.Combine(root, book.FolderPath));
    }

    public async Task<DigitizationState> StartAsync(int bookId, bool isRightToLeft, CancellationToken ct = default)
    {
        var (book, absoluteFolder) = await LoadBookAsync(bookId, ct);

        // Idempotent re-start: an already-digitized book's existing digitization.json (and its own
        // IsRightToLeft, possibly already corrected by the user) is returned untouched rather than
        // reset - see this method's own doc comment.
        var existing = await jsonStore.ReadAsync(absoluteFolder, ct);
        if (existing is not null)
        {
            return existing;
        }

        var sourcePdf = book.Files.FirstOrDefault(f => f.Format == BookFormat.Pdf)
            ?? throw new InvalidOperationException($"Book {bookId} has no PDF file to digitize.");

        var state = new DigitizationState(
            Version: DigitizationState.CurrentVersion,
            SourcePdf: Path.GetFileName(sourcePdf.FilePath),
            IsRightToLeft: isRightToLeft,
            Status: nameof(BookDigitizationStatus.Pending),
            Pages: [],
            Chapters: []);

        await jsonStore.WriteAsync(absoluteFolder, state, ct);

        book.DigitizationStatus = BookDigitizationStatus.Pending;
        await db.SaveChangesAsync(ct);

        return state;
    }

    public async Task<DigitizationState?> GetStateAsync(int bookId, CancellationToken ct = default)
    {
        var (_, absoluteFolder) = await LoadBookAsync(bookId, ct);
        return await jsonStore.ReadAsync(absoluteFolder, ct);
    }

    // Per the epic's own amendment ("page number is the filename, not a decoupled order field") -
    // Phase 0/1 already committed to this (DigitizationPaths.PageImagePath derives a page's path
    // from its number, and PdfToImageConversionService names files sequentially at conversion
    // time), so reordering/deleting pages here has to rename files to keep that invariant, not just
    // update an `order` column. (Issue #177's own body text suggested the opposite - "filenames are
    // stable/arbitrary and never renamed" - which would only be true if Phase 0/1 had stored a
    // decoupled order field instead; they didn't, so this follows the epic doc's explicit amendment
    // over that one issue's description. Flagged in the PR for a human to confirm.)
    public async Task ReorderPagesAsync(int bookId, IReadOnlyList<string> pageIdsInOrder, CancellationToken ct = default)
    {
        var (_, absoluteFolder) = await LoadBookAsync(bookId, ct);
        var state = await RequireStateAsync(absoluteFolder, ct);

        if (pageIdsInOrder.Count != state.Pages.Count || !pageIdsInOrder.ToHashSet().SetEquals(state.Pages.Select(p => p.Id)))
        {
            throw new ArgumentException("pageIdsInOrder must be a permutation of the book's existing page ids.", nameof(pageIdsInOrder));
        }

        var pagesById = state.Pages.ToDictionary(p => p.Id);
        var newOrder = pageIdsInOrder.Select(id => pagesById[id]).ToList();

        var renumbered = RenumberFiles(absoluteFolder, newOrder);
        await PersistPagesAsync(bookId, absoluteFolder, state, renumbered, ct);
    }

    public async Task BulkSetStatusAsync(int bookId, IReadOnlyList<string> pageIds, PageEditStatus status, CancellationToken ct = default)
    {
        var (_, absoluteFolder) = await LoadBookAsync(bookId, ct);
        var state = await RequireStateAsync(absoluteFolder, ct);
        var idSet = pageIds.ToHashSet();

        var updatedPages = state.Pages
            .Select(p => idSet.Contains(p.Id) ? p with { EditStatus = status.ToString() } : p)
            .ToList();

        await PersistPagesAsync(bookId, absoluteFolder, state, updatedPages, ct);
    }

    public async Task BulkSetChapterAsync(int bookId, IReadOnlyList<string> pageIds, string? chapterId, CancellationToken ct = default)
    {
        var (_, absoluteFolder) = await LoadBookAsync(bookId, ct);
        var state = await RequireStateAsync(absoluteFolder, ct);
        var idSet = pageIds.ToHashSet();

        if (chapterId is not null && !state.Chapters.Any(c => c.Id == chapterId))
        {
            throw new ArgumentException($"Chapter {chapterId} does not exist.", nameof(chapterId));
        }

        var updatedPages = state.Pages
            .Select(p => idSet.Contains(p.Id) ? p with { ChapterId = chapterId } : p)
            .ToList();

        await PersistPagesAsync(bookId, absoluteFolder, state, updatedPages, ct);
    }

    public async Task DeletePagesAsync(int bookId, IReadOnlyList<string> pageIds, CancellationToken ct = default)
    {
        var (_, absoluteFolder) = await LoadBookAsync(bookId, ct);
        var state = await RequireStateAsync(absoluteFolder, ct);
        var idSet = pageIds.ToHashSet();

        foreach (var page in state.Pages.Where(p => idSet.Contains(p.Id)))
        {
            DeleteFileIfExists(absoluteFolder, page.Image);
            if (page.Text is not null)
            {
                DeleteFileIfExists(absoluteFolder, page.Text);
            }
        }

        var remaining = state.Pages.Where(p => !idSet.Contains(p.Id)).ToList();
        var renumbered = RenumberFiles(absoluteFolder, remaining);
        await PersistPagesAsync(bookId, absoluteFolder, state, renumbered, ct);
    }

    private async Task<DigitizationState> RequireStateAsync(string absoluteFolder, CancellationToken ct) =>
        await jsonStore.ReadAsync(absoluteFolder, ct)
            ?? throw new InvalidOperationException("This book has no digitization.json - call StartAsync first.");

    private async Task PersistPagesAsync(
        int bookId, string absoluteFolder, DigitizationState state, List<DigitizationJsonPage> pages, CancellationToken ct)
    {
        await jsonStore.WriteAsync(absoluteFolder, state with { Pages = pages }, ct);

        // Rebuilds this book's DigitizationPage cache rows from the digitization.json just written -
        // reuses the same rescan pass a manual "Resync" would run (see DigitizationRescanService),
        // rather than duplicating the json-to-DB-row mapping logic here.
        var rescan = new DigitizationRescanService(db, libraryService, jsonStore);
        await rescan.RescanAsync(ct);
    }

    // Renumbers pages[] to 1..N in list order and renames each page's image/text files to match -
    // via a temp-name pass first so overlapping old/new numbers (e.g. swapping two pages) can never
    // collide mid-rename. Returns the pages with their Image/Text/Order fields updated to the new
    // numbering; callers still need to persist the result via PersistPagesAsync.
    private static List<DigitizationJsonPage> RenumberFiles(string absoluteFolder, List<DigitizationJsonPage> pagesInNewOrder)
    {
        var tempPaths = new Dictionary<string, (string? Image, string? Text)>();
        foreach (var page in pagesInNewOrder)
        {
            var tempImage = MoveToTemp(absoluteFolder, page.Image);
            var tempText = page.Text is not null ? MoveToTemp(absoluteFolder, page.Text) : null;
            tempPaths[page.Id] = (tempImage, tempText);
        }

        var result = new List<DigitizationJsonPage>(pagesInNewOrder.Count);
        for (var i = 0; i < pagesInNewOrder.Count; i++)
        {
            var page = pagesInNewOrder[i];
            var pageNumber = i + 1;
            var (tempImage, tempText) = tempPaths[page.Id];

            var finalImage = DigitizationPaths.PageImagePath(pageNumber);
            MoveFromTemp(absoluteFolder, tempImage, finalImage);

            string? finalText = null;
            if (tempText is not null)
            {
                finalText = DigitizationPaths.PageTextPath(pageNumber);
                MoveFromTemp(absoluteFolder, tempText, finalText);
            }

            result.Add(page with { Order = pageNumber, Image = finalImage, Text = finalText });
        }

        return result;
    }

    private static string? MoveToTemp(string absoluteFolder, string? relativePath)
    {
        if (relativePath is null)
        {
            return null;
        }

        var sourcePath = Path.Combine(absoluteFolder, relativePath);
        if (!File.Exists(sourcePath))
        {
            return null;
        }

        var tempRelative = Path.Combine(DigitizationPaths.PagesFolderName, $"__tmp_{Guid.NewGuid():N}{Path.GetExtension(relativePath)}");
        File.Move(sourcePath, Path.Combine(absoluteFolder, tempRelative));
        return tempRelative;
    }

    private static void MoveFromTemp(string absoluteFolder, string? tempRelative, string finalRelative)
    {
        if (tempRelative is null)
        {
            return;
        }

        File.Move(Path.Combine(absoluteFolder, tempRelative), Path.Combine(absoluteFolder, finalRelative), overwrite: true);
    }

    private static void DeleteFileIfExists(string absoluteFolder, string relativePath)
    {
        var path = Path.Combine(absoluteFolder, relativePath);
        if (File.Exists(path))
        {
            File.Delete(path);
        }
    }

    // Phase 3 (Page Image Editing) - not part of the epic's original interface list (it only named
    // StartAsync/GetStateAsync/ReorderPagesAsync/BulkSetStatusAsync/BulkSetChapterAsync/
    // DeletePagesAsync/SavePageTextAsync/RunOcrAsync); crop/rotate/re-split are added here as new
    // members rather than a separate interface, since they're still simple per-page operations on
    // this same service. All three are destructive - they bake the transform straight into the
    // page's own jpg and discard the parameters, rather than persisting a crop-rect/rotation to be
    // re-applied later (the epic's illustrative digitization.json shows a "crop": null field, but
    // nothing else in the shipped schema ever reads it back - keeping the applied result as the one
    // copy of truth avoids every later phase, Merge/Publish included, needing to know how to
    // re-apply a stored transform before using a page's image).
    public async Task RotatePageAsync(int bookId, string pageId, double degrees, CancellationToken ct = default)
    {
        var (_, absoluteFolder) = await LoadBookAsync(bookId, ct);
        var state = await RequireStateAsync(absoluteFolder, ct);
        var page = FindPage(state, pageId);

        var imagePath = Path.Combine(absoluteFolder, page.Image);
        using var source = SKBitmap.Decode(imagePath) ?? throw new InvalidOperationException($"Could not decode {page.Image}.");
        using var rotated = RotateBitmap(source, degrees);
        EncodeOverwrite(rotated, imagePath);

        var updatedPages = state.Pages.Select(p => p.Id == pageId ? p with { Rotation = (int)Math.Round(degrees) % 360 } : p).ToList();
        await PersistPagesAsync(bookId, absoluteFolder, state, updatedPages, ct);
    }

    // x/y/width/height are fractions (0..1) of the page's *current* image (after any prior
    // rotate/crop) - the frontend's crop tool computes these against whatever it's currently
    // displaying, so no separate "undo to original" state is needed here.
    public async Task CropPageAsync(int bookId, string pageId, double x, double y, double width, double height, CancellationToken ct = default)
    {
        if (width <= 0 || height <= 0)
        {
            throw new ArgumentException("width/height must be positive.");
        }

        var (_, absoluteFolder) = await LoadBookAsync(bookId, ct);
        var state = await RequireStateAsync(absoluteFolder, ct);
        var page = FindPage(state, pageId);

        var imagePath = Path.Combine(absoluteFolder, page.Image);
        using var source = SKBitmap.Decode(imagePath) ?? throw new InvalidOperationException($"Could not decode {page.Image}.");

        var rect = SKRectI.Create(
            (int)Math.Clamp(x * source.Width, 0, source.Width - 1),
            (int)Math.Clamp(y * source.Height, 0, source.Height - 1),
            Math.Max(1, (int)(width * source.Width)),
            Math.Max(1, (int)(height * source.Height)));
        rect.Intersect(new SKRectI(0, 0, source.Width, source.Height));

        using var cropped = new SKBitmap(rect.Width, rect.Height);
        source.ExtractSubset(cropped, rect);
        EncodeOverwrite(cropped, imagePath);

        // Cropping doesn't change page count/order/rotation - only the image bytes on disk change,
        // so digitization.json itself doesn't need updating, unlike rotate/split which touch a
        // field (Rotation) or the page list shape.
    }

    // Splits a single page's current image in two at splitRatio (0..1, the left portion's share of
    // the width) - covers the "auto-detect wrongly said this wasn't a spread" case from issue #180.
    // The reverse direction (two pages that were wrongly split apart need merging back into one
    // before re-splitting differently) is not implemented here - flagged as a follow-up, since it
    // needs a different UI affordance (picking two adjacent pages, not one) that didn't fit this
    // pass's time budget.
    public async Task<DigitizationState> SplitPageAsync(int bookId, string pageId, double splitRatio, CancellationToken ct = default)
    {
        if (splitRatio is <= 0 or >= 1)
        {
            throw new ArgumentException("splitRatio must be between 0 and 1 (exclusive).", nameof(splitRatio));
        }

        var (_, absoluteFolder) = await LoadBookAsync(bookId, ct);
        var state = await RequireStateAsync(absoluteFolder, ct);
        var orderedPages = state.Pages.OrderBy(p => p.Order).ToList();
        var targetIndex = orderedPages.FindIndex(p => p.Id == pageId);
        if (targetIndex < 0)
        {
            throw new KeyNotFoundException($"Page {pageId} not found.");
        }

        var target = orderedPages[targetIndex];
        var imagePath = Path.Combine(absoluteFolder, target.Image);
        using var source = SKBitmap.Decode(imagePath) ?? throw new InvalidOperationException($"Could not decode {target.Image}.");

        var leftWidth = Math.Max(1, (int)(source.Width * splitRatio));
        using var left = new SKBitmap(leftWidth, source.Height);
        source.ExtractSubset(left, new SKRectI(0, 0, leftWidth, source.Height));
        using var right = new SKBitmap(source.Width - leftWidth, source.Height);
        source.ExtractSubset(right, new SKRectI(leftWidth, 0, source.Width, source.Height));

        // Written to fresh temp files (not overwriting `target.Image` in place) so the existing
        // RenumberFiles pass below can uniformly move every page - old and newly-split alike -
        // from wherever its Image currently points to its final numbered name.
        var leftTemp = WriteTempImage(absoluteFolder, left);
        var rightTemp = WriteTempImage(absoluteFolder, right);

        var leftPage = target with { Image = leftTemp, SourceSpreadSide = "left" };
        // The new right-half page gets a fresh id and no text - the original page's own typed text
        // (if any) stays with the left half rather than being duplicated or guessed at how to split.
        var rightPage = new DigitizationJsonPage(
            Id: $"p{Guid.NewGuid():N}",
            Order: 0, // renumbered below
            Image: rightTemp,
            Text: null,
            EditStatus: nameof(PageEditStatus.Pending),
            ChapterId: target.ChapterId,
            SourcePdfPage: target.SourcePdfPage,
            SourceSpreadSide: "right",
            Rotation: 0);

        var newOrder = orderedPages.ToList();
        newOrder[targetIndex] = leftPage;
        newOrder.Insert(targetIndex + 1, rightPage);

        var renumbered = RenumberFiles(absoluteFolder, newOrder);
        await PersistPagesAsync(bookId, absoluteFolder, state, renumbered, ct);
        return state with { Pages = renumbered };
    }

    private static DigitizationJsonPage FindPage(DigitizationState state, string pageId) =>
        state.Pages.FirstOrDefault(p => p.Id == pageId)
            ?? throw new KeyNotFoundException($"Page {pageId} not found.");

    private static SKBitmap RotateBitmap(SKBitmap source, double degrees)
    {
        var radians = Math.PI * degrees / 180.0;
        var sin = Math.Abs(Math.Sin(radians));
        var cos = Math.Abs(Math.Cos(radians));
        var newWidth = Math.Max(1, (int)Math.Round(source.Width * cos + source.Height * sin));
        var newHeight = Math.Max(1, (int)Math.Round(source.Width * sin + source.Height * cos));

        var rotated = new SKBitmap(newWidth, newHeight);
        using var canvas = new SKCanvas(rotated);
        canvas.Clear(SKColors.White);
        canvas.Translate(newWidth / 2f, newHeight / 2f);
        canvas.RotateDegrees((float)degrees);
        canvas.Translate(-source.Width / 2f, -source.Height / 2f);
        canvas.DrawBitmap(source, 0, 0, new SKSamplingOptions(SKFilterMode.Linear), null);
        return rotated;
    }

    private static void EncodeOverwrite(SKBitmap bitmap, string path)
    {
        using var encoded = bitmap.Encode(SKEncodedImageFormat.Jpeg, quality: 85);
        File.WriteAllBytes(path, encoded.ToArray());
    }

    private static string WriteTempImage(string absoluteFolder, SKBitmap bitmap)
    {
        var tempRelative = Path.Combine(DigitizationPaths.PagesFolderName, $"__tmp_{Guid.NewGuid():N}.jpg");
        EncodeOverwrite(bitmap, Path.Combine(absoluteFolder, tempRelative));
        return tempRelative;
    }

    // Phase 5 (Typing Editor) - writes the page's own Markdown text file (creating one at its
    // number-derived path if this is the first time the page has any text at all - see the epic's
    // "page number is the filename" amendment) and updates its cached Text column via the usual
    // rescan pass, same as every other page mutation in this class.
    public async Task SavePageTextAsync(int bookId, string pageId, string text, CancellationToken ct = default)
    {
        var (_, absoluteFolder) = await LoadBookAsync(bookId, ct);
        var state = await RequireStateAsync(absoluteFolder, ct);
        var page = FindPage(state, pageId);

        var textRelative = page.Text ?? DigitizationPaths.PageTextPath(page.Order);
        await File.WriteAllTextAsync(Path.Combine(absoluteFolder, textRelative), text, ct);

        var updatedPages = state.Pages.Select(p => p.Id == pageId ? p with { Text = textRelative } : p).ToList();
        await PersistPagesAsync(bookId, absoluteFolder, state, updatedPages, ct);
    }

    // Phase 6.
    public Task<string> RunOcrAsync(int bookId, string pageId, CancellationToken ct = default) =>
        throw new NotImplementedException("Implemented in Phase 6 (OCR via Google Vision).");
}
