export type UrduFontName = "nastaliq" | "naskh" | "gulzar";

export const DEFAULT_URDU_FONT: UrduFontName = "naskh";

export const URDU_FONT_OPTIONS: { value: UrduFontName; label: string; stack: string }[] = [
  { value: "nastaliq", label: "Noto Nastaliq Urdu", stack: `"Noto Nastaliq Urdu", system-ui, sans-serif` },
  { value: "naskh", label: "Noto Sans Arabic", stack: `"Noto Sans Arabic", system-ui, sans-serif` },
  { value: "gulzar", label: "Gulzar", stack: `"Gulzar", "Noto Nastaliq Urdu", system-ui, sans-serif` },
];
