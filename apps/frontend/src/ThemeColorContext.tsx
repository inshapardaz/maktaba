import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_THEME_COLOR, THEME_COLOR_OPTIONS, type ThemeColorName } from "./theme";

const STORAGE_KEY = "maktaba-theme-color";
const VALID_VALUES = new Set<string>(THEME_COLOR_OPTIONS.map((option) => option.value));

export function getStoredThemeColor(): ThemeColorName {
  if (typeof window === "undefined") {
    return DEFAULT_THEME_COLOR;
  }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored && VALID_VALUES.has(stored) ? (stored as ThemeColorName) : DEFAULT_THEME_COLOR;
}

interface ThemeColorContextValue {
  themeColor: ThemeColorName;
  setThemeColor: (color: ThemeColorName) => void;
}

const ThemeColorContext = createContext<ThemeColorContextValue | null>(null);

export function ThemeColorProvider({ children }: { children: ReactNode }) {
  const [themeColor, setThemeColorState] = useState<ThemeColorName>(getStoredThemeColor);

  const value = useMemo<ThemeColorContextValue>(
    () => ({
      themeColor,
      setThemeColor: (color) => {
        window.localStorage.setItem(STORAGE_KEY, color);
        setThemeColorState(color);
      },
    }),
    [themeColor],
  );

  return <ThemeColorContext.Provider value={value}>{children}</ThemeColorContext.Provider>;
}

export function useThemeColor(): ThemeColorContextValue {
  const ctx = useContext(ThemeColorContext);
  if (!ctx) {
    throw new Error("useThemeColor must be used within ThemeColorProvider");
  }
  return ctx;
}
