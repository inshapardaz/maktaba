namespace Maktaba.Api.Dtos;

public record BookSummaryDto(
    Guid Id,
    string Title,
    string SortTitle,
    string[] Authors,
    int Rating,
    DateTime DateAdded,
    bool HasCover
);

public record IdentifierDto(string Scheme, string Value);

public record BookFileDto(string Format, long FileSizeBytes, string AbsolutePath);

public record BookDetailDto(
    Guid Id,
    string Title,
    string SortTitle,
    string? Description,
    string? Language,
    string? Publisher,
    DateOnly? DatePublished,
    int Rating,
    DateTime DateAdded,
    string[] Authors,
    string? SeriesName,
    double? SeriesIndex,
    string[] Tags,
    IdentifierDto[] Identifiers,
    BookFileDto[] Files,
    bool HasCover
);

public record ImportBookRequest(string FilePath);

public record BookEditRequestDto(
    string Title,
    string[] Authors,
    string? Language,
    string? Publisher,
    DateOnly? PublishedDate,
    string? Description,
    int Rating,
    string? SeriesName,
    double? SeriesIndex,
    string[] Tags
);

public record OpenLibraryRequest(string Path);

public record LibraryDto(string Path);

public record BrowseGroupDto(Guid Id, string Name, int BookCount);
