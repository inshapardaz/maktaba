import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

// "organic" (default) is the warm terracotta/parchment design system (theme.ts); "white" is plain
// Mantine with no customization at all, kept selectable (Settings -> Appearance) for anyone who
// wants the app to look the way it did before the Organic redesign.
export type AppThemeName = "organic" | "white";

const STORAGE_KEY = "maktaba-app-theme";
const DEFAULT_APP_THEME: AppThemeName = "organic";

export function getStoredAppTheme(): AppThemeName {
  if (typeof window === "undefined") {
    return DEFAULT_APP_THEME;
  }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "organic" || stored === "white" ? stored : DEFAULT_APP_THEME;
}

// Issue #63: "White" theme only (see SettingsScreen.tsx, gated the same way as ThemeColorSwatches
// there) - forces the title bar and sidebar to a dark VS-Code-style chrome regardless of the app's
// overall light/dark color scheme. Implemented in App.tsx by stamping
// data-mantine-color-scheme="dark" on those two elements - a real Mantine feature (color scheme
// can be scoped to any subtree, not just the document root), so every Mantine component nested
// inside (NavLink, ActionIcon, Text, ...) picks up dark tokens automatically without needing a
// second MantineProvider or hand-maintained dark color overrides.
const DARK_CHROME_KEY = "maktaba-dark-chrome";

export function getStoredDarkChrome(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(DARK_CHROME_KEY) === "true";
}

interface AppThemeContextValue {
  appTheme: AppThemeName;
  setAppTheme: (theme: AppThemeName) => void;
  darkChrome: boolean;
  setDarkChrome: (enabled: boolean) => void;
}

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [appTheme, setAppThemeState] = useState<AppThemeName>(getStoredAppTheme);
  const [darkChrome, setDarkChromeState] = useState<boolean>(getStoredDarkChrome);

  const value = useMemo<AppThemeContextValue>(
    () => ({
      appTheme,
      setAppTheme: (theme) => {
        window.localStorage.setItem(STORAGE_KEY, theme);
        setAppThemeState(theme);
      },
      darkChrome,
      setDarkChrome: (enabled) => {
        window.localStorage.setItem(DARK_CHROME_KEY, String(enabled));
        setDarkChromeState(enabled);
      },
    }),
    [appTheme, darkChrome],
  );

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useAppTheme(): AppThemeContextValue {
  const ctx = useContext(AppThemeContext);
  if (!ctx) {
    throw new Error("useAppTheme must be used within AppThemeProvider");
  }
  return ctx;
}
