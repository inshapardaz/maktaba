import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { ActionIcon, Badge, Button, Group, Modal, Paper, ScrollArea, Stack, Text, TextInput } from "@mantine/core";
import {
  confirmChapterMerge, createDigitizationChapter, deleteDigitizationChapter, getMergedChapterText,
  renameDigitizationChapter, type DigitizationStateDto,
} from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { IconEye, IconGitMerge, IconPlus, IconTrash, IconX } from "../icons";

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

  const [previewChapterId, setPreviewChapterId] = useState<string | null>(null);
  const previewQuery = useQuery({
    queryKey: ["digitizationMergedText", bookId, previewChapterId],
    queryFn: () => getMergedChapterText(bookId, previewChapterId!),
    enabled: previewChapterId !== null,
  });

  const mergeMutation = useMutation({
    mutationFn: () => confirmChapterMerge(bookId),
    onSuccess: () => {
      invalidate();
      notifications.show({ color: "green", message: t("digitize.mergeConfirmed") });
    },
    onError,
  });

  const chapters = [...state.chapters].sort((a, b) => a.order - b.order);

  // Phase 7's own gating (#192) - mirrors ConfirmChapterMergeAsync's backend check exactly, so the
  // button's enabled/disabled state never disagrees with what the server would actually accept.
  const unchapteredCount = state.pages.filter((p) => p.chapterId === null).length;
  const notCompleteCount = state.pages.filter((p) => p.editStatus !== "Complete").length;
  const canMerge = state.pages.length > 0 && unchapteredCount === 0 && notCompleteCount === 0;

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
                    } else if (e.key === "Escape") {
                      setRenamingId(null);
                    }
                  }}
                  autoFocus
                  style={{ flex: 1 }}
                />
                <ActionIcon
                  size="sm"
                  variant="default"
                  onClick={() => setRenamingId(null)}
                  disabled={renameMutation.isPending}
                  aria-label={t("common.cancel")}
                >
                  <IconX size={14} />
                </ActionIcon>
                <Button size="xs" loading={renameMutation.isPending} onClick={() => renameValue.trim() && renameMutation.mutate({ chapterId: chapter.id, title: renameValue.trim() })}>
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
                <ActionIcon size="xs" variant="subtle" onClick={() => setPreviewChapterId(chapter.id)} aria-label={t("digitize.previewMerged")}>
                  <IconEye size={12} />
                </ActionIcon>
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

      <Button
        size="xs"
        variant="light"
        leftSection={<IconGitMerge size={14} />}
        disabled={!canMerge}
        loading={mergeMutation.isPending}
        onClick={() => mergeMutation.mutate()}
      >
        {t("digitize.mergeIntoChapters")}
      </Button>
      {!canMerge && (
        <Text size="xs" c="dimmed">
          {unchapteredCount > 0
            ? t("digitize.mergeBlockedUnchaptered", { count: unchapteredCount })
            : notCompleteCount > 0
              ? t("digitize.mergeBlockedNotComplete", { count: notCompleteCount })
              : ""}
        </Text>
      )}

      <Modal opened={previewChapterId !== null} onClose={() => setPreviewChapterId(null)} title={t("digitize.previewMerged")} size="lg" centered>
        <ScrollArea h={400}>
          <Text size="sm" style={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
            {previewQuery.data ?? ""}
          </Text>
        </ScrollArea>
      </Modal>
    </Stack>
  );
}
