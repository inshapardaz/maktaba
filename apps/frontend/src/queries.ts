import type { QueryClient } from "@tanstack/react-query";

/** Invalidates every query whose data can change as a side effect of import/edit/remove/rescan. */
export function invalidateLibraryQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ["books"] });
  void queryClient.invalidateQueries({ queryKey: ["authors"] });
  void queryClient.invalidateQueries({ queryKey: ["series"] });
  void queryClient.invalidateQueries({ queryKey: ["tags"] });
  void queryClient.invalidateQueries({ queryKey: ["publishers"] });
  void queryClient.invalidateQueries({ queryKey: ["publisherGroups"] });
  void queryClient.invalidateQueries({ queryKey: ["languageGroups"] });
  void queryClient.invalidateQueries({ queryKey: ["collections"] });
  void queryClient.invalidateQueries({ queryKey: ["periodicals"] });
  void queryClient.invalidateQueries({ queryKey: ["readingStatusCounts"] });
  void queryClient.invalidateQueries({ queryKey: ["continueReading"] });
  void queryClient.invalidateQueries({ queryKey: ["recentlyAdded"] });
}
