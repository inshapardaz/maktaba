import { Affix, Badge, Loader, Text, UnstyledButton } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useLanguage } from "../i18n/LanguageContext";
import { useImportQueue } from "../ImportContext";

// Surfaces that the import queue is still draining (or scanning a folder) while its dialog is
// closed - issue #25's "allow the scan to continue in background" is otherwise invisible, since
// nothing else on screen would tell the user an import is still happening. Clicking reopens the
// dialog; hidden entirely once nothing is left running or waiting on a decision.
export function ImportBackgroundIndicator() {
  const { t } = useLanguage();
  const { queue, isOpen, isProcessing, isResolving, summary, open } = useImportQueue();

  if (isOpen) {
    return null;
  }

  const hasConflicts = summary.conflicted > 0;
  if (!isProcessing && !isResolving && !hasConflicts) {
    return null;
  }

  const completed = queue.filter((i) => i.status === "done" || i.status === "error" || i.status === "skipped").length;

  return (
    <Affix position={{ bottom: 16, right: 16 }} zIndex={900}>
      <UnstyledButton
        onClick={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 14px",
          borderRadius: "var(--mantine-radius-md)",
          backgroundColor: "var(--mantine-color-body)",
          border: "1px solid var(--mantine-color-default-border)",
          boxShadow: "var(--mantine-shadow-md)",
        }}
      >
        {isProcessing || isResolving ? <Loader size={16} /> : <IconAlertTriangle size={16} color="var(--mantine-color-orange-6)" />}
        <Text size="sm">
          {isResolving ? t("importDialog.resolving") : t("importDialog.backgroundProgress", { done: completed, total: queue.length })}
        </Text>
        {hasConflicts && (
          <Badge size="sm" color="orange" variant="light">
            {summary.conflicted}
          </Badge>
        )}
      </UnstyledButton>
    </Affix>
  );
}
