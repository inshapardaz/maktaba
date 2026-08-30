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
  Menu,
  Modal,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconBook2,
  IconCheck,
  IconChevronDown,
  IconFolder,
  IconExternalLink,
  IconPencil,
  IconPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import {
  getBook,
  addBookFile,
  deleteBook,
  coverUrl,
  renameBookFile,
  updateBookStatus,
  getReadingProgress,
  pickPreferredReadFile,
  type BookFileInfo,
  type ReadingStatus,
} from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { formatDuration } from "../readingTime";
import { displaySubtitle, displayTitle } from "../issueDisplay";
import { useReaderLauncher } from "../ReaderLauncherContext";
import { BookEditForm } from "./BookEditForm";
import { languageDisplayName } from "./Sidebar";
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
  const launchReader = useReaderLauncher();
  const [isEditing, setEditing] = useState(false);
  const [isRemoving, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [addFileError, setAddFileError] = useState<string | null>(null);

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

  const addFileMutation = useMutation({
    mutationFn: (filePath: string) => addBookFile(bookId, filePath),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["book", bookId] });
      void queryClient.invalidateQueries({ queryKey: ["books"] });
    },
  });

  // Issue #27: rename an attached file's on-disk name so it's identifiable.
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const renameFileMutation = useMutation({
    mutationFn: ({ fileId, fileName }: { fileId: string; fileName: string }) => renameBookFile(bookId, fileId, fileName),
    onSuccess: () => {
      setRenamingFileId(null);
      void queryClient.invalidateQueries({ queryKey: ["book", bookId] });
    },
  });

  const fileName = (absolutePath: string) => absolutePath.split(/[/\\]/).pop() ?? "";

  const fileBaseName = (absolutePath: string) => fileName(absolutePath).replace(/\.[^.]+$/, "");

  const startRenamingFile = (file: BookFileInfo) => {
    setRenamingFileId(file.id);
    setRenameValue(fileBaseName(file.absolutePath));
  };

  const commitRenamingFile = () => {
    const trimmed = renameValue.trim();
    if (renamingFileId && trimmed.length > 0) {
      renameFileMutation.mutate({ fileId: renamingFileId, fileName: trimmed });
    }
  };

  // Sequential (not Promise.all) so one file's failure doesn't abort files already queued behind
  // it, matching ImportDialog.tsx's own queue-processing behavior for its own multi-file picker.
  const handleAddFile = async () => {
    const filePaths = await window.maktaba.pickEbookFiles();
    if (filePaths.length === 0) return;

    setAddFileError(null);
    for (const filePath of filePaths) {
      try {
        await addFileMutation.mutateAsync(filePath);
      } catch (err) {
        setAddFileError(err instanceof Error ? err.message : String(err));
      }
    }
  };

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

  // Routes through the Settings -> Reading preferences (internal vs external app, pop-out window
  // vs in the main window) instead of always opening its own Electron BrowserWindow - see
  // ReaderLauncherContext.tsx / App.tsx's launchReader. Closes this modal first so it isn't left
  // sitting open (or, in "this window" mode, behind the reader taking over the whole window)
  // while the book loads.
  const openReader = (format: "Epub" | "Pdf", absolutePath: string) => {
    onClose();
    launchReader({ bookId, format, title: book && displayTitle(book), absolutePath, readingStatus: book?.readingStatus ?? "Unread" });
  };

  const readableFiles: (BookFileInfo & { format: "Epub" | "Pdf" })[] =
    book?.files.filter((f): f is BookFileInfo & { format: "Epub" | "Pdf" } => isReadableFormat(f.format)) ?? [];
  const preferredReadFile = book ? pickPreferredReadFile(book.files) : undefined;

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
                title={displayTitle(book)}
                author={displaySubtitle(book, t)}
                width={110}
                height={165}
                titleSize={14}
                metaSize={9}
                padding={8}
              />
            )}

            <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
              <Title order={3}>{displayTitle(book)}</Title>
              <Text c="dimmed">{displaySubtitle(book, t)}</Text>
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
            readableFiles.length > 1 ? (
              <Button.Group>
                <Button
                  size="md"
                  variant="filled"
                  style={{ flex: 1 }}
                  leftSection={<IconBook2 size={18} />}
                  onClick={() => openReader(preferredReadFile.format, preferredReadFile.absolutePath)}
                >
                  {t("bookDetail.read")}
                </Button>
                <Menu position="bottom-end" withinPortal>
                  <Menu.Target>
                    <Button size="md" variant="filled" px="xs" aria-label={t("bookDetail.chooseFormat")}>
                      <IconChevronDown size={18} />
                    </Button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    {readableFiles.map((f) => (
                      <Menu.Item key={f.absolutePath} onClick={() => openReader(f.format, f.absolutePath)}>
                        {f.format} — {fileName(f.absolutePath)}
                      </Menu.Item>
                    ))}
                  </Menu.Dropdown>
                </Menu>
              </Button.Group>
            ) : (
              <Button
                size="md"
                variant="filled"
                fullWidth
                leftSection={<IconBook2 size={18} />}
                onClick={() => openReader(preferredReadFile.format, preferredReadFile.absolutePath)}
              >
                {t("bookDetail.read")}
              </Button>
            )
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
            {book.secondsRead > 0 && (
              <Text size="xs" c="dimmed">
                {book.remainingSeconds != null
                  ? t("bookDetail.timeReadWithRemaining", {
                      timeRead: formatDuration(book.secondsRead, t),
                      remaining: formatDuration(book.remainingSeconds, t),
                    })
                  : t("bookDetail.timeRead", { timeRead: formatDuration(book.secondsRead, t) })}
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
                <Text size="sm">{languageDisplayName(book.language, t)}</Text>
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
            {book.files.map((f) =>
              renamingFileId === f.id ? (
                <List.Item key={f.id}>
                  <Group gap={4} wrap="nowrap">
                    <TextInput
                      size="xs"
                      style={{ flex: 1 }}
                      value={renameValue}
                      autoFocus
                      onChange={(e) => setRenameValue(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRenamingFile();
                        if (e.key === "Escape") setRenamingFileId(null);
                      }}
                    />
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="green"
                      loading={renameFileMutation.isPending}
                      disabled={renameValue.trim().length === 0}
                      onClick={commitRenamingFile}
                      aria-label={t("common.save")}
                    >
                      <IconCheck size={14} />
                    </ActionIcon>
                    <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => setRenamingFileId(null)} aria-label={t("common.cancel")}>
                      <IconX size={14} />
                    </ActionIcon>
                  </Group>
                </List.Item>
              ) : (
                <List.Item key={f.id}>
                  <Group justify="space-between" wrap="nowrap">
                    <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
                      <Text size="sm" truncate="end">
                        {fileName(f.absolutePath)}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {f.format} — {(f.fileSizeBytes / 1024).toFixed(0)} KB
                      </Text>
                    </Stack>
                    <Group gap={4}>
                      <Tooltip label={t("bookDetail.renameFile")}>
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          color="gray"
                          aria-label={t("bookDetail.renameFile")}
                          onClick={() => startRenamingFile(f)}
                        >
                          <IconPencil size={14} />
                        </ActionIcon>
                      </Tooltip>
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
              ),
            )}
          </List>

          <Anchor
            size="sm"
            component="button"
            type="button"
            disabled={addFileMutation.isPending}
            onClick={() => void handleAddFile()}
          >
            <Group gap={4}>
              {addFileMutation.isPending ? <Loader size={14} /> : <IconPlus size={14} />}
              {t("bookDetail.addFile")}
            </Group>
          </Anchor>
          {addFileError && (
            <Text size="xs" c="red">
              {addFileError}
            </Text>
          )}

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
