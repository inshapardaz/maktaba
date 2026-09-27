namespace Maktaba.Core.Services;

/// <summary>
/// Rebuilds every DigitizationPage/Chapter row (and each book's aggregate DigitizationStatus) from
/// digitization.json - its own pass, deliberately kept separate from ILibraryRescanService's book
/// list rescan (see the epic's "Hard requirement: zero impact on books that are never digitized"),
/// so a bug in this new pass can never jeopardize the existing book-list rescan. A book with no
/// digitization.json is left with no digitization rows and a null DigitizationStatus, untouched.
/// </summary>
public interface IDigitizationRescanService
{
    /// <summary>Rescans every book already present in the DB (this runs after
    /// ILibraryRescanService's own pass, which is what decides which books exist at all) whose
    /// folder contains a digitization.json. Returns the number of books whose digitization rows
    /// were rebuilt.</summary>
    Task<int> RescanAsync(CancellationToken ct = default);
}
