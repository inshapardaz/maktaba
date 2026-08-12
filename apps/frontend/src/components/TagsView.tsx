import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Box, Group, NavLink, ScrollArea, Stack, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { IconArrowLeft, IconCheck, IconPencil, IconSearch, IconX } from "@tabler/icons-react";
import { listTags, renameTag } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import type { GroupFilter } from "./Sidebar";

interface TagsViewProps {
  onSelect: (filter: GroupFilter) => void;
  onBack: () => void;
}

export function TagsView({ onSelect, onBack }: TagsViewProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const tagsQuery = useQuery({ queryKey: ["tags"], queryFn: listTags });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameTag(id, name),
    onSuccess: () => {
      setEditingId(null);
      setRenameError(null);
      void queryClient.invalidateQueries({ queryKey: ["tags"] });
      // Book cards/detail show tag names directly, so a rename needs those refreshed too.
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

      {renameError && (
        <Text size="xs" c="red" mb="xs">
          {renameError}
        </Text>
      )}

      <ScrollArea.Autosize mah="calc(100vh - 220px)">
        <Stack gap={2}>
          {filtered.length === 0 && (
            <Text size="sm" c="dimmed">
              {t("tagsView.empty")}
            </Text>
          )}

          {filtered.map((tag) =>
            editingId === tag.id ? (
              <Group key={tag.id} gap={4} wrap="nowrap" px="sm" py={4}>
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
              <Group key={tag.id} gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                <NavLink
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
                  style={{ flex: 1 }}
                  px="sm"
                  py={7}
                  styles={{ root: { borderRadius: "var(--mantine-radius-sm)" } }}
                />
                <Tooltip label={t("tagsView.rename")}>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    onClick={() => startEditing(tag.id, tag.name)}
                    aria-label={t("tagsView.rename")}
                  >
                    <IconPencil size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            ),
          )}
        </Stack>
      </ScrollArea.Autosize>
    </Box>
  );
}
