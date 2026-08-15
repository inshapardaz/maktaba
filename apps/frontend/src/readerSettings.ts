export type ReaderOpenMode = "window" | "inline";
export type ReaderEngine = "internal" | "external";

const OPEN_MODE_KEY = "maktaba-reader-open-mode";
const ENGINE_KEY_PREFIX = "maktaba-reader-engine-";

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
