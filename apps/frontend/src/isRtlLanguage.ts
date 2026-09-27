// Epic #162's own decision: RTL page order for a book being digitized is auto-derived from
// Book.Language (with a manual override offered when digitization starts), not user-picked from
// scratch every time - languageOptions.ts only drives UI display today, so this is the one small
// lookup that didn't exist yet. Codes match LANGUAGE_CODES's ISO 639-1 values.
const RTL_LANGUAGE_CODES = new Set(["ur", "ar", "fa"]);

export function isRtlLanguage(languageCode: string | null | undefined): boolean {
  if (!languageCode) {
    return false;
  }
  return RTL_LANGUAGE_CODES.has(languageCode.trim().toLowerCase());
}
