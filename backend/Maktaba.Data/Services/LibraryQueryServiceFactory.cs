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
/// A near-expired Nawishta access token is proactively renewed by NawishtaRawApiClient itself
/// (EnsureFreshTokenAsync, tracked-expiry-based, called at the start of every request-issuing
/// method) before this factory's own resolved service ever makes a call - not something this class
/// needs to think about. What this class's resolution doesn't itself validate is whether the
/// *credential* still works at all (a revoked refresh token, an unreachable server) - that surfaces
/// as a thrown NawishtaApiException/HttpRequestException from whatever request first hits it, same
/// "credential went stale, frontend re-supplies it" shape S3/Google Drive/OneDrive already use via
/// ICloudCredentialCache. Issue #116 (Nawishta unreachable/token-expiry UX) gave the frontend a way
/// to catch that eagerly and word it clearly - see LibraryEndpoints.cs's GET /verify-connection.</summary>
public class LibraryQueryServiceFactory(MaktabaDbContext db, NawishtaSessionResolver nawishta) : ILibraryQueryServiceFactory
{
    public IBookQueryService Books =>
        nawishta.TryResolve(out var n)
            ? new NawishtaBookQueryService(n.Api, n.RemoteLibraryId, n.Shadow, n.CacheManager, n.LibraryId)
            : new EfBookQueryService(db);

    public IBrowseQueryService Browse =>
        nawishta.TryResolve(out var n) ? new NawishtaBrowseQueryService(n.Api, n.RemoteLibraryId, n.Shadow) : new EfBrowseQueryService(db);

    public ICollectionQueryService Collections =>
        nawishta.TryResolve(out var n) ? new NawishtaCollectionQueryService(n.Shadow) : new EfCollectionQueryService(db);

    public IPeriodicalQueryService Periodicals =>
        nawishta.TryResolve(out var n) ? new NawishtaPeriodicalQueryService() : new EfPeriodicalQueryService(db);
}
