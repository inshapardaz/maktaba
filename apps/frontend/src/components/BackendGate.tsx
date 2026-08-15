import { useEffect, useState, type ReactNode } from "react";
import { Alert, Button, Loader, Stack, Text } from "@mantine/core";
import { IconAlertCircle, IconRefresh } from "@tabler/icons-react";
import { useLanguage } from "../i18n/LanguageContext";
import type { SidecarStatus } from "../maktaba";

// Gates rendering of the real app (or reader window) until the Maktaba.Api sidecar (spawned by
// Electron's main process alongside this window — see apps/desktop/src/main.ts's initSidecar)
// answers its health check. Every window queries the current status on mount and subscribes to
// later transitions, since main.ts creates/shows the window before the backend is confirmed
// ready rather than blocking on it.
export function BackendGate({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<SidecarStatus>({ state: "starting" });

  useEffect(() => {
    let cancelled = false;
    void window.maktaba.getSidecarStatus().then((current) => {
      if (!cancelled) setStatus(current);
    });
    const unsubscribe = window.maktaba.onSidecarStatus((next) => setStatus(next));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  if (status.state === "error") {
    // The raw error (status.message) is deliberately not shown here - it's an internal detail
    // (a stack trace, a port-in-use message, etc.) that isn't actionable for the user; Retry
    // re-runs the same health check main.ts already did (see maktaba:retry-sidecar), or respawns
    // the sidecar entirely if the process actually died.
    return (
      <Stack align="center" justify="center" h="100vh" gap="md" p="xl" ta="center">
        <Alert color="red" icon={<IconAlertCircle size={18} />} title={t("backend.errorTitle")} maw={480}>
          <Text size="sm" c="dimmed">
            {t("backend.errorHint")}
          </Text>
        </Alert>
        <Button leftSection={<IconRefresh size={16} />} onClick={() => void window.maktaba.retrySidecar()}>
          {t("backend.retry")}
        </Button>
      </Stack>
    );
  }

  if (status.state === "starting") {
    return (
      <Stack align="center" justify="center" h="100vh" gap="sm">
        <Loader />
        <Text c="dimmed">{t("backend.starting")}</Text>
      </Stack>
    );
  }

  return <>{children}</>;
}
