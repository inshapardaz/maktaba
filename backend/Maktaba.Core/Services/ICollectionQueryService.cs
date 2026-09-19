namespace Maktaba.Core.Services;

/// <summary>
/// Nawishta epic, Phase A - extracted from CollectionEndpoints.cs's previously-inline EF list query.
/// Collections are explicitly local/user-managed (see CollectionEndpoints.cs's own doc comment -
/// never derived from file metadata). For a local library this stays EF-backed as always; for a
/// Nawishta-backed library (issue #140) it's backed by Nawishta's own real Bookshelves API, not a
/// local-only shadow table - see NawishtaCollectionQueryService's own doc comment for what (nesting
/// only) still has to stay local, since Nawishta has no equivalent concept for it.
/// </summary>
public interface ICollectionQueryService
{
    Task<IReadOnlyList<EntityGroupCount>> ListAsync(CancellationToken ct = default);
}
