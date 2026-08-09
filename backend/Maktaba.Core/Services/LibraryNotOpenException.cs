namespace Maktaba.Core.Services;

/// <summary>Thrown when an operation that requires an open library is attempted before one has been opened.</summary>
public class LibraryNotOpenException() : InvalidOperationException("No library is open.");
