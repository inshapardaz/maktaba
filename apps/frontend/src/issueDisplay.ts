import type { TranslationKey } from "./i18n/translations";

interface IssueLike {
  periodicalId: string | null;
  periodicalName: string | null;
  title: string;
  authors: string[];
  issueDate: string | null;
}

// An issue's own title/author aren't shown anywhere a book's normally would be - the periodical
// it belongs to and when it came out identify it far better than whatever title the original file
// happened to carry (see BookEditForm.tsx, which hides both fields once a book is an issue).
export function displayTitle(book: IssueLike): string {
  return book.periodicalId && book.periodicalName ? book.periodicalName : book.title;
}

export function displaySubtitle(
  book: IssueLike,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): string {
  if (book.periodicalId) {
    return formatIssueDateInfo(book.issueDate, t);
  }
  return book.authors.join(", ") || t("common.unknownAuthor");
}

// ISO 8601 week number (week 1 = the week containing the year's first Thursday) - computed via
// UTC dates throughout so a local timezone offset can never shift the result by one.
function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

// "2024 · January · Week 3" - replaces the author line for an issue, wherever a book's author
// list would otherwise show (BookGrid/BookList/BookDetailPanel/the reader).
export function formatIssueDateInfo(
  issueDate: string | null,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): string {
  if (!issueDate) {
    return "";
  }

  const d = new Date(issueDate);
  return t("issueInfo.dateLine", {
    year: d.getFullYear(),
    month: d.toLocaleDateString(undefined, { month: "long" }),
    week: isoWeekNumber(d),
  });
}
