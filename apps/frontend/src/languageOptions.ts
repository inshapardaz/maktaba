import type { TranslationKey } from "./i18n/translations";

// Common library languages - stored as ISO 639-1 codes (matches what's typically already in EPUB/
// PDF metadata's dc:language, so an edit made here round-trips with a rescan instead of drifting
// into a different format). Not exhaustive - withCurrentLanguage below makes sure a book/periodical
// already tagged with a code outside this list still shows correctly instead of silently going blank.
// Shared by BookEditForm.tsx and PeriodicalDetailView.tsx.
export const LANGUAGE_CODES = ["en", "ur", "ar", "fa", "hi", "bn", "fr", "es", "de", "it", "pt", "nl", "ru", "tr", "pl", "zh", "ja", "ko"] as const;

// Labels follow the current UI language (translations.ts's "language.<code>" keys) rather than
// always English, so this needs to be computed with `t` at render time instead of a module-level
// constant.
export function getLanguageOptions(t: (key: TranslationKey) => string): { value: string; label: string }[] {
  return LANGUAGE_CODES.map((code) => ({ value: code, label: t(`language.${code}` as TranslationKey) }));
}

// Keeps a Select's current value visible/selected even when it falls outside the curated
// getLanguageOptions() list (e.g. a regional code like "en-US", or something extraction found that
// isn't in the list at all) - appended as a plain extra option (label = the raw code itself, since
// there's no display name to look up) rather than dropped, so editing an already-set field doesn't
// silently blank it out.
export function withCurrentLanguage(
  options: { value: string; label: string }[],
  current: string,
): { value: string; label: string }[] {
  const trimmed = current.trim();
  if (trimmed.length > 0 && !options.some((o) => o.value.toLowerCase() === trimmed.toLowerCase())) {
    return [...options, { value: trimmed, label: trimmed }];
  }
  return options;
}
