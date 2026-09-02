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
  Menu,
  SegmentedControl,
  Text,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import {
  IconBookmark,
  IconBooks,
  IconChartBar,
  IconCircleCheck,
  IconCircleDashed,
  IconHelpCircle,
  IconHome2,
  IconMenu2,
  IconMoon,
  IconPalette,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSun,
} from "../icons";
import type { Icon } from "../icons";
import { listReadingStatusCounts, type ReadingStatus } from "../api";
import { useAppTheme, type AppThemeName } from "../AppThemeContext";
import { useLanguage } from "../i18n/LanguageContext";
import { LANGUAGES } from "../i18n/translations";
import { READING_STATUS_COLOR } from "../readingStatus";
import { ThemeColorSwatches } from "./ThemeColorSwatches";
import type { GroupFilter, MainView } from "./Sidebar";
import type { SettingsTab } from "./SettingsScreen";

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

// Shared by the real TitleBar below and by BackendGate.tsx's minimal loading/error bar (shown
// before the real one ever mounts) - factored out so both compute the exact same native-control
// safe area rather than duplicating (and risking drifting out of sync with) this measurement.
export function useTitleBarOverlayPadding(): { paddingLeft: number; paddingRight: number } {
  const isMac = window.maktaba.platform === "darwin";
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

  return {
    // Reserves space for the native controls so our own content never sits under them. mac's
    // traffic lights are a fixed native offset from the top-left regardless of app direction, so
    // that side stays hardcoded. win/linux uses the live-measured overlayRect (see above); until
    // the first geometrychange fires we fall back to the old best-guess constants rather than
    // rendering with zero reservation.
    paddingLeft: isMac ? 80 : (overlayRect?.x ?? 12),
    paddingRight: isMac ? 12 : overlayRect ? window.innerWidth - overlayRect.x - overlayRect.width : 150,
  };
}

// The app icon + name, used both as the real TitleBar's leftmost element and (standalone) as
// BackendGate.tsx's minimal loading/error bar - a single spot to change if the branding ever does.
export function TitleBarBrand() {
  const { t } = useLanguage();
  return (
    <Group gap={8} wrap="nowrap" ms={8} style={{ flexShrink: 0 }}>
      <img src="icon.png" alt="" width={20} height={20} style={{ borderRadius: 4, flexShrink: 0 }} />
      <Text ff="var(--mantine-font-family-headings)" fw={600} fz={16} style={{ flexShrink: 0 }}>
        {t("app.name")}
      </Text>
    </Group>
  );
}

// Opens the same File/Edit/View/Window/Help menu the reader pop-out windows show natively (see
// apps/desktop/src/menu.ts) as a native popup anchored under this button - the main window's
// custom title bar has no room for a full menu bar row (Window Controls Overlay reserves that
// whole strip for the draggable branding/buttons), so a button that pops the identical Menu is the
// closest equivalent. Hidden entirely when the user has turned the menu off in Settings ->
// Appearance (settings.menuBar) - main.ts's own maktaba:show-app-menu handler no-ops in that case
// too, but skipping the render avoids offering a control that would visibly do nothing.
function MenuButton() {
  const { t } = useLanguage();
  const menuBarQuery = useQuery({ queryKey: ["menuBarEnabled"], queryFn: () => window.maktaba.getMenuBarEnabled() });

  if (!menuBarQuery.data) {
    return null;
  }

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    void window.maktaba.showAppMenu({ x: Math.round(rect.left), y: Math.round(rect.bottom) });
  };

  return (
    <Tooltip label={t("toolbar.menu")}>
      <ActionIcon
        className="maktaba-titlebar-no-drag"
        variant="subtle"
        color="gray"
        onClick={handleClick}
        aria-label={t("toolbar.menu")}
      >
        <IconMenu2 size={16} />
      </ActionIcon>
    </Tooltip>
  );
}

// Opens the standalone Help window (HelpWindow.tsx, apps/desktop/src/main.ts's openHelpWindow) -
// always visible, independent of hasLibrary/actionsHidden, same reasoning as MenuButton above:
// help should stay reachable even before a library exists or while the inline reader covers the
// rest of the title bar.
function HelpButton() {
  const { t } = useLanguage();
  return (
    <Tooltip label={t("toolbar.help")}>
      <ActionIcon
        className="maktaba-titlebar-no-drag"
        variant="subtle"
        color="gray"
        onClick={() => void window.maktaba.openHelpWindow()}
        aria-label={t("toolbar.help")}
      >
        <IconHelpCircle size={16} />
      </ActionIcon>
    </Tooltip>
  );
}

interface TitleBarProps {
  hasLibrary: boolean;
  mainView: MainView;
  onOpenHome: () => void;
  onImport: () => void;
  activeFilter: GroupFilter | null;
  onSelect: (filter: GroupFilter | null) => void;
  onShowAllBooks: () => void;
  // Analytics/Settings/Theme/Language now live here rather than the sidebar's bottom bar (moved so
  // they're reachable without a library open at all, and to let the sidebar's LibrarySwitcher grow
  // to fill the freed-up space - see Sidebar.tsx).
  settingsOpen: boolean;
  onOpenSettings: (tab?: SettingsTab) => void;
  onOpenAnalytics: () => void;
  // Set while the inline reader (App.tsx's inlineReader) is open - none of the sidebar/filter/
  // search/import actions are reachable behind it (InlineReader covers the rest of the window), so
  // they're hidden rather than left as dead clicks. The bar itself (branding + drag region) still
  // renders so the window keeps its custom titlebar and stays draggable.
  actionsHidden?: boolean;
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
          <Tooltip key={status} label={labels[status]}>
            <Button
              variant={isActive ? "light" : "subtle"}
              color={READING_STATUS_COLOR[status]}
              size="xs"
              px={8}
              leftSection={<StatusIcon size={16} />}
              onClick={() => onSelect(isActive ? null : { kind: "readingStatus", id: status, name: labels[status] })}
              aria-label={`${labels[status]} (${count})`}
            >
              {count}
            </Button>
          </Tooltip>
        );
      })}
    </Group>
  );
}

// Renders in place of the OS title bar (main.ts sets titleBarStyle: "hidden" on the main window)
// so it's mounted unconditionally by App.tsx — even before a library is open — otherwise the
// frameless window would have no drag region at all, just the native min/max/close controls.
// Left: branding, Home, then the All books/reading-status filter row. Middle: Search, styled as a
// text box rather than a bare icon. Right: a labeled Add Books button, then Theme/Language/
// Analytics/Settings, then Help. The sidebar (see Sidebar.tsx) is left with just its own browse
// sections and the library switcher.
export function TitleBar({
  hasLibrary,
  mainView,
  onOpenHome,
  onImport,
  activeFilter,
  onSelect,
  onShowAllBooks,
  settingsOpen,
  onOpenSettings,
  onOpenAnalytics,
  actionsHidden,
}: TitleBarProps) {
  const { t, language, setLanguage } = useLanguage();
  const colorScheme = useComputedColorScheme("light");
  const { setColorScheme } = useMantineColorScheme();
  const { appTheme, setAppTheme } = useAppTheme();
  const libraryActive = mainView === "library" && !activeFilter;
  const showActions = hasLibrary && !actionsHidden;
  const { paddingLeft, paddingRight } = useTitleBarOverlayPadding();
  const otherLanguage = LANGUAGES.find((option) => option.value !== language)!;
  const currentLanguage = LANGUAGES.find((option) => option.value === language)!;

  // Keeps the native win/linux caption-button strip's colors matching the app's own currently
  // active theme (organic/white) and light/dark setting rather than a hardcoded/mismatched color -
  // reads the same CSS variables the page itself is themed with, so it stays correct across theme
  // and accent-color changes without main.ts needing to know anything about the renderer's theme.
  useEffect(() => {
    const styles = getComputedStyle(document.body);
    const color = styles.getPropertyValue("--mantine-color-body").trim() || (colorScheme === "dark" ? "#242019" : "#f5ead8");
    const symbolColor = styles.getPropertyValue("--mantine-color-text").trim() || (colorScheme === "dark" ? "#f3ead9" : "#201e1d");
    void window.maktaba.setTitleBarOverlay({ color, symbolColor });
  }, [colorScheme, appTheme]);

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
        paddingLeft,
        paddingRight,
      }}
    >
      <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        <TitleBarBrand />
        <MenuButton />

        {showActions && (
          <>
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

      {showActions && (
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

      {showActions && (
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

      {showActions && (
        <Group gap={4} wrap="nowrap" className="maktaba-titlebar-no-drag" style={{ flexShrink: 0 }}>
          <Menu position="bottom-end" shadow="md" width={220}>
            <Menu.Target>
              <Tooltip label={t("toolbar.theme")}>
                <ActionIcon variant="subtle" color="gray" aria-label={t("toolbar.theme")}>
                  <IconPalette size={16} />
                </ActionIcon>
              </Tooltip>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>{t("settings.appTheme")}</Menu.Label>
              <Box px="xs" pb="xs">
                <SegmentedControl
                  fullWidth
                  size="xs"
                  value={appTheme}
                  onChange={(value) => setAppTheme(value as AppThemeName)}
                  data={[
                    { value: "organic", label: t("settings.appTheme.organic") },
                    { value: "white", label: t("settings.appTheme.white") },
                  ]}
                />
              </Box>
              <Divider />
              <Menu.Label>{t("settings.colorScheme")}</Menu.Label>
              <Box px="xs" pb="xs">
                <SegmentedControl
                  fullWidth
                  size="xs"
                  value={colorScheme}
                  onChange={(value) => setColorScheme(value as "light" | "dark")}
                  data={[
                    { value: "light", label: <IconSun size={14} /> },
                    { value: "dark", label: <IconMoon size={14} /> },
                  ]}
                />
              </Box>
              {appTheme === "white" && (
                <>
                  <Divider />
                  <Menu.Label>{t("settings.accentColor")}</Menu.Label>
                  <Box px="xs" pb="xs">
                    <ThemeColorSwatches />
                  </Box>
                </>
              )}
            </Menu.Dropdown>
          </Menu>

          <Tooltip label={`${t("toolbar.language")}: ${otherLanguage.label}`}>
            <ActionIcon variant="subtle" color="gray" onClick={() => setLanguage(otherLanguage.value)} aria-label={t("toolbar.language")}>
              <Text size="xs" fw={700}>
                {currentLanguage.label}
              </Text>
            </ActionIcon>
          </Tooltip>

          <Tooltip label={t("analytics.title")}>
            <ActionIcon variant="subtle" color="gray" onClick={onOpenAnalytics} aria-label={t("analytics.title")}>
              <IconChartBar size={16} />
            </ActionIcon>
          </Tooltip>

          <Tooltip label={t("settings.title")}>
            <ActionIcon
              variant={settingsOpen ? "light" : "subtle"}
              color="gray"
              onClick={() => onOpenSettings()}
              aria-label={t("settings.title")}
            >
              <IconSettings size={16} />
            </ActionIcon>
          </Tooltip>

          <Divider orientation="vertical" h={20} />
        </Group>
      )}

      <HelpButton />
    </Box>
  );
}
