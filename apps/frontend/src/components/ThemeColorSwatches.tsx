import { useState } from "react";
import { ActionIcon, ColorPicker, Group, Popover, Tooltip } from "@mantine/core";
import { IconCheck } from "../icons";
import { useLanguage } from "../i18n/LanguageContext";
import { CUSTOM_THEME_COLOR, THEME_COLOR_OPTIONS, type ThemeColorName } from "../theme";
import { useThemeColor } from "../ThemeColorContext";

// Accent-color picker for the "Plain" app theme (Settings -> General, and the title bar's own theme
// menu) - shared so both surfaces stay in sync and look identical. No-op visually for "Organic",
// which hardcodes its own terracotta accent - callers only render this when appTheme === "white".
// The swatch grid covers Mantine's own built-in palettes; the last swatch (a rainbow wheel) opens a
// full color picker for an arbitrary hex, generated into a full shade ramp on selection - see
// theme.ts's createWhiteTheme/CUSTOM_THEME_COLOR.
export function ThemeColorSwatches({ size = 22 }: { size?: number }) {
  const { t } = useLanguage();
  const { themeColor, setThemeColor, customColorHex, setCustomColorHex } = useThemeColor();
  const [pickerOpened, setPickerOpened] = useState(false);

  return (
    <Group gap={6} maw={7 * (size + 6)}>
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

      <Popover opened={pickerOpened} onChange={setPickerOpened} position="bottom" shadow="md" withinPortal>
        <Popover.Target>
          <Tooltip label={t("settings.accentColor.custom")}>
            <ActionIcon
              variant="transparent"
              size={size}
              radius="xl"
              aria-label={t("settings.accentColor.custom")}
              onClick={() => setPickerOpened((o) => !o)}
              style={{
                background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)",
                border: themeColor === CUSTOM_THEME_COLOR ? "2px solid var(--mantine-color-body)" : "none",
              }}
            >
              {themeColor === CUSTOM_THEME_COLOR && <IconCheck size={12} color="white" />}
            </ActionIcon>
          </Tooltip>
        </Popover.Target>
        <Popover.Dropdown>
          <ColorPicker
            format="hex"
            value={customColorHex}
            onChange={(hex) => {
              setCustomColorHex(hex);
              setThemeColor(CUSTOM_THEME_COLOR);
            }}
          />
        </Popover.Dropdown>
      </Popover>
    </Group>
  );
}
