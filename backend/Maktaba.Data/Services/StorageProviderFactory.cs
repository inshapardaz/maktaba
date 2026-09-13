using Maktaba.Core.Services;

namespace Maktaba.Data.Services;

/// <summary>
/// Resolves the currently open library's <see cref="IStorageProvider"/> by its registry entry's
/// <see cref="LibraryRegistryEntry.ProviderType"/>. Only "local" is implemented so far (S3/
/// OneDrive/Google Drive/Nawishta land in later phases) - this is the one place a new provider
/// type gets wired in without any caller above this factory needing to change.
/// </summary>
public class StorageProviderFactory(ILibraryService libraryService, LocalFileSystemProvider local) : IStorageProviderFactory
{
    public IStorageProvider Current
    {
        get
        {
            var providerType = libraryService.Libraries
                .FirstOrDefault(l => l.Id == libraryService.CurrentLibraryId)?.ProviderType
                ?? "local";

            return providerType switch
            {
                "local" => local,
                _ => throw new NotSupportedException($"Storage provider \"{providerType}\" isn't implemented yet."),
            };
        }
    }
}
