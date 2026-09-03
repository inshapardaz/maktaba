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
