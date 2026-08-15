import { Badge, Box, Group, Image, Table } from "@mantine/core";
import { coverUrl, type BookSummary } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { READING_STATUS_COLOR, READING_STATUS_LABEL_KEY } from "../readingStatus";
import { SpineCover } from "./SpineCover";

const THUMB_WIDTH = 28;
const THUMB_HEIGHT = 40;

interface BookListProps {
  books: BookSummary[];
  onSelect: (id: string) => void;
}

export function BookList({ books, onSelect }: BookListProps) {
  const { t, language } = useLanguage();

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
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {books.map((book) => (
            <Table.Tr key={book.id} onClick={() => onSelect(book.id)} style={{ cursor: "pointer" }}>
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
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Box>
  );
}
