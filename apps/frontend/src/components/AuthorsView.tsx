import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Badge, Box, Group, NavLink, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import { IconCheck, IconPencil, IconSearch, IconX } from "@tabler/icons-react";
import { listAuthors, renameAuthor } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { BrowseViewHeader } from "./BrowseViewHeader";
import type { GroupFilter } from "./Sidebar";

interface AuthorsViewProps {
  onSelect: (filter: GroupFilter) => void;
  onBack: () => void;
}

export function AuthorsView({ onSelect, onBack }: AuthorsViewProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const authorsQuery = useQuery({ queryKey: ["authors"], queryFn: listAuthors });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameAuthor(id, name),
    onSuccess: () => {
      setEditingId(null);
      setRenameError(null);
      void queryClient.invalidateQueries({ queryKey: ["authors"] });
      // Book cards/detail show author names directly, so a rename needs those refreshed too.
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
    const authors = authorsQuery.data ?? [];
    const term = search.trim().toLowerCase();
    const matched = term ? authors.filter((a) => a.name.toLowerCase().includes(term)) : authors;
    return [...matched].sort((a, b) => a.name.localeCompare(b.name));
  }, [authorsQuery.data, search]);

  return (
    <Box display="flex" style={{ flexDirection: "column", height: "100%" }}>
      <BrowseViewHeader title={t("authorsView.title")} onBack={onBack} />

      <Box p="xl" maw={640} style={{ flex: 1, overflow: "auto" }}>
        <TextInput
          mb="md"
          placeholder={t("authorsView.searchPlaceholder")}
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
              {t("authorsView.empty")}
            </Text>
          )}

          {filtered.map((author) =>
            editingId === author.id ? (
              <Group key={author.id} gap={4} wrap="nowrap" px="sm" py={4}>
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
              <Group key={author.id} gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                <NavLink
                  label={author.name}
                  onClick={() => {
                    onSelect({ kind: "authorId", id: author.id, name: author.name });
                    onBack();
                  }}
                  rightSection={
                    <Badge size="sm" variant="light" color="gray">
                      {author.bookCount}
                    </Badge>
                  }
                  style={{ flex: 1 }}
                  px="sm"
                  py={7}
                  styles={{ root: { borderRadius: "var(--mantine-radius-sm)" } }}
                />
                <Tooltip label={t("authorsView.rename")}>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    onClick={() => startEditing(author.id, author.name)}
                    aria-label={t("authorsView.rename")}
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
