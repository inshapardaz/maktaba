export type ReaderOpenMode = "window" | "inline";
export type ReaderEngine = "internal" | "external";
export type AutoTagMode = "auto" | "ask";

const OPEN_MODE_KEY = "maktaba-reader-open-mode";
const ENGINE_KEY_PREFIX = "maktaba-reader-engine-";
const AUTO_TAG_MODE_KEY = "maktaba-auto-tag-mode";

export function getStoredReaderOpenMode(): ReaderOpenMode {
  if (typeof window === "undefined") {
    return "window";
  }
  return window.localStorage.getItem(OPEN_MODE_KEY) === "inline" ? "inline" : "window";
}

export function setStoredReaderOpenMode(mode: ReaderOpenMode): void {
  window.localStorage.setItem(OPEN_MODE_KEY, mode);
}

// One engine choice per format (rather than a single global toggle) - PDF has much more common,
// often preferred external viewers than EPUB does, so they're independently configurable.
export function getStoredReaderEngine(format: "Epub" | "Pdf"): ReaderEngine {
  if (typeof window === "undefined") {
    return "internal";
  }
  return window.localStorage.getItem(`${ENGINE_KEY_PREFIX}${format}`) === "external" ? "external" : "internal";
}

export function setStoredReaderEngine(format: "Epub" | "Pdf", engine: ReaderEngine): void {
  window.localStorage.setItem(`${ENGINE_KEY_PREFIX}${format}`, engine);
}

// Governs what happens when the reader notices a book has started being read (Unread -> Reading)
// or reached 100% (-> Finished): "auto" applies the status change silently (the default, matching
// the old unconditional behavior), "ask" instead shows a dismissible notification with an "Apply"
// action so the user decides per book - see ReaderOverlay.tsx's maybeAutoTagStatus.
export function getStoredAutoTagMode(): AutoTagMode {
  if (typeof window === "undefined") {
    return "auto";
  }
  return window.localStorage.getItem(AUTO_TAG_MODE_KEY) === "ask" ? "ask" : "auto";
}

export function setStoredAutoTagMode(mode: AutoTagMode): void {
  window.localStorage.setItem(AUTO_TAG_MODE_KEY, mode);
}
