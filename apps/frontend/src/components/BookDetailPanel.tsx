import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Center,
  Divider,
  Group,
  Image,
  List,
  Loader,
  Modal,
  SegmentedControl,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconAlertCircle, IconBook2, IconFolder, IconExternalLink, IconTrash } from "@tabler/icons-react";
import {
  getBook,
  deleteBook,
  coverUrl,
  updateBookStatus,
  getReadingProgress,
  type BookFileInfo,
  type ReadingStatus,
} from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { BookEditForm } from "./BookEditForm";
import { SpineCover } from "./SpineCover";

function isReadableFormat(format: string): format is "Epub" | "Pdf" {
  return format === "Epub" || format === "Pdf";
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Text fz={10.5} fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.1em" }}>
      {children}
    </Text>
  );
}

interface BookDetailPanelProps {
  bookId: string;
  onClose: () => void;
  onRemoved: () => void;
}

export function BookDetailPanel({ bookId, onClose, onRemoved }: BookDetailPanelProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [isEditing, setEditing] = useState(false);
  const [isRemoving, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const {
    data: book,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["book", bookId],
    queryFn: () => getBook(bookId),
  });

  const { data: progress } = useQuery({
    queryKey: ["progress", bookId],
    queryFn: () => getReadingProgress(bookId),
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

  // Opens in its own Electron BrowserWindow (see apps/desktop/src/main.ts's openReaderWindow)
  // rather than in-app, so several books can be read side by side instead of one at a time.
  const openReader = (format: "Epub" | "Pdf") => {
    void window.maktaba.openReaderWindow(bookId, format, book?.title);
  };

  const readableFiles: (BookFileInfo & { format: "Epub" | "Pdf" })[] =
    book?.files.filter((f): f is BookFileInfo & { format: "Epub" | "Pdf" } => isReadableFormat(f.format)) ?? [];
  // Epub is the fuller in-app reading experience (reflowable, chapters) - preferred when a book
  // has both formats, e.g. after an M8 conversion.
  const preferredReadFile = readableFiles.find((f) => f.format === "Epub") ?? readableFiles[0];

  return (
    <Modal opened onClose={onClose} centered size={560} padding="lg">
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
            </Stack>
          </Group>

          {preferredReadFile && (
            <Button
              size="md"
              variant="filled"
              fullWidth
              leftSection={<IconBook2 size={18} />}
              onClick={() => openReader(preferredReadFile.format)}
            >
              {t("bookDetail.read")}
            </Button>
          )}

          <Stack gap={6}>
            <FieldLabel>{t("bookDetail.readingStatus")}</FieldLabel>
            <SegmentedControl
              size="xs"
              fullWidth
              data={statusOptions}
              value={book.readingStatus}
              onChange={(value) => statusMutation.mutate(value as ReadingStatus)}
              disabled={statusMutation.isPending}
            />
            {progress && progress.totalChapters > 0 && (
              <Text size="xs" c="dimmed">
                {t("bookDetail.progress", {
                  percentage: Math.round(progress.percentage),
                  chapter: progress.currentChapter,
                  totalChapters: progress.totalChapters,
                })}
              </Text>
            )}
          </Stack>

          {book.description && <Text size="sm">{book.description}</Text>}

          <Divider />

          <Group gap="lg">
            {book.publisher && (
              <div>
                <FieldLabel>{t("bookDetail.publisher")}</FieldLabel>
                <Text size="sm">{book.publisher}</Text>
              </div>
            )}
            {book.datePublished && (
              <div>
                <FieldLabel>{t("bookDetail.published")}</FieldLabel>
                <Text size="sm">{book.datePublished}</Text>
              </div>
            )}
            {book.language && (
              <div>
                <FieldLabel>{t("bookDetail.language")}</FieldLabel>
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
              <FieldLabel>{t("bookDetail.collections")}</FieldLabel>
              <Group gap={6} mt={4}>
                {book.collections.map((collection) => (
                  <Badge key={collection.id} variant="outline">
                    {collection.name}
                  </Badge>
                ))}
              </Group>
            </div>
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
                    {/* Only shown when there's an actual choice to make (e.g. both Epub and
                          Pdf) - the single-format case is already covered by the prominent Read
                          button above, so a duplicate link here would just be clutter. */}
                    {readableFiles.length > 1 && isReadableFormat(f.format) && (
                      <Anchor size="sm" component="button" type="button" onClick={() => openReader(f.format as "Epub" | "Pdf")}>
                        <Group gap={4}>
                          <IconBook2 size={14} />
                          {t("bookDetail.read")}
                        </Group>
                      </Anchor>
                    )}
                    <Tooltip label={t("bookDetail.open")}>
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="gray"
                        aria-label={t("bookDetail.open")}
                        onClick={() => window.maktaba.openPath(f.absolutePath)}
                      >
                        <IconExternalLink size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label={t("bookDetail.showInFolder")}>
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="gray"
                        aria-label={t("bookDetail.showInFolder")}
                        onClick={() => window.maktaba.revealInFolder(f.absolutePath)}
                      >
                        <IconFolder size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Group>
              </List.Item>
            ))}
          </List>

          <Divider />

          <Group gap="xs">
            <Button size="sm" variant="default" onClick={() => setEditing(true)}>
              {t("bookDetail.edit")}
            </Button>
            {confirmingRemove ? (
              <Group gap={6}>
                <Text size="xs" c="dimmed">
                  {t("bookDetail.confirmRemove")}
                </Text>
                <Button size="sm" color="red" loading={isRemoving} onClick={() => void handleRemove()}>
                  {t("common.confirm")}
                </Button>
                <Button size="sm" variant="subtle" onClick={() => setConfirmingRemove(false)} disabled={isRemoving}>
                  {t("common.cancel")}
                </Button>
              </Group>
            ) : (
              <Button
                size="sm"
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
      )}
    </Modal>
  );
}
