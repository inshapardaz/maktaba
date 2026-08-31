import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { ActionIcon, Badge, Box, Group, Image, Loader, Menu, Table, TextInput, Tooltip } from "@mantine/core";
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
import { useLanguage } from "../i18n/LanguageContext";
import { displaySubtitle, displayTitle } from "../issueDisplay";
import { invalidateLibraryQueries } from "../queries";
import { useReaderLauncher } from "../ReaderLauncherContext";
import { READING_STATUS_COLOR, READING_STATUS_LABEL_KEY } from "../readingStatus";
import { BookEditForm } from "./BookEditForm";
import { SpineCover } from "./SpineCover";

const THUMB_WIDTH = 28;
const THUMB_HEIGHT = 40;

interface BookListProps {
  books: BookSummary[];
  selectedIds: Set<string>;
  onSelect: (id: string, index: number, event: React.MouseEvent) => void;
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
  const { t, language } = useLanguage();
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
    <Table.Tr
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
        backgroundColor: selected ? "var(--mantine-primary-color-light)" : "#ebddc5",
        borderBottom: "1px solid var(--mantine-color-default-border)",
      }}
    >
      <Table.Td fw={600}>
        <Group gap="sm" wrap="nowrap">
          {book.hasCover ? (
            <Image
              src={coverUrl(book.id)}
              alt=""
              loading="lazy"
              w={THUMB_WIDTH}
              h={THUMB_HEIGHT}
              fit="cover"
              radius={4}
              style={{ flexShrink: 0, border: "1px solid var(--mantine-color-default-border)" }}
            />
          ) : (
            <SpineCover id={book.id} title={displayTitle(book, t)} width={THUMB_WIDTH} height={THUMB_HEIGHT} titleSize={6} padding={3} />
          )}
          {isIssue ? (
            <Group gap={4} wrap="nowrap">
              <Box component="span">{displayTitle(book, t)}</Box>
              {readableFormats.length > 1 &&
                readableFormats.map((format) => (
                  <Badge key={format} size="xs" variant="outline" color="gray">
                    {format}
                  </Badge>
                ))}
            </Group>
          ) : editingTitle ? (
            <TextInput
              size="xs"
              autoFocus
              value={titleDraft}
              disabled={renameMutation.isPending}
              style={{ flex: 1 }}
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
              <Box
                component="span"
                onClick={(event) => {
                  event.stopPropagation();
                  setEditingTitle(true);
                }}
                style={{ cursor: "text" }}
              >
                {book.title}
              </Box>
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
              {readableFormats.length > 1 &&
                readableFormats.map((format) => (
                  <Badge key={format} size="xs" variant="outline" color="gray">
                    {format}
                  </Badge>
                ))}
            </Group>
          )}
        </Group>
      </Table.Td>
      <Table.Td>{displaySubtitle(book, t)}</Table.Td>
      <Table.Td>
        {"★".repeat(book.rating)}
        {"☆".repeat(5 - book.rating)}
      </Table.Td>
      <Table.Td>
        <Badge color={READING_STATUS_COLOR[book.readingStatus]} variant="light" size="sm">
          {t(READING_STATUS_LABEL_KEY[book.readingStatus])}
        </Badge>
      </Table.Td>
      <Table.Td>{new Date(book.dateAdded).toLocaleDateString(language === "ur" ? "ur" : undefined)}</Table.Td>
      <Table.Td>
        <Group gap={4} wrap="nowrap" justify="flex-end">
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
      </Table.Td>
    </Table.Tr>
  );
}

export function BookList({ books, selectedIds, onSelect }: BookListProps) {
  const { t } = useLanguage();
  const [editingBookId, setEditingBookId] = useState<string | null>(null);

  const columns = [
    t("bookList.title"),
    t("bookList.author"),
    t("bookList.rating"),
    t("bookList.status"),
    t("bookList.dateAdded"),
  ];

  return (
    <Box style={{ flex: 1, overflow: "auto" }} p="md">
      <Table highlightOnHover highlightOnHoverColor="#ebddc5" verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            {columns.map((label) => (
              <Table.Th key={label} fz={11} fw={400} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.08em" }}>
                {label}
              </Table.Th>
            ))}
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
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
        </Table.Tbody>
      </Table>

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
