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
      <Table highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            {[t("bookList.title"), t("bookList.author"), t("bookList.rating"), t("bookList.dateAdded")].map((label) => (
              <Table.Th key={label} fz={11} fw={400} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.08em" }}>
                {label}
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {books.map((book) => (
            <Table.Tr key={book.id} onClick={() => onSelect(book.id)} style={{ cursor: "pointer" }}>
              <Table.Td fw={600}>{book.title}</Table.Td>
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
