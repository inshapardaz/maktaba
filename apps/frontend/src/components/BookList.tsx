import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { ActionIcon, Badge, Box, Group, HoverCard, Image, Loader, Menu, Stack, Text, TextInput, Tooltip, UnstyledButton } from "@mantine/core";
import { IconBook2, IconChevronDown, IconEdit, IconPencil } from "../icons";
import {
  coverUrl,
  getBook,
  pickPreferredReadFile,
  updateBook,
  type BookEditRequest,
  type BookFileInfo,
  type BookSummary,
} from "../api";
import { setBookDragData } from "../bookDrag";
import { useDragSelect } from "../dragSelect";
import { useLanguage } from "../i18n/LanguageContext";
import { displaySubtitle, displayTitle } from "../issueDisplay";
import { invalidateLibraryQueries } from "../queries";
import { useReaderLauncher } from "../ReaderLauncherContext";
import { READING_STATUS_COLOR, READING_STATUS_LABEL_KEY } from "../readingStatus";
import { BookEditForm } from "./BookEditForm";
import { SpineCover } from "./SpineCover";

const THUMB_SIZE = 56;
// Issue #45: a larger preview shown in a HoverCard when hovering a list row's cover thumbnail.
const PREVIEW_SIZE = 220;

interface BookListProps {
  books: BookSummary[];
  selectedIds: Set<string>;
  onSelect: (id: string, index: number, event: React.MouseEvent) => void;
  // Issue #46: replaces the selection with whatever the marquee drag (or a plain click on empty
  // space, which reports an empty array) covers - see dragSelect.ts's useDragSelect.
  onDragSelect: (ids: string[]) => void;
}

interface BookRowProps {
  book: BookSummary;
  index: number;
  selected: boolean;
  // See BookGrid.tsx's BookCard - the full multi-selection drags together only when this row is
  // part of it, otherwise dragging a row drags just that one book.
  selectedIds: Set<string>;
  onSelect: (id: string, index: number, event: React.MouseEvent) => void;
  onEdit: (id: string) => void;
}

function isReadableFormat(format: string): format is "Epub" | "Pdf" {
  return format === "Epub" || format === "Pdf";
}

// A row's own component (rather than inlining the .map body) so its Read action can hold its own
// loading state, same reasoning as BookGrid.tsx's BookCard - fetching the book detail to resolve
// which file to open is async, and without a per-row flag a rapid double-click would fire it twice.
function BookRow({ book, index, selected, selectedIds, onSelect, onEdit }: BookRowProps) {
  const { t } = useLanguage();
  const launchReader = useReaderLauncher();
  const queryClient = useQueryClient();
  const [loadingRead, setLoadingRead] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(book.title);
  const readableFormats = book.formats.filter(isReadableFormat);
  // An issue's title isn't user-editable anywhere (see BookEditForm.tsx, which hides the field
  // entirely) - the periodical it belongs to identifies it instead, so the inline-rename affordance
  // here is skipped too rather than letting it silently rename a value nothing else exposes.
  const isIssue = book.periodicalId != null;

  // Book.title has no dedicated rename endpoint (unlike Author/Series/Tag) - the edit endpoint is
  // a full replace, so the current full detail is fetched first and PUT back with just title
  // changed, same two-step pattern as App.tsx's handleDropBooksOnGroup.
  const renameMutation = useMutation({
    mutationFn: async (title: string) => {
      const detail = await getBook(book.id);
      const edit: BookEditRequest = {
        title,
        authors: detail.authors,
        language: detail.language,
        publisher: detail.publisher,
        publishedDate: detail.datePublished,
        description: detail.description,
        rating: detail.rating,
        seriesName: detail.seriesName,
        seriesIndex: detail.seriesIndex,
        tags: detail.tags,
        collectionIds: detail.collections.map((c) => c.id),
      };
      await updateBook(book.id, edit);
    },
    onSuccess: () => {
      invalidateLibraryQueries(queryClient);
      void queryClient.invalidateQueries({ queryKey: ["book", book.id] });
      setEditingTitle(false);
    },
    onError: (err) => {
      // Left open (rather than reverting) so the attempted title isn't lost - the user can just
      // retry or press Escape to give up.
      notifications.show({ color: "red", title: book.title, message: err instanceof Error ? err.message : String(err) });
    },
  });

  const commitTitle = () => {
    // Disabling the input while the mutation is in flight (below) can itself force a native blur,
    // which would otherwise re-enter here and fire a second mutate for the same edit.
    if (renameMutation.isPending) return;
    const trimmed = titleDraft.trim();
    if (trimmed.length === 0 || trimmed === book.title) {
      setTitleDraft(book.title);
      setEditingTitle(false);
      return;
    }
    renameMutation.mutate(trimmed);
  };

  const cancelTitleEdit = () => {
    setTitleDraft(book.title);
    setEditingTitle(false);
  };

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
    <Box
      data-book-id={book.id}
      draggable
      onDragStart={(event) => {
        const ids = selected && selectedIds.size > 1 ? Array.from(selectedIds) : [book.id];
        setBookDragData(event, ids);
      }}
      onClick={(event) => onSelect(book.id, index, event)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--mantine-spacing-md)",
        padding: "var(--mantine-spacing-sm) var(--mantine-spacing-md)",
        borderRadius: "var(--mantine-radius-md)",
        // Hover uses the same terracotta-tinted --mantine-primary-color-light-hover the sidebar's
        // NavLink rows already hover with (Mantine's own --nl-hover), rather than a bespoke tint.
        backgroundColor: selected ? "var(--mantine-primary-color-light)" : hovered ? "var(--mantine-primary-color-light-hover)" : "#ebddc5",
        border: "1px solid var(--mantine-color-default-border)",
      }}
    >
      <Group gap="md" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
        <HoverCard openDelay={300} closeDelay={100} position="right" withArrow shadow="md" disabled={!book.hasCover}>
          <HoverCard.Target>
            <Box style={{ flexShrink: 0 }}>
              {book.hasCover ? (
                <Image
                  src={coverUrl(book.id)}
                  alt=""
                  loading="lazy"
                  w={THUMB_SIZE}
                  h={THUMB_SIZE}
                  fit="cover"
                  radius="sm"
                  style={{ border: "1px solid var(--mantine-color-default-border)" }}
                />
              ) : (
                <SpineCover id={book.id} title={displayTitle(book, t)} width={THUMB_SIZE} height={THUMB_SIZE} titleSize={10} padding={4} />
              )}
            </Box>
          </HoverCard.Target>
          <HoverCard.Dropdown p={4}>
            <Image src={coverUrl(book.id)} alt="" w={PREVIEW_SIZE} fit="contain" radius="sm" />
          </HoverCard.Dropdown>
        </HoverCard>

        <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
          {isIssue ? (
            <Text fw={600} truncate="end" style={{ maxWidth: "100%" }}>
              {displayTitle(book, t)}
            </Text>
          ) : editingTitle ? (
            <TextInput
              size="xs"
              autoFocus
              value={titleDraft}
              disabled={renameMutation.isPending}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setTitleDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitTitle();
                if (event.key === "Escape") cancelTitleEdit();
              }}
              onBlur={commitTitle}
            />
          ) : (
            <Group gap={4} wrap="nowrap">
              <UnstyledButton
                onClick={(event) => {
                  event.stopPropagation();
                  setEditingTitle(true);
                }}
              >
                <Text fw={600} truncate="end" style={{ maxWidth: "100%" }}>
                  {book.title}
                </Text>
              </UnstyledButton>
              {hovered && (
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="gray"
                  aria-label={t("bookGrid.renameTitle")}
                  onClick={(event) => {
                    event.stopPropagation();
                    setEditingTitle(true);
                  }}
                >
                  <IconPencil size={12} />
                </ActionIcon>
              )}
            </Group>
          )}
          <Text size="sm" c="dimmed" truncate="end" style={{ maxWidth: "100%" }}>
            {displaySubtitle(book, t)}
          </Text>
          {(book.seriesName || book.tags.length > 0) && (
            <Group gap={4} mt={4} wrap="wrap">
              {book.seriesName && (
                <Badge size="xs" variant="dot" color="gray">
                  {book.seriesIndex != null ? `${book.seriesName} #${book.seriesIndex}` : book.seriesName}
                </Badge>
              )}
              {book.tags.map((tag) => (
                <Badge key={tag} size="xs" variant="outline" color="gray">
                  {tag}
                </Badge>
              ))}
            </Group>
          )}
        </Stack>
      </Group>

      <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
        {hovered && (
          <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
            {readableFormats.length > 1 ? (
              <Menu position="bottom-end" withinPortal>
                <ActionIcon.Group>
                  <Tooltip label={t("bookGrid.read")}>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="gray"
                      aria-label={t("bookGrid.read")}
                      disabled={loadingRead}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleRead();
                      }}
                    >
                      {loadingRead ? <Loader size={14} /> : <IconBook2 size={14} />}
                    </ActionIcon>
                  </Tooltip>
                  <Menu.Target>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="gray"
                      aria-label={t("bookDetail.chooseFormat")}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <IconChevronDown size={12} />
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
                  size="sm"
                  variant="subtle"
                  color="gray"
                  aria-label={t("bookGrid.read")}
                  disabled={loadingRead}
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleRead();
                  }}
                >
                  {loadingRead ? <Loader size={14} /> : <IconBook2 size={14} />}
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip label={t("bookDetail.edit")}>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                aria-label={t("bookDetail.edit")}
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit(book.id);
                }}
              >
                <IconEdit size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        )}
        <Text component="span" style={{ letterSpacing: 1 }}>
          {"★".repeat(book.rating)}
          {"☆".repeat(5 - book.rating)}
        </Text>
        <Badge color={READING_STATUS_COLOR[book.readingStatus]} variant="light">
          {t(READING_STATUS_LABEL_KEY[book.readingStatus])}
        </Badge>
        {book.formats.map((format) => (
          <Badge key={format} size="xs" variant="outline" color="gray">
            {format}
          </Badge>
        ))}
      </Group>
    </Box>
  );
}

export function BookList({ books, selectedIds, onSelect, onDragSelect }: BookListProps) {
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { marqueeRect, onMouseDown } = useDragSelect({ containerRef, onSelect: onDragSelect });

  return (
    <Box ref={containerRef} onMouseDown={onMouseDown} style={{ flex: 1, overflow: "auto" }} p="md">
      <Stack gap="sm">
        {books.map((book, index) => (
          <BookRow
            key={book.id}
            book={book}
            index={index}
            selected={selectedIds.has(book.id)}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onEdit={setEditingBookId}
          />
        ))}
      </Stack>

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
    </Box>
  );
}
