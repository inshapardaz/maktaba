import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import {
  ActionIcon, Button, Group, Image, Menu, Modal, ScrollArea, Select, Text, Textarea, Tooltip,
} from "@mantine/core";
import {
  bulkSetPageChapter, bulkSetPageStatus, digitizationPageImageUrl, getDigitizationPageText,
  runDigitizationPageOcr, saveDigitizationPageText, type DigitizationChapterDto, type DigitizationPageDto,
} from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import {
  IconArrowRight, IconChevronLeft, IconChevronRight, IconScanLine, IconX, IconZoomIn, IconZoomOut,
} from "../icons";

const STATUSES = ["Pending", "Typing", "Typed", "ProofRead", "Complete"];
const AUTOSAVE_DELAY_MS = 1500;
const ZOOM_STEP = 25;
const ZOOM_MIN = 25;
const ZOOM_MAX = 300;

// Unified full-page editor for a single page's text/chapter/status/OCR (image editing - crop/
// rotate/re-split - stayed in the separate PageEditModal, opened from the page list/grid instead
// of here). Replaces the page list/chapter sidebar entirely while open (see DigitizationWindow.tsx's
// editingPageId) rather than floating over it - image and text side by side at equal height, each
// independently scrollable.
export function PageEditorView({
  bookId, pages, chapters, initialPageId, onClose,
}: {
  bookId: string;
  pages: DigitizationPageDto[];
  chapters: DigitizationChapterDto[];
  initialPageId: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const sortedPages = [...pages].sort((a, b) => a.order - b.order);
  const [index, setIndex] = useState(() => Math.max(0, sortedPages.findIndex((p) => p.id === initialPageId)));
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null);
  const saveTimer = useRef<number | null>(null);

  const page = sortedPages[index];
  const chapter = chapters.find((c) => c.id === page.chapterId);
  const statusIndex = STATUSES.indexOf(page.editStatus);
  const nextStatus = statusIndex >= 0 && statusIndex < STATUSES.length - 1 ? STATUSES[statusIndex + 1] : null;

  const invalidateState = () => void queryClient.invalidateQueries({ queryKey: ["digitizationState", bookId] });

  const textQuery = useQuery({
    queryKey: ["digitizationPageText", bookId, page.id],
    queryFn: () => getDigitizationPageText(bookId, page.id),
  });

  useEffect(() => {
    if (textQuery.data !== undefined) {
      setText(textQuery.data);
      setDirty(false);
    }
    // Only re-sync from the server when the loaded page's own text actually arrives - typing
    // shouldn't be clobbered by an unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (value: string) => saveDigitizationPageText(bookId, page.id, value),
    onSuccess: () => {
      setDirty(false);
      invalidateState();
    },
    onError: (err) => notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) }),
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => bulkSetPageStatus(bookId, [page.id], status),
    onSuccess: invalidateState,
    onError: (err) => notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) }),
  });

  const chapterMutation = useMutation({
    mutationFn: (chapterId: string | null) => bulkSetPageChapter(bookId, [page.id], chapterId),
    onSuccess: invalidateState,
    onError: (err) => notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) }),
  });

  const ocrMutation = useMutation({
    mutationFn: () => runDigitizationPageOcr(bookId, page.id),
    onSuccess: (recognizedText) => {
      setText(recognizedText);
      setDirty(false);
      invalidateState();
    },
    onError: (err) => notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) }),
  });

  const flushSave = (value: string) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveMutation.mutate(value);
  };

  const handleTextChange = (value: string) => {
    setText(value);
    setDirty(true);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => flushSave(value), AUTOSAVE_DELAY_MS);
  };

  // "Detect unsaved changes and prompt before navigating away" - autosave already fires 1.5s after
  // the last keystroke, but a quick prev/next/close click before that timer elapses would otherwise
  // silently lose (or silently save without asking) whatever was just typed. This blocks that
  // navigation and asks explicitly instead.
  const guardedNavigate = (action: () => void) => {
    if (dirty) {
      setPendingNav(() => action);
    } else {
      action();
    }
  };

  const goTo = (newIndex: number) => {
    if (newIndex < 0 || newIndex >= sortedPages.length) return;
    guardedNavigate(() => setIndex(newIndex));
  };

  const handleClose = () => guardedNavigate(onClose);

  const imageUrl = digitizationPageImageUrl(bookId, page.id);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <Group gap="xs" p="xs" wrap="wrap" style={{ borderBottom: "1px solid var(--mantine-color-default-border)", flexShrink: 0 }}>
        <Group gap={0} wrap="nowrap" style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: "var(--mantine-radius-sm)" }}>
          <ActionIcon variant="subtle" size="lg" radius={0} disabled={index === 0} onClick={() => goTo(index - 1)} aria-label={t("common.previous")}>
            <IconChevronLeft size={16} />
          </ActionIcon>
          <Text size="sm" fw={600} px={8} style={{ whiteSpace: "nowrap" }}>
            {t("digitize.pageOfPages", { current: index + 1, total: sortedPages.length })}
          </Text>
          <ActionIcon variant="subtle" size="lg" radius={0} disabled={index === sortedPages.length - 1} onClick={() => goTo(index + 1)} aria-label={t("common.next")}>
            <IconChevronRight size={16} />
          </ActionIcon>
        </Group>

        <Menu shadow="md">
          <Menu.Target>
            <Button variant="default" size="xs">
              {chapter?.title ?? t("digitize.noChapter")}
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={() => chapterMutation.mutate(null)}>{t("digitize.noChapter")}</Menu.Item>
            {chapters.map((c) => (
              <Menu.Item key={c.id} onClick={() => chapterMutation.mutate(c.id)}>
                {c.title}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>

        <Select
          size="xs"
          w={130}
          data={STATUSES}
          value={page.editStatus}
          onChange={(v) => v && statusMutation.mutate(v)}
          allowDeselect={false}
        />
        <Tooltip label={t("digitize.advanceStatus")}>
          <ActionIcon
            variant="default"
            disabled={!nextStatus}
            loading={statusMutation.isPending}
            onClick={() => nextStatus && statusMutation.mutate(nextStatus)}
            aria-label={t("digitize.advanceStatus")}
          >
            <IconArrowRight size={16} />
          </ActionIcon>
        </Tooltip>

        <Group gap={4} wrap="nowrap">
          <ActionIcon variant="default" disabled={zoom <= ZOOM_MIN} onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))} aria-label={t("digitize.zoomOut")}>
            <IconZoomOut size={16} />
          </ActionIcon>
          <Text size="xs" w={40} ta="center">{zoom}%</Text>
          <ActionIcon variant="default" disabled={zoom >= ZOOM_MAX} onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))} aria-label={t("digitize.zoomIn")}>
            <IconZoomIn size={16} />
          </ActionIcon>
        </Group>

        <Button size="xs" variant="light" leftSection={<IconScanLine size={14} />} loading={ocrMutation.isPending} onClick={() => ocrMutation.mutate()}>
          {t("digitize.runOcr")}
        </Button>

        <Text size="xs" c="dimmed" ms="auto">
          {saveMutation.isPending ? t("common.saving") : dirty ? t("digitize.unsavedChanges") : t("digitize.saved")}
        </Text>

        <ActionIcon variant="default" onClick={handleClose} aria-label={t("common.close")}>
          <IconX size={16} />
        </ActionIcon>
      </Group>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <ScrollArea style={{ flex: 1, minHeight: 0, borderInlineEnd: "1px solid var(--mantine-color-default-border)" }} p="sm">
          <Image src={imageUrl} fit="contain" w={`${zoom}%`} />
        </ScrollArea>
        <ScrollArea style={{ flex: 1, minHeight: 0 }} p="sm">
          <Textarea
            value={text}
            onChange={(e) => handleTextChange(e.currentTarget.value)}
            autosize
            minRows={20}
            styles={{ input: { fontFamily: "monospace", border: "none" } }}
          />
        </ScrollArea>
      </div>

      <Modal opened={pendingNav !== null} onClose={() => setPendingNav(null)} title={t("digitize.unsavedChangesTitle")} centered>
        <Text size="sm" mb="md">{t("digitize.unsavedChangesBody")}</Text>
        <Group justify="flex-end">
          <Button
            variant="subtle"
            onClick={() => {
              setDirty(false);
              const action = pendingNav;
              setPendingNav(null);
              action?.();
            }}
          >
            {t("digitize.discardChanges")}
          </Button>
          <Button variant="default" onClick={() => setPendingNav(null)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => {
              flushSave(text);
              const action = pendingNav;
              setPendingNav(null);
              action?.();
            }}
          >
            {t("digitize.saveAndContinue")}
          </Button>
        </Group>
      </Modal>
    </div>
  );
}
