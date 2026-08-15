import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Box, Menu, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { IconBooks, IconCheck, IconChevronDown, IconSettings } from "@tabler/icons-react";
import { listLibraries, openLibraryById } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { invalidateLibraryQueries } from "../queries";

interface LibrarySwitcherProps {
  // Same "did the active library's identity/contents change" contract as
  // LibrariesSettings.tsx's onActiveLibraryChanged - both end up calling App.tsx's
  // handleLibraryChanged, which resets selection/filters and jumps back to the library view.
  onLibraryChanged: () => void;
  onManage: () => void;
  // Icon-only trigger (no name/chevron) for the sidebar's collapsed rail mode, where there isn't
  // room for the full name - the dropdown contents are identical either way.
  compact?: boolean;
}

// A sidebar-bottom dropdown for switching between libraries the user has opened before, mirroring
// Settings -> Libraries' switch action (LibrariesSettings.tsx) without leaving the current view.
export function LibrarySwitcher({ onLibraryChanged, onManage, compact }: LibrarySwitcherProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const librariesQuery = useQuery({ queryKey: ["libraries"], queryFn: listLibraries });
  const active = librariesQuery.data?.find((entry) => entry.isActive);

  const switchMutation = useMutation({
    mutationFn: (id: string) => openLibraryById(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["libraries"] });
      void queryClient.invalidateQueries({ queryKey: ["library"] });
      invalidateLibraryQueries(queryClient);
      onLibraryChanged();
    },
  });

  if (!librariesQuery.data || librariesQuery.data.length === 0) {
    return null;
  }

  return (
    <Menu shadow="md" width={220} position="top-start" withinPortal>
      <Menu.Target>
        {compact ? (
          <Tooltip label={active?.name ?? t("settings.libraries")}>
            <ActionIcon variant="subtle" color="gray" size="lg" aria-label={t("settings.libraries")}>
              <IconBooks size={17} />
            </ActionIcon>
          </Tooltip>
        ) : (
          <UnstyledButton
            px={8}
            py={4}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              minWidth: 0,
              flex: 1,
              borderRadius: "var(--mantine-radius-sm)",
            }}
          >
            <IconBooks size={15} style={{ flexShrink: 0, opacity: 0.6 }} />
            <Text size="xs" fw={500} truncate="end" style={{ minWidth: 0, flex: 1 }}>
              {active?.name ?? "…"}
            </Text>
            <IconChevronDown size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
          </UnstyledButton>
        )}
      </Menu.Target>

      <Menu.Dropdown>
        {librariesQuery.data.map((entry) => (
          <Menu.Item
            key={entry.id}
            leftSection={entry.isActive ? <IconCheck size={14} /> : <Box w={14} />}
            disabled={switchMutation.isPending}
            onClick={() => {
              if (!entry.isActive) switchMutation.mutate(entry.id);
            }}
          >
            {entry.name}
          </Menu.Item>
        ))}
        <Menu.Divider />
        <Menu.Item leftSection={<IconSettings size={14} />} onClick={onManage}>
          {t("librariesSettings.manage")}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
