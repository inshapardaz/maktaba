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
}

export interface BookFilters {
  search?: string;
  authorId?: string;
  seriesId?: string;
  tagId?: string;
  collectionId?: string;
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
    throw new Error(body?.error ?? `Request failed: ${res.status}`);
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
  if (filters.readingStatus) params.set("readingStatus", filters.readingStatus);
  if (filters.format) params.set("format", filters.format);
  if (filters.minRating) params.set("minRating", String(filters.minRating));

  const query = params.toString();
  return request<BookSummary[]>(`/api/books${query ? `?${query}` : ""}`);
}

export function getBook(id: string): Promise<BookDetail> {
  return request<BookDetail>(`/api/books/${id}`);
}

export function importBook(filePath: string, duplicateAction?: DuplicateAction): Promise<{ id: string }> {
  return request<{ id: string }>("/api/books/import", {
    method: "POST",
    body: JSON.stringify({ filePath, duplicateAction }),
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

export function listSeries(): Promise<BrowseGroup[]> {
  return request<BrowseGroup[]>("/api/series");
}

export function listTags(): Promise<BrowseGroup[]> {
  return request<BrowseGroup[]>("/api/tags");
}

export function listCollections(): Promise<BrowseGroup[]> {
  return request<BrowseGroup[]>("/api/collections");
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

export function coverUrl(id: string): string {
  const { apiBaseUrl, token } = window.maktaba;
  return `${apiBaseUrl}/api/books/${id}/cover?access_token=${encodeURIComponent(token)}`;
}
