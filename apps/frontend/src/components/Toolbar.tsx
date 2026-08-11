import { ActionIcon, Divider, Group, Text, Tooltip } from "@mantine/core";
import {
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconPlus,
} from "@tabler/icons-react";
import { useLanguage } from "../i18n/LanguageContext";

interface ToolbarProps {
  contextLabel: string;
  onImport: () => void;
  bookCount: number;
  navbarOpen: boolean;
  onToggleNavbar: () => void;
}

export function Toolbar({ contextLabel, onImport, bookCount, navbarOpen, onToggleNavbar }: ToolbarProps) {
  const { t } = useLanguage();

  return (
    <Group
      h={60}
      wrap="nowrap"
      gap="md"
      px="lg"
      style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
    >
      <ActionIcon
        variant="subtle"
        color="gray"
        size="lg"
        onClick={onToggleNavbar}
        aria-label={t("sidebar.toggleNavbar")}
        style={{ flexShrink: 0 }}
      >
        {navbarOpen ? <IconLayoutSidebarLeftCollapse size={18} /> : <IconLayoutSidebarLeftExpand size={18} />}
      </ActionIcon>

      <Text ff="var(--mantine-font-family-headings)" fw={600} fz={22} style={{ flexShrink: 0 }}>
        مکتبہ
      </Text>
      <Divider orientation="vertical" style={{ height: 24, alignSelf: "center", flexShrink: 0 }} />
      <Text fz={13} c="dimmed" style={{ flexShrink: 0 }} truncate="end" maw={320}>
        {contextLabel}
      </Text>

      <div style={{ flex: 1 }} />

      <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
        {t(bookCount === 1 ? "toolbar.bookCount_one" : "toolbar.bookCount_other", { count: bookCount })}
      </Text>

      <Divider orientation="vertical" style={{ height: 24, alignSelf: "center", flexShrink: 0 }} />

      <Tooltip label={t("toolbar.addBooks")}>
        <ActionIcon
          variant="filled"
          size="lg"
          onClick={onImport}
          aria-label={t("toolbar.addBooks")}
          style={{ flexShrink: 0 }}
        >
          <IconPlus size={18} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
