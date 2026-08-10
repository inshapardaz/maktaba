import { useState } from "react";
import { Box, Group, NavLink, ScrollArea, Text, UnstyledButton } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { IconSettings } from "@tabler/icons-react";
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
import { CollectionsManagerDialog } from "./CollectionsManagerDialog";

export type GroupFilterKind = "authorId" | "seriesId" | "tagId" | "collectionId" | "readingStatus";

export interface GroupFilter {
  kind: GroupFilterKind;
  id: string;
  name: string;
}

interface SidebarProps {
  activeFilter: GroupFilter | null;
  onSelect: (filter: GroupFilter | null) => void;
  settingsActive: boolean;
  onOpenSettings: () => void;
}

function sectionRowStyles(isActive: boolean) {
  return {
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

export function Sidebar({ activeFilter, onSelect, settingsActive, onOpenSettings }: SidebarProps) {
  const { t } = useLanguage();
  const authorsQuery = useQuery({ queryKey: ["authors"], queryFn: listAuthors });
  const seriesQuery = useQuery({ queryKey: ["series"], queryFn: listSeries });
  const tagsQuery = useQuery({ queryKey: ["tags"], queryFn: listTags });
  const collectionsQuery = useQuery({ queryKey: ["collections"], queryFn: listCollections });
  const [managerOpen, setManagerOpen] = useState(false);

  return (
    <>
      <Box w={232} h="100%" display="flex" style={{ flexDirection: "column", borderInlineEnd: "1px solid var(--mantine-color-default-border)" }}>
        <ScrollArea component="nav" py="var(--mantine-spacing-lg)" px={4} style={{ flex: 1 }}>
          <GroupSection
            title={t("sidebar.collections")}
            kind="collectionId"
            activeFilter={activeFilter}
            onSelect={onSelect}
            groups={collectionsQuery.data}
            action={
              <UnstyledButton onClick={() => setManagerOpen(true)} fz={10.5} fw={600} c="accent.7">
                {t("sidebar.manage")}
              </UnstyledButton>
            }
          />
          <ReadingStatusSection activeFilter={activeFilter} onSelect={onSelect} />
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

        <Box style={{ borderTop: "1px solid var(--mantine-color-default-border)" }} p={4}>
          <NavLink
            label={t("settings.title")}
            leftSection={<IconSettings size={16} />}
            active={settingsActive}
            onClick={onOpenSettings}
            px="md"
            py={7}
            styles={sectionRowStyles(settingsActive)}
          />
        </Box>
      </Box>

      {managerOpen && <CollectionsManagerDialog onClose={() => setManagerOpen(false)} />}
    </>
  );
}
