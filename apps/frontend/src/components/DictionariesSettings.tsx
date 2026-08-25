import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Alert, Button, Group, Select, Stack, Text, Tooltip } from "@mantine/core";
import { IconAlertCircle, IconFileUpload, IconTrash } from "@tabler/icons-react";
import { DICTIONARY_LANGUAGE_CODES } from "../dictionaryLanguages";
import { useLanguage } from "../i18n/LanguageContext";
import type { TranslationKey } from "../i18n/translations";
import { languageDisplayName } from "./Sidebar";

// Issue #30: lets the user provide offline Hunspell .aff/.dic dictionary files per language - see
// native.ts's maktaba:*-dictionary IPC handlers (app-wide storage, not tied to any one library)
// and ReaderOverlay.tsx (which loads the configured dictionary for a book's language when reading).
export function DictionariesSettings() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [language, setLanguage] = useState<string | null>(null);
  const [affPath, setAffPath] = useState<string | null>(null);
  const [dicPath, setDicPath] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);

  const dictionariesQuery = useQuery({ queryKey: ["dictionaries"], queryFn: () => window.maktaba.listDictionaries() });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["dictionaries"] });

  const saveMutation = useMutation({
    mutationFn: () => window.maktaba.saveDictionary(language!, affPath!, dicPath!),
    onSuccess: () => {
      setLanguage(null);
      setAffPath(null);
      setDicPath(null);
      invalidate();
    },
  });

  const removeMutation = useMutation({
    mutationFn: (lang: string) => window.maktaba.removeDictionary(lang),
    onSuccess: () => {
      setConfirmingRemove(null);
      invalidate();
    },
  });

  const handlePickAff = async () => {
    const path = await window.maktaba.pickDictionaryFile("aff");
    if (path) setAffPath(path);
  };

  const handlePickDic = async () => {
    const path = await window.maktaba.pickDictionaryFile("dic");
    if (path) setDicPath(path);
  };

  const fileName = (path: string) => path.split(/[/\\]/).pop() ?? path;

  const configured = new Set(dictionariesQuery.data ?? []);
  const availableLanguages = DICTIONARY_LANGUAGE_CODES.filter((code) => !configured.has(code));

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        {t("dictionariesSettings.description")}
      </Text>

      <Stack gap={2}>
        {(dictionariesQuery.data ?? []).length === 0 && (
          <Text size="sm" c="dimmed">
            {t("dictionariesSettings.empty")}
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
              <Tooltip label={t("dictionariesSettings.remove")}>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => setConfirmingRemove(lang)}
                  aria-label={t("dictionariesSettings.remove")}
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
          {t("dictionariesSettings.add")}
        </Text>
        <Group grow align="flex-end">
          <Select
            label={t("dictionariesSettings.language")}
            placeholder={t("dictionariesSettings.language")}
            data={availableLanguages.map((code) => ({ value: code, label: t(`language.${code}` as TranslationKey) }))}
            value={language}
            onChange={(value) => setLanguage(value)}
            searchable
            disabled={availableLanguages.length === 0}
          />
          <Button variant="default" leftSection={<IconFileUpload size={14} />} onClick={() => void handlePickAff()}>
            {affPath ? fileName(affPath) : t("dictionariesSettings.chooseAff")}
          </Button>
          <Button variant="default" leftSection={<IconFileUpload size={14} />} onClick={() => void handlePickDic()}>
            {dicPath ? fileName(dicPath) : t("dictionariesSettings.chooseDic")}
          </Button>
        </Group>
        <Group justify="flex-end">
          <Button
            size="sm"
            loading={saveMutation.isPending}
            disabled={!language || !affPath || !dicPath}
            onClick={() => saveMutation.mutate()}
          >
            {t("dictionariesSettings.save")}
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
