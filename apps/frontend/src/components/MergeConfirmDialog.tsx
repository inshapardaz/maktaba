import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Group, Modal, Text } from "@mantine/core";
import { deleteBook, mergeBooks } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { invalidateLibraryQueries } from "../queries";

interface MergeConfirmDialogProps {
  target: { id: string; title: string };
  // Every other book being merged into target - dropping a multi-selection onto one book merges
  // all of them at once, same as dropping a multi-selection onto a sidebar group edits all of them.
  sources: { id: string; title: string }[];
  onClose: () => void;
}

// Issue #49: shown when a book (or a multi-selection) is dropped onto another book card/row in
// BookGrid.tsx/BookList.tsx - confirms before merging, since it deletes every source book once its
// files have been folded into the target. Target metadata is never touched - only file formats it
// doesn't already have are brought over (see backend BookEditService.MergeAsync).
export function MergeConfirmDialog({ target, sources, onClose }: MergeConfirmDialogProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const mergeMutation = useMutation({
    mutationFn: async () => {
      for (const source of sources) {
        await mergeBooks(target.id, source.id);
        const { folderPath } = await deleteBook(source.id);
        await window.maktaba.trashPath(folderPath);
      }
    },
    onSuccess: () => {
      invalidateLibraryQueries(queryClient);
      onClose();
    },
    onError: (err) => {
      const detail = err instanceof Error ? err.message : String(err);
      setError(`${t("bookMerge.mergeFailed", { title: target.title })}: ${detail}`);
    },
  });

  return (
    <Modal opened onClose={onClose} title={t("bookMerge.title")} centered>
      <Text size="sm" mb="md">
        {sources.length === 1
          ? t("bookMerge.confirmOne", { source: sources[0].title, target: target.title })
          : t("bookMerge.confirmMany", { count: sources.length, target: target.title })}
      </Text>

      {error && (
        <Text size="xs" c="red" mb="sm">
          {error}
        </Text>
      )}

      <Group justify="flex-end">
        <Button variant="default" onClick={onClose} disabled={mergeMutation.isPending}>
          {t("common.cancel")}
        </Button>
        <Button color="red" loading={mergeMutation.isPending} onClick={() => mergeMutation.mutate()}>
          {t("bookMerge.confirm")}
        </Button>
      </Group>
    </Modal>
  );
}
