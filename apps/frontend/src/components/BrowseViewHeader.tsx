import { ActionIcon, Group, Title } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import { useLanguage } from "../i18n/LanguageContext";

interface BrowseViewHeaderProps {
  title: string;
  onBack: () => void;
}

// Shared by AuthorsView/CollectionsView/SeriesView/TagsView - matches FilterBar.tsx's own header
// bar (px="md" py="sm" + a bottom border) exactly, so switching between the library grid/list and
// a browse view doesn't jump the content area's top edge to a different height.
export function BrowseViewHeader({ title, onBack }: BrowseViewHeaderProps) {
  const { t } = useLanguage();

  return (
    <Group
      px="md"
      py="sm"
      gap="sm"
      wrap="nowrap"
      style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
    >
      <ActionIcon variant="default" onClick={onBack} aria-label={t("common.back")}>
        <IconArrowLeft size={16} />
      </ActionIcon>
      <Title order={3} fz="md">
        {title}
      </Title>
    </Group>
  );
}
