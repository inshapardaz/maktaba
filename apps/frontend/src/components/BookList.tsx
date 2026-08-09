import { Box, Table } from "@mantine/core";
import type { BookSummary } from "../api";
import { useLanguage } from "../i18n/LanguageContext";

interface BookListProps {
  books: BookSummary[];
  onSelect: (id: string) => void;
}

export function BookList({ books, onSelect }: BookListProps) {
  const { t, language } = useLanguage();

  return (
    <Box style={{ flex: 1, overflow: "auto" }} p="md">
      <Table highlightOnHover verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("bookList.title")}</Table.Th>
            <Table.Th>{t("bookList.author")}</Table.Th>
            <Table.Th>{t("bookList.rating")}</Table.Th>
            <Table.Th>{t("bookList.dateAdded")}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {books.map((book) => (
            <Table.Tr key={book.id} onClick={() => onSelect(book.id)} style={{ cursor: "pointer" }}>
              <Table.Td>{book.title}</Table.Td>
              <Table.Td>{book.authors.join(", ") || t("common.unknownAuthor")}</Table.Td>
              <Table.Td>
                {"★".repeat(book.rating)}
                {"☆".repeat(5 - book.rating)}
              </Table.Td>
              <Table.Td>{new Date(book.dateAdded).toLocaleDateString(language === "ur" ? "ur" : undefined)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Box>
  );
}
