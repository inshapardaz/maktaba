import { useCallback, useRef, useState } from "react";

// Issue #46: rubber-band ("marquee") multi-select by dragging on empty space in the book
// grid/list, alongside the existing click/Ctrl+click/Shift+click selection in App.tsx's
// handleBookClick. Works purely off DOM rects (data-book-id on each card/row) rather than
// virtualizer index math, so it only selects items that are actually mounted - a book scrolled
// out of view during a drag that never gets rendered simply isn't selectable until it is, same
// tradeoff most simple marquee-select implementations make (no drag-to-autoscroll here).

export interface MarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Below this many pixels of movement, a mousedown-then-up on empty space is treated as a plain
// click (clears the selection) rather than a marquee drag - otherwise every deselect-click would
// flash a 0-size selection rectangle.
const DRAG_THRESHOLD_PX = 4;

interface UseDragSelectOptions {
  containerRef: React.RefObject<HTMLElement | null>;
  // Called with the full set of book ids under the marquee on every move tick, and with an empty
  // array on a plain (non-dragged) click on empty space - the caller replaces its selection with
  // whatever this reports rather than merging, matching a plain (non-modifier) click's behavior.
  onSelect: (ids: string[]) => void;
}

export function useDragSelect({ containerRef, onSelect }: UseDragSelectOptions) {
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const computeSelected = useCallback(
    (rect: MarqueeRect): string[] => {
      const container = containerRef.current;
      if (!container) return [];
      const rRight = rect.left + rect.width;
      const rBottom = rect.top + rect.height;
      const ids: string[] = [];
      container.querySelectorAll<HTMLElement>("[data-book-id]").forEach((el) => {
        const itemRect = el.getBoundingClientRect();
        const intersects =
          itemRect.left < rRight && itemRect.right > rect.left && itemRect.top < rBottom && itemRect.bottom > rect.top;
        if (intersects && el.dataset.bookId) {
          ids.push(el.dataset.bookId);
        }
      });
      return ids;
    },
    [containerRef],
  );

  const onMouseDown = useCallback(
    (event: React.MouseEvent) => {
      // Only left-button drags on empty space (not on a book card/row, or anything inside one)
      // start a marquee - clicking/dragging a card itself is handled by its own onClick/onDragStart.
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest("[data-book-id]")) return;
      // A mousedown that lands on the container's own native scrollbar (Windows shows one
      // permanently, unlike macOS's overlay scrollbars) still reports the scrollable element
      // itself as the target - offsetX/offsetY beyond its content box (clientWidth/clientHeight,
      // which exclude the scrollbar) means the click was on the scrollbar track/thumb, not empty
      // list space, so it should scroll normally rather than start a marquee.
      if (target === containerRef.current && (event.nativeEvent.offsetX > target.clientWidth || event.nativeEvent.offsetY > target.clientHeight)) {
        return;
      }

      const start = { x: event.clientX, y: event.clientY };
      startRef.current = start;
      let dragged = false;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const left = Math.min(start.x, moveEvent.clientX);
        const top = Math.min(start.y, moveEvent.clientY);
        const width = Math.abs(moveEvent.clientX - start.x);
        const height = Math.abs(moveEvent.clientY - start.y);
        if (!dragged && width < DRAG_THRESHOLD_PX && height < DRAG_THRESHOLD_PX) {
          return;
        }
        dragged = true;
        const rect = { left, top, width, height };
        setMarqueeRect(rect);
        onSelect(computeSelected(rect));
      };

      const handleMouseUp = () => {
        startRef.current = null;
        setMarqueeRect(null);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        if (!dragged) {
          // A plain click on empty space (no drag) - clear the selection instead of leaving it
          // untouched, same as clicking empty desktop space in a file manager.
          onSelect([]);
        }
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [computeSelected, onSelect],
  );

  return { marqueeRect, onMouseDown };
}
