import type { QueryClient } from "@tanstack/react-query";

const LIBRARY_QUERY_KEYS = [
  ["books"],
  ["authors"],
  ["series"],
  ["tags"],
  ["publishers"],
  ["publisherGroups"],
  ["languageGroups"],
  ["collections"],
  ["periodicals"],
  ["readingStatusCounts"],
  ["continueReading"],
  ["recentlyAdded"],
];

/** Invalidates every query whose data can change as a side effect of import/edit/remove/rescan. */
export function invalidateLibraryQueries(queryClient: QueryClient) {
  for (const queryKey of LIBRARY_QUERY_KEYS) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

// Issue #139 follow-up: a plain invalidate (above) leaves a query's *previous* data sitting in the
// cache while it refetches in the background - fine for "something changed, quietly catch up", but
// wrong right after switching to a *different* library (LibrarySwitchContext.tsx), where every one
// of these query keys is shared across every library rather than scoped per-library (see
// CLAUDE.md's "React Query key conventions" - deliberately so Sidebar/full-list views/LibrarySpotlight
// share one cache entry instead of duplicating requests). Without a real reset, the Sidebar/full-list
// views would briefly keep rendering the *old* library's authors/tags/etc as if they belonged to the
// new one, and - the bug this was actually written to fix - never show the new loading-indicator work
// at all, since `isLoading` only means "no data has ever been fetched", not "this data is stale".
// resetQueries clears cached data back to undefined and (for every still-mounted query) triggers a
// real refetch, so `isLoading` genuinely goes true again for the duration of that refetch.
export function resetLibraryQueries(queryClient: QueryClient) {
  for (const queryKey of LIBRARY_QUERY_KEYS) {
    void queryClient.resetQueries({ queryKey });
  }
}
