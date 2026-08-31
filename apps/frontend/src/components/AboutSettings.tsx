import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Group, Image, Progress, Stack, Text } from "@mantine/core";
import { IconAlertCircle, IconCircleCheck, IconRefresh } from "../icons";
import type { UpdateStatus } from "../maktaba";
import { useLanguage } from "../i18n/LanguageContext";

// Same "get current + subscribe to later" pairing UpdateNotifier.tsx uses for its toast, but
// rendered inline here instead - the two listeners don't conflict, updater.ts's broadcast() fans
// out to every subscriber in every window regardless of how many there are.
export function AboutSettings() {
  const { t } = useLanguage();
  const isMac = window.maktaba.platform === "darwin";
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });

  const versionQuery = useQuery({ queryKey: ["appVersion"], queryFn: () => window.maktaba.getAppVersion() });
  // initUpdater() never registers maktaba:check-for-updates/get-update-status/etc. at all outside
  // a packaged build (see updater.ts's early return on !app.isPackaged) - checked up front so the
  // button below can be disabled with an explanatory message instead of attempting the call and
  // surfacing a raw "No handler registered" IPC error in the UI.
  const packagedQuery = useQuery({ queryKey: ["isPackaged"], queryFn: () => window.maktaba.isPackaged() });
  const isPackaged = packagedQuery.data ?? false;

  useEffect(() => {
    if (!isPackaged) return;
    let cancelled = false;
    void window.maktaba.getUpdateStatus().then((s) => {
      if (!cancelled) setStatus(s);
    });
    return window.maktaba.onUpdateStatus((next) => {
      if (!cancelled) setStatus(next);
    });
  }, [isPackaged]);

  const handleCheckForUpdates = () => {
    setStatus({ state: "checking" });
    void window.maktaba.checkForUpdates().catch((err: unknown) => {
      setStatus({ state: "error", message: err instanceof Error ? err.message : String(err) });
    });
  };

  return (
    <Stack gap="md" align="center" py="md">
      <Image src="icon.png" alt="" w={64} h={64} radius="md" />
      <Stack gap={2} align="center">
        <Text fw={700} fz={18}>
          {t("app.name")}
        </Text>
        <Text size="sm" c="dimmed">
          {versionQuery.data ? t("settings.version", { version: versionQuery.data }) : "…"}
        </Text>
      </Stack>

      <Button
        leftSection={<IconRefresh size={15} />}
        variant="light"
        loading={status.state === "checking"}
        disabled={!isPackaged}
        onClick={handleCheckForUpdates}
      >
        {t("settings.checkForUpdates")}
      </Button>

      {!isPackaged && (
        <Text size="xs" c="dimmed" ta="center" maw={280}>
          {t("settings.updatesDevOnly")}
        </Text>
      )}

      {status.state === "not-available" && (
        <Group gap={6} c="green">
          <IconCircleCheck size={16} />
          <Text size="sm">{t("settings.upToDate")}</Text>
        </Group>
      )}

      {status.state === "available" && (
        <Stack gap={6} align="center">
          <Text size="sm">{t("update.availableTitle", { version: status.version })}</Text>
          <Button size="xs" onClick={() => void window.maktaba.downloadUpdate()}>
            {isMac ? t("update.viewOnGithub") : t("update.download")}
          </Button>
        </Stack>
      )}

      {status.state === "downloading" && (
        <Stack gap={4} w={220}>
          <Text size="xs" c="dimmed" ta="center">
            {t("update.downloadingTitle", { percent: status.percent })}
          </Text>
          <Progress value={status.percent} size="sm" />
        </Stack>
      )}

      {status.state === "downloaded" && (
        <Stack gap={6} align="center">
          <Text size="sm" c="green">
            {t("update.readyTitle", { version: status.version })}
          </Text>
          <Button size="xs" color="green" onClick={() => void window.maktaba.quitAndInstall()}>
            {t("update.restartNow")}
          </Button>
        </Stack>
      )}

      {status.state === "error" && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} title={t("update.errorTitle")} w="100%">
          {status.message}
        </Alert>
      )}
    </Stack>
  );
}
