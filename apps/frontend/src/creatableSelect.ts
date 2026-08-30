import type { TranslationKey } from "./i18n/translations";

// Mantine's Select/MultiSelect have no built-in "create a new option" support (removed after v6) -
// this is the standard replacement: the dropdown's own `data` always includes every existing name
// plus whatever's currently selected (so already-chosen custom values keep resolving to a label
// even once they scroll out of the current search text), and a synthetic "+ Create "X"" entry is
// appended only while the typed search doesn't already match something. Selecting that entry just
// selects its `value`, which is the typed text itself - no separate "was this newly created" case
// to handle on save, since find-or-create happens server-side (EntityResolvers) exactly as it
// already does for the free-text fields this replaces.
//
// Note this still requires an explicit selection (click, or Enter on the highlighted option) to
// commit typed text - a MultiSelect's own onBlur handler is a safety net for "typed a new value and
// moved on without explicitly selecting the create entry" (see BookEditForm.tsx/PeriodicalDetailView.tsx).
export function buildCreatableData(
  existing: string[],
  selected: string[],
  search: string,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): { value: string; label: string }[] {
  const names = [...new Set([...existing, ...selected])].sort((a, b) => a.localeCompare(b));
  const options = names.map((name) => ({ value: name, label: name }));

  const trimmed = search.trim();
  if (trimmed.length > 0 && !names.some((name) => name.toLowerCase() === trimmed.toLowerCase())) {
    options.push({ value: trimmed, label: t("bookEdit.createOption", { name: trimmed }) });
  }

  return options;
}
