import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import {
  ActionIcon, Button, Group, Image, Modal, NumberInput, Popover, ScrollArea, SegmentedControl, Select, Slider,
  Text, Textarea, Tooltip,
} from "@mantine/core";
import {
  bulkSetPageChapter, bulkSetPageStatus, cropDigitizationPage, digitizationPageImageUrl, getDigitizationPageText,
  rotateDigitizationPage, runDigitizationPageOcr, saveDigitizationPageText, splitDigitizationPage,
  type DigitizationChapterDto, type DigitizationPageDto,
} from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import {
  IconArrowLeft, IconArrowRight, IconCrop, IconRotate, IconScanLine, IconZoomIn, IconZoomOut,
} from "../icons";

const STATUSES = ["Pending", "Typing", "Typed", "ProofRead", "Complete"];
const AUTOSAVE_DELAY_MS = 1500;
const ZOOM_STEP = 25;
const ZOOM_MIN = 25;
const ZOOM_MAX = 300;

// Unified full-page editor for a single page (replaces the old modal-based PageEditModal/
// TypingEditor pair) - image and text side by side at equal height, each independently scrollable,
// rotate/crop/split/chapter/status/OCR all merged into one toolbar rather than separate dialogs.
// Renders in place of the page list/chapter sidebar (see DigitizationWindow.tsx's editingPageId),
// not as a Modal - "replace the whole page" per the actual feedback this came from.
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
  const [cacheBust, setCacheBust] = useState(0);
  const [cropOpen, setCropOpen] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 100, height: 100 });
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitRatio, setSplitRatio] = useState(50);
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null);
  const saveTimer = useRef<number | null>(null);

  const page = sortedPages[index];
  const chapter = chapters.find((c) => c.id === page.chapterId);

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

  const rotateMutation = useMutation({
    mutationFn: (degrees: number) => rotateDigitizationPage(bookId, page.id, degrees),
    onSuccess: () => {
      invalidateState();
      setCacheBust(Date.now());
    },
    onError: (err) => notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) }),
  });

  const cropMutation = useMutation({
    mutationFn: () => cropDigitizationPage(bookId, page.id, crop.x / 100, crop.y / 100, crop.width / 100, crop.height / 100),
    onSuccess: () => {
      invalidateState();
      setCacheBust(Date.now());
      setCrop({ x: 0, y: 0, width: 100, height: 100 });
      setCropOpen(false);
    },
    onError: (err) => notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) }),
  });

  const splitMutation = useMutation({
    mutationFn: () => splitDigitizationPage(bookId, page.id, splitRatio / 100),
    onSuccess: () => {
      invalidateState();
      setSplitOpen(false);
    },
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

  const imageUrl = digitizationPageImageUrl(bookId, page.id, cacheBust || undefined);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Group gap="xs" p="xs" wrap="wrap" style={{ borderBottom: "1px solid var(--mantine-color-default-border)", flexShrink: 0 }}>
        <ActionIcon variant="default" onClick={handleClose} aria-label={t("common.back")}>
          <IconArrowLeft size={16} />
        </ActionIcon>
        <Button variant="default" size="xs" leftSection={<IconArrowLeft size={14} />} disabled={index === 0} onClick={() => goTo(index - 1)}>
          {t("common.previous")}
        </Button>
        <Button variant="default" size="xs" rightSection={<IconArrowRight size={14} />} disabled={index === sortedPages.length - 1} onClick={() => goTo(index + 1)}>
          {t("common.next")}
        </Button>

        <Text size="sm" fw={600}>
          {t("digitize.pageOfPages", { current: index + 1, total: sortedPages.length })}
          {" — "}
          {chapter?.title ?? t("digitize.noChapter")}
        </Text>

        <Select
          size="xs"
          w={160}
          placeholder={t("digitize.setChapter")}
          data={chapters.map((c) => ({ value: c.id, label: c.title }))}
          value={page.chapterId}
          onChange={(v) => chapterMutation.mutate(v ?? null)}
          disabled={chapterMutation.isPending}
          clearable
        />

        <SegmentedControl size="xs" data={STATUSES} value={page.editStatus} onChange={(v) => statusMutation.mutate(v)} />

        <Tooltip label={t("digitize.rotateLeft")}>
          <ActionIcon variant="default" loading={rotateMutation.isPending} onClick={() => rotateMutation.mutate(-90)}>
            <IconRotate size={16} style={{ transform: "scaleX(-1)" }} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t("digitize.rotateRight")}>
          <ActionIcon variant="default" loading={rotateMutation.isPending} onClick={() => rotateMutation.mutate(90)}>
            <IconRotate size={16} />
          </ActionIcon>
        </Tooltip>

        <Popover opened={cropOpen} onChange={setCropOpen} withArrow>
          <Popover.Target>
            <ActionIcon variant="default" onClick={() => setCropOpen((v) => !v)} aria-label={t("digitize.crop")}>
              <IconCrop size={16} />
            </ActionIcon>
          </Popover.Target>
          <Popover.Dropdown>
            <Group gap="xs" mb="xs">
              <NumberInput label="X%" min={0} max={99} value={crop.x} onChange={(v) => setCrop((c) => ({ ...c, x: Number(v) || 0 }))} w={80} />
              <NumberInput label="Y%" min={0} max={99} value={crop.y} onChange={(v) => setCrop((c) => ({ ...c, y: Number(v) || 0 }))} w={80} />
            </Group>
            <Group gap="xs" mb="xs">
              <NumberInput label="W%" min={1} max={100} value={crop.width} onChange={(v) => setCrop((c) => ({ ...c, width: Number(v) || 1 }))} w={80} />
              <NumberInput label="H%" min={1} max={100} value={crop.height} onChange={(v) => setCrop((c) => ({ ...c, height: Number(v) || 1 }))} w={80} />
            </Group>
            <Button size="xs" fullWidth loading={cropMutation.isPending} onClick={() => cropMutation.mutate()}>
              {t("digitize.apply")}
            </Button>
          </Popover.Dropdown>
        </Popover>

        <Popover opened={splitOpen} onChange={setSplitOpen} withArrow>
          <Popover.Target>
            <ActionIcon variant="default" onClick={() => setSplitOpen((v) => !v)} aria-label={t("digitize.split")}>
              <IconScanLine size={16} />
            </ActionIcon>
          </Popover.Target>
          <Popover.Dropdown w={220}>
            <Text size="xs" c="dimmed" mb="xs">{t("digitize.splitExplain")}</Text>
            <Slider value={splitRatio} onChange={setSplitRatio} min={10} max={90} label={(v) => `${v}%`} mb="xs" />
            <Button size="xs" fullWidth loading={splitMutation.isPending} onClick={() => splitMutation.mutate()}>
              {t("digitize.apply")}
            </Button>
          </Popover.Dropdown>
        </Popover>

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
      </Group>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <ScrollArea style={{ flex: 1, height: "100%", borderInlineEnd: "1px solid var(--mantine-color-default-border)" }} p="sm">
          <Image src={imageUrl} fit="contain" w={`${zoom}%`} />
        </ScrollArea>
        <ScrollArea style={{ flex: 1, height: "100%" }} p="sm">
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
