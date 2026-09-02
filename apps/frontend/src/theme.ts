import {
  createTheme,
  DEFAULT_THEME,
  rem,
  type CSSVariablesResolver,
  type MantineColorsTuple,
  type MantineThemeOverride,
} from "@mantine/core";
import { generateColors } from "@mantine/colors-generator";

// Selectable accent color for the "Plain" app theme (Settings -> Appearance, and the Sidebar/title
// bar's own theme menu - see ThemeColorContext.tsx) - the named options are Mantine's own built-in
// palettes so the app stays visually stock Mantine; "custom" (below) additionally lets the user
// pick an arbitrary hex, generated into a full shade ramp via @mantine/colors-generator. "Organic"
// doesn't use any of this - it hardcodes terracotta as part of its own design system (see
// createOrganicTheme below).
export type ThemeColorName =
  | "gray"
  | "red"
  | "pink"
  | "grape"
  | "violet"
  | "indigo"
  | "blue"
  | "cyan"
  | "teal"
  | "green"
  | "lime"
  | "yellow"
  | "orange";

export const DEFAULT_THEME_COLOR: ThemeColorName = "blue";

// The custom color family's registered name in the theme's `colors` map (see createWhiteTheme) -
// distinct from any ThemeColorName so the two selection modes never collide.
export const CUSTOM_THEME_COLOR = "custom";

export const DEFAULT_CUSTOM_THEME_COLOR_HEX = "#844fba";

export const THEME_COLOR_OPTIONS: { value: ThemeColorName; label: string; swatch: string }[] = [
  { value: "gray", label: "Gray", swatch: DEFAULT_THEME.colors.gray[6] },
  { value: "red", label: "Red", swatch: DEFAULT_THEME.colors.red[6] },
  { value: "pink", label: "Pink", swatch: DEFAULT_THEME.colors.pink[6] },
  { value: "grape", label: "Grape", swatch: DEFAULT_THEME.colors.grape[6] },
  { value: "violet", label: "Violet", swatch: DEFAULT_THEME.colors.violet[6] },
  { value: "indigo", label: "Indigo", swatch: DEFAULT_THEME.colors.indigo[6] },
  { value: "blue", label: "Blue", swatch: DEFAULT_THEME.colors.blue[6] },
  { value: "cyan", label: "Cyan", swatch: DEFAULT_THEME.colors.cyan[6] },
  { value: "teal", label: "Teal", swatch: DEFAULT_THEME.colors.teal[6] },
  { value: "green", label: "Green", swatch: DEFAULT_THEME.colors.green[6] },
  { value: "lime", label: "Lime", swatch: DEFAULT_THEME.colors.lime[6] },
  { value: "yellow", label: "Yellow", swatch: DEFAULT_THEME.colors.yellow[6] },
  { value: "orange", label: "Orange", swatch: DEFAULT_THEME.colors.orange[6] },
];

/**
 * Maktaba's "Organic" design system: warm, rounded, a little playful. Everything below is driven
 * from a small set of hand-picked colors (see the ramps just below) rather than Mantine's stock
 * blue/gray defaults - this is a deliberate, from-scratch visual identity, not a tweak of the
 * library look.
 */

// Each ramp goes light (0) -> dark (9), the order Mantine's own hover/lighten/darken math expects.
// terracotta[6] and sage[6] are the "base" colors called out in the design brief; terracotta[4]
// and sage[4] are the brighter "for dark backgrounds" variants - rather than breaking the ramp's
// monotonic ordering by placing a *lighter* shade after a darker one, the theme's primaryShade is
// set to { light: 6, dark: 4 } below so dark mode actually resolves to that brighter shade.
const terracotta: MantineColorsTuple = [
  "#fff2eb",
  "#ffe0cf",
  "#fdc7a5",
  "#f7ab7c",
  "#e8945c",
  "#d67f47",
  "#c67139",
  "#a85f2f",
  "#8a4d26",
  "#6d3c1e",
];

const sage: MantineColorsTuple = [
  "#f0fae1",
  "#e2f0c9",
  "#cbe3a4",
  "#b8d488",
  "#a9c17e",
  "#8ea86a",
  "#7a8a5e",
  "#64714c",
  "#4f5a3c",
  "#3c452d",
];

// Semantic surface colors (app background / card-and-dialog surface / body text / hairline
// dividers) - light and dark values for each, resolved into Mantine's own CSS variables by
// organicCssVariablesResolver below rather than theme.white/theme.black (which only cover one
// scheme each and don't let bg/surface differ from each other).
// Light mode ("sepia") deliberately inverts the usual light-surface-on-lighter-bg relationship -
// the sidebar/title bar (surface) read as a darker parchment band framing a lighter, brighter
// reading area (bg) in the middle, rather than the two being nearly indistinguishable.
const semantic = {
  bg: { light: "#f5ead8", dark: "#242019" },
  surface: { light: "#ebddc5", dark: "#332c22" },
  text: { light: "#201e1d", dark: "#f3ead9" },
  // Secondary/dimmed text - not specified directly in the brief, derived as a warm mid-tone between
  // each scheme's text and bg so it stays legible without reintroducing cool grays.
  dimmed: { light: "#78685a", dark: "#c9bcaa" },
  divider: { light: "rgba(0, 0, 0, 0.16)", dark: "rgba(255, 255, 255, 0.16)" },
};

// Fully rounded - used directly (not via the radius scale) on every pill-shaped control called out
// in the design brief, so it can't be shadowed by an unrelated radius="xl" elsewhere. Mantine's
// radius prop takes a scale key or a raw number (px), not an arbitrary CSS length string.
const PILL_RADIUS = 999;

// Warm brown-tinted, low-opacity shadows (never pure black) tuned to sit on the cream `bg` color.
const organicShadows = {
  xs: "0 1px 2px rgba(101, 66, 42, 0.08)",
  sm: "0 2px 6px rgba(101, 66, 42, 0.10), 0 1px 2px rgba(101, 66, 42, 0.06)",
  md: "0 6px 16px rgba(101, 66, 42, 0.12), 0 2px 4px rgba(101, 66, 42, 0.08)",
  lg: "0 12px 28px rgba(101, 66, 42, 0.14), 0 4px 8px rgba(101, 66, 42, 0.08)",
  xl: "0 20px 44px rgba(101, 66, 42, 0.16), 0 8px 16px rgba(101, 66, 42, 0.10)",
};

// Plain Mantine, no customization at all beyond the selected accent color - added back alongside
// "Organic" (below) as a selectable second option (Settings -> Appearance) for anyone who wants the
// app to look the way it did before the Organic redesign. No cssVariablesResolver is applied when
// this theme is active either (see main.tsx) - organicCssVariablesResolver's overrides would
// otherwise leak into this theme too since MantineProvider's resolver isn't itself scoped per-theme.
// `customColorHex` is only consulted when primaryColor is CUSTOM_THEME_COLOR (see
// ThemeColorContext.tsx) - generateColors turns the single hex into the full 10-shade ramp Mantine
// needs for a `colors` entry.
export function createWhiteTheme(
  primaryColor: ThemeColorName | typeof CUSTOM_THEME_COLOR = DEFAULT_THEME_COLOR,
  customColorHex: string = DEFAULT_CUSTOM_THEME_COLOR_HEX,
): MantineThemeOverride {
  if (primaryColor === CUSTOM_THEME_COLOR) {
    return createTheme({ primaryColor: CUSTOM_THEME_COLOR, colors: { [CUSTOM_THEME_COLOR]: generateColors(customColorHex) } });
  }
  return createTheme({ primaryColor });
}

export function createOrganicTheme(): MantineThemeOverride {
  return createTheme({
    colors: { terracotta, sage },
    primaryColor: "terracotta",
    autoContrast: true,

    defaultRadius: "md",
    radius: {
      xs: rem(8),
      sm: rem(12),
      md: rem(16),
      lg: rem(20),
      xl: rem(24),
    },

    // ~1.10x Mantine's own defaults (10/12/16/20/32px) for a slightly airier, less cramped layout.
    spacing: {
      xs: rem(11),
      sm: rem(13),
      md: rem(17.6),
      lg: rem(22),
      xl: rem(35.2),
    },

    shadows: organicShadows,

    components: {
      Button: {
        defaultProps: { radius: PILL_RADIUS },
      },
      ActionIcon: {
        defaultProps: { radius: PILL_RADIUS },
      },
      TextInput: {
        defaultProps: { radius: PILL_RADIUS },
      },
      Select: {
        defaultProps: { radius: PILL_RADIUS },
      },
      Autocomplete: {
        defaultProps: { radius: PILL_RADIUS },
      },
      PasswordInput: {
        defaultProps: { radius: PILL_RADIUS },
      },
      NumberInput: {
        defaultProps: { radius: PILL_RADIUS },
      },
      Badge: {
        defaultProps: { radius: PILL_RADIUS, variant: "light" },
      },
      Paper: {
        defaultProps: { radius: 20, shadow: "sm" },
        styles: { root: { backgroundColor: "var(--app-surface)" } },
      },
      Card: {
        defaultProps: { radius: 20, shadow: "sm" },
        styles: { root: { backgroundColor: "var(--app-surface)" } },
      },
      Modal: {
        defaultProps: { radius: 26, shadow: "lg" },
        styles: {
          content: { backgroundColor: "var(--app-surface)" },
          header: { backgroundColor: "var(--app-surface)" },
        },
      },
      SegmentedControl: {
        defaultProps: { radius: PILL_RADIUS },
        styles: {
          root: { backgroundColor: "var(--mantine-color-default-hover)" },
          indicator: { backgroundColor: "var(--mantine-primary-color-filled)", boxShadow: "none" },
          control: { border: "none" },
        },
      },
      Tabs: {
        styles: {
          // Mantine's default Tabs.List border is a plain 2px solid line at full opacity - swapped
          // for the theme's own soft divider so tabs read as "underline in terracotta, no boxy
          // borders" per the design brief rather than a hard ruled line.
          list: { borderBottom: `1px solid var(--mantine-color-default-border)` },
        },
      },
    },
  });
}

// Resolves the semantic bg/surface/text/divider colors above into the actual CSS custom properties
// Mantine and the rest of the app read - --mantine-color-body/text/dimmed/default-border for the
// vars Mantine's own components already key off of, plus a --app-surface var (consumed by the
// Paper/Card/Modal style overrides above) since Mantine has no single existing var that means
// "elevated surface, distinct from the page background" the way this design system wants.
export const organicCssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    "--mantine-color-body": semantic.bg.light,
    "--app-surface": semantic.surface.light,
    "--mantine-color-white": semantic.surface.light,
    "--mantine-color-default": semantic.surface.light,
    "--mantine-color-default-hover": "rgba(0, 0, 0, 0.04)",
    "--mantine-color-text": semantic.text.light,
    "--mantine-color-bright": semantic.text.light,
    "--mantine-color-dimmed": semantic.dimmed.light,
    "--mantine-color-placeholder": semantic.dimmed.light,
    "--mantine-color-default-border": semantic.divider.light,
  },
  // Dark mode intentionally left at Mantine's own stock dark palette (bg/surface/text/border all
  // untouched) - an earlier pass gave it the same custom near-black brown treatment as light mode's
  // parchment look, which read as too dark/muddy. --app-surface still needs *something* (the Paper/
  // Card/Modal style overrides above reference it unconditionally), so it points at Mantine's own
  // --mantine-color-dark-6 (its usual "elevated surface" shade) rather than a hand-picked color.
  dark: {
    "--app-surface": "var(--mantine-color-dark-6)",
  },
});
