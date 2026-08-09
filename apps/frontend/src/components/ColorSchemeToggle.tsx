import { ActionIcon, Tooltip, useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import { IconMoon, IconSun } from "@tabler/icons-react";
import { useLanguage } from "../i18n/LanguageContext";

export function ColorSchemeToggle() {
  const { t } = useLanguage();
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("light");

  return (
    <Tooltip label={t("toolbar.colorSchemeToggle")}>
      <ActionIcon
        variant="default"
        size="lg"
        aria-label={t("toolbar.colorSchemeToggle")}
        onClick={() => setColorScheme(computedColorScheme === "light" ? "dark" : "light")}
      >
        {computedColorScheme === "light" ? <IconMoon size={16} /> : <IconSun size={16} />}
      </ActionIcon>
    </Tooltip>
  );
}
