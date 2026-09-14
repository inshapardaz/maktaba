using Maktaba.Core.Services;

namespace Maktaba.Data.Services;

/// <summary>Scoped (per-request) implementation of <see cref="ILibraryQueryServiceFactory"/> - see
/// that interface's own doc comment for why this is scoped rather than singleton like
/// IStorageProviderFactory, and why every ProviderType resolves to the same EF-backed instances
/// today. Each property constructs its Ef*QueryService fresh per access rather than caching a
/// field - cheap (they're thin wrappers holding just the injected MaktabaDbContext), and avoids
/// paying for whichever of the four a given request never actually touches.</summary>
public class LibraryQueryServiceFactory(MaktabaDbContext db) : ILibraryQueryServiceFactory
{
    public IBookQueryService Books => new EfBookQueryService(db);

    public IBrowseQueryService Browse => new EfBrowseQueryService(db);

    public ICollectionQueryService Collections => new EfCollectionQueryService(db);

    public IPeriodicalQueryService Periodicals => new EfPeriodicalQueryService(db);
}
