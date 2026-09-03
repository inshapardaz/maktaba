import type { SortDirection, SortKey, ViewMode } from "./components/FilterBar";

// Issue #56: retains the library grid/list's sort field/direction and grid-vs-list choice across
// restarts, same localStorage-backed pattern as readerSettings.ts. Read once as App.tsx's initial
// state and written back on every change (see setStoredSortKey/etc. callers in App.tsx).
const SORT_KEY_KEY = "maktaba-view-sort-key";
const SORT_DIRECTION_KEY = "maktaba-view-sort-direction";
const VIEW_MODE_KEY = "maktaba-view-mode";

const VALID_SORT_KEYS: SortKey[] = ["title", "author", "dateAdded", "rating", "seriesIndex", "lastRead"];

export function getStoredSortKey(): SortKey {
  if (typeof window === "undefined") {
    return "title";
  }
  const stored = window.localStorage.getItem(SORT_KEY_KEY);
  return (VALID_SORT_KEYS as string[]).includes(stored ?? "") ? (stored as SortKey) : "title";
}

export function setStoredSortKey(key: SortKey): void {
  window.localStorage.setItem(SORT_KEY_KEY, key);
}

export function getStoredSortDirection(): SortDirection {
  if (typeof window === "undefined") {
    return "asc";
  }
  return window.localStorage.getItem(SORT_DIRECTION_KEY) === "desc" ? "desc" : "asc";
}

export function setStoredSortDirection(direction: SortDirection): void {
  window.localStorage.setItem(SORT_DIRECTION_KEY, direction);
}

export function getStoredViewMode(): ViewMode {
  if (typeof window === "undefined") {
    return "grid";
  }
  return window.localStorage.getItem(VIEW_MODE_KEY) === "list" ? "list" : "grid";
}

export function setStoredViewMode(mode: ViewMode): void {
  window.localStorage.setItem(VIEW_MODE_KEY, mode);
}
