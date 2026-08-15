import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Box, Button, Group, NavLink, Stack, Text, TextInput } from "@mantine/core";
import { IconSearch, IconTrash } from "@tabler/icons-react";
import { createCollection, deleteCollection, listCollections } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { BrowseViewHeader } from "./BrowseViewHeader";
import type { GroupFilter } from "./Sidebar";

interface CollectionsViewProps {
  onSelect: (filter: GroupFilter) => void;
  onBack: () => void;
}

export function CollectionsView({ onSelect, onBack }: CollectionsViewProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const collectionsQuery = useQuery({ queryKey: ["collections"], queryFn: listCollections });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["collections"] });

  const createMutation = useMutation({
    mutationFn: (newName: string) => createCollection(newName),
    onSuccess: () => {
      setName("");
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCollection(id),
    onSuccess: () => {
      setConfirmingDeleteId(null);
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["books"] });
    },
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length > 0) {
      createMutation.mutate(trimmed);
    }
  };

  const filtered = useMemo(() => {
    const collections = collectionsQuery.data ?? [];
    const term = search.trim().toLowerCase();
    const matched = term ? collections.filter((c) => c.name.toLowerCase().includes(term)) : collections;
    return [...matched].sort((a, b) => a.name.localeCompare(b.name));
  }, [collectionsQuery.data, search]);

  return (
    <Box display="flex" style={{ flexDirection: "column", height: "100%" }}>
      <BrowseViewHeader title={t("collectionsView.title")} onBack={onBack} />

      <Box p="xl" maw={640} style={{ flex: 1, overflow: "auto" }}>
        <form onSubmit={handleAdd}>
          <Group gap="xs" mb="md">
            <TextInput
              style={{ flex: 1 }}
              placeholder={t("collectionsView.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
            <Button type="submit" loading={createMutation.isPending} disabled={name.trim().length === 0}>
              {t("collectionsView.add")}
            </Button>
          </Group>
        </form>

        <TextInput
          mb="md"
          placeholder={t("collectionsView.searchPlaceholder")}
          leftSection={<IconSearch size={15} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />

        <Stack gap={2}>
          {filtered.length === 0 && (
            <Text size="sm" c="dimmed">
              {t("collectionsView.empty")}
            </Text>
          )}

          {filtered.map((collection) => (
            <Group
              key={collection.id}
              justify="space-between"
              wrap="nowrap"
              gap="xs"
              style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
            >
              <NavLink
                label={collection.name}
                onClick={() => {
                  onSelect({ kind: "collectionId", id: collection.id, name: collection.name });
                  onBack();
                }}
                style={{ flex: 1 }}
                px="sm"
                py={6}
                styles={{ root: { borderRadius: "var(--mantine-radius-sm)" } }}
                rightSection={
                  <Text size="xs" c="dimmed">
                    {t(
                      collection.bookCount === 1 ? "collectionsView.bookCount_one" : "collectionsView.bookCount_other",
                      { count: collection.bookCount },
                    )}
                  </Text>
                }
              />
              {confirmingDeleteId === collection.id ? (
                <Group gap={4} wrap="nowrap">
                  <Button size="xs" color="red" loading={deleteMutation.isPending} onClick={() => deleteMutation.mutate(collection.id)}>
                    {t("common.confirm")}
                  </Button>
                  <Button size="xs" variant="subtle" onClick={() => setConfirmingDeleteId(null)}>
                    {t("common.cancel")}
                  </Button>
                </Group>
              ) : (
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => setConfirmingDeleteId(collection.id)}
                  aria-label={t("collectionsView.confirmDelete")}
                >
                  <IconTrash size={15} />
                </ActionIcon>
              )}
            </Group>
          ))}
        </Stack>
      </Box>
    </Box>
  );
}
