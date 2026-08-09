using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data;

/// <summary>
/// Builds a <see cref="MaktabaDbContext"/> against whichever library is currently open, read from
/// <see cref="ILibraryPathProvider"/> at the moment of creation. Registered as the factory behind a
/// scoped DI registration so each request picks up the current library.
/// </summary>
public static class MaktabaDbContextFactory
{
    public static MaktabaDbContext Create(ILibraryPathProvider pathProvider)
    {
        var dbPath = pathProvider.DatabasePath
            ?? throw new LibraryNotOpenException();

        var options = new DbContextOptionsBuilder<MaktabaDbContext>()
            .UseSqlite($"Data Source={dbPath}")
            .Options;

        return new MaktabaDbContext(options);
    }
}
