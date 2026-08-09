using Maktaba.Core.Entities;

namespace Maktaba.Core.Services;

public interface IImportService
{
    /// <summary>
    /// Imports the ebook file at <paramref name="sourceFilePath"/> into the currently open library:
    /// extracts metadata/cover, copies the file into the library's folder layout, and persists the
    /// resulting Book/Author/BookFile records. The original source file is left untouched.
    /// </summary>
    /// <exception cref="DuplicateBookDetectedException">
    /// Thrown when <paramref name="resolution"/> is <see cref="ImportDuplicateResolution.Auto"/> and a
    /// likely-duplicate book is found (by content hash or matching title+author).
    /// </exception>
    Task<Book> ImportFileAsync(
        string sourceFilePath,
        ImportDuplicateResolution resolution = ImportDuplicateResolution.Auto,
        CancellationToken ct = default);
}
