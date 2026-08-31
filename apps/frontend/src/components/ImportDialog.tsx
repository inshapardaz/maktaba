import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Modal,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconBan,
  IconCheck,
  IconCopy,
  IconEye,
  IconFileUpload,
  IconFolder,
  IconMinus,
  IconRefresh,
  IconStack2,
  IconX,
} from "../icons";
import { getSystemCapabilities, type DuplicateAction } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import type { TranslationKey } from "../i18n/translations";
import { useImportQueue, type ItemStatus } from "../ImportContext";
import type { ConflictPolicy } from "../ImportContext";
import { ExistingBookPopup } from "./ExistingBookPopup";

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
    default:
      return <Box w={16} h={16} />;
  }
}

export function ImportDialog() {
  const { t } = useLanguage();
  const {
    queue,
    isOpen,
    isProcessing,
    isResolving,
    scanProgress,
    convertFormat,
    setConvertFormat,
    conflictPolicy,
    setConflictPolicy,
    summary,
    minimize,
    cancel,
    browseFiles,
    browseFolder,
    dropPaths,
    resolveConflict,
    applyPolicyToAllConflicts,
    retryItem,
  } = useImportQueue();
  const [isDragOver, setDragOver] = useState(false);
  const [viewingBookId, setViewingBookId] = useState<string | null>(null);
  // Clicking a summary badge below filters the list to just that status - clicking the same one
  // again (or "Total") clears it. Purely a display filter, not part of ImportContext's own state.
  const [statusFilter, setStatusFilter] = useState<ItemStatus | null>(null);

  const capabilitiesQuery = useQuery({ queryKey: ["systemCapabilities"], queryFn: getSystemCapabilities });
  const calibreAvailable = capabilitiesQuery.data?.calibreAvailable ?? false;

  if (!isOpen) {
    return null;
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const paths = Array.from(e.dataTransfer.files).map((file) => window.maktaba.getPathForFile(file));
    void dropPaths(paths);
  };

  const convertOptions = [
    { value: "none", label: t("importDialog.convertNone") },
    { value: "Epub", label: "EPUB" },
    { value: "Pdf", label: "PDF" },
  ];

  const conflictOptions: { value: ConflictPolicy; label: string }[] = [
    { value: "ask", label: t("importDialog.conflictPolicyAsk") },
    { value: "skip", label: t("duplicate.skip") },
    { value: "merge", label: t("duplicate.addFormat") },
    { value: "keep-both", label: t("duplicate.importNew") },
  ];

  const completedCount = queue.filter(
    (item) => item.status === "done" || item.status === "error" || item.status === "skipped",
  ).length;
  const currentItem = queue.find((item) => item.status === "importing" || item.status === "converting");
  const visibleQueue = statusFilter ? queue.filter((item) => item.status === statusFilter) : queue;

  const toggleFilter = (status: ItemStatus) => setStatusFilter((current) => (current === status ? null : status));

  return (
    <>
      <Modal
        opened
        onClose={cancel}
        title={
          <Group justify="space-between" wrap="nowrap" gap={4} style={{ width: "100%" }}>
            <Text fw={600}>{t("importDialog.title")}</Text>
            <Tooltip label={t("importDialog.minimize")}>
              <ActionIcon variant="subtle" color="gray" onClick={minimize} aria-label={t("importDialog.minimize")}>
                <IconMinus size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        }
        size="xl"
        closeOnClickOutside={false}
      >
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
                <Button size="xs" variant="default" onClick={() => void browseFiles()} disabled={isResolving}>
                  {t("importDialog.browse")}
                </Button>
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<IconFolder size={14} />}
                  onClick={() => void browseFolder()}
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
                onChange={(value) => setConvertFormat(value as typeof convertFormat)}
                disabled={!capabilitiesQuery.isLoading && !calibreAvailable}
              />
            </Tooltip>
          </Group>

          <Group justify="space-between" wrap="nowrap">
            <Group gap={8} wrap="nowrap">
              <Text size="sm" style={{ flexShrink: 0 }}>
                {t("importDialog.conflictPolicyLabel")}
              </Text>
              <Select
                size="xs"
                data={conflictOptions}
                value={conflictPolicy}
                onChange={(value) => setConflictPolicy((value as ConflictPolicy) ?? "ask")}
                allowDeselect={false}
                w={170}
              />
            </Group>
            {conflictPolicy !== "ask" && summary.conflicted > 0 && (
              <Button size="xs" variant="light" onClick={applyPolicyToAllConflicts}>
                {t("importDialog.applyToAll", { count: summary.conflicted })}
              </Button>
            )}
          </Group>

          {queue.length > 0 && (
            <Stack gap={6}>
              <Group gap={8}>
                <Badge
                  component="button"
                  type="button"
                  variant={statusFilter === null ? "filled" : "light"}
                  color="gray"
                  style={{ cursor: "pointer", border: "none" }}
                  onClick={() => setStatusFilter(null)}
                >
                  {t("importDialog.summaryTotal", { count: summary.total })}
                </Badge>
                <Badge
                  component="button"
                  type="button"
                  variant={statusFilter === "done" ? "filled" : "light"}
                  color="green"
                  style={{ cursor: "pointer", border: "none" }}
                  onClick={() => toggleFilter("done")}
                >
                  {t("importDialog.summaryImported", { count: summary.imported })}
                </Badge>
                <Badge
                  component="button"
                  type="button"
                  variant={statusFilter === "conflict" ? "filled" : "light"}
                  color="orange"
                  style={{ cursor: "pointer", border: "none" }}
                  onClick={() => toggleFilter("conflict")}
                >
                  {t("importDialog.summaryConflicted", { count: summary.conflicted })}
                </Badge>
                <Badge
                  component="button"
                  type="button"
                  variant={statusFilter === "error" ? "filled" : "light"}
                  color="red"
                  style={{ cursor: "pointer", border: "none" }}
                  onClick={() => toggleFilter("error")}
                >
                  {t("importDialog.summaryFailed", { count: summary.failed })}
                </Badge>
              </Group>
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
            ) : visibleQueue.length === 0 ? (
              <Text size="sm" c="dimmed" ta="center" py="md">
                {t("importDialog.noMatchingItems")}
              </Text>
            ) : (
              <Stack gap={10}>
                {visibleQueue.map((item) => (
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
                          {item.status === "error" && (
                            <Tooltip label={t("importDialog.retry")}>
                              <ActionIcon
                                size="sm"
                                variant="subtle"
                                color="gray"
                                onClick={() => retryItem(item.filePath)}
                                aria-label={t("importDialog.retry")}
                              >
                                <IconRefresh size={14} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                          <Text size="xs" c="dimmed">
                            {t(STATUS_KEY[item.status])}
                          </Text>
                          <StatusIcon status={item.status} />
                        </Group>
                      )}
                    </Group>
                    {item.status === "conflict" && item.duplicate && (
                      <Group gap={6} mt={6}>
                        <Tooltip label={t("importDialog.viewExisting")}>
                          <ActionIcon
                            size="md"
                            variant="default"
                            onClick={() => setViewingBookId(item.duplicate!.existingBookId)}
                            aria-label={t("importDialog.viewExisting")}
                          >
                            <IconEye size={15} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label={t("duplicate.skip")}>
                          <ActionIcon
                            size="md"
                            variant="default"
                            onClick={() => resolveConflict(item.filePath, "skip" as DuplicateAction)}
                            aria-label={t("duplicate.skip")}
                          >
                            <IconBan size={15} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label={t("duplicate.addFormat")}>
                          <ActionIcon
                            size="md"
                            variant="default"
                            onClick={() => resolveConflict(item.filePath, "merge" as DuplicateAction)}
                            aria-label={t("duplicate.addFormat")}
                          >
                            <IconStack2 size={15} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label={t("duplicate.importNew")}>
                          <ActionIcon
                            size="md"
                            variant="filled"
                            onClick={() => resolveConflict(item.filePath, "keep-both" as DuplicateAction)}
                            aria-label={t("duplicate.importNew")}
                          >
                            <IconCopy size={15} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    )}
                  </Box>
                ))}
              </Stack>
            )}
          </ScrollArea.Autosize>

          <Group justify="flex-end">
            <Button size="xs" onClick={cancel}>
              {t("importDialog.close")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {viewingBookId && <ExistingBookPopup bookId={viewingBookId} onClose={() => setViewingBookId(null)} />}
    </>
  );
}
