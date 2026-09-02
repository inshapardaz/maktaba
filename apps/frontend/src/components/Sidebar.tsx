import { useRef, useState } from "react";
import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Divider,
  Group,
  HoverCard,
  Menu,
  NavLink,
  Popover,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme,
  useDirection,
  useMantineColorScheme,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconBuildingStore,
  IconChartBar,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconFolder,
  IconFolderOpen,
  IconLanguage,
  IconMoon,
  IconNews,
  IconPalette,
  IconPlus,
  IconSettings,
  IconStack2,
  IconSun,
  IconTag,
  IconUser,
} from "../icons";
import type { Icon } from "../icons";
import {
  authorImageUrl,
  createCollection,
  createPeriodical,
  getCurrentLibrary,
  listAuthors,
  listCollections,
  listLanguageGroups,
  listPeriodicals,
  listPublisherGroups,
  listSeries,
  listTags,
  type BrowseGroup,
} from "../api";
import { isBookDrag, readBookDragIds } from "../bookDrag";
import { useAppTheme, type AppThemeName } from "../AppThemeContext";
import { useLanguage } from "../i18n/LanguageContext";
import { LANGUAGES, type TranslationKey } from "../i18n/translations";
import { LibrarySwitcher } from "./LibrarySwitcher";
import type { SettingsTab } from "./SettingsScreen";
import { ThemeColorSwatches } from "./ThemeColorSwatches";

export type GroupFilterKind =
  | "authorId"
  | "seriesId"
  | "tagId"
  | "collectionId"
  | "periodicalId"
  | "publisher"
  | "language"
  | "readingStatus";

export interface GroupFilter {
  kind: GroupFilterKind;
  id: string;
  name: string;
}

export type MainView =
  | "home"
  | "library"
  | "authors"
  | "collections"
  | "tags"
  | "series"
  | "periodicals"
  | "publishers"
  | "languages"
  | "analytics";

type BrowseSection = "collections" | "authors" | "series" | "tags" | "periodicals" | "publishers" | "languages";

// Drag-to-resize (via the handle rendered at the sidebar's inline-end edge below) is clamped to
// this range - narrow enough to still fit as an icon rail, wide enough that a long author/series
// name doesn't get truncated into uselessness.
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 480;
// Wide enough that all six view-bar icons (Authors/Collections/Series/Tags/Publishers/Languages)
// fit on one row without wrapping at the default width - narrower drag-resized widths still wrap.
export const SIDEBAR_DEFAULT_WIDTH = 264;

// Book.Language is stored as a raw ISO 639-1 code (see BookEditForm.tsx's LANGUAGE_CODES), so the
// sidebar/LanguagesView show a translated display name instead of the bare code wherever possible
// - falling back to the code itself for anything outside the known set (e.g. a regional code like
// "en-US" found during import), since t() would otherwise just echo the untranslated key back.
export function languageDisplayName(code: string, t: (key: TranslationKey) => string): string {
  const key = `language.${code}` as TranslationKey;
  const label = t(key);
  return label === key ? code : label;
}

// Sorted, uncapped — the sidebar's own ScrollArea (see the `browseSection` ScrollArea below)
// handles a library with hundreds of authors/collections by scrolling rather than truncating.
// AuthorsView/CollectionsView/TagsView/SeriesView (opened via the "see all" chevron) still exist
// alongside this for their own search/rename/management UI, not as the only way to see everything.
function byBookCount(groups: BrowseGroup[] | undefined): BrowseGroup[] {
  if (!groups) return [];
  return [...groups].sort((a, b) => b.bookCount - a.bookCount);
}

// /api/authors sends the "unknown author" sentinel row (id "unknown", see issue #41 and
// BrowseEndpoints.cs) with an empty name since it has no i18n access server-side - filled in here
// and in AuthorsView.tsx, the only two places that render the authors list.
export function withUnknownAuthorLabel(
  groups: BrowseGroup[] | undefined,
  t: (key: TranslationKey) => string,
): BrowseGroup[] | undefined {
  return groups?.map((group) => (group.id === "unknown" ? { ...group, name: t("common.unknownAuthor") } : group));
}

interface SidebarProps {
  activeFilter: GroupFilter | null;
  onSelect: (filter: GroupFilter | null) => void;
  settingsOpen: boolean;
  collapsed: boolean;
  // Current expanded-state width in px and its setter, for the drag handle at the sidebar's
  // inline-end edge (see the resize handling below) - ignored while collapsed (fixed at the
  // 56px icon rail instead, see App.tsx's AppShell navbar width).
  width: number;
  onWidthChange: (width: number) => void;
  onOpenAuthors: () => void;
  onOpenCollections: () => void;
  onOpenTags: () => void;
  onOpenSeries: () => void;
  onOpenPeriodicals: () => void;
  onOpenPublishers: () => void;
  onOpenLanguages: () => void;
  // Optional tab (see SettingsScreen.tsx's SettingsTab) to land on when Settings opens - the
  // footer gear button opens on whatever the default is, while "Manage Libraries" below jumps
  // straight to "libraries" (issue #15).
  onOpenSettings: (tab?: SettingsTab) => void;
  onOpenAnalytics: () => void;
  onLibraryChanged: () => void;
  // Issue #10: dragging a book (or the active multi-selection) from the grid/list onto an
  // Author/Series/Tag/Collection/Publisher/Language row here applies that edit - see App.tsx's
  // handleDropBooksOnGroup, which is what actually calls the edit endpoint per book. Dropping
  // onto Author normally replaces the book's author(s); holding Shift while dropping appends
  // instead (`shiftKey`, read from the native DragEvent in GroupSection's onDrop below).
  onDropBooks: (
    kind: "authorId" | "seriesId" | "tagId" | "collectionId" | "periodicalId" | "publisher" | "language",
    target: { id: string; name: string },
    bookIds: string[],
    shiftKey: boolean,
  ) => void;
}

function sectionRowStyles(isActive: boolean, dragOver = false) {
  return {
    root: {
      borderRadius: "var(--mantine-radius-sm)",
      outline: dragOver ? "2px solid var(--mantine-primary-color-6)" : "2px solid transparent",
      outlineOffset: -2,
      ...(isActive || dragOver
        ? {
          backgroundColor: "var(--mantine-primary-color-0)",
          color: "var(--mantine-primary-color-7)",
        }
        : {}),
    },
    label: { fontWeight: isActive ? 600 : 500, fontSize: "var(--mantine-font-size-xs)" },
  };
}

// A section's header: icon + title + optional action (see-all/add, shown regardless of expanded
// state so those stay reachable at a glance) + expand/collapse chevron. Single-select accordion -
// opening one closes whichever was open before it (see Sidebar's expandedSection state).
function CollapsibleSection({
  title,
  icon: SectionIcon,
  expanded,
  onToggle,
  action,
  children,
}: {
  title: string;
  icon: Icon;
  expanded: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Box
      style={{
        borderBottom: "1px solid var(--mantine-color-default-border)",
        // Collapsed sections keep their natural (header-only) height and stack at the top/bottom
        // of the sidebar; the one expanded section stretches to fill whatever space is left, with
        // its own ScrollArea below rather than letting the whole sidebar scroll.
        flex: expanded ? 1 : "0 0 auto",
        minHeight: expanded ? 0 : undefined,
        display: expanded ? "flex" : undefined,
        flexDirection: expanded ? "column" : undefined,
      }}
    >
      <Group gap={0} wrap="nowrap" px="md" py={8} style={{ flexShrink: 0 }}>
        <UnstyledButton
          onClick={onToggle}
          style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}
          aria-expanded={expanded}
        >
          <SectionIcon size={16} />
          <Text fw={500} fz="sm" truncate="end">
            {title}
          </Text>
        </UnstyledButton>
        {action}
        <ActionIcon variant="subtle" color="gray" size="xs" onClick={onToggle} aria-label={title}>
          {expanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </ActionIcon>
      </Group>
      {expanded && (
        <ScrollArea style={{ flex: 1, minHeight: 0 }}>
          <Box pb="sm">{children}</Box>
        </ScrollArea>
      )}
    </Box>
  );
}

function GroupSection({
  kind,
  icon: RowIcon,
  renderIcon,
  renderHoverCard,
  activeFilter,
  onSelect,
  groups,
  onDropBooks,
}: {
  kind: GroupFilterKind;
  icon: Icon;
  // Authors override the plain RowIcon with their own avatar (falling back to RowIcon when they
  // don't have one) - every other section just uses RowIcon for every row.
  renderIcon?: (group: BrowseGroup) => React.ReactNode;
  // Authors only: a long-hover popup with a bigger photo/name/book-count - every other section
  // leaves this unset and rows just get the plain NavLink.
  renderHoverCard?: (group: BrowseGroup) => React.ReactNode;
  activeFilter: GroupFilter | null;
  onSelect: (filter: GroupFilter | null) => void;
  groups: BrowseGroup[] | undefined;
  // Only passed for Authors/Series/Tags/Collections/Publishers (see Sidebar's own onDropBooks
  // prop) - issue #10's "drag a book from the grid/list onto a sidebar row to edit it" feature.
  // Undefined here (reading-status rows don't get one) just means those rows aren't drop targets.
  onDropBooks?: (target: { id: string; name: string }, bookIds: string[], shiftKey: boolean) => void;
}) {
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  return (
    <Box px={4}>
      {groups?.map((group) => {
        const isActive = activeFilter?.kind === kind && activeFilter.id === group.id;
        const navLink = (
          <NavLink
            key={renderHoverCard ? undefined : group.id}
            label={group.name}
            leftSection={renderIcon ? renderIcon(group) : <RowIcon size={16} />}
            active={isActive}
            onClick={() => onSelect(isActive ? null : { kind, id: group.id, name: group.name })}
            onDragOver={
              // The "unknown author" sentinel row (id "unknown", see issue #41) isn't a real
              // Author row to assign books to - it's just a filter - so it's not a drop target.
              onDropBooks && group.id !== "unknown" &&
              ((event) => {
                if (!isBookDrag(event)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                setDragOverId(group.id);
              })
            }
            onDragLeave={onDropBooks && group.id !== "unknown" && (() => setDragOverId((id) => (id === group.id ? null : id)))}
            onDrop={
              onDropBooks && group.id !== "unknown" &&
              ((event) => {
                event.preventDefault();
                setDragOverId(null);
                const bookIds = readBookDragIds(event);
                if (bookIds && bookIds.length > 0) {
                  onDropBooks({ id: group.id, name: group.name }, bookIds, event.shiftKey);
                }
              })
            }
            rightSection={
              <Badge size="sm" variant="light" color="gray">
                {group.bookCount}
              </Badge>
            }
            px="md"
            py={5}
            styles={sectionRowStyles(isActive, dragOverId === group.id)}
          />
        );

        if (!renderHoverCard) {
          return navLink;
        }

        return (
          <HoverCard key={group.id} openDelay={700} closeDelay={100} position="right" withArrow shadow="md">
            <HoverCard.Target>{navLink}</HoverCard.Target>
            <HoverCard.Dropdown>{renderHoverCard(group)}</HoverCard.Dropdown>
          </HoverCard>
        );
      })}
    </Box>
  );
}

export function Sidebar({
  activeFilter,
  onSelect,
  settingsOpen,
  collapsed,
  width,
  onWidthChange,
  onOpenAuthors,
  onOpenCollections,
  onOpenTags,
  onOpenSeries,
  onOpenPeriodicals,
  onOpenPublishers,
  onOpenLanguages,
  onOpenSettings,
  onOpenAnalytics,
  onLibraryChanged,
  onDropBooks,
}: SidebarProps) {
  const { t, language, setLanguage } = useLanguage();
  const { dir } = useDirection();
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("light");
  const { appTheme, setAppTheme } = useAppTheme();
  const queryClient = useQueryClient();
  const authorsQuery = useQuery({ queryKey: ["authors"], queryFn: listAuthors });
  const publishersQuery = useQuery({ queryKey: ["publisherGroups"], queryFn: listPublisherGroups });
  const languagesQuery = useQuery({ queryKey: ["languageGroups"], queryFn: listLanguageGroups });
  const seriesQuery = useQuery({ queryKey: ["series"], queryFn: listSeries });
  const tagsQuery = useQuery({ queryKey: ["tags"], queryFn: listTags });
  const collectionsQuery = useQuery({ queryKey: ["collections"], queryFn: listCollections });
  // Per-library preference (Settings -> Libraries) - shares the ["library"] query App.tsx already
  // keeps warm, so this is a cache read, not an extra request.
  const libraryQuery = useQuery({ queryKey: ["library"], queryFn: getCurrentLibrary });
  const periodicalsEnabled = libraryQuery.data?.periodicalsEnabled ?? true;
  const periodicalsQuery = useQuery({ queryKey: ["periodicals"], queryFn: listPeriodicals, enabled: periodicalsEnabled });

  // Drag-to-resize: pointer capture on the handle itself means move/up keep firing on it even
  // once the cursor leaves its thin hit area mid-drag, so a fast drag can't "escape" the handle
  // and get stuck. The ref (rather than state) holds the drag-start snapshot since it only needs
  // to be read inside the same gesture's move/up handlers, never rendered.
  const resizeStart = useRef<{ pointerX: number; width: number } | null>(null);

  const handleResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStart.current = { pointerX: event.clientX, width };
  };

  const handleResizePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeStart.current) return;
    const rawDelta = event.clientX - resizeStart.current.pointerX;
    // In RTL the sidebar sits on the right with its resize handle on its left (inline-end) edge,
    // so dragging left (negative delta) is what grows it - the sign flips relative to LTR.
    const delta = dir === "rtl" ? -rawDelta : rawDelta;
    const next = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, resizeStart.current.width + delta));
    onWidthChange(next);
  };

  const handleResizePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    resizeStart.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const otherLanguage = LANGUAGES.find((option) => option.value !== language)!;
  const currentLanguage = LANGUAGES.find((option) => option.value === language)!;

  const seeAllAction = (onClick: () => void) => (
    <Tooltip label={t("sidebar.seeAll")}>
      <UnstyledButton onClick={onClick} c="dimmed" style={{ display: "flex" }} aria-label={t("sidebar.seeAll")}>
        <IconFolderOpen size={14} />
      </UnstyledButton>
    </Tooltip>
  );

  // Quick-add for collections, right next to the "see all" chevron - the only browse group that's
  // user-created (see CollectionsView.tsx for the full management screen this mirrors), so it's
  // the only one that gets a create affordance here.
  const [addCollectionOpen, setAddCollectionOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");

  const createCollectionMutation = useMutation({
    mutationFn: (name: string) => createCollection(name),
    onSuccess: () => {
      setNewCollectionName("");
      setAddCollectionOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });

  const handleCreateCollection = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCollectionName.trim();
    if (trimmed.length > 0) {
      createCollectionMutation.mutate(trimmed);
    }
  };

  const addCollectionAction = (
    <Popover opened={addCollectionOpen} onChange={setAddCollectionOpen} position="bottom-start" withArrow shadow="md">
      <Popover.Target>
        <Tooltip label={t("collectionsView.add")}>
          <UnstyledButton
            onClick={() => setAddCollectionOpen((o) => !o)}
            c="dimmed"
            style={{ display: "flex" }}
            aria-label={t("collectionsView.add")}
          >
            <IconPlus size={14} />
          </UnstyledButton>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <form onSubmit={handleCreateCollection}>
          <Group gap={4} wrap="nowrap">
            <TextInput
              size="xs"
              placeholder={t("collectionsView.namePlaceholder")}
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.currentTarget.value)}
              autoFocus
            />
            <ActionIcon
              type="submit"
              variant="filled"
              size="sm"
              loading={createCollectionMutation.isPending}
              disabled={newCollectionName.trim().length === 0}
              aria-label={t("collectionsView.add")}
            >
              <IconCheck size={14} />
            </ActionIcon>
          </Group>
        </form>
      </Popover.Dropdown>
    </Popover>
  );

  // Quick-add for periodicals, mirroring addCollectionAction above - name only, since a full
  // frequency/description form is what PeriodicalsView's own "see all" screen is for. New
  // periodicals default to "Occasional" (editable from there too).
  const [addPeriodicalOpen, setAddPeriodicalOpen] = useState(false);
  const [newPeriodicalName, setNewPeriodicalName] = useState("");

  const createPeriodicalMutation = useMutation({
    mutationFn: (name: string) => createPeriodical(name, "Occasional"),
    onSuccess: () => {
      setNewPeriodicalName("");
      setAddPeriodicalOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["periodicals"] });
    },
  });

  const handleCreatePeriodical = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newPeriodicalName.trim();
    if (trimmed.length > 0) {
      createPeriodicalMutation.mutate(trimmed);
    }
  };

  const addPeriodicalAction = (
    <Popover opened={addPeriodicalOpen} onChange={setAddPeriodicalOpen} position="bottom-start" withArrow shadow="md">
      <Popover.Target>
        <Tooltip label={t("periodicalsView.add")}>
          <UnstyledButton
            onClick={() => setAddPeriodicalOpen((o) => !o)}
            c="dimmed"
            style={{ display: "flex" }}
            aria-label={t("periodicalsView.add")}
          >
            <IconPlus size={14} />
          </UnstyledButton>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <form onSubmit={handleCreatePeriodical}>
          <Group gap={4} wrap="nowrap">
            <TextInput
              size="xs"
              placeholder={t("periodicalsView.namePlaceholder")}
              value={newPeriodicalName}
              onChange={(e) => setNewPeriodicalName(e.currentTarget.value)}
              autoFocus
            />
            <ActionIcon
              type="submit"
              variant="filled"
              size="sm"
              loading={createPeriodicalMutation.isPending}
              disabled={newPeriodicalName.trim().length === 0}
              aria-label={t("periodicalsView.add")}
            >
              <IconCheck size={14} />
            </ActionIcon>
          </Group>
        </form>
      </Popover.Dropdown>
    </Popover>
  );

  // Single-select accordion - opening a section closes whichever one was open before it. Authors
  // starts open since it's usually the most-browsed section; null means every section collapsed.
  const [expandedSection, setExpandedSection] = useState<BrowseSection | null>("authors");

  const toggleSection = (key: BrowseSection) => {
    setExpandedSection((prev) => (prev === key ? null : key));
  };

  // "Active" here means "this is the filter currently applied to the book list" - matched against
  // activeFilter.kind - so this browse list and the title bar's filter row (All books/Unread/
  // Reading/Finished - see TitleBar.tsx) stay mutually exclusive: picking a reading-status filter
  // there clears any highlighted row here, and picking an author/collection/series/tag filter here
  // clears that filter row's selection, since neither can be simultaneously "the" active filter.
  const sectionFilterKind: Record<BrowseSection, GroupFilterKind> = {
    authors: "authorId",
    collections: "collectionId",
    series: "seriesId",
    tags: "tagId",
    periodicals: "periodicalId",
    publishers: "publisher",
    languages: "language",
  };

  const sections: { key: BrowseSection; icon: Icon; label: string; active: boolean }[] = [
    { key: "authors", icon: IconUser, label: t("sidebar.authors"), active: activeFilter?.kind === sectionFilterKind.authors },
    { key: "collections", icon: IconFolder, label: t("sidebar.collections"), active: activeFilter?.kind === sectionFilterKind.collections },
    { key: "series", icon: IconStack2, label: t("sidebar.series"), active: activeFilter?.kind === sectionFilterKind.series },
    { key: "tags", icon: IconTag, label: t("sidebar.tags"), active: activeFilter?.kind === sectionFilterKind.tags },
    // Omitted entirely (not just visually disabled) when this library has the feature turned off
    // (Settings -> Libraries) - see periodicalsEnabled above.
    ...(periodicalsEnabled
      ? [{ key: "periodicals" as const, icon: IconNews, label: t("sidebar.periodicals"), active: activeFilter?.kind === sectionFilterKind.periodicals }]
      : []),
    { key: "publishers", icon: IconBuildingStore, label: t("sidebar.publishers"), active: activeFilter?.kind === sectionFilterKind.publishers },
    { key: "languages", icon: IconLanguage, label: t("sidebar.languages"), active: activeFilter?.kind === sectionFilterKind.languages },
  ];

  return (
    <Box
      h="100%"
      display="flex"
      style={{ position: "relative", flexDirection: "column", borderInlineEnd: "1px solid var(--mantine-color-default-border)" }}
    >
      {/* Drag-to-resize handle - a thin invisible strip along the sidebar's inline-end edge
          (right in LTR, left in RTL - see handleResizePointerMove's dir handling above). Only
          shown expanded; the collapsed rail is a fixed 56px, not user-resizable. */}
      {!collapsed && (
        <Box
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            insetInlineEnd: 0,
            width: 6,
            cursor: "ew-resize",
            touchAction: "none",
            zIndex: 100,
          }}
        />
      )}

      {/* Collapsed rail only - the expanded sidebar shows every section as its own collapsible
          block below instead (see the accordion in the ScrollArea branch). Icon-only; clicking one
          here marks that section expanded so it's already open once the sidebar is re-expanded
          (via the title bar's own collapse toggle - this rail has no expand control of its own). */}
      {collapsed && (
        <Group gap={4} px="xs" py={6} wrap="wrap" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
          {sections.map((section) => (
            <Tooltip key={section.key} label={section.label}>
              <ActionIcon
                variant={section.active ? "filled" : "subtle"}
                color={section.active ? undefined : "gray"}
                size="lg"
                onClick={() => setExpandedSection(section.key)}
                aria-label={section.label}
              >
                <section.icon size={17} />
              </ActionIcon>
            </Tooltip>
          ))}
        </Group>
      )}

      {collapsed ? (
        <Box style={{ flex: 1 }} />
      ) : (
        <Box component="nav" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <CollapsibleSection
            title={t("sidebar.authors")}
            icon={IconUser}
            expanded={expandedSection === "authors"}
            onToggle={() => toggleSection("authors")}
            action={seeAllAction(onOpenAuthors)}
          >
            <GroupSection
              kind="authorId"
              icon={IconUser}
              renderIcon={(group) =>
                group.hasImage ? (
                  <Avatar src={authorImageUrl(group.id)} size={16} radius="xl" />
                ) : (
                  <IconUser size={16} />
                )
              }
              renderHoverCard={(group) => (
                <Group gap="sm" wrap="nowrap" p={4}>
                  <Avatar src={group.hasImage ? authorImageUrl(group.id) : null} size={56} radius="xl">
                    <IconUser size={28} />
                  </Avatar>
                  <Stack gap={2}>
                    <Text fw={600} size="sm">
                      {group.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t(
                        group.bookCount === 1 ? "authorsView.bookCount_one" : "authorsView.bookCount_other",
                        { count: group.bookCount },
                      )}
                    </Text>
                  </Stack>
                </Group>
              )}
              activeFilter={activeFilter}
              onSelect={onSelect}
              groups={byBookCount(withUnknownAuthorLabel(authorsQuery.data, t))}
              onDropBooks={(target, bookIds, shiftKey) => onDropBooks("authorId", target, bookIds, shiftKey)}
            />
          </CollapsibleSection>

          <CollapsibleSection
            title={t("sidebar.collections")}
            icon={IconFolder}
            expanded={expandedSection === "collections"}
            onToggle={() => toggleSection("collections")}
            action={
              <Group gap={6} wrap="nowrap">
                {addCollectionAction}
                {seeAllAction(onOpenCollections)}
              </Group>
            }
          >
            <GroupSection
              kind="collectionId"
              icon={IconFolder}
              activeFilter={activeFilter}
              onSelect={onSelect}
              groups={byBookCount(collectionsQuery.data)}
              onDropBooks={(target, bookIds, shiftKey) => onDropBooks("collectionId", target, bookIds, shiftKey)}
            />
          </CollapsibleSection>

          <CollapsibleSection
            title={t("sidebar.series")}
            icon={IconStack2}
            expanded={expandedSection === "series"}
            onToggle={() => toggleSection("series")}
            action={seeAllAction(onOpenSeries)}
          >
            <GroupSection
              kind="seriesId"
              icon={IconStack2}
              activeFilter={activeFilter}
              onSelect={onSelect}
              groups={byBookCount(seriesQuery.data)}
              onDropBooks={(target, bookIds, shiftKey) => onDropBooks("seriesId", target, bookIds, shiftKey)}
            />
          </CollapsibleSection>

          <CollapsibleSection
            title={t("sidebar.tags")}
            icon={IconTag}
            expanded={expandedSection === "tags"}
            onToggle={() => toggleSection("tags")}
            action={seeAllAction(onOpenTags)}
          >
            <GroupSection
              kind="tagId"
              icon={IconTag}
              activeFilter={activeFilter}
              onSelect={onSelect}
              groups={byBookCount(tagsQuery.data)}
              onDropBooks={(target, bookIds, shiftKey) => onDropBooks("tagId", target, bookIds, shiftKey)}
            />
          </CollapsibleSection>

          {periodicalsEnabled && (
            <CollapsibleSection
              title={t("sidebar.periodicals")}
              icon={IconNews}
              expanded={expandedSection === "periodicals"}
              onToggle={() => toggleSection("periodicals")}
              action={
                <Group gap={6} wrap="nowrap">
                  {addPeriodicalAction}
                  {seeAllAction(onOpenPeriodicals)}
                </Group>
              }
            >
              <GroupSection
                kind="periodicalId"
                icon={IconNews}
                activeFilter={activeFilter}
                onSelect={onSelect}
                groups={byBookCount(
                  (periodicalsQuery.data ?? []).map((p) => ({ id: p.id, name: p.name, bookCount: p.issueCount })),
                )}
                onDropBooks={(target, bookIds, shiftKey) => onDropBooks("periodicalId", target, bookIds, shiftKey)}
              />
            </CollapsibleSection>
          )}

          <CollapsibleSection
            title={t("sidebar.publishers")}
            icon={IconBuildingStore}
            expanded={expandedSection === "publishers"}
            onToggle={() => toggleSection("publishers")}
            action={seeAllAction(onOpenPublishers)}
          >
            <GroupSection
              kind="publisher"
              icon={IconBuildingStore}
              activeFilter={activeFilter}
              onSelect={onSelect}
              groups={byBookCount(publishersQuery.data)}
              onDropBooks={(target, bookIds, shiftKey) => onDropBooks("publisher", target, bookIds, shiftKey)}
            />
          </CollapsibleSection>

          <CollapsibleSection
            title={t("sidebar.languages")}
            icon={IconLanguage}
            expanded={expandedSection === "languages"}
            onToggle={() => toggleSection("languages")}
            action={seeAllAction(onOpenLanguages)}
          >
            <GroupSection
              kind="language"
              icon={IconLanguage}
              activeFilter={activeFilter}
              onSelect={onSelect}
              groups={byBookCount(languagesQuery.data).map((group) => ({
                ...group,
                name: languageDisplayName(group.id, t),
              }))}
              onDropBooks={(target, bookIds, shiftKey) => onDropBooks("language", target, bookIds, shiftKey)}
            />
          </CollapsibleSection>
        </Box>
      )}

      <Box p={4} style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
        <Group gap={4} wrap="wrap" align="center">
          <LibrarySwitcher onLibraryChanged={onLibraryChanged} onManage={() => onOpenSettings("libraries")} compact={collapsed} />
          <Menu position="top-start" shadow="md" width={220}>
            <Menu.Target>
              <Tooltip label={t("toolbar.theme")}>
                <ActionIcon variant="subtle" color="gray" size="lg" aria-label={t("toolbar.theme")}>
                  <IconPalette size={17} />
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
                  value={computedColorScheme}
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
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              onClick={() => setLanguage(otherLanguage.value)}
              aria-label={t("toolbar.language")}
            >
              <Text size="xs" fw={700}>
                {currentLanguage.label}
              </Text>
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("analytics.title")}>
            <ActionIcon variant="subtle" color="gray" size="lg" onClick={onOpenAnalytics} aria-label={t("analytics.title")}>
              <IconChartBar size={17} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("settings.title")}>
            <ActionIcon
              variant={settingsOpen ? "light" : "subtle"}
              color="gray"
              size="lg"
              onClick={() => onOpenSettings()}
              aria-label={t("settings.title")}
            >
              <IconSettings size={17} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Box>
    </Box>
  );
}
