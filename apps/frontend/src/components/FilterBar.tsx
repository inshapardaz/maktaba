import { Group, Select, Pill, SegmentedControl, Tooltip } from "@mantine/core";
import { IconLayoutGrid, IconList } from "@tabler/icons-react";
import { useLanguage } from "../i18n/LanguageContext";

export type SortKey = "title" | "author" | "dateAdded" | "rating";
export type ViewMode = "grid" | "list";

interface FilterBarProps {
  format: string;
  onFormatChange: (value: string) => void;
  minRating: number;
  onMinRatingChange: (value: number) => void;
  sortKey: SortKey;
  onSortKeyChange: (key: SortKey) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  activeGroupLabel: string | null;
  onClearGroup: () => void;
  searchTerm: string;
  onClearSearch: () => void;
}

const RATING_OPTIONS = [
  { value: "0", label: "" },
  { value: "1", label: "★+" },
  { value: "2", label: "★★+" },
  { value: "3", label: "★★★+" },
  { value: "4", label: "★★★★+" },
  { value: "5", label: "★★★★★" },
];

export function FilterBar({
  format,
  onFormatChange,
  minRating,
  onMinRatingChange,
  sortKey,
  onSortKeyChange,
  viewMode,
  onViewModeChange,
  activeGroupLabel,
  onClearGroup,
  searchTerm,
  onClearSearch,
}: FilterBarProps) {
  const { t } = useLanguage();

  const formatOptions = [
    { value: "", label: t("filterBar.allFormats") },
    { value: "Epub", label: "EPUB" },
    { value: "Pdf", label: "PDF" },
  ];

  const ratingOptions = RATING_OPTIONS.map((option) =>
    option.value === "0" ? { ...option, label: t("filterBar.anyRating") } : option,
  );

  const sortOptions: { value: SortKey; label: string }[] = [
    { value: "title", label: t("toolbar.sortTitle") },
    { value: "author", label: t("toolbar.sortAuthor") },
    { value: "dateAdded", label: t("toolbar.sortDateAdded") },
    { value: "rating", label: t("toolbar.sortRating") },
  ];

  return (
    <Group
      px="md"
      py="sm"
      gap="sm"
      wrap="wrap"
      justify="space-between"
      style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
    >
      <Group gap="sm" wrap="wrap">
        <Select
          w={140}
          data={formatOptions}
          value={format}
          onChange={(value) => onFormatChange(value ?? "")}
          allowDeselect={false}
        />

        <Select
          w={140}
          data={ratingOptions}
          value={String(minRating)}
          onChange={(value) => onMinRatingChange(Number(value ?? 0))}
          allowDeselect={false}
        />

        {/* Sort sits right next to the rating filter it's most related to (both refine how the
            list is narrowed/ordered), rather than living apart in the header's action bar. */}
        <Select
          w={140}
          aria-label={t("toolbar.sortBy")}
          data={sortOptions}
          value={sortKey}
          onChange={(value) => value && onSortKeyChange(value as SortKey)}
          allowDeselect={false}
        />

        {activeGroupLabel && (
          <Pill withRemoveButton onRemove={onClearGroup}>
            {activeGroupLabel}
          </Pill>
        )}

        {/* Free-text search is set via the Spotlight's "Search for '…'" action rather than typed
            live here - this pill is what makes an active search term visible/clearable afterward. */}
        {searchTerm && (
          <Pill withRemoveButton onRemove={onClearSearch}>
            {t("filterBar.searchTerm", { query: searchTerm })}
          </Pill>
        )}
      </Group>

      {/* Right-aligned, directly above the grid/list it controls. Icon-only, with a tooltip
          standing in for the label text. */}
      <SegmentedControl
        size="sm"
        value={viewMode}
        onChange={(value) => onViewModeChange(value as ViewMode)}
        data={[
          {
            value: "grid",
            label: (
              <Tooltip label={t("toolbar.gridLabel")} openDelay={300} withinPortal>
                <Group gap={0} wrap="nowrap" px={4}>
                  <IconLayoutGrid size={15} />
                </Group>
              </Tooltip>
            ),
          },
          {
            value: "list",
            label: (
              <Tooltip label={t("toolbar.listLabel")} openDelay={300} withinPortal>
                <Group gap={0} wrap="nowrap" px={4}>
                  <IconList size={15} />
                </Group>
              </Tooltip>
            ),
          },
        ]}
      />
    </Group>
  );
}
