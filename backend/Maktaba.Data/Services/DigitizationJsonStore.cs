using System.Text.Json;
using Maktaba.Core.Services;

namespace Maktaba.Data.Services;

public class DigitizationJsonStore : IDigitizationJsonStore
{
    public async Task<DigitizationState?> ReadAsync(string absoluteBookFolderPath, CancellationToken ct = default)
    {
        var path = Path.Combine(absoluteBookFolderPath, IDigitizationJsonStore.FileName);
        if (!File.Exists(path))
        {
            return null;
        }

        try
        {
            var json = await File.ReadAllTextAsync(path, ct);
            return JsonSerializer.Deserialize<DigitizationState>(json);
        }
        catch (JsonException)
        {
            // A malformed digitization.json is treated as "not digitized" rather than failing the
            // caller outright - matches LibraryService's own LoadConfig, which does the same for a
            // corrupt config.json rather than blocking the whole app from starting.
            return null;
        }
    }

    public async Task WriteAsync(string absoluteBookFolderPath, DigitizationState state, CancellationToken ct = default)
    {
        Directory.CreateDirectory(absoluteBookFolderPath);
        var path = Path.Combine(absoluteBookFolderPath, IDigitizationJsonStore.FileName);
        var json = JsonSerializer.Serialize(state, new JsonSerializerOptions { WriteIndented = true });
        await File.WriteAllTextAsync(path, json, ct);
    }
}
