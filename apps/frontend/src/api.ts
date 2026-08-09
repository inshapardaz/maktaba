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

export function listBooks(): Promise<BookSummary[]> {
  return request<BookSummary[]>("/api/books");
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

export function coverUrl(id: string): string {
  const { apiBaseUrl, token } = window.maktaba;
  return `${apiBaseUrl}/api/books/${id}/cover?access_token=${encodeURIComponent(token)}`;
}
