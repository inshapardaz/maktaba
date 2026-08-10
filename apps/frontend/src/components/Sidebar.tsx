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
    <Box mb="var(--mantine-spacing-lg)">
      <Text
        fz={10.5}
        fw={600}
        c="dimmed"
        tt="uppercase"
        px="md"
        py={4}
        style={{ letterSpacing: "0.1em" }}
      >
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
            styles={{
              root: {
                borderRadius: "var(--mantine-radius-sm)",
                ...(isActive
                  ? {
                      backgroundColor: "var(--mantine-color-accent-1)",
                      color: "var(--mantine-color-accent-7)",
                    }
                  : {}),
              },
              label: { fontWeight: isActive ? 600 : 400 },
            }}
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
    <ScrollArea
      component="nav"
      w={232}
      py="var(--mantine-spacing-lg)"
      px={4}
      style={{ borderInlineEnd: "1px solid var(--mantine-color-default-border)" }}
    >
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
