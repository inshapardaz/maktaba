import { Box, Group, NavLink, ScrollArea, Text, UnstyledButton } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { IconBooks, IconSettings } from "@tabler/icons-react";
import {
  listAuthors,
  listCollections,
  listReadingStatusCounts,
  listSeries,
  listTags,
  type BrowseGroup,
  type ReadingStatus,
} from "../api";
import { useLanguage } from "../i18n/LanguageContext";

export type GroupFilterKind = "authorId" | "seriesId" | "tagId" | "collectionId" | "readingStatus";

export interface GroupFilter {
  kind: GroupFilterKind;
  id: string;
  name: string;
}

export type MainView = "library" | "settings" | "authors" | "collections" | "tags";

// Sidebar rows for these two groups are capped so a library with hundreds of authors or
// collections doesn't turn the navbar into an unusable scroll — the full list lives in
// AuthorsView/CollectionsView, opened via "See all".
const SIDEBAR_GROUP_LIMIT = 5;

function topByBookCount(groups: BrowseGroup[] | undefined): BrowseGroup[] {
  if (!groups) return [];
  return [...groups].sort((a, b) => b.bookCount - a.bookCount).slice(0, SIDEBAR_GROUP_LIMIT);
}

interface SidebarProps {
  activeFilter: GroupFilter | null;
  onSelect: (filter: GroupFilter | null) => void;
  mainView: MainView;
  onShowAllBooks: () => void;
  onOpenSettings: () => void;
  onOpenAuthors: () => void;
  onOpenCollections: () => void;
  onOpenTags: () => void;
}

function sectionRowStyles(isActive: boolean) {
  return {
    root: {
      borderRadius: "var(--mantine-radius-sm)",
      ...(isActive
        ? {
            backgroundColor: "var(--mantine-primary-color-1)",
            color: "var(--mantine-primary-color-7)",
          }
        : {}),
    },
    label: { fontWeight: isActive ? 600 : 400 },
  };
}

function SectionTitle({ children, action }: { children: string; action?: React.ReactNode }) {
  return (
    <Group justify="space-between" px="md" py={4} wrap="nowrap">
      <Text fz={10.5} fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.1em" }}>
        {children}
      </Text>
      {action}
    </Group>
  );
}

function GroupSection({
  title,
  kind,
  activeFilter,
  onSelect,
  groups,
  action,
}: {
  title: string;
  kind: GroupFilterKind;
  activeFilter: GroupFilter | null;
  onSelect: (filter: GroupFilter | null) => void;
  groups: BrowseGroup[] | undefined;
  action?: React.ReactNode;
}) {
  if (!groups || (groups.length === 0 && !action)) {
    return null;
  }

  return (
    <Box mb="var(--mantine-spacing-lg)">
      <SectionTitle action={action}>{title}</SectionTitle>
      {groups.map((group) => {
        const isActive = activeFilter?.kind === kind && activeFilter.id === group.id;
        return (
          <NavLink
            key={group.id}
            label={group.name}
            active={isActive}
            onClick={() => onSelect(isActive ? null : { kind, id: group.id, name: group.name })}
            rightSection={
              <Text size="xs" c="dimmed">
                {group.bookCount}
              </Text>
            }
            px="md"
            py={5}
            styles={sectionRowStyles(isActive)}
          />
        );
      })}
    </Box>
  );
}

function ReadingStatusSection({
  activeFilter,
  onSelect,
}: {
  activeFilter: GroupFilter | null;
  onSelect: (filter: GroupFilter | null) => void;
}) {
  const { t } = useLanguage();
  const statusQuery = useQuery({ queryKey: ["readingStatusCounts"], queryFn: listReadingStatusCounts });

  const labels: Record<ReadingStatus, string> = {
    Unread: t("readingStatus.unread"),
    Reading: t("readingStatus.reading"),
    Finished: t("readingStatus.finished"),
  };

  if (!statusQuery.data) {
    return null;
  }

  return (
    <Box mb="var(--mantine-spacing-lg)">
      <SectionTitle>{t("sidebar.readingStatus")}</SectionTitle>
      {statusQuery.data.map(({ status, count }) => {
        const isActive = activeFilter?.kind === "readingStatus" && activeFilter.id === status;
        return (
          <NavLink
            key={status}
            label={labels[status]}
            active={isActive}
            onClick={() => onSelect(isActive ? null : { kind: "readingStatus", id: status, name: labels[status] })}
            rightSection={
              <Text size="xs" c="dimmed">
                {count}
              </Text>
            }
            px="md"
            py={5}
            styles={sectionRowStyles(isActive)}
          />
        );
      })}
    </Box>
  );
}

export function Sidebar({
  activeFilter,
  onSelect,
  mainView,
  onShowAllBooks,
  onOpenSettings,
  onOpenAuthors,
  onOpenCollections,
  onOpenTags,
}: SidebarProps) {
  const { t } = useLanguage();
  const authorsQuery = useQuery({ queryKey: ["authors"], queryFn: listAuthors });
  const seriesQuery = useQuery({ queryKey: ["series"], queryFn: listSeries });
  const tagsQuery = useQuery({ queryKey: ["tags"], queryFn: listTags });
  const collectionsQuery = useQuery({ queryKey: ["collections"], queryFn: listCollections });

  const seeAllAction = (onClick: () => void) => (
    <UnstyledButton onClick={onClick} fz={10.5} fw={600} c="var(--mantine-primary-color-7)">
      {t("sidebar.seeAll")}
    </UnstyledButton>
  );

  return (
    <Box
      h="100%"
      display="flex"
      style={{ flexDirection: "column", borderInlineEnd: "1px solid var(--mantine-color-default-border)" }}
    >
      <Box p={4}>
        <NavLink
          label={t("toolbar.allBooks")}
          leftSection={<IconBooks size={16} />}
          active={mainView === "library" && !activeFilter}
          onClick={onShowAllBooks}
          px="md"
          py={7}
          styles={sectionRowStyles(mainView === "library" && !activeFilter)}
        />
      </Box>

      <ScrollArea component="nav" py="var(--mantine-spacing-lg)" px={4} style={{ flex: 1 }}>
        <GroupSection
          title={t("sidebar.collections")}
          kind="collectionId"
          activeFilter={activeFilter}
          onSelect={onSelect}
          groups={topByBookCount(collectionsQuery.data)}
          action={seeAllAction(onOpenCollections)}
        />
        <ReadingStatusSection activeFilter={activeFilter} onSelect={onSelect} />
        <GroupSection
          title={t("sidebar.authors")}
          kind="authorId"
          activeFilter={activeFilter}
          onSelect={onSelect}
          groups={topByBookCount(authorsQuery.data)}
          action={seeAllAction(onOpenAuthors)}
        />
        <GroupSection
          title={t("sidebar.series")}
          kind="seriesId"
          activeFilter={activeFilter}
          onSelect={onSelect}
          groups={seriesQuery.data}
        />
        <GroupSection
          title={t("sidebar.tags")}
          kind="tagId"
          activeFilter={activeFilter}
          onSelect={onSelect}
          groups={topByBookCount(tagsQuery.data)}
          action={seeAllAction(onOpenTags)}
        />
      </ScrollArea>

      <Box style={{ borderTop: "1px solid var(--mantine-color-default-border)" }} p={4}>
        <NavLink
          label={t("settings.title")}
          leftSection={<IconSettings size={16} />}
          active={mainView === "settings"}
          onClick={onOpenSettings}
          px="md"
          py={7}
          styles={sectionRowStyles(mainView === "settings")}
        />
      </Box>
    </Box>
  );
}
