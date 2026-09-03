import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import {
  ActionIcon,
  Alert,
  Anchor,
  Avatar,
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
  Rating,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconBook,
  IconBook2,
  IconBookmark,
  IconBuildingStore,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconFolder,
  IconExternalLink,
  IconLanguage,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUser,
  IconX,
} from "../icons";
import {
  getBook,
  addBookFile,
  authorImageUrl,
  deleteBook,
  deleteBookFile,
  coverUrl,
  listTags,
  renameBookFile,
  updateBook,
  updateBookStatus,
  getReadingProgress,
  pickPreferredReadFile,
  type BookFileInfo,
  type ReadingStatus,
} from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { formatDuration } from "../readingTime";
import { displaySubtitle, displayTitle } from "../issueDisplay";
import { invalidateLibraryQueries } from "../queries";
import { READING_STATUS_COLOR, READING_STATUS_LABEL_KEY } from "../readingStatus";
import { useReaderLauncher } from "../ReaderLauncherContext";
import { BookEditForm } from "./BookEditForm";
import { languageDisplayName, type GroupFilter } from "./Sidebar";
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

const READING_STATUSES: ReadingStatus[] = ["Unread", "Reading", "Finished"];

function ReadingStatusIcon({ status }: { status: ReadingStatus }) {
  switch (status) {
    case "Unread":
      return <IconBook size={16} />;
    case "Reading":
      return <IconBookmark size={16} />;
    case "Finished":
      return <IconCheck size={16} />;
  }
}

interface BookDetailPanelProps {
  bookId: string;
  onClose: () => void;
  onRemoved: () => void;
  // Issue #62: clicking an author/tag/collection pill below closes this panel and hands the
  // corresponding filter up to App.tsx's handleSelectFilter, same as picking one from the sidebar.
  onSelectFilter: (filter: GroupFilter) => void;
}

export function BookDetailPanel({ bookId, onClose, onRemoved, onSelectFilter }: BookDetailPanelProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const launchReader = useReaderLauncher();
  // Tags aren't given ids on BookDetailDto (just plain name strings) - resolved against the
  // sidebar's already-cached ["tags"] list (BrowseGroup rows do have ids) by name instead of adding
  // a backend field just for this. A tag renamed/removed since that list was last fetched simply
  // won't be clickable (handleTagClick below no-ops), rather than risk sending a stale id.
  const tagsQuery = useQuery({ queryKey: ["tags"], queryFn: listTags });

  const handleSelectFilter = (filter: GroupFilter) => {
    onClose();
    onSelectFilter(filter);
  };

  const handleTagClick = (tagName: string) => {
    const match = tagsQuery.data?.find((tag) => tag.name.toLowerCase() === tagName.toLowerCase());
    if (match) {
      handleSelectFilter({ kind: "tagId", id: match.id, name: match.name });
    }
  };
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

  // No dedicated rating endpoint (unlike ReadingStatus) - same "fetch full detail, PUT the whole
  // edit request back with just one field changed" pattern as BookList.tsx's inline title rename.
  const ratingMutation = useMutation({
    mutationFn: (rating: number) => {
      if (!book) return Promise.resolve();
      return updateBook(bookId, {
        title: book.title,
        authors: book.authors,
        language: book.language,
        publisher: book.publisher,
        publishedDate: book.datePublished,
        description: book.description,
        rating,
        seriesName: book.seriesName,
        seriesIndex: book.seriesIndex,
        tags: book.tags,
        collectionIds: book.collections.map((c) => c.id),
        periodicalId: book.periodicalId,
        issueNumber: book.issueNumber,
        volumeNumber: book.volumeNumber,
        issueDate: book.issueDate,
      });
    },
    onSuccess: () => {
      invalidateLibraryQueries(queryClient);
      void queryClient.invalidateQueries({ queryKey: ["book", bookId] });
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

  // Refused by the backend if it's the book's only file (see api.ts's deleteBookFile) - the delete
  // button is hidden in that case too, so this only ever fires when there's more than one file.
  const deleteFileMutation = useMutation({
    mutationFn: (fileId: string) => deleteBookFile(bookId, fileId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["book", bookId] });
      void queryClient.invalidateQueries({ queryKey: ["books"] });
    },
    onError: (err) => {
      notifications.show({
        color: "red",
        title: t("bookDetail.deleteFile"),
        message: err instanceof Error ? err.message : String(err),
      });
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
    launchReader({ bookId, format, title: book && displayTitle(book, t), absolutePath, readingStatus: book?.readingStatus ?? "Unread" });
  };

  const readableFiles: (BookFileInfo & { format: "Epub" | "Pdf" })[] =
    book?.files.filter((f): f is BookFileInfo & { format: "Epub" | "Pdf" } => isReadableFormat(f.format)) ?? [];
  const preferredReadFile = book ? pickPreferredReadFile(book.files) : undefined;

  // Combines the chapter-progress and time-read lines into the one compact stats line shown
  // alongside the reading-status icons, rather than each getting its own row.
  const statsLine = book
    ? [
      progress && progress.totalChapters > 0
        ? t("bookDetail.progress", {
          percentage: Math.round(progress.percentage),
          chapter: progress.currentChapter,
          totalChapters: progress.totalChapters,
        })
        : null,
      book.secondsRead > 0
        ? book.remainingSeconds != null
          ? t("bookDetail.timeReadWithRemaining", {
            timeRead: formatDuration(book.secondsRead, t),
            remaining: formatDuration(book.remainingSeconds, t),
          })
          : t("bookDetail.timeRead", { timeRead: formatDuration(book.secondsRead, t) })
        : null,
    ]
      .filter(Boolean)
      .join(" · ")
    : "";

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
                title={displayTitle(book, t)}
                author={displaySubtitle(book, t)}
                width={110}
                height={165}
                titleSize={14}
                metaSize={9}
                padding={8}
              />
            )}

            <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
              <Title order={3} style={{ minWidth: 0 }}>
                {displayTitle(book, t)}
              </Title>
              {book.periodicalId ? (
                <>
                  <Text c="dimmed">{displaySubtitle(book, t)}</Text>
                  {(book.volumeNumber != null || book.issueNumber != null) && (
                    <Text size="sm" c="dimmed">
                      {[
                        book.volumeNumber != null ? t("periodicalDetail.volumeShort", { number: book.volumeNumber }) : null,
                        book.issueNumber != null ? t("periodicalDetail.issueShort", { number: book.issueNumber }) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  )}
                </>
              ) : book.authorRefs.length > 0 ? (
                <Group gap="sm">
                  {book.authorRefs.map((author) => (
                    <UnstyledButton
                      key={author.id}
                      onClick={() => handleSelectFilter({ kind: "authorId", id: author.id, name: author.name })}
                    >
                      <Group gap={6} wrap="nowrap">
                        <Avatar src={author.hasImage ? authorImageUrl(author.id) : null} size={36} radius="xl">
                          <IconUser size={18} />
                        </Avatar>
                        <Text fw={500}>{author.name}</Text>
                      </Group>
                    </UnstyledButton>
                  ))}
                </Group>
              ) : (
                <Text c="dimmed">{t("common.unknownAuthor")}</Text>
              )}
              <Rating value={book.rating} onChange={(value) => ratingMutation.mutate(value)} readOnly={ratingMutation.isPending} />
              {book.seriesName && (
                <Text size="sm">
                  {book.seriesName}
                  {book.seriesIndex != null ? ` #${book.seriesIndex}` : ""}
                </Text>
              )}
              <Group justify="space-between" wrap="wrap" align="center" gap="sm">
                <ActionIcon.Group>
                  {READING_STATUSES.map((status) => (
                    <Tooltip key={status} label={t(READING_STATUS_LABEL_KEY[status])} withinPortal>
                      <ActionIcon
                        size="md"
                        variant={book.readingStatus === status ? "filled" : "default"}
                        color={READING_STATUS_COLOR[status]}
                        aria-label={t(READING_STATUS_LABEL_KEY[status])}
                        disabled={statusMutation.isPending}
                        onClick={() => statusMutation.mutate(status)}
                      >
                        <ReadingStatusIcon status={status} />
                      </ActionIcon>
                    </Tooltip>
                  ))}
                </ActionIcon.Group>
              </Group>
              {statsLine && (
                <Text size="xs" c="dimmed">
                  {statsLine}
                </Text>
              )}
              {book.description && (
                <Text size="sm" lineClamp={4}>
                  {book.description}
                </Text>
              )}
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


          <Divider />
          <Stack gap={4}>
            {book.publisher && (
              <Group gap={6} wrap="nowrap">
                <IconBuildingStore size={16} color="var(--mantine-color-dimmed)" />
                <Text size="sm">{book.publisher}</Text>
              </Group>
            )}
            {book.datePublished && (
              <Group gap={6} wrap="nowrap">
                <IconCalendar size={16} color="var(--mantine-color-dimmed)" />
                <Text size="sm">{book.datePublished}</Text>
              </Group>
            )}
            {book.language && (
              <Group gap={6} wrap="nowrap">
                <IconLanguage size={16} color="var(--mantine-color-dimmed)" />
                <Text size="sm">{languageDisplayName(book.language, t)}</Text>
              </Group>
            )}
          </Stack>

          {book.tags.length > 0 && (
            <Group gap={6}>
              {book.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="light"
                  component="button"
                  onClick={() => handleTagClick(tag)}
                  style={{ cursor: "pointer" }}
                >
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
                  <Badge
                    key={collection.id}
                    variant="outline"
                    component="button"
                    onClick={() => handleSelectFilter({ kind: "collectionId", id: collection.id, name: collection.name })}
                    style={{ cursor: "pointer" }}
                  >
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
                      {book.files.length > 1 && (
                        <Tooltip label={t("bookDetail.deleteFile")}>
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            color="red"
                            aria-label={t("bookDetail.deleteFile")}
                            loading={deleteFileMutation.isPending && deleteFileMutation.variables === f.id}
                            disabled={deleteFileMutation.isPending}
                            onClick={() => deleteFileMutation.mutate(f.id)}
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Tooltip>
                      )}
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
