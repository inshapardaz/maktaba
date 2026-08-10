import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Button, Group, Modal, Stack, Text, TextInput } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { createCollection, deleteCollection, listCollections } from "../api";
import { useLanguage } from "../i18n/LanguageContext";

interface CollectionsManagerDialogProps {
  onClose: () => void;
}

export function CollectionsManagerDialog({ onClose }: CollectionsManagerDialogProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
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

  return (
    <Modal opened onClose={onClose} title={t("collectionsManager.title")} size="sm">
      <Stack gap="md">
        <form onSubmit={handleAdd}>
          <Group gap="xs">
            <TextInput
              style={{ flex: 1 }}
              placeholder={t("collectionsManager.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
            <Button type="submit" loading={createMutation.isPending} disabled={name.trim().length === 0}>
              {t("collectionsManager.add")}
            </Button>
          </Group>
        </form>

        <Stack gap={4}>
          {collectionsQuery.data?.length === 0 && (
            <Text size="sm" c="dimmed">
              {t("collectionsManager.empty")}
            </Text>
          )}

          {collectionsQuery.data?.map((collection) => (
            <Group key={collection.id} justify="space-between" py={4} style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
              <Text size="sm">{collection.name}</Text>
              <Group gap="xs">
                <Text size="xs" c="dimmed">
                  {t(collection.bookCount === 1 ? "collectionsManager.bookCount_one" : "collectionsManager.bookCount_other", {
                    count: collection.bookCount,
                  })}
                </Text>
                {confirmingDeleteId === collection.id ? (
                  <Group gap={4}>
                    <Button size="xs" color="red" loading={deleteMutation.isPending} onClick={() => deleteMutation.mutate(collection.id)}>
                      {t("common.confirm")}
                    </Button>
                    <Button size="xs" variant="subtle" onClick={() => setConfirmingDeleteId(null)}>
                      {t("common.cancel")}
                    </Button>
                  </Group>
                ) : (
                  <ActionIcon variant="subtle" color="red" onClick={() => setConfirmingDeleteId(collection.id)} aria-label={t("collectionsManager.confirmDelete")}>
                    <IconTrash size={15} />
                  </ActionIcon>
                )}
              </Group>
            </Group>
          ))}
        </Stack>
      </Stack>
    </Modal>
  );
}
