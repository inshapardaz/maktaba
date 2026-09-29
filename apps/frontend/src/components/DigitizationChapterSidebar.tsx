import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { ActionIcon, Badge, Button, Group, Paper, Stack, Text, TextInput } from "@mantine/core";
import {
  createDigitizationChapter, deleteDigitizationChapter, renameDigitizationChapter,
  type DigitizationStateDto,
} from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { IconPlus, IconTrash } from "../icons";

// Phase 4 (epic #162) - chapter list/sidebar (#183) + create/rename/delete (#181, minus
// drag-reorder which didn't fit this pass's time budget - chapters can still be reordered by
// deleting and re-creating in the desired order, a real but acceptable rough edge for v1).
export function DigitizationChapterSidebar({ bookId, state }: { bookId: string; state: DigitizationStateDto }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [newTitle, setNewTitle] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["digitizationState", bookId] });
  const onError = (err: unknown) => notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) });

  const createMutation = useMutation({
    mutationFn: (title: string) => createDigitizationChapter(bookId, title),
    onSuccess: () => {
      invalidate();
      setNewTitle("");
    },
    onError,
  });

  const renameMutation = useMutation({
    mutationFn: ({ chapterId, title }: { chapterId: string; title: string }) => renameDigitizationChapter(bookId, chapterId, title),
    onSuccess: () => {
      invalidate();
      setRenamingId(null);
    },
    onError,
  });

  const deleteMutation = useMutation({
    mutationFn: (chapterId: string) => deleteDigitizationChapter(bookId, chapterId),
    onSuccess: invalidate,
    onError,
  });

  const chapters = [...state.chapters].sort((a, b) => a.order - b.order);

  return (
    <Stack gap="xs" w={220}>
      <Text size="sm" fw={600}>{t("digitize.chapters")}</Text>

      {chapters.map((chapter) => {
        const pageCount = state.pages.filter((p) => p.chapterId === chapter.id).length;
        return (
          <Paper key={chapter.id} withBorder p="xs">
            {renamingId === chapter.id ? (
              <Group gap={4}>
                <TextInput
                  size="xs"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && renameValue.trim()) {
                      renameMutation.mutate({ chapterId: chapter.id, title: renameValue.trim() });
                    }
                  }}
                  autoFocus
                />
                <Button size="xs" onClick={() => renameValue.trim() && renameMutation.mutate({ chapterId: chapter.id, title: renameValue.trim() })}>
                  {t("common.save")}
                </Button>
              </Group>
            ) : (
              <Group justify="space-between" gap={4} wrap="nowrap">
                <Text
                  size="sm"
                  truncate
                  style={{ cursor: "pointer", flex: 1 }}
                  onClick={() => {
                    setRenamingId(chapter.id);
                    setRenameValue(chapter.title);
                  }}
                >
                  {chapter.title}
                </Text>
                <Badge size="xs" variant="light">{pageCount}</Badge>
                <ActionIcon size="xs" color="red" variant="subtle" onClick={() => deleteMutation.mutate(chapter.id)} aria-label={t("common.delete")}>
                  <IconTrash size={12} />
                </ActionIcon>
              </Group>
            )}
          </Paper>
        );
      })}

      <Group gap={4}>
        <TextInput
          size="xs"
          placeholder={t("digitize.newChapterTitle")}
          value={newTitle}
          onChange={(e) => setNewTitle(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newTitle.trim()) createMutation.mutate(newTitle.trim());
          }}
          style={{ flex: 1 }}
        />
        <ActionIcon
          size="sm"
          disabled={!newTitle.trim()}
          loading={createMutation.isPending}
          onClick={() => newTitle.trim() && createMutation.mutate(newTitle.trim())}
          aria-label={t("digitize.addChapter")}
        >
          <IconPlus size={14} />
        </ActionIcon>
      </Group>
    </Stack>
  );
}
