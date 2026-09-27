using Maktaba.Core.Entities;
using Maktaba.Core.Naming;
using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using PDFtoImage;
using SkiaSharp;

namespace Maktaba.Data.Services;

/// <inheritdoc cref="IPdfToImageConversionService"/>
public class PdfToImageConversionService(
    ILibraryService libraryService,
    ILibraryPathProvider pathProvider,
    IDigitizationJsonStore jsonStore,
    IConversionProgressTracker progress,
    ILogger<PdfToImageConversionService> logger) : IPdfToImageConversionService
{
    // A spread's width-to-height ratio is noticeably wider than a single page's (a typical single
    // page is well under 1:1; a two-page spread is close to 2:1) - 1.25 comfortably separates the
    // two without being so aggressive that a wide single-page scan gets mistaken for a spread.
    private const double SpreadAspectRatioThreshold = 1.25;
    private const int RenderWidth = 1600;

    private readonly object gate = new();
    private bool isRunning;

    public void Start(int bookId)
    {
        lock (gate)
        {
            if (isRunning)
            {
                throw new InvalidOperationException("A digitization conversion is already in progress.");
            }

            isRunning = true;
        }

        _ = Task.Run(() => RunAsync(bookId));
    }

    private async Task RunAsync(int bookId)
    {
        try
        {
            await ConvertAsync(bookId, CancellationToken.None);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "PDF-to-image conversion failed for book {BookId}", bookId);
            progress.Fail(ex.Message);
        }
        finally
        {
            lock (gate)
            {
                isRunning = false;
            }
        }
    }

    private async Task ConvertAsync(int bookId, CancellationToken ct)
    {
        var root = libraryService.LibraryRootPath ?? throw new LibraryNotOpenException();

        using var db = MaktabaDbContextFactory.Create(pathProvider);
        var book = await db.Books.Include(b => b.Files).FirstOrDefaultAsync(b => b.Id == bookId, ct)
            ?? throw new KeyNotFoundException($"Book {bookId} not found.");

        var absoluteFolder = Path.Combine(root, book.FolderPath);
        var state = await jsonStore.ReadAsync(absoluteFolder, ct)
            ?? throw new InvalidOperationException($"Book {bookId} has no digitization.json - call StartAsync first.");

        var pdfFile = book.Files.FirstOrDefault(f => f.Format == BookFormat.Pdf)
            ?? throw new InvalidOperationException($"Book {bookId} has no PDF file to convert.");
        var pdfPath = Path.Combine(root, pdfFile.FilePath);
        var pdfBytes = await File.ReadAllBytesAsync(pdfPath, ct);

        var pageCount = GetPageCount(pdfBytes);
        progress.Start(book.Id.ToString(), pageCount);

        var pagesDir = Path.Combine(absoluteFolder, DigitizationPaths.PagesFolderName);
        Directory.CreateDirectory(pagesDir);

        var newPages = new List<DigitizationJsonPage>();
        var pageNumber = 0;

        for (var sourcePage = 0; sourcePage < pageCount; sourcePage++)
        {
            ct.ThrowIfCancellationRequested();

            using var rendered = Conversion.ToImage(
                pdfBytes, sourcePage, password: null, options: new RenderOptions(Width: RenderWidth, WithAspectRatio: true));

            var isSpread = rendered.Width > rendered.Height * SpreadAspectRatioThreshold;
            if (!isSpread)
            {
                pageNumber++;
                newPages.Add(SavePage(absoluteFolder, pageNumber, rendered, sourcePage + 1, spreadSide: null));
            }
            else
            {
                using var left = CropHalf(rendered, leftHalf: true);
                using var right = CropHalf(rendered, leftHalf: false);

                // RTL: the physically right-hand page is read first. LTR: the left-hand page is.
                var (first, firstSide, second, secondSide) = state.IsRightToLeft
                    ? (right, "right", left, "left")
                    : (left, "left", right, "right");

                pageNumber++;
                newPages.Add(SavePage(absoluteFolder, pageNumber, first, sourcePage + 1, firstSide));
                pageNumber++;
                newPages.Add(SavePage(absoluteFolder, pageNumber, second, sourcePage + 1, secondSide));
            }

            progress.Report(sourcePage + 1);
        }

        var updatedState = state with { Pages = newPages };
        await jsonStore.WriteAsync(absoluteFolder, updatedState, ct);

        // Rebuilds this book's (and every other digitized book's) DigitizationPage rows from the
        // digitization.json just written - reuses the same rescan pass a manual "Resync" would run,
        // rather than duplicating the json-to-DB-row mapping logic here.
        var rescan = new DigitizationRescanService(db, libraryService, jsonStore);
        await rescan.RescanAsync(ct);

        progress.Complete();
    }

    private static int GetPageCount(byte[] pdfBytes)
    {
        using var document = UglyToad.PdfPig.PdfDocument.Open(pdfBytes);
        return document.NumberOfPages;
    }

    private static DigitizationJsonPage SavePage(string absoluteFolder, int pageNumber, SKBitmap bitmap, int sourcePdfPage, string? spreadSide)
    {
        var imageRelative = DigitizationPaths.PageImagePath(pageNumber);
        var imagePath = Path.Combine(absoluteFolder, imageRelative);
        using var encoded = bitmap.Encode(SKEncodedImageFormat.Jpeg, quality: 85);
        File.WriteAllBytes(imagePath, encoded.ToArray());

        return new DigitizationJsonPage(
            Id: $"p{pageNumber}",
            Order: pageNumber,
            Image: imageRelative,
            Text: null,
            EditStatus: nameof(PageEditStatus.Pending),
            ChapterId: null,
            SourcePdfPage: sourcePdfPage,
            SourceSpreadSide: spreadSide,
            Rotation: 0);
    }

    private static SKBitmap CropHalf(SKBitmap source, bool leftHalf)
    {
        var halfWidth = source.Width / 2;
        var rect = leftHalf
            ? new SKRectI(0, 0, halfWidth, source.Height)
            : new SKRectI(halfWidth, 0, source.Width, source.Height);

        var dest = new SKBitmap(rect.Width, rect.Height);
        source.ExtractSubset(dest, rect);
        return dest;
    }
}
