import { useEffect, useState, type CSSProperties } from "react";
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
  IconArrowLeft,
  IconArrowRight,
  IconBookmark,
  IconBooks,
  IconChartBar,
  IconCircleCheck,
  IconCircleDashed,
  IconCopy,
  IconHelpCircle,
  IconHome2,
  IconMenu2,
  IconMinus,
  IconMoon,
  IconPalette,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSquare,
  IconSun,
  IconX,
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

// Must match TITLEBAR_HEIGHT in apps/desktop/src/main.ts (the mac trafficLightPosition.y is
// derived from that same constant). Exported so App.tsx can give AppShell's header slot the same
// height.
export const TITLEBAR_HEIGHT = 40;

// Shared by the real TitleBar below and by BackendGate.tsx's minimal loading/error bar (shown
// before the real one ever mounts) - factored out so both reserve the exact same space. mac's
// native traffic lights are drawn by the OS on top of the page (inset from the top-left) with no
// DOM reservation of their own, so that side still needs a hardcoded left padding; win/linux no
// longer needs any reservation at all now that WindowControls (below) renders its own buttons as
// normal flex content at the end of the bar, rather than reserving space for an OS-drawn overlay.
export function useTitleBarOverlayPadding(): { paddingLeft: number; paddingRight: number } {
  const isMac = window.maktaba.platform === "darwin";
  return { paddingLeft: isMac ? 80 : 0, paddingRight: 0 };
}

// Custom-drawn minimize/maximize/close buttons for win/linux, where the window is now fully
// frameless (see main.ts's createWindow) rather than using Electron's native titleBarOverlay -
// that OS-drawn control strip always rendered top-right regardless of the page's own RTL/LTR
// direction, which these buttons need to respect (rendered as the last child of the title bar's
// flex row, so `dir="rtl"` naturally flips them to the visual left like everything else logical-
// property-based in this app). Not rendered on mac, which keeps native inset traffic lights
// instead (see trafficLightPosition in main.ts).
export function WindowControls() {
  const { t } = useLanguage();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.maktaba.isWindowMaximized().then((value) => {
      if (!cancelled) setMaximized(value);
    });
    const unsubscribe = window.maktaba.onWindowMaximizedChange((value) => setMaximized(value));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const buttonStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 46,
    alignSelf: "stretch",
  };

  return (
    <Group gap={0} wrap="nowrap" className="maktaba-titlebar-no-drag" style={{ flexShrink: 0, alignSelf: "stretch" }}>
      <UnstyledButton
        aria-label={t("toolbar.minimize")}
        onClick={() => void window.maktaba.minimizeWindow()}
        style={buttonStyle}
        className="maktaba-window-control"
      >
        <IconMinus size={14} strokeWidth={1.5} />
      </UnstyledButton>
      <UnstyledButton
        aria-label={t(maximized ? "toolbar.restore" : "toolbar.maximize")}
        onClick={() => void window.maktaba.toggleMaximizeWindow()}
        style={buttonStyle}
        className="maktaba-window-control"
      >
        {maximized ? <IconCopy size={13} strokeWidth={1.5} /> : <IconSquare size={12} strokeWidth={1.5} />}
      </UnstyledButton>
      <UnstyledButton
        aria-label={t("toolbar.closeWindow")}
        onClick={() => void window.maktaba.closeWindow()}
        style={buttonStyle}
        className="maktaba-window-control maktaba-window-control-close"
      >
        <IconX size={15} strokeWidth={1.5} />
      </UnstyledButton>
    </Group>
  );
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
  // Issue #57: back/forward navigation history buttons.
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
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
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
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
  const isMac = window.maktaba.platform === "darwin";

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
            <Tooltip label={t("toolbar.goBack")}>
              <ActionIcon
                className="maktaba-titlebar-no-drag"
                variant="subtle"
                color="gray"
                disabled={!canGoBack}
                onClick={onGoBack}
                aria-label={t("toolbar.goBack")}
              >
                <IconArrowLeft size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("toolbar.goForward")}>
              <ActionIcon
                className="maktaba-titlebar-no-drag"
                variant="subtle"
                color="gray"
                disabled={!canGoForward}
                onClick={onGoForward}
                aria-label={t("toolbar.goForward")}
              >
                <IconArrowRight size={16} />
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
          variant="primary"
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
      {!isMac && <WindowControls />}
    </Box>
  );
}
