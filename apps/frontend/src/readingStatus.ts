import type { ReadingStatus } from "./api";
import type { TranslationKey } from "./i18n/translations";

export const READING_STATUS_COLOR: Record<ReadingStatus, string> = {
  Unread: "gray",
  Reading: "accent",
  Finished: "green",
};

export const READING_STATUS_LABEL_KEY: Record<ReadingStatus, TranslationKey> = {
  Unread: "readingStatus.unread",
  Reading: "readingStatus.reading",
  Finished: "readingStatus.finished",
};
