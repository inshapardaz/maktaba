export type ConvertFormat = "none" | "Epub" | "Pdf";

const STORAGE_KEY = "maktaba-default-convert-format";

export function getStoredDefaultFormat(): ConvertFormat {
  if (typeof window === "undefined") {
    return "none";
  }
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === "Epub" || value === "Pdf" ? value : "none";
}

export function setStoredDefaultFormat(value: ConvertFormat): void {
  window.localStorage.setItem(STORAGE_KEY, value);
}
