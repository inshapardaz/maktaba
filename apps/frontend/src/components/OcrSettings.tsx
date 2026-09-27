import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Anchor, Button, Group, PasswordInput, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { clearGoogleVisionApiKey, getGoogleVisionKeyStatus, setGoogleVisionApiKey } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { IconAlertCircle, IconTrash } from "../icons";

// The credential ref the key is stored under via the existing safeStorage-backed IPC (native.ts's
// maktaba:*-cloud-credential handlers) - reused here rather than adding new IPC, since it's the
// same "encrypt at rest, decrypt in the renderer, push plaintext to the backend when needed"
// pattern cloud storage credentials already use. Not actually a cloud credential itself, just the
// same mechanism.
const OCR_KEY_REF = "google-vision-api-key";

// Epic #162, Phase 6 - Google Vision API key entry, app-wide (not per-library, not per-book) and
// reused across every OCR call. See CLAUDE.md's own "Credentials never reach this backend's disk"
// section for the cloud-storage pattern this mirrors.
export function OcrSettings() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");

  const statusQuery = useQuery({ queryKey: ["ocrKeyStatus"], queryFn: getGoogleVisionKeyStatus });

  // Re-pushes an already-saved key to the backend on mount - covers the case where Settings wasn't
  // opened this session at all but a digitization window still needs OCR to work (see
  // DigitizationWindow.tsx's own copy of this same reconnect, which is the one that actually
  // matters for OCR to function without ever visiting this screen).
  useEffect(() => {
    void window.maktaba.getCloudCredential(OCR_KEY_REF).then((saved) => {
      if (saved) void setGoogleVisionApiKey(saved);
    });
  }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await window.maktaba.saveCloudCredential(OCR_KEY_REF, apiKey);
      await setGoogleVisionApiKey(apiKey);
    },
    onSuccess: () => {
      setApiKey("");
      void queryClient.invalidateQueries({ queryKey: ["ocrKeyStatus"] });
      notifications.show({ color: "green", message: t("settings.ocrKeySaved") });
    },
    onError: (err) => notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) }),
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      await window.maktaba.deleteCloudCredential(OCR_KEY_REF);
      await clearGoogleVisionApiKey();
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["ocrKeyStatus"] }),
    onError: (err) => notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) }),
  });

  return (
    <Stack gap="md" maw={480}>
      <Text size="sm" c="dimmed">
        {t("settings.ocrExplain")}
      </Text>

      {statusQuery.data?.hasKey ? (
        <Alert color="green">
          {t("settings.ocrKeyConfigured")}
          <Group mt="xs">
            <Button size="xs" color="red" variant="light" leftSection={<IconTrash size={14} />} loading={removeMutation.isPending} onClick={() => removeMutation.mutate()}>
              {t("common.delete")}
            </Button>
          </Group>
        </Alert>
      ) : (
        <Alert color="gray" icon={<IconAlertCircle size={18} />}>
          {t("settings.ocrKeyNotConfigured")}
        </Alert>
      )}

      <Group align="flex-end">
        <PasswordInput
          label={t("settings.ocrApiKey")}
          value={apiKey}
          onChange={(e) => setApiKey(e.currentTarget.value)}
          style={{ flex: 1 }}
        />
        <Button disabled={!apiKey.trim()} loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
          {t("common.save")}
        </Button>
      </Group>

      <Anchor size="xs" href="https://cloud.google.com/vision/docs/setup" target="_blank" rel="noreferrer">
        {t("settings.ocrHowToGetKey")}
      </Anchor>
    </Stack>
  );
}
