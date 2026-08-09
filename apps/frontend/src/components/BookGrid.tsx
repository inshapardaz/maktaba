import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Box, Center, Image, Text, UnstyledButton } from "@mantine/core";
import type { BookSummary } from "../api";
import { coverUrl } from "../api";
import { useLanguage } from "../i18n/LanguageContext";

interface BookGridProps {
  books: BookSummary[];
  onSelect: (id: string) => void;
}

const CARD_WIDTH = 160;
const COVER_HEIGHT = 220;
const CARD_HEIGHT = 270;
const GAP = 16;

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
                  <Box
                    w={CARD_WIDTH}
                    h={COVER_HEIGHT}
                    style={{
                      borderRadius: "var(--mantine-radius-sm)",
                      overflow: "hidden",
                      border: "1px solid var(--mantine-color-default-border)",
                      background: "var(--mantine-color-default-hover)",
                    }}
                  >
                    {book.hasCover ? (
                      <Image src={coverUrl(book.id)} alt="" loading="lazy" w={CARD_WIDTH} h={COVER_HEIGHT} fit="cover" />
                    ) : (
                      <Center h="100%" p="xs">
                        <Text size="xs" c="dimmed" ta="center" lineClamp={4}>
                          {book.title}
                        </Text>
                      </Center>
                    )}
                  </Box>
                  <Text size="sm" fw={600} mt={6} truncate="end" title={book.title}>
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
