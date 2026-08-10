using Maktaba.Core.Entities;

namespace Maktaba.Core.Services;

public enum BookConversionOutcome
{
    Converted,
    BookNotFound,
    AlreadyHasFormat,
    CalibreUnavailable,
}

public record BookConversionResult(BookConversionOutcome Outcome, BookFile? File = null);

/// <summary>
/// Converts one of a book's existing files to an additional format via Calibre (see
/// <see cref="ICalibreConverter"/>), registering the result as a new <see cref="BookFile"/> alongside
/// the original(s) - a book keeps every format it's ever had, it doesn't replace one with another.
/// </summary>
public interface IBookConversionService
{
    bool IsAvailable { get; }

    Task<BookConversionResult> ConvertAsync(int bookId, BookFormat targetFormat, CancellationToken ct = default);
}
