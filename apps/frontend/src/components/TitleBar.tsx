import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { spotlight } from "@mantine/spotlight";
import {
  ActionIcon,
  Box,
  Button,
  Divider,
  Group,
  Kbd,
  Text,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme,
} from "@mantine/core";
import {
  IconBookmark,
  IconBooks,
  IconCircleCheck,
  IconCircleDashed,
  IconHome2,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconPlus,
  IconSearch,
} from "@tabler/icons-react";
import type { Icon } from "@tabler/icons-react";
import { listReadingStatusCounts, type ReadingStatus } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import type { GroupFilter, MainView } from "./Sidebar";

// Must match TITLEBAR_HEIGHT in apps/desktop/src/main.ts (both the win/linux titleBarOverlay
// height and the mac trafficLightPosition.y are derived from that same constant). Exported so
// App.tsx can give AppShell's header slot the same height.
export const TITLEBAR_HEIGHT = 40;

interface TitleBarProps {
  hasLibrary: boolean;
  mainView: MainView;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenHome: () => void;
  onImport: () => void;
  activeFilter: GroupFilter | null;
  onSelect: (filter: GroupFilter | null) => void;
  onShowAllBooks: () => void;
}

// All books/Unread/Reading/Finished - see Sidebar.tsx's view bar (Authors/Collections/Series/Tags)
// for the mutual-exclusivity comment: these two rows share one activeFilter, so at most one of
// them ever shows a selection at a time.
function ReadingStatusFilters({
  activeFilter,
  onSelect,
  libraryActive,
  onShowAllBooks,
}: {
  activeFilter: GroupFilter | null;
  onSelect: (filter: GroupFilter | null) => void;
  libraryActive: boolean;
  onShowAllBooks: () => void;
}) {
  const { t } = useLanguage();
  const statusQuery = useQuery({ queryKey: ["readingStatusCounts"], queryFn: listReadingStatusCounts });

  const labels: Record<ReadingStatus, string> = {
    Unread: t("readingStatus.unread"),
    Reading: t("readingStatus.reading"),
    Finished: t("readingStatus.finished"),
  };

  const icons: Record<ReadingStatus, Icon> = {
    Unread: IconCircleDashed,
    Reading: IconBookmark,
    Finished: IconCircleCheck,
  };

  return (
    <Group gap={4} wrap="nowrap" className="maktaba-titlebar-no-drag">
      <Tooltip label={t("toolbar.allBooks")}>
        <ActionIcon
          variant={libraryActive ? "light" : "subtle"}
          color="gray"
          onClick={onShowAllBooks}
          aria-label={t("toolbar.allBooks")}
        >
          <IconBooks size={16} />
        </ActionIcon>
      </Tooltip>
      {statusQuery.data?.map(({ status, count }) => {
        const isActive = activeFilter?.kind === "readingStatus" && activeFilter.id === status;
        const StatusIcon = icons[status];
        return (
          <Tooltip key={status} label={`${labels[status]} (${count})`}>
            <ActionIcon
              variant={isActive ? "light" : "subtle"}
              color="gray"
              onClick={() => onSelect(isActive ? null : { kind: "readingStatus", id: status, name: labels[status] })}
              aria-label={`${labels[status]} (${count})`}
            >
              <StatusIcon size={16} />
            </ActionIcon>
          </Tooltip>
        );
      })}
    </Group>
  );
}

// Renders in place of the OS title bar (main.ts sets titleBarStyle: "hidden" on the main window)
// so it's mounted unconditionally by App.tsx — even before a library is open — otherwise the
// frameless window would have no drag region at all, just the native min/max/close controls.
// Left: branding, sidebar collapse toggle, Home, then the All books/reading-status filter row.
// Middle: Search, styled as a text box rather than a bare icon. Right: a labeled Add Books button.
// Everything else (browse sections, library switcher, dark mode, language, Settings) stays in the
// sidebar - see Sidebar.tsx.
export function TitleBar({
  hasLibrary,
  mainView,
  collapsed,
  onToggleCollapsed,
  onOpenHome,
  onImport,
  activeFilter,
  onSelect,
  onShowAllBooks,
}: TitleBarProps) {
  const { t } = useLanguage();
  const colorScheme = useComputedColorScheme("light");
  const isMac = window.maktaba.platform === "darwin";
  const libraryActive = mainView === "library" && !activeFilter;

  // Keeps the native win/linux caption-button strip's colors matching the app's own light/dark
  // setting rather than the OS default, which can otherwise mismatch the page right next to it.
  useEffect(() => {
    void window.maktaba.setTitleBarOverlay(colorScheme);
  }, [colorScheme]);

  return (
    <Box
      className="maktaba-titlebar-drag"
      h={TITLEBAR_HEIGHT}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexShrink: 0,
        borderBottom: "1px solid var(--mantine-color-default-border)",
        boxSizing: "border-box",
        // Reserves space for the native controls so our own content never sits under them. mac's
        // traffic lights are a fixed native offset from the top-left regardless of app direction,
        // so that side stays hardcoded. win/linux's titleBarOverlay caption buttons can sit on
        // either physical side (they move to the left under RTL/Urdu - see Electron's custom
        // title bar docs) and their actual reserved width varies by Windows theme/DPI, so instead
        // of guessing a pixel width, we read Chromium's own `env(titlebar-area-*)` values, which
        // already describe the exact safe content rectangle for whichever side/width the overlay
        // actually occupies. paddingLeft skips to the safe area's start; paddingRight is whatever
        // remains between the safe area's end and the full-width box's right edge.
        paddingLeft: isMac ? 80 : "env(titlebar-area-x, 12px)",
        paddingRight: isMac
          ? 12
          : "calc(100% - env(titlebar-area-x, 12px) - env(titlebar-area-width, calc(100% - 150px)))",
      }}
    >
      <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        <Text ff="var(--mantine-font-family-headings)" fw={600} fz={16} style={{ flexShrink: 0 }}>
          {t("app.name")}
        </Text>

        {hasLibrary && (
          <>
            <Tooltip label={t(collapsed ? "sidebar.expand" : "sidebar.collapse")}>
              <ActionIcon
                className="maktaba-titlebar-no-drag"
                variant="subtle"
                color="gray"
                onClick={onToggleCollapsed}
                aria-label={t(collapsed ? "sidebar.expand" : "sidebar.collapse")}
              >
                {collapsed ? <IconLayoutSidebarLeftExpand size={16} /> : <IconLayoutSidebarLeftCollapse size={16} />}
              </ActionIcon>
            </Tooltip>

            <Tooltip label={t("toolbar.home")}>
              <ActionIcon
                className="maktaba-titlebar-no-drag"
                variant={mainView === "home" ? "light" : "subtle"}
                color="gray"
                onClick={onOpenHome}
                aria-label={t("toolbar.home")}
              >
                <IconHome2 size={16} />
              </ActionIcon>
            </Tooltip>

            <Divider orientation="vertical" h={20} />

            <ReadingStatusFilters
              activeFilter={activeFilter}
              onSelect={onSelect}
              libraryActive={libraryActive}
              onShowAllBooks={onShowAllBooks}
            />
          </>
        )}
      </Group>

      {hasLibrary && (
        <Box style={{ flex: 1, display: "flex", justifyContent: "center", minWidth: 0 }}>
          <UnstyledButton
            className="maktaba-titlebar-no-drag"
            onClick={() => spotlight.open()}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              maxWidth: 360,
              padding: "4px 10px",
              border: "1px solid var(--mantine-color-default-border)",
              borderRadius: "var(--mantine-radius-sm)",
              backgroundColor: "var(--mantine-color-body)",
            }}
          >
            <IconSearch size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
            <Text size="xs" c="dimmed" style={{ flex: 1, minWidth: 0 }} truncate="end">
              {t("toolbar.searchPlaceholder")}
            </Text>
            <Kbd size="xs" style={{ flexShrink: 0 }}>
              Ctrl K
            </Kbd>
          </UnstyledButton>
        </Box>
      )}

      {hasLibrary && (
        <Button
          className="maktaba-titlebar-no-drag"
          leftSection={<IconPlus size={15} />}
          variant="outline"
          size="xs"
          onClick={onImport}
          style={{ flexShrink: 0 }}
        >
          {t("toolbar.addBooks")}
        </Button>
      )}
    </Box>
  );
}
