import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Box, Group, NavLink, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import { IconCheck, IconPencil, IconSearch, IconX } from "@tabler/icons-react";
import { listSeries, renameSeries } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { BrowseViewHeader } from "./BrowseViewHeader";
import type { GroupFilter } from "./Sidebar";

interface SeriesViewProps {
  onSelect: (filter: GroupFilter) => void;
  onBack: () => void;
}

export function SeriesView({ onSelect, onBack }: SeriesViewProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const seriesQuery = useQuery({ queryKey: ["series"], queryFn: listSeries });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameSeries(id, name),
    onSuccess: () => {
      setEditingId(null);
      setRenameError(null);
      void queryClient.invalidateQueries({ queryKey: ["series"] });
      // Book cards/detail show series names directly, so a rename needs those refreshed too.
      void queryClient.invalidateQueries({ queryKey: ["books"] });
      void queryClient.invalidateQueries({ queryKey: ["book"] });
    },
    onError: (err) => setRenameError(err instanceof Error ? err.message : String(err)),
  });

  const startEditing = (id: string, currentName: string) => {
    setEditingId(id);
    setEditValue(currentName);
    setRenameError(null);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setRenameError(null);
  };

  const commitEditing = () => {
    const trimmed = editValue.trim();
    if (editingId && trimmed.length > 0) {
      renameMutation.mutate({ id: editingId, name: trimmed });
    }
  };

  const filtered = useMemo(() => {
    const series = seriesQuery.data ?? [];
    const term = search.trim().toLowerCase();
    const matched = term ? series.filter((s) => s.name.toLowerCase().includes(term)) : series;
    return [...matched].sort((a, b) => a.name.localeCompare(b.name));
  }, [seriesQuery.data, search]);

  return (
    <Box display="flex" style={{ flexDirection: "column", height: "100%" }}>
      <BrowseViewHeader title={t("seriesView.title")} onBack={onBack} />

      <Box p="xl" maw={640} style={{ flex: 1, overflow: "auto" }}>
        <TextInput
          mb="md"
          placeholder={t("seriesView.searchPlaceholder")}
          leftSection={<IconSearch size={15} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />

        {renameError && (
          <Text size="xs" c="red" mb="xs">
            {renameError}
          </Text>
        )}

        <Stack gap={2}>
          {filtered.length === 0 && (
            <Text size="sm" c="dimmed">
              {t("seriesView.empty")}
            </Text>
          )}

          {filtered.map((series) =>
            editingId === series.id ? (
              <Group key={series.id} gap={4} wrap="nowrap" px="sm" py={4}>
                <TextInput
                  size="xs"
                  style={{ flex: 1 }}
                  value={editValue}
                  autoFocus
                  onChange={(e) => setEditValue(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEditing();
                    if (e.key === "Escape") cancelEditing();
                  }}
                />
                <ActionIcon
                  variant="subtle"
                  color="green"
                  loading={renameMutation.isPending}
                  disabled={editValue.trim().length === 0}
                  onClick={commitEditing}
                  aria-label={t("common.save")}
                >
                  <IconCheck size={15} />
                </ActionIcon>
                <ActionIcon variant="subtle" color="gray" onClick={cancelEditing} aria-label={t("common.cancel")}>
                  <IconX size={15} />
                </ActionIcon>
              </Group>
            ) : (
              <Group key={series.id} gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                <NavLink
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
                  style={{ flex: 1 }}
                  px="sm"
                  py={7}
                  styles={{ root: { borderRadius: "var(--mantine-radius-sm)" } }}
                />
                <Tooltip label={t("seriesView.rename")}>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    onClick={() => startEditing(series.id, series.name)}
                    aria-label={t("seriesView.rename")}
                  >
                    <IconPencil size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            ),
          )}
        </Stack>
      </Box>
    </Box>
  );
}
