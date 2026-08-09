import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DirectionProvider, MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./index.css";
import { theme } from "./theme";
import { LanguageProvider, getStoredLanguage } from "./i18n/LanguageContext";
import App from "./App.tsx";

const queryClient = new QueryClient();
const initialDirection = getStoredLanguage() === "ur" ? "rtl" : "ltr";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DirectionProvider initialDirection={initialDirection}>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <LanguageProvider>
          <Notifications position="bottom-right" />
          <QueryClientProvider client={queryClient}>
            <App />
          </QueryClientProvider>
        </LanguageProvider>
      </MantineProvider>
    </DirectionProvider>
  </StrictMode>,
);
