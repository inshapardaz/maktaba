import { ActionIcon, Group, Loader, Progress, Text, Tooltip } from "@mantine/core";
import { IconAlertTriangle, IconLayoutBottombarExpand, IconX } from "../icons";
import { useLanguage } from "../i18n/LanguageContext";
import { useImportQueue } from "../ImportContext";

// Matches TitleBar's TITLEBAR_HEIGHT export pattern - App.tsx adds this to AppShell's header
// height whenever the bar is showing, so it renders as a second row directly under the title bar
// rather than overlapping content.
export const IMPORT_STATUS_BAR_HEIGHT = 32;

// Shown under the title bar (see App.tsx) whenever the ImportDialog has been minimized rather than
// closed outright - issue #25's "minimized means the main UI should have a bar under the title to
// show the import and its status." Restoring reopens the dialog; the X here cancels the same way
// the dialog's own Close does (see ImportContext.tsx's cancel()), not just re-minimizing.
export function ImportStatusBar() {
  const { t } = useLanguage();
  const { queue, isMinimized, isProcessing, isResolving, scanProgress, summary, open, cancel } = useImportQueue();

  if (!isMinimized) {
    return null;
  }

  const hasConflicts = summary.conflicted > 0;
  if (!isProcessing && !isResolving && !hasConflicts) {
    return null;
  }

  const completed = queue.filter((i) => i.status === "done" || i.status === "error" || i.status === "skipped").length;

  const statusText = isResolving
    ? scanProgress
      ? t("importDialog.scanFound", { count: scanProgress.found })
      : t("importDialog.resolving")
    : isProcessing
      ? t("importDialog.backgroundProgress", { done: completed, total: queue.length })
      : t("importDialog.conflictsNeedAttention", { count: summary.conflicted });

  return (
    <Group
      h={IMPORT_STATUS_BAR_HEIGHT}
      px="md"
      gap="sm"
      wrap="nowrap"
      style={{
        borderBottom: "1px solid var(--mantine-color-default-border)",
        backgroundColor: "var(--mantine-color-body)",
      }}
    >
      {isProcessing || isResolving ? <Loader size={14} /> : <IconAlertTriangle size={16} color="var(--mantine-color-orange-6)" />}
      <Text size="xs" style={{ flexShrink: 0 }}>
        {statusText}
      </Text>
      {queue.length > 0 && !isResolving && (
        <Progress value={(completed / queue.length) * 100} size="sm" animated={isProcessing} style={{ flex: 1, maxWidth: 240 }} />
      )}
      <Group gap={4} wrap="nowrap" ml="auto" style={{ flexShrink: 0 }}>
        <Tooltip label={t("importDialog.restore")}>
          <ActionIcon size="sm" variant="subtle" color="gray" onClick={open} aria-label={t("importDialog.restore")}>
            <IconLayoutBottombarExpand size={15} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t("importDialog.close")}>
          <ActionIcon size="sm" variant="subtle" color="gray" onClick={cancel} aria-label={t("importDialog.close")}>
            <IconX size={15} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}
