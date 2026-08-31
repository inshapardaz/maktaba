import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ActionIcon, Badge, Box, Group, Image, Loader, Menu, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { IconBook2, IconChevronDown, IconEdit, IconInfoCircle } from "../icons";
import { coverUrl, getBook, pickPreferredReadFile, type BookFileInfo, type BookSummary } from "../api";
import { isBookDrag, readBookDragIds, setBookDragData } from "../bookDrag";
import { useDragSelect } from "../dragSelect";
import { useLanguage } from "../i18n/LanguageContext";
import { displaySubtitle, displayTitle } from "../issueDisplay";
import { useReaderLauncher } from "../ReaderLauncherContext";
import { READING_STATUS_COLOR, READING_STATUS_LABEL_KEY } from "../readingStatus";
import { BookEditForm } from "./BookEditForm";
import { MergeConfirmDialog } from "./MergeConfirmDialog";
import { SpineCover } from "./SpineCover";

interface BookGridProps {
  books: BookSummary[];
  selectedIds: Set<string>;
  onSelect: (id: string, index: number, event: React.MouseEvent) => void;
  // Issue #46: replaces the selection with whatever the marquee drag (or a plain click on empty
  // space, which reports an empty array) covers - see dragSelect.ts's useDragSelect.
  onDragSelect: (ids: string[]) => void;
}

const CARD_WIDTH = 160;
const COVER_HEIGHT = 240; // 2:3 aspect ratio, per design/README.md §3
const CARD_HEIGHT = 290;
const GAP = 20;

interface BookCardProps {
  book: BookSummary;
  index: number;
  selected: boolean;
  // The full multi-selection to drag when this card is part of it (see App.tsx's handleBookClick) -
  // dragging a card that isn't currently selected drags just that one book instead, regardless of
  // whatever else happens to be selected.
  selectedIds: Set<string>;
  onSelect: (id: string, index: number, event: React.MouseEvent) => void;
  onEdit: (id: string) => void;
  // Issue #49: dropping a book (or the active multi-selection) onto this card offers to merge the
  // dropped book(s) into this one - see App.tsx-level MergeConfirmDialog rendered by BookGrid below.
  onMergeRequest: (targetId: string, sourceIds: string[]) => void;
}

function isReadableFormat(format: string): format is "Epub" | "Pdf" {
  return format === "Epub" || format === "Pdf";
}

function BookCard({ book, index, selected, selectedIds, onSelect, onEdit, onMergeRequest }: BookCardProps) {
  const { t } = useLanguage();
  const launchReader = useReaderLauncher();
  const [hovered, setHovered] = useState(false);
  const [loadingRead, setLoadingRead] = useState(false);
  const [mergeDragOver, setMergeDragOver] = useState(false);
  const readableFormats = book.formats.filter(isReadableFormat);

  const handleRead = async (format?: "Epub" | "Pdf") => {
    if (loadingRead) return;
    setLoadingRead(true);
    try {
      const detail = await getBook(book.id);
      const matchedFile = format
        ? detail.files.find((f): f is BookFileInfo & { format: "Epub" | "Pdf" } => f.format === format)
        : undefined;
      const file = matchedFile ?? pickPreferredReadFile(detail.files);
      if (file) {
        launchReader({
          bookId: book.id,
          format: file.format,
          title: displayTitle(detail, t),
          absolutePath: file.absolutePath,
          readingStatus: detail.readingStatus,
        });
      }
    } finally {
      setLoadingRead(false);
    }
  };

  return (
    <UnstyledButton
      data-book-id={book.id}
      w={CARD_WIDTH}
      draggable
      onDragStart={(event) => {
        const ids = selected && selectedIds.size > 1 ? Array.from(selectedIds) : [book.id];
        setBookDragData(event, ids);
      }}
      onClick={(event) => onSelect(book.id, index, event)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // Issue #49: dropping a book (or the active multi-selection) onto this card offers to merge
      // it into this one - same book-drag payload BookCard's own onDragStart above produces, just
      // dropped on a card instead of a sidebar row.
      onDragOver={(event) => {
        if (!isBookDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setMergeDragOver(true);
      }}
      onDragLeave={() => setMergeDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setMergeDragOver(false);
        const draggedIds = readBookDragIds(event);
        const sourceIds = draggedIds?.filter((id) => id !== book.id) ?? [];
        if (sourceIds.length > 0) {
          onMergeRequest(book.id, sourceIds);
        }
      }}
      style={{
        borderRadius: "var(--mantine-radius-sm)",
        outline: mergeDragOver
          ? "2px solid var(--mantine-color-orange-6)"
          : selected
            ? "2px solid var(--mantine-primary-color-6)"
            : "2px solid transparent",
        outlineOffset: 2,
      }}
    >
      <Box pos="relative">
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
            title={displayTitle(book, t)}
            author={displaySubtitle(book, t)}
            width={CARD_WIDTH}
            height={COVER_HEIGHT}
          />
        )}
        {book.readingStatus !== "Unread" && (
          <Badge
            color={READING_STATUS_COLOR[book.readingStatus]}
            size="xs"
            style={{ position: "absolute", insetBlockStart: 8, insetInlineEnd: 8 }}
          >
            {t(READING_STATUS_LABEL_KEY[book.readingStatus])}
          </Badge>
        )}
        {hovered && (
          <Group
            gap={6}
            justify="center"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0, 0, 0, 0.45)",
              borderRadius: "var(--mantine-radius-sm)",
            }}
          >
            {readableFormats.length > 1 ? (
              <Menu position="top" withinPortal>
                <ActionIcon.Group>
                  <Tooltip label={t("bookGrid.read")}>
                    <ActionIcon
                      size="lg"
                      radius="xl"
                      variant="filled"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleRead();
                      }}
                      disabled={loadingRead}
                    >
                      {loadingRead ? <Loader size={16} color="white" /> : <IconBook2 size={18} />}
                    </ActionIcon>
                  </Tooltip>
                  <Menu.Target>
                    <ActionIcon
                      size="lg"
                      radius="xl"
                      variant="filled"
                      aria-label={t("bookDetail.chooseFormat")}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <IconChevronDown size={14} />
                    </ActionIcon>
                  </Menu.Target>
                </ActionIcon.Group>
                <Menu.Dropdown onClick={(event) => event.stopPropagation()}>
                  {readableFormats.map((format) => (
                    <Menu.Item key={format} onClick={() => void handleRead(format)}>
                      {format}
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
            ) : (
              <Tooltip label={t("bookGrid.read")}>
                <ActionIcon
                  size="lg"
                  radius="xl"
                  variant="filled"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleRead();
                  }}
                  disabled={loadingRead}
                >
                  {loadingRead ? <Loader size={16} color="white" /> : <IconBook2 size={18} />}
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip label={t("bookGrid.viewDetails")}>
              <ActionIcon
                size="lg"
                radius="xl"
                variant="filled"
                color="gray"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(book.id, index, event);
                }}
              >
                <IconInfoCircle size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("bookDetail.edit")}>
              <ActionIcon
                size="lg"
                radius="xl"
                variant="filled"
                color="gray"
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit(book.id);
                }}
              >
                <IconEdit size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        )}
      </Box>
      {/* Inline title editing was tried here (click/hover-pencil -> TextInput) but proved flaky:
          the card is a real <button>, and an <input> nested inside a native button is invalid
          HTML that fights the button's own keyboard-activation behavior (e.g. Space bubbling as
          "activate the button" even with stopPropagation on the input). Disabled for card view -
          use the pencil-edit affordance in list view (BookList.tsx), or the full edit form
          (onEdit, above), to rename a title instead. */}
      <Text size="sm" fw={600} mt={8} lineClamp={2} title={displayTitle(book, t)}>
        {displayTitle(book, t)}
      </Text>
      <Text size="xs" c="dimmed" truncate="end" title={displaySubtitle(book, t)}>
        {displaySubtitle(book, t)}
      </Text>
    </UnstyledButton>
  );
}

export function BookGrid({ books, selectedIds, onSelect, onDragSelect }: BookGridProps) {
  const { t } = useLanguage();
  const parentRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(1);
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  // Issue #49: target/source ids only - resolved to titles at render time from `books` below, so
  // the dialog always reflects the current title even if it changed since the drop.
  const [mergeRequest, setMergeRequest] = useState<{ targetId: string; sourceIds: string[] } | null>(null);
  const { marqueeRect, onMouseDown } = useDragSelect({ containerRef: parentRef, onSelect: onDragSelect });

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
    <Box ref={parentRef} onMouseDown={onMouseDown} style={{ flex: 1, overflow: "auto" }} p="md">
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
              {rowBooks.map((book, colIndex) => (
                <BookCard
                  key={book.id}
                  book={book}
                  index={rowStart + colIndex}
                  selected={selectedIds.has(book.id)}
                  selectedIds={selectedIds}
                  onSelect={onSelect}
                  onEdit={setEditingBookId}
                  onMergeRequest={(targetId, sourceIds) => setMergeRequest({ targetId, sourceIds })}
                />
              ))}
            </Box>
          );
        })}
      </div>

      {marqueeRect && (
        <Box
          pos="fixed"
          style={{
            left: marqueeRect.left,
            top: marqueeRect.top,
            width: marqueeRect.width,
            height: marqueeRect.height,
            border: "1px solid var(--mantine-primary-color-6)",
            backgroundColor: "var(--mantine-primary-color-light)",
            pointerEvents: "none",
            zIndex: 100,
          }}
        />
      )}

      {editingBookId && (
        <BookEditForm
          bookId={editingBookId}
          onClose={() => setEditingBookId(null)}
          onSaved={() => setEditingBookId(null)}
        />
      )}

      {mergeRequest &&
        (() => {
          const target = books.find((b) => b.id === mergeRequest.targetId);
          if (!target) return null;
          return (
            <MergeConfirmDialog
              target={{ id: target.id, title: displayTitle(target, t) }}
              sources={mergeRequest.sourceIds.map((id) => {
                const source = books.find((b) => b.id === id);
                return { id, title: source ? displayTitle(source, t) : id };
              })}
              onClose={() => setMergeRequest(null)}
            />
          );
        })()}
    </Box>
  );
}
