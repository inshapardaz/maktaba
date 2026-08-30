import type { Language } from "./i18n/translations";

// Formatting helpers for AnalyticsView's "reading time" report - kept separate from
// readingTime.ts (duration text shared with BookDetailPanel) since these are chart-label-only
// and specific to the day-of-week/hour/date buckets the backend returns.

function localeFor(language: Language): string {
  return language === "ur" ? "ur" : "en";
}

// dayOfWeek: 0=Sunday..6=Saturday, matching .NET's DayOfWeek and the backend's ByDayOfWeek DTO.
export function formatDayOfWeek(dayOfWeek: number, language: Language, style: "short" | "long" = "short"): string {
  // 2024-01-07 is a known Sunday, so adding dayOfWeek days lands on the matching weekday.
  const date = new Date(2024, 0, 7 + dayOfWeek);
  return new Intl.DateTimeFormat(localeFor(language), { weekday: style }).format(date);
}

export function formatHour(hour: number, language: Language): string {
  const date = new Date(2024, 0, 1, hour);
  return new Intl.DateTimeFormat(localeFor(language), { hour: "numeric" }).format(date);
}

export function formatShortDate(isoDate: string, language: Language): string {
  const date = new Date(`${isoDate}T00:00:00`);
  return new Intl.DateTimeFormat(localeFor(language), { month: "short", day: "numeric" }).format(date);
}

export function formatMonth(isoMonth: string, language: Language): string {
  const date = new Date(`${isoMonth}-01T00:00:00`);
  return new Intl.DateTimeFormat(localeFor(language), { month: "short", year: "numeric" }).format(date);
}
