namespace Maktaba.Core.Services;

/// <summary>
/// Nawishta epic, Phase A - resolves the four read-path query services for the currently active
/// library, mirroring <see cref="IStorageProviderFactory"/>'s own "one factory, resolved per active
/// library's ProviderType" shape rather than inventing a second pattern. Today every ProviderType
/// (including S3/Google Drive/OneDrive, whose *files* live remotely but whose metadata stays local -
/// see CLAUDE.md's "Cloud storage" section) resolves to the same EF-backed implementations, since
/// only a library's file storage differs today, not where its metadata lives. A future
/// <c>ProviderType == "nawishta"</c> branch (Phase B+ of this epic) is the only case that would ever
/// return a different implementation - registered scoped (like <see cref="IBookQueryService"/>'s own
/// EF implementation, which needs a fresh MaktabaDbContext per request), not singleton like
/// IStorageProviderFactory.
/// </summary>
public interface ILibraryQueryServiceFactory
{
    IBookQueryService Books { get; }

    IBrowseQueryService Browse { get; }

    ICollectionQueryService Collections { get; }

    IPeriodicalQueryService Periodicals { get; }
}
