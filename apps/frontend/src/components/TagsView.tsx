import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ActionIcon, Box, Group, NavLink, ScrollArea, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconArrowLeft, IconSearch } from "@tabler/icons-react";
import { listTags } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import type { GroupFilter } from "./Sidebar";

interface TagsViewProps {
  onSelect: (filter: GroupFilter) => void;
  onBack: () => void;
}

export function TagsView({ onSelect, onBack }: TagsViewProps) {
  const { t } = useLanguage();
  const [search, setSearch] = useState("");
  const tagsQuery = useQuery({ queryKey: ["tags"], queryFn: listTags });

  const filtered = useMemo(() => {
    const tags = tagsQuery.data ?? [];
    const term = search.trim().toLowerCase();
    const matched = term ? tags.filter((tag) => tag.name.toLowerCase().includes(term)) : tags;
    return [...matched].sort((a, b) => a.name.localeCompare(b.name));
  }, [tagsQuery.data, search]);

  return (
    <Box p="xl" maw={640}>
      <Group mb="lg" gap="sm">
        <ActionIcon variant="default" onClick={onBack} aria-label={t("common.back")}>
          <IconArrowLeft size={16} />
        </ActionIcon>
        <Title order={2}>{t("tagsView.title")}</Title>
      </Group>

      <TextInput
        mb="md"
        placeholder={t("tagsView.searchPlaceholder")}
        leftSection={<IconSearch size={15} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />

      <ScrollArea.Autosize mah="calc(100vh - 220px)">
        <Stack gap={2}>
          {filtered.length === 0 && (
            <Text size="sm" c="dimmed">
              {t("tagsView.empty")}
            </Text>
          )}

          {filtered.map((tag) => (
            <NavLink
              key={tag.id}
              label={tag.name}
              onClick={() => {
                onSelect({ kind: "tagId", id: tag.id, name: tag.name });
                onBack();
              }}
              rightSection={
                <Text size="xs" c="dimmed">
                  {tag.bookCount}
                </Text>
              }
              px="sm"
              py={7}
              styles={{ root: { borderRadius: "var(--mantine-radius-sm)" } }}
            />
          ))}
        </Stack>
      </ScrollArea.Autosize>
    </Box>
  );
}
