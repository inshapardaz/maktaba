import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import {
  ActionIcon, Badge, Button, Checkbox, Group, Image, Modal, Paper, Select, SegmentedControl, SimpleGrid, Stack,
  Table, Text,
} from "@mantine/core";
import {
  bulkSetPageChapter, bulkSetPageStatus, deleteDigitizationPages, digitizationPageImageUrl, reorderDigitizationPages,
  type DigitizationPageDto, type DigitizationStateDto,
} from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { IconEdit, IconLayoutGrid, IconList, IconTrash } from "../icons";
import { PageEditModal } from "./PageEditModal";

const PAGE_SIZE_OPTIONS = ["12", "24", "48", "96", "all"];
const STATUS_COLOR: Record<string, string> = {
  Pending: "gray",
  Typing: "blue",
  Typed: "cyan",
  ProofRead: "teal",
  Complete: "green",
};

// Phase 2 (epic #162) - list/grid page management for a digitized book: page size selector,
// multi-select + bulk delete/status, drag-and-drop reorder. Bulk set-chapter is wired at the API
// layer (bulkSetPageChapter) but has no UI here yet since chapters themselves don't exist until
// Phase 4 - this view will grow a chapter picker once that lands, the same way it will grow crop/
// rotate controls once Phase 3 lands.
export function DigitizationPageManager({ bookId, state }: { bookId: string; state: DigitizationStateDto }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [view, setView] = useState<"grid" | "list">("grid");
  const [pageSize, setPageSize] = useState("24");
  const [pageIndex, setPageIndex] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [editingPage, setEditingPage] = useState<DigitizationPageDto | null>(null);

  const sortedPages = useMemo(() => [...state.pages].sort((a, b) => a.order - b.order), [state.pages]);

  const pageCount = pageSize === "all" ? 1 : Math.max(1, Math.ceil(sortedPages.length / Number(pageSize)));
  const visiblePages = useMemo(() => {
    if (pageSize === "all") return sortedPages;
    const size = Number(pageSize);
    return sortedPages.slice(pageIndex * size, pageIndex * size + size);
  }, [sortedPages, pageSize, pageIndex]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["digitizationState", bookId] });

  const reorderMutation = useMutation({
    mutationFn: (pageIds: string[]) => reorderDigitizationPages(bookId, pageIds),
    onSuccess: invalidate,
    onError: (err) => notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) }),
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => bulkSetPageStatus(bookId, [...selected], status),
    onSuccess: () => {
      invalidate();
      setSelected(new Set());
    },
    onError: (err) => notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) }),
  });

  const chapterMutation = useMutation({
    mutationFn: (chapterId: string | null) => bulkSetPageChapter(bookId, [...selected], chapterId),
    onSuccess: () => {
      invalidate();
      setSelected(new Set());
    },
    onError: (err) => notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteDigitizationPages(bookId, [...selected]),
    onSuccess: () => {
      invalidate();
      setSelected(new Set());
      setDeleteConfirmOpen(false);
    },
    onError: (err) => notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) }),
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const allSelected = visiblePages.every((p) => prev.has(p.id));
      const next = new Set(prev);
      for (const p of visiblePages) {
        if (allSelected) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });
  };

  const handleDrop = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    const ids = sortedPages.map((p) => p.id);
    const from = ids.indexOf(draggingId);
    const to = ids.indexOf(targetId);
    ids.splice(from, 1);
    ids.splice(to, 0, draggingId);
    setDraggingId(null);
    reorderMutation.mutate(ids);
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <Group gap="sm">
          <SegmentedControl
            size="xs"
            value={view}
            onChange={(v) => setView(v as "grid" | "list")}
            data={[
              { label: <IconLayoutGrid size={14} />, value: "grid" },
              { label: <IconList size={14} />, value: "list" },
            ]}
          />
          <Select
            size="xs"
            w={90}
            data={PAGE_SIZE_OPTIONS}
            value={pageSize}
            onChange={(v) => {
              setPageSize(v ?? "24");
              setPageIndex(0);
            }}
          />
          <Checkbox
            size="xs"
            label={t("digitize.selectAll")}
            checked={visiblePages.length > 0 && visiblePages.every((p) => selected.has(p.id))}
            indeterminate={visiblePages.some((p) => selected.has(p.id)) && !visiblePages.every((p) => selected.has(p.id))}
            onChange={toggleAllVisible}
          />
        </Group>

        {pageSize !== "all" && pageCount > 1 && (
          <Group gap="xs">
            <Button size="xs" variant="default" disabled={pageIndex === 0} onClick={() => setPageIndex((i) => i - 1)}>
              {t("common.previous")}
            </Button>
            <Text size="xs" c="dimmed">
              {t("digitize.pageOfPages", { current: pageIndex + 1, total: pageCount })}
            </Text>
            <Button size="xs" variant="default" disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex((i) => i + 1)}>
              {t("common.next")}
            </Button>
          </Group>
        )}
      </Group>

      {selected.size > 0 && (
        <Paper withBorder p="xs">
          <Group justify="space-between">
            <Text size="sm">{t("digitize.selectedCount", { count: selected.size })}</Text>
            <Group gap="xs">
              <Select
                size="xs"
                placeholder={t("digitize.setStatus")}
                data={Object.keys(STATUS_COLOR)}
                onChange={(v) => v && statusMutation.mutate(v)}
                disabled={statusMutation.isPending}
                clearable
              />
              <Select
                size="xs"
                placeholder={t("digitize.setChapter")}
                data={state.chapters.map((c) => ({ value: c.id, label: c.title }))}
                onChange={(v) => chapterMutation.mutate(v ?? null)}
                disabled={chapterMutation.isPending || state.chapters.length === 0}
                clearable
              />
              <Button size="xs" color="red" leftSection={<IconTrash size={14} />} onClick={() => setDeleteConfirmOpen(true)}>
                {t("common.delete")}
              </Button>
            </Group>
          </Group>
        </Paper>
      )}

      {view === "grid" ? (
        <SimpleGrid cols={{ base: 3, sm: 4, md: 6 }} spacing="sm">
          {visiblePages.map((page) => (
            <PageThumbnail
              key={page.id}
              bookId={bookId}
              page={page}
              selected={selected.has(page.id)}
              onToggle={() => toggle(page.id)}
              onDragStart={() => setDraggingId(page.id)}
              onDrop={() => handleDrop(page.id)}
              onEdit={() => setEditingPage(page)}
            />
          ))}
        </SimpleGrid>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th />
              <Table.Th>{t("digitize.pageNumber")}</Table.Th>
              <Table.Th />
              <Table.Th>{t("digitize.status")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {visiblePages.map((page) => (
              <Table.Tr
                key={page.id}
                draggable
                onDragStart={() => setDraggingId(page.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(page.id)}
              >
                <Table.Td>
                  <Checkbox checked={selected.has(page.id)} onChange={() => toggle(page.id)} />
                </Table.Td>
                <Table.Td>{page.order}</Table.Td>
                <Table.Td>
                  <Image src={digitizationPageImageUrl(bookId, page.id)} h={48} w={36} fit="contain" />
                </Table.Td>
                <Table.Td>
                  <Badge color={STATUS_COLOR[page.editStatus] ?? "gray"} variant="light">
                    {page.editStatus}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <ActionIcon variant="subtle" onClick={() => setEditingPage(page)} aria-label={t("digitize.editPage", { page: page.order })}>
                    <IconEdit size={14} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} title={t("digitize.deletePages")} centered>
        <Stack gap="md">
          <Text size="sm">{t("digitize.confirmDeletePages", { count: selected.size })}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteConfirmOpen(false)} disabled={deleteMutation.isPending}>
              {t("common.cancel")}
            </Button>
            <Button color="red" loading={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
              {t("common.delete")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {editingPage && (
        <PageEditModal bookId={bookId} page={editingPage} chapters={state.chapters} onClose={() => setEditingPage(null)} />
      )}
    </Stack>
  );
}

function PageThumbnail({
  bookId, page, selected, onToggle, onDragStart, onDrop, onEdit,
}: {
  bookId: string;
  page: DigitizationPageDto;
  selected: boolean;
  onToggle: () => void;
  onDragStart: () => void;
  onDrop: () => void;
  onEdit: () => void;
}) {
  return (
    <Paper
      withBorder
      p={4}
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      style={{ position: "relative", cursor: "grab", outline: selected ? "2px solid var(--mantine-color-blue-6)" : undefined }}
    >
      <Checkbox
        checked={selected}
        onChange={onToggle}
        style={{ position: "absolute", top: 4, left: 4, zIndex: 1 }}
      />
      <Badge size="xs" color={STATUS_COLOR[page.editStatus] ?? "gray"} style={{ position: "absolute", top: 4, right: 4, zIndex: 1 }}>
        {page.order}
      </Badge>
      <ActionIcon
        size="sm"
        variant="filled"
        onClick={onEdit}
        style={{ position: "absolute", bottom: 4, right: 4, zIndex: 1 }}
      >
        <IconEdit size={12} />
      </ActionIcon>
      <Image src={digitizationPageImageUrl(bookId, page.id)} h={140} fit="contain" radius="sm" mt={20} />
    </Paper>
  );
}
