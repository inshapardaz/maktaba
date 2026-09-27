namespace Maktaba.Core.Naming;

/// <summary>
/// Epic #162's own decision: a book's page order when digitizing is auto-derived from
/// Book.Language, with a manual override offered at digitization start (see
/// DigitizeConfirmDialog.tsx's own frontend copy of this same lookup, isRtlLanguage.ts - kept as
/// two small lookups rather than one shared source since the frontend has no dependency on this
/// backend project; codes match languageOptions.ts's LANGUAGE_CODES ISO 639-1 values).
/// </summary>
public static class RtlLanguages
{
    private static readonly HashSet<string> Codes = new(StringComparer.OrdinalIgnoreCase) { "ur", "ar", "fa" };

    public static bool IsRtl(string? languageCode) =>
        !string.IsNullOrWhiteSpace(languageCode) && Codes.Contains(languageCode.Trim());
}
