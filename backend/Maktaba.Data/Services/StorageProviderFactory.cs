using Maktaba.Core.Services;

namespace Maktaba.Data.Services;

/// <summary>
/// Resolves the currently open library's <see cref="IStorageProvider"/>. For now every library is
/// local, so this always returns <see cref="LocalFileSystemProvider"/> - the extension point for
/// picking a provider by the library registry entry's provider type (once that field exists) is
/// phase 1's "Cloud Sync Core" work, not phase 0's.
/// </summary>
public class StorageProviderFactory(LocalFileSystemProvider local) : IStorageProviderFactory
{
    public IStorageProvider Current => local;
}
