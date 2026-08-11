import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Box,
  Button,
  Group,
  Loader,
  Modal,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconCheck, IconFileUpload, IconUpload, IconX } from "@tabler/icons-react";
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

const STATUS_KEY: Record<ItemStatus, TranslationKey> = {
  pending: "importDialog.statusPending",
  importing: "importDialog.statusImporting",
  converting: "importDialog.statusConverting",
  done: "importDialog.statusDone",
  error: "importDialog.statusError",
  skipped: "importDialog.statusSkipped",
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
  const [isDragOver, setDragOver] = useState(false);
  const [pendingDuplicate, setPendingDuplicate] = useState<{ filePath: string; info: DuplicateBookInfo } | null>(null);
  const duplicateResolverRef = useRef<((action: DuplicateAction | "cancel") => void) | null>(null);
  const processingRef = useRef(false);
  const cancelledRef = useRef(false);
  const mountedRef = useRef(true);

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
    return new Promise((resolve) => {
      duplicateResolverRef.current = resolve;
      if (mountedRef.current) {
        setPendingDuplicate({ filePath, info });
      }
    });
  }

  function resolveDuplicate(action: DuplicateAction | "cancel") {
    if (mountedRef.current) {
      setPendingDuplicate(null);
    }
    duplicateResolverRef.current?.(action);
    duplicateResolverRef.current = null;
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
    queueRef.current = [...queueRef.current, ...filePaths.map((filePath) => ({ filePath, status: "pending" as const }))];
    commit();
    void runQueue();
  }

  const handleBrowse = async () => {
    const files = await window.maktaba.pickEbookFiles();
    enqueue(files);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const paths = Array.from(e.dataTransfer.files)
      .map((file) => window.maktaba.getPathForFile(file))
      .filter((path) => /\.(epub|pdf)$/i.test(path));
    enqueue(paths);
  };

  const convertOptions = [
    { value: "none", label: t("importDialog.convertNone") },
    { value: "Epub", label: "EPUB" },
    { value: "Pdf", label: "PDF" },
  ];

  return (
    <>
      <Modal opened onClose={onClose} title={t("importDialog.title")} size="md">
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
                {t("importDialog.dropzoneTitle")}
              </Text>
              <Button size="xs" variant="default" onClick={() => void handleBrowse()} mt={4}>
                {t("importDialog.browse")}
              </Button>
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

          <ScrollArea.Autosize mah={280}>
            {queue.length === 0 ? (
              <Text size="sm" c="dimmed" ta="center" py="md">
                {t("importDialog.empty")}
              </Text>
            ) : (
              <Stack gap={6}>
                {queue.map((item) => (
                  <Group key={item.filePath} justify="space-between" wrap="nowrap" gap="sm">
                    <Box style={{ minWidth: 0, flex: 1 }}>
                      <Text size="sm" truncate="end" title={item.filePath}>
                        {fileNameOf(item.filePath)}
                      </Text>
                      {item.message && (
                        <Text size="xs" c={item.status === "error" ? "red" : "dimmed"} truncate="end" title={item.message}>
                          {item.message}
                        </Text>
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
              disabled={isProcessing}
            >
              {t("importDialog.browse")}
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
