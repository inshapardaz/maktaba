import { ActionIcon, Anchor, Breadcrumbs, Group, Title } from "@mantine/core";
import { IconArrowLeft } from "../icons";
import { useLanguage } from "../i18n/LanguageContext";

interface BrowseViewHeaderProps {
  title: string;
  onBack: () => void;
  // Optional breadcrumb parent segment (e.g. "All Periodicals") shown before the title, clickable
  // to the same destination as the back arrow - only needed where "back" leads somewhere with its
  // own name rather than an unlabeled generic list (AuthorsView/CollectionsView/etc. don't use this).
  parentLabel?: string;
}

// Shared by AuthorsView/CollectionsView/SeriesView/TagsView - matches FilterBar.tsx's own header
// bar (px="md" py="sm" + a bottom border) exactly, so switching between the library grid/list and
// a browse view doesn't jump the content area's top edge to a different height.
export function BrowseViewHeader({ title, onBack, parentLabel }: BrowseViewHeaderProps) {
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
      {parentLabel ? (
        <Breadcrumbs separator="/">
          <Anchor component="button" type="button" onClick={onBack} size="sm" c="dimmed">
            {parentLabel}
          </Anchor>
          <Title order={3} fz="md">
            {title}
          </Title>
        </Breadcrumbs>
      ) : (
        <Title order={3} fz="md">
          {title}
        </Title>
      )}
    </Group>
  );
}
