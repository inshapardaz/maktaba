using Maktaba.Core.Services;

namespace Maktaba.Data.Services;

/// <inheritdoc cref="ICloudCredentialCache"/>
public class CloudCredentialCache : ICloudCredentialCache
{
    private readonly Dictionary<string, string> _credentials = [];
    private readonly object _gate = new();

    public void Set(string libraryId, string credential)
    {
        lock (_gate)
        {
            _credentials[libraryId] = credential;
        }
    }

    public bool TryGet(string libraryId, out string credential)
    {
        lock (_gate)
        {
            return _credentials.TryGetValue(libraryId, out credential!);
        }
    }

    public void Clear(string libraryId)
    {
        lock (_gate)
        {
            _credentials.Remove(libraryId);
        }
    }
}
