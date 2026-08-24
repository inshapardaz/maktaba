const SHOW_ISSUES_IN_GRID_KEY = "maktaba-show-issues-in-grid";

// Issues are hidden from the main "All Books" grid/Home views by default - a daily/weekly
// periodical would otherwise flood them (see BookEndpoints.cs's includeIssues gate). This toggle
// (Settings -> General) overrides that per-user, same localStorage-backed pattern as readerSettings.ts.
export function getStoredShowIssuesInGrid(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(SHOW_ISSUES_IN_GRID_KEY) === "true";
}

export function setStoredShowIssuesInGrid(show: boolean): void {
  window.localStorage.setItem(SHOW_ISSUES_IN_GRID_KEY, show ? "true" : "false");
}
