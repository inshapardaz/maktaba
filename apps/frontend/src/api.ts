export interface BookSummary {
  id: string;
  title: string;
  sortTitle: string;
  authors: string[];
  rating: number;
  dateAdded: string;
  hasCover: boolean;
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
}

export interface BookFilters {
  search?: string;
  authorId?: string;
  seriesId?: string;
  tagId?: string;
  format?: string;
  minRating?: number;
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
    let message = `Request failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body; keep the generic message
    }
    throw new Error(message);
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

export function listBooks(filters: BookFilters = {}): Promise<BookSummary[]> {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.authorId) params.set("authorId", filters.authorId);
  if (filters.seriesId) params.set("seriesId", filters.seriesId);
  if (filters.tagId) params.set("tagId", filters.tagId);
  if (filters.format) params.set("format", filters.format);
  if (filters.minRating) params.set("minRating", String(filters.minRating));

  const query = params.toString();
  return request<BookSummary[]>(`/api/books${query ? `?${query}` : ""}`);
}

export function getBook(id: string): Promise<BookDetail> {
  return request<BookDetail>(`/api/books/${id}`);
}

export function importBook(filePath: string): Promise<{ id: string }> {
  return request<{ id: string }>("/api/books/import", {
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

export function listAuthors(): Promise<BrowseGroup[]> {
  return request<BrowseGroup[]>("/api/authors");
}

export function listSeries(): Promise<BrowseGroup[]> {
  return request<BrowseGroup[]>("/api/series");
}

export function listTags(): Promise<BrowseGroup[]> {
  return request<BrowseGroup[]>("/api/tags");
}

export function coverUrl(id: string): string {
  const { apiBaseUrl, token } = window.maktaba;
  return `${apiBaseUrl}/api/books/${id}/cover?access_token=${encodeURIComponent(token)}`;
}
