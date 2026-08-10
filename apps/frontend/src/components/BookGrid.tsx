import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Box, Image, Text, UnstyledButton } from "@mantine/core";
import type { BookSummary } from "../api";
import { coverUrl } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { SpineCover } from "./SpineCover";

interface BookGridProps {
  books: BookSummary[];
  onSelect: (id: string) => void;
}

const CARD_WIDTH = 160;
const COVER_HEIGHT = 240; // 2:3 aspect ratio, per design/README.md §3
const CARD_HEIGHT = 290;
const GAP = 20;

export function BookGrid({ books, onSelect }: BookGridProps) {
  const { t } = useLanguage();
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
    <Box ref={parentRef} style={{ flex: 1, overflow: "auto" }} p="md">
      <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const rowStart = virtualRow.index * columnCount;
          const rowBooks = books.slice(rowStart, rowStart + columnCount);

          return (
            <Box
              key={virtualRow.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
                display: "flex",
                gap: GAP,
              }}
            >
              {rowBooks.map((book) => (
                <UnstyledButton key={book.id} w={CARD_WIDTH} onClick={() => onSelect(book.id)}>
                  {book.hasCover ? (
                    <Image
                      src={coverUrl(book.id)}
                      alt=""
                      loading="lazy"
                      w={CARD_WIDTH}
                      h={COVER_HEIGHT}
                      fit="cover"
                      radius="sm"
                      style={{ border: "1px solid var(--mantine-color-default-border)", boxShadow: "var(--mantine-shadow-sm)" }}
                    />
                  ) : (
                    <SpineCover
                      id={book.id}
                      title={book.title}
                      author={book.authors.join(", ") || t("common.unknownAuthor")}
                      width={CARD_WIDTH}
                      height={COVER_HEIGHT}
                    />
                  )}
                  <Text size="sm" fw={600} mt={8} lineClamp={2} title={book.title}>
                    {book.title}
                  </Text>
                  <Text size="xs" c="dimmed" truncate="end" title={book.authors.join(", ")}>
                    {book.authors.join(", ") || t("common.unknownAuthor")}
                  </Text>
                </UnstyledButton>
              ))}
            </Box>
          );
        })}
      </div>
    </Box>
  );
}
