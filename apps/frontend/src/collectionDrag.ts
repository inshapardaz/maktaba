import type { DragEvent } from "react";

// Same shape/rationale as bookDrag.ts's BOOK_DRAG_MIME, for the "drag one collection row onto
// another to nest it" interaction (Sidebar.tsx's collections section, CollectionsView.tsx) - a
// distinct custom MIME type so a collection drag is distinguishable from a book drag (which
// Sidebar's own collection rows also accept, to assign a dropped book to that collection) and from
// an OS file drag.
export const COLLECTION_DRAG_MIME = "application/x-maktaba-collection-id";

export function setCollectionDragData(event: DragEvent, collectionId: string): void {
  event.dataTransfer.setData(COLLECTION_DRAG_MIME, collectionId);
  event.dataTransfer.effectAllowed = "move";
}

// Only "types" (not the actual payload) is readable during dragenter/dragover in Chromium -
// getData() returns "" until the drop itself - so hover-highlight logic must check this instead of
// calling readCollectionDragId below.
export function isCollectionDrag(event: DragEvent): boolean {
  return event.dataTransfer.types.includes(COLLECTION_DRAG_MIME);
}

export function readCollectionDragId(event: DragEvent): string | null {
  const id = event.dataTransfer.getData(COLLECTION_DRAG_MIME);
  return id.length > 0 ? id : null;
}
