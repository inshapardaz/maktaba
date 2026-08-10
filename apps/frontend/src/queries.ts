import type { QueryClient } from "@tanstack/react-query";

/** Invalidates every query whose data can change as a side effect of import/edit/remove/rescan. */
export function invalidateLibraryQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ["books"] });
  void queryClient.invalidateQueries({ queryKey: ["authors"] });
  void queryClient.invalidateQueries({ queryKey: ["series"] });
  void queryClient.invalidateQueries({ queryKey: ["tags"] });
  void queryClient.invalidateQueries({ queryKey: ["collections"] });
  void queryClient.invalidateQueries({ queryKey: ["readingStatusCounts"] });
}
