import { useEffect, useState, type ReactNode } from "react";
import { Alert, Box, Button, Loader, Stack, Text } from "@mantine/core";
import { IconAlertCircle, IconRefresh } from "../icons";
import { useLanguage } from "../i18n/LanguageContext";
import type { SidecarStatus } from "../maktaba";
import { TITLEBAR_HEIGHT, TitleBarBrand, useTitleBarOverlayPadding } from "./TitleBar";

// A minimal stand-in for the real TitleBar (App.tsx's, mounted once a library has loaded) - just
// the drag region and branding, no interactive pieces, since nothing behind it is wired up yet
// (no mainView/sidebar/etc. exist before App.tsx itself mounts). Without this, the loading/error
// states below would render with no drag region at all (the window is frameless -
// titleBarStyle: "hidden" - so there's no native chrome to fall back on either), making the
// window feel stuck/unresponsive before the backend finishes starting. Only rendered for the
// frameless main window (see `showTitleBar` below) - reader pop-out windows already have their
// own native OS title bar and would just get a redundant second bar stacked under it.
function LoadingTitleBar() {
  const { paddingLeft, paddingRight } = useTitleBarOverlayPadding();
  return (
    <Box
      className="maktaba-titlebar-drag"
      h={TITLEBAR_HEIGHT}
      style={{
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        borderBottom: "1px solid var(--mantine-color-default-border)",
        boxSizing: "border-box",
        overflow: "hidden",
        paddingLeft,
        paddingRight,
      }}
    >
      <TitleBarBrand />
    </Box>
  );
}

// The logo + spinner + message look used for every full-screen "the app is doing something before
// there's anything to show yet" state - the starting state below, and App.tsx's own library-check
// spinner (shown right after this component hands off to it). Factored out so those two moments
// look like one continuous loading sequence instead of a branded screen suddenly dropping to a
// bare spinner.
export function LoadingContent({ message }: { message: string }) {
  return (
    <Stack align="center" justify="center" style={{ flex: 1 }} gap="md">
      <img src="icon.png" alt="" width={72} height={72} style={{ borderRadius: 16 }} />
      <Loader />
      <Text c="dimmed">{message}</Text>
    </Stack>
  );
}

// Gates rendering of the real app (or reader window) until the Maktaba.Api sidecar (spawned by
// Electron's main process alongside this window — see apps/desktop/src/main.ts's initSidecar)
// answers its health check. Every window queries the current status on mount and subscribes to
// later transitions, since main.ts creates/shows the window before the backend is confirmed
// ready rather than blocking on it.
export function BackendGate({ children, showTitleBar }: { children: ReactNode; showTitleBar: boolean }) {
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
      <Stack h="100vh" gap={0}>
        {showTitleBar && <LoadingTitleBar />}
        <Stack align="center" justify="center" style={{ flex: 1 }} gap="md" p="xl" ta="center">
          <Alert color="red" icon={<IconAlertCircle size={18} />} title={t("backend.errorTitle")} maw={480}>
            <Text size="sm" c="dimmed">
              {t("backend.errorHint")}
            </Text>
          </Alert>
          <Button leftSection={<IconRefresh size={16} />} onClick={() => void window.maktaba.retrySidecar()}>
            {t("backend.retry")}
          </Button>
        </Stack>
      </Stack>
    );
  }

  if (status.state === "starting") {
    // Doubles as this window's splash screen: the native splash (apps/desktop/splash/splash.html)
    // only covers the gap up to the window's first paint (see main.ts's "ready-to-show" handoff) -
    // this is what's actually showing the instant that swap happens, so it keeps the same
    // logo-front-and-center look rather than dropping straight to a bare spinner.
    return (
      <Stack h="100vh" gap={0}>
        {showTitleBar && <LoadingTitleBar />}
        <LoadingContent message={t("backend.starting")} />
      </Stack>
    );
  }

  return <>{children}</>;
}
