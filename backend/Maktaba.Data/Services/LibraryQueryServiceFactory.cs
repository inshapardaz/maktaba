using Maktaba.Core.Services;
using Maktaba.Nawishta;

namespace Maktaba.Data.Services;

/// <summary>Scoped (per-request) implementation of <see cref="ILibraryQueryServiceFactory"/> - see
/// that interface's own doc comment for why this is scoped rather than singleton like
/// IStorageProviderFactory. Every ProviderType except "nawishta" still resolves to the EF-backed
/// implementations (each constructed fresh per property access - cheap, they're thin wrappers
/// holding just the injected MaktabaDbContext). A "nawishta" library resolves to the Nawishta-backed
/// implementations instead (issue #110), via <see cref="NawishtaSessionResolver"/> (shared with
/// BookEndpoints.cs's write-path handlers, so both see the same in-flight raw API client/shadow
/// DbContext within one request).
///
/// Doesn't proactively renew a near-expired Nawishta access token (its own TTL is a short 10
/// minutes) - a stale token instead surfaces as a 401 NawishtaApiException from whatever request
/// actually uses it, the same "credential went stale, frontend re-supplies it" pattern S3/Google
/// Drive/OneDrive already use via ICloudCredentialCache (see StorageProviderFactory.Current's own
/// "credentials haven't been supplied" exception) - issue #116 (Nawishta unreachable/token-expiry
/// UX) is expected to build the actual retry-with-refresh flow on top of that.</summary>
public class LibraryQueryServiceFactory(MaktabaDbContext db, NawishtaSessionResolver nawishta) : ILibraryQueryServiceFactory
{
    public IBookQueryService Books =>
        nawishta.TryResolve(out var n) ? new NawishtaBookQueryService(n.Api, n.RemoteLibraryId, n.Shadow) : new EfBookQueryService(db);

    public IBrowseQueryService Browse =>
        nawishta.TryResolve(out var n) ? new NawishtaBrowseQueryService(n.Api, n.RemoteLibraryId, n.Shadow) : new EfBrowseQueryService(db);

    public ICollectionQueryService Collections =>
        nawishta.TryResolve(out var n) ? new NawishtaCollectionQueryService(n.Shadow) : new EfCollectionQueryService(db);

    public IPeriodicalQueryService Periodicals =>
        nawishta.TryResolve(out var n) ? new NawishtaPeriodicalQueryService() : new EfPeriodicalQueryService(db);
}
