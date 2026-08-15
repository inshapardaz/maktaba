import { useState } from "react";
import {
  Anchor,
  Breadcrumbs,
  Button,
  Group,
  Indicator,
  Pill,
  Popover,
  Select,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconArrowsSort, IconFilter, IconLayoutGrid, IconList } from "@tabler/icons-react";
import { useLanguage } from "../i18n/LanguageContext";
import type { GroupFilter } from "./Sidebar";

export type SortKey = "title" | "author" | "dateAdded" | "rating" | "seriesIndex" | "lastRead";
export type SortDirection = "asc" | "desc";
export type ViewMode = "grid" | "list";

interface FilterBarProps {
  format: string;
  onFormatChange: (value: string) => void;
  minRating: number;
  onMinRatingChange: (value: number) => void;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSortKeyChange: (key: SortKey) => void;
  onSortDirectionChange: (direction: SortDirection) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  groupFilter: GroupFilter | null;
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
  sortDirection,
  onSortKeyChange,
  onSortDirectionChange,
  viewMode,
  onViewModeChange,
  groupFilter,
  onClearGroup,
  searchTerm,
  onClearSearch,
}: FilterBarProps) {
  const { t } = useLanguage();
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  const groupCategoryLabel =
    groupFilter &&
    (groupFilter.kind === "authorId"
      ? t("sidebar.authors")
      : groupFilter.kind === "seriesId"
        ? t("sidebar.series")
        : groupFilter.kind === "tagId"
          ? t("sidebar.tags")
          : groupFilter.kind === "collectionId"
            ? t("sidebar.collections")
            : t("sidebar.readingStatus"));

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
    { value: "seriesIndex", label: t("toolbar.sortSeriesIndex") },
    { value: "lastRead", label: t("toolbar.sortLastRead") },
  ];

  const directionOptions: { value: SortDirection; label: string }[] = [
    { value: "asc", label: t("filterBar.ascending") },
    { value: "desc", label: t("filterBar.descending") },
  ];

  const hasActiveFilter = format !== "" || minRating > 0;

  return (
    <Group
      px="md"
      py="sm"
      gap="sm"
      wrap="wrap"
      justify="space-between"
      style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
    >
      <Group gap="lg" wrap="wrap">
        {/* Replaces the header's old plain-text view title - the root crumb doubles as the
            "clear group filter" action the removed Pill used to provide. */}
        <Breadcrumbs separator="/">
          {groupFilter ? (
            <Anchor component="button" type="button" onClick={onClearGroup} size="sm" fw={600}>
              {t("toolbar.allBooks")}
            </Anchor>
          ) : (
            <Text size="sm" fw={600}>
              {t("toolbar.allBooks")}
            </Text>
          )}
          {groupFilter && (
            <Text size="sm" c="dimmed">
              {groupCategoryLabel}
            </Text>
          )}
          {groupFilter && (
            <Text size="sm" fw={600}>
              {groupFilter.name}
            </Text>
          )}
        </Breadcrumbs>

        {/* Free-text search is set via the Spotlight's "Search for '…'" action rather than typed
            live here - this pill is what makes an active search term visible/clearable afterward. */}
        {searchTerm && (
          <Pill withRemoveButton onRemove={onClearSearch}>
            {t("filterBar.searchTerm", { query: searchTerm })}
          </Pill>
        )}
      </Group>

      {/* Right-aligned, directly above the grid/list it controls - Sort and Filter are compact
          popover-triggered buttons (rather than always-visible inline Selects) so this row stays
          short regardless of how many filter dimensions exist. */}
      <Group gap="xs" wrap="wrap">
        <Popover opened={sortOpen} onChange={setSortOpen} position="bottom-end" shadow="md" withArrow>
          <Popover.Target>
            <Button
              size="xs"
              variant={sortOpen ? "light" : "default"}
              leftSection={<IconArrowsSort size={15} />}
              onClick={() => setSortOpen((o) => !o)}
            >
              {t("toolbar.sortBy")}
            </Button>
          </Popover.Target>
          <Popover.Dropdown miw={280}>
            <Stack gap={4}>
              <Text fz={10.5} fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.08em" }}>
                {t("toolbar.sortBy")}
              </Text>
              <Group gap="xs" wrap="nowrap">
                <Select
                  style={{ flex: 1 }}
                  data={sortOptions}
                  value={sortKey}
                  onChange={(value) => value && onSortKeyChange(value as SortKey)}
                  allowDeselect={false}
                  comboboxProps={{ withinPortal: false }}
                />
                <Select
                  w={140}
                  data={directionOptions}
                  value={sortDirection}
                  onChange={(value) => value && onSortDirectionChange(value as SortDirection)}
                  allowDeselect={false}
                  comboboxProps={{ withinPortal: false }}
                />
              </Group>
            </Stack>
          </Popover.Dropdown>
        </Popover>

        <Popover opened={filterOpen} onChange={setFilterOpen} position="bottom-end" shadow="md" withArrow>
          <Popover.Target>
            <Indicator disabled={!hasActiveFilter} size={8} offset={4} color="red" withBorder>
              <Button
                size="xs"
                variant={filterOpen ? "light" : "default"}
                leftSection={<IconFilter size={15} />}
                onClick={() => setFilterOpen((o) => !o)}
              >
                {t("toolbar.filter")}
              </Button>
            </Indicator>
          </Popover.Target>
          <Popover.Dropdown miw={220}>
            <Stack gap="sm">
              <Text fz={10.5} fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.08em" }}>
                {t("toolbar.filter")}
              </Text>
              <Select
                data={formatOptions}
                value={format}
                onChange={(value) => onFormatChange(value ?? "")}
                allowDeselect={false}
                comboboxProps={{ withinPortal: false }}
              />
              <Select
                data={ratingOptions}
                value={String(minRating)}
                onChange={(value) => onMinRatingChange(Number(value ?? 0))}
                allowDeselect={false}
                comboboxProps={{ withinPortal: false }}
              />
            </Stack>
          </Popover.Dropdown>
        </Popover>

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
    </Group>
  );
}
