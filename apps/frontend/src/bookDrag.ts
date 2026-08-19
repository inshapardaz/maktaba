import type { DragEvent } from "react";

// Shared between the drag sources (BookGrid/BookList's cards/rows) and the drop targets
// (Sidebar's Authors/Series/Tags/Collections rows) for issue #10's "drag a book onto a sidebar
// group to edit it" feature - a custom MIME type carrying a JSON array of book ids, so a drag
// originating from Maktaba's own book grid/list is distinguishable from an OS file drag (which
// App.tsx's own onDrop already handles as an import, via "Files").
export const BOOK_DRAG_MIME = "application/x-maktaba-book-ids";

export function setBookDragData(event: DragEvent, bookIds: string[]): void {
  event.dataTransfer.setData(BOOK_DRAG_MIME, JSON.stringify(bookIds));
  event.dataTransfer.effectAllowed = "copy";
}

// Only "types" (not the actual payload) is readable during dragenter/dragover in Chromium -
// getData() returns "" until the drop itself - so hover-highlight logic must check this instead of
// calling readBookDragIds below.
export function isBookDrag(event: DragEvent): boolean {
  return event.dataTransfer.types.includes(BOOK_DRAG_MIME);
}

export function readBookDragIds(event: DragEvent): string[] | null {
  const raw = event.dataTransfer.getData(BOOK_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((id) => typeof id === "string") ? parsed : null;
  } catch {
    return null;
  }
}
