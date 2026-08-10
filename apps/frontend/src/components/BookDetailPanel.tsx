import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Center,
  Divider,
  Drawer,
  Group,
  Image,
  List,
  Loader,
  SegmentedControl,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconBook2, IconFolder, IconExternalLink, IconTrash } from "@tabler/icons-react";
import { getBook, deleteBook, coverUrl, updateBookStatus, type ReadingStatus } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { BookEditForm } from "./BookEditForm";
import { ReaderOverlay } from "./ReaderOverlay";
import { SpineCover } from "./SpineCover";

function isReadableFormat(format: string): format is "Epub" | "Pdf" {
  return format === "Epub" || format === "Pdf";
}

interface BookDetailPanelProps {
  bookId: string;
  onClose: () => void;
  onRemoved: () => void;
}

export function BookDetailPanel({ bookId, onClose, onRemoved }: BookDetailPanelProps) {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const [isEditing, setEditing] = useState(false);
  const [isRemoving, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [readerFormat, setReaderFormat] = useState<"Epub" | "Pdf" | null>(null);

  const {
    data: book,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["book", bookId],
    queryFn: () => getBook(bookId),
  });

  const statusMutation = useMutation({
    mutationFn: (status: ReadingStatus) => updateBookStatus(bookId, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["book", bookId] });
      void queryClient.invalidateQueries({ queryKey: ["books"] });
      void queryClient.invalidateQueries({ queryKey: ["readingStatusCounts"] });
    },
  });

  const statusOptions: { value: ReadingStatus; label: string }[] = [
    { value: "Unread", label: t("readingStatus.unread") },
    { value: "Reading", label: t("readingStatus.reading") },
    { value: "Finished", label: t("readingStatus.finished") },
  ];

  if (isEditing) {
    return (
      <BookEditForm bookId={bookId} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />
    );
  }

  const handleRemove = async () => {
    if (!book) return;

    setRemoving(true);
    setRemoveError(null);
    try {
      const { folderPath } = await deleteBook(bookId);
      await window.maktaba.trashPath(folderPath);
      onRemoved();
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : String(err));
      setRemoving(false);
    }
  };

  return (
    <Drawer
      opened
      onClose={onClose}
      title={book?.title ?? t("bookDetail.defaultTitle")}
      position={language === "ur" ? "left" : "right"}
      size={392}
      padding="lg"
    >
      {isLoading && (
        <Center py="xl">
          <Loader />
        </Center>
      )}

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={18} />}>
          {error instanceof Error ? error.message : String(error)}
        </Alert>
      )}

      {book && (
        <Stack gap="md">
          <Group align="flex-start" gap="md">
            {book.hasCover ? (
              <Image
                src={coverUrl(book.id)}
                alt=""
                w={110}
                h={165}
                fit="cover"
                radius="sm"
                style={{
                  flexShrink: 0,
                  border: "1px solid var(--mantine-color-default-border)",
                  boxShadow: "var(--mantine-shadow-sm)",
                }}
              />
            ) : (
              <SpineCover
                id={book.id}
                title={book.title}
                author={book.authors.join(", ") || t("common.unknownAuthor")}
                width={110}
                height={165}
                titleSize={14}
                metaSize={9}
                padding={8}
              />
            )}

            <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
              <Title order={3}>{book.title}</Title>
              <Text c="dimmed">{book.authors.join(", ") || t("common.unknownAuthor")}</Text>
              {book.seriesName && (
                <Text size="sm">
                  {book.seriesName}
                  {book.seriesIndex != null ? ` #${book.seriesIndex}` : ""}
                </Text>
              )}
              <Text>
                {"★".repeat(book.rating)}
                {"☆".repeat(5 - book.rating)}
              </Text>
              <SegmentedControl
                size="xs"
                fullWidth
                data={statusOptions}
                value={book.readingStatus}
                onChange={(value) => statusMutation.mutate(value as ReadingStatus)}
                disabled={statusMutation.isPending}
              />
              <Group gap="xs" mt="xs">
                <Button size="xs" variant="default" onClick={() => setEditing(true)}>
                  {t("bookDetail.edit")}
                </Button>
                {confirmingRemove ? (
                  <Group gap={6}>
                    <Text size="xs" c="dimmed">
                      {t("bookDetail.confirmRemove")}
                    </Text>
                    <Button size="xs" color="red" loading={isRemoving} onClick={() => void handleRemove()}>
                      {t("common.confirm")}
                    </Button>
                    <Button size="xs" variant="subtle" onClick={() => setConfirmingRemove(false)} disabled={isRemoving}>
                      {t("common.cancel")}
                    </Button>
                  </Group>
                ) : (
                  <Button
                    size="xs"
                    variant="default"
                    color="red"
                    leftSection={<IconTrash size={14} />}
                    onClick={() => setConfirmingRemove(true)}
                  >
                    {t("bookDetail.remove")}
                  </Button>
                )}
              </Group>
              {removeError && (
                <Text size="xs" c="red">
                  {removeError}
                </Text>
              )}
            </Stack>
          </Group>

          {book.description && <Text size="sm">{book.description}</Text>}

          <Divider />

          <Group gap="lg">
            {book.publisher && (
              <div>
                <Text size="xs" c="dimmed">
                  {t("bookDetail.publisher")}
                </Text>
                <Text size="sm">{book.publisher}</Text>
              </div>
            )}
            {book.datePublished && (
              <div>
                <Text size="xs" c="dimmed">
                  {t("bookDetail.published")}
                </Text>
                <Text size="sm">{book.datePublished}</Text>
              </div>
            )}
            {book.language && (
              <div>
                <Text size="xs" c="dimmed">
                  {t("bookDetail.language")}
                </Text>
                <Text size="sm">{book.language}</Text>
              </div>
            )}
          </Group>

          {book.tags.length > 0 && (
            <Group gap={6}>
              {book.tags.map((tag) => (
                <Badge key={tag} variant="light">
                  {tag}
                </Badge>
              ))}
            </Group>
          )}

          {book.collections.length > 0 && (
            <div>
              <Text size="xs" c="dimmed" mb={4}>
                {t("bookDetail.collections")}
              </Text>
              <Group gap={6}>
                {book.collections.map((collection) => (
                  <Badge key={collection.id} variant="outline">
                    {collection.name}
                  </Badge>
                ))}
              </Group>
            </div>
          )}

          {book.identifiers.length > 0 && (
            <Text size="xs" c="dimmed">
              {book.identifiers.map((i) => `${i.scheme.toUpperCase()}: ${i.value}`).join(" · ")}
            </Text>
          )}

          <Divider label={t("bookDetail.files")} labelPosition="left" />

          <List spacing="xs" listStyleType="none">
            {book.files.map((f) => (
              <List.Item key={f.absolutePath}>
                <Group justify="space-between">
                  <Text size="sm">
                    {f.format} — {(f.fileSizeBytes / 1024).toFixed(0)} KB
                  </Text>
                  <Group gap={4}>
                    {isReadableFormat(f.format) && (
                      <Anchor size="sm" component="button" type="button" onClick={() => setReaderFormat(f.format as "Epub" | "Pdf")}>
                        <Group gap={4}>
                          <IconBook2 size={14} />
                          {t("bookDetail.read")}
                        </Group>
                      </Anchor>
                    )}
                    <Anchor size="sm" component="button" type="button" onClick={() => window.maktaba.openPath(f.absolutePath)}>
                      <Group gap={4}>
                        <IconExternalLink size={14} />
                        {t("bookDetail.open")}
                      </Group>
                    </Anchor>
                    <Anchor
                      size="sm"
                      component="button"
                      type="button"
                      onClick={() => window.maktaba.revealInFolder(f.absolutePath)}
                    >
                      <Group gap={4}>
                        <IconFolder size={14} />
                        {t("bookDetail.showInFolder")}
                      </Group>
                    </Anchor>
                  </Group>
                </Group>
              </List.Item>
            ))}
          </List>
        </Stack>
      )}

      {readerFormat && (
        <ReaderOverlay bookId={bookId} format={readerFormat} onClose={() => setReaderFormat(null)} />
      )}
    </Drawer>
  );
}
