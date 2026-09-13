namespace Maktaba.Core.Services;

/// <summary>
/// Process-wide (singleton), in-memory-only cache of decrypted cloud provider credentials, keyed
/// by library id. Never persisted to disk by this backend - the actual encrypted-at-rest copy
/// lives in Electron's safeStorage-backed credential store (see the desktop app's native.ts),
/// decrypted there and handed to this backend over the local HTTP sidecar whenever a cloud library
/// is connected or reopened, since this .NET process has no way to decrypt an Electron safeStorage
/// blob itself. Cleared on process restart; the frontend re-supplies the credential when needed
/// (see LibrariesSettings.tsx and the library-open endpoints' optional credential field).
/// </summary>
public interface ICloudCredentialCache
{
    void Set(string libraryId, string credential);

    bool TryGet(string libraryId, out string credential);

    void Clear(string libraryId);
}
