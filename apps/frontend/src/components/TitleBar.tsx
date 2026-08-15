import { useEffect, useState } from "react";
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

// The WICG Window Controls Overlay API (https://github.com/WICG/window-controls-overlay) that
// Electron's win/linux titleBarOverlay is built on - not yet in TS's lib.dom.d.ts, so declared
// here. getTitlebarAreaRect() gives the actual safe-content rectangle (whichever physical side the
// caption buttons are really on, at their real rendered width for the current theme/DPI/RTL
// state), and geometrychange fires whenever that rectangle changes.
interface WindowControlsOverlay extends EventTarget {
  visible: boolean;
  getTitlebarAreaRect: () => DOMRect;
}

declare global {
  interface Navigator {
    windowControlsOverlay?: WindowControlsOverlay;
  }
}

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
  // The win/linux safe-content rectangle, measured live - see the WindowControlsOverlay
  // declaration above. Previous attempts at this reserved a hardcoded pixel width via CSS
  // (paddingRight: 138, and later env(titlebar-area-*)) and both were wrong in practice: the
  // caption buttons' actual width/side varies by Windows theme/DPI/RTL in ways a guessed constant
  // or an apparently-unpopulated env() value didn't track, clipping content under LTR and hiding
  // most of the bar under RTL. This reads Chromium's own live overlay geometry instead.
  const [overlayRect, setOverlayRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (isMac) return;
    const overlay = navigator.windowControlsOverlay;
    if (!overlay) return;

    const update = () => setOverlayRect(overlay.visible ? overlay.getTitlebarAreaRect() : null);
    update();
    overlay.addEventListener("geometrychange", update);
    return () => overlay.removeEventListener("geometrychange", update);
  }, [isMac]);

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
        overflow: "hidden",
        // Reserves space for the native controls so our own content never sits under them. mac's
        // traffic lights are a fixed native offset from the top-left regardless of app direction,
        // so that side stays hardcoded. win/linux uses the live-measured overlayRect (see above);
        // until the first geometrychange fires we fall back to the old best-guess constants rather
        // than rendering with zero reservation.
        paddingLeft: isMac ? 80 : (overlayRect?.x ?? 12),
        paddingRight: isMac ? 12 : overlayRect ? window.innerWidth - overlayRect.x - overlayRect.width : 150,
      }}
    >
      <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        <Text ff="var(--mantine-font-family-headings)" fw={600} fz={16} ms={8} style={{ flexShrink: 0 }}>
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
          me={8}
          style={{ flexShrink: 0 }}
        >
          {t("toolbar.addBooks")}
        </Button>
      )}
    </Box>
  );
}
