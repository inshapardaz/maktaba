import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { BookSummary } from "../api";
import { coverUrl } from "../api";

interface BookGridProps {
  books: BookSummary[];
  onSelect: (id: string) => void;
}

const CARD_WIDTH = 160;
const CARD_HEIGHT = 260;
const GAP = 16;

export function BookGrid({ books, onSelect }: BookGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(1);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;

    const updateColumns = () => {
      const count = Math.max(1, Math.floor(el.clientWidth / (CARD_WIDTH + GAP)));
      setColumnCount(count);
    };

    updateColumns();
    const observer = new ResizeObserver(updateColumns);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rowCount = Math.ceil(books.length / columnCount);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD_HEIGHT + GAP,
    overscan: 3,
  });

  return (
    <div className="book-grid-scroll" ref={parentRef}>
      <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const rowStart = virtualRow.index * columnCount;
          const rowBooks = books.slice(rowStart, rowStart + columnCount);

          return (
            <div
              key={virtualRow.key}
              className="book-grid-row"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {rowBooks.map((book) => (
                <button
                  key={book.id}
                  type="button"
                  className="book-card"
                  style={{ width: CARD_WIDTH }}
                  onClick={() => onSelect(book.id)}
                >
                  <div className="book-cover">
                    {book.hasCover ? (
                      <img src={coverUrl(book.id)} alt="" loading="lazy" />
                    ) : (
                      <div className="book-cover-placeholder">{book.title}</div>
                    )}
                  </div>
                  <div className="book-title" title={book.title}>
                    {book.title}
                  </div>
                  <div className="book-author" title={book.authors.join(", ")}>
                    {book.authors.join(", ") || "Unknown author"}
                  </div>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
