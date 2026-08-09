using System.Text.Json;
using Maktaba.Core.Services;

namespace Maktaba.Data.Services;

public class LibraryService : ILibraryService, ILibraryPathProvider
{
    private const string DatabaseFileName = "metadata.db";

    private readonly string _configFilePath;

    public string? LibraryRootPath { get; private set; }

    public string? DatabasePath =>
        LibraryRootPath is null ? null : Path.Combine(LibraryRootPath, DatabaseFileName);

    public LibraryService()
    {
        var appDataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Maktaba");
        Directory.CreateDirectory(appDataDir);
        _configFilePath = Path.Combine(appDataDir, "config.json");

        TryLoadLastOpenedLibrary();
    }

    private void TryLoadLastOpenedLibrary()
    {
        if (!File.Exists(_configFilePath))
        {
            return;
        }

        try
        {
            var json = File.ReadAllText(_configFilePath);
            var config = JsonSerializer.Deserialize<AppConfig>(json);
            if (config?.LastLibraryPath is { Length: > 0 } path &&
                Directory.Exists(path) &&
                File.Exists(Path.Combine(path, DatabaseFileName)))
            {
                LibraryRootPath = path;
            }
        }
        catch (Exception ex) when (ex is IOException or JsonException)
        {
            // Corrupt or unreadable config: fall through with no library open;
            // the user will be prompted to open one again.
        }
    }

    public async Task<LibraryInfo> OpenAsync(string path, CancellationToken ct = default)
    {
        var fullPath = Path.GetFullPath(path);
        Directory.CreateDirectory(fullPath);

        LibraryRootPath = fullPath;

        using var db = MaktabaDbContextFactory.Create(this);
        await db.Database.EnsureCreatedAsync(ct);

        SaveLastOpenedLibrary(fullPath);

        return new LibraryInfo(fullPath);
    }

    private void SaveLastOpenedLibrary(string path)
    {
        var json = JsonSerializer.Serialize(new AppConfig(path));
        File.WriteAllText(_configFilePath, json);
    }

    private record AppConfig(string? LastLibraryPath);
}
