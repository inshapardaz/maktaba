import { useEffect } from "react";
import { Button, Progress } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { UpdateStatus } from "../maktaba";
import { useLanguage } from "../i18n/LanguageContext";

const NOTIFICATION_ID = "app-update";

// Mounted once in the main window only (see App.tsx) - reader pop-out windows don't need their
// own copy, and main.ts's updater.ts broadcasts to every window regardless, so one listener is
// enough. Silent for "checking"/"not-available"/"idle" (a routine background check with nothing
// to report isn't worth interrupting the user over) - only "available"/"downloading"/"downloaded"/
// "error" ever produce a visible notification. Always hide-then-show rather than relying on
// notifications.update alone: Mantine's showNotification is a no-op if a notification with that id
// is already visible, so re-using the same id safely across different transitions needs the old
// one cleared first - the one exception is "downloading"'s progress ticks, which use update() since
// "available" (a show()) is always what put the notification there in the first place.
export function UpdateNotifier() {
  const { t } = useLanguage();

  useEffect(() => {
    const isMac = window.maktaba.platform === "darwin";
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    const handle = (status: UpdateStatus) => {
      switch (status.state) {
        case "available":
          notifications.hide(NOTIFICATION_ID);
          notifications.show({
            id: NOTIFICATION_ID,
            title: t("update.availableTitle", { version: status.version }),
            message: (
              <Button size="xs" mt={6} onClick={() => void window.maktaba.downloadUpdate()}>
                {isMac ? t("update.viewOnGithub") : t("update.download")}
              </Button>
            ),
            autoClose: false,
          });
          break;

        case "downloading":
          notifications.update({
            id: NOTIFICATION_ID,
            title: t("update.downloadingTitle", { percent: status.percent }),
            message: <Progress value={status.percent} size="sm" mt={6} />,
            loading: true,
            autoClose: false,
          });
          break;

        case "downloaded":
          notifications.update({
            id: NOTIFICATION_ID,
            color: "green",
            loading: false,
            title: t("update.readyTitle", { version: status.version }),
            message: (
              <Button size="xs" mt={6} onClick={() => void window.maktaba.quitAndInstall()}>
                {t("update.restartNow")}
              </Button>
            ),
            autoClose: false,
          });
          break;

        case "error":
          notifications.hide(NOTIFICATION_ID);
          notifications.show({
            id: NOTIFICATION_ID,
            color: "red",
            title: t("update.errorTitle"),
            message: status.message,
            autoClose: 6000,
          });
          break;

        default:
          break;
      }
    };

    // initUpdater() never registers maktaba:get-update-status/etc. at all outside a packaged build
    // (see updater.ts's early return on !app.isPackaged) - checked up front and skipped entirely in
    // dev, rather than calling it and letting Electron log a "no handler registered" error to the
    // console on every single launch (a .catch() alone doesn't suppress that - it's Electron's own
    // internal logging for a failed invoke, not a catchable unhandled-rejection warning).
    void window.maktaba.isPackaged().then((packaged) => {
      if (cancelled || !packaged) return;
      void window.maktaba.getUpdateStatus().then(handle);
      unsubscribe = window.maktaba.onUpdateStatus(handle);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [t]);

  return null;
}
