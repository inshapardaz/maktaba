import type { TranslationKey } from "./i18n/translations";
import type { PeriodicalFrequency } from "./api";

interface IssueLike {
  periodicalId: string | null;
  periodicalName: string | null;
  periodicalFrequency: PeriodicalFrequency | null;
  title: string;
  authors: string[];
  issueDate: string | null;
}

// An issue's own title/author aren't shown anywhere a book's normally would be - when it came out
// identifies a specific issue far better than whatever title the original file happened to carry
// (see BookEditForm.tsx, which hides both fields once a book is an issue), so that's the headline;
// the periodical it belongs to moves to the subtitle line, same place the author list would go.
export function displayTitle(
  book: IssueLike,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): string {
  if (book.periodicalId) {
    return formatIssueDateInfo(book.issueDate, book.periodicalFrequency, t);
  }
  return book.title;
}

export function displaySubtitle(book: IssueLike, t: (key: TranslationKey, vars?: Record<string, string | number>) => string): string {
  if (book.periodicalId) {
    return book.periodicalName ?? "";
  }
  return book.authors.join(", ") || t("common.unknownAuthor");
}

// An issue's display date is shaped by how often its periodical comes out - a daily/weekly/
// fortnightly issue is identified by its exact date, but a monthly/quarterly/yearly one is
// identified by the coarser period it belongs to (e.g. "March 2024", not "March 14, 2024").
// Replaces the author line for an issue, wherever a book's author list would otherwise show
// (BookGrid/BookList/BookDetailPanel/the reader).
export function formatIssueDateInfo(
  issueDate: string | null,
  frequency: PeriodicalFrequency | null,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): string {
  if (!issueDate) {
    return "";
  }

  const d = new Date(issueDate);

  switch (frequency) {
    case "Yearly":
      return t("issueInfo.dateYear", { year: d.getFullYear() });
    case "Quarterly":
      return t("issueInfo.dateQuarter", { quarter: Math.floor(d.getMonth() / 3) + 1, year: d.getFullYear() });
    case "Monthly":
      return t("issueInfo.dateMonth", {
        month: d.toLocaleDateString(undefined, { month: "long" }),
        year: d.getFullYear(),
      });
    // Fortnightly (BiWeekly)/Weekly/Daily issues are identified by their exact date; Occasional
    // (no fixed cadence) falls back to the same exact-date format for lack of a better period.
    case "BiWeekly":
    case "Weekly":
    case "Daily":
    case "Occasional":
    default:
      return d.toLocaleDateString(undefined, { dateStyle: "long" });
  }
}
