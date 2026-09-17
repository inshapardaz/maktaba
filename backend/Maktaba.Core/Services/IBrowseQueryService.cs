using Maktaba.Core.Entities;

namespace Maktaba.Core.Services;

/// <summary>A named group with a book count - the read-model shared by every browse-sidebar list
/// (authors/series/tags/collections) that's backed by a real entity with its own int id. ParentId
/// is only ever non-null for a Collection (see Collection.ParentCollectionId) - every other
/// producer (authors/series/tags) leaves it at its null default, since none of those have a
/// nesting concept.</summary>
public record EntityGroupCount(int Id, string Name, int Count, int? ParentId = null);

/// <summary>Same shape as <see cref="EntityGroupCount"/> but for a plain string column (Publisher,
/// Language) with no entity/table of its own - the name doubles as its own "id".</summary>
public record NamedGroupCount(string Name, int Count);

/// <summary>
/// Nawishta epic, Phase A (see CLAUDE.md's "Cloud storage"/spike notes) - extracted from
/// BrowseEndpoints.cs's previously-inline EF queries so a future Nawishta-backed implementation has
/// a seam to plug into. <see cref="Maktaba.Data.Services.EfBrowseQueryService"/> is today's only
/// implementation, and is a literal move of that endpoint's existing logic - no behavior change.
/// </summary>
public interface IBrowseQueryService
{
    Task<IReadOnlyList<EntityGroupCount>> ListAuthorsAsync(CancellationToken ct = default);

    /// <summary>Books with no author row at all (see BrowseEndpoints.cs's "unknown" sentinel group
    /// and BookEndpoints.cs's authorId="unknown" filter) - not an EntityGroupCount since it has no
    /// backing Author row/id.</summary>
    Task<int> CountBooksWithoutAuthorAsync(CancellationToken ct = default);

    Task<IReadOnlyList<EntityGroupCount>> ListSeriesAsync(CancellationToken ct = default);

    Task<IReadOnlyList<EntityGroupCount>> ListTagsAsync(CancellationToken ct = default);

    Task<IReadOnlyList<string>> ListPublishersAsync(CancellationToken ct = default);

    Task<IReadOnlyList<NamedGroupCount>> ListPublishersGroupedAsync(CancellationToken ct = default);

    Task<IReadOnlyList<NamedGroupCount>> ListLanguagesGroupedAsync(CancellationToken ct = default);

    /// <summary>Raw counts only (no zero-filling for a status with no books) - the caller
    /// (BrowseEndpoints.cs) fills in every ReadingStatus enum value itself, since that's a
    /// presentation concern (always render a stable Unread/Reading/Finished list), not a query one.</summary>
    Task<IReadOnlyDictionary<ReadingStatus, int>> GetReadingStatusCountsAsync(CancellationToken ct = default);
}
