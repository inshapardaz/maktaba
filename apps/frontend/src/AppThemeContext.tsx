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

interface AppThemeContextValue {
  appTheme: AppThemeName;
  setAppTheme: (theme: AppThemeName) => void;
}

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [appTheme, setAppThemeState] = useState<AppThemeName>(getStoredAppTheme);

  const value = useMemo<AppThemeContextValue>(
    () => ({
      appTheme,
      setAppTheme: (theme) => {
        window.localStorage.setItem(STORAGE_KEY, theme);
        setAppThemeState(theme);
      },
    }),
    [appTheme],
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
