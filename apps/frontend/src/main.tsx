import { StrictMode, useEffect, useMemo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DirectionProvider, MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/spotlight/styles.css";
import "./index.css";
import { createAppTheme } from "./theme";
import { ThemeColorProvider, useThemeColor } from "./ThemeColorContext";
import { LanguageProvider, getStoredLanguage } from "./i18n/LanguageContext";
import { ReaderOverlay } from "./components/ReaderOverlay";
import { BackendGate } from "./components/BackendGate";
import App from "./App.tsx";

const queryClient = new QueryClient();
const initialDirection = getStoredLanguage() === "ur" ? "rtl" : "ltr";

// Reader windows are separate top-level Electron BrowserWindows loading this same bundle with
// ?view=reader&bookId=...&format=...&title=... in the URL (see apps/desktop/src/main.ts's
// openReaderWindow) rather than a route within the main window, so multiple books can be open
// side by side. This is decided once at load time since each such window's URL never changes.
const readerParams = new URLSearchParams(window.location.search);
const readerRequest =
  readerParams.get("view") === "reader"
    ? {
      bookId: readerParams.get("bookId") ?? "",
      format: readerParams.get("format") === "Pdf" ? ("Pdf" as const) : ("Epub" as const),
      title: readerParams.get("title"),
    }
    : null;

function ReaderWindow({ bookId, format, title }: { bookId: string; format: "Epub" | "Pdf"; title: string | null }) {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  return <ReaderOverlay bookId={bookId} format={format} />;
}

// Reads the persisted theme color (see ThemeColorProvider, mounted just outside this component)
// and rebuilds the Mantine theme whenever it changes - lives here rather than inline so the theme
// object is memoized instead of rebuilt on every unrelated re-render.
function ThemedMantineProvider({ children }: { children: ReactNode }) {
  const { themeColor } = useThemeColor();
  const theme = useMemo(() => createAppTheme(themeColor), [themeColor]);

  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      {children}
    </MantineProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DirectionProvider initialDirection={initialDirection}>
      <ThemeColorProvider>
        <ThemedMantineProvider>
          <LanguageProvider>
            <Notifications position="bottom-right" />
            <QueryClientProvider client={queryClient}>
              <BackendGate showTitleBar={!readerRequest}>
                {readerRequest ? (
                  <ReaderWindow bookId={readerRequest.bookId} format={readerRequest.format} title={readerRequest.title} />
                ) : (
                  <App />
                )}
              </BackendGate>
            </QueryClientProvider>
          </LanguageProvider>
        </ThemedMantineProvider>
      </ThemeColorProvider>
    </DirectionProvider>
  </StrictMode>,
);
