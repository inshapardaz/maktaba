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
import { IconCheck, IconFileUpload, IconFolder, IconUpload, IconX } from "@tabler/icons-react";
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
import { DuplicateDialog } from "./DuplicateDialog";

type ItemStatus = "pending" | "importing" | "converting" | "done" | "error" | "skipped";

interface QueueItem {
  filePath: string;
  status: ItemStatus;
  message?: string;
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
};

const DUPLICATE_ACTION_KEY: Record<DuplicateAction, TranslationKey> = {
  skip: "duplicate.skip",
  merge: "duplicate.addFormat",
  "keep-both": "duplicate.importNew",
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
  const [pendingDuplicate, setPendingDuplicate] = useState<{ filePath: string; info: DuplicateBookInfo } | null>(null);
  const duplicateResolverRef = useRef<((action: DuplicateAction | "cancel") => void) | null>(null);
  const processingRef = useRef(false);
  const cancelledRef = useRef(false);
  const mountedRef = useRef(true);
  // Set once the user checks "apply to all remaining duplicates" - a ref (not just state) because
  // an in-flight runQueue loop closure needs to see the latest value immediately, the same reason
  // cancelledRef/processingRef are refs rather than state.
  const applyToAllRef = useRef<DuplicateAction | null>(null);
  const [applyToAllAction, setApplyToAllAction] = useState<DuplicateAction | null>(null);

  const capabilitiesQuery = useQuery({ queryKey: ["systemCapabilities"], queryFn: getSystemCapabilities });
  const calibreAvailable = capabilitiesQuery.data?.calibreAvailable ?? false;

  useEffect(() => {
    convertFormatRef.current = convertFormat;
  }, [convertFormat]);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

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

  function askUserForDuplicateAction(filePath: string, info: DuplicateBookInfo): Promise<DuplicateAction | "cancel"> {
    if (applyToAllRef.current) {
      return Promise.resolve(applyToAllRef.current);
    }
    return new Promise((resolve) => {
      duplicateResolverRef.current = resolve;
      if (mountedRef.current) {
        setPendingDuplicate({ filePath, info });
      }
    });
  }

  function resolveDuplicate(action: DuplicateAction | "cancel", applyToAll: boolean) {
    if (mountedRef.current) {
      setPendingDuplicate(null);
    }
    if (applyToAll && action !== "cancel") {
      applyToAllRef.current = action;
      if (mountedRef.current) {
        setApplyToAllAction(action);
      }
    }
    duplicateResolverRef.current?.(action);
    duplicateResolverRef.current = null;
  }

  function clearApplyToAll() {
    applyToAllRef.current = null;
    setApplyToAllAction(null);
  }

  async function processOne(item: QueueItem) {
    updateItem(item.filePath, { status: "importing" });
    let action: DuplicateAction | undefined;
    let bookId: string | undefined;

    for (;;) {
      try {
        const result = await importBook(item.filePath, action);
        bookId = result.id;
        break;
      } catch (err) {
        if (err instanceof DuplicateBookError) {
          const choice = await askUserForDuplicateAction(item.filePath, err.duplicate);
          if (choice === "cancel") {
            cancelledRef.current = true;
            updateItem(item.filePath, { status: "skipped" });
            return;
          }
          action = choice;
          continue;
        }
        updateItem(item.filePath, { status: "error", message: err instanceof Error ? err.message : String(err) });
        return;
      }
    }

    if (convertFormatRef.current !== "none" && bookId) {
      updateItem(item.filePath, { status: "converting" });
      try {
        await convertBook(bookId, convertFormatRef.current);
      } catch (err) {
        updateItem(item.filePath, { status: "done", message: err instanceof Error ? err.message : String(err) });
        return;
      }
    }

    updateItem(item.filePath, { status: "done" });
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
      if (cancelledRef.current) {
        queueRef.current = queueRef.current.map((item) =>
          item.status === "pending" ? { ...item, status: "skipped" as const } : item,
        );
        commit();
        break;
      }

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
    cancelledRef.current = false;
    // A fresh batch always starts by asking again, rather than silently reusing whatever
    // resolution the previous batch's duplicates were bulk-applied with.
    clearApplyToAll();
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
    <>
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

          {applyToAllAction && (
            <Group
              justify="space-between"
              wrap="nowrap"
              px="sm"
              py={6}
              style={{
                border: "1px solid var(--mantine-color-default-border)",
                borderRadius: "var(--mantine-radius-sm)",
                backgroundColor: "var(--mantine-color-default-hover)",
              }}
            >
              <Text size="xs" c="dimmed">
                {t("importDialog.applyingToAll", { action: t(DUPLICATE_ACTION_KEY[applyToAllAction]) })}
              </Text>
              <Button size="xs" variant="subtle" onClick={clearApplyToAll}>
                {t("importDialog.clearApplyToAll")}
              </Button>
            </Group>
          )}

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
              <Stack gap={6}>
                {queue.map((item) => (
                  <Group key={item.filePath} justify="space-between" wrap="nowrap" gap="sm">
                    <Box style={{ minWidth: 0, flex: 1 }}>
                      <Text size="sm" fw={500} truncate="end" title={item.filePath}>
                        {fileNameOf(item.filePath)}
                      </Text>
                      {item.message ? (
                        <Text size="xs" c={item.status === "error" ? "red" : "dimmed"} truncate="end" title={item.message}>
                          {item.message}
                        </Text>
                      ) : (
                        dirNameOf(item.filePath) && (
                          <Text size="xs" c="dimmed" truncate="end" title={item.filePath}>
                            {dirNameOf(item.filePath)}
                          </Text>
                        )
                      )}
                    </Box>
                    <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                      <Text size="xs" c="dimmed">
                        {t(STATUS_KEY[item.status])}
                      </Text>
                      <StatusIcon status={item.status} />
                    </Group>
                  </Group>
                ))}
              </Stack>
            )}
          </ScrollArea.Autosize>

          <Group justify="flex-end">
            <Button
              leftSection={<IconUpload size={14} />}
              variant="default"
              onClick={() => void handleBrowse()}
              disabled={isProcessing || isResolving}
            >
              {t("importDialog.browse")}
            </Button>
            <Button
              leftSection={<IconFolder size={14} />}
              variant="default"
              onClick={() => void handleBrowseFolder()}
              disabled={isProcessing || isResolving}
              loading={isResolving}
            >
              {t("importDialog.importFolder")}
            </Button>
            <Button onClick={onClose}>{t("importDialog.close")}</Button>
          </Group>
        </Stack>
      </Modal>

      {pendingDuplicate && (
        <DuplicateDialog filePath={pendingDuplicate.filePath} info={pendingDuplicate.info} onResolve={resolveDuplicate} />
      )}
    </>
  );
}
