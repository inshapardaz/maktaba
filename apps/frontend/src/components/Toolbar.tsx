import { Group, Select, SegmentedControl, Text, Button, Tooltip } from "@mantine/core";
import { IconLayoutGrid, IconList, IconRefresh, IconUpload } from "@tabler/icons-react";
import { useLanguage } from "../i18n/LanguageContext";
import { ColorSchemeToggle } from "./ColorSchemeToggle";
import { LanguageSwitcher } from "./LanguageSwitcher";

export type SortKey = "title" | "author" | "dateAdded" | "rating";
export type ViewMode = "grid" | "list";

interface ToolbarProps {
  libraryPath: string;
  sortKey: SortKey;
  onSortKeyChange: (key: SortKey) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onImport: () => void;
  importing: boolean;
  onRescan: () => void;
  rescanning: boolean;
  bookCount: number;
}

export function Toolbar({
  libraryPath,
  sortKey,
  onSortKeyChange,
  viewMode,
  onViewModeChange,
  onImport,
  importing,
  onRescan,
  rescanning,
  bookCount,
}: ToolbarProps) {
  const { t } = useLanguage();

  const sortOptions: { value: SortKey; label: string }[] = [
    { value: "title", label: t("toolbar.sortTitle") },
    { value: "author", label: t("toolbar.sortAuthor") },
    { value: "dateAdded", label: t("toolbar.sortDateAdded") },
    { value: "rating", label: t("toolbar.sortRating") },
  ];

  return (
    <Group
      justify="space-between"
      wrap="wrap"
      gap="md"
      px="md"
      py="sm"
      style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
    >
      <Group gap="md">
        <Button leftSection={<IconUpload size={16} />} onClick={onImport} loading={importing}>
          {t("toolbar.import")}
        </Button>
        <Tooltip label={t("toolbar.rescanTooltip")}>
          <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={onRescan} loading={rescanning}>
            {t("toolbar.rescan")}
          </Button>
        </Tooltip>
        <Text size="sm" c="dimmed">
          {t(bookCount === 1 ? "toolbar.bookCount_one" : "toolbar.bookCount_other", { count: bookCount })}
        </Text>
      </Group>

      <Group gap="md">
        <Group gap={6}>
          <Text size="sm" c="dimmed">
            {t("toolbar.sortBy")}
          </Text>
          <Select
            size="sm"
            w={150}
            aria-label={t("toolbar.sortBy")}
            value={sortKey}
            onChange={(value) => value && onSortKeyChange(value as SortKey)}
            data={sortOptions}
            allowDeselect={false}
          />
        </Group>

        <SegmentedControl
          size="sm"
          value={viewMode}
          onChange={(value) => onViewModeChange(value as ViewMode)}
          data={[
            { value: "grid", label: <IconLayoutGrid size={16} style={{ display: "block" }} /> },
            { value: "list", label: <IconList size={16} style={{ display: "block" }} /> },
          ]}
        />

        <LanguageSwitcher />
        <ColorSchemeToggle />

        <Text size="xs" c="dimmed" ff="monospace" truncate="end" maw={220} title={libraryPath}>
          {libraryPath}
        </Text>
      </Group>
    </Group>
  );
}
