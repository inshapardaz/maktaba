import { Group, Loader, Progress, Text } from "@mantine/core";
import { useLanguage } from "../i18n/LanguageContext";
import { useRescan } from "../RescanContext";

// Matches ImportStatusBar's height-export pattern - App.tsx adds this to AppShell's header height
// whenever the bar is showing.
export const RESCAN_STATUS_BAR_HEIGHT = 32;

// Shown under the title bar (see App.tsx) whenever a library resync (started from Settings ->
// Libraries) is running and the Settings modal that started it isn't open to show its own inline
// progress - without this, closing Settings mid-resync left no indication anywhere that a resync
// was still going, since RescanContext keeps it running but nothing surfaced its progress.
export function RescanStatusBar() {
  const { t } = useLanguage();
  const { libraryName, progress } = useRescan();

  return (
    <Group
      h={RESCAN_STATUS_BAR_HEIGHT}
      px="md"
      gap="sm"
      wrap="nowrap"
      style={{
        borderBottom: "1px solid var(--mantine-color-default-border)",
        backgroundColor: "var(--mantine-color-body)",
      }}
    >
      <Loader size={14} />
      <Text size="xs" style={{ flexShrink: 0 }}>
        {t("librariesSettings.resyncingBar", { name: libraryName ?? "" })}
      </Text>
      <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
        {progress && progress.total > 0
          ? t("settings.rescanProgress", { processed: progress.processed, total: progress.total })
          : t("settings.rescanStarting")}
      </Text>
      <Progress
        value={progress && progress.total > 0 ? (progress.processed / progress.total) * 100 : 0}
        size="sm"
        animated={!progress?.total}
        style={{ flex: 1, maxWidth: 240 }}
      />
    </Group>
  );
}
