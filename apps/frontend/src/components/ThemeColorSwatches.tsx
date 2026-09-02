import { ActionIcon, Group, Tooltip } from "@mantine/core";
import { IconCheck } from "../icons";
import { THEME_COLOR_OPTIONS, type ThemeColorName } from "../theme";
import { useThemeColor } from "../ThemeColorContext";

// Accent-color picker for the "White" app theme (Settings -> General, and the Sidebar's own theme
// menu) - shared so both surfaces stay in sync and look identical. No-op visually for "Organic",
// which hardcodes its own terracotta accent - callers only render this when appTheme === "white".
export function ThemeColorSwatches({ size = 22 }: { size?: number }) {
  const { themeColor, setThemeColor } = useThemeColor();

  return (
    <Group gap={6}>
      {THEME_COLOR_OPTIONS.map((option) => (
        <Tooltip key={option.value} label={option.label}>
          <ActionIcon
            variant="transparent"
            size={size}
            radius="xl"
            aria-label={option.label}
            onClick={() => setThemeColor(option.value as ThemeColorName)}
            style={{ backgroundColor: option.swatch, border: themeColor === option.value ? "2px solid var(--mantine-color-body)" : "none" }}
          >
            {themeColor === option.value && <IconCheck size={12} color="white" />}
          </ActionIcon>
        </Tooltip>
      ))}
    </Group>
  );
}
