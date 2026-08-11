import type { ReadingStatus } from "./api";
import type { TranslationKey } from "./i18n/translations";

// `undefined` for Reading lets Badge/SegmentedControl fall back to their own default (the
// theme's current primaryColor), so the "in progress" status always tracks whichever accent
// color the user has picked in Settings, rather than a color name baked in here.
export const READING_STATUS_COLOR: Record<ReadingStatus, string | undefined> = {
  Unread: "gray",
  Reading: undefined,
  Finished: "green",
};

export const READING_STATUS_LABEL_KEY: Record<ReadingStatus, TranslationKey> = {
  Unread: "readingStatus.unread",
  Reading: "readingStatus.reading",
  Finished: "readingStatus.finished",
};
