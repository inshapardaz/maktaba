import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ActionIcon, Box, Group, NavLink, ScrollArea, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconArrowLeft, IconSearch } from "@tabler/icons-react";
import { listSeries } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import type { GroupFilter } from "./Sidebar";

interface SeriesViewProps {
  onSelect: (filter: GroupFilter) => void;
  onBack: () => void;
}

export function SeriesView({ onSelect, onBack }: SeriesViewProps) {
  const { t } = useLanguage();
  const [search, setSearch] = useState("");
  const seriesQuery = useQuery({ queryKey: ["series"], queryFn: listSeries });

  const filtered = useMemo(() => {
    const series = seriesQuery.data ?? [];
    const term = search.trim().toLowerCase();
    const matched = term ? series.filter((s) => s.name.toLowerCase().includes(term)) : series;
    return [...matched].sort((a, b) => a.name.localeCompare(b.name));
  }, [seriesQuery.data, search]);

  return (
    <Box p="xl" maw={640}>
      <Group mb="lg" gap="sm">
        <ActionIcon variant="default" onClick={onBack} aria-label={t("common.back")}>
          <IconArrowLeft size={16} />
        </ActionIcon>
        <Title order={2}>{t("seriesView.title")}</Title>
      </Group>

      <TextInput
        mb="md"
        placeholder={t("seriesView.searchPlaceholder")}
        leftSection={<IconSearch size={15} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />

      <ScrollArea.Autosize mah="calc(100vh - 220px)">
        <Stack gap={2}>
          {filtered.length === 0 && (
            <Text size="sm" c="dimmed">
              {t("seriesView.empty")}
            </Text>
          )}

          {filtered.map((series) => (
            <NavLink
              key={series.id}
              label={series.name}
              onClick={() => {
                onSelect({ kind: "seriesId", id: series.id, name: series.name });
                onBack();
              }}
              rightSection={
                <Text size="xs" c="dimmed">
                  {series.bookCount}
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
