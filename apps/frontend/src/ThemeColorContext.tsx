import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { CUSTOM_THEME_COLOR, DEFAULT_CUSTOM_THEME_COLOR_HEX, DEFAULT_THEME_COLOR, THEME_COLOR_OPTIONS, type ThemeColorName } from "./theme";

const STORAGE_KEY = "maktaba-theme-color";
const CUSTOM_HEX_STORAGE_KEY = "maktaba-theme-color-custom-hex";
const VALID_VALUES = new Set<string>([...THEME_COLOR_OPTIONS.map((option) => option.value), CUSTOM_THEME_COLOR]);
const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

export function getStoredThemeColor(): ThemeColorName | typeof CUSTOM_THEME_COLOR {
  if (typeof window === "undefined") {
    return DEFAULT_THEME_COLOR;
  }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored && VALID_VALUES.has(stored) ? (stored as ThemeColorName | typeof CUSTOM_THEME_COLOR) : DEFAULT_THEME_COLOR;
}

export function getStoredCustomColorHex(): string {
  if (typeof window === "undefined") {
    return DEFAULT_CUSTOM_THEME_COLOR_HEX;
  }
  const stored = window.localStorage.getItem(CUSTOM_HEX_STORAGE_KEY);
  return stored && HEX_PATTERN.test(stored) ? stored : DEFAULT_CUSTOM_THEME_COLOR_HEX;
}

interface ThemeColorContextValue {
  themeColor: ThemeColorName | typeof CUSTOM_THEME_COLOR;
  setThemeColor: (color: ThemeColorName | typeof CUSTOM_THEME_COLOR) => void;
  // Only consulted (see theme.ts's createWhiteTheme) when themeColor === CUSTOM_THEME_COLOR - kept
  // separately so picking a hex doesn't itself select "custom" until the user actually means to
  // (the swatch grid and the custom picker are two distinct choices - see ThemeColorSwatches.tsx).
  customColorHex: string;
  setCustomColorHex: (hex: string) => void;
}

const ThemeColorContext = createContext<ThemeColorContextValue | null>(null);

export function ThemeColorProvider({ children }: { children: ReactNode }) {
  const [themeColor, setThemeColorState] = useState<ThemeColorName | typeof CUSTOM_THEME_COLOR>(getStoredThemeColor);
  const [customColorHex, setCustomColorHexState] = useState<string>(getStoredCustomColorHex);

  const value = useMemo<ThemeColorContextValue>(
    () => ({
      themeColor,
      setThemeColor: (color) => {
        window.localStorage.setItem(STORAGE_KEY, color);
        setThemeColorState(color);
      },
      customColorHex,
      setCustomColorHex: (hex) => {
        window.localStorage.setItem(CUSTOM_HEX_STORAGE_KEY, hex);
        setCustomColorHexState(hex);
      },
    }),
    [themeColor, customColorHex],
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
