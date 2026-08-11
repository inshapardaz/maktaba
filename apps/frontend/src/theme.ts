import { DEFAULT_THEME, createTheme, type MantineThemeOverride } from "@mantine/core";

// Selectable accent color — see ThemeColorContext / Settings → Appearance. Limited to Mantine's
// own built-in palettes (no hand-rolled colors) so the app stays visually stock Mantine.
export type ThemeColorName = "blue" | "grape" | "green" | "orange" | "red";

export const DEFAULT_THEME_COLOR: ThemeColorName = "blue";

export const THEME_COLOR_OPTIONS: { value: ThemeColorName; label: string; swatch: string }[] = [
  { value: "blue", label: "Blue", swatch: DEFAULT_THEME.colors.blue[6] },
  { value: "grape", label: "Grape", swatch: DEFAULT_THEME.colors.grape[6] },
  { value: "green", label: "Green", swatch: DEFAULT_THEME.colors.green[6] },
  { value: "orange", label: "Orange", swatch: DEFAULT_THEME.colors.orange[6] },
  { value: "red", label: "Red", swatch: DEFAULT_THEME.colors.red[6] },
];

/**
 * Builds the Mantine theme for a given selected accent color. Called from main.tsx, re-invoked
 * whenever ThemeColorContext's persisted choice changes (see Settings → Appearance). Everything
 * else is left at Mantine's own defaults — no custom colors, radius, shadows, or component
 * style overrides.
 */
export function createAppTheme(primaryColor: ThemeColorName): MantineThemeOverride {
  return createTheme({ primaryColor });
}
