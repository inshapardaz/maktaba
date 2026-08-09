import { useState } from "react";
import { Alert, Button, Stack, Text, Title } from "@mantine/core";
import { IconAlertCircle, IconFolderOpen } from "@tabler/icons-react";
import { openLibrary } from "../api";
import { useLanguage } from "../i18n/LanguageContext";

interface LibraryPickerProps {
  onOpened: (path: string) => void;
}

export function LibraryPicker({ onOpened }: LibraryPickerProps) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChoose = async () => {
    const folder = await window.maktaba.pickLibraryFolder();
    if (!folder) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const info = await openLibrary(folder);
      onOpened(info.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack align="center" justify="center" h="100%" gap="sm" p="xl" ta="center">
      <Title order={1}>مکتبہ — Maktaba</Title>
      <Text c="dimmed">{t("libraryPicker.subtitle")}</Text>
      <Button leftSection={<IconFolderOpen size={18} />} onClick={handleChoose} loading={busy} mt="sm">
        {busy ? t("libraryPicker.opening") : t("libraryPicker.choose")}
      </Button>
      {error && (
        <Alert color="red" icon={<IconAlertCircle size={18} />} title={t("libraryPicker.errorTitle")} maw={480}>
          {error}
        </Alert>
      )}
    </Stack>
  );
}
