import { useState } from "react";
import { Alert, Button, Stack, Text, Title } from "@mantine/core";
import { IconAlertCircle, IconFolderOpen } from "@tabler/icons-react";
import { listLibraries, openLibrary, resyncLibrary } from "../api";
import { useLanguage } from "../i18n/LanguageContext";

interface LibraryPickerProps {
  // filesToImport is non-empty when the picked folder turned out to have loose ebook files
  // Maktaba should offer to import (see below) - App.tsx opens ImportDialog pre-populated with
  // them when that happens, otherwise just refreshes as before.
  onOpened: (path: string, filesToImport: string[]) => void;
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

      // The folder just picked may already hold books from a previous run of Maktaba (or a
      // restored backup) laid out in the on-disk "{Author}/{Title} (id)" structure, or it may
      // just be a plain folder of loose ebook files, or genuinely empty. Try the cheap,
      // no-file-copying path first (resync recognizes the existing structure in place); only if
      // that finds nothing does this fall back to scanning for loose files to hand to the
      // ImportDialog. Either half failing (a folder with unreadable permissions, etc.) shouldn't
      // block the library from opening - it just means nothing gets auto-imported this time.
      let filesToImport: string[] = [];
      try {
        const libraries = await listLibraries();
        const active = libraries.find((entry) => entry.isActive);
        const bookCount = active ? (await resyncLibrary(active.id)).bookCount : 0;
        if (bookCount === 0) {
          filesToImport = await window.maktaba.resolveEbookPaths([folder]);
        }
      } catch {
        // Best-effort - the library is already open at this point regardless.
      }

      onOpened(info.path, filesToImport);
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
