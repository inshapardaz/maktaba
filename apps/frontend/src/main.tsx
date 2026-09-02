import { StrictMode, useEffect, useMemo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DirectionProvider, MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/spotlight/styles.css";
import "./index.css";
import { createOrganicTheme, createWhiteTheme, organicCssVariablesResolver } from "./theme";
import { AppThemeProvider, useAppTheme } from "./AppThemeContext";
import { ThemeColorProvider, useThemeColor } from "./ThemeColorContext";
import { LanguageProvider, getStoredLanguage } from "./i18n/LanguageContext";
import { ReaderOverlay } from "./components/ReaderOverlay";
import { BackendGate } from "./components/BackendGate";
import { HelpWindow } from "./components/HelpWindow";
import { ImportProvider } from "./ImportContext";
import { RescanProvider } from "./RescanContext";
import App from "./App.tsx";

const queryClient = new QueryClient();
const initialDirection = getStoredLanguage() === "ur" ? "rtl" : "ltr";

// Reader windows are separate top-level Electron BrowserWindows loading this same bundle with
// ?view=reader&bookId=...&format=...&title=... in the URL (see apps/desktop/src/main.ts's
// openReaderWindow) rather than a route within the main window, so multiple books can be open
// side by side. This is decided once at load time since each such window's URL never changes.
const windowParams = new URLSearchParams(window.location.search);
const readerRequest =
  windowParams.get("view") === "reader"
    ? {
      bookId: windowParams.get("bookId") ?? "",
      format: windowParams.get("format") === "Pdf" ? ("Pdf" as const) : ("Epub" as const),
      title: windowParams.get("title"),
    }
    : null;

// The Help window (apps/desktop/src/main.ts's openHelpWindow, opened from the title bar's Help
// button) is the same "separate top-level window loading this bundle with a ?view= query param"
// pattern as the reader window above.
const isHelpWindow = windowParams.get("view") === "help";

function ReaderWindow({ bookId, format, title }: { bookId: string; format: "Epub" | "Pdf"; title: string | null }) {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  return <ReaderOverlay bookId={bookId} format={format} />;
}

// Picks between the two selectable themes (Settings -> Appearance -> Theme) and rebuilds only when
// the choice actually changes - organicCssVariablesResolver only applies to "organic" since its
// overrides would otherwise leak into "white" too (MantineProvider's resolver isn't scoped per-theme).
// The accent-color choice (ThemeColorContext) only affects "white" - "organic" hardcodes terracotta
// as part of its own design system.
function ThemedMantineProvider({ children }: { children: ReactNode }) {
  const { appTheme } = useAppTheme();
  const { themeColor, customColorHex } = useThemeColor();
  const theme = useMemo(
    () => (appTheme === "white" ? createWhiteTheme(themeColor, customColorHex) : createOrganicTheme()),
    [appTheme, themeColor, customColorHex],
  );
  const cssVariablesResolver = appTheme === "white" ? undefined : organicCssVariablesResolver;

  return (
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="auto">
      {children}
    </MantineProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DirectionProvider initialDirection={initialDirection}>
      <AppThemeProvider>
        <ThemeColorProvider>
          <ThemedMantineProvider>
            <LanguageProvider>
              <Notifications position="bottom-right" />
              <QueryClientProvider client={queryClient}>
                <BackendGate showTitleBar={!readerRequest && !isHelpWindow}>
                  {readerRequest ? (
                    <ReaderWindow bookId={readerRequest.bookId} format={readerRequest.format} title={readerRequest.title} />
                  ) : isHelpWindow ? (
                    <HelpWindow />
                  ) : (
                    <ImportProvider>
                      <RescanProvider>
                        <App />
                      </RescanProvider>
                    </ImportProvider>
                  )}
                </BackendGate>
              </QueryClientProvider>
            </LanguageProvider>
          </ThemedMantineProvider>
        </ThemeColorProvider>
      </AppThemeProvider>
    </DirectionProvider>
  </StrictMode>,
);
