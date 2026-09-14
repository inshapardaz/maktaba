using Maktaba.Core.Entities;

namespace Maktaba.Core.Services;

/// <summary>Every filter/sort/page parameter GET /api/books accepts, decoded to plain values by the
/// endpoint (Sqids id strings -> ints, the "unknown" author sentinel -> a bool, enum strings ->
/// enum values) before reaching the query service - keeping id-encoding/parsing an
/// endpoint/presentation concern, not something every implementation of this interface repeats.</summary>
public record BookQueryFilters(
    string? Search = null,
    int? AuthorId = null,
    bool AuthorIsUnknown = false,
    int? SeriesId = null,
    int? TagId = null,
    int? CollectionId = null,
    int? PeriodicalId = null,
    bool IncludeIssues = false,
    string? Publisher = null,
    string? Language = null,
    ReadingStatus? ReadingStatus = null,
    int? MinRating = null,
    BookFormat? Format = null,
    string? SortKey = null,
    string? SortDirection = null,
    int? Page = null,
    int? PageSize = null);

/// <summary>LastReadByBookId is a second small lookup (ReadingProgress.UpdatedAt) rather than being
/// baked into Book itself, mirroring BookEndpoints.cs's original reasoning: most books never have a
/// progress row, and it's only needed for "lastRead" sorting/display, not every consumer of a
/// listed Book.</summary>
public record BookListResult(IReadOnlyList<Book> Books, int TotalCount, IReadOnlyDictionary<int, DateTime> LastReadByBookId);

/// <summary>One row of the Home view's "Continue Reading" feed - File is whichever format
/// BookEndpoints.cs's own "prefer Epub" rule picks, Percentage/UpdatedAt come from the book's
/// ReadingProgress row if it has one (0/DateAdded otherwise, same fallback the endpoint used).</summary>
public record ContinueReadingEntry(Book Book, BookFile? File, double Percentage, DateTime UpdatedAt);

/// <summary>
/// Nawishta epic, Phase A - extracted from BookEndpoints.cs's previously-inline EF queries (the
/// list/continue-reading/recently-added/get-by-id endpoints) so a future Nawishta-backed
/// implementation has a seam to plug into instead of assuming direct MaktabaDbContext access.
/// <see cref="Maktaba.Data.Services.EfBookQueryService"/> is today's only implementation, and is a
/// literal move of that endpoint's existing logic (same Includes, same filter chaining, same
/// materialize-then-sort-then-page shape) - no behavior change. Cover lookups, storage-path
/// resolution, and DTO construction all stay in the endpoint layer (they depend on
/// IStorageProviderFactory/CoverLocator, which live above/outside Maktaba.Core) - this interface
/// only answers "which books, in what order, how many", returning the same Book/BookFile domain
/// entities a future Nawishta implementation would map REST responses into.
/// </summary>
public interface IBookQueryService
{
    Task<BookListResult> ListAsync(BookQueryFilters filters, CancellationToken ct = default);

    Task<Book?> GetByIdAsync(int bookId, CancellationToken ct = default);

    Task<IReadOnlyList<ContinueReadingEntry>> ListContinueReadingAsync(int? limit, bool includeIssues, CancellationToken ct = default);

    Task<IReadOnlyList<Book>> ListRecentlyAddedAsync(int? limit, bool includeIssues, CancellationToken ct = default);

    /// <summary>Backs BookDetailDto's reading-time estimate (ReadingTimeEstimator.EstimateTotalSeconds) -
    /// SecondsRead from ReadingActivities, Percentage from the book's ReadingProgress row if any.</summary>
    Task<(int SecondsRead, double? Percentage)> GetReadingStatsAsync(int bookId, CancellationToken ct = default);
}
