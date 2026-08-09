import { Box, NavLink, ScrollArea, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { listAuthors, listSeries, listTags, type BrowseGroup } from "../api";
import { useLanguage } from "../i18n/LanguageContext";

export type GroupFilterKind = "authorId" | "seriesId" | "tagId";

export interface GroupFilter {
  kind: GroupFilterKind;
  id: string;
  name: string;
}

interface SidebarProps {
  activeFilter: GroupFilter | null;
  onSelect: (filter: GroupFilter | null) => void;
}

function GroupSection({
  title,
  kind,
  activeFilter,
  onSelect,
  groups,
}: {
  title: string;
  kind: GroupFilterKind;
  activeFilter: GroupFilter | null;
  onSelect: (filter: GroupFilter | null) => void;
  groups: BrowseGroup[] | undefined;
}) {
  if (!groups || groups.length === 0) {
    return null;
  }

  return (
    <Box mb="sm">
      <Text size="xs" fw={700} c="dimmed" tt="uppercase" px="md" py={4}>
        {title}
      </Text>
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
          />
        );
      })}
    </Box>
  );
}

export function Sidebar({ activeFilter, onSelect }: SidebarProps) {
  const { t } = useLanguage();
  const authorsQuery = useQuery({ queryKey: ["authors"], queryFn: listAuthors });
  const seriesQuery = useQuery({ queryKey: ["series"], queryFn: listSeries });
  const tagsQuery = useQuery({ queryKey: ["tags"], queryFn: listTags });

  return (
    <ScrollArea component="nav" w={220} py="sm">
      <GroupSection
        title={t("sidebar.authors")}
        kind="authorId"
        activeFilter={activeFilter}
        onSelect={onSelect}
        groups={authorsQuery.data}
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
        groups={tagsQuery.data}
      />
    </ScrollArea>
  );
}
