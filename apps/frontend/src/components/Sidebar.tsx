import { useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Group,
  HoverCard,
  NavLink,
  Popover,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
  useDirection,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconArrowsSort,
  IconBuildingStore,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconFolder,
  IconFolderOpen,
  IconLanguage,
  IconNews,
  IconPlus,
  IconStack2,
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
import { useLanguage } from "../i18n/LanguageContext";
import type { TranslationKey } from "../i18n/translations";
import {
  getStoredExpandMode,
  getStoredSectionSort,
  setStoredSectionSort,
  type SidebarSort,
  type SidebarSortKey,
  type SortableSidebarSection,
} from "../sidebarSettings";
import { LibrarySwitcher } from "./LibrarySwitcher";
import type { SettingsTab } from "./SettingsScreen";

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

// Issue #59: same shape as byBookCount above, but honoring a user-chosen sort (book count or
// alphabetical, either direction) - wired up for Authors/Collections/Series/Tags/Publishers (see
// Sidebar's sectionSorts state); Periodicals/Languages still use the plain byBookCount default.
function sortGroups(groups: BrowseGroup[] | undefined, sort: SidebarSort): BrowseGroup[] {
  if (!groups) return [];
  const sorted = [...groups].sort((a, b) =>
    sort.key === "name" ? a.name.localeCompare(b.name) : a.bookCount - b.bookCount,
  );
  return sort.direction === "asc" ? sorted : sorted.reverse();
}

// Compact sort-order picker shown in a section header's action row, next to "see all" - mirrors
// FilterBar's own sort popover (field + direction Selects) rather than inventing a new pattern.
function SortMenuButton({ sort, onChange }: { sort: SidebarSort; onChange: (sort: SidebarSort) => void }) {
  const { t } = useLanguage();
  const [opened, setOpened] = useState(false);

  const keyOptions: { value: SidebarSortKey; label: string }[] = [
    { value: "bookCount", label: t("sidebar.sortByCount") },
    { value: "name", label: t("sidebar.sortByName") },
  ];
  const directionOptions = [
    { value: "asc", label: t("filterBar.ascending") },
    { value: "desc", label: t("filterBar.descending") },
  ];

  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-start" withArrow shadow="md">
      <Popover.Target>
        <Tooltip label={t("sidebar.sortBy")}>
          <UnstyledButton
            onClick={(e) => {
              e.stopPropagation();
              setOpened((o) => !o);
            }}
            c="dimmed"
            style={{ display: "flex" }}
            aria-label={t("sidebar.sortBy")}
          >
            <IconArrowsSort size={14} />
          </UnstyledButton>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown miw={220} onClick={(e) => e.stopPropagation()}>
        <Stack gap={4}>
          <Select
            size="xs"
            data={keyOptions}
            value={sort.key}
            onChange={(value) => value && onChange({ ...sort, key: value as SidebarSortKey })}
            allowDeselect={false}
            comboboxProps={{ withinPortal: false }}
          />
          <Select
            size="xs"
            data={directionOptions}
            value={sort.direction}
            onChange={(value) => value && onChange({ ...sort, direction: value as SidebarSort["direction"] })}
            allowDeselect={false}
            comboboxProps={{ withinPortal: false }}
          />
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
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
  // Current width in px and its setter, for the drag handle at the sidebar's inline-end edge (see
  // the resize handling below).
  width: number;
  onWidthChange: (width: number) => void;
  onOpenAuthors: () => void;
  onOpenCollections: () => void;
  onOpenTags: () => void;
  onOpenSeries: () => void;
  onOpenPeriodicals: () => void;
  onOpenPublishers: () => void;
  onOpenLanguages: () => void;
  // Only used to jump Settings straight to the "libraries" tab from LibrarySwitcher's "Manage"
  // action below - the rest of Settings/Analytics/Theme/Language now live in the title bar (see
  // TitleBar.tsx).
  onOpenSettings: (tab?: SettingsTab) => void;
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
// state so those stay reachable at a glance) + expand/collapse chevron.
//
// Issue #60: `fillHeight` distinguishes the two expand modes (Sidebar's expandMode) - true in
// "single" mode, where the one expanded section stretches to fill whatever space is left (its own
// ScrollArea below, rather than the whole sidebar scrolling); false in "multiple" mode, where any
// number of sections can be expanded side by side, so each is instead capped to
// MULTI_EXPAND_MAX_HEIGHT with its own scrollbar and the sidebar's outer nav container scrolls as
// a whole if they add up to more than the available height.
const MULTI_EXPAND_MAX_HEIGHT = 260;

function CollapsibleSection({
  title,
  icon: SectionIcon,
  expanded,
  fillHeight,
  onToggle,
  action,
  children,
}: {
  title: string;
  icon: Icon;
  expanded: boolean;
  fillHeight: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Box
      style={{
        borderBottom: "1px solid var(--mantine-color-default-border)",
        // Collapsed sections keep their natural (header-only) height and stack at the top/bottom
        // of the sidebar.
        flex: expanded && fillHeight ? 1 : "0 0 auto",
        minHeight: expanded && fillHeight ? 0 : undefined,
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
        <ScrollArea
          style={fillHeight ? { flex: 1, minHeight: 0 } : { maxHeight: MULTI_EXPAND_MAX_HEIGHT }}
        >
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
  onLibraryChanged,
  onDropBooks,
}: SidebarProps) {
  const { t } = useLanguage();
  const { dir } = useDirection();
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

  // Issue #60: accordion expand behavior is user-configurable (Settings -> General -> "Sidebar
  // sections"), shared with SettingsScreen.tsx via the ["sidebarExpandMode"] query cache (see that
  // component's handleExpandModeChange) so toggling it there re-renders this already-mounted
  // sidebar immediately. "single" (the original behavior) keeps exactly one section expanded at
  // all times and disallows collapsing it - the user can only switch which one; "multiple" allows
  // any number expanded (including none), each capped to a max height rather than filling space.
  const expandMode = useQuery({ queryKey: ["sidebarExpandMode"], queryFn: () => getStoredExpandMode() }).data ?? "single";
  const [expandedSections, setExpandedSections] = useState<Set<BrowseSection>>(() => new Set(["authors"]));

  const toggleSection = (key: BrowseSection) => {
    setExpandedSections((prev) => {
      if (expandMode === "single") {
        // Clicking the already-expanded section is a no-op - at least one section must stay open.
        return prev.has(key) ? prev : new Set([key]);
      }
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Switching from "multiple" to "single" mode (or starting with none expanded) needs to collapse
  // back down to exactly one expanded section - keeps whichever was expanded first if there were
  // several, or falls back to "authors" if there were none.
  useEffect(() => {
    if (expandMode !== "single") return;
    setExpandedSections((prev) => (prev.size === 1 ? prev : new Set([[...prev][0] ?? "authors"])));
  }, [expandMode]);

  // Issue #59 (extended to Collections/Series/Tags/Publishers too): one remembered sort per
  // section, keyed by section name - see sidebarSettings.ts's getStoredSectionSort/
  // setStoredSectionSort.
  const SORTABLE_SECTIONS: SortableSidebarSection[] = ["authors", "collections", "series", "tags", "publishers"];
  const [sectionSorts, setSectionSorts] = useState<Record<SortableSidebarSection, SidebarSort>>(() =>
    Object.fromEntries(SORTABLE_SECTIONS.map((section) => [section, getStoredSectionSort(section)])) as Record<
      SortableSidebarSection,
      SidebarSort
    >,
  );
  const handleSectionSortChange = (section: SortableSidebarSection, sort: SidebarSort) => {
    setSectionSorts((prev) => ({ ...prev, [section]: sort }));
    setStoredSectionSort(section, sort);
  };

  return (
    <Box
      h="100%"
      display="flex"
      style={{ position: "relative", flexDirection: "column", borderInlineEnd: "1px solid var(--mantine-color-default-border)" }}
    >
      {/* Drag-to-resize handle - a thin invisible strip along the sidebar's inline-end edge
          (right in LTR, left in RTL - see handleResizePointerMove's dir handling above). */}
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

      <Box
        component="nav"
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          // "single" mode: exactly one section fills this box, own scroll below - the box itself
          // never needs to scroll. "multiple" mode: several capped-height sections can add up to
          // more than the available space, so the whole nav area scrolls instead.
          overflow: expandMode === "single" ? "hidden" : "auto",
        }}
      >
          <CollapsibleSection
            title={t("sidebar.authors")}
            icon={IconUser}
            expanded={expandedSections.has("authors")}
            fillHeight={expandMode === "single"}
            onToggle={() => toggleSection("authors")}
            action={
              <Group gap={6} wrap="nowrap">
                <SortMenuButton
                  sort={sectionSorts.authors}
                  onChange={(sort) => handleSectionSortChange("authors", sort)}
                />
                {seeAllAction(onOpenAuthors)}
              </Group>
            }
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
              groups={sortGroups(withUnknownAuthorLabel(authorsQuery.data, t), sectionSorts.authors)}
              onDropBooks={(target, bookIds, shiftKey) => onDropBooks("authorId", target, bookIds, shiftKey)}
            />
          </CollapsibleSection>

          <CollapsibleSection
            title={t("sidebar.collections")}
            icon={IconFolder}
            expanded={expandedSections.has("collections")}
            fillHeight={expandMode === "single"}
            onToggle={() => toggleSection("collections")}
            action={
              <Group gap={6} wrap="nowrap">
                <SortMenuButton
                  sort={sectionSorts.collections}
                  onChange={(sort) => handleSectionSortChange("collections", sort)}
                />
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
              groups={sortGroups(collectionsQuery.data, sectionSorts.collections)}
              onDropBooks={(target, bookIds, shiftKey) => onDropBooks("collectionId", target, bookIds, shiftKey)}
            />
          </CollapsibleSection>

          <CollapsibleSection
            title={t("sidebar.series")}
            icon={IconStack2}
            expanded={expandedSections.has("series")}
            fillHeight={expandMode === "single"}
            onToggle={() => toggleSection("series")}
            action={
              <Group gap={6} wrap="nowrap">
                <SortMenuButton sort={sectionSorts.series} onChange={(sort) => handleSectionSortChange("series", sort)} />
                {seeAllAction(onOpenSeries)}
              </Group>
            }
          >
            <GroupSection
              kind="seriesId"
              icon={IconStack2}
              activeFilter={activeFilter}
              onSelect={onSelect}
              groups={sortGroups(seriesQuery.data, sectionSorts.series)}
              onDropBooks={(target, bookIds, shiftKey) => onDropBooks("seriesId", target, bookIds, shiftKey)}
            />
          </CollapsibleSection>

          <CollapsibleSection
            title={t("sidebar.tags")}
            icon={IconTag}
            expanded={expandedSections.has("tags")}
            fillHeight={expandMode === "single"}
            onToggle={() => toggleSection("tags")}
            action={
              <Group gap={6} wrap="nowrap">
                <SortMenuButton sort={sectionSorts.tags} onChange={(sort) => handleSectionSortChange("tags", sort)} />
                {seeAllAction(onOpenTags)}
              </Group>
            }
          >
            <GroupSection
              kind="tagId"
              icon={IconTag}
              activeFilter={activeFilter}
              onSelect={onSelect}
              groups={sortGroups(tagsQuery.data, sectionSorts.tags)}
              onDropBooks={(target, bookIds, shiftKey) => onDropBooks("tagId", target, bookIds, shiftKey)}
            />
          </CollapsibleSection>

          {periodicalsEnabled && (
            <CollapsibleSection
              title={t("sidebar.periodicals")}
              icon={IconNews}
              expanded={expandedSections.has("periodicals")}
              fillHeight={expandMode === "single"}
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
            expanded={expandedSections.has("publishers")}
            fillHeight={expandMode === "single"}
            onToggle={() => toggleSection("publishers")}
            action={
              <Group gap={6} wrap="nowrap">
                <SortMenuButton
                  sort={sectionSorts.publishers}
                  onChange={(sort) => handleSectionSortChange("publishers", sort)}
                />
                {seeAllAction(onOpenPublishers)}
              </Group>
            }
          >
            <GroupSection
              kind="publisher"
              icon={IconBuildingStore}
              activeFilter={activeFilter}
              onSelect={onSelect}
              groups={sortGroups(publishersQuery.data, sectionSorts.publishers)}
              onDropBooks={(target, bookIds, shiftKey) => onDropBooks("publisher", target, bookIds, shiftKey)}
            />
          </CollapsibleSection>

          <CollapsibleSection
            title={t("sidebar.languages")}
            icon={IconLanguage}
            expanded={expandedSections.has("languages")}
            fillHeight={expandMode === "single"}
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

      {/* Theme/Language/Analytics/Settings moved to the title bar (see TitleBar.tsx) - this footer
          is now just the library switcher, which fills the whole width. */}
      <Box p={4} style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
        <Group gap={4} align="center">
          <LibrarySwitcher onLibraryChanged={onLibraryChanged} onManage={() => onOpenSettings("libraries")} />
        </Group>
      </Box>
    </Box>
  );
}
