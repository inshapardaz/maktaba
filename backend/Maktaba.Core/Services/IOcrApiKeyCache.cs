namespace Maktaba.Core.Services;

/// <summary>
/// In-memory-only holder for the user's Google Vision API key (epic #162, Phase 6) - mirrors
/// ICloudCredentialCache's own role for cloud storage credentials: the key is encrypted at rest via
/// Electron's safeStorage (apps/desktop/src/native.ts's existing maktaba:*-cloud-credential IPC,
/// reused here under a fixed ref rather than adding new IPC) and the renderer decrypts it, but this
/// .NET process can't decrypt that blob itself - the renderer pushes the plaintext key here once per
/// session (on app startup if already configured, and again whenever Settings saves/removes it) so
/// every OCR call doesn't need the key repeated on every single request. Cleared on every process
/// restart, same as ICloudCredentialCache.
/// </summary>
public interface IOcrApiKeyCache
{
    string? ApiKey { get; set; }
}
