import { useState } from "react";
import { Button, Checkbox, Group, Modal, Stack, Text } from "@mantine/core";
import type { DuplicateAction, DuplicateBookInfo } from "../api";
import { useLanguage } from "../i18n/LanguageContext";

interface DuplicateDialogProps {
  filePath: string;
  info: DuplicateBookInfo;
  onResolve: (action: DuplicateAction | "cancel", applyToAll: boolean) => void;
}

export function DuplicateDialog({ filePath, info, onResolve }: DuplicateDialogProps) {
  const { t } = useLanguage();
  const [applyToAll, setApplyToAll] = useState(false);

  return (
    <Modal opened onClose={() => onResolve("cancel", false)} title={t("duplicate.title")} centered>
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

        <Checkbox
          size="sm"
          label={t("duplicate.applyToAll")}
          checked={applyToAll}
          onChange={(e) => setApplyToAll(e.currentTarget.checked)}
        />

        <Group justify="flex-end" mt="sm" wrap="wrap">
          <Button variant="default" onClick={() => onResolve("cancel", false)}>
            {t("duplicate.cancelRemaining")}
          </Button>
          <Button variant="default" onClick={() => onResolve("skip", applyToAll)}>
            {t("duplicate.skip")}
          </Button>
          <Button variant="default" onClick={() => onResolve("merge", applyToAll)}>
            {t("duplicate.addFormat")}
          </Button>
          <Button onClick={() => onResolve("keep-both", applyToAll)}>{t("duplicate.importNew")}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
