namespace Maktaba.Core.Services;

/// <summary>
/// Nawishta epic, Phase A - extracted from CollectionEndpoints.cs's previously-inline EF list query.
/// Collections are explicitly local/user-managed (see CollectionEndpoints.cs's own doc comment -
/// never derived from file metadata), so this - unlike Books/Browse/Periodicals - is expected to
/// stay backed by local storage even for a future Nawishta-backed library (part of the shadow-table
/// design from the epic's addendum), not something a Nawishta implementation would ever back with a
/// remote call. The interface still exists here for consistency with the other query services and
/// in case that assumption changes.
/// </summary>
public interface ICollectionQueryService
{
    Task<IReadOnlyList<EntityGroupCount>> ListAsync(CancellationToken ct = default);
}
