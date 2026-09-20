import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Group, Modal, Select, Stack, Text } from "@mantine/core";
import { IconAlertCircle } from "../icons";
import { listLibraries, transferBook } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { invalidateLibraryQueries } from "../queries";

export type TransferMode = "copy" | "move";

interface CopyMoveBookDialogProps {
  book: { id: string; title: string };
  // Which menu item was clicked - just the dialog's initial state (the "Remove from source
  // library" checkbox), not a separate flow: both "Copy to library…" and "Move to library…" open
  // this same dialog, per the feature request, with the checkbox pre-set to match which one was
  // clicked but still freely changeable either way.
  initialMode: TransferMode;
  onClose: () => void;
  // Called once the transfer actually removed the source book (a move whose backend call
  // succeeded) - same shape as DeleteBooksConfirmDialog.tsx's onDeleted, so the caller can drop it
  // from its own selection/detail-panel state the same way a plain delete does.
  onMoved: (bookId: string) => void;
}

// Single dialog for both "Copy to library…" and "Move to library…" (see BookContextMenu.tsx) -
// picks a target library from the registry and, when "remove from source" is checked, deletes the
// source book (same trashPath/trashPathIfEmpty two-step DeleteBooksConfirmDialog.tsx already uses)
// once the copy into the target has actually succeeded server-side.
export function CopyMoveBookDialog({ book, initialMode, onClose, onMoved }: CopyMoveBookDialogProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [targetLibraryId, setTargetLibraryId] = useState<string | null>(null);
  const [removeFromSource, setRemoveFromSource] = useState(initialMode === "move");

  const librariesQuery = useQuery({ queryKey: ["libraries"], queryFn: listLibraries });
  const targetOptions = (librariesQuery.data ?? [])
    .filter((lib) => !lib.isActive)
    .map((lib) => ({ value: lib.id, label: lib.name }));

  const transferMutation = useMutation({
    mutationFn: async () => {
      if (!targetLibraryId) return;
      const result = await transferBook(book.id, targetLibraryId, removeFromSource);
      if (removeFromSource && result.requiresLocalTrash) {
        await window.maktaba.trashPath(result.folderPath!);
        if (result.parentFolderPath) {
          await window.maktaba.trashPathIfEmpty(result.parentFolderPath);
        }
      }
    },
    onSuccess: () => {
      invalidateLibraryQueries(queryClient);
      if (removeFromSource) {
        onMoved(book.id);
      }
      onClose();
    },
  });

  return (
    <Modal
      opened
      onClose={onClose}
      title={removeFromSource ? t("bookTransfer.moveTitle") : t("bookTransfer.copyTitle")}
      centered
    >
      <Stack gap="sm">
        <Text size="sm">{t("bookTransfer.description", { title: book.title })}</Text>

        <Select
          label={t("bookTransfer.targetLibrary")}
          placeholder={t("bookTransfer.targetLibraryPlaceholder")}
          data={targetOptions}
          value={targetLibraryId}
          onChange={(value) => setTargetLibraryId(value)}
          disabled={librariesQuery.isLoading}
          searchable
        />

        <Checkbox
          label={t("bookTransfer.removeFromSource")}
          checked={removeFromSource}
          onChange={(event) => setRemoveFromSource(event.currentTarget.checked)}
        />

        {transferMutation.isError && (
          <Alert color="red" icon={<IconAlertCircle size={18} />}>
            {transferMutation.error instanceof Error ? transferMutation.error.message : String(transferMutation.error)}
          </Alert>
        )}

        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onClose} disabled={transferMutation.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={transferMutation.isPending}
            disabled={!targetLibraryId}
            onClick={() => transferMutation.mutate()}
          >
            {removeFromSource ? t("bookTransfer.move") : t("bookTransfer.copy")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
