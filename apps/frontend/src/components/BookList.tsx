import { useState } from "react";
import { ActionIcon, Badge, Box, Group, Image, Loader, Table, Tooltip } from "@mantine/core";
import { IconBook2, IconEdit } from "@tabler/icons-react";
import { coverUrl, getBook, pickPreferredReadFile, type BookSummary } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { useReaderLauncher } from "../ReaderLauncherContext";
import { READING_STATUS_COLOR, READING_STATUS_LABEL_KEY } from "../readingStatus";
import { BookEditForm } from "./BookEditForm";
import { SpineCover } from "./SpineCover";

const THUMB_WIDTH = 28;
const THUMB_HEIGHT = 40;

interface BookListProps {
  books: BookSummary[];
  onSelect: (id: string) => void;
}

interface BookRowProps {
  book: BookSummary;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
}

// A row's own component (rather than inlining the .map body) so its Read action can hold its own
// loading state, same reasoning as BookGrid.tsx's BookCard - fetching the book detail to resolve
// which file to open is async, and without a per-row flag a rapid double-click would fire it twice.
function BookRow({ book, onSelect, onEdit }: BookRowProps) {
  const { t, language } = useLanguage();
  const launchReader = useReaderLauncher();
  const [loadingRead, setLoadingRead] = useState(false);

  const handleRead = async () => {
    if (loadingRead) return;
    setLoadingRead(true);
    try {
      const detail = await getBook(book.id);
      const file = pickPreferredReadFile(detail.files);
      if (file) {
        launchReader({
          bookId: book.id,
          format: file.format,
          title: detail.title,
          absolutePath: file.absolutePath,
          readingStatus: detail.readingStatus,
        });
      }
    } finally {
      setLoadingRead(false);
    }
  };

  return (
    <Table.Tr onClick={() => onSelect(book.id)} style={{ cursor: "pointer" }}>
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
            <SpineCover id={book.id} title={book.title} width={THUMB_WIDTH} height={THUMB_HEIGHT} titleSize={6} padding={3} />
          )}
          {book.title}
        </Group>
      </Table.Td>
      <Table.Td>{book.authors.join(", ") || t("common.unknownAuthor")}</Table.Td>
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

export function BookList({ books, onSelect }: BookListProps) {
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
      <Table highlightOnHover verticalSpacing="sm">
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
          {books.map((book) => (
            <BookRow key={book.id} book={book} onSelect={onSelect} onEdit={setEditingBookId} />
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
