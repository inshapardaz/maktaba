using Maktaba.Core.Entities;
using Maktaba.Nawishta.Generated;

namespace Maktaba.Nawishta;

/// <summary>
/// Maps Nawishta's generated {Entity}View DTOs to Maktaba.Core's own domain entities - the same
/// entities EfBookQueryService returns, so BookEndpoints.cs/BrowseEndpoints.cs/etc. don't need to
/// know or care whether a library is EF-backed or Nawishta-backed (see ILibraryQueryServiceFactory's
/// doc comment). Every mapped entity's Id is Nawishta's own int id, reused as-is (never a real EF
/// row, never SaveChanges-d) - safe because it's only ever read back through IdCodec.Encode the same
/// way a real EF-backed Book.Id is, and each Nawishta id is unique within its own entity's table on
/// Nawishta's side same as Maktaba's own auto-increment ints are.
/// </summary>
public static class NawishtaEntityMapper
{
    public static Book ToBook(BookView view, NawishtaBookState? state)
    {
        var book = new Book
        {
            Id = view.Id ?? 0,
            Title = view.Title,
            // Nawishta has no separate sort-title field - falls back to the title itself, same as
            // a book with no explicit sort title ever gets in the local-library import path.
            SortTitle = view.Title,
            Description = view.Description,
            Language = view.Language,
            Publisher = view.Publisher,
            DateAdded = view.DateAdded?.UtcDateTime ?? DateTime.UtcNow,
            Rating = state?.Rating ?? 0,
            ReadingStatus = state?.ReadingStatus ?? ReadingStatus.Unread,
            // A virtual "folder" - just this book's own id, matching NawishtaStorageProvider's
            // GetLocalPathAsync ("{bookId}/{contentId}{extension}" - see BookFile.FilePath below)
            // rather than a real on-disk path. CoverLocator.Find/GetVersion look for
            // {cacheRoot}/{FolderPath}/cover.* under this - always a safe "no cover" miss today
            // (Nawishta covers aren't cached locally yet), never a crash (File.Exists on a
            // non-existent folder just returns false).
            FolderPath = (view.Id ?? 0).ToString(),
        };

        var order = 0;
        foreach (var a in view.Authors ?? [])
        {
            if (a.Id is not { } authorId)
            {
                continue;
            }

            book.BookAuthors.Add(new BookAuthor
            {
                Book = book,
                BookId = book.Id,
                AuthorId = authorId,
                Author = new Author { Id = authorId, Name = a.Name ?? "", SortName = a.Name ?? "" },
                Order = order++,
            });
        }

        foreach (var t in view.Tags ?? [])
        {
            if (t.Id is not { } tagId)
            {
                continue;
            }

            book.BookTags.Add(new BookTag
            {
                Book = book,
                BookId = book.Id,
                TagId = tagId,
                Tag = new Tag { Id = tagId, Name = t.Name ?? "" },
            });
        }

        if (view.SeriesId is { } seriesId)
        {
            book.BookSeries.Add(new BookSeries
            {
                Book = book,
                BookId = book.Id,
                SeriesId = seriesId,
                Series = new Series { Id = seriesId, Name = view.SeriesName ?? "" },
                SeriesIndex = view.SeriesIndex ?? 0,
            });
        }

        foreach (var content in view.Contents ?? [])
        {
            if (content.Id is not { } contentId || GuessFormat(content.MimeType, content.FileName) is not { } format)
            {
                continue;
            }

            var extension = format switch
            {
                BookFormat.Epub => ".epub",
                BookFormat.Pdf => ".pdf",
                BookFormat.Docx => ".docx",
                BookFormat.Txt => ".txt",
                _ => "",
            };

            book.Files.Add(new BookFile
            {
                // BookContentView.Id is a long (Nawishta's content ids aren't scoped per-book the
                // way Maktaba's own BookFile ids are) - truncated to int since BookFile.Id is an
                // int everywhere else in this app; content ids are for a single book's handful of
                // language variants, nowhere near int range in practice.
                Id = (int)contentId,
                Book = book,
                BookId = book.Id,
                Format = format,
                // NawishtaStorageProvider.GetLocalPathAsync's own doc comment explains this scheme -
                // {bookId}/{contentId}{extension}, downloaded and cached on first read.
                FilePath = $"{book.Id}/{contentId}{extension}",
                FileSizeBytes = 0,
                // Issue #144 - see BookContentView.Checksum's own doc comment (NawishtaGeneratedExtensions.cs)
                // for why this field exists at all despite not being in Nawishta's own swagger spec.
                ContentHash = content.Checksum ?? string.Empty,
            });
        }

        return book;
    }

    public static Author ToAuthor(AuthorView view) => new()
    {
        Id = view.Id ?? 0,
        Name = view.Name ?? "",
        SortName = view.Name ?? "",
    };

    public static Series ToSeries(SeriesView view) => new()
    {
        Id = view.Id ?? 0,
        Name = view.Name ?? "",
    };

    /// <summary>Nawishta's content mime types are OCR/publishing-pipeline oriented (see the epic's
    /// #111/#113 doc comments in CLAUDE.md) - only the mime types that map cleanly onto a format
    /// Maktaba's own reader (qari) actually opens are recognized; anything else (page images, raw
    /// OCR text, ...) is skipped rather than guessed at.</summary>
    public static BookFormat? GuessFormat(string? mimeType, string? fileName)
    {
        if (mimeType is not null)
        {
            if (mimeType.Contains("epub", StringComparison.OrdinalIgnoreCase))
            {
                return BookFormat.Epub;
            }

            if (mimeType.Contains("pdf", StringComparison.OrdinalIgnoreCase))
            {
                return BookFormat.Pdf;
            }
        }

        var ext = fileName is null ? null : Path.GetExtension(fileName).TrimStart('.').ToLowerInvariant();
        return ext switch
        {
            "epub" => BookFormat.Epub,
            "pdf" => BookFormat.Pdf,
            "docx" => BookFormat.Docx,
            "txt" => BookFormat.Txt,
            _ => null,
        };
    }

    public static string MimeTypeFor(BookFormat format) => format switch
    {
        BookFormat.Epub => "application/epub+zip",
        BookFormat.Pdf => "application/pdf",
        BookFormat.Docx => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        BookFormat.Txt => "text/plain",
        _ => "application/octet-stream",
    };
}
