export type SidebarSortKey = "bookCount" | "name";
export type SidebarSortDirection = "asc" | "desc";

export interface SidebarSort {
  key: SidebarSortKey;
  direction: SidebarSortDirection;
}

// Issue #59 (extended to every sortable section, not just Authors): remembers how each of these
// sidebar sections is sorted (by book count or alphabetically, ascending or descending) across
// restarts - same localStorage-backed pattern as readerSettings.ts/viewSettings.ts. Periodicals/
// Languages aren't included - the former already sorts oldest-issue-first semantics elsewhere and
// the latter wasn't asked for.
export type SortableSidebarSection = "authors" | "collections" | "series" | "tags" | "publishers";

function sortKeyStorageKey(section: SortableSidebarSection): string {
  return `maktaba-sidebar-${section}-sort-key`;
}

function sortDirectionStorageKey(section: SortableSidebarSection): string {
  return `maktaba-sidebar-${section}-sort-direction`;
}

export function getStoredSectionSort(section: SortableSidebarSection): SidebarSort {
  if (typeof window === "undefined") {
    return { key: "bookCount", direction: "desc" };
  }
  const key = window.localStorage.getItem(sortKeyStorageKey(section)) === "name" ? "name" : "bookCount";
  const direction = window.localStorage.getItem(sortDirectionStorageKey(section)) === "asc" ? "asc" : "desc";
  return { key, direction };
}

export function setStoredSectionSort(section: SortableSidebarSection, sort: SidebarSort): void {
  window.localStorage.setItem(sortKeyStorageKey(section), sort.key);
  window.localStorage.setItem(sortDirectionStorageKey(section), sort.direction);
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
