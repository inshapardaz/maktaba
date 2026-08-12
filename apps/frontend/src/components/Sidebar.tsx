import { ActionIcon, Badge, Box, Divider, Group, Kbd, NavLink, ScrollArea, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { spotlight } from "@mantine/spotlight";
import {
  IconBookmark,
  IconBooks,
  IconCircleCheck,
  IconCircleDashed,
  IconFolder,
  IconFolderOpen,
  IconPlus,
  IconSearch,
  IconSettings,
  IconStack2,
  IconTag,
  IconUser,
} from "@tabler/icons-react";
import type { Icon } from "@tabler/icons-react";
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

export type MainView = "library" | "authors" | "collections" | "tags" | "series";

// Sidebar rows for these groups are capped so a library with hundreds of authors or collections
// doesn't turn the navbar into an unusable scroll — the full list lives in AuthorsView/
// CollectionsView/TagsView, opened via the chevron.
const SIDEBAR_GROUP_LIMIT = 5;

function topByBookCount(groups: BrowseGroup[] | undefined): BrowseGroup[] {
  if (!groups) return [];
  return [...groups].sort((a, b) => b.bookCount - a.bookCount).slice(0, SIDEBAR_GROUP_LIMIT);
}

interface SidebarProps {
  activeFilter: GroupFilter | null;
  onSelect: (filter: GroupFilter | null) => void;
  mainView: MainView;
  settingsOpen: boolean;
  onShowAllBooks: () => void;
  onOpenSettings: () => void;
  onOpenAuthors: () => void;
  onOpenCollections: () => void;
  onOpenTags: () => void;
  onOpenSeries: () => void;
  onImport: () => void;
}

function sectionRowStyles(isActive: boolean) {
  return {
    root: {
      borderRadius: "var(--mantine-radius-sm)",
      ...(isActive
        ? {
          backgroundColor: "var(--mantine-primary-color-0)",
          color: "var(--mantine-primary-color-7)",
        }
        : {}),
    },
    label: { fontWeight: isActive ? 600 : 500, fontSize: "var(--mantine-font-size-xs)" },
  };
}

function SectionTitle({ children, action }: { children: string; action?: React.ReactNode }) {
  return (
    <Group justify="space-between" px="md" mb={5} wrap="nowrap">
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
  icon: RowIcon,
  activeFilter,
  onSelect,
  groups,
  action,
}: {
  title: string;
  kind: GroupFilterKind;
  icon: Icon;
  activeFilter: GroupFilter | null;
  onSelect: (filter: GroupFilter | null) => void;
  groups: BrowseGroup[] | undefined;
  action?: React.ReactNode;
}) {
  if (!groups || (groups.length === 0 && !action)) {
    return null;
  }

  return (
    <Box py="sm" px={4} style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
      <SectionTitle action={action}>{title}</SectionTitle>
      {groups.map((group) => {
        const isActive = activeFilter?.kind === kind && activeFilter.id === group.id;
        return (
          <NavLink
            key={group.id}
            label={group.name}
            leftSection={<RowIcon size={16} stroke={1.5} />}
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

function MainLinksSection({
  mainView,
  activeFilter,
  onSelect,
  onShowAllBooks,
}: {
  mainView: MainView;
  activeFilter: GroupFilter | null;
  onSelect: (filter: GroupFilter | null) => void;
  onShowAllBooks: () => void;
}) {
  const { t } = useLanguage();
  const statusQuery = useQuery({ queryKey: ["readingStatusCounts"], queryFn: listReadingStatusCounts });

  const labels: Record<ReadingStatus, string> = {
    Unread: t("readingStatus.unread"),
    Reading: t("readingStatus.reading"),
    Finished: t("readingStatus.finished"),
  };

  const icons: Record<ReadingStatus, Icon> = {
    Unread: IconCircleDashed,
    Reading: IconBookmark,
    Finished: IconCircleCheck,
  };

  const totalBooks = statusQuery.data?.reduce((sum, s) => sum + s.count, 0);
  const allBooksActive = mainView === "library" && !activeFilter;

  return (
    <Box py="sm" px={4} style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
      <NavLink
        label={t("toolbar.allBooks")}
        leftSection={<IconBooks size={16} stroke={1.5} />}
        active={allBooksActive}
        onClick={onShowAllBooks}
        rightSection={
          totalBooks !== undefined && (
            <Badge size="sm" variant={allBooksActive ? "filled" : "light"} circle>
              {totalBooks}
            </Badge>
          )
        }
        px="md"
        py={7}
        styles={sectionRowStyles(allBooksActive)}
      />

      {statusQuery.data?.map(({ status, count }) => {
        const isActive = activeFilter?.kind === "readingStatus" && activeFilter.id === status;
        const StatusIcon = icons[status];
        return (
          <NavLink
            key={status}
            label={labels[status]}
            leftSection={<StatusIcon size={16} stroke={1.5} />}
            active={isActive}
            onClick={() => onSelect(isActive ? null : { kind: "readingStatus", id: status, name: labels[status] })}
            rightSection={
              <Badge size="sm" variant={isActive ? "filled" : "light"} circle>
                {count}
              </Badge>
            }
            px="md"
            py={7}
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
  settingsOpen,
  onShowAllBooks,
  onOpenSettings,
  onOpenAuthors,
  onOpenCollections,
  onOpenTags,
  onOpenSeries,
  onImport,
}: SidebarProps) {
  const { t } = useLanguage();
  const authorsQuery = useQuery({ queryKey: ["authors"], queryFn: listAuthors });
  const seriesQuery = useQuery({ queryKey: ["series"], queryFn: listSeries });
  const tagsQuery = useQuery({ queryKey: ["tags"], queryFn: listTags });
  const collectionsQuery = useQuery({ queryKey: ["collections"], queryFn: listCollections });

  const seeAllAction = (onClick: () => void) => (
    <Tooltip label={t("sidebar.seeAll")}>
      <UnstyledButton onClick={onClick} c="dimmed" style={{ display: "flex" }} aria-label={t("sidebar.seeAll")}>
        <IconFolderOpen size={14} stroke={1.5} />
      </UnstyledButton>
    </Tooltip>
  );

  return (
    <Box
      h="100%"
      display="flex"
      style={{ flexDirection: "column", borderInlineEnd: "1px solid var(--mantine-color-default-border)" }}
    >
      <Box px="md" pt="md" pb="sm">
        <Group justify="space-between" wrap="nowrap" mb="sm">
          <Text ff="var(--mantine-font-family-headings)" fw={600} fz={22}>
            مکتبہ
          </Text>
          <Tooltip label={t("toolbar.addBooks")}>
            <ActionIcon
              variant="outline"
              size="lg"
              onClick={onImport}
              aria-label={t("toolbar.addBooks")}
              style={{ borderStyle: "dashed" }}
            >
              <IconPlus size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>

        {/* Same trigger as the header used to have (see Toolbar) - opens the global Spotlight
            (Ctrl/Cmd+K works from anywhere regardless of where this visible trigger lives). */}
        <UnstyledButton
          onClick={() => spotlight.open()}
          w="100%"
          px="sm"
          py={6}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            border: "1px solid var(--mantine-color-default-border)",
            borderRadius: "var(--mantine-radius-sm)",
            backgroundColor: "var(--mantine-color-body)",
          }}
        >
          <IconSearch size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
          <Text size="xs" c="dimmed" style={{ flex: 1 }} truncate="end">
            {t("toolbar.searchPlaceholder")}
          </Text>
          <Kbd size="xs" style={{ flexShrink: 0 }}>
            Ctrl K
          </Kbd>
        </UnstyledButton>
      </Box>

      <ScrollArea component="nav" style={{ flex: 1 }}>
        <MainLinksSection
          mainView={mainView}
          activeFilter={activeFilter}
          onSelect={onSelect}
          onShowAllBooks={onShowAllBooks}
        />
        <GroupSection
          title={t("sidebar.collections")}
          kind="collectionId"
          icon={IconFolder}
          activeFilter={activeFilter}
          onSelect={onSelect}
          groups={topByBookCount(collectionsQuery.data)}
          action={seeAllAction(onOpenCollections)}
        />
        <GroupSection
          title={t("sidebar.authors")}
          kind="authorId"
          icon={IconUser}
          activeFilter={activeFilter}
          onSelect={onSelect}
          groups={topByBookCount(authorsQuery.data)}
          action={seeAllAction(onOpenAuthors)}
        />
        <GroupSection
          title={t("sidebar.series")}
          kind="seriesId"
          icon={IconStack2}
          activeFilter={activeFilter}
          onSelect={onSelect}
          groups={topByBookCount(seriesQuery.data)}
          action={seeAllAction(onOpenSeries)}
        />
        <GroupSection
          title={t("sidebar.tags")}
          kind="tagId"
          icon={IconTag}
          activeFilter={activeFilter}
          onSelect={onSelect}
          groups={topByBookCount(tagsQuery.data)}
          action={seeAllAction(onOpenTags)}
        />
      </ScrollArea>

      <Divider />
      <Box p={4}>
        <NavLink
          label={t("settings.title")}
          leftSection={<IconSettings size={16} stroke={1.5} />}
          active={settingsOpen}
          onClick={onOpenSettings}
          px="md"
          py={7}
          styles={sectionRowStyles(settingsOpen)}
        />
      </Box>
    </Box>
  );
}
