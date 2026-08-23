import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Box,
  Button,
  Group,
  Loader,
  Modal,
  Progress,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconAlertTriangle, IconCheck, IconFileUpload, IconFolder, IconX } from "@tabler/icons-react";
import {
  convertBook,
  DuplicateBookError,
  getSystemCapabilities,
  importBook,
  type DuplicateAction,
  type DuplicateBookInfo,
} from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import type { TranslationKey } from "../i18n/translations";
import { getStoredDefaultFormat, type ConvertFormat } from "../convertFormat";

type ItemStatus = "pending" | "importing" | "converting" | "done" | "error" | "skipped" | "conflict";

interface QueueItem {
  filePath: string;
  status: ItemStatus;
  message?: string;
  // Set once the file resolves to a book (new or existing) - lets the queue show the actual book
  // title instead of just the raw file path, so it's clear *what* was added, not just *that*
  // something with this filename finished processing.
  title?: string;
  // Set only while status is "conflict" - the item stays in the list with its resolution choices
  // (skip / add as format / import as new title) rendered inline, rather than a separate blocking
  // modal that pauses the whole batch on one decision.
  duplicate?: DuplicateBookInfo;
}

interface ImportDialogProps {
  initialFiles: string[];
  onClose: () => void;
  onImported: () => void;
}

function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function dirNameOf(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx === -1 ? "" : path.slice(0, idx);
}

const STATUS_KEY: Record<ItemStatus, TranslationKey> = {
  pending: "importDialog.statusPending",
  importing: "importDialog.statusImporting",
  converting: "importDialog.statusConverting",
  done: "importDialog.statusDone",
  error: "importDialog.statusError",
  skipped: "importDialog.statusSkipped",
  conflict: "importDialog.statusConflict",
};

function StatusIcon({ status }: { status: ItemStatus }) {
  switch (status) {
    case "importing":
    case "converting":
      return <Loader size={14} />;
    case "done":
      return <IconCheck size={16} color="var(--mantine-color-green-6)" />;
    case "error":
      return <IconX size={16} color="var(--mantine-color-red-6)" />;
    case "skipped":
      return <IconX size={16} color="var(--mantine-color-dimmed)" />;
    case "conflict":
      return <IconAlertTriangle size={16} color="var(--mantine-color-orange-6)" />;
    default:
      return <Box w={16} h={16} />;
  }
}

export function ImportDialog({ initialFiles, onClose, onImported }: ImportDialogProps) {
  const { t } = useLanguage();
  const queueRef = useRef<QueueItem[]>(initialFiles.map((filePath) => ({ filePath, status: "pending" as const })));
  const [queue, setQueue] = useState<QueueItem[]>(queueRef.current);
  const [convertFormat, setConvertFormat] = useState<ConvertFormat>(getStoredDefaultFormat());
  const convertFormatRef = useRef(convertFormat);
  const [isProcessing, setProcessing] = useState(false);
  const [isResolving, setResolving] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ found: number; currentPath: string } | null>(null);
  const [isDragOver, setDragOver] = useState(false);
  const processingRef = useRef(false);
  const mountedRef = useRef(true);

  const capabilitiesQuery = useQuery({ queryKey: ["systemCapabilities"], queryFn: getSystemCapabilities });
  const calibreAvailable = capabilitiesQuery.data?.calibreAvailable ?? false;

  useEffect(() => {
    convertFormatRef.current = convertFormat;
  }, [convertFormat]);

  useEffect(() => {
    // The setup side has to explicitly reset this to true, not just rely on useRef(true)'s initial
    // value - React 18 StrictMode (dev only) simulates mount -> unmount -> remount once on first
    // mount, running this effect's cleanup (which sets it false) and then its setup again *without*
    // an intervening real unmount. Without the reset here, mountedRef.current is left stuck false
    // for the component's entire remaining lifetime in dev mode, silently no-op'ing every setState
    // call gated behind it (commit()'s setQueue, setResolving, setScanProgress).
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(
    () =>
      window.maktaba.onResolveEbookPathsProgress((progress) => {
        if (mountedRef.current) {
          setScanProgress(progress);
        }
      }),
    [],
  );

  function commit() {
    if (mountedRef.current) {
      setQueue([...queueRef.current]);
    }
  }

  function updateItem(filePath: string, patch: Partial<QueueItem>) {
    queueRef.current = queueRef.current.map((item) => (item.filePath === filePath ? { ...item, ...patch } : item));
    commit();
  }

  // action is only passed when re-processing an item the user just resolved from its inline
  // "already exists" choices (skip / add as format / import as new title) - the first attempt for
  // any file always goes through with no resolution picked yet.
  async function processOne(item: QueueItem, action?: DuplicateAction) {
    updateItem(item.filePath, { status: "importing", message: undefined, duplicate: undefined });
    let bookId: string | undefined;
    let bookTitle: string | undefined;

    try {
      const result = await importBook(item.filePath, action);
      bookId = result.id;
      bookTitle = result.title;
    } catch (err) {
      if (err instanceof DuplicateBookError) {
        // Stays in the list as its own status with inline resolution buttons (see the render
        // below) instead of a separate modal - and, importantly, doesn't block runQueue's loop
        // from moving on to the next pending file while this one awaits a decision.
        updateItem(item.filePath, { status: "conflict", duplicate: err.duplicate });
        return;
      }
      updateItem(item.filePath, { status: "error", message: err instanceof Error ? err.message : String(err) });
      return;
    }

    if (convertFormatRef.current !== "none" && bookId) {
      updateItem(item.filePath, { status: "converting" });
      try {
        await convertBook(bookId, convertFormatRef.current);
      } catch (err) {
        updateItem(item.filePath, { status: "done", title: bookTitle, message: err instanceof Error ? err.message : String(err) });
        return;
      }
    }

    // "skip" resolves to the pre-existing book without adding anything new - surfaced as its own
    // status (with an explanatory message) rather than as a plain "Done" indistinguishable from an
    // actual new addition, and it doesn't get the "book added" notification below either.
    if (action === "skip") {
      updateItem(item.filePath, {
        status: "skipped",
        title: bookTitle,
        message: t("duplicate.alreadyInLibrary", { title: bookTitle ?? "" }),
      });
      return;
    }

    updateItem(item.filePath, { status: "done", title: bookTitle });
  }

  // Fires from a conflict item's inline buttons - runs independently of runQueue's main loop
  // (which has already moved on to other pending files by the time the user gets to this), so
  // concurrent resolutions across different items are fine: updateItem only ever touches the one
  // matching filePath.
  function resolveConflict(item: QueueItem, action: DuplicateAction) {
    void processOne(item, action);
  }

  async function runQueue() {
    if (processingRef.current) {
      return;
    }
    processingRef.current = true;
    if (mountedRef.current) {
      setProcessing(true);
    }

    for (;;) {
      const next = queueRef.current.find((item) => item.status === "pending");
      if (!next) {
        break;
      }
      await processOne(next);
    }

    processingRef.current = false;
    if (mountedRef.current) {
      setProcessing(false);
    }
    onImported();
  }

  useEffect(() => {
    void runQueue();
    // Runs once for the dialog's initial file set; files added afterwards are queued via enqueue().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function enqueue(filePaths: string[]) {
    if (filePaths.length === 0) {
      return;
    }
    queueRef.current = [...queueRef.current, ...filePaths.map((filePath) => ({ filePath, status: "pending" as const }))];
    commit();
    void runQueue();
  }

  const handleBrowse = async () => {
    const files = await window.maktaba.pickEbookFiles();
    enqueue(files);
  };

  const handleBrowseFolder = async () => {
    const folders = await window.maktaba.pickEbookFolder();
    if (folders.length === 0) {
      return;
    }
    setResolving(true);
    setScanProgress(null);
    try {
      const files = await window.maktaba.resolveEbookPaths(folders);
      enqueue(files);
    } finally {
      if (mountedRef.current) {
        setResolving(false);
        setScanProgress(null);
      }
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const paths = Array.from(e.dataTransfer.files).map((file) => window.maktaba.getPathForFile(file));
    if (paths.length === 0) {
      return;
    }
    setResolving(true);
    setScanProgress(null);
    try {
      const files = await window.maktaba.resolveEbookPaths(paths);
      enqueue(files);
    } finally {
      if (mountedRef.current) {
        setResolving(false);
        setScanProgress(null);
      }
    }
  };

  const convertOptions = [
    { value: "none", label: t("importDialog.convertNone") },
    { value: "Epub", label: "EPUB" },
    { value: "Pdf", label: "PDF" },
  ];

  const completedCount = queue.filter(
    (item) => item.status === "done" || item.status === "error" || item.status === "skipped",
  ).length;
  const currentItem = queue.find((item) => item.status === "importing" || item.status === "converting");

  return (
    <Modal opened onClose={onClose} title={t("importDialog.title")} size="xl" closeOnClickOutside={false}>
      <Stack gap="md">
        <Box
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          p="xl"
          style={{
            border: `1px dashed ${isDragOver ? "var(--mantine-primary-color-6)" : "var(--mantine-color-default-border)"}`,
            borderRadius: "var(--mantine-radius-md)",
            backgroundColor: isDragOver ? "var(--mantine-primary-color-0)" : "transparent",
            textAlign: "center",
          }}
        >
          <Stack align="center" gap={6}>
            <IconFileUpload size={28} style={{ opacity: 0.6 }} />
            <Text size="sm" c="dimmed">
              {isResolving ? t("importDialog.resolving") : t("importDialog.dropzoneTitle")}
            </Text>
            {isResolving && scanProgress && (
              <Stack gap={0} align="center">
                <Text size="xs" c="dimmed">
                  {t("importDialog.scanFound", { count: scanProgress.found })}
                </Text>
                <Text size="xs" c="dimmed" truncate="end" maw={420} title={scanProgress.currentPath}>
                  {scanProgress.currentPath}
                </Text>
              </Stack>
            )}
            <Group gap={8} mt={4}>
              <Button size="xs" variant="default" onClick={() => void handleBrowse()} disabled={isResolving}>
                {t("importDialog.browse")}
              </Button>
              <Button
                size="xs"
                variant="default"
                leftSection={<IconFolder size={14} />}
                onClick={() => void handleBrowseFolder()}
                disabled={isResolving}
                loading={isResolving}
              >
                {t("importDialog.importFolder")}
              </Button>
            </Group>
          </Stack>
        </Box>

        <Group justify="space-between">
          <Text size="sm">{t("importDialog.convertTo")}</Text>
          <Tooltip label={t("importDialog.calibreUnavailable")} disabled={calibreAvailable || capabilitiesQuery.isLoading}>
            <SegmentedControl
              size="xs"
              data={convertOptions}
              value={convertFormat}
              onChange={(value) => setConvertFormat(value as ConvertFormat)}
              disabled={!capabilitiesQuery.isLoading && !calibreAvailable}
            />
          </Tooltip>
        </Group>

        {queue.length > 0 && (
          <Stack gap={4}>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                {t("importDialog.importProgress", { done: completedCount, total: queue.length })}
              </Text>
              {isProcessing && (
                <Text size="xs" c="dimmed" truncate="end" maw={260} title={fileNameOf(currentItem?.filePath ?? "")}>
                  {currentItem ? fileNameOf(currentItem.filePath) : ""}
                </Text>
              )}
            </Group>
            <Progress value={(completedCount / queue.length) * 100} size="sm" animated={isProcessing} />
          </Stack>
        )}

        <ScrollArea.Autosize mah={320}>
          {queue.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="md">
              {t("importDialog.empty")}
            </Text>
          ) : (
            <Stack gap={10}>
              {queue.map((item) => (
                <Box key={item.filePath}>
                  <Group justify="space-between" wrap="nowrap" gap="sm">
                    <Box style={{ minWidth: 0, flex: 1 }}>
                      <Text size="sm" fw={500} truncate="end" title={item.title ?? item.filePath}>
                        {item.title ?? fileNameOf(item.filePath)}
                      </Text>
                      {item.status === "conflict" && item.duplicate ? (
                        <Text size="xs" c="orange" truncate="end" title={item.duplicate.existingTitle}>
                          {item.duplicate.sameContentHash ? t("duplicate.sameFile") : t("duplicate.sameTitleAuthor")}{" "}
                          {item.duplicate.existingTitle}
                        </Text>
                      ) : item.message ? (
                        <Text size="xs" c={item.status === "error" ? "red" : "dimmed"} truncate="end" title={item.message}>
                          {item.message}
                        </Text>
                      ) : item.title ? (
                        // Once the book's real title is known, the file path moves to the
                        // secondary line instead of disappearing - still available, just no
                        // longer the primary label now that there's a book title to show.
                        <Text size="xs" c="dimmed" truncate="end" title={item.filePath}>
                          {fileNameOf(item.filePath)}
                        </Text>
                      ) : (
                        dirNameOf(item.filePath) && (
                          <Text size="xs" c="dimmed" truncate="end" title={item.filePath}>
                            {dirNameOf(item.filePath)}
                          </Text>
                        )
                      )}
                    </Box>
                    {item.status !== "conflict" && (
                      <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                        <Text size="xs" c="dimmed">
                          {t(STATUS_KEY[item.status])}
                        </Text>
                        <StatusIcon status={item.status} />
                      </Group>
                    )}
                  </Group>
                  {item.status === "conflict" && (
                    <Group gap={6} mt={6}>
                      <Button size="xs" variant="default" onClick={() => resolveConflict(item, "skip")}>
                        {t("duplicate.skip")}
                      </Button>
                      <Button size="xs" variant="default" onClick={() => resolveConflict(item, "merge")}>
                        {t("duplicate.addFormat")}
                      </Button>
                      <Button size="xs" onClick={() => resolveConflict(item, "keep-both")}>
                        {t("duplicate.importNew")}
                      </Button>
                    </Group>
                  )}
                </Box>
              ))}
            </Stack>
          )}
        </ScrollArea.Autosize>

        <Group justify="flex-end">
          <Button onClick={onClose}>{t("importDialog.close")}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
