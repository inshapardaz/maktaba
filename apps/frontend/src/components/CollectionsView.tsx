import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { ActionIcon, Badge, Box, Button, Center, Group, Loader, NavLink, Stack, Text, TextInput } from "@mantine/core";
import { IconSearch, IconTrash } from "../icons";
import { ApiError, createCollection, deleteCollection, listCollections, moveCollection } from "../api";
import { isCollectionDrag, readCollectionDragId, setCollectionDragData } from "../collectionDrag";
import { useLanguage } from "../i18n/LanguageContext";
import { BrowseViewHeader } from "./BrowseViewHeader";
import { flattenCollectionTree, type GroupFilter } from "./Sidebar";

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

  // Same drag-to-nest interaction as Sidebar.tsx's CollectionTreeSection (shares
  // flattenCollectionTree for the indented tree order below) - a rejected move (a cycle, or a
  // parent that no longer exists) surfaces as a notification rather than silently no-opping.
  const moveMutation = useMutation({
    mutationFn: ({ id, parentId }: { id: string; parentId: string | null }) => moveCollection(id, parentId),
    onSuccess: invalidate,
    onError: (error: unknown) => {
      notifications.show({
        color: "red",
        message: error instanceof ApiError ? error.message : t("common.error"),
      });
    },
  });
  const [dragOverId, setDragOverId] = useState<string | null>(null);

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

  // A search narrows to a flat, possibly-orphaned set of matches (a matched child's parent might
  // not itself match the term) - showing those at depth 0 rather than running them through the
  // tree builder avoids a matched row rendering indented under a parent that isn't even in view.
  // Clearing the search goes back to the real, fully-indented tree.
  const isSearching = search.trim().length > 0;
  const nodes = useMemo(
    () => (isSearching ? filtered.map((group) => ({ group, depth: 0 })) : flattenCollectionTree(filtered)),
    [filtered, isSearching],
  );

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

        {collectionsQuery.isLoading && (
          <Center py="xl">
            <Loader size="sm" />
          </Center>
        )}

        <Stack
          gap={2}
          onDragOver={(event) => {
            if (!isCollectionDrag(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            if (!isCollectionDrag(event)) return;
            event.preventDefault();
            const draggedId = readCollectionDragId(event);
            if (draggedId) moveMutation.mutate({ id: draggedId, parentId: null });
          }}
        >
          {!collectionsQuery.isLoading && nodes.length === 0 && (
            <Text size="sm" c="dimmed">
              {t("collectionsView.empty")}
            </Text>
          )}

          {nodes.map(({ group: collection, depth }) => (
            <Group
              key={collection.id}
              justify="space-between"
              wrap="nowrap"
              gap="xs"
              draggable
              onDragStart={(event) => setCollectionDragData(event, collection.id)}
              onDragOver={(event) => {
                if (!isCollectionDrag(event)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDragOverId(collection.id);
              }}
              onDragLeave={() => setDragOverId((id) => (id === collection.id ? null : id))}
              onDrop={(event) => {
                if (!isCollectionDrag(event)) return;
                event.preventDefault();
                event.stopPropagation();
                setDragOverId(null);
                const draggedId = readCollectionDragId(event);
                if (draggedId && draggedId !== collection.id) {
                  moveMutation.mutate({ id: draggedId, parentId: collection.id });
                }
              }}
              style={{
                borderBottom: "1px solid var(--mantine-color-default-border)",
                outline: dragOverId === collection.id ? "2px solid var(--mantine-primary-color-6)" : "2px solid transparent",
                outlineOffset: -2,
                borderRadius: "var(--mantine-radius-sm)",
              }}
            >
              <NavLink
                label={collection.name}
                onClick={() => {
                  onSelect({ kind: "collectionId", id: collection.id, name: collection.name });
                  onBack();
                }}
                style={{ flex: 1 }}
                pl={12 + depth * 16}
                pr="sm"
                py={6}
                styles={{ root: { borderRadius: "var(--mantine-radius-sm)" } }}
                rightSection={
                  <Badge size="sm" variant="light" color="gray" tt="none">
                    {t(
                      collection.bookCount === 1 ? "collectionsView.bookCount_one" : "collectionsView.bookCount_other",
                      { count: collection.bookCount },
                    )}
                  </Badge>
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
