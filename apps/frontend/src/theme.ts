import { createTheme, type MantineColorsTuple } from "@mantine/core";

// Ported from design/styles.css (the "Classical" design system) — see
// design/design-system-readme (1).md for the rationale behind each choice.
// The design system itself is light-only; the `dark` ramp below is this
// port's own extrapolation (warm near-black ground, same gold accent),
// since Maktaba's color-scheme toggle predates this design and shouldn't
// regress. Nothing here is pixel-sourced from a dark mockup.

// design/styles.css --color-neutral-100..900, with --color-bg prepended as
// the 10th (lightest) step Mantine's tuple shape requires.
const neutral: MantineColorsTuple = [
  "#f3f2f2",
  "#f8f4f4",
  "#eae7e7",
  "#d7d3d3",
  "#bab6b6",
  "#9b9797",
  "#7d7979",
  "#605d5d",
  "#444141",
  "#2d2b2b",
];

// design/styles.css --color-accent-100..900, with a lighter cream tint
// prepended. Design guidance (design-system-readme): "for paragraph-size
// text in the accent use a deep ramp step (--color-accent-700) rather than
// the accent itself" — accent-700 (index 7) is this theme's primary shade,
// not the raw base #b68235.
const accent: MantineColorsTuple = [
  "#fff9f0",
  "#fff3e4",
  "#ffe3bf",
  "#facb8d",
  "#e1ad66",
  "#c28d41",
  "#a06f24",
  "#7d5411",
  "#5a3b0a",
  "#3a270d",
];

// This port's own warm-near-black extrapolation for dark mode (see note
// above) — same rough lightness curve as Mantine's default `dark` ramp,
// recolored warm instead of cool-gray.
const dark: MantineColorsTuple = [
  "#ece7e1",
  "#cfc9c2",
  "#b3ada6",
  "#7d7770",
  "#59534d",
  "#423d38",
  "#35312c",
  "#262320",
  "#1c1a17",
  "#14120f",
];

export const theme = createTheme({
  primaryColor: "accent",
  primaryShade: { light: 7, dark: 3 },
  colors: { accent, gray: neutral, dark },
  white: "#f3f2f2",
  black: "#201f1d",
  fontFamily: "'Lora', system-ui, sans-serif",
  fontFamilyMonospace: "ui-monospace, Consolas, monospace",
  headings: {
    fontFamily: "'Cormorant Garamond', system-ui, sans-serif",
    fontWeight: "600", // Classical never sets headings bold, only up to semibold
  },
  defaultRadius: "sm",
  radius: { xs: "2px", sm: "2px", md: "4px", lg: "7px", xl: "7px" },
  shadows: {
    xs: "0 1px 2px rgba(45, 43, 43, 0.14)",
    sm: "0 1px 2px rgba(45, 43, 43, 0.14)",
    md: "0 3px 10px rgba(45, 43, 43, 0.16)",
    lg: "0 12px 32px rgba(45, 43, 43, 0.22)",
    xl: "0 12px 32px rgba(45, 43, 43, 0.22)",
  },
  components: {
    Button: {
      defaultProps: { variant: "outline" }, // .btn-primary: outlined accent, never filled
      styles: {
        root: { fontFamily: "'Cormorant Garamond', system-ui, sans-serif", fontWeight: 600 },
      },
    },
    Divider: {
      defaultProps: { color: "var(--mantine-color-default-border)" },
    },
    Badge: {
      defaultProps: { radius: "sm", tt: "none", fw: 400 },
    },
    SegmentedControl: {
      defaultProps: { radius: "sm" },
    },
    Modal: {
      defaultProps: { centered: true, radius: "md", overlayProps: { backgroundOpacity: 0.35, blur: 2 } },
      styles: {
        title: { fontFamily: "'Cormorant Garamond', system-ui, sans-serif", fontWeight: 600, fontSize: 20 },
      },
    },
    Drawer: {
      defaultProps: { overlayProps: { backgroundOpacity: 0.35, blur: 2 } },
      styles: {
        title: { fontFamily: "'Cormorant Garamond', system-ui, sans-serif", fontWeight: 600, fontSize: 20 },
      },
    },
  },
});
