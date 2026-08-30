import type { TranslationKey } from "./i18n/translations";

// "2h 15m" / "45m" / "< 1m" - never a bare "0m", which would read as "no data" rather than "not
// tracked long enough yet to show minutes". Shared by AnalyticsView and BookDetailPanel (issue #23).
export function formatDuration(seconds: number, t: (key: TranslationKey, vars?: Record<string, string | number>) => string): string {
  if (seconds < 60) return t("analytics.lessThanMinute");
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? t("analytics.hoursMinutes", { hours, minutes }) : t("analytics.minutes", { minutes });
}
