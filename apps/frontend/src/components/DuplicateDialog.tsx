import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import type { DuplicateAction, DuplicateBookInfo } from "../api";
import { useLanguage } from "../i18n/LanguageContext";

interface DuplicateDialogProps {
  filePath: string;
  info: DuplicateBookInfo;
  onResolve: (action: DuplicateAction | "cancel") => void;
}

export function DuplicateDialog({ filePath, info, onResolve }: DuplicateDialogProps) {
  const { t } = useLanguage();

  return (
    <Modal opened onClose={() => onResolve("cancel")} title={t("duplicate.title")} centered>
      <Stack gap="sm">
        <Text size="sm">{info.sameContentHash ? t("duplicate.sameFile") : t("duplicate.sameTitleAuthor")}</Text>
        <Text size="sm">
          <Text component="span" fw={600}>
            {info.existingTitle}
          </Text>{" "}
          — {info.existingAuthors.join(", ") || t("common.unknownAuthor")}
        </Text>
        <Text size="xs" c="dimmed">
          {t("duplicate.importing", { path: filePath })}
        </Text>

        <Group justify="flex-end" mt="sm" wrap="wrap">
          <Button variant="default" onClick={() => onResolve("cancel")}>
            {t("duplicate.cancelRemaining")}
          </Button>
          <Button variant="default" onClick={() => onResolve("skip")}>
            {t("duplicate.skip")}
          </Button>
          <Button variant="default" onClick={() => onResolve("merge")}>
            {t("duplicate.addFormat")}
          </Button>
          <Button onClick={() => onResolve("keep-both")}>{t("duplicate.importNew")}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
