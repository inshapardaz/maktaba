import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Alert, Button, Group, Select, Stack, Text, Tooltip } from "@mantine/core";
import { IconAlertCircle, IconFileUpload, IconTrash } from "@tabler/icons-react";
import { DICTIONARY_LANGUAGE_CODES } from "../dictionaryLanguages";
import { useLanguage } from "../i18n/LanguageContext";
import type { TranslationKey } from "../i18n/translations";
import { languageDisplayName } from "./Sidebar";

// qari issue #17: lets the user provide an offline StarDict/GoldenDict dictionary (as a single zip
// containing its .ifo/.idx/.dict[.dz] files) per language, for real word-lookup definitions in the
// reader - see native.ts's maktaba:*-stardict-dictionary IPC handlers (app-wide storage, not tied
// to any one library, unpacked from the zip there) and ReaderOverlay.tsx (which loads the
// configured dictionary for a book's language when reading).
export function StarDictSettings() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [language, setLanguage] = useState<string | null>(null);
  const [zipPath, setZipPath] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);

  const dictionariesQuery = useQuery({
    queryKey: ["stardictDictionaries"],
    queryFn: () => window.maktaba.listStarDictDictionaries(),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["stardictDictionaries"] });

  const saveMutation = useMutation({
    mutationFn: () => window.maktaba.saveStarDictDictionary(language!, zipPath!),
    onSuccess: () => {
      setLanguage(null);
      setZipPath(null);
      invalidate();
    },
  });

  const removeMutation = useMutation({
    mutationFn: (lang: string) => window.maktaba.removeStarDictDictionary(lang),
    onSuccess: () => {
      setConfirmingRemove(null);
      invalidate();
    },
  });

  const handlePickZip = async () => {
    const path = await window.maktaba.pickStarDictZipFile();
    if (path) setZipPath(path);
  };

  const fileName = (path: string) => path.split(/[/\\]/).pop() ?? path;

  const configured = new Set(dictionariesQuery.data ?? []);
  const availableLanguages = DICTIONARY_LANGUAGE_CODES.filter((code) => !configured.has(code));

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        {t("starDictSettings.description")}
      </Text>

      <Stack gap={2}>
        {(dictionariesQuery.data ?? []).length === 0 && (
          <Text size="sm" c="dimmed">
            {t("starDictSettings.empty")}
          </Text>
        )}

        {(dictionariesQuery.data ?? []).map((lang) => (
          <Group
            key={lang}
            justify="space-between"
            wrap="nowrap"
            px="sm"
            py={6}
            style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: "var(--mantine-radius-sm)" }}
          >
            <Text size="sm">{languageDisplayName(lang, t)}</Text>
            {confirmingRemove === lang ? (
              <Group gap={4} wrap="nowrap">
                <Button size="xs" color="red" loading={removeMutation.isPending} onClick={() => removeMutation.mutate(lang)}>
                  {t("common.confirm")}
                </Button>
                <Button size="xs" variant="subtle" onClick={() => setConfirmingRemove(null)}>
                  {t("common.cancel")}
                </Button>
              </Group>
            ) : (
              <Tooltip label={t("starDictSettings.remove")}>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => setConfirmingRemove(lang)}
                  aria-label={t("starDictSettings.remove")}
                >
                  <IconTrash size={14} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        ))}
      </Stack>

      <Stack gap="xs" p="sm" style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: "var(--mantine-radius-sm)" }}>
        <Text fz={10.5} fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.1em" }}>
          {t("starDictSettings.add")}
        </Text>
        <Group grow align="flex-end">
          <Select
            label={t("starDictSettings.language")}
            placeholder={t("starDictSettings.language")}
            data={availableLanguages.map((code) => ({ value: code, label: t(`language.${code}` as TranslationKey) }))}
            value={language}
            onChange={(value) => setLanguage(value)}
            searchable
            disabled={availableLanguages.length === 0}
          />
          <Button variant="default" leftSection={<IconFileUpload size={14} />} onClick={() => void handlePickZip()}>
            {zipPath ? fileName(zipPath) : t("starDictSettings.chooseZip")}
          </Button>
        </Group>
        <Group justify="flex-end">
          <Button size="sm" loading={saveMutation.isPending} disabled={!language || !zipPath} onClick={() => saveMutation.mutate()}>
            {t("starDictSettings.save")}
          </Button>
        </Group>
        {saveMutation.isError && (
          <Alert color="red" icon={<IconAlertCircle size={16} />}>
            {saveMutation.error instanceof Error ? saveMutation.error.message : String(saveMutation.error)}
          </Alert>
        )}
      </Stack>
    </Stack>
  );
}
