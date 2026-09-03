export type SidebarSortKey = "bookCount" | "name";
export type SidebarSortDirection = "asc" | "desc";

export interface SidebarSort {
  key: SidebarSortKey;
  direction: SidebarSortDirection;
}

// Issue #59: remembers how the Authors sidebar section is sorted (by book count or
// alphabetically, ascending or descending) across restarts - same localStorage-backed pattern as
// readerSettings.ts/viewSettings.ts.
const AUTHOR_SORT_KEY = "maktaba-sidebar-author-sort-key";
const AUTHOR_SORT_DIRECTION_KEY = "maktaba-sidebar-author-sort-direction";

export function getStoredAuthorSort(): SidebarSort {
  if (typeof window === "undefined") {
    return { key: "bookCount", direction: "desc" };
  }
  const key = window.localStorage.getItem(AUTHOR_SORT_KEY) === "name" ? "name" : "bookCount";
  const direction = window.localStorage.getItem(AUTHOR_SORT_DIRECTION_KEY) === "asc" ? "asc" : "desc";
  return { key, direction };
}

export function setStoredAuthorSort(sort: SidebarSort): void {
  window.localStorage.setItem(AUTHOR_SORT_KEY, sort.key);
  window.localStorage.setItem(AUTHOR_SORT_DIRECTION_KEY, sort.direction);
}

// Issue #60: "single" (the original behavior) keeps exactly one sidebar section expanded at all
// times, filling the available height; "multiple" lets any number of sections be expanded (or
// none), each capped to a max height with its own scrollbar instead of stretching to fill. See
// Sidebar.tsx's expandedSections/toggleSection.
export type SidebarExpandMode = "single" | "multiple";

const EXPAND_MODE_KEY = "maktaba-sidebar-expand-mode";

export function getStoredExpandMode(): SidebarExpandMode {
  if (typeof window === "undefined") {
    return "single";
  }
  return window.localStorage.getItem(EXPAND_MODE_KEY) === "multiple" ? "multiple" : "single";
}

export function setStoredExpandMode(mode: SidebarExpandMode): void {
  window.localStorage.setItem(EXPAND_MODE_KEY, mode);
}
