import { Group, Select, SegmentedControl, Text, TextInput, Button, Tooltip, Divider } from "@mantine/core";
import { IconLayoutGrid, IconList, IconRefresh, IconSearch, IconUpload } from "@tabler/icons-react";
import { useLanguage } from "../i18n/LanguageContext";
import { ColorSchemeToggle } from "./ColorSchemeToggle";
import { LanguageSwitcher } from "./LanguageSwitcher";

export type SortKey = "title" | "author" | "dateAdded" | "rating";
export type ViewMode = "grid" | "list";

interface ToolbarProps {
  libraryPath: string;
  contextLabel: string;
  search: string;
  onSearchChange: (value: string) => void;
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
  contextLabel,
  search,
  onSearchChange,
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
      h={60}
      wrap="nowrap"
      gap="md"
      px="lg"
      style={{ borderBottom: "1px solid var(--mantine-color-default-border)", overflowX: "auto" }}
    >
      <Text ff="var(--mantine-font-family-headings)" fw={600} fz={22} style={{ flexShrink: 0 }}>
        مکتبہ
      </Text>
      <Divider orientation="vertical" style={{ height: 24, alignSelf: "center", flexShrink: 0 }} />
      <Text fz={13} c="dimmed" style={{ flexShrink: 0 }} truncate="end" maw={220}>
        {contextLabel}
      </Text>

      <div style={{ flex: 1 }} />

      <TextInput
        w={280}
        style={{ flexShrink: 0 }}
        placeholder={t("toolbar.searchPlaceholder")}
        leftSection={<IconSearch size={15} />}
        value={search}
        onChange={(e) => onSearchChange(e.currentTarget.value)}
      />

      <SegmentedControl
        size="sm"
        style={{ flexShrink: 0 }}
        value={viewMode}
        onChange={(value) => onViewModeChange(value as ViewMode)}
        data={[
          {
            value: "grid",
            label: (
              <Group gap={6} wrap="nowrap">
                <IconLayoutGrid size={13} />
                <span>{t("toolbar.gridLabel")}</span>
              </Group>
            ),
          },
          {
            value: "list",
            label: (
              <Group gap={6} wrap="nowrap">
                <IconList size={13} />
                <span>{t("toolbar.listLabel")}</span>
              </Group>
            ),
          },
        ]}
      />

      <LanguageSwitcher />

      <Button leftSection={<IconUpload size={14} />} onClick={onImport} loading={importing} style={{ flexShrink: 0 }}>
        {t("toolbar.import")}
      </Button>

      <Divider orientation="vertical" style={{ height: 24, alignSelf: "center", flexShrink: 0 }} />

      <Tooltip label={t("toolbar.rescanTooltip")}>
        <Button
          variant="subtle"
          size="sm"
          leftSection={<IconRefresh size={14} />}
          onClick={onRescan}
          loading={rescanning}
          style={{ flexShrink: 0 }}
        >
          {t("toolbar.rescan")}
        </Button>
      </Tooltip>

      <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
        {t(bookCount === 1 ? "toolbar.bookCount_one" : "toolbar.bookCount_other", { count: bookCount })}
      </Text>

      <Select
        size="sm"
        w={130}
        style={{ flexShrink: 0 }}
        aria-label={t("toolbar.sortBy")}
        value={sortKey}
        onChange={(value) => value && onSortKeyChange(value as SortKey)}
        data={sortOptions}
        allowDeselect={false}
      />

      <ColorSchemeToggle />

      <Text size="xs" c="dimmed" ff="monospace" truncate="end" maw={160} title={libraryPath} style={{ flexShrink: 0 }}>
        {libraryPath}
      </Text>
    </Group>
  );
}
