export type ReadingStatus = "Unread" | "Reading" | "Finished";

export interface BookSummary {
  id: string;
  title: string;
  sortTitle: string;
  authors: string[];
  rating: number;
  dateAdded: string;
  hasCover: boolean;
  readingStatus: ReadingStatus;
  // Null unless the book belongs to a series / has ever had reading progress saved - see
  // FilterBar.tsx's SortKey ("seriesIndex"/"lastRead").
  seriesIndex: number | null;
  lastReadAt: string | null;
  // Distinct formats this book has a file for (e.g. ["Epub", "Pdf"]) - lets BookGrid/BookList
  // decide whether to show a split "Read" button without a per-row detail fetch; the file's
  // AbsolutePath is only resolved (via getBook) once a specific format is actually chosen.
  formats: string[];
  // Null unless this book is an issue of a Periodical (see PeriodicalsView.tsx) - lets the
  // frontend render issue badges (volume/number/date) without a second request per book.
  periodicalId: string | null;
  periodicalName: string | null;
  issueNumber: number | null;
  volumeNumber: number | null;
  issueDate: string | null;
}

export interface BookFileInfo {
  format: string;
  fileSizeBytes: number;
  absolutePath: string;
}

export interface Identifier {
  scheme: string;
  value: string;
}

export interface BookCollectionRef {
  id: string;
  name: string;
}

export interface BookDetail extends BookSummary {
  description: string | null;
  language: string | null;
  publisher: string | null;
  datePublished: string | null;
  seriesName: string | null;
  seriesIndex: number | null;
  tags: string[];
  identifiers: Identifier[];
  files: BookFileInfo[];
  collections: BookCollectionRef[];
}

export interface LibraryInfo {
  path: string;
  id: string;
  name: string;
  // Per-library preference (Settings -> Libraries) - hides the Periodicals sidebar section and the
  // book-edit form's Periodical fieldset when off, without touching this library's own data.
  periodicalsEnabled: boolean;
}

export interface BrowseGroup {
  id: string;
  name: string;
  bookCount: number;
}

export interface BookEditRequest {
  title: string;
  authors: string[];
  language: string | null;
  publisher: string | null;
  publishedDate: string | null;
  description: string | null;
  rating: number;
  seriesName: string | null;
  seriesIndex: number | null;
  tags: string[];
  collectionIds: string[];
  periodicalId?: string | null;
  issueNumber?: number | null;
  volumeNumber?: number | null;
  issueDate?: string | null;
}

export interface BookFilters {
  search?: string;
  authorId?: string;
  seriesId?: string;
  tagId?: string;
  collectionId?: string;
  periodicalId?: string;
  // Issues are hidden from the main library view unless this is explicitly true - see
  // periodicalSettings.ts's localStorage-backed toggle. Ignored (issues always included) when
  // periodicalId is set, since browsing a specific periodical should always show its own issues.
  includeIssues?: boolean;
  publisher?: string;
  language?: string;
  readingStatus?: ReadingStatus;
  format?: string;
  minRating?: number;
}

export interface ReadingStatusCount {
  status: ReadingStatus;
  count: number;
}

export interface DuplicateBookInfo {
  existingBookId: string;
  existingTitle: string;
  existingAuthors: string[];
  sameContentHash: boolean;
}

export class DuplicateBookError extends Error {
  duplicate: DuplicateBookInfo;

  constructor(duplicate: DuplicateBookInfo) {
    super(`A matching book already exists: "${duplicate.existingTitle}".`);
    this.name = "DuplicateBookError";
    this.duplicate = duplicate;
  }
}

export type DuplicateAction = "skip" | "keep-both" | "merge";

// Carries the HTTP status alongside the message so callers can distinguish a transient server-side
// failure (5xx - worth auto-retrying, see ImportContext.tsx) from a genuine client-side rejection
// (4xx - e.g. file not accessible, unsupported format) that retrying identically won't fix.
export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { apiBaseUrl, token } = window.maktaba;

  const res = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res
      .json()
      .catch(() => null) as { error?: string; duplicate?: DuplicateBookInfo } | null;

    if (res.status === 409 && body?.duplicate) {
      throw new DuplicateBookError(body.duplicate);
    }
    throw new ApiError(body?.error ?? `Request failed: ${res.status}`, res.status);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

export function getCurrentLibrary(): Promise<LibraryInfo | undefined> {
  return request<LibraryInfo | undefined>("/api/libraries/current");
}

export function openLibrary(path: string): Promise<LibraryInfo> {
  return request<LibraryInfo>("/api/libraries/open", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export interface LibraryEntry {
  id: string;
  name: string;
  path: string;
  isActive: boolean;
  periodicalsEnabled: boolean;
}

// Every library the user has ever opened - only one (isActive) is the one every other request
// actually reads/writes through at a time; see Settings -> Libraries.
export function listLibraries(): Promise<LibraryEntry[]> {
  return request<LibraryEntry[]>("/api/libraries");
}

export function openLibraryById(id: string): Promise<LibraryInfo> {
  return request<LibraryInfo>(`/api/libraries/${id}/open`, { method: "POST" });
}

export function renameLibrary(id: string, name: string): Promise<LibraryEntry> {
  return request<LibraryEntry>(`/api/libraries/${id}/name`, {
    method: "PUT",
    body: JSON.stringify({ name }),
  });
}

export function relocateLibrary(id: string, path: string): Promise<LibraryEntry> {
  return request<LibraryEntry>(`/api/libraries/${id}/path`, {
    method: "PUT",
    body: JSON.stringify({ path }),
  });
}

export function setLibraryPeriodicalsEnabled(id: string, enabled: boolean): Promise<LibraryEntry> {
  return request<LibraryEntry>(`/api/libraries/${id}/periodicals-enabled`, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}

export function removeLibrary(id: string): Promise<void> {
  return request<void>(`/api/libraries/${id}`, { method: "DELETE" });
}

// Switches to this library first (if it isn't already active) and rescans it - works from any row
// in the Libraries list, not just the currently active one.
export function resyncLibrary(id: string): Promise<{ bookCount: number }> {
  return request<{ bookCount: number }>(`/api/libraries/${id}/resync`, { method: "POST" });
}

export function listBooks(filters: BookFilters = {}): Promise<BookSummary[]> {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.authorId) params.set("authorId", filters.authorId);
  if (filters.seriesId) params.set("seriesId", filters.seriesId);
  if (filters.tagId) params.set("tagId", filters.tagId);
  if (filters.collectionId) params.set("collectionId", filters.collectionId);
  if (filters.periodicalId) params.set("periodicalId", filters.periodicalId);
  if (filters.includeIssues) params.set("includeIssues", "true");
  if (filters.publisher) params.set("publisher", filters.publisher);
  if (filters.language) params.set("language", filters.language);
  if (filters.readingStatus) params.set("readingStatus", filters.readingStatus);
  if (filters.format) params.set("format", filters.format);
  if (filters.minRating) params.set("minRating", String(filters.minRating));

  const query = params.toString();
  return request<BookSummary[]>(`/api/books${query ? `?${query}` : ""}`);
}

// Newest books by DateAdded, independent of reading progress - see backend BookEndpoints.cs's
// /recently-added (a freshly imported library has nothing in listContinueReading yet, since that
// feed requires a ReadingProgress row).
export function listRecentlyAdded(limit?: number, includeIssues?: boolean): Promise<BookSummary[]> {
  const params = new URLSearchParams();
  if (limit) params.set("limit", String(limit));
  if (includeIssues) params.set("includeIssues", "true");
  const query = params.toString();
  return request<BookSummary[]>(`/api/books/recently-added${query ? `?${query}` : ""}`);
}

export function getBook(id: string): Promise<BookDetail> {
  return request<BookDetail>(`/api/books/${id}`);
}

function isReadableFormat(format: string): format is "Epub" | "Pdf" {
  return format === "Epub" || format === "Pdf";
}

// Epub is the fuller in-app reading experience (reflowable, chapters) - preferred when a book has
// both formats, e.g. after an M8 conversion. Shared by BookDetailPanel and BookGrid's hover "Read"
// action so both pick the same file for a given book.
export function pickPreferredReadFile(files: BookFileInfo[]): (BookFileInfo & { format: "Epub" | "Pdf" }) | undefined {
  const readableFiles = files.filter((f): f is BookFileInfo & { format: "Epub" | "Pdf" } => isReadableFormat(f.format));
  return readableFiles.find((f) => f.format === "Epub") ?? readableFiles[0];
}

// Same "prefer Epub" rule as pickPreferredReadFile above, for call sites (BookGrid/BookList) that
// only have BookSummary.formats (format names, no per-file AbsolutePath) rather than full file info.
export function pickPreferredFormat(formats: string[]): ("Epub" | "Pdf") | undefined {
  const readable = formats.filter(isReadableFormat);
  return readable.find((f) => f === "Epub") ?? readable[0];
}

export interface ContinueReadingBook {
  id: string;
  title: string;
  authors: string[];
  hasCover: boolean;
  readingStatus: ReadingStatus;
  format: "Epub" | "Pdf";
  absolutePath: string;
  percentage: number;
  updatedAt: string;
}

// Every book with saved reading progress, most recently updated first (see backend
// BookEndpoints.cs's /continue-reading) - the Home view takes items[0] as "last read" and filters
// readingStatus === "Reading" for the "currently reading" list from this one ordered feed.
export function listContinueReading(limit?: number, includeIssues?: boolean): Promise<ContinueReadingBook[]> {
  const params = new URLSearchParams();
  if (limit) params.set("limit", String(limit));
  if (includeIssues) params.set("includeIssues", "true");
  const query = params.toString();
  return request<ContinueReadingBook[]>(`/api/books/continue-reading${query ? `?${query}` : ""}`);
}

export function importBook(filePath: string, duplicateAction?: DuplicateAction): Promise<{ id: string; title: string }> {
  return request<{ id: string; title: string }>("/api/books/import", {
    method: "POST",
    body: JSON.stringify({ filePath, duplicateAction }),
  });
}

// BookDetailPanel's "add another file" action - attaches an extra format to this already-existing
// book (e.g. a PDF alongside its Epub) without touching its metadata, distinct from importBook()
// above which always considers creating a brand new book.
export function addBookFile(id: string, filePath: string): Promise<BookFileInfo> {
  return request<BookFileInfo>(`/api/books/${id}/files`, {
    method: "POST",
    body: JSON.stringify({ filePath }),
  });
}

export function updateBook(id: string, edit: BookEditRequest): Promise<void> {
  return request<void>(`/api/books/${id}`, {
    method: "PUT",
    body: JSON.stringify(edit),
  });
}

export function deleteBook(id: string): Promise<{ folderPath: string }> {
  return request<{ folderPath: string }>(`/api/books/${id}`, { method: "DELETE" });
}

export interface RescanProgress {
  isRunning: boolean;
  processed: number;
  total: number;
  currentBook: string | null;
}

// Polled while resyncLibrary()'s request is in flight - a separate HTTP request the backend
// answers from an in-memory tracker, independent of (and concurrent with) the long-running rescan.
export function getRescanProgress(): Promise<RescanProgress> {
  return request<RescanProgress>("/api/libraries/rescan/progress");
}

export function listAuthors(): Promise<BrowseGroup[]> {
  return request<BrowseGroup[]>("/api/authors");
}

// Cascades to every book by this author (see IAuthorRenameService) - rejects with a 409 (surfaced
// as a thrown Error via request()'s error handling) if another author already has this name,
// rather than silently merging the two.
export function renameAuthor(id: string, name: string): Promise<BrowseGroup> {
  return request<BrowseGroup>(`/api/authors/${id}/name`, {
    method: "PUT",
    body: JSON.stringify({ name }),
  });
}

export function listSeries(): Promise<BrowseGroup[]> {
  return request<BrowseGroup[]>("/api/series");
}

// Cascades to every book in this series automatically. Same 409-on-collision behavior as renameAuthor.
export function renameSeries(id: string, name: string): Promise<BrowseGroup> {
  return request<BrowseGroup>(`/api/series/${id}/name`, {
    method: "PUT",
    body: JSON.stringify({ name }),
  });
}

export function listTags(): Promise<BrowseGroup[]> {
  return request<BrowseGroup[]>("/api/tags");
}

// Cascades to every book with this tag automatically. Same 409-on-collision behavior as renameAuthor.
export function renameTag(id: string, name: string): Promise<BrowseGroup> {
  return request<BrowseGroup>(`/api/tags/${id}/name`, {
    method: "PUT",
    body: JSON.stringify({ name }),
  });
}

export function listCollections(): Promise<BrowseGroup[]> {
  return request<BrowseGroup[]>("/api/collections");
}

// Bare distinct publisher strings already in the library, for the edit form's autocomplete -
// unlike Authors/Series/Tags, Publisher isn't its own entity, so there's no BrowseGroup id/count.
export function listPublishers(): Promise<string[]> {
  return request<string[]>("/api/publishers");
}

// Same publishers, grouped with book counts for the sidebar's "browse by publisher" section - the
// publisher name itself doubles as the BrowseGroup's id (see backend BrowseEndpoints.cs).
export function listPublisherGroups(): Promise<BrowseGroup[]> {
  return request<BrowseGroup[]>("/api/publishers/grouped");
}

// Distinct book languages (ISO 639-1 codes) with book counts, for the sidebar's "browse by
// language" section (issue #13) - same shape/rationale as publisher groups above: Language is a
// plain string column on Book, not its own entity, so the code itself doubles as the id and the
// frontend translates it to a display name (see languageDisplayName in Sidebar.tsx).
export function listLanguageGroups(): Promise<BrowseGroup[]> {
  return request<BrowseGroup[]>("/api/languages/grouped");
}

export function createCollection(name: string): Promise<BrowseGroup> {
  return request<BrowseGroup>("/api/collections", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function deleteCollection(id: string): Promise<void> {
  return request<void>(`/api/collections/${id}`, { method: "DELETE" });
}

export function listReadingStatusCounts(): Promise<ReadingStatusCount[]> {
  return request<ReadingStatusCount[]>("/api/reading-statuses");
}

export function updateBookStatus(id: string, readingStatus: ReadingStatus): Promise<void> {
  return request<void>(`/api/books/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ readingStatus }),
  });
}

export interface SystemCapabilities {
  calibreAvailable: boolean;
}

export function getSystemCapabilities(): Promise<SystemCapabilities> {
  return request<SystemCapabilities>("/api/system/capabilities");
}

export function convertBook(id: string, targetFormat: "Epub" | "Pdf"): Promise<BookFileInfo> {
  return request<BookFileInfo>(`/api/books/${id}/convert`, {
    method: "POST",
    body: JSON.stringify({ targetFormat }),
  });
}

export async function getBookFile(id: string, format: "Epub" | "Pdf"): Promise<ArrayBuffer> {
  const { apiBaseUrl, token } = window.maktaba;
  const res = await fetch(`${apiBaseUrl}/api/books/${id}/file?format=${format}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to load book file (${res.status}).`);
  }
  return res.arrayBuffer();
}

export interface BookmarkInfo {
  id: string;
  chapterId: string;
  position: number;
  name: string;
  createdAt: string;
  updatedAt?: string;
}

export interface NoteInfo {
  id: string;
  chapterId: string;
  startOffset: number;
  endOffset: number;
  text: string;
  comment?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ReadingProgressInfo {
  currentChapter: number;
  totalChapters: number;
  currentPage: number;
  totalPages: number;
  chapterTitle: string | null;
  percentage: number;
  // The reader's own resume anchor (its chapterId + a within-chapter offset), opaque to us -
  // separate from the display fields above, written independently (see saveReadingProgress).
  chapterId: string | null;
  position: number | null;
  updatedAt: string;
}

export function listBookmarks(bookId: string): Promise<BookmarkInfo[]> {
  return request<BookmarkInfo[]>(`/api/books/${bookId}/bookmarks`);
}

// Upserts by bookmark.id (the reader's own client-generated id) - the reader calls this both to
// create a bookmark and to rename an existing one.
export function saveBookmark(bookId: string, bookmark: BookmarkInfo): Promise<void> {
  return request<void>(`/api/books/${bookId}/bookmarks/${bookmark.id}`, {
    method: "PUT",
    body: JSON.stringify(bookmark),
  });
}

export function deleteBookmark(bookId: string, bookmarkId: string): Promise<void> {
  return request<void>(`/api/books/${bookId}/bookmarks/${bookmarkId}`, { method: "DELETE" });
}

export function listNotes(bookId: string): Promise<NoteInfo[]> {
  return request<NoteInfo[]>(`/api/books/${bookId}/notes`);
}

// Upserts by note.id, same as saveBookmark - the reader also calls this to save comment edits.
export function saveNote(bookId: string, note: NoteInfo): Promise<void> {
  return request<void>(`/api/books/${bookId}/notes/${note.id}`, {
    method: "PUT",
    body: JSON.stringify(note),
  });
}

export function deleteNote(bookId: string, noteId: string): Promise<void> {
  return request<void>(`/api/books/${bookId}/notes/${noteId}`, { method: "DELETE" });
}

export function getReadingProgress(bookId: string): Promise<ReadingProgressInfo | null> {
  return request<ReadingProgressInfo | null>(`/api/books/${bookId}/progress`);
}

// Partial merge on the backend, not a full overwrite - the display snapshot (currentChapter/...)
// and the resume anchor (chapterId/position) are saved independently by two different reader
// callbacks (see ReaderOverlay.tsx), so each call only needs to send the fields it actually knows.
export function saveReadingProgress(
  bookId: string,
  progress: Partial<Omit<ReadingProgressInfo, "updatedAt">>,
): Promise<void> {
  return request<void>(`/api/books/${bookId}/progress`, {
    method: "PUT",
    body: JSON.stringify(progress),
  });
}

export function coverUrl(id: string): string {
  const { apiBaseUrl, token } = window.maktaba;
  return `${apiBaseUrl}/api/books/${id}/cover?access_token=${encodeURIComponent(token)}`;
}

export type PeriodicalFrequency = "Daily" | "Weekly" | "BiWeekly" | "Monthly" | "Quarterly" | "Yearly" | "Occasional";

export interface Periodical {
  id: string;
  name: string;
  description: string | null;
  frequency: PeriodicalFrequency;
  // Metadata that lives at the periodical level rather than per-issue - see BookEditForm.tsx,
  // which hides its own language/publisher/tags fields once a book is an issue in favor of these.
  // Issue #30: an issue has no language of its own - the reader falls back to its periodical's
  // language, then to English, to pick a word-lookup dictionary (see ReaderOverlay.tsx).
  language: string | null;
  publisher: string | null;
  editor: string | null;
  tags: string[];
  issueCount: number;
  hasCover: boolean;
}

export interface PeriodicalEditFields {
  name: string;
  frequency: PeriodicalFrequency;
  description: string | null;
  language: string | null;
  publisher: string | null;
  editor: string | null;
  tags: string[];
}

export function listPeriodicals(): Promise<Periodical[]> {
  return request<Periodical[]>("/api/periodicals");
}

export function getPeriodical(id: string): Promise<Periodical> {
  return request<Periodical>(`/api/periodicals/${id}`);
}

// Upserts by name (same semantics as createCollection) - a repeated quick-add of the same
// periodical name resolves to the one existing row instead of creating a duplicate. Kept as this
// minimal name+frequency signature since it's only ever called from Sidebar's quick-add popover -
// the full field set is edited afterward via updatePeriodical, from PeriodicalDetailView.
export function createPeriodical(name: string, frequency: PeriodicalFrequency, description?: string | null): Promise<Periodical> {
  return request<Periodical>("/api/periodicals", {
    method: "POST",
    body: JSON.stringify({ name, frequency, description: description ?? null }),
  });
}

export function updatePeriodical(id: string, fields: PeriodicalEditFields): Promise<Periodical> {
  return request<Periodical>(`/api/periodicals/${id}`, {
    method: "PUT",
    body: JSON.stringify(fields),
  });
}

// Rejects with a 409 (surfaced as a thrown ApiError) if the periodical still has issues and
// deleteIssues isn't passed - the caller is expected to confirm with the user first (showing the
// issue count) and retry with deleteIssues: true, same "confirm, then cascade" shape as the
// dedicated confirmation UI in PeriodicalsView.tsx/PeriodicalDetailView.tsx. On success, returns
// the periodical's absolute folder path (which already contains every issue's own subfolder) for
// the caller to move to the OS trash via window.maktaba.trashPath - mirrors deleteBook's contract.
export function deletePeriodical(id: string, deleteIssues?: boolean): Promise<{ folderPath: string }> {
  const query = deleteIssues ? "?deleteIssues=true" : "";
  return request<{ folderPath: string }>(`/api/periodicals/${id}${query}`, { method: "DELETE" });
}

export function periodicalCoverUrl(id: string): string {
  const { apiBaseUrl, token } = window.maktaba;
  return `${apiBaseUrl}/api/periodicals/${id}/cover?access_token=${encodeURIComponent(token)}`;
}

// Bypasses request() - a cover upload needs to send FormData with a browser-generated multipart
// boundary, not the JSON Content-Type request() always forces onto a body.
export async function uploadPeriodicalCover(id: string, file: File): Promise<void> {
  const { apiBaseUrl, token } = window.maktaba;
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${apiBaseUrl}/api/periodicals/${id}/cover`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `Request failed: ${res.status}`, res.status);
  }
}
