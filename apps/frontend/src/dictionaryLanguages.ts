// qari issue #17: languages offered when configuring a StarDict/GoldenDict word-lookup dictionary
// in Settings -> Dictionaries. Deliberately its own small list (not shared with BookEditForm.tsx's
// language picker) - this one only needs to stay in sync with itself, and duplicating a short
// constant array here is simpler than coupling otherwise-unrelated features to the same module.
export const DICTIONARY_LANGUAGE_CODES = [
  "en", "ur", "ar", "fa", "hi", "bn", "fr", "es", "de", "it", "pt", "nl", "ru", "tr", "pl", "zh", "ja", "ko",
] as const;
