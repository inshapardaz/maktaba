import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { Button, Checkbox, Group, Modal, Stack, Text } from "@mantine/core";
import { startDigitization } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { isRtlLanguage } from "../isRtlLanguage";

interface DigitizeConfirmDialogProps {
  bookId: string;
  title: string;
  language: string | null | undefined;
  hasEpub: boolean;
  onClose: () => void;
  onStarted: () => void;
}

// Epic #162's "Digitize" entry point (Phase 0) - mirrors DeleteBooksConfirmDialog.tsx's shape
// (a Modal + useMutation + Cancel/action button pair). Starting digitization only creates
// digitization.json here (no pages yet - PDF rasterization is Phase 1's own job, wired up once
// its digitization window exists), so this dialog's job ends at "the book is now marked as being
// digitized," not at opening any editor.
export function DigitizeConfirmDialog({ bookId, title, language, hasEpub, onClose, onStarted }: DigitizeConfirmDialogProps) {
  const { t } = useLanguage();
  const [isRightToLeft, setIsRightToLeft] = useState(() => isRtlLanguage(language));

  const startMutation = useMutation({
    mutationFn: () => startDigitization(bookId, isRightToLeft),
    onSuccess: () => {
      notifications.show({ color: "green", message: t("bookDetail.digitizeStarted") });
      onStarted();
      onClose();
    },
  });

  return (
    <Modal opened onClose={onClose} title={t("bookDetail.digitizeTitle")} centered>
      <Stack gap="md">
        <Text size="sm">
          {hasEpub ? t("bookDetail.digitizeConfirmHasEpub", { title }) : t("bookDetail.digitizeConfirm", { title })}
        </Text>
        <Checkbox
          label={t("bookDetail.digitizeRightToLeft")}
          checked={isRightToLeft}
          onChange={(e) => setIsRightToLeft(e.currentTarget.checked)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={startMutation.isPending}>
            {t("common.cancel")}
          </Button>
          <Button loading={startMutation.isPending} onClick={() => startMutation.mutate()}>
            {t("bookDetail.digitizeStart")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
