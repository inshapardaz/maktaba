import type { ReadableFormat } from "./api";

export type ConvertFormat = "none" | ReadableFormat;

const STORAGE_KEY = "maktaba-default-convert-format";
const CONVERT_FORMATS: readonly ReadableFormat[] = ["Epub", "Pdf", "Docx", "Txt"];

export function getStoredDefaultFormat(): ConvertFormat {
  if (typeof window === "undefined") {
    return "none";
  }
  const value = window.localStorage.getItem(STORAGE_KEY);
  return (CONVERT_FORMATS as readonly string[]).includes(value ?? "") ? (value as ReadableFormat) : "none";
}
