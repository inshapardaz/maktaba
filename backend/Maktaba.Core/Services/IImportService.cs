using Maktaba.Core.Entities;

namespace Maktaba.Core.Services;

public interface IImportService
{
    /// <summary>
    /// Imports the ebook file at <paramref name="sourceFilePath"/> into the currently open library:
    /// extracts metadata/cover, copies the file into the library's folder layout, and persists the
    /// resulting Book/Author/BookFile records. The original source file is left untouched.
    /// </summary>
    Task<Book> ImportFileAsync(string sourceFilePath, CancellationToken ct = default);
}
