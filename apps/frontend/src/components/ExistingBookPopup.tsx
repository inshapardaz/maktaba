import { useQuery } from "@tanstack/react-query";
import { Alert, Badge, Button, Center, Group, Image, Loader, Modal, Stack, Text } from "@mantine/core";
import { IconAlertCircle } from "../icons";
import { coverUrl, getBook } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { SpineCover } from "./SpineCover";

interface ExistingBookPopupProps {
  bookId: string;
  onClose: () => void;
}

// A read-only peek at the book an import conflicted with (issue #25: "show option to see the book
// that is already in the library as a book info popup without any other actions on it") - no
// edit/delete/read affordances, just enough to recognize whether it's really the same book before
// picking a conflict resolution.
export function ExistingBookPopup({ bookId, onClose }: ExistingBookPopupProps) {
  const { t } = useLanguage();
  const bookQuery = useQuery({ queryKey: ["book", bookId], queryFn: () => getBook(bookId) });
  const book = bookQuery.data;

  return (
    <Modal opened onClose={onClose} title={t("duplicate.existingBookTitle")} size="sm">
      <Stack gap="md">
        {bookQuery.isLoading && (
          <Center py="xl">
            <Loader size="sm" />
          </Center>
        )}

        {bookQuery.isError && (
          <Alert color="red" icon={<IconAlertCircle size={18} />}>
            {bookQuery.error instanceof Error ? bookQuery.error.message : String(bookQuery.error)}
          </Alert>
        )}

        {book && (
          <Group align="flex-start" gap="md" wrap="nowrap">
            {book.hasCover ? (
              <Image
                src={coverUrl(book.id)}
                alt=""
                w={90}
                h={135}
                fit="cover"
                radius="sm"
                style={{ flexShrink: 0, border: "1px solid var(--mantine-color-default-border)" }}
              />
            ) : (
              <SpineCover
                id={book.id}
                title={book.title}
                author={book.authors.join(", ") || t("common.unknownAuthor")}
                width={90}
                height={135}
                titleSize={12}
                metaSize={8}
                padding={7}
              />
            )}
            <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
              <Text fw={600} size="sm">
                {book.title}
              </Text>
              <Text size="xs" c="dimmed">
                {book.authors.join(", ") || t("common.unknownAuthor")}
              </Text>
              {book.seriesName && (
                <Text size="xs" c="dimmed">
                  {book.seriesName}
                  {book.seriesIndex != null ? ` #${book.seriesIndex}` : ""}
                </Text>
              )}
              <Group gap={4} mt={4}>
                {book.formats.map((format) => (
                  <Badge key={format} size="xs" variant="light">
                    {format}
                  </Badge>
                ))}
              </Group>
            </Stack>
          </Group>
        )}

        <Group justify="flex-end">
          <Button size="xs" onClick={onClose}>
            {t("importDialog.close")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
