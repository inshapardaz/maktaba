import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { Button, Group, Modal, Text } from "@mantine/core";
import { deleteBook } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { invalidateLibraryQueries } from "../queries";

interface DeleteBooksConfirmDialogProps {
  books: { id: string; title: string }[];
  onClose: () => void;
  // Called with whichever ids actually got deleted (a subset of `books` if some failed), so the
  // caller can drop them from its own selection state.
  onDeleted: (ids: string[]) => void;
}

// Issue #68: shared by BookList's per-row delete action and its multi-select bulk delete (the
// hover trash icon, and right-click/long-press on an already-selected row) - same deleteBook +
// trashPath two-step BookDetailPanel.tsx's own single-book remove flow uses, just looped with
// Promise.allSettled (same shape as App.tsx's handleDropBooksOnGroup) so one failure doesn't block
// deleting the rest of the selection.
export function DeleteBooksConfirmDialog({ books, onClose, onDeleted }: DeleteBooksConfirmDialogProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(
        books.map(async (book) => {
          const { folderPath } = await deleteBook(book.id);
          await window.maktaba.trashPath(folderPath);
          return book.id;
        }),
      );
      return results
        .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
        .map((r) => r.value);
    },
    onSuccess: (deletedIds) => {
      invalidateLibraryQueries(queryClient);
      onDeleted(deletedIds);
      if (deletedIds.length < books.length) {
        notifications.show({
          color: "yellow",
          title: t("bookList.deleteFailedTitle"),
          message: t("dragDrop.partialFailure", { done: deletedIds.length, total: books.length }),
        });
      }
      onClose();
    },
  });

  return (
    <Modal opened onClose={onClose} title={t("bookList.deleteTitle")} centered>
      <Text size="sm" mb="md">
        {books.length === 1
          ? t("bookList.confirmDeleteOne", { title: books[0].title })
          : t("bookList.confirmDeleteMany", { count: books.length })}
      </Text>

      <Group justify="flex-end">
        <Button variant="default" onClick={onClose} disabled={deleteMutation.isPending}>
          {t("common.cancel")}
        </Button>
        <Button color="red" loading={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
          {t("bookList.delete")}
        </Button>
      </Group>
    </Modal>
  );
}
